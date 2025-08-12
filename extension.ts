import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";

import * as vscode from "vscode";

var defaultExePath: string;

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-sanity-liveserver.run", function () {
            if (isExeInstalled()) vscode.tasks.executeTask(makeRunTask());
            else suggestInstall();
        }),
        vscode.commands.registerCommand("vscode-sanity-liveserver.install", function () {
            actuallyInstall().catch((e) => {
                vscode.window.showErrorMessage(e.message);
            });
        }),
        vscode.tasks.registerTaskProvider("sanity", {
            provideTasks() {
                if (isExeInstalled())
                    return [makeRunTask()];
                suggestInstall();
                return [];
            },
            resolveTask(task) {
                return task;
            },
        })
    );

    const exe = `sanity${os.platform() === "win32" ? ".exe" : ""}`;
    const exePath = path.join(context.globalStorageUri.fsPath, exe);
    defaultExePath = exePath;

    if (!maybeGetExePath())
        config().update("path", defaultExePath, true);

    execCommand("run");
}

export function deactivate() { }

function isExeInstalled(): boolean {
    return fs.existsSync(getExePath());
}

function maybeGetExePath(): string | undefined {
    return config().get("path");
}

function getExePath(): string {
    return maybeGetExePath() ?? defaultExePath;
}

function suggestInstall() {
    const message = "Sanity is not installed. Install now?";
    const install = "Yes";
    const nope = "No";

    vscode.window.showInformationMessage(message, install, nope).then((res) => {
        if (res == install)
            execCommand("install");
    });
}

async function actuallyInstall() {
    const suffix = os.platform() === "win32" ? "windows.exe" : "linux";
    const url = `https://github.com/nonk123/sanity/releases/download/gh-actions/sanity-release-${suffix}`;
    const dest = getExePath();

    const response = await fetch(url);
    if (!response.ok || response.body === null)
        throw new Error(`Can't fetch ${url}: ${response.statusText}`);

    fs.mkdirSync(path.dirname(dest));
    const out = fs.createWriteStream(dest);
    try {
        await stream.promises.pipeline(response.body, out);
    } catch (e) {
        fs.unlink(dest, (_) => null);
        throw e;
    }
}

function makeRunTask(): vscode.Task {
    const port: number = config().get("port") ?? 8000;

    const process = new vscode.ProcessExecution(getExePath(), {});
    process.args = ["--server", "--port", port.toString()];

    const task = new vscode.Task(
        { type: "sanity" },
        vscode.TaskScope.Workspace,
        "run",
        "sanity",
        process
    );
    task.isBackground = true;
    return task;
}

function execCommand(name: string) {
    vscode.commands.executeCommand(`vscode-sanity-liveserver.${name}`);
}

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("sanity-liveserver");
}
