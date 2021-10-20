import * as vscode from "vscode"
import * as cp from "child_process"
import * as path from "path"
import * as fs from "fs"
import { v4 as uuid } from "uuid"
import portastic from "portastic"
import _ from "lodash"

type BackendOpts = {
    pluto_asset_dir: string
    vscode_proxy_root: vscode.Uri
}

const get_julia_command = async (): Promise<string> => {
    const julia_extension = vscode.extensions.getExtension("julialang.language-julia")

    if (julia_extension) {
        if (![3, 4].includes(julia_extension.exports.version)) {
            console.error("Not compatible with this version of the julia extension :(")
        }
        try {
            let result = await julia_extension.exports.getJuliaExecutable().getCommand()
            console.warn({ result })
            return result.getCommand()
        } catch (e) {
            console.error("Failed to get Julia launch command from Julia extension :(")
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

    private _status: vscode.StatusBarItem
    private _process?: cp.ChildProcess

    public port: Promise<number>
    public secret: string

    private constructor(context: vscode.ExtensionContext, status: vscode.StatusBarItem, opts: BackendOpts) {
        this._status = status

        console.log("Starting CatalystBackend...")

        this._status.text = "Catalyst: starting..."
        this._status.show()
        this.secret = uuid()
        // find a free port, some random sampling to make collisions less likely
        this.port = portastic.find({ min: 9000, retrieve: 10 }).then((r) => _.sample(r) ?? 23047)

        // hack to let me write async code inside the constructor
        Promise.resolve().then(async () => {
            const args = [opts.pluto_asset_dir, String(opts.vscode_proxy_root), String(await this.port), this.secret]

            const julia_cmd = await get_julia_command()
            console.log({ julia_cmd })
            this._process = cp.spawn(julia_cmd, ["--project=.", "run.jl", ...args], {
                cwd: path.join(context.extensionPath, "julia-runtime"),
            })

            this._process.on("exit", (code) => {
                console.log(`CatalystBackend exited with code ${code}`)
                this._status.text = "Catalyst: stopped"
                this._status.show()
            })
            this._process!.stdout!.on("data", (data) => {
                console.log(`📄${data.slice(0, data.length - 1)}`)
            })
            this._process!.stderr!.on("data", (data) => {
                console.log(`📈${data.slice(0, data.length - 1)}`)

                // @info prints to stderr
                // First message includes port

                this._status.text = "Catalyst: active"
                this._status.show()
            })
        })
    }

    public destroy() {
        this._status.hide()
        this._process?.kill()
        PlutoBackend._instance = null

        this._status.text = "Catalyst: killing..."
        this._status.show()
    }
}

function getNonce() {
    let text = ""
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
}
