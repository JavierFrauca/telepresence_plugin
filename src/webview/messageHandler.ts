import * as vscode from 'vscode';
import { TelepresenceManager, TelepresenceSession } from '../telepresenceManager';
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
    private outputChannel = TelepresenceOutput.getChannel();
    constructor(
        private readonly telepresenceManager: TelepresenceManager,
        private readonly kubernetesManager: KubernetesManager
    ) {}

    async handleMessage(message: WebviewMessage, webview: vscode.Webview): Promise<void> {
        switch (message.type) {
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
                await this.getTelepresenceStatus(webview);
                break;
            case 'disconnectInterception':
                this.outputChannel.appendLine(`[Telepresence] 🔌 Received disconnectInterception for: ${(message as DisconnectInterceptionMessage).sessionId}`);
                await this.handleDisconnectInterception((message as DisconnectInterceptionMessage).sessionId, webview);
                await this.getTelepresenceStatus(webview);
                break;
            case 'disconnectAllInterceptions':
                await this.handleDisconnectAllInterceptions(webview);
                await this.getTelepresenceStatus(webview);
                break;
            case 'getNamespaces':
                await this.getNamespaces(webview);
                break;
            case 'getDeployments':
                await this.getDeployments((message as GetDeploymentsMessage).namespace, webview);
                break;
            case 'checkPrerequisites':
                await this.checkPrerequisites(webview);
                break;
            case 'getTelepresenceStatus':
                await this.getTelepresenceStatus(webview);
                break;
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
    }

    /**
     * Sends localized strings to the webview
     * @param webview - VS Code webview instance
     */
    private async sendLocalizedStrings(webview: vscode.Webview): Promise<void> {
        try {
            // Log para depuración
            this.outputChannel.appendLine(`[Telepresence] 📝 Sending localized strings to webview. Language: ${i18n.getLanguage()}`);
            
            // Verificar que tenemos cadenas
            const strings = i18n.getLocalizedStrings();
            const stringCount = Object.keys(strings).length;
            
            if (stringCount === 0) {
                this.outputChannel.appendLine(`[Telepresence] ⚠️ WARNING: No localized strings available!`);
            } else {
                this.outputChannel.appendLine(`[Telepresence] ✅ Sending ${stringCount} localized strings`);
                
                // Log some important keys to debug issues
                const importantKeys = [
                    'webview.app.title', 
                    'webview.app.heading', 
                    'webview.panel.namespace.title',
                    'connection.status.disconnected'
                ];
                
                importantKeys.forEach(key => {
                    this.outputChannel.appendLine(`[Telepresence] 🔑 ${key} = "${strings[key] || 'NOT FOUND'}"`);
                });
            }
            
            webview.postMessage({
                type: 'localizedStrings',
                strings: strings,
                language: i18n.getLanguage()
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[Telepresence] ❌ Error sending localized strings: ${errorMessage}`);
            
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
        const outputChannel = this.outputChannel;
        
        try {
            outputChannel.appendLine(`📨 Received connectNamespace request for: ${namespace}`);
            outputChannel.show();
            
            await this.telepresenceManager.connectToNamespace(namespace);
    
            outputChannel.appendLine(`✅ connectToNamespace completed successfully`);
            
            // NUEVO: Obtener deployments inmediatamente después de conectar exitosamente
            outputChannel.appendLine(`🔍 Getting deployments for namespace: ${namespace}`);
            const deployments = await this.kubernetesManager.getDeploymentsInNamespace(namespace);
            outputChannel.appendLine(`📋 Found ${deployments.length} deployments in namespace ${namespace}`);
            
            // Enviar respuesta de éxito con información de deployments
            webview.postMessage({
                type: 'connectNamespaceSuccess',
                namespace: namespace,
                deployments: deployments,
                hasDeployments: deployments.length > 0,
                message: deployments.length > 0 
                    ? i18n.localize('messageHandler.connectNamespace.success', namespace, deployments.length)
                    : i18n.localize('messageHandler.connectNamespace.successNoDeployments', namespace)
            });

            // Also send deployments update separately for autocomplete
            webview.postMessage({
                type: 'deploymentsUpdate',
                namespace: namespace,
                deployments: deployments
            });
    
            await this.getTelepresenceStatus(webview);
    
        } catch (error) {
            outputChannel.appendLine(`❌ Error in handleConnectNamespace: ${error}`);
            
            webview.postMessage({
                type: 'connectNamespaceError',
                namespace: namespace,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // NUEVO: Desconectar del namespace
    private async handleDisconnectNamespace(webview: vscode.Webview): Promise<void> {
        const outputChannel = this.outputChannel;
        try {
            outputChannel.appendLine('Executing general telepresence cleanup');
            
            const currentNamespace = this.telepresenceManager.getConnectedNamespace();
            await this.telepresenceManager.disconnectFromNamespace();

            const message = currentNamespace 
                ? `Successfully disconnected from namespace '${currentNamespace}' and cleanup completed`
                : `General telepresence cleanup completed successfully`;

            webview.postMessage({
                type: 'disconnectNamespaceSuccess', 
                message: message
            });

            // 👈 NUEVO: Esperar que telepresence termine de limpiar
            outputChannel.appendLine('⏳ Waiting for telepresence to fully cleanup...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            await this.getTelepresenceStatus(webview);
        } catch (error) {
            outputChannel.appendLine('Error desconectando del namespace: ' + (error instanceof Error ? error.message : String(error)));
            webview.postMessage({
                type: 'disconnectNamespaceError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // NUEVO: Interceptar tráfico
    private async handleInterceptTraffic(data: InterceptTrafficMessage['data'], webview: vscode.Webview): Promise<void> {
        const outputChannel = this.outputChannel;
        try {
            outputChannel.appendLine(`[Telepresence] 🔄 Starting traffic interception for service: ${data.microservice} on port: ${data.localPort}`);
            
            const sessionId = await this.telepresenceManager.interceptTraffic(
                data.microservice,
                parseInt(data.localPort)
            );

            outputChannel.appendLine(`[Telepresence] ✅ Traffic interception established successfully, session ID: ${sessionId}`);

            webview.postMessage({
                type: 'interceptTrafficSuccess',
                sessionId: sessionId,
                message: i18n.localize('messageHandler.interceptTraffic.success', data.microservice, data.localPort)
            });
            
            // Llamar inmediatamente para obtener datos reales
            await this.getTelepresenceStatus(webview);
            
        } catch (error) {
            outputChannel.appendLine(`[Telepresence] ❌ Error setting up traffic interception: ${error instanceof Error ? error.message : String(error)}`);
            
            webview.postMessage({
                type: 'interceptTrafficError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // NUEVO: Desconectar intercepción específica
    private async handleDisconnectInterception(sessionId: string, webview: vscode.Webview): Promise<void> {
        const outputChannel = this.outputChannel;
        try {
            outputChannel.appendLine(`[Telepresence] 🔄 Disconnecting interception with session ID: ${sessionId}`);
            
            await this.telepresenceManager.disconnectInterception(sessionId);
            
            outputChannel.appendLine(`[Telepresence] ✅ Interception disconnected successfully`);
            
            webview.postMessage({
                type: 'disconnectInterceptionSuccess',
                sessionId: sessionId,
                message: i18n.localize('messageHandler.disconnectInterception.success')
            });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`[Telepresence] ❌ Error in handleDisconnectInterception: ${errorMessage}`);
            
            webview.postMessage({
                type: 'disconnectInterceptionError',
                sessionId: sessionId,
                error: errorMessage
            });
        }
        
        // Actualizar estado después de la operación (éxito o error)
        await this.getTelepresenceStatus(webview);
    }

    // NUEVO: Desconectar todas las intercepciones (pero mantener conexión al namespace)
    private async handleDisconnectAllInterceptions(webview: vscode.Webview): Promise<void> {
        const outputChannel = this.outputChannel;
        try {
            const sessions = this.telepresenceManager.getSessions();
            const sessionCount = sessions.length;
            await this.telepresenceManager.disconnectAllInterceptions();
            const successMessage = sessionCount > 0 
                ? `${sessionCount} traffic interception(s) successfully disconnected`
                : 'There were no active interceptions to disconnect';
            webview.postMessage({
                type: 'disconnectAllInterceptionsSuccess',
                message: successMessage
            });
            outputChannel.appendLine('All interceptions successfully disconnected');
        } catch (error) {
            outputChannel.appendLine('Error disconnecting all interceptions: ' + (error instanceof Error ? error.message : String(error)));
            webview.postMessage({
                type: 'disconnectAllInterceptionsError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
        await this.getTelepresenceStatus(webview);
    }

    private async getNamespaces(webview: vscode.Webview): Promise<void> {
        try {
            const namespaces = await this.kubernetesManager.getNamespaces();
            webview.postMessage({
                type: 'namespacesUpdate',
                namespaces: namespaces
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

    private async getTelepresenceStatus(webview: vscode.Webview): Promise<void> {
        try {
            const status = await this.telepresenceManager.getFormattedTelepresenceStatus();
            
            // Enviar estado de telepresence
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
    
            // 🆕 AÑADIR: Enviar sesiones sincronizadas
            const sessions = this.telepresenceManager.getSessions();
            const namespaceConnection = this.telepresenceManager.getConnectedNamespace() ? {
                namespace: this.telepresenceManager.getConnectedNamespace()!,
                status: 'connected' as const
            } : null;
    
            webview.postMessage({
                type: 'sessionsUpdate',
                sessions: sessions,
                namespaceConnection: namespaceConnection
            });
            
        } catch (error) {
            webview.postMessage({
                type: 'telepresenceStatusUpdate',
                status: {
                    interceptions: [],
                    listOutput: 'Error obteniendo el estado de telepresence',
                    connectionStatus: 'error',
                    daemonStatus: 'unknown',
                    timestamp: new Date().toLocaleTimeString(),
                    namespaceConnection: null,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
    
            // 🆕 AÑADIR: También enviar sesiones vacías en caso de error
            webview.postMessage({
                type: 'sessionsUpdate',
                sessions: [],
                namespaceConnection: null
            });
        }
    }

    private async checkPrerequisites(webview: vscode.Webview): Promise<void> {
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
        this.outputChannel.appendLine(`[Telepresence] 🔑 Auth check results: ${JSON.stringify({
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
            this.outputChannel.appendLine(`[Telepresence] ❌ Error opening login screen: ${error}`);
        }
    }}