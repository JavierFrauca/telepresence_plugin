import * as vscode from 'vscode';
import { TelepresenceManager } from './telepresenceManager';
import { WebviewMessageHandler } from './webview/messageHandler';
import { WebviewHtmlGenerator } from './webview/assets/gui/htmlGUI';
import { KubernetesManager } from './kubernetesManager';
import { TelepresenceOutput } from './output';
import { i18n } from './i18n/localizationManager';
import { ErrorMessage } from './webview/types';

/**
 * Webview provider for the Telepresence interface
 * Coordinates HTML generation and message handling
 */
export class TelepresenceWebviewProvider {
    private messageHandler: WebviewMessageHandler;
    private htmlGenerator: WebviewHtmlGenerator;
    private outputChannel: vscode.OutputChannel;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly telepresenceManager: TelepresenceManager,
        private readonly kubernetesManager: KubernetesManager
    ) {
        this.messageHandler = new WebviewMessageHandler(telepresenceManager, kubernetesManager);
        this.htmlGenerator = new WebviewHtmlGenerator(extensionUri);
        this.outputChannel = TelepresenceOutput.getChannel();
    }

    /**
     * Sets up and initializes the webview
     * @param webview - VS Code webview instance
     */
    public setupWebview(webview: vscode.Webview): void {
        try {
            // Configure webview options
            webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    this.extensionUri,
                    vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'assets')
                ]
            };

            // Generate HTML content
            webview.html = this.htmlGenerator.getWebviewContent(webview);

            // Set up message handling
            webview.onDidReceiveMessage(async (message) => {
                try {
                    await this.messageHandler.handleMessage(message, webview);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.outputChannel.appendLine(`[Telepresence] Error handling webview message: ${errorMessage}`);
                    
                    // Send error message to webview
                    const errorResponse: ErrorMessage = {
                        type: 'error',
                        message: i18n.localize('webviewProvider.setup.internalServerError'),
                        details: errorMessage
                    };
                    webview.postMessage(errorResponse);
                }
            });

            // Inicializar datos del webview
            this.messageHandler.initializeWebview(webview);

            // this.outputChannel.appendLine('[Telepresence] ✅ Webview configurado correctamente'); // Verbose, omit
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[Telepresence] Error setting up webview: ${errorMessage}`);
            vscode.window.showErrorMessage(`Error setting up Telepresence GUI: ${errorMessage}`);
        }
    }
}