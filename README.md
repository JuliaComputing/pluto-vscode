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
