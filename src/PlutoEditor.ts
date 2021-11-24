import { v4 as uuid } from "uuid"
import * as vscode from "vscode"
import { setup_pluto_in_webview } from "./setup_webview"
import { get_default_backend } from "./backend"
import { get_status_bar } from "./status_bar"

export class PlutoEditor implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new PlutoEditor(context)
        const providerRegistration = vscode.window.registerCustomEditorProvider(PlutoEditor.viewType, provider)
        return providerRegistration
    }

    private static readonly viewType = "pluto.editor"
    private readonly webviews = new WebviewCollection()
    private readonly uri_to_notebook_id_map = new Map<vscode.Uri, string>()

    public renderStatusBar() {
        let statusbar = get_status_bar()
        statusbar.text = `Pluto: ${this.webviews.notebooksRunning()} 📒`
        statusbar.show()
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Called when our custom editor is opened.
     */
    public async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {
        console.error("startyyy")

        let disposed: boolean = false
        let disposables: vscode.Disposable[] = []

        const currentWebviews = Array.from(this.webviews.get(document.uri))
        const hasMoreWebviews = currentWebviews.length !== 0
        // Get this only once per user's file - UPDATE: persist UUID per URI
        const notebook_id = this.uri_to_notebook_id_map.get(document.uri) ?? uuid()

        this.uri_to_notebook_id_map.set(document.uri, notebook_id)

        const editor_html_filename = `editor_bespoke_${notebook_id}.html`
        const jlfile = `editor_bespoke_${notebook_id}.jl`

        this.webviews.add(document, notebook_id, panel)

        const backend = get_default_backend(this.context.extensionPath)

        let file_change_throttle_delay = 1000

        // throttle to avoid too many file events, and make sure that the file events are processed in order.
        const file_event_listener = sequential_promises_lossy(async (changed_filename: string, f: string) => {
            // TODO:
            // 1. ~Throttle~ DONE
            // 2. Serialize
            // 3. Make more minimal changes (even though Pluto doesn't!)
            //
            if (changed_filename === jlfile) {
                const t = document.getText()
                if (t !== f) {
                    // This will help a bit
                    // use vscode.TextEdit instead!
                    const edit = new vscode.WorkspaceEdit()
                    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), f)
                    let edit_failed = false
                    try {
                        await vscode.workspace.applyEdit(edit)
                    } catch (err) {
                        console.log("Concurrently changed document - trying again in 500ms", err)
                        await delay(500)
                        try {
                            await vscode.workspace.applyEdit(edit)
                        } catch (e) {
                            console.log("Concurrently changed document failed again, giving up", e)
                            edit_failed = true
                        }
                    }
                    // Trigger saving the document in VS Code
                    if (!edit_failed) {
                        try {
                            // console.log("triggering file save without formatting")
                            // await vscode.commands.executeCommand("workbench.action.files.saveWithoutFormatting")
                        } catch (e) {
                            console.log("Failed to trigger file save...", e)
                        }
                    }

                    await delay(file_change_throttle_delay)
                }
                this.renderStatusBar()
            }
        })
        backend.file_events.on("change", file_event_listener)

        // Hook up event handlers so that we can synchronize the webview with the text document.
        //
        // The text document acts as our model, so we have to sync change in the document to our
        // editor and sync changes in the editor back to the document.
        //
        // Remember that a single text document can also be shared between multiple custom
        // editors (this happens for example when you split a custom editor)
        vscode.workspace.onDidSaveTextDocument((doc) => {
            console.log("didsave", panel.active)
            if (doc.uri.toString() === document.uri.toString()) {
                // When VSCode updates the document, notify pluto from here
                backend.send_command("update", { jlfile, text: doc.getText() })
            }
            this.renderStatusBar()
        }, disposables)

        vscode.workspace.onWillRenameFiles((e) => {
            e.files.forEach((v) => {
                const haveWV = Array.from(this.webviews.get(v.oldUri)).length !== 0
                if (haveWV && document.uri === v.oldUri) {
                    this.webviews.changeURI(v.oldUri, v.newUri)
                    this.uri_to_notebook_id_map.set(v.newUri, this.uri_to_notebook_id_map.get(v.oldUri) ?? "")
                    this.webviews.shutdownProtect(v.newUri, "on")
                }
            })
            this.renderStatusBar()
        }, disposables)

        vscode.workspace.onDidRenameFiles((e) => {
            e.files.forEach((v) => {
                const haveWV = Array.from(this.webviews.get(v.oldUri)).length !== 0
                if (haveWV && document.uri === v.oldUri) {
                    this.webviews.changeURI(v.oldUri, v.newUri)
                    this.uri_to_notebook_id_map.delete(v.oldUri)
                    this.webviews.shutdownProtect(v.newUri, "off")
                }
            })
            this.renderStatusBar()
        }, disposables)

        // This should be handled by the last disposal anyway
        vscode.workspace.onWillDeleteFiles((e) => {
            e.files.forEach((uri) => {
                const haveWV = Array.from(this.webviews.get(uri)).length !== 0
                if (haveWV && document.uri === uri) {
                    this.webviews.shutdownProtect(uri, "off")
                }
            })
            this.renderStatusBar()
        }, disposables)

        console.error("asdfasdf")

        // onDidChangeTextDocument,
        // onDidDeleteFiles,
        // onDidSaveTextDocument,
        // onDidRenameFiles (or will, dunno!)

        // Make sure we get rid of the listener when our editor is closed.
        panel.onDidDispose(() => {
            disposed = true
            if (this.webviews.canShutdown(document.uri, 1)) {
                const curi = document.uri
                setTimeout(() => {
                    // Shutdown 10 seconds after last editor closes
                    // This covers many cases where a view is disposed
                    // And another is created immediately
                    // OR the user closes notebook by mistake.
                    if (this.webviews.canShutdown(curi, 0)) backend.send_command("shutdown", { jlfile })
                }, 10000)
            }
            this.webviews.remove(panel)
            backend.file_events.off("change", file_event_listener)
            disposables.forEach((x) => x.dispose())

            this.renderStatusBar()
        })

        console.error("aa")
        const args = {
            panel,
            context: this.context,
            notebook_id,
            editor_html_filename,
            renderStatusBar: () => this.renderStatusBar(),
            backend,
            initialize_notebook: async (extra_details: Object) => {
                const text = document.getText()
                // Send a command to open the file only if there is not a file yet.
                console.error("bb")
                if (!hasMoreWebviews) {
                    await backend.send_command("open", {
                        editor_html_filename,
                        notebook_id,
                        text,
                        jlfile,
                        frontend_params: {
                            // disable_ui: true,
                        },
                        ...extra_details,
                    })
                }
            },
        }
        console.error(args)

        setup_pluto_in_webview(args)
    }
}

class WebviewCollection {
    private readonly _webviews = new Set<{
        readonly document: vscode.TextDocument
        readonly resource: string
        readonly notebook_id: string
        readonly uri: vscode.Uri
        readonly webviewPanel: vscode.WebviewPanel
    }>()

    private readonly _protect = new Set<{
        readonly uri: vscode.Uri
    }>()

    public notebooksRunning() {
        return new Set(Array.from(this._webviews.values()).map(({ notebook_id }) => notebook_id)).size
    }
    public size() {
        return this._webviews.size
    }
    /**
     * VSCode disposes webviews when renaming.
     * Let's prevent the disposal to also shutdown the
     * pluto instance of the notebook
     * */
    public shutdownProtect(uri: vscode.Uri, status: "on" | "off") {
        if (status === "on") {
            return this._protect.add({ uri })
        }
        if (this._protect.has({ uri })) {
            return this._protect.delete({ uri })
        }
    }

    public canShutdown(uri: vscode.Uri, musthavetoshutdown = 1) {
        const isprotected = this._protect.has({ uri })
        const onlyXleft = Array.from(this.get(uri)).length === musthavetoshutdown
        return !isprotected && onlyXleft
    }
    /**
     * Get all known webviews for a given uri.
     */
    public *get(uri: vscode.Uri): Iterable<{
        readonly document: vscode.TextDocument
        readonly resource: string
        readonly uri: vscode.Uri
        readonly notebook_id: string
        readonly webviewPanel: vscode.WebviewPanel
    }> {
        const key = uri.toString()
        for (const entry of this._webviews) {
            if (entry.resource === key) {
                yield entry
            }
        }
    }

    public *getByNotebookID(notebook_id: string): Iterable<{
        readonly document: vscode.TextDocument
        readonly resource: string
        readonly notebook_id: string
        readonly uri: vscode.Uri
        readonly webviewPanel: vscode.WebviewPanel
    }> {
        const key = notebook_id
        for (const entry of this._webviews) {
            if (entry.notebook_id === key) {
                yield entry
            }
        }
    }
    /**
     * Add a new webview to the collection.
     */
    public add(document: vscode.TextDocument, notebook_id: string, webviewPanel: vscode.WebviewPanel) {
        const entry = { document, resource: document.uri.toString(), notebook_id, uri: document.uri, webviewPanel }
        this._webviews.add(entry)

        webviewPanel.onDidDispose(() => {
            this._webviews.delete(entry)
        })
    }

    /**
     * Remove the specific (===) webpanel view from the Webview Collection.
     */
    public remove(webviewPanel: vscode.WebviewPanel) {
        for (const entry of this._webviews) {
            if (entry.webviewPanel === webviewPanel) {
                this._webviews.delete(entry)
            }
        }
    }

    public changeURI(uri: vscode.Uri, newUri: vscode.Uri) {
        const key = uri.toString()
        for (const entry of this._webviews) {
            if (entry.resource === key) {
                this._webviews.delete(entry)
                const newentry = {
                    document: entry.document,
                    resource: newUri.toString(),
                    uri: entry.uri,
                    notebook_id: entry.notebook_id,
                    webviewPanel: entry.webviewPanel,
                }
                this._webviews.add(newentry)
            }
        }
    }
}

let delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wraps around an async function `f`, and returns a sequential version, `g`. Calling `g` will call `f`, and arguments are passed to `f`. If `g` is called another time *while `f` is still running*, it will wait for the last evaluation to finish before calling `f` again.
 *
 * # Throttle example
 * `sequential_promises_lossy` is kind of like a `throttle` function (because it is lossy). In fact, you can use it to create a `throttle` function!
 * ```js
 * const throttle(f, ms) =>
 *   sequential_promises_lossy((...args) => {
 *     f(...args)
 *     // await a promise that resolves after `ms` milliseconds
 *     await new Promise(r => setTimeout(r, ms))
 *   })
 * ```
 */
let sequential_promises_lossy = (f_async: (...args: any[]) => Promise<any>) => {
    // let last = Promise.resolve()

    let busy = false
    let wants_to_run = false
    let args_to_run: any[] = []

    let run = async () => {
        busy = true
        while (wants_to_run) {
            wants_to_run = false
            await f_async(...args_to_run)
        }
        busy = false
    }

    return (...args: any[]) => {
        args_to_run = args
        wants_to_run = true
        if (!busy) {
            run()
        }
    }
}
