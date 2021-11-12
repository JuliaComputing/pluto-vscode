import { accessSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { v4 } from 'uuid';
import * as vscode from 'vscode';
import { PlutoBackend } from './backend';
import { getWebviewOptions, getNonce, LOADING_HTML } from './extension';
import { create_proxy } from './ws-proxy';

/**
 * Provider for cat scratch editors.
 * 
 * Cat scratch editors are used for `.cscratch` files, which are just json files.
 * To get started, run this extension and open an empty `.cscratch` file in VS Code.
 * 
 * This provider demonstrates:
 * 
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Synchronizing changes between a text document and a custom editor.
 */
export class PlutoEditor implements vscode.CustomTextEditorProvider {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new PlutoEditor(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(PlutoEditor.viewType, provider);
		return providerRegistration;
	}

	private static readonly viewType = 'plutoView';
	private readonly pluto_asset_dir = join(tmpdir(), getNonce())
	private readonly webviews = new WebviewCollection();

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	/**
	 * Called when our custom editor is opened.
	 * 
	 * 
	 */
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial content for the webview
		webviewPanel.webview.options =
			getWebviewOptions(this.context.extensionUri, this.pluto_asset_dir)

		const currentWebviews = Array.from(this.webviews.get(document.uri))
		const hasMoreWebviews = currentWebviews.length !== 0
		// Get this only once per user's file
		const uuidv4 = hasMoreWebviews ? currentWebviews[0].uuidv4 : v4()
		const editor_html_filename = `editor_bespoke_${uuidv4}.html`
		const jlfile = `editor_bespoke_${uuidv4}.jl`

		this.webviews.add(document, uuidv4, webviewPanel);
		webviewPanel.webview.html = LOADING_HTML;

		let disposed: boolean = false
		let disposables: vscode.Disposable[] = []

		const set_html = (title: string, contents: string) => {
			webviewPanel.title = title
			webviewPanel.webview.html = contents
		}

		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1)
		const backend = PlutoBackend.create(this.context, statusBarItem, {
			pluto_asset_dir: this.pluto_asset_dir,
			/**
			 * VERY important implementation detail:
			 * This function gets instanciated only the _first_ time the 
			 * pluto editor runs.
			 * 
			 * That means, the code must *not* create closures around the
			 * initial context because subsequent webviews do not apply.
			 * 
			 * we use this.webviews.getByUUID for this exact reason.
			 * 
			 */
			on_filechange: (file: string, f: string) => {
				// TODO: 
				// 1. Throttle
				// 2. Serialize
				// 3. Make more minimal changes (even though Pluto doesn't!)
				//
				const uuidv4 = file.replace("editor_bespoke_", "").replace(".jl", "")
				const webviewsForFile = Array.from(this.webviews.getByUUID(uuidv4))
				if (webviewsForFile.length === 0) {
					return
				}
				const [{ document, uri }] = webviewsForFile
				const t = document.getText()
				if (t !== f) { // This will help a bit
					// use vscode.TextEdit instead!
					const edit = new vscode.WorkspaceEdit();
					edit.replace(
						uri,
						new vscode.Range(0, 0, document.lineCount, 0),
						f)
					try {
						vscode.workspace.applyEdit(edit)
					} catch (err) {
						console.log("Concurrently changed document - trying again in 500ms", err)
						setTimeout(() => vscode.workspace.applyEdit(edit), 500)
					}
				}
			},
			vscode_proxy_root: webviewPanel.webview.asWebviewUri(vscode.Uri.file(this.pluto_asset_dir)),
			pluto_config: {
				// workspace_use_distributed: false,
			},
		})

		// Hook up event handlers so that we can synchronize the webview with the text document.
		//
		// The text document acts as our model, so we have to sync change in the document to our
		// editor and sync changes in the editor back to the document.
		// 
		// Remember that a single text document can also be shared between multiple custom
		// editors (this happens for example when you split a custom editor)

		const changeDocumentSubscription = vscode.workspace.onDidSaveTextDocument(doc => {
			if (doc.uri.toString() === document.uri.toString()) {
				// When VSCode updates the document, notify pluto from here	
				backend.send_command("update", { jlfile, text: doc.getText() })
			}
		});

		const renameDocumentSubscription = vscode.workspace.onWillRenameFiles((e) => {
			e.files.forEach(v => {
				const haveWV = Array.from(this.webviews.get(v.oldUri)).length !== 0
				if (haveWV) {
					this.webviews.changeURI(v.oldUri, v.newUri)
				}
			})
		})

		// onDidChangeTextDocument, 
		// onDidDeleteFiles,
		// onDidSaveTextDocument,
		// onDidRenameFiles (or will, dunno!)

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			disposed = true
			const others = Array.from(this.webviews.get(document.uri)).filter(c => c.webviewPanel !== webviewPanel)
			if (others.length === 0) {
				backend.send_command("shutdown", { jlfile })
			}
			changeDocumentSubscription.dispose();
			renameDocumentSubscription.dispose();
		});

		backend.ready.then(async () => {
			// TODO: Something with the document's URI here. Same files should get the same html.
			// TODO: Use the same file for the same URI. 
			// TODO: Sync file??
			const text = document.getText()
			// Send a command to open the file only if there exist
			if (!hasMoreWebviews)
				backend.send_command("open", {
					editor_html_filename,
					text,
					jlfile,
					frontend_params: {
						// disable_ui: true,
					},
				})
			else
				console.log("Second UI reusing existing connection!")
			const handler = setInterval(() => {
				try {
					console.log("checking file existence!")
					accessSync(join(this.pluto_asset_dir, editor_html_filename))
					console.log("file exists!")

					setTimeout(async () => {
						const contents = readFileSync(join(this.pluto_asset_dir, editor_html_filename), {
							encoding: "utf8",
						})

						console.log("Creating proxy...")
						await create_proxy({
							ws_address: `ws://localhost:${await backend.port}/?secret=${backend.secret}`,
							send_to_client: (x: any) => {
								// TODO: the fact that this is called when disposed
								// means we're memory leaking. Fix that!
								if (!disposed) {
									return webviewPanel.webview.postMessage(x)
								}
							},
							create_client_listener: (f: any) => {
								webviewPanel.webview.onDidReceiveMessage(f, null, disposables)
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
					}, 50)

					clearInterval(handler)
				} catch (e) {
					//
				}
			}, 200)

		})
	}

	/**
	 * Write out the json to a given document.
	 */
	private updateTextDocument(document: vscode.TextDocument, json: any) {
		const edit = new vscode.WorkspaceEdit();

		// Just replace the entire document every time for this example extension.
		// A more complete extension should compute minimal edits instead.
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			JSON.stringify(json, null, 2));

		return vscode.workspace.applyEdit(edit);
	}
}


class WebviewCollection {

	private readonly _webviews = new Set<{
		readonly document: vscode.TextDocument;
		readonly resource: string;
		readonly uuidv4: string;
		readonly uri: vscode.Uri;
		readonly webviewPanel: vscode.WebviewPanel;
	}>();

	/**
	 * Get all known webviews for a given uri.
	 */
	public *get(uri: vscode.Uri): Iterable<{
		readonly document: vscode.TextDocument;
		readonly resource: string;
		readonly uri: vscode.Uri;
		readonly uuidv4: string;
		readonly webviewPanel: vscode.WebviewPanel;
	}> {
		const key = uri.toString();
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				yield entry;
			}
		}
	}

	public *getByUUID(uuid: string): Iterable<{
		readonly document: vscode.TextDocument;
		readonly resource: string;
		readonly uuidv4: string;
		readonly uri: vscode.Uri;
		readonly webviewPanel: vscode.WebviewPanel;
	}> {
		const key = uuid;
		for (const entry of this._webviews) {
			if (entry.uuidv4 === key) {
				yield entry;
			}
		}
	}
	/**
	 * Add a new webview to the collection.
	 */
	public add(document: vscode.TextDocument, uuidv4: string, webviewPanel: vscode.WebviewPanel) {
		const entry = { document, resource: document.uri.toString(), uuidv4, uri: document.uri, webviewPanel };
		this._webviews.add(entry);

		webviewPanel.onDidDispose(() => {
			this._webviews.delete(entry);
		});
	}

	/**
	 * Remove all webviews that are associated with this URI.
	 */
	public remove(uri: vscode.Uri) {
		const key = uri.toString()
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				this._webviews.delete(entry);
			}
		}
	}

	public changeURI(uri: vscode.Uri, newUri: vscode.Uri) {
		const key = uri.toString()
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				this._webviews.delete(entry);
				const newentry = { document: entry.document, resource: newUri.toString(), uri: entry.uri, uuidv4: entry.uuidv4, webviewPanel: entry.webviewPanel };
				this._webviews.add(newentry)
			}
		}
	}
}