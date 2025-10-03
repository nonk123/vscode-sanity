import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";

import * as vscode from "vscode";
import fetch from "node-fetch";

var defaultExePath: string;
var installingExe: boolean = false;
var statusButton: vscode.StatusBarItem;
var sanityExecution: Thenable<vscode.TaskExecution> | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const exe = `sanity${os.platform() === "win32" ? ".exe" : ""}`;
    const exePath = path.join(context.globalStorageUri.fsPath, exe);
    defaultExePath = exePath;

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(autorun),
        vscode.commands.registerCommand(cmd("run"), function () {
            if (installingExe)
                return;
            if (isExeInstalled()) {
                sanityExecution = vscode.tasks.executeTask(makeRunTask());
                updateStatusButton();
                return;
            }

            const message = "Sanity is not installed. Install now?";
            const install = "Yes";
            const nope = "No";

            vscode.window.showInformationMessage(message, install, nope).then((res) => {
                if (res == install)
                    execCommand("install").then(() => execCommand("run"))
            });
        }),
        vscode.commands.registerCommand(cmd("stop"), function () {
            if (!sanityExecution)
                return;
            sanityExecution.then(exec => {
                exec.terminate();
                sanityExecution = undefined;
                updateStatusButton();
            });
        }),
        vscode.commands.registerCommand(cmd("install"), function () {
            if (installingExe) return;
            execCommand("stop");

            installingExe = true;
            updateStatusButton();

            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: false, title: "Downloading sanity executable" },
                (progress) => actuallyInstall(progress).catch((e) => {
                    vscode.window.showErrorMessage(e.message);
                }).finally(() => {
                    installingExe = false;
                    updateStatusButton();
                })
            );
        }),
        vscode.tasks.registerTaskProvider("sanity-liveserver", {
            provideTasks() {
                return [];
            },
            resolveTask(task) {
                return task;
            },
        }),
        (function () {
            statusButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
            updateStatusButton();
            statusButton.show();
            return statusButton;
        })()
    );

    if (!maybeGetExePath())
        await config().update("path", defaultExePath, true);
    autorun();
}

export function deactivate() { }

function expectGlobalStorage() {
    const dir = path.dirname(getExePath());
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir);
}

function isExeInstalled(): boolean {
    expectGlobalStorage();
    return fs.existsSync(getExePath());
}

function maybeGetExePath(): string | undefined {
    return config().get("path");
}

function getExePath(): string {
    return maybeGetExePath() ?? defaultExePath;
}

async function actuallyInstall(progress: vscode.Progress<{ message?: string | undefined, increment?: number | undefined }>) {
    const suffix = os.platform() === "win32" ? "windows.exe" : "linux";
    const url = `https://github.com/nonk123/sanity/releases/download/gh-actions/sanity-release-${suffix}`;
    const dest = getExePath();

    const response = await fetch(url);
    if (!response.ok || response.body === null)
        throw new Error(`Can't fetch ${url}: ${response.statusText}`);
    const size = Number(response.headers.get('content-length'));

    let read = 0;
    response.body.on("data", (chunk: Buffer) => {
        read += chunk.length;
        progress.report({ increment: read / size });
    });

    expectGlobalStorage();
    const out = fs.createWriteStream(dest);
    try {
        await stream.promises.pipeline(response.body, out);
    } catch (e) {
        fs.unlink(dest, () => null);
        throw e;
    }
}

function autorun() {
    if (config().get<boolean>("autoEnable") !== true)
        return;
    vscode.workspace.findFiles("www/**/*.{j2,scss,lua}", null, 1).then(function (files) {
        if (files.length > 0) execCommand("run");
    });

}

function updateStatusButton() {
    if (installingExe) {
        statusButton.command = undefined;
        statusButton.text = "$(globe) sanity: installing";
        statusButton.tooltip = "Installing the live-server...";
    } else if (sanityExecution) {
        statusButton.command = cmd("stop");
        statusButton.text = "$(globe) sanity: running";
        statusButton.tooltip = "Stop sanity live-server";
    } else {
        statusButton.command = cmd("run");
        statusButton.text = "$(debug-start) sanity: stopped";
        statusButton.tooltip = "Run sanity live-server";
    }
}

function makeRunTask(): vscode.Task {
    const port: number = config().get("port") ?? 8000;

    const process = new vscode.ProcessExecution(getExePath(), {});
    process.args = ["--server", "--port", port.toString()];

    const task = new vscode.Task(
        { type: "vscode-sanity-liveserver" },
        vscode.TaskScope.Workspace,
        "run",
        "sanity",
        process
    );
    task.isBackground = true;
    return task;
}

function cmd(name: string): string {
    return `vscode-sanity-liveserver.${name}`;
}

function execCommand(name: string): Thenable<unknown> {
    return vscode.commands.executeCommand(cmd(name));
}

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("vscode-sanity-liveserver");
}
