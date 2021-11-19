import * as vscode from "vscode"

let instance: vscode.StatusBarItem | null = null

export const get_status_bar = () => {
    instance = instance ?? vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1)
    return instance
}
