# pluto-vscode
Pluto inside a VS Code Webview, WIP. **You currently need some nodejs/npm skills to be able to run this, we don't ship a prebuilt extension yet.**

This extension will automatically:
- Launch the Pluto server for you
- Proxy Pluto's assets through VS Code
- Proxy the websocket connection through VS Code
- (TODO) Detect Pluto files and offer to run them

Proxying the communication through VS Code means that this extension works inside Remote SSH, GitHub Codespaces & JuliaHub. ([tested and it works!](https://user-images.githubusercontent.com/6933510/138145177-f06e5d47-718d-4796-b0f7-b2c2b60224b7.png))


https://user-images.githubusercontent.com/6933510/134571646-cca5239a-1edf-48ab-b2a2-7828df79c002.mov

Instructions:
1. Install Julia (1.5 - 1.7) and make sure the `julia` shell command launches it.
2. Install the `vscode-webview-proxy` branch of Pluto, either using git and `pkg> dev folder/to/Pluto.jl` or `pkg> add Pluto#vscode-webview-proxy`.
3. `pkg> add BetterFileWatching` for a nicer dev experience

Now for the extension:

4. Install node and npm
4. Open the folder in VS Code
4. Open the terminal and `npm install`
4. Go to Run > Start Debugging (`F5`)

Inside the VS Code editor that launched:

8. `Cmd+Shift+P` and run `Pluto: Start new notebook`
8. While waiting (max 60 seconds), `Cmd+Shift+P` and run `Developer: Open WebView Developer Tools`

To generate the `.vsix` file:
1. Install `vsce`
1. `npm install --include=dev`
1. `vsce package`
