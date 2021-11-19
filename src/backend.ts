import * as vscode from "vscode"
import * as cp from "child_process"
import * as path from "path"
import { v4 as uuid } from "uuid"
import portastic from "portastic"
import _ from "lodash"
import { decode_base64_to_string } from "./encoding"
import { readdirSync, unlinkSync } from "fs"

import { EventEmitter } from "events"

type BackendOpts = {
    pluto_asset_dir: string
    /** These properties correspond to keyword arguments to `Pluto.run`. e.g. `{ workspace_use_distributed: false, auto_reload_from_file: true }` */
    pluto_config?: Object
}

/** This code launches the Pluto runner (julia-runtime/run.jl) and keeps a connection with it. Communication happens over stdin/stdout, with JSON. You can use `send_command` to say something to the Pluto runner. */
export class PlutoBackend {
    private static _instance: PlutoBackend | null = null
    public static create_async(extensionPath: string, status: vscode.StatusBarItem, opts: BackendOpts) {
        if (PlutoBackend._instance) {
            return PlutoBackend._instance
        }

        PlutoBackend._instance = new PlutoBackend(extensionPath, status, opts)
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
    private _opts?: BackendOpts
    public working_directory: string

    public port: Promise<number>
    public secret: string

    public ready: Promise<boolean>

    public file_events: EventEmitter

    private constructor(extensionPath: string, status: vscode.StatusBarItem, opts: BackendOpts) {
        this._status = status
        this._opts = opts
        console.log("Starting PlutoBackend...")
        this.working_directory = path.join(extensionPath, "julia-runtime")

        this._status.text = "Pluto: starting..."
        this._status.show()
        this.secret = uuid()
        // find a free port, some random sampling to make collisions less likely
        this.port = portastic.find({ min: 9000, retrieve: 10 }).then((r) => _.sample(r) ?? 23047)

        let resolve_ready = (x: boolean) => {}
        this.ready = new Promise<boolean>((r) => {
            resolve_ready = r
        })
        this.file_events = new EventEmitter()

        // hack to let me write async code inside the constructor
        Promise.resolve().then(async () => {
            const args = [opts.pluto_asset_dir, String(await this.port), this.secret, JSON.stringify(opts.pluto_config ?? {})]

            const julia_cmd = await get_julia_command()
            console.log({ julia_cmd })
            this._process = cp.spawn(julia_cmd, ["--project=.", "run.jl", ...args], {
                cwd: this.working_directory,
            })

            this._process.on("exit", (code) => {
                console.log(`PlutoBackend exited with code ${code}`)
                this._status.text = "Pluto: stopped"
                this._status.show()
            })
            this._process.stdout!.on("data", (data) => {
                console.log(`📄${data.slice(0, data.length - 1)}`)
                console.log(JSON.parse(data.slice(0, data.length - 1)))
            })
            this._process.stderr!.on("data", (data) => {
                const text = data.slice(0, data.length - 1)
                // TODO: Generalize this for more message types to be added
                if (text.includes("Command: [[Notebook=")) {
                    const jlfile = data
                        .slice(data.indexOf("=") + 1, data.indexOf("]]"))
                        .toString()
                        .trim()
                    console.log("jlfile", jlfile)
                    const dataString = data.toString()
                    const notebookString = dataString.substr(dataString.indexOf("## ") + 3).trim()
                    const decoded = decode_base64_to_string(notebookString)
                    console.log("Notebook updated!", decoded.substring(0, 100))
                    // Let listeners know the file changed
                    this.file_events.emit("change", jlfile, decoded)
                    return
                }

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
