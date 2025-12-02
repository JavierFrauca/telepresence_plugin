import * as vscode from 'vscode';
import { TelepresenceManager, TelepresenceSession, TelepresenceStatusSnapshot } from '../telepresenceManager';
import { KubernetesManager } from '../kubernetesManager';
import { TelepresenceOutput } from '../output';
import { i18n } from '../i18n/localizationManager';
import {
    WebviewMessage,
    ConnectNamespaceMessage,
    DisconnectNamespaceMessage,
    InterceptTrafficMessage,
    DisconnectInterceptionMessage,
    DisconnectAllInterceptionsMessage,
    GetNamespacesMessage,
    GetDeploymentsMessage,
    CheckPrerequisitesMessage,
    GetTelepresenceStatusMessage,
    WebviewLoadedMessage
} from './types';

export class WebviewMessageHandler {
    constructor(
        private readonly telepresenceManager: TelepresenceManager,
        private readonly kubernetesManager: KubernetesManager
    ) {}

    async handleMessage(message: WebviewMessage, webview: vscode.Webview): Promise<void> {
        switch (message.type) {
            // Handle notification requests from the webview (frontend)
            case 'showNotification': {
                // message: { type: 'showNotification', message: string, messageType: 'info'|'success'|'error'|'warning' }
                const { message: msg, messageType } = message as any;
                if (typeof msg === 'string') {
                    if (messageType === 'error') {
                        vscode.window.showErrorMessage(msg);
                    } else if (messageType === 'warning') {
                        vscode.window.showWarningMessage(msg);
                    } else if (messageType === 'success' || messageType === 'info') {
                        vscode.window.showInformationMessage(msg);
                    } else {
                        vscode.window.showInformationMessage(msg);
                    }
                }
                // Optionally, send a response to the webview to allow UI to re-enable buttons if needed
                webview.postMessage({ type: 'notificationShown', messageType, message: msg });
                break;
            }
            // Special case for webview initialization
            case 'webviewLoaded':
                await this.sendLocalizedStrings(webview);
                break;
            // NEW: Separate commands
            case 'connectNamespace':
                await this.handleConnectNamespace((message as ConnectNamespaceMessage).namespace, webview);
                break;
            case 'disconnectNamespace':
                await this.handleDisconnectNamespace(webview);
                break;
            case 'interceptTraffic':
                await this.handleInterceptTraffic((message as InterceptTrafficMessage).data, webview);
                await this.pushTelepresenceStatus(webview);
                break;
            case 'disconnectInterception':
                // TelepresenceOutput.appendLine(`[Telepresence] 🔌 Received disconnectInterception for: ${(message as DisconnectInterceptionMessage).sessionId}`); // Verbose, omit
                await this.handleDisconnectInterception((message as DisconnectInterceptionMessage).sessionId, webview);
                await this.pushTelepresenceStatus(webview);
                break;
            case 'disconnectAllInterceptions':
                await this.handleDisconnectAllInterceptions(webview);
                await this.pushTelepresenceStatus(webview);
                break;
            case 'getNamespaces':
                await this.getNamespaces(webview);
                break;
            case 'refreshNamespaces':
                await this.getNamespaces(webview, { force: true });
                break;
            case 'getDeployments':
                await this.getDeployments((message as GetDeploymentsMessage).namespace, webview);
                break;
            case 'checkPrerequisites':
                await this.checkPrerequisites(webview);
                break;
            case 'getTelepresenceStatus': {
                const snapshot = await this.telepresenceManager.refreshStatusSnapshot({
                    trigger: 'webviewManual',
                    allowQueue: true
                }) ?? this.telepresenceManager.getCachedStatusSnapshot();
                await this.pushTelepresenceStatus(webview, snapshot);
                break;
            }
            case 'installTelepresence':
                await this.telepresenceManager.installTelepresence();
                break;
            case 'installKubelogin':
                await this.kubernetesManager.installKubelogin();
                break;
            case 'installKubectl':
                await this.kubernetesManager.installKubectl();
                break;
            case 'openKubernetesLogin':
                // Abrir la nueva pantalla de login a Kubernetes
                this.openKubernetesLogin();
                break;
        }
    }

    async initializeWebview(webview: vscode.Webview): Promise<void> {
        // Send localized strings to the webview
        await this.sendLocalizedStrings(webview);
        
        // Check current telepresence status first
        await this.telepresenceManager.checkCurrentTelepresenceStatus();
        await this.checkPrerequisites(webview);
        await this.getNamespaces(webview);
    await this.pushTelepresenceStatus(webview);
    }

    /**
     * Sends localized strings to the webview
     * @param webview - VS Code webview instance
     */
    private async sendLocalizedStrings(webview: vscode.Webview): Promise<void> {
        try {
            // Log para depuración
            // TelepresenceOutput.appendLine(`[Telepresence] 📝 Sending localized strings to webview. Language: ${i18n.getLanguage()}`); // Verbose, omit
            
            // Verificar que tenemos cadenas
            const strings = i18n.getLocalizedStrings();
            const stringCount = Object.keys(strings).length;
            
            if (stringCount === 0) {
            TelepresenceOutput.appendLine(`[Telepresence] WARNING: No localized strings available!`);
            } else {
                // TelepresenceOutput.appendLine(`[Telepresence] ✅ Sending ${stringCount} localized strings`); // Verbose, omit
                
                // Log some important keys to debug issues
                const importantKeys = [
                    'webview.app.title', 
                    'webview.app.heading', 
                    'webview.panel.namespace.title',
                    'connection.status.disconnected'
                ];
                
                importantKeys.forEach(key => {
                    // TelepresenceOutput.appendLine(`[Telepresence] 🔑 ${key} = "${strings[key] || 'NOT FOUND'}"`); // Verbose, omit
                });
            }
            
            webview.postMessage({
                type: 'localizedStrings',
                strings: strings,
                language: i18n.getLanguage()
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            TelepresenceOutput.appendLine(`[Telepresence] Error sending localized strings: ${errorMessage}`);
            
            // Intentar enviar un conjunto mínimo de strings para que la UI no falle
            webview.postMessage({
                type: 'localizedStrings',
                strings: {
                    'webview.app.title': 'Telepresence GUI',
                    'webview.app.heading': 'Telepresence Control Panel',
                    'error.localization.failed': 'Failed to load localization strings'
                },
                language: 'en',
                error: errorMessage
            });
        }
    }

    // MODIFICADO: Conectar solo al namespace - ahora obtiene deployments inmediatamente
    private async handleConnectNamespace(namespace: string, webview: vscode.Webview): Promise<void> {
        // Usar TelepresenceOutput.appendLine directamente
        try {
            TelepresenceOutput.getChannel().show();
            await this.telepresenceManager.connectToNamespace(namespace);
            const deployments = await this.kubernetesManager.getDeploymentsInNamespace(namespace);
            // Notificación nativa VS Code
            const msg = deployments.length > 0
                ? i18n.localize('messageHandler.connectNamespace.success', namespace, deployments.length)
                : i18n.localize('messageHandler.connectNamespace.successNoDeployments', namespace);
            vscode.window.showInformationMessage(msg);

            // Enviar mensaje de éxito explícito al frontend
            webview.postMessage({
                type: 'connectNamespaceSuccess',
                message: msg,
                hasDeployments: deployments.length > 0
            });

            // Enviar deployments para autocompletado
            webview.postMessage({
                type: 'deploymentsUpdate',
                namespace: namespace,
                deployments: deployments
            });
            await this.pushTelepresenceStatus(webview);
        } catch (error) {
            TelepresenceOutput.appendLine(`[Telepresence] Error in handleConnectNamespace: ${error}`);
            vscode.window.showErrorMessage(i18n.localize('messageHandler.connectNamespace.error', namespace) + ': ' + (error instanceof Error ? error.message : String(error)));
            // Enviar mensaje de error explícito al frontend
            webview.postMessage({
                type: 'connectNamespaceError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // NUEVO: Desconectar del namespace
    private async handleDisconnectNamespace(webview: vscode.Webview): Promise<void> {
        // Usar TelepresenceOutput.appendLine directamente
        try {
            
            const currentNamespace = this.telepresenceManager.getConnectedNamespace();
            await this.telepresenceManager.disconnectFromNamespace();

            const message = currentNamespace 
                ? `Successfully disconnected from namespace '${currentNamespace}' and cleanup completed`
                : `General telepresence cleanup completed successfully`;
            vscode.window.showInformationMessage(message);
            // Esperar que telepresence termine de limpiar
            await new Promise(resolve => setTimeout(resolve, 3000));
            await this.pushTelepresenceStatus(webview);
        } catch (error) {
            TelepresenceOutput.appendLine('[Telepresence] Error desconectando del namespace: ' + (error instanceof Error ? error.message : String(error)));
            vscode.window.showErrorMessage('Error disconnecting from namespace: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    // NUEVO: Interceptar tráfico
    private async handleInterceptTraffic(data: InterceptTrafficMessage['data'], webview: vscode.Webview): Promise<void> {
        // Usar TelepresenceOutput.appendLine directamente
        try {
            const sessionId = await this.telepresenceManager.interceptTraffic(
                data.microservice,
                parseInt(data.localPort)
            );
            const msg = i18n.localize('messageHandler.interceptTraffic.success', data.microservice, data.localPort);
            vscode.window.showInformationMessage(msg);
            webview.postMessage({ type: 'interceptTrafficDone', success: true, message: msg });
            await this.pushTelepresenceStatus(webview);
        } catch (error) {
            const errMsg = 'Error intercepting traffic: ' + (error instanceof Error ? error.message : String(error));
            TelepresenceOutput.appendLine(`[Telepresence] Error setting up traffic interception: ${errMsg}`);
            vscode.window.showErrorMessage(errMsg);
            webview.postMessage({ type: 'interceptTrafficDone', success: false, message: errMsg });
        }
    }

    // NUEVO: Desconectar intercepción específica
    private async handleDisconnectInterception(sessionId: string, webview: vscode.Webview): Promise<void> {
        // Usar TelepresenceOutput.appendLine directamente
        try {
            
            await this.telepresenceManager.disconnectInterception(sessionId);
            
            TelepresenceOutput.appendLine(`[Telepresence] ✅ Interception disconnected successfully`);
            
            vscode.window.showInformationMessage(i18n.localize('messageHandler.disconnectInterception.success'));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            TelepresenceOutput.appendLine(`[Telepresence] ❌ Error in handleDisconnectInterception: ${errorMessage}`);
            vscode.window.showErrorMessage('Error disconnecting interception: ' + errorMessage);
        }
        // Actualizar estado después de la operación (éxito o error)
    await this.pushTelepresenceStatus(webview);
    }

    // NUEVO: Desconectar todas las intercepciones (pero mantener conexión al namespace)
    private async handleDisconnectAllInterceptions(webview: vscode.Webview): Promise<void> {
        // Usar TelepresenceOutput.appendLine directamente
        try {
            const sessions = this.telepresenceManager.getSessions();
            const sessionCount = sessions.length;
            await this.telepresenceManager.disconnectAllInterceptions();
            const successMessage = sessionCount > 0 
                ? `${sessionCount} traffic interception(s) successfully disconnected`
                : 'There were no active interceptions to disconnect';
            vscode.window.showInformationMessage(successMessage);
            TelepresenceOutput.appendLine('All interceptions successfully disconnected');
        } catch (error) {
            TelepresenceOutput.appendLine('Error disconnecting all interceptions: ' + (error instanceof Error ? error.message : String(error)));
            vscode.window.showErrorMessage('Error disconnecting all interceptions: ' + (error instanceof Error ? error.message : String(error)));
        }
    await this.pushTelepresenceStatus(webview);
    }

    private async getNamespaces(webview: vscode.Webview, options?: { force?: boolean }): Promise<void> {
        try {
            const namespaces = options?.force
                ? await this.telepresenceManager.refreshNamespaces()
                : await this.telepresenceManager.listNamespaces();
            webview.postMessage({
                type: 'namespacesUpdate',
                namespaces: namespaces,
                trigger: options?.force ? 'manual' : 'auto'
            });
        } catch (error) {
            webview.postMessage({
                type: 'namespacesError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async getDeployments(namespace: string, webview: vscode.Webview): Promise<void> {
        try {
            const deployments = await this.kubernetesManager.getDeploymentsInNamespace(namespace);
            webview.postMessage({
                type: 'deploymentsUpdate',
                namespace: namespace,
                deployments: deployments
            });
        } catch (error) {
            webview.postMessage({
                type: 'deploymentsError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    public async pushTelepresenceStatus(webview: vscode.Webview, snapshot?: TelepresenceStatusSnapshot | null): Promise<void> {
        try {
            let status = snapshot ?? this.telepresenceManager.getCachedStatusSnapshot();
            if (!status) {
                status = await this.telepresenceManager.refreshStatusSnapshot({
                    trigger: 'webviewPush',
                    allowQueue: true
                }) ?? this.telepresenceManager.getCachedStatusSnapshot();
            }

            if (!status) {
                throw new Error('No telepresence status available');
            }

            webview.postMessage({
                type: 'telepresenceStatusUpdate',
                status: {
                    interceptions: status.interceptions,
                    listOutput: status.rawOutput,
                    connectionStatus: status.connectionStatus,
                    daemonStatus: status.daemonStatus,
                    timestamp: status.timestamp,
                    namespaceConnection: status.namespaceConnection,
                    error: status.error
                }
            });

            const sessions = this.telepresenceManager.getSessions();
            webview.postMessage({
                type: 'sessionsUpdate',
                sessions,
                namespaceConnection: status.namespaceConnection
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            webview.postMessage({
                type: 'telepresenceStatusUpdate',
                status: {
                    interceptions: [],
                    listOutput: 'Error obteniendo el estado de telepresence',
                    connectionStatus: 'error',
                    daemonStatus: 'unknown',
                    timestamp: new Date().toLocaleTimeString(),
                    namespaceConnection: null,
                    error: errorMessage
                }
            });

            webview.postMessage({
                type: 'sessionsUpdate',
                sessions: [],
                namespaceConnection: null
            });
        }
    }

    public async checkPrerequisites(webview: vscode.Webview): Promise<void> {
        const telepresenceInstalled = await this.telepresenceManager.checkTelepresenceInstalled();
        const kubectlInstalled = await this.kubernetesManager.checkKubectlInstalled();
        const kubeloginInstalled = await this.kubernetesManager.checkKubeloginInstalled();
        const currentContext = await this.kubernetesManager.getCurrentContext();
        const settingsManager = this.telepresenceManager.getSettingsManager();
        const requiredContext = settingsManager.getRequiredContext();
        const hasAdminRights = await this.kubernetesManager.checkAdminRights();

        let authenticationNeeded = false;
        let authenticationStatus = 'checking';
        let authProvider = 'unknown';
        let authMessage = '';
        
        if (!currentContext) {
            authenticationStatus = 'no-context';
            authMessage = 'No kubectl context configured';
        } else {
            try {
                // Obtener información detallada de autenticación
                const authInfo = await this.kubernetesManager.getClusterAuthInfo();
                
                authenticationNeeded = authInfo.needsAuth;
                authProvider = authInfo.provider;
                
                if (authInfo.error) {
                    authenticationStatus = 'error';
                    authMessage = authInfo.error;
                } else if (!authInfo.needsAuth) {
                    authenticationStatus = 'authenticated';
                    authMessage = `Authenticated in cluster ${authInfo.provider}`;
                } else {
                    // Needs authentication
                    switch (authInfo.authType) {
                        case 'kubelogin':
                            if (kubeloginInstalled) {
                                authenticationStatus = 'unauthenticated';
                                authMessage = 'Run Azure Login to authenticate';
                            } else {
                                authenticationStatus = 'missing-kubelogin';
                                authMessage = 'Kubelogin required for Azure';
                            }
                            break;
                            
                        case 'aws':
                            authenticationStatus = 'unauthenticated';
                            authMessage = 'Configura AWS CLI para autenticarte';
                            break;
                            
                        case 'gcp':
                            authenticationStatus = 'unauthenticated';
                            authMessage = 'Configura gcloud para autenticarte';
                            break;
                            
                        default:
                            authenticationStatus = 'unauthenticated';
                            authMessage = 'Authentication required';
                    }
                }
                
            } catch (error) {
                authenticationStatus = 'error';
                authMessage = error instanceof Error ? error.message : String(error);
            }
        }
    
        // Log detallado para debugging
        TelepresenceOutput.appendLine(`[Telepresence] 🔑 Auth check results: ${JSON.stringify({
            currentContext,
            authenticationNeeded,
            authenticationStatus,
            authProvider,
            authMessage,
            kubeloginInstalled
        })}`);
    
        webview.postMessage({
            type: 'prerequisitesUpdate',
            prerequisites: {
                telepresenceInstalled,
                kubectlInstalled,
                kubeloginInstalled,
                currentContext,
                requiredContext,
                authenticationNeeded,
                authenticationStatus,
                authProvider,
                authMessage,
                hasAdminRights 
            }
        });
    }

    /**
     * Opens the new Kubernetes login screen
     */
    private openKubernetesLogin(): void {
        try {
            // Run the command that opens the new login screen
            vscode.commands.executeCommand('telepresence.loginToKubernetes');
        } catch (error) {
            TelepresenceOutput.appendLine(`[Telepresence] ❌ Error opening login screen: ${error}`);
        }
    }}