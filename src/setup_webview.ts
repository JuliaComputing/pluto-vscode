import { accessSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { v4 as uuid } from "uuid"
import * as vscode from "vscode"
import { PlutoBackend } from "./backend"
import { LOADING_HTML } from "./extension"
import { create_proxy } from "./ws-proxy"
import { PlutoEditor } from "./PlutoEditor"

export const pluto_asset_dir = join(tmpdir(), uuid())
/** A temporary directory that starts out empty. We will ask the Pluto runner to fill this directory with Pluto's frontend assets, and with 'bespoke editors'. Search for 'bespoke' to learn more! */
console.log("pluto_asset_dir: ", pluto_asset_dir)

export const get_default_backend = (extensionPath: string) => {
    return PlutoBackend.create_async(extensionPath, PlutoEditor.statusbar, {
        pluto_asset_dir,
        pluto_config: {
            // workspace_use_distributed: false,
        },
    })
}

export const setup_pluto_in_webview = ({
    panel,
    context,
    notebook_id,
    editor_html_filename,
    renderStatusBar,
    backend,
    initialize_notebook,
}: {
    panel: vscode.WebviewPanel
    context: vscode.ExtensionContext
    notebook_id: string
    editor_html_filename: string
    renderStatusBar: Function
    backend: PlutoBackend
    initialize_notebook: Function
}) => {
    // Setup initial content for the webview
    panel.webview.options = getWebviewOptions(context.extensionUri)

    renderStatusBar()
    panel.webview.html = LOADING_HTML

    let disposed: boolean = false
    let disposables: vscode.Disposable[] = []

    const set_html = (title: string, contents: string) => {
        panel.title = title
        panel.webview.html = contents
    }

    // Make sure we get rid of the listener when our editor is closed.
    panel.onDidDispose(() => {
        disposed = true
        disposables.forEach((x) => x.dispose())
        renderStatusBar()
    })

    const vscode_proxy_root = panel.webview.asWebviewUri(vscode.Uri.file(pluto_asset_dir)).toString()

    backend.ready.then(async () => {
        await initialize_notebook({ vscode_proxy_root })

        const interval_handler = setInterval(() => {
            /*
		This loop will keep checking whether the bespoke editor file has been created.
		
		Since generating the bespoke editor is the last thing that the Pluto runner does, this is a low-tech way to know that the runner is ready. 🌝
		*/
            try {
                // console.log("checking file existence!")
                accessSync(join(pluto_asset_dir, editor_html_filename))
                // last function call will throw if the file does not exist yet.

                // From this point on, the bespoke editor file exists, the runner is ready, and we will continue setting up this beautiful IDE experience for our patient users.
                // console.log("file exists!")

                setTimeout(async () => {
                    const bespoke_editor_contents = readFileSync(join(pluto_asset_dir, editor_html_filename), {
                        encoding: "utf8",
                    })

                    console.log("Creating proxy...")
                    await create_proxy({
                        ws_address: `ws://localhost:${await backend.port}/?secret=${backend.secret}`,
                        send_to_client: (x: any) => {
                            // TODO: the fact that this is called when disposed
                            // means we're memory leaking. Fix that!
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

                    // Now that the proxy is set up, we can set the HTML contents of our Webview, which will trigger it to load.
                    console.log("Loading page HTML")
                    set_html("Pluto", bespoke_editor_contents)
                }, 50)

                clearInterval(interval_handler)
            } catch (e) {
                // TODO: check the error type and rethrow or handle correctly if it's not a file-does-not-exist-yet error?
                // TODO: Maybe add a timeout
            }
        }, 200)
    })
}

export function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory and Pluto's asset dir.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media"), vscode.Uri.file(pluto_asset_dir)],
    }
}
