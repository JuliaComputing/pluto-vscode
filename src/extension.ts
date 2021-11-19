import * as vscode from "vscode"
import { PlutoBackend } from "./backend"
import { PlutoEditor } from "./PlutoEditor"
import { TextDecoder, TextEncoder } from "util"
import { v4 as uuid } from "uuid"

/*
HELLO

This file is the entry point of the extension. The important function here is `new_notebook`.
*/

export function activate(context: vscode.ExtensionContext) {
    console.log("Activating extension pluto-vscode")
    context.subscriptions.push(PlutoEditor.register(context))
    context.subscriptions.push(
        vscode.commands.registerCommand("plutoEditor.start", () => {
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
                        vscode.commands.executeCommand("vscode.openWith", path, "plutoEditor")
                    }
                })

            // OTHER ATTEMPS

            // THIS ONE almost works, but when you do the first Ctrl+S, it does not automatically add the .jl extension
            // const filename = vscode.Uri.parse("untitled:untitled-1.jl")
            // vscode.workspace.fs.writeFile(filename, new TextEncoder().encode(empty_notebook_contents())).then(() => {
            // vscode.commands.executeCommand("vscode.openWith", filename, "plutoEditor")
            // })

            // ALSO CLOSE and the most official, but it opens the window twice, once in Pluto, once in a text editor.
            // vscode.workspace
            //     .openTextDocument({
            //         content: empty_notebook_contents(),
            //         language: "julia",
            //     })
            //     .then(async (document) => {
            //         const to_close = vscode.workspace.textDocuments.filter((d) => d === document)

            //         await vscode.commands.executeCommand("vscode.openWith", document.uri, "plutoEditor")
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
        vscode.commands.registerCommand("plutoEditor.openCurrentWith", (selectedDocumentURI) => {
            vscode.commands.executeCommand("vscode.openWith", selectedDocumentURI, "plutoEditor")
        })
    )
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
