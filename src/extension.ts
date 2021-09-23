import * as vscode from "vscode"
import { PlutoBackend as PlutoBackend } from "./backend"
import { accessSync, mkdir, mkdtemp, mkdtempSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { base64_arraybuffer, decode_base64_to_Uint8Array } from "./encoding"
import { create_proxy } from "./ws-proxy"

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("plutoView.start", () => {
            PlutoPanel.createOrShow(context)
        })
    )

    // plutoViewPanel.createOrShow(context);

    // if (vscode.window.registerWebviewPanelSerializer) {
    // 	// Make sure we register a serializer in activation event
    // 	vscode.window.registerWebviewPanelSerializer(plutoViewPanel.viewType, {
    // 		async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
    // 			console.log(`Got state: ${state}`);
    // 			// Reset the webview options so we use latest uri for `localResourceRoots`.
    // 			webviewPanel.webview.options = getWebviewOptions(
    // 				context.extensionUri,
    // 				pluto_asset_dir
    // 			);
    // 			plutoViewPanel.revive(webviewPanel, context);
    // 		},
    // 	});
    // }
}

function getWebviewOptions(extensionUri: vscode.Uri, pluto_asset_dir: string): vscode.WebviewOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory and Pluto's asset dir.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media"), vscode.Uri.file(pluto_asset_dir)],
    }
}

/**
 * Manages cat coding webview panels
 */
class PlutoPanel {
    /**
     * Track the currently panel. Only allow a single panel to exist at a time.
     */
    public static currentPanel: PlutoPanel | undefined

    public static readonly viewType = "plutoView"

    private readonly _panel: vscode.WebviewPanel
    private readonly _context: vscode.ExtensionContext
    public _disposables: vscode.Disposable[] = []

    public static createOrShow(context: vscode.ExtensionContext) {
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1)

        const pluto_asset_dir = join(tmpdir(), getNonce())
        console.log("pluto_asset_dir: ", pluto_asset_dir)

        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

        // If we already have a panel, show it.
        if (PlutoPanel.currentPanel) {
            PlutoPanel.currentPanel._panel.reveal(column)
            return
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            PlutoPanel.viewType,
            "Cat Coding",
            column || vscode.ViewColumn.One,
            getWebviewOptions(context.extensionUri, pluto_asset_dir)
        )

        const current = (PlutoPanel.currentPanel = new PlutoPanel(panel, context))

        // launch the pluto server

        statusBarItem.text = "Catalyst"
        statusBarItem.command = "catalystgui.showOptions"
        statusBarItem.show()
        const pb = PlutoBackend.create(context, statusBarItem, {
            pluto_asset_dir,
            vscode_proxy_root: panel.webview.asWebviewUri(vscode.Uri.file(pluto_asset_dir)),
        })

        const handler = setInterval(() => {
            try {
                accessSync(join(pluto_asset_dir, "editor_bespoke.html"))
                console.log("file exists!")

                setTimeout(async () => {
                    const contents = readFileSync(join(pluto_asset_dir, "editor_bespoke.html"), {
                        encoding: "utf8",
                    })

                    console.log("Creating proxy...")
                    await create_proxy({
                        ws_address: `ws://localhost:${pb.port}/?secret=${pb.secret}`,
                        send_to_client: (x: any) => panel.webview.postMessage(x),
                        create_client_listener: (f: any) => {
                            panel.webview.onDidReceiveMessage(f, null, current._disposables)
                        },
                    })
                    console.log("Proxy created!")

                    console.log("Loading page HTML")
                    current.set_html("Pluto", contents)
                }, 50)

                clearInterval(handler)
            } catch (e) {
                //
            }
        }, 200)
    }

    public static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        PlutoPanel.currentPanel = new PlutoPanel(panel, context)
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel
        this._context = context

        // Set the webview's initial html content
        this.set_html(
            "Pluto loading...",
            `<!DOCTYPE html>
		<html lang="en">
		<head>
			<title>Loading...</title>
		</head>
		<body style="margin: 0px; padding: 0px; overflow: hidden; background: white;">
			<h1>Loading...</h1>
		</body>
		</html>`
        )

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    }

    public dispose() {
        PlutoPanel.currentPanel = undefined

        // Clean up our resources
        this._panel.dispose()

        while (this._disposables.length) {
            const x = this._disposables.pop()
            if (x) {
                x.dispose()
            }
        }
    }
    public set_html(title: string, contents: string) {
        this._panel.title = title
        this._panel.webview.html = contents
    }
}

function getNonce() {
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
