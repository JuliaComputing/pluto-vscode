import * as vscode from "vscode"
import * as cp from "child_process"
import * as path from "path"
import { v4 as uuid } from "uuid"
import portastic from "portastic"
import _ from "lodash"
import { decode_base64_to_string } from "./encoding"

type BackendOpts = {
    pluto_asset_dir: string
    vscode_proxy_root: vscode.Uri
    on_filechange: Function
    pluto_config?: Object
}

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

export class PlutoBackend {
    private static _instance: PlutoBackend | null = null
    public static create(context: vscode.ExtensionContext, status: vscode.StatusBarItem, opts: BackendOpts) {
        if (PlutoBackend._instance) {
            return PlutoBackend._instance
        }

        PlutoBackend._instance = new PlutoBackend(context, status, opts)
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

    public port: Promise<number>
    public secret: string

    public ready: Promise<boolean>

    private constructor(context: vscode.ExtensionContext, status: vscode.StatusBarItem, opts: BackendOpts) {
        this._status = status
        this._opts = opts
        console.log("Starting PlutoBackend...")

        this._status.text = "Pluto: starting..."
        this._status.show()
        this.secret = uuid()
        // find a free port, some random sampling to make collisions less likely
        this.port = portastic.find({ min: 9000, retrieve: 10 }).then((r) => _.sample(r) ?? 23047)

        let resolve_ready = (x: boolean) => { }
        this.ready = new Promise<boolean>((r) => {
            resolve_ready = r
        })
        // hack to let me write async code inside the constructor
        Promise.resolve().then(async () => {
            const args = [opts.pluto_asset_dir, String(opts.vscode_proxy_root), String(await this.port), this.secret, JSON.stringify(opts.pluto_config ?? {})]

            const julia_cmd = await get_julia_command()
            console.log({ julia_cmd })
            this._process = cp.spawn(julia_cmd, ["--project=.", "run.jl", ...args], {
                cwd: path.join(context.extensionPath, "julia-runtime"),
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
                if (text.includes("File update event ## ")) {
                    const notebookString = data.slice(data.indexOf("## "), data.indexOf("###") - data.indexOf("## ")).toString()
                    console.log("Notebook updated!", notebookString.substr(0, 10))
                    // Let VSCode know the file changed
                    this._opts?.on_filechange?.(decode_base64_to_string(notebookString))
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
