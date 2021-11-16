import * as vscode from "vscode"
import { PlutoBackend as PlutoBackend } from "./backend"
import { accessSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { v4 as uuid } from "uuid"
import { create_proxy } from "./ws-proxy"
import { PlutoEditor } from "./PlutoEditor"

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("plutoView.start", () => {
            vscode.commands.executeCommand('vscode.openWith',
                vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'new notebook.jl'),
                'plutoView');
            // new_notebook(context)
        })
    )
    context.subscriptions.push(PlutoEditor.register(context));
}

export function getWebviewOptions(extensionUri: vscode.Uri, pluto_asset_dir: string): vscode.WebviewOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory and Pluto's asset dir.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media"), vscode.Uri.file(pluto_asset_dir)],
    }
}

const viewType = "plutoView"

const pluto_asset_dir = join(tmpdir(), getNonce())

export const LOADING_HTML = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Loading...</title>
    </head>
    <body style="margin: 0px; padding: 0px; overflow: hidden; background: white;">
        <h1>Loading...</h1>
    </body>
    </html>
`

function new_notebook(context: vscode.ExtensionContext) {
    console.info("Launching Pluto panel!")

    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1)

    console.log("pluto_asset_dir: ", pluto_asset_dir)

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
        viewType,
        "Pluto loading...",
        column || vscode.ViewColumn.One,
        getWebviewOptions(context.extensionUri, pluto_asset_dir)
    )
    let disposed: boolean = false
    let disposables: vscode.Disposable[] = []

    panel.onDidDispose(() => {
        console.log("disposing!")
        disposed = true

        // Clean up our resources
        panel.dispose()

        disposables.forEach((x) => x.dispose())
    })

    const set_html = (title: string, contents: string) => {
        panel.title = title
        panel.webview.html = contents
    }
    // Set the webview's initial html content
    set_html(
        "Pluto loading...", LOADING_HTML
    )

    // launch the pluto server

    statusBarItem.text = "Pluto"
    statusBarItem.command = "pluto.showOptions"
    statusBarItem.show()
    const backend = PlutoBackend.create(context, statusBarItem, {
        pluto_asset_dir,
        vscode_proxy_root: panel.webview.asWebviewUri(vscode.Uri.file(pluto_asset_dir)),
        pluto_config: {
            // workspace_use_distributed: false,
        },
        on_filechange: () => { }
    })

    backend.ready.then(async () => {
        const editor_html_filename = `editor_bespoke_${uuid()}.html`
        await backend.send_command("new", {
            editor_html_filename,
            frontend_params: {
                // disable_ui: true,
            },
        })

        const handler = setInterval(() => {
            try {
                console.log("checking file existence!")
                accessSync(join(pluto_asset_dir, editor_html_filename))
                console.log("file exists!")

                setTimeout(async () => {
                    const contents = readFileSync(join(pluto_asset_dir, editor_html_filename), {
                        encoding: "utf8",
                    })

                    console.log("Creating proxy...")
                    await create_proxy({
                        ws_address: `ws://localhost:${await backend.port}/?secret=${backend.secret}`,
                        send_to_client: (x: any) => {
                            if (!disposed) {
                                return panel.webview.postMessage(x)
                            }
                        },
                        create_client_listener: (f: any) => {
                            panel.webview.onDidReceiveMessage(f, null, disposables)
                        },
                        alert: (x: string) => {
                            return vscode.window.showInformationMessage(x, { modal: true })
                        },
                        confirm: (x: string) => {
                            return vscode.window.showInformationMessage(x, { modal: true }, ...["Yes", "No"]).then((answer) => answer === "Yes")
                        },
                    })
                    console.log("Proxy created!")

                    console.log("Loading page HTML")
                    set_html("Pluto", contents)
                }, 250)

                clearInterval(handler)
            } catch (e) {
                //
            }
        }, 200)
    })
}

export function getNonce() {
    let text = ""
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
}

// this method is called when your extension is deactivated
export function deactivate() {
    PlutoBackend.deactivate()
}
