import * as vscode from "vscode"
import { v4 as uuid } from "uuid"
import { setup_pluto_in_webview, getWebviewOptions } from "./setup_webview"
import { get_default_backend } from "./backend"
import { LOADING_HTML, empty_notebook_contents } from "./extension"

const viewType = "plutoEditor"

export const start_empty_notebook_app = (context: vscode.ExtensionContext, args: { disable_ui?: boolean } = {}) => {
    return start_notebook_file_app(context, {
        notebook_file_contents: empty_notebook_contents(),
        ...args,
    })
}

export const start_notebook_file_app = (
    context: vscode.ExtensionContext,
    args: { notebook_file_contents: string; disable_ui?: boolean; isolated_cell_ids?: string[] }
) => {
    const { notebook_file_contents, disable_ui, isolated_cell_ids } = args

    start_app_engine(context, {
        notebook_file_contents,
        frontend_params: {
            disable_ui: disable_ui ? disable_ui : undefined,
            isolated_cell_ids_js: isolated_cell_ids ? JSON.stringify(isolated_cell_ids) : undefined,
        },
    })
}

/**
 * Start running a new notebook, create a new panel, set up the WebSocket proxy, show the notebook in the panel.
 */
const start_app_engine = (context: vscode.ExtensionContext, args: { notebook_file_contents: string; frontend_params?: Object }) => {
    console.info("Launching Pluto panel!")

    /** Where should the panel appear? */
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    // Create a new panel. This `WebviewPanel` object has lots of functionality, see https://code.visualstudio.com/api/references/vscode-api#WebviewPanel and the `.webview` property: https://code.visualstudio.com/api/references/vscode-api#Webview
    const panel = vscode.window.createWebviewPanel(viewType, "Loading Pluto...", column || vscode.ViewColumn.One, getWebviewOptions(context.extensionUri))

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
    const set_html = (title: string, notebook_file_contents: string) => {
        panel.title = title
        panel.webview.html = notebook_file_contents
    }

    // Set the webview's initial html content
    set_html("Loading Pluto...", LOADING_HTML)

    // Start creating a `backend`, i.e. start running the `julia-runtime/run.jl` script.
    const backend = get_default_backend(context.extensionPath)

    const notebook_id = uuid()
    const editor_html_filename = `editor_bespoke_${notebook_id}.html`
    const jlfile = `editor_bespoke_${notebook_id}.jl`

    console.log("frontend params: ", args.frontend_params ?? {})
    setup_pluto_in_webview({
        panel,
        context,
        notebook_id,
        editor_html_filename,
        renderStatusBar: () => {}, // TODO
        backend,
        initialize_notebook: async (extra_details: Object) => {
            await backend.send_command("open", {
                editor_html_filename,
                notebook_id,
                text: args.notebook_file_contents,
                jlfile,
                frontend_params: args.frontend_params ?? {},
                ...extra_details,
            })
        },
    })
}
