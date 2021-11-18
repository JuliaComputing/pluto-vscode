import * as vscode from "vscode"
import * as path from "path"
import { PlutoBackend as PlutoBackend } from "./backend"
import { accessSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { v4 as uuid } from "uuid"
import { create_proxy } from "./ws-proxy"
import { PlutoEditor } from "./PlutoEditor"
import { TextEncoder } from "util"

/*
HELLO

This file is the entry point of the extension. The important function here is `new_notebook`.
*/

export function activate(context: vscode.ExtensionContext) {
    console.log("Activating extension pluto-vscode")
    context.subscriptions.push(PlutoEditor.register(context))
    context.subscriptions.push(
        vscode.commands.registerCommand("plutoView.start", () => {
            // THE ONLY WAY I WAS ABLE TO DO THIS IS
            // ask the user for the file name IN ADVANCE, then write an empty notebook there, then open it
            // ugh
            vscode.window
                .showSaveDialog({
                    // TODO: initialize with a cute filename
                    filters: {
                        Julia: [".jl"],
                    },
                })
                .then(async (path) => {
                    // TODO: generate a temporary file(?) if none was given by the user
                    // let path = path ?? vscode.Uri.parse("untitled:untitled-1.jl")
                    if (path) {
                        await vscode.workspace.fs.writeFile(path, new TextEncoder().encode(empty_notebook_contents()))
                        vscode.commands.executeCommand("vscode.openWith", path, "plutoView")
                    }
                })

            // OTHER ATTEMPS

            // THIS ONE almost works, but when you do the first Ctrl+S, it does not automatically add the .jl extension
            // const filename = vscode.Uri.parse("untitled:untitled-1.jl")
            // vscode.workspace.fs.writeFile(filename, new TextEncoder().encode(empty_notebook_contents())).then(() => {
            // vscode.commands.executeCommand("vscode.openWith", filename, "plutoView")
            // })

            // ALSO CLOSE and the most official, but it opens the window twice, once in Pluto, once in a text editor.
            // vscode.workspace
            //     .openTextDocument({
            //         content: empty_notebook_contents(),
            //         language: "julia",
            //     })
            //     .then(async (document) => {
            //         const to_close = vscode.workspace.textDocuments.filter((d) => d === document)

            //         await vscode.commands.executeCommand("vscode.openWith", document.uri, "plutoView")
            //         // vs code already opens a regular .jl text editor, we should manually close that...
            //         // TODO: this gives a ...are you sure... popup :(((
            //         for (const doc of to_close) {
            //             console.error("closing!!!")
            //             await vscode.window.showTextDocument(doc)
            //             await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
            //         }
            //     })

            // ORIGINAL: opens a new notebook, but as a webview, not as an editor
            // new_notebook(context)
        })
    )
    context.subscriptions.push(
        vscode.commands.registerCommand("plutoView.openCurrentWith", (selectedDocumentURI) => {
            vscode.commands.executeCommand("vscode.openWith", selectedDocumentURI, "plutoView")
        })
    )
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

/** A temporary directory that starts out empty. We will ask the Pluto runner to fill this directory with Pluto's frontend assets, and with 'bespoke editors'. Search for 'bespoke' to learn more! */
const pluto_asset_dir = join(tmpdir(), uuid())
console.log("pluto_asset_dir: ", pluto_asset_dir)

export const LOADING_HTML = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Loading...</title>
    </head>
    <body style="margin: 0px; padding: 0px; overflow: hidden; background: white; color: #111;">
        <h1>Loading...</h1>
    </body>
    </html>
`

/**
 * Start running a new notebook, create a new panel, set up the WebSocket proxy, show the notebook in the panel.
 */
function new_notebook(context: vscode.ExtensionContext) {
    console.info("Launching Pluto panel!")

    /** Where should the panel appear? */
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    // We are going to show some status stuff. More on this later
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1)

    // Create a new panel. This `WebviewPanel` object has lots of functionality, see https://code.visualstudio.com/api/references/vscode-api#WebviewPanel and the `.webview` property: https://code.visualstudio.com/api/references/vscode-api#Webview
    const panel = vscode.window.createWebviewPanel(
        viewType,
        "Pluto loading...",
        column || vscode.ViewColumn.One,
        getWebviewOptions(context.extensionUri, pluto_asset_dir)
    )

    /**
     * VS Code has the concept of `Disposable`, which is a resource/process/something that needs to be disposed when no longer used. We create an array `disposables` of things that need to be disposed when this window is closed.
     */
    let disposables: vscode.Disposable[] = [panel]
    let disposed: boolean = false

    panel.onDidDispose(() => {
        console.log("disposing!")
        disposed = true
        // Clean up our resources
        disposables.forEach((x) => x.dispose())
    })

    /** Set the HTML content of the Webview panel. Triggers a refresh of the iframe. */
    const set_html = (title: string, contents: string) => {
        panel.title = title
        panel.webview.html = contents
    }

    // Set the webview's initial html content
    set_html("Pluto loading...", LOADING_HTML)

    statusBarItem.text = "Pluto"
    // I am not sure what this command is, still left over code from another app.
    // Might be useful because we want to show "Loading..." in the status bar?
    statusBarItem.command = "pluto.showOptions"
    statusBarItem.show()

    /** We ask VS Code to statically host Pluto's frontend assets. This is the root URL of the static host. */
    const vscode_proxy_root = panel.webview.asWebviewUri(vscode.Uri.file(pluto_asset_dir))

    // Start creating a `backend`, i.e. start running the `julia-runtime/run.jl` script.
    const backend = PlutoBackend.create_async(context, statusBarItem, {
        pluto_asset_dir,
        vscode_proxy_root,
        pluto_config: {
            // workspace_use_distributed: false,
        },
    })

    backend.ready.then(async () => {
        //
        const notebook_id = uuid()
        /**
         * I made up a cool term: ***bespoke editor***.
         *
         * ### Why we need it
         * Normally, every Pluto frontend uses the same `editor.html` and the same `editor.js` file, but the frontend knows which notebook it is connecting to using a URL parameter, for example:
         * `http://localhost:1234/edit?id=5e27f1fc-3a6d-11ec-3044-e53608132ffc`
         *
         * In a webview, it is **not possible to set the URL parameters**. This is why we have something different:
         *
         * ### What is it?
         *
         * ☝️ For each notebook, we create a new `editor.html`, which is just like the original, but with some cool new lines inserted into the head:
         * ```html
         * <script>
         * window.pluto_notebook_id = "5e27f1fc-3a6d-11ec-3044-e53608132ffc"
         * </script>
         * ```
         *
         * ---
         *
         * ✌️ We also replace all local imports with imports from the URL that VS Code provided for us. E.g.:
         * ```html
         * <link rel="stylesheet" href="./editor.css" />
         * ```
         *
         * becomes
         *
         * ```html
         * <link rel="stylesheet" href="vscode://as123df/adsfas123dfsadf/sdf/editor.css" />
         * ```
         *
         * ### Misc
         *
         * (🙋 FYI: This is done using the `pluto_cdn_root` setting, which we also used in normal Pluto to generate HTML files that get our assets from `cdn.jsdelivr.net`.)
         *
         * To keep things simple, the UUID in the filename also the `notebook_id` used by Pluto. 💕
         */
        const editor_html_filename = `editor_bespoke_${notebook_id}.html`
        await backend.send_command("new", {
            editor_html_filename,
            notebook_id,
            frontend_params: {
                // disable_ui: true,
            },
        })

        const interval_handler = setInterval(() => {
            /*
            This loop will keep checking whether the bespoke editor file has been created.
            
            Since generating the bespoke editor is the last thing that the Pluto runner does, this is a low-tech way to know that the runner is ready. 🌝
            */
            try {
                console.log("checking file existence!")
                accessSync(join(pluto_asset_dir, editor_html_filename))
                // last function call will throw if the file does not exist yet.

                // From this point on, the bespoke editor file exists, the runner is ready, and we will continue setting up this beautiful IDE experience for our patient users.
                console.log("file exists!")

                setTimeout(async () => {
                    const bespoke_editor_contents = readFileSync(join(pluto_asset_dir, editor_html_filename), {
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

                    // Now that the proxy is set up, we can set the HTML contents of our Webview, which will trigger it to load.
                    console.log("Loading page HTML")
                    set_html("Pluto", bespoke_editor_contents)
                }, 250)

                clearInterval(interval_handler)
            } catch (e) {
                // TODO: check the error type and rethrow or handle correctly if it's not a file-does-not-exist-yet error?
                // TODO: Maybe add a timeout
            }
        }, 200)
    })
}

// this method is called when your extension is deactivated
export function deactivate() {
    PlutoBackend.deactivate()
}

const empty_notebook_contents = () => {
    let id = uuid()
    return `### A Pluto.jl notebook ###
# v0.17.1

using Markdown
using InteractiveUtils

# ╔═╡ ${id}
i'm new here!

# ╔═╡ Cell order:
# ╠═${id}`
}
