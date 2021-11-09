# pluto-vscode
Pluto inside a VS Code Webview, WIP. **You currently need some command line skills to be able to run this.**

This extension will automatically:
- Launch the Pluto server for you
- Proxy Pluto's assets through VS Code
- Proxy the websocket connection through VS Code
- (TODO) Detect Pluto files and offer to run them

Proxying the communication through VS Code means that this extension works inside Remote SSH, GitHub Codespaces & JuliaHub. ([tested and it works!](https://user-images.githubusercontent.com/6933510/138145177-f06e5d47-718d-4796-b0f7-b2c2b60224b7.png))


https://user-images.githubusercontent.com/6933510/134571646-cca5239a-1edf-48ab-b2a2-7828df79c002.mov

## Step 1: Set up Julia

1. Install Julia (1.5 - 1.7) and the Julia VS Code extension.
2. Install the `vscode-webview-proxy` branch of Pluto in your global package env, either using git and `pkg (v1.6)> dev folder/to/Pluto.jl` or `pkg (v1.6)> add Pluto#vscode-webview-proxy`. *This step will be automated in the future.*

## Step 2: Now for the extension

If you are **developing** this extension:
1. `pkg (v1.6)> add BetterFileWatching` if you are developing this extension
1. Install node and npm
4. Open the folder in VS Code
4. Open the terminal and `npm install`
4. Go to Run > Start Debugging (`F5`)

If you just want to **run** the extension:
1. Download the `.vsix` file from the repository.
1. Launch VS Code
1. `Cmd+Shift+P` and run `Extensions: Install from VSIX...`, select the VSIX file

## Step 3: How to use
Inside the VS Code editor running the extension:

1. `Cmd+Shift+P` and run `Pluto: Start new notebook`
8. While waiting (max 60 seconds), `Cmd+Shift+P` and run `Developer: Open WebView Developer Tools`

---

To generate the `.vsix` file:
1. Install `vsce`
1. `npm install --include=dev`
1. `vsce package`


# How it works

This extension runs the normal Pluto server, and we use a *VS Code Webview* to display the (mostly) normal Pluto frontend inside VS Code! 

> 🙋 You should read https://code.visualstudio.com/api/extension-guides/webview before working on this extension.

The main differences between using `pluto-vscode` and using Pluto the normal way are:
- This extension will (install and) **launch Pluto for you**. It will use the `julia-vscode` extension to get the Julia executable, which means that the entire process until you see the notebook is handled by the extension.
- Normally, the Pluto server opens a **websocket** connection with every client. In the VS Code setup, we use the **proxy provided by VS Code** instead, so that we don't have to set up proxies and tunnels for our WS connection. This gives us all the benefits of the VS Code philosophy: we write the extension once using VS Code API, and then VS Code lets people run it locally, over SSH, on github.dev, on JuliaHub, and more!
- (Future) Notebook **file management is handled by the VS Code extension**, not by Pluto's UI. This means that people use the file manager and file GUI that comes with VS Code to manage notebook files. Again, this has the benefit that it will automatically work on all ways that VS Code works. 

## The proxy

There are 4 types of players in the pluto-vscode dance:

- **The Pluto frontends**: These are running inside webviews, viewing and editing notebooks. They use VS Code API to connect with the extension. Running in ES2020 browser, source code is https://github.com/fonsp/Pluto.jl/pull/1493

- **The extension**: This handles communication between all the other players, and talks with VS Code. Running in silly Node.js, source code is all `.ts` files in `src/`.

- **The Pluto runner**: A small script that imports Pluto and runs it. It also listens to `stdin` for instructions coming from the extension, to open/stop notebooks and to generate files. Running in beautiful but slow Julia, source code is in `julia-runtime/run.jl`.

- **The Pluto server**: This is the normal Pluto backend, mostly unchanged, ran by our runner. It runs a websocket server, it thinks that it is talking to the browser, but it is actually going through our extension! Running in why-does-it-not-run-in-wasm-Julia, source code is https://github.com/fonsp/Pluto.jl/pull/1493


Now, the extension (running in Node.js) is *pretending* to be a browser-based Pluto client, talking over WS with the Pluto server. We just copied the WS client code from Pluto into the extension (and converted it to work inside Node.js 😑), this is `src/julia-ws-connection.ts`. 

All the messages that it receives are passed along to the actual frontends, running inside webview. Conversely, any messages from the webview are passed along to the Pluto server by the extension.

Communication between extension and Pluto server happens with the normal WebSocket code from Pluto (which works, because the extension and the Pluto server are always running on the same computer), communication between extension and webviews happens with [official VS Code API: `WebView.postMessage` and `WebView.onDidReceiveMessage`](https://code.visualstudio.com/api/references/vscode-api#Webview).
