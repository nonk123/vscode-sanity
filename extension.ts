import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";

import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("vscode-sanity.run", function () {
            if (isExeInstalled()) vscode.tasks.executeTask(makeRunTask());
            else suggestInstall();
        }),
        vscode.commands.registerCommand("vscode-sanity.install", function () {
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

    if (!getExePath()) {
        const exe = `sanity${os.platform() === "win32" ? ".exe" : ""}`;
        const exePath = path.join(context.globalStorageUri.fsPath, exe);
        vscode.workspace
            .getConfiguration("sanity")
            .update("path", exePath, true);
    }

    vscode.commands.executeCommand("vscode-sanity.run");
}

export function deactivate() { }

function isExeInstalled(): boolean {
    const path = getExePath();
    return path ? fs.existsSync(path) : false;
}

function getExePath(): string | undefined {
    return vscode.workspace.getConfiguration("sanity").get("path");
}

function suggestInstall() {
    const message = "Sanity is not installed. Install now?";
    const install = "Yes";
    const nope = "No";

    vscode.window.showInformationMessage(message, install, nope).then((res) => {
        if (res == install)
            vscode.commands.executeCommand("vscode-sanity.install");
    });
}

async function actuallyInstall() {
    const suffix = os.platform() === "win32" ? "windows.exe" : "linux";
    const url = `https://github.com/nonk123/sanity/releases/download/gh-actions/sanity-release-${suffix}`;

    const dest = getExePath();
    if (!dest)
        throw new Error("Sanity executable path is unset");

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
    const port: number = vscode.workspace.getConfiguration("sanity").get("port") ?? 8000;

    const process = new vscode.ProcessExecution("sanity", {});
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
