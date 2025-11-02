import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";
import * as cp from "child_process";

import * as vscode from "vscode";
import fetch from "node-fetch";

var defaultExePath: string;
var installingExe: boolean = false;
var statusButton: vscode.StatusBarItem;

var process: cp.ChildProcess | undefined;
var output: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    const exe = `sanity${os.platform() === "win32" ? ".exe" : ""}`;
    defaultExePath = path.join(context.globalStorageUri.fsPath, exe);

    output = vscode.window.createOutputChannel("sanity liveserver");
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(autorun),
        vscode.commands.registerCommand(cmd("run"), function () {
            if (installingExe) return;
            else if (isExeInstalled()) runSanity();
            else suggestInstallSanity();
        }),
        vscode.commands.registerCommand(cmd("stop"), function () {
            process?.kill("SIGTERM");
            process = undefined;
            updateStatusButton();
        }),
        vscode.commands.registerCommand(cmd("install"), function () {
            if (installingExe) return;
            exec("stop");

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

export function deactivate() {
    exec("stop");
}

function expectGlobalStorage() {
    const dir = path.dirname(getExePath());
    fs.mkdirSync(dir, { recursive: true });
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
    const size = Number(response.headers.get("content-length"));

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
        if (files.length > 0) exec("run");
    });
}

function updateStatusButton() {
    if (installingExe) {
        statusButton.command = undefined;
        statusButton.text = "$(beaker) sanity: installing";
        statusButton.tooltip = "Installing the live-server...";
    } else if (process) {
        statusButton.command = cmd("stop");
        statusButton.text = "$(globe) sanity: running";
        statusButton.tooltip = "Stop sanity live-server";
    } else {
        statusButton.command = cmd("run");
        statusButton.text = "$(debug-start) sanity: stopped";
        statusButton.tooltip = "Run sanity live-server";
    }
}

function suggestInstallSanity() {
    const message = "Sanity is not installed. Install now?";
    const install = "Yes", nope = "No";
    vscode.window.showInformationMessage(message, install, nope).then((res) => {
        if (res == install)
            exec("install").then(() => exec("run"))
    });
}

function runSanity() {
    const port = config().get("port") ?? 8000;
    const cwd = vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath;
    const args = ["server", "--port", port.toString()];

    output.clear(), output.show();
    process = cp.execFile(getExePath(), args, { cwd }, () => { exec("stop"); });
    process.stderr?.on("data", output.append);
    updateStatusButton();
}

function cmd(name: string): string {
    return `vscode-sanity-liveserver.${name}`;
}

function exec(name: string): Thenable<unknown> {
    return vscode.commands.executeCommand(cmd(name));
}

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("vscode-sanity-liveserver");
}
