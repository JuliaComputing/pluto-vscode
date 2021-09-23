# pluto-vscode
Pluto inside a VS Code Webview, WIP

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
