import * as vscode from 'vscode';

export class TelepresenceOutput {
    private static instance: vscode.OutputChannel;
    private static debugMode: boolean = false;
    public static getChannel(): vscode.OutputChannel {
        if (!TelepresenceOutput.instance) {
            TelepresenceOutput.instance = vscode.window.createOutputChannel('Telepresence');
        }
        return TelepresenceOutput.instance;
    }
    // Append a line to the output channel including a timestamp
    public static appendLine(message: string, required: boolean = false): void {
        if(required || TelepresenceOutput.debugMode) {
            const timestamp = new Date().toISOString();
            const formattedMessage = `[${timestamp}] ${message}`;
            TelepresenceOutput.getChannel().appendLine(formattedMessage);
        }
    }
}
