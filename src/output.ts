import * as vscode from 'vscode';

export class TelepresenceOutput {
    private static instance: vscode.OutputChannel;

    public static getChannel(): vscode.OutputChannel {
        if (!TelepresenceOutput.instance) {
            TelepresenceOutput.instance = vscode.window.createOutputChannel('Telepresence');
        }
        return TelepresenceOutput.instance;
    }
}
