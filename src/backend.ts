import * as vscode from "vscode"
import * as http from "http"
import * as cp from "child_process"
import * as path from "path"
import { v4 as uuid } from "uuid"
import portastic from "portastic"
import _ from "lodash"
import { decode_base64_to_string } from "./encoding"
import { EventEmitter } from "events"
import { get_status_bar } from "./status_bar"
import { pluto_asset_dir } from "./setup_webview"
import { PLUTO_BRANCH_NAME } from "./extension"

export const get_default_backend = (extensionPath: string) => {
    return PlutoBackend.create_async(extensionPath, {
        pluto_asset_dir,
        pluto_config: {
            // workspace_use_distributed: false,
        },
    })
}

type BackendOpts = {
    pluto_asset_dir: string
    /** These properties correspond to keyword arguments to `Pluto.run`. e.g. `{ workspace_use_distributed: false, auto_reload_from_file: true }` */
    pluto_config?: Object
}

/** This code launches the Pluto runner (julia-runtime/run.jl) and keeps a connection with it. Communication happens over stdin/stdout, with JSON. You can use `send_command` to say something to the Pluto runner. */
export class PlutoBackend {
    private static _instance: PlutoBackend | null = null
    public static create_async(extensionPath: string, opts: BackendOpts) {
        if (PlutoBackend._instance) {
            return PlutoBackend._instance
        }

        PlutoBackend._instance = new PlutoBackend(extensionPath, opts)
        return PlutoBackend._instance
    }

    public static deactivate() {
        if (PlutoBackend._instance) {
            PlutoBackend._instance.destroy()
        }
    }
    public static hasInstance() {
        return !!PlutoBackend._instance
    }

    /** Send a command to the Pluto runner. This should be a message type (`string`) together with any JSON-serializable object for the message body.
     *
     * It is sent over stdout/stdin, and handled by `julia-runtime/run.jl`.
     */
    public send_command(type: string, detail: Object = {}) {
        this._process!.stdin!.write(
            JSON.stringify({
                type,
                detail,
            }) + "\0"
        )
    }

    private _status: vscode.StatusBarItem
    private _process?: cp.ChildProcess
    private _server?: http.Server
    private _opts?: BackendOpts
    public working_directory: string

    public port: Promise<number>
    public localport: Promise<number>
    public secret: string

    public ready: Promise<boolean>

    public file_events: EventEmitter

    private constructor(extensionPath: string, opts: BackendOpts) {
        this._status = get_status_bar()
        this._opts = opts
        console.log("Starting PlutoBackend...")
        this.working_directory = path.join(extensionPath, "julia-runtime")

        this._status.text = "Pluto: starting..."
        this._status.show()
        this.secret = uuid()
        // find a free port, some random sampling to make collisions less likely
        this.port = portastic.find({ min: 9000, retrieve: 10 }).then((r) => _.sample(r) ?? 23050)
        this.localport = portastic.find({ min: 22000, retrieve: 10 }).then((r) => _.sample(r) ?? 23051)
        let resolve_ready = (x: boolean) => { }
        this.ready = new Promise<boolean>((r) => {
            resolve_ready = r
        })
        this.file_events = new EventEmitter()

        // hack to let me write async code inside the constructor
        Promise.resolve().then(async () => {
            let conf = vscode.workspace.getConfiguration()
            // console.log(conf)
            let r = (a: any, b: any) => (a ? a : b)

            let branch = r(conf.get("pluto.plutoBranch"), PLUTO_BRANCH_NAME)
            let repo_url = r(conf.get("pluto.plutoRepositoryUrl"), "")

            const args = [opts.pluto_asset_dir, String(await this.port), this.secret, JSON.stringify(opts.pluto_config ?? {}), String(branch), String(repo_url), String(await (this.localport))]

            const julia_cmd = await get_julia_command()
            console.log({ julia_cmd })
            this._process = cp.spawn(julia_cmd, ["run.jl", ...args], {
                cwd: this.working_directory,
            })

            this._process.on("exit", (code) => {
                console.log(`PlutoBackend exited with code ${code}`)
                this._status.text = "Pluto: stopped"
                this._status.show()
            })

            const messageHandler = (data: String) => {
                if (data.includes("Command: [[Notebook=")) {
                    const jlfile = data
                        .slice(data.indexOf("=") + 1, data.indexOf("]]"))
                        .toString()
                        .trim()
                    const dataString = data.toString()
                    const notebookString = dataString.substr(dataString.indexOf("## ") + 3).trim()
                    const decoded = decode_base64_to_string(notebookString)
                    // Let listeners know the file changed
                    this.file_events.emit("change", jlfile, decoded)
                } else {
                    console.log(data)
                }
            }
            this._server = http.createServer((req, res) => {
                let data = '';
                req.on('data', chunk => {
                    data += chunk;
                })
                req.on('end', () => {
                    messageHandler(data)
                    res.end();
                })
            })
            this._server.listen(await this.localport);

            this._process.stdout!.on("data", (data) => {
                const text = data.slice(0, data.length - 1)

                console.log(`📈${text}`)
            })

            this._process.stderr!.on("data", (data) => {
                const text = data.slice(0, data.length - 1)

                console.log(`📈${text}`)
                // @info prints to stderr
                if (text.includes("READY FOR COMMANDS")) {
                    resolve_ready(true)
                    this._status.text = "Pluto: active"
                    this._status.show()
                }
            })
        })
    }

    public destroy() {
        this._status.hide()
        this._process?.kill()
        PlutoBackend._instance = null
        this._server?.close?.()
        this._status.text = "Pluto: killing..."
        this._status.show()
    }
}

/** Get the command to launch Julia. We try to get it from the `julia-vscode` extension if possible. */
const get_julia_command = async (): Promise<string> => {
    const julia_extension = vscode.extensions.getExtension("julialang.language-julia")

    if (julia_extension) {
        if (![3, 4].includes(julia_extension.exports.version)) {
            console.error("Not compatible with this version of the julia extension :(")
        }
        try {
            let result = await julia_extension.exports.getJuliaPath()
            console.warn({ result })
            return result
        } catch (e) {
            console.error("Failed to get Julia launch command from Julia extension :(", e)
        }
    }
    console.error("Fallback: using `julia` command to launch julia.")
    return "julia"
}
