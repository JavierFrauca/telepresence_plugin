import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { KubernetesManager } from './kubernetesManager';
import { i18n } from './i18n/localizationManager';

/**
 * Supported Kubernetes cluster provider types
 */
export enum KubeClusterProvider {
  Azure = 'azure',
  GKE = 'gke',
  EKS = 'eks',
  Local = 'local',
  Generic = 'generic'
}

/**
 * Simple provider for Kubernetes login
 * This independent implementation allows connecting to kubernetes clusters
 * in a simple way with minimal steps
 */
// Clase de estado para tracking de instalaciones recientes
class InstallationState {
    private static _instance: InstallationState;
    private _recentInstalls: Map<string, boolean> = new Map();
    
    private constructor() {}
    
    public static getInstance(): InstallationState {
        if (!InstallationState._instance) {
            InstallationState._instance = new InstallationState();
        }
        return InstallationState._instance;
    }
    
    public getRecentInstall(tool: string): boolean {
        return this._recentInstalls.get(tool) || false;
    }
    
    public setRecentInstall(tool: string, value: boolean): void {
        this._recentInstalls.set(tool, value);
    }
}

export class SimpleKubeLoginProvider {
    private currentProvider: KubeClusterProvider | null = null;
    private availableClusters: string[] = [];
    private installState = InstallationState.getInstance();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly kubernetesManager: KubernetesManager
    ) {}

    /**
     * Sets up the webview for the login panel
     */
    public setupWebview(webview: vscode.Webview): void {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webview.html = this.getWebviewContent(webview);

        // Message handler from the webview
        webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message.type) {
                    case 'selectProvider':
                        this.currentProvider = message.provider;
                        await this.handleProviderSelection(webview, message.provider);
                        break;
                    case 'authenticate':
                        await this.handleAuthentication(webview, message.provider);
                        break;
                    case 'listClusters':
                        await this.listAvailableClusters(webview, message.provider);
                        break;
                    case 'selectCluster':
                        await this.selectCluster(webview, message.cluster);
                        break;
                    case 'getContexts':
                        await this.getKubernetesContexts(webview);
                        break;
                    case 'setDefaultContext':
                        await this.setDefaultContext(webview, message.context);
                        break;
                }
            } catch (error) {
                webview.postMessage({ 
                    type: 'error', 
                    message: `Error: ${error instanceof Error ? error.message : String(error)}` 
                });
            }
        });

        // Inicialmente mostrar los contextos disponibles
        this.getKubernetesContexts(webview).catch(error => {
            console.error('Error getting kubernetes contexts:', error);
        });
        
        // Check installed tools status for each provider asynchronously
        this.checkAllProvidersToolStatus(webview);
    }
    
    /**
     * Checks and updates tool status for all providers
     */
    private async checkAllProvidersToolStatus(webview: vscode.Webview): Promise<void> {
        const providers = [
            KubeClusterProvider.Azure,
            KubeClusterProvider.GKE,
            KubeClusterProvider.EKS,
            KubeClusterProvider.Local,
            KubeClusterProvider.Generic
        ];
        
        // Set initial checking status
        providers.forEach(provider => {
            this.updateProviderToolStatus(webview, provider, 'checking');
        });
        
        // Check kubectl for all providers
        const isKubectlInstalled = await this.kubernetesManager.checkKubectlInstalled();
        
        if (!isKubectlInstalled) {
            // If kubectl is not installed, all providers are missing essential tools
            providers.forEach(provider => {
                this.updateProviderToolStatus(webview, provider, 'missing');
            });
            return;
        }
        
        // Check provider specific tools
        const azureCheck = this.kubernetesManager.checkAzureCliInstalled()
            .then(isInstalled => this.kubernetesManager.checkKubeloginInstalled()
                .then(isKubeloginInstalled => {
                    this.updateProviderToolStatus(
                        webview, 
                        KubeClusterProvider.Azure, 
                        (isInstalled && isKubeloginInstalled) ? 'installed' : 'missing'
                    );
                })
            );
            
        const gkeCheck = this.kubernetesManager.checkGcloudCliInstalled()
            .then(isInstalled => {
                this.updateProviderToolStatus(
                    webview, 
                    KubeClusterProvider.GKE, 
                    isInstalled ? 'installed' : 'missing'
                );
            });
            
        const eksCheck = this.kubernetesManager.checkAwsCliInstalled()
            .then(isInstalled => {
                this.updateProviderToolStatus(
                    webview, 
                    KubeClusterProvider.EKS, 
                    isInstalled ? 'installed' : 'missing'
                );
            });
            
        const localCheck = this.kubernetesManager.checkMinikubeInstalled()
            .then(isInstalled => {
                this.updateProviderToolStatus(
                    webview, 
                    KubeClusterProvider.Local, 
                    isInstalled ? 'installed' : 'missing'
                );
            });
        
        // Generic requires only kubectl which we already checked
        this.updateProviderToolStatus(webview, KubeClusterProvider.Generic, 'installed');
        
        // Wait for all checks to complete
        await Promise.all([azureCheck, gkeCheck, eksCheck, localCheck])
            .catch(error => {
                console.error('Error checking tool status:', error);
            });
    }

    /**
     * Obtiene el contenido HTML para el webview
     */
    private getWebviewContent(webview: vscode.Webview): string {
        // Generar URIs para los recursos
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'src','webview','assets', 'login', 'simple-login.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'src','webview','assets', 'login', 'simple-login.css')
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        // Obtener el idioma actual
        const language = i18n.getLanguage();
        console.log(`[Telepresence Login] 🌐 Using language: ${language}`);

        // HTML con soporte para internacionalización
        return `<!DOCTYPE html>
        <html lang="${language}">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${i18n.localize('login.title', 'Login to Kubernetes')}</title>
            <link href="${styleUri}" rel="stylesheet">
            <link href="${codiconsUri}" rel="stylesheet">
            <script type="module" src="${scriptUri}"></script>
            <script>
                // Inyectar traducciones para el componente
                window.translations = {
                    "login.title": "${i18n.localize('login.title', 'Login to Kubernetes')}",
                    "login.currentContexts": "${i18n.localize('login.currentContexts', 'Current Kubernetes Contexts')}",
                    "login.loadingContexts": "${i18n.localize('login.loadingContexts', 'Loading contexts...')}",
                    "login.addNewCluster": "${i18n.localize('login.addNewCluster', 'Add New Cluster')}",
                    "login.selectProvider": "${i18n.localize('login.selectProvider', 'Select Cluster Provider:')}",
                    "login.azure": "${i18n.localize('login.azure', 'Azure Kubernetes Service (AKS)')}",
                    "login.gke": "${i18n.localize('login.gke', 'Google Kubernetes Engine (GKE)')}",
                    "login.eks": "${i18n.localize('login.eks', 'Amazon Elastic Kubernetes Service (EKS)')}",
                    "login.local": "${i18n.localize('login.local', 'Local Kubernetes (minikube, k3s, etc.)')}",
                    "login.generic": "${i18n.localize('login.generic', 'Generic Kubernetes')}",
                    "login.authenticating": "${i18n.localize('login.authenticating', 'Authenticating...')}",
                    "login.selectCluster": "${i18n.localize('login.selectCluster', 'Select Cluster:')}",
                    "login.authenticate": "${i18n.localize('login.authenticate', 'Authenticate')}",
                    "login.noContextsFound": "${i18n.localize('login.noContextsFound', 'No Kubernetes contexts found. Add a new cluster using one of the options below.')}",
                    "login.useExisting": "${i18n.localize('login.useExisting', 'Use Existing Configuration')}",
                    "login.loading": "${i18n.localize('login.loading', 'Loading...')}",
                    "login.currentContext": "${i18n.localize('login.currentContext', 'Current Context')}",
                    "login.switchContext": "${i18n.localize('login.switchContext', 'Switch to Context')}",
                    "login.connect": "${i18n.localize('login.connect', 'Connect to {0}')}",
                    "login.noContexts": "${i18n.localize('login.noContexts', 'No contexts available')}",
                    "login.noClusters": "${i18n.localize('login.noClusters', 'No clusters available')}"
                };

                // Función para obtener traducciones
                window.t = function(key, defaultValue) {
                    return window.translations[key] || defaultValue || key;
                }
            </script>
        </head>
        <body>
            <div class="container">
                <h1>${i18n.localize('login.title', 'Login to Kubernetes')}</h1>
                
                <div class="section">
                    <h2>${i18n.localize('login.currentContexts', 'Current Kubernetes Contexts')}</h2>
                    <div id="contexts-container" class="contexts-list">
                        <div class="loading">${i18n.localize('login.loadingContexts', 'Loading contexts...')}</div>
                    </div>
                </div>

                <div class="section">
                    <h2>${i18n.localize('login.addNewCluster', 'Add New Cluster')}</h2>
                    <div class="provider-selector">
                        <label>${i18n.localize('login.selectProvider', 'Select Cluster Provider:')}</label>
                        <div class="provider-buttons">
                            <button class="provider-btn" data-provider="azure">
                                <span class="codicon codicon-azure"></span> ${i18n.localize('login.azure', 'Azure Kubernetes Service (AKS)')}
                            </button>
                            <button class="provider-btn" data-provider="gke">
                                <span class="codicon codicon-google-cloud"></span> ${i18n.localize('login.gke', 'Google Kubernetes Engine (GKE)')}
                            </button>
                            <button class="provider-btn" data-provider="eks">
                                <span class="codicon codicon-aws"></span> ${i18n.localize('login.eks', 'Amazon Elastic Kubernetes Service (EKS)')}
                            </button>
                            <button class="provider-btn" data-provider="local">
                                <span class="codicon codicon-vm"></span> ${i18n.localize('login.local', 'Local Kubernetes (minikube, k3s, etc.)')}
                            </button>
                            <button class="provider-btn" data-provider="generic">
                                <span class="codicon codicon-server"></span> ${i18n.localize('login.generic', 'Generic Kubernetes')}
                            </button>
                        </div>
                    </div>
                </div>

                <div id="provider-flow" class="section hidden">
                    <h2 id="provider-title">${i18n.localize('login.connect', 'Connect to {0}').replace('{0}', '')}</h2>
                    <div id="authentication-container" class="hidden">
                        <button id="authenticate-btn" class="action-button">
                            <span class="codicon codicon-key"></span> ${i18n.localize('login.authenticate', 'Authenticate')}
                        </button>
                    </div>
                    
                    <div id="clusters-container" class="hidden">
                        <h3>${i18n.localize('login.selectCluster', 'Select Cluster:')}</h3>
                        <div id="clusters-list" class="clusters-list">
                            <div class="loading">${i18n.localize('login.loading', 'Loading...')}</div>
                        </div>
                    </div>
                </div>

                <div id="status-container" class="status-container">
                    <div id="status-message"></div>
                </div>
            </div>

            <script>
                // Aplica traducciones inmediatamente después de cargar el DOM
                document.addEventListener('DOMContentLoaded', () => {
                    console.log('🌐 Login component applying translations');
                });
            </script>
        </body>
        </html>`;
    }

    /**
     * Maneja la selección de un proveedor de cluster
     */
    private async handleProviderSelection(webview: vscode.Webview, provider: KubeClusterProvider): Promise<void> {
        // Mostrar la sección del flujo del proveedor
        webview.postMessage({ 
            type: 'updateUI', 
            action: 'showProviderFlow', 
            provider 
        });

        // Verificar las herramientas necesarias para este proveedor
        const toolsStatus = await this.checkRequiredTools(webview, provider);
        
        // Si faltan herramientas básicas, detener el proceso
        if (!toolsStatus.kubectl) {
            return;
        }

        // Verificar si se requiere autenticación
        const requiresAuth = this.providerRequiresAuthentication(provider);
        webview.postMessage({ 
            type: 'updateUI', 
            action: 'toggleAuthentication', 
            show: requiresAuth 
        });

        // Si no requiere autenticación, listar clusters directamente
        if (!requiresAuth) {
            await this.listAvailableClusters(webview, provider);
        }
    }
    
    /**
     * Checks if the required tools are installed for the selected provider
     */
    private async checkRequiredTools(webview: vscode.Webview, provider: KubeClusterProvider): Promise<{
        kubectl: boolean;
        kubelogin?: boolean;
        providerCli?: boolean;
    }> {
        // Common tool: kubectl is required for all providers
        const isKubectlInstalled = await this.kubernetesManager.checkKubectlInstalled();
        
        if (!isKubectlInstalled) {
            webview.postMessage({ 
                type: 'error', 
                message: i18n.localize('login.kubectlRequired', 'kubectl is required to connect to Kubernetes clusters')
            });
            
            // Ask to install kubectl
            const response = await vscode.window.showErrorMessage(
                i18n.localize('login.installKubectl', 'kubectl is required but not installed. Would you like to install it now?'),
                { modal: true },
                i18n.localize('common.install', 'Install'),
                i18n.localize('common.cancel', 'Cancel')
            );
            
            if (response === i18n.localize('common.install', 'Install')) {
                await this.kubernetesManager.installCliTool('kubectl');
                return { kubectl: false }; // Return false to prevent continuing until kubectl is installed
            }
            
            return { kubectl: false };
        }
        
        // For Azure, check if Azure CLI is installed
        if (provider === KubeClusterProvider.Azure) {
            const isAzInstalled = await this.kubernetesManager.checkAzureCliInstalled();
            const isKubeloginInstalled = await this.kubernetesManager.checkKubeloginInstalled();
            
            if (!isAzInstalled) {
                webview.postMessage({ 
                    type: 'warning', 
                    message: i18n.localize('login.azureCliRequired', 'Azure CLI is required to connect to AKS clusters')
                });
                
                const response = await vscode.window.showWarningMessage(
                    i18n.localize('login.installAzureCli', 'Azure CLI is required but not installed. Would you like to install it now?'),
                    i18n.localize('common.install', 'Install'),
                    i18n.localize('common.cancel', 'Cancel')
                );
                
                if (response === i18n.localize('common.install', 'Install')) {
                    await this.kubernetesManager.installCliTool('az');
                }
            }
            
            if (!isKubeloginInstalled) {
                webview.postMessage({ 
                    type: 'warning', 
                    message: i18n.localize('login.kubeloginRequired', 'kubelogin is required for Azure AKS authentication')
                });
                
                const response = await vscode.window.showWarningMessage(
                    i18n.localize('login.installKubelogin', 'kubelogin is required but not installed. Would you like to install it now?'),
                    i18n.localize('common.install', 'Install'),
                    i18n.localize('common.cancel', 'Cancel')
                );
                
                if (response === i18n.localize('common.install', 'Install')) {
                    await this.kubernetesManager.installCliTool('kubelogin');
                }
            }
            
            return { 
                kubectl: true, 
                kubelogin: isKubeloginInstalled,
                providerCli: isAzInstalled
            };
        } 
        // For GKE, check if Google Cloud CLI is installed
        else if (provider === KubeClusterProvider.GKE) {
            const isGcloudInstalled = await this.kubernetesManager.checkGcloudCliInstalled();
            
            if (!isGcloudInstalled) {
                // Verificar si hemos intentado instalar Google Cloud CLI recientemente
                const hasRecentInstall = this.installState.getRecentInstall('gcloud');
                
                if (hasRecentInstall) {
                    // Mostrar un mensaje especial para una instalación reciente
                    webview.postMessage({ 
                        type: 'error', 
                        message: i18n.localize('login.restartRequired', 'Google Cloud CLI se instaló recientemente. Debe REINICIAR VS Code para que sea detectado correctamente')
                    });
                    
                    // Mostrar un diálogo modal para enfatizar la necesidad de reiniciar
                    const restartNow = await vscode.window.showWarningMessage(
                        i18n.localize('login.restartNeeded', 'VS Code necesita reiniciarse para detectar Google Cloud CLI'),
                        { modal: true, detail: 'Las herramientas recién instaladas requieren un reinicio para actualizar las variables de entorno.' },
                        i18n.localize('common.restartNow', 'Reiniciar ahora'),
                        i18n.localize('common.later', 'Más tarde')
                    );
                    
                    if (restartNow === i18n.localize('common.restartNow', 'Reiniciar ahora')) {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                    
                    // Continuamos sin pedir una nueva instalación
                } else {
                    // Comportamiento normal para una nueva instalación
                    webview.postMessage({ 
                        type: 'warning', 
                        message: i18n.localize('login.gcloudRequired', 'Google Cloud CLI is required to connect to GKE clusters')
                    });
                    
                    const response = await vscode.window.showWarningMessage(
                        i18n.localize('login.installGcloud', 'Google Cloud CLI is required but not installed. Would you like to install it now?'),
                        i18n.localize('common.install', 'Install'),
                        i18n.localize('common.cancel', 'Cancel')
                    );
                    
                    if (response === i18n.localize('common.install', 'Install')) {
                        // Marcar que hemos instalado gcloud recientemente
                        this.installState.setRecentInstall('gcloud', true);
                        await this.kubernetesManager.installCliTool('gcloud');
                    }
                }
            }
            
            return { 
                kubectl: true,
                providerCli: isGcloudInstalled 
            };
        }
        // For EKS, check if AWS CLI is installed
        else if (provider === KubeClusterProvider.EKS) {
            const isAwsInstalled = await this.kubernetesManager.checkAwsCliInstalled();
            
            if (!isAwsInstalled) {
                webview.postMessage({ 
                    type: 'warning', 
                    message: i18n.localize('login.awsCliRequired', 'AWS CLI is required to connect to EKS clusters')
                });
                
                const response = await vscode.window.showWarningMessage(
                    i18n.localize('login.installAwsCli', 'AWS CLI is required but not installed. Would you like to install it now?'),
                    i18n.localize('common.install', 'Install'),
                    i18n.localize('common.cancel', 'Cancel')
                );
                
                if (response === i18n.localize('common.install', 'Install')) {
                    await this.kubernetesManager.installCliTool('aws');
                }
            }
            
            return { 
                kubectl: true,
                providerCli: isAwsInstalled 
            };
        }
        // For local/minikube, check if minikube is installed
        else if (provider === KubeClusterProvider.Local) {
            const isMinikubeInstalled = await this.kubernetesManager.checkMinikubeInstalled();
            
            if (!isMinikubeInstalled) {
                webview.postMessage({ 
                    type: 'warning', 
                    message: i18n.localize('login.minikubeRequired', 'Minikube is recommended for local Kubernetes clusters')
                });
                
                const response = await vscode.window.showWarningMessage(
                    i18n.localize('login.installMinikube', 'Minikube is recommended but not installed. Would you like to install it now?'),
                    i18n.localize('common.install', 'Install'),
                    i18n.localize('common.cancel', 'Cancel')
                );
                
                if (response === i18n.localize('common.install', 'Install')) {
                    await this.kubernetesManager.installCliTool('minikube');
                }
            }
            
            return { 
                kubectl: true,
                providerCli: isMinikubeInstalled 
            };
        }
        
        // For generic Kubernetes, just require kubectl
        return { kubectl: true };
    }

    /**
     * Verifica si un proveedor requiere autenticación
     */
    private providerRequiresAuthentication(provider: KubeClusterProvider): boolean {
        // Los proveedores cloud normalmente requieren autenticación
        return [
            KubeClusterProvider.Azure, 
            KubeClusterProvider.GKE, 
            KubeClusterProvider.EKS
        ].includes(provider);
    }

    /**
     * Maneja el proceso de autenticación con el proveedor seleccionado
     */
    private async handleAuthentication(webview: vscode.Webview, provider: KubeClusterProvider): Promise<void> {
        webview.postMessage({ 
            type: 'status', 
            message: `Iniciando autenticación con ${provider}...` 
        });

        try {
            // Autenticación según el proveedor
            let success = false;
            
            switch (provider) {
                case KubeClusterProvider.Azure:
                    success = await this.authenticateWithAzure();
                    break;
                case KubeClusterProvider.GKE:
                    success = await this.authenticateWithGKE();
                    break;
                case KubeClusterProvider.EKS:
                    success = await this.authenticateWithEKS();
                    break;
                default:
                    // No debería llegar aquí si providerRequiresAuthentication es correcto
                    throw new Error(`El proveedor ${provider} no requiere autenticación`);
            }

            if (success) {
                webview.postMessage({ 
                    type: 'status', 
                    message: `Autenticación con ${provider} exitosa` 
                });
                
                // Después de autenticarse, listar los clusters disponibles
                await this.listAvailableClusters(webview, provider);
            } else {
                webview.postMessage({ 
                    type: 'error', 
                    message: `No se pudo autenticar con ${provider}` 
                });
            }
        } catch (error) {
            webview.postMessage({ 
                type: 'error', 
                message: `Error de autenticación: ${error instanceof Error ? error.message : String(error)}` 
            });
        }
    }    /**
     * Autenticación con Azure
     */
    private async authenticateWithAzure(): Promise<boolean> {
        // Usamos el kubernetesManager para la autenticación con Azure
        try {
            const result = await this.kubernetesManager.runCommand('az login');
            return result.success;
        } catch (error) {
            console.error('Error authenticating with Azure:', error);
            return false;
        }
    }    /**
     * Autenticación con Google Cloud (GKE)
     */
    private async authenticateWithGKE(): Promise<boolean> {
        try {
            const result = await this.kubernetesManager.runCommand('gcloud auth login');
            return result.success;
        } catch (error) {
            console.error('Error authenticating with GKE:', error);
            return false;
        }
    }

    /**
     * Authentication with Amazon (EKS)
     */
    private async authenticateWithEKS(): Promise<boolean> {
        try {
            // For EKS we can use aws configure or show a dialog to select credentials
            const result = await this.kubernetesManager.runCommand('aws configure');
            return result.success;
        } catch (error) {
            console.error('Error authenticating with EKS:', error);
            return false;
        }
    }

    /**
     * Lista los clusters disponibles para el proveedor seleccionado
     */
    private async listAvailableClusters(webview: vscode.Webview, provider: KubeClusterProvider): Promise<void> {
        webview.postMessage({ 
            type: 'status', 
            message: `Getting available clusters from ${provider}...` 
        });

        try {
            let clusters: string[] = [];
            
            switch (provider) {
                case KubeClusterProvider.Azure:
                    clusters = await this.getAzureClusters();
                    break;
                case KubeClusterProvider.GKE:
                    clusters = await this.getGKEClusters();
                    break;
                case KubeClusterProvider.EKS:
                    clusters = await this.getEKSClusters();
                    break;
                case KubeClusterProvider.Local:
                    clusters = await this.getLocalClusters();
                    break;
                case KubeClusterProvider.Generic:
                    // For generic clusters we show manual options
                    clusters = ['Use current kubeconfig', 'Import kubeconfig'];
                    break;
            }

            this.availableClusters = clusters;
            
            webview.postMessage({ 
                type: 'updateClusters', 
                clusters 
            });

            webview.postMessage({ 
                type: 'status', 
                message: clusters.length > 0 
                    ? `Se encontraron ${clusters.length} clusters` 
                    : 'No available clusters found' 
            });
        } catch (error) {
            webview.postMessage({ 
                type: 'error', 
                message: `Error listando clusters: ${error instanceof Error ? error.message : String(error)}` 
            });
        }
    }    /**
     * Obtiene clusters de Azure AKS
     */
    private async getAzureClusters(): Promise<string[]> {
        try {
            const result = await this.kubernetesManager.runCommand(
                'az aks list --query "[].{name:name,resourceGroup:resourceGroup}" -o tsv'
            );
            
            if (result.success && result.stdout) {
                // Parse output format: name\tresourceGroup
                return result.stdout.trim().split('\n')
                    .map((line: string) => {
                        const parts = line.trim().split('\t');
                        return parts.length >= 2 
                            ? `${parts[0]} (${parts[1]})` // Format: name (resourceGroup)
                            : line.trim();
                    })
                    .filter((line: string) => line.length > 0);
            }
            return [];
        } catch (error) {
            console.error('Error getting Azure clusters:', error);
            return [];
        }
    }

    /**
     * Obtiene clusters de Google GKE
     */
    private async getGKEClusters(): Promise<string[]> {
        try {
            const result = await this.kubernetesManager.runCommand(
                'gcloud container clusters list --format="value(name,zone)"'
            );
            
            if (result.success && result.stdout) {
                // Parse output format: name zone
                return result.stdout.trim().split('\n')
                    .map((line: string) => {
                        const parts = line.trim().split(/\s+/);
                        return parts.length >= 2 
                            ? `${parts[0]} (${parts[1]})` // Format: name (zone)
                            : line.trim();
                    })
                    .filter((line: string) => line.length > 0);
            }
            return [];
        } catch (error) {
            console.error('Error getting GKE clusters:', error);
            return [];
        }
    }

    /**
     * Obtiene clusters de Amazon EKS
     */
    private async getEKSClusters(): Promise<string[]> {
        try {
            const result = await this.kubernetesManager.runCommand(
                'aws eks list-clusters --query "clusters" -o json'
            );
            
            if (result.success && result.stdout) {
                try {
                    const clusters = JSON.parse(result.stdout);
                    if (Array.isArray(clusters)) {
                        return clusters;
                    }
                } catch (e) {
                    console.error('Error parsing EKS clusters JSON:', e);
                }
            }
            return [];
        } catch (error) {
            console.error('Error getting EKS clusters:', error);
            return [];
        }
    }    /**
     * Obtiene clusters locales (minikube, kind, etc.)
     */
    private async getLocalClusters(): Promise<string[]> {
        try {
            // Intentamos detectar minikube, kind, k3s, etc.
            const commands = [
                { cmd: 'minikube profile list -o json', parser: this.parseMiniKubeProfiles.bind(this) },
                { cmd: 'kind get clusters', parser: this.parseKindClusters.bind(this) }
            ];
            
            let allClusters: string[] = [];
            
            for (const { cmd, parser } of commands) {
                try {
                    const result = await this.kubernetesManager.runCommand(cmd);
                    if (result.success && result.stdout) {
                        const parsedClusters = parser(result.stdout);
                        allClusters = [...allClusters, ...parsedClusters];
                    }
                } catch (e) {
                    // Ignoramos errores individuales
                    console.debug(`Command ${cmd} failed:`, e);
                }
            }
            
            return allClusters;
        } catch (error) {
            console.error('Error getting local clusters:', error);
            return [];
        }
    }

    /**
     * Parsea perfiles de minikube
     */
    private parseMiniKubeProfiles(stdout: string): string[] {
        try {
            const data = JSON.parse(stdout);
            if (data && data.valid && Array.isArray(data.valid)) {
                return data.valid.map((profile: any) => `minikube: ${profile.Name}`);
            }
        } catch (e) {
            console.debug('Error parsing minikube profiles:', e);
        }
        return [];
    }

    /**
     * Parsea clusters de kind
     */
    private parseKindClusters(stdout: string): string[] {
        return stdout.trim().split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(cluster => `kind: ${cluster}`);
    }

    /**
     * Maneja la selección de un cluster
     */
    private async selectCluster(webview: vscode.Webview, clusterName: string): Promise<void> {
        if (!this.currentProvider) {
            throw new Error('No provider selected');
        }

        webview.postMessage({ 
            type: 'status', 
            message: `Conectando al cluster ${clusterName}...` 
        });

        try {
            let success = false;
            
            switch (this.currentProvider) {
                case KubeClusterProvider.Azure:
                    success = await this.connectToAzureCluster(clusterName);
                    break;
                case KubeClusterProvider.GKE:
                    success = await this.connectToGKECluster(clusterName);
                    break;
                case KubeClusterProvider.EKS:
                    success = await this.connectToEKSCluster(clusterName);
                    break;
                case KubeClusterProvider.Local:
                    success = await this.connectToLocalCluster(clusterName);
                    break;
                case KubeClusterProvider.Generic:
                    success = await this.handleGenericClusterOption(clusterName);
                    break;
            }

            if (success) {
                webview.postMessage({ 
                    type: 'status', 
                    message: `Successfully connected to cluster ${clusterName}` 
                });
                
                // Actualizar la lista de contextos disponibles
                await this.getKubernetesContexts(webview);
            } else {
                webview.postMessage({ 
                    type: 'error', 
                    message: `No se pudo conectar al cluster ${clusterName}` 
                });
            }
        } catch (error) {
            webview.postMessage({ 
                type: 'error', 
                message: `Error conectando al cluster: ${error instanceof Error ? error.message : String(error)}` 
            });
        }
    }    /**
     * Conecta a un cluster AKS de Azure
     */
    private async connectToAzureCluster(clusterFullName: string): Promise<boolean> {
        // Extraer nombre y grupo de recursos del formato "nombre (grupo)"
        const match = clusterFullName.match(/^([^(]+)\s*\(([^)]+)\)$/);
        if (!match) {
            throw new Error(`Formato de nombre de cluster inválido: ${clusterFullName}`);
        }
        
        const clusterName = match[1].trim();
        const resourceGroup = match[2].trim();
        
        try {
            // Paso 1: Obtener credenciales del cluster con --overwrite-existing
            const credentialsResult = await this.kubernetesManager.runCommand(
                `az aks get-credentials --name ${clusterName} --resource-group ${resourceGroup} --overwrite-existing`
            );
            
            if (!credentialsResult.success) {
                console.error('Error getting credentials:', credentialsResult.stderr);
                return false;
            }
            
            // Paso 2: Ejecutar kubelogin para convertir el kubeconfig
            const kubeloginResult = await this.kubernetesManager.runCommand(
                'kubelogin convert-kubeconfig -l azurecli'
            );
            
            return kubeloginResult.success;
        } catch (error) {
            console.error('Error connecting to Azure cluster:', error);
            return false;
        }
    }

    /**
     * Conecta a un cluster GKE de Google
     */
    private async connectToGKECluster(clusterFullName: string): Promise<boolean> {
        // Extraer nombre y zona del formato "nombre (zona)"
        const match = clusterFullName.match(/^([^(]+)\s*\(([^)]+)\)$/);
        if (!match) {
            throw new Error(`Formato de nombre de cluster inválido: ${clusterFullName}`);
        }
        
        const clusterName = match[1].trim();
        const zone = match[2].trim();
        
        try {
            // Obtener credenciales del cluster
            const result = await this.kubernetesManager.runCommand(
                `gcloud container clusters get-credentials ${clusterName} --zone ${zone}`
            );
            
            return result.success;
        } catch (error) {
            console.error('Error connecting to GKE cluster:', error);
            return false;
        }
    }

    /**
     * Conecta a un cluster EKS de Amazon
     */
    private async connectToEKSCluster(clusterName: string): Promise<boolean> {
        try {
            // Obtener credenciales del cluster
            const result = await this.kubernetesManager.runCommand(
                `aws eks update-kubeconfig --name ${clusterName}`
            );
            
            return result.success;
        } catch (error) {
            console.error('Error connecting to EKS cluster:', error);
            return false;
        }
    }    /**
     * Conecta a un cluster local
     */
    private async connectToLocalCluster(clusterFullName: string): Promise<boolean> {
        try {
            // Para clusters locales, configuramos el contexto según el tipo
            if (clusterFullName.startsWith('minikube:')) {
                const profile = clusterFullName.replace('minikube:', '').trim();
                const result = await this.kubernetesManager.runCommand(
                    `minikube update-context -p ${profile}`
                );
                return result.success;
            } else if (clusterFullName.startsWith('kind:')) {
                const cluster = clusterFullName.replace('kind:', '').trim();
                const result = await this.kubernetesManager.runCommand(
                    `kind export kubeconfig --name ${cluster}`
                );
                return result.success;
            }
            
            // Si no es un tipo reconocido, intentamos usar kubectl directamente
            return await this.switchContext(clusterFullName);
        } catch (error) {
            console.error('Error connecting to local cluster:', error);
            return false;
        }
    }

    /**
     * Handles generic cluster options
     */
    private async handleGenericClusterOption(option: string): Promise<boolean> {
        if (option === 'Use current kubeconfig') {
            // We simply verify that we can access the current cluster
            try {
                const result = await this.kubernetesManager.runCommand('kubectl cluster-info');
                return result.success;
            } catch (error) {
                console.error('Error verifying current cluster:', error);
                return false;
            }
        } else if (option === 'Importar kubeconfig') {
            // Mostrar diálogo para seleccionar archivo kubeconfig
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Seleccionar archivo kubeconfig',
                filters: {
                    'Kubeconfig': ['yaml', 'yml']
                }
            });
            
            if (fileUris && fileUris.length > 0) {
                const kubeConfigPath = fileUris[0].fsPath;
                
                // Import configuration to the current kubeconfig file
                try {
                    // Get path to current kubeconfig
                    const homeDir = process.env.HOME || process.env.USERPROFILE;
                    if (!homeDir) {
                        throw new Error('Could not determine the user\'s home directory');
                    }
                    
                    const currentKubeConfigPath = path.join(homeDir, '.kube', 'config');
                    
                    // Leer el nuevo kubeconfig
                    const newKubeConfig = fs.readFileSync(kubeConfigPath, 'utf-8');
                    
                    // Podríamos fusionar los archivos, pero es complejo
                    // Por ahora, simplemente establecemos KUBECONFIG para incluir ambos
                    const result = await this.kubernetesManager.runCommand(
                        `KUBECONFIG=${currentKubeConfigPath}:${kubeConfigPath} kubectl config view --flatten > ${currentKubeConfigPath}.new && ` +
                        `mv ${currentKubeConfigPath}.new ${currentKubeConfigPath}`
                    );
                    
                    return result.success;
                } catch (error) {
                    console.error('Error importing kubeconfig:', error);
                    return false;
                }
            }
            
            return false;
        }
        
        return false;
    }    /**
     * Obtiene los contextos de Kubernetes disponibles
     */
    private async getKubernetesContexts(webview: vscode.Webview): Promise<void> {
        try {
            const result = await this.kubernetesManager.runCommand(
                'kubectl config get-contexts -o name'
            );
            
            if (result.success && result.stdout) {
                const contexts = result.stdout.trim().split('\n')
                    .map((line: string) => line.trim())
                    .filter((line: string) => line.length > 0);
                
                // Get the current context
                const currentResult = await this.kubernetesManager.runCommand(
                    'kubectl config current-context'
                );
                
                const currentContext = currentResult.success && currentResult.stdout
                    ? currentResult.stdout.trim()
                    : '';
                
                webview.postMessage({ 
                    type: 'updateContexts', 
                    contexts,
                    currentContext
                });
            } else {
                webview.postMessage({ 
                    type: 'updateContexts', 
                    contexts: [],
                    currentContext: ''
                });
            }
        } catch (error) {
            console.error('Error getting kubernetes contexts:', error);
            webview.postMessage({ 
                type: 'error', 
                message: `Error obteniendo contextos: ${error instanceof Error ? error.message : String(error)}` 
            });
        }
    }

    /**
     * Establece un contexto de Kubernetes como predeterminado
     */
    private async setDefaultContext(webview: vscode.Webview, contextName: string): Promise<void> {
        try {
            const success = await this.switchContext(contextName);
            
            if (success) {
                webview.postMessage({ 
                    type: 'status', 
                    message: `Context '${contextName}' set as default` 
                });
                
                // Update the contexts list
                await this.getKubernetesContexts(webview);
            } else {
                webview.postMessage({ 
                    type: 'error', 
                    message: `Could not set context '${contextName}' as default` 
                });
            }
        } catch (error) {
            webview.postMessage({ 
                type: 'error', 
                message: `Error al cambiar de contexto: ${error instanceof Error ? error.message : String(error)}` 
            });
        }
    }

    /**
     * Cambia al contexto especificado
     */
    private async switchContext(contextName: string): Promise<boolean> {
        try {
            const result = await this.kubernetesManager.runCommand(
                `kubectl config use-context ${contextName}`
            );
            
            return result.success;
        } catch (error) {
            console.error('Error switching context:', error);
            return false;
        }
    }

    /**
     * Updates the webview with tool status for a specific provider
     */
    private updateProviderToolStatus(webview: vscode.Webview, provider: KubeClusterProvider, status: 'checking' | 'installed' | 'missing'): void {
        webview.postMessage({
            type: 'updateToolStatus',
            provider,
            status
        });
    }
}
