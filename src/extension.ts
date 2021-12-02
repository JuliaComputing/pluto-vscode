import * as vscode from "vscode"
import { PlutoBackend } from "./backend"
import { PlutoEditor } from "./PlutoEditor"
import { start_empty_notebook_app, start_notebook_file_app } from "./app_engine"
import { TextDecoder, TextEncoder } from "util"
import { v4 as uuid } from "uuid"

// this is a commit on the vscode-webview-proxy branch, see https://github.com/fonsp/Pluto.jl/pull/1493
export const PLUTO_BRANCH_NAME = "12fc15932cbb6ac3bc83e4d758b590f168d069c9"

/*
HELLO

This file is the entry point of the extension. The important function here is `new_notebook`.
*/

export function activate(context: vscode.ExtensionContext) {
    console.log("Activating extension pluto-vscode")
    context.subscriptions.push(PlutoEditor.register(context))
    context.subscriptions.push(
        vscode.commands.registerCommand("pluto.editor.start", () => {
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
                        vscode.commands.executeCommand("vscode.openWith", path, "pluto.editor")
                    }
                })

            // OTHER ATTEMPS

            // THIS ONE almost works, but when you do the first Ctrl+S, it does not automatically add the .jl extension
            // const filename = vscode.Uri.parse("untitled:untitled-1.jl")
            // vscode.workspace.fs.writeFile(filename, new TextEncoder().encode(empty_notebook_contents())).then(() => {
            // vscode.commands.executeCommand("vscode.openWith", filename, "pluto.editor")
            // })

            // ALSO CLOSE and the most official, but it opens the window twice, once in Pluto, once in a text editor.
            // vscode.workspace
            //     .openTextDocument({
            //         content: empty_notebook_contents(),
            //         language: "julia",
            //     })
            //     .then(async (document) => {
            //         const to_close = vscode.workspace.textDocuments.filter((d) => d === document)

            //         await vscode.commands.executeCommand("vscode.openWith", document.uri, "pluto.editor")
            //         // vs code already opens a regular .jl text editor, we should manually close that...
            //         // TODO: this gives a ...are you sure... popup :(((
            //         for (const doc of to_close) {
            //             console.error("closing!!!")
            //             await vscode.window.showTextDocument(doc)
            //             await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
            //         }
            //     })

            // ORIGINAL: opens a new notebook, but as a webview, not as an editor
            // start_empty_notebook_app(context)
        })
    )
    context.subscriptions.push(
        vscode.commands.registerCommand("pluto.editor.openCurrentWith", (selectedDocumentURI) => {
            vscode.commands.executeCommand("vscode.openWith", selectedDocumentURI, "pluto.editor")
        })
    )
    context.subscriptions.push(
        vscode.commands.registerCommand("pluto.appEngine.newNotebook", () => {
            start_empty_notebook_app(context)
        })
    )
    context.subscriptions.push(
        vscode.commands.registerCommand("pluto.appEngine.openNotebook", async (documentURI, isolated_cell_ids = undefined) => {
            start_notebook_file_app(context, {
                notebook_file_contents: new TextDecoder().decode(await vscode.workspace.fs.readFile(documentURI)),
                isolated_cell_ids: isolated_cell_ids,
            })
        })
    )

    /** This will be available as our `.exports` when this extension is used by another extension, see https://code.visualstudio.com/api/references/vscode-api#extensions. */
    const api = {
        version: 1,
        runNotebookApp: (args: { notebook_file_contents: string; isolated_cell_ids?: string[]; disable_ui?: boolean;[_ignored: string]: any }) =>
            start_notebook_file_app(context, args),
    }

    // let cool_nb =
    //     '### A Pluto.jl notebook ###\n# v0.17.1\n\nusing Markdown\nusing InteractiveUtils\n\n# ╔═╡ 3d0fb1de-8e96-4eed-8563-c91de4786001\n"show me!!!"\n\n# ╔═╡ 3d0fb1de-8e96-4eed-8563-c91de4786002\ndont\' show me\n\n# ╔═╡ Cell order:\n# ╠═3d0fb1de-8e96-4eed-8563-c91de4786001\n# ╠═3d0fb1de-8e96-4eed-8563-c91de4786002'

    // let cool_nb_cell_id = "3d0fb1de-8e96-4eed-8563-c91de4786001"

    // api.runNotebookApp({
    //     notebook_file_contents: cool_nb,
    //     isolated_cell_ids: [cool_nb_cell_id],
    //     disable_ui: true,
    // })

    return api
}

export const LOADING_HTML = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Loading Pluto...</title>
    </head>
    <body style="overflow: hidden;">
        <h1>Loading Pluto...</h1>
    </body>
    </html>
`

// this method is called when your extension is deactivated
export function deactivate() {
    PlutoBackend.deactivate()
}

export const empty_notebook_contents = () => {
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
