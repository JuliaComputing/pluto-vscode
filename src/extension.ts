import * as vscode from "vscode"
import { PlutoBackend as PlutoBackend } from "./backend"
import { v4 as uuid } from "uuid"
import { PlutoEditor } from "./PlutoEditor"
import { get_default_backend, setup_pluto_in_webview, getWebviewOptions } from "./setup_webview"

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
            // vscode.window
            //     .showSaveDialog({
            //         // TODO: initialize with a cute filename
            //         filters: {
            //             Julia: [".jl"],
            //         },
            //     })
            //     .then(async (path) => {
            //         // TODO: generate a temporary file(?) if none was given by the user
            //         // let path = path ?? vscode.Uri.parse("untitled:untitled-1.jl")
            //         if (path) {
            //             await vscode.workspace.fs.writeFile(path, new TextEncoder().encode(empty_notebook_contents()))
            //             vscode.commands.executeCommand("vscode.openWith", path, "plutoView")
            //         }
            //     })

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
            new_notebook_2(context)
        })
    )
    context.subscriptions.push(
        vscode.commands.registerCommand("plutoView.openCurrentWith", (selectedDocumentURI) => {
            vscode.commands.executeCommand("vscode.openWith", selectedDocumentURI, "plutoView")
        })
    )
}

const viewType = "plutoView"

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
const new_notebook_2 = (context: vscode.ExtensionContext) => {
    console.info("Launching Pluto panel!")

    /** Where should the panel appear? */
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    // Create a new panel. This `WebviewPanel` object has lots of functionality, see https://code.visualstudio.com/api/references/vscode-api#WebviewPanel and the `.webview` property: https://code.visualstudio.com/api/references/vscode-api#Webview
    const panel = vscode.window.createWebviewPanel(viewType, "Pluto loading...", column || vscode.ViewColumn.One, getWebviewOptions(context.extensionUri))

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

    // Start creating a `backend`, i.e. start running the `julia-runtime/run.jl` script.
    const backend = get_default_backend(context.extensionPath)

    const notebook_id = uuid()
    const editor_html_filename = `editor_bespoke_${notebook_id}.html`

    setup_pluto_in_webview({
        panel,
        context,
        notebook_id,
        editor_html_filename,
        renderStatusBar: () => {}, // TODO
        backend,
        initialize_notebook: async (extra_details: Object) => {
            await backend.send_command("new", {
                editor_html_filename,
                notebook_id,
                frontend_params: {
                    // disable_ui: true,
                },
                ...extra_details,
            })
        },
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
