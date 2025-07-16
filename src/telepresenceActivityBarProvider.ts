import * as vscode from 'vscode';
import { TelepresenceManager, TelepresenceSession, TelepresenceInterception } from './telepresenceManager';
import { KubernetesManager } from './kubernetesManager';

/**
 * Provider para las 3 vistas del Activity Bar:
 * 1. Namespace Connection
 * 2. Active Interceptions  
 * 3. Telepresence Status
 */

// Canal de salida para Telepresence
const telepresenceOutputChannel = vscode.window.createOutputChannel('Telepresence');

// ===========================================
// NAMESPACE CONNECTION PROVIDER
// ===========================================
export class NamespaceTreeProvider implements vscode.TreeDataProvider<NamespaceTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<NamespaceTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<NamespaceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<NamespaceTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    constructor(
        private telepresenceManager: TelepresenceManager,
        private kubernetesManager: KubernetesManager
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NamespaceTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: NamespaceTreeItem): Promise<NamespaceTreeItem[]> {
        if (!element) {
            const items: NamespaceTreeItem[] = [];
            
            // Estado de conexión al namespace
            const connectedNamespace = this.telepresenceManager.getConnectedNamespace();
            
            if (connectedNamespace) {
                items.push(new NamespaceTreeItem(
                    `Connected: ${connectedNamespace}`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'connected-namespace',
                    'debug-start',
                    connectedNamespace
                ));
            } else {
                items.push(new NamespaceTreeItem(
                    'Connect to Namespace',
                    vscode.TreeItemCollapsibleState.None,
                    'connect-action',
                    'plug'
                ));
            }

            // Current context
            try {
                const currentContext = await this.kubernetesManager.getCurrentContext();
                items.push(new NamespaceTreeItem(
                    `Context: ${currentContext || 'Not Set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'context-info',
                    'symbol-property'
                ));
            } catch (error) {
                items.push(new NamespaceTreeItem(
                    'Context: Error getting context',
                    vscode.TreeItemCollapsibleState.None,
                    'context-error',
                    'error'
                ));
            }

            return items;
        }

        if (element.contextValue === 'connected-namespace' && element.namespace) {
            // Show details of connected namespace
            const items: NamespaceTreeItem[] = [];
            
            items.push(new NamespaceTreeItem(
                'Disconnect Namespace',
                vscode.TreeItemCollapsibleState.None,
                'disconnect-namespace',
                'debug-stop'
            ));

            try {
                const deployments = await this.kubernetesManager.getDeploymentsInNamespace(element.namespace);
                items.push(new NamespaceTreeItem(
                    `Deployments: ${deployments.length}`,
                    vscode.TreeItemCollapsibleState.None,
                    'deployments-count',
                    'symbol-array'
                ));
            } catch (error) {
                items.push(new NamespaceTreeItem(
                    'Deployments: Error loading',
                    vscode.TreeItemCollapsibleState.None,
                    'deployments-error',
                    'error'
                ));
            }

            return items;
        }

        return [];
    }
}

export class NamespaceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly iconName?: string,
        public readonly namespace?: string
    ) {
        super(label, collapsibleState);
        
        this.contextValue = contextValue;
        
        if (iconName) {
            this.iconPath = new vscode.ThemeIcon(iconName);
        }

        // Set commands for actionable items
        if (contextValue === 'connect-action') {
            this.command = {
                command: 'telepresence.connectNamespace',
                title: 'Connect to Namespace'
            };
        } else if (contextValue === 'disconnect-namespace') {
            this.command = {
                command: 'telepresence.disconnectNamespace',
                title: 'Disconnect from Namespace'
            };
        }
    }
}

// ===========================================
// ACTIVE INTERCEPTIONS PROVIDER
// ===========================================
export class InterceptionsTreeProvider implements vscode.TreeDataProvider<InterceptionTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<InterceptionTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<InterceptionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<InterceptionTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    constructor(private telepresenceManager: TelepresenceManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: InterceptionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: InterceptionTreeItem): Promise<InterceptionTreeItem[]> {
        if (!element) {
            const sessions = this.telepresenceManager.getSessions();
            
            if (sessions.length === 0) {
                const connectedNamespace = this.telepresenceManager.getConnectedNamespace();
                
                if (connectedNamespace) {
                    return [new InterceptionTreeItem(
                        '🎯 Intercept Traffic',
                        vscode.TreeItemCollapsibleState.None,
                        'intercept-action',
                        'target'
                    )];
                } else {
                    return [new InterceptionTreeItem(
                        'Connect to namespace first',
                        vscode.TreeItemCollapsibleState.None,
                        'no-namespace',
                        'warning'
                    )];
                }
            }

            // Mostrar sesiones activas
            return sessions.map(session => {
                const item = new InterceptionTreeItem(
                    session.originalService || session.deployment,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'active-session',
                    this.getSessionIcon(session.status),
                    session
                );
                
                item.description = `${session.namespace}:${session.localPort}`;
                item.tooltip = `${session.originalService} in ${session.namespace}\n` +
                            `Local Port: ${session.localPort}\n` +
                            `Status: ${session.status}`;
                
                return item;
            });
        }

        if (element.contextValue === 'active-session' && element.session) {
            // Mostrar detalles de la sesión
            const session = element.session;
            const items: InterceptionTreeItem[] = [];

            items.push(new InterceptionTreeItem(
                `Status: ${session.status}`,
                vscode.TreeItemCollapsibleState.None,
                'session-detail',
                this.getSessionIcon(session.status)
            ));

            items.push(new InterceptionTreeItem(
                `Port: ${session.localPort}`,
                vscode.TreeItemCollapsibleState.None,
                'session-detail',
                'port'
            ));

            items.push(new InterceptionTreeItem(
                'Disconnect',
                vscode.TreeItemCollapsibleState.None,
                'disconnect-session',
                'debug-stop',
                session
            ));

            return items;
        }

        return [];
    }

    private getSessionIcon(status: string): string {
        switch (status) {
            case 'connected': return 'debug-start';
            case 'connecting': return 'loading';
            case 'disconnecting': return 'debug-stop';
            case 'error': return 'error';
            default: return 'circle-outline';
        }
    }
}

export class InterceptionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly iconName?: string,
        public readonly session?: TelepresenceSession
    ) {
        super(label, collapsibleState);
        
        this.contextValue = contextValue;
        
        if (iconName) {
            this.iconPath = new vscode.ThemeIcon(iconName);
        }

        // Set commands for actionable items
        if (contextValue === 'intercept-action') {
            this.command = {
                command: 'telepresence.interceptTraffic',
                title: 'Intercept Traffic'
            };
        } else if (contextValue === 'disconnect-session' && session) {
            this.command = {
                command: 'telepresence.disconnectFromTree',
                title: 'Disconnect Session',
                arguments: [session.id]
            };
        }
    }
}

// ===========================================
// TELEPRESENCE STATUS PROVIDER
// ===========================================
export class StatusTreeProvider implements vscode.TreeDataProvider<StatusTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StatusTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<StatusTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StatusTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private lastStatus: any = null;

    constructor(private telepresenceManager: TelepresenceManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: StatusTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: StatusTreeItem): Promise<StatusTreeItem[]> {
        if (!element) {
            const items: StatusTreeItem[] = [];
            
            try {
                // Obtener estado de telepresence
                const status = await this.telepresenceManager.getFormattedTelepresenceStatus();
                this.lastStatus = status;
                
                // Daemon status
                items.push(new StatusTreeItem(
                    `Daemon: ${status.daemonStatus}`,
                    vscode.TreeItemCollapsibleState.None,
                    'daemon-status',
                    this.getDaemonIcon(status.daemonStatus)
                ));

                // Connection status
                items.push(new StatusTreeItem(
                    `Connection: ${status.connectionStatus}`,
                    vscode.TreeItemCollapsibleState.None,
                    'connection-status',
                    this.getConnectionIcon(status.connectionStatus)
                ));

                // Interceptions summary
                if (status.interceptions && status.interceptions.length > 0) {
                    const interceptedCount = status.interceptions.filter(i => i.status === 'intercepted').length;
                    const availableCount = status.interceptions.filter(i => i.status === 'available').length;
                    
                    items.push(new StatusTreeItem(
                        `Intercepted: ${interceptedCount}`,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'intercepted-list',
                        'debug-start'
                    ));

                    if (availableCount > 0) {
                        items.push(new StatusTreeItem(
                            `Available: ${availableCount}`,
                            vscode.TreeItemCollapsibleState.Collapsed,
                            'available-list',
                            'circle-outline'
                        ));
                    }
                } else {
                    items.push(new StatusTreeItem(
                        'No deployments found',
                        vscode.TreeItemCollapsibleState.None,
                        'no-deployments',
                        'circle-slash'
                    ));
                }

                // Last update
                items.push(new StatusTreeItem(
                    `Updated: ${status.timestamp}`,
                    vscode.TreeItemCollapsibleState.None,
                    'timestamp',
                    'clock'
                ));

                return items;

            } catch (error) {
                return [new StatusTreeItem(
                    'Error getting status',
                    vscode.TreeItemCollapsibleState.None,
                    'error',
                    'error'
                )];
            }
        }

        // Expandir listas de intercepted/available
        if (element && (element.contextValue === 'intercepted-list' || element.contextValue === 'available-list')) {
            if (!this.lastStatus || !this.lastStatus.interceptions) {
                return [];
            }

            const targetStatus = element.contextValue === 'intercepted-list' ? 'intercepted' : 'available';
            const filtered = this.lastStatus.interceptions.filter((i: any) => i.status === targetStatus);
            const connectedNamespace = this.telepresenceManager.getConnectedNamespace();
            
            // Carga única de deployments y pods para todo el namespace
            let deploymentsList: Array<{ name: string; namespace: string; replicas: string; available: string; age: string }> = [];
            let podsList: Array<{ name: string; ready: string; status: string; restarts: string; age: string; deployment: string }> = [];
            
            if (connectedNamespace && targetStatus === 'available') {
                try {
                    const kubernetesManager = new KubernetesManager();
                    
                    // Obtener deployments
                    const deployStdout = await kubernetesManager.executeCommand(`kubectl get deployments -n ${connectedNamespace}`);
                    const deployLines = deployStdout.split('\n').slice(1).filter((l: string) => l.trim().length > 0);
                    for (const line of deployLines) {
                        const cols = line.trim().split(/\s+/);
                        if (cols.length >= 5) {
                            const [name, ready, upToDate, available, age] = cols;
                            deploymentsList.push({ 
                                name, 
                                namespace: connectedNamespace, 
                                replicas: ready, 
                                available, 
                                age 
                            });
                        }
                    }
                    
                    // Obtener pods
                    const podsStdout = await kubernetesManager.executeCommand(`kubectl get pods -n ${connectedNamespace}`);
                    const podLines = podsStdout.split('\n').slice(1).filter((l: string) => l.trim().length > 0);
                    for (const line of podLines) {
                        const cols = line.trim().split(/\s+/);
                        if (cols.length >= 5) {
                            const [name, ready, status, restarts, age] = cols;
                            // Extraer deployment del nombre del pod - mejorado para capturar más patrones
                            let deployment = 'unknown';
                            
                            // Patrón estándar: deployment-hash-podid
                            const standardMatch = name.match(/^([a-zA-Z0-9-]+)-[a-f0-9]+-[a-z0-9]+$/);
                            if (standardMatch) {
                                deployment = standardMatch[1];
                            } else {
                                // Patrón con "deploy" en el nombre
                                const deployMatch = name.match(/^([a-zA-Z0-9-]+-deploy)/);
                                if (deployMatch) {
                                    deployment = deployMatch[1];
                                } else {
                                    // Patrón general: tomar todo antes del último guión seguido de caracteres alfanuméricos
                                    const generalMatch = name.match(/^(.+)-[a-z0-9]+$/);
                                    if (generalMatch) {
                                        deployment = generalMatch[1];
                                    }
                                }
                            }
                            
                            podsList.push({ name, ready, status, restarts, age, deployment });
                        }
                    }
                } catch (err) {
                    console.error('Error loading deployments/pods:', err);
                }
            }

            return filtered.map((interception: any) => {
                const namespace = this.telepresenceManager.getConnectedNamespace() || interception.namespace || 'default';
                
                // Para deployments interceptados, no cargar pods (están interceptados)
                const collapsibleState = targetStatus === 'intercepted' ? 
                    vscode.TreeItemCollapsibleState.None : 
                    vscode.TreeItemCollapsibleState.Collapsed;
                
                // Buscar información adicional del deployment si está disponible
                const deploymentInfo = deploymentsList.find(d => d.name === interception.deployment);
                
                const item = new StatusTreeItem(
                    interception.deployment,
                    collapsibleState,
                    'deployment-item',
                    targetStatus === 'intercepted' ? 'debug-start' : 'circle-outline',
                    {
                        deployment: interception.deployment,
                        namespace: namespace,
                        status: interception.status,
                        localPort: interception.localPort,
                        clusterIP: interception.clusterIP,
                        isIntercepted: targetStatus === 'intercepted',
                        deploymentInfo: deploymentInfo,
                        associatedPods: targetStatus === 'available' ? 
                            podsList.filter(p => p.deployment === interception.deployment) : []
                    }
                );
                // Asignar propiedades directamente al tree item
                item.namespace = namespace;
                item.deployment = interception.deployment;
                item.description = '';
                
                // Añadir comando directo con argumentos para el menú contextual
                item.command = {
                    command: 'telepresence.scaleDeployment',
                    title: 'Escalar Deployment',
                    arguments: [{ deployment: interception.deployment, namespace: namespace }]
                };
                
                return item;
            });
        }

        // Mostrar pods bajo cada deployment
        if (element && element.contextValue === 'deployment-item' && element.interception) {
            // Solo mostrar pods si NO es un deployment interceptado
            const interceptionData = element.interception as any;
            if (interceptionData.isIntercepted) {
                return []; // No mostrar pods para deployments interceptados
            }
            
            const pods: StatusTreeItem[] = [];
            const podList = interceptionData.associatedPods || [];
            const namespace = this.telepresenceManager.getConnectedNamespace() || interceptionData.namespace || element.namespace || 'default';
            const deployment = interceptionData.deployment;
            
            for (const pod of podList) {
                const podItem = new StatusTreeItem(
                    pod.name,
                    vscode.TreeItemCollapsibleState.None,
                    'pod-item',
                    pod.status === 'Running' ? 'debug-start' : 'circle-slash',
                    {
                        deployment: deployment,
                        namespace: namespace,
                        podName: pod.name,
                        status: pod.status,
                        age: pod.age,
                        restarts: pod.restarts,
                        ready: pod.ready
                    }
                );
                
                // Recordar datos en el item del pod
                podItem.namespace = namespace;
                podItem.deployment = deployment;
                podItem.podName = pod.name;
                podItem.description = `${pod.status} (${pod.restarts} restarts)`;
                
                pods.push(podItem);
            }
            return pods;
        }

        return [];
    }

    private getDaemonIcon(status: string): string {
        switch (status.toLowerCase()) {
            case 'running': return 'debug-start';
            case 'stopped': return 'debug-stop';
            default: return 'question';
        }
    }

    private getConnectionIcon(status: string): string {
        switch (status.toLowerCase()) {
            case 'connected': return 'plug';
            case 'disconnected': return 'debug-stop';
            case 'error': return 'error';
            default: return 'question';
        }
    }
}

export class StatusTreeItem extends vscode.TreeItem {
    public namespace?: string;
    public deployment?: string;  // Add deployment property
    public podName?: string;     // Add podName property
    
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly iconName?: string,
        public readonly interception?: TelepresenceInterception | {
            deployment?: string;
            namespace: string;
            podName?: string;
            status?: string;
            age?: string;
            restarts?: string;
            ready?: string;
            pods?: Array<{ name: string; ready: string; status: string; restarts: string; age: string }>;
            isIntercepted?: boolean;
            deploymentInfo?: { name: string; namespace: string; replicas: string; available: string; age: string };
            associatedPods?: Array<{ name: string; ready: string; status: string; restarts: string; age: string; deployment: string }>;
        }
    ) {
        super(label, collapsibleState);
        
        this.contextValue = contextValue;
        
        if (iconName) {
            this.iconPath = new vscode.ThemeIcon(iconName);
        }

        // Tooltip for deployment items
        if (contextValue === 'deployment-item' && interception && 'deployment' in interception) {
            let tooltip = `Deployment: ${interception.deployment}\n` +
                          `Namespace: ${interception.namespace}`;
            
            if ('status' in interception) {
                tooltip += `\nStatus: ${interception.status}`;
            }
            if ('localPort' in interception && interception.localPort) {
                tooltip += `\nLocal Port: ${interception.localPort}`;
            }
            if ('clusterIP' in interception && interception.clusterIP) {
                tooltip += `\nCluster IP: ${interception.clusterIP}`;
            }
            if ('deploymentInfo' in interception && interception.deploymentInfo) {
                tooltip += `\nReplicas: ${interception.deploymentInfo.replicas}`;
                tooltip += `\nAge: ${interception.deploymentInfo.age}`;
            }
            if ('isIntercepted' in interception && interception.isIntercepted) {
                tooltip += `\n🎯 Currently Intercepted`;
            }
            
            this.tooltip = tooltip;
            this.contextValue = 'deployment-item';
            this.namespace = interception.namespace;
            this.deployment = interception.deployment;
            this.description = '';
        }
        
        // Tooltip for pod items
        if (contextValue === 'pod-item' && interception && 'podName' in interception) {
            this.tooltip = `Pod: ${interception.podName}\n` +
                          `Deployment: ${interception.deployment}\n` +
                          `Namespace: ${interception.namespace}\n` +
                          `Status: ${interception.status}\n` +
                          `Ready: ${interception.ready}\n` +
                          `Restarts: ${interception.restarts}\n` +
                          `Age: ${interception.age}`;
            this.contextValue = 'pod-item';
            this.namespace = interception.namespace;
            this.deployment = interception.deployment;
            this.podName = interception.podName;
        }
    }
}

// ===========================================
// REGISTRO DE COMANDOS PARA ACTIVITY BAR
// ===========================================
export function registerActivityBarCommands(
    context: vscode.ExtensionContext,
    telepresenceManager: TelepresenceManager,
    namespaceProvider: NamespaceTreeProvider,
    interceptionsProvider: InterceptionsTreeProvider,
    statusProvider: StatusTreeProvider
) {
    // Comando: acciones en deployment (QuickPick)
    const deploymentActionsCommand = vscode.commands.registerCommand('telepresence.deploymentActions', async (namespace: string, deployment: string) => {
        const action = await vscode.window.showQuickPick(['Escalar', 'Reiniciar'], { placeHolder: `Acción para ${deployment}` });
        if (action === 'Escalar') {
            const replicas = await vscode.window.showInputBox({ prompt: `Número de réplicas para ${deployment}` });
            if (replicas && !isNaN(Number(replicas))) {
                const k8s = new KubernetesManager();
                const ok = await k8s.scaleDeployment(namespace, deployment, Number(replicas));
                const message = ok ? `Deployment escalado a ${replicas} réplicas` : `Error al escalar deployment`;
                telepresenceOutputChannel.appendLine(`[Telepresence] ${message}`);
                if (ok) {
                    vscode.window.showInformationMessage(`Deployment escalado a ${replicas} réplicas`);
                } else {
                    vscode.window.showErrorMessage(`Error al escalar deployment`);
                }
                statusProvider.refresh();
            }
        } else if (action === 'Reiniciar') {
            const k8s = new KubernetesManager();
            const ok = await k8s.restartDeployment(namespace, deployment);
            vscode.window.showInformationMessage(ok ? `Deployment reiniciado` : `Error al reiniciar deployment`);
            statusProvider.refresh();
        }
    });
    // Refresh all views
    const refreshAllCommand = vscode.commands.registerCommand('telepresence.refreshActivityBar', () => {
        namespaceProvider.refresh();
        interceptionsProvider.refresh();
        statusProvider.refresh();
    });

    // Comando: escalar deployment
    const scaleDeploymentCommand = vscode.commands.registerCommand('telepresence.scaleDeployment', async (...args: any[]) => {
        // Intentar obtener datos de diferentes fuentes
        let deploymentName: string | undefined;
        let targetNamespace: string | undefined;
        
        // 1. Buscar en los argumentos del comando directo
        if (args.length > 0 && args[0] && typeof args[0] === 'object') {
            const deploymentData = args[0];
            if (deploymentData.deployment && deploymentData.namespace) {
                deploymentName = deploymentData.deployment;
                targetNamespace = deploymentData.namespace;
            }
        }
        
        // 2. Si no hay datos, usar el treeItem si existe
        if (!deploymentName && args[0] && args[0].contextValue === 'deployment-item') {
            const treeItem = args[0];
            deploymentName = treeItem.deployment;
            targetNamespace = treeItem.namespace;
        }
        
        // Obtener datos del namespace conectado
        const connectedNamespace = telepresenceManager.getConnectedNamespace();
        
        if (!connectedNamespace) {
            vscode.window.showErrorMessage('Error: No hay namespace conectado.');
            return;
        }

        // Si no tenemos deployment, usar fallback
        if (!deploymentName) {
            // Fallback: obtener deployments disponibles del status actual
            const status = await telepresenceManager.getFormattedTelepresenceStatus();
            const availableDeployments = status.interceptions?.map((i: any) => i.deployment) || [];
            
            if (availableDeployments.length === 0) {
                vscode.window.showErrorMessage('Error: No hay deployments disponibles.');
                return;
            }
            
            deploymentName = await vscode.window.showQuickPick(availableDeployments, {
                placeHolder: 'Selecciona el deployment a escalar'
            });
            targetNamespace = connectedNamespace;
        }
        
        if (!deploymentName) {
            return;
        }

        const replicas = await vscode.window.showInputBox({
            prompt: `Número de réplicas para ${deploymentName}`,
            placeHolder: '1'
        });
        
        if (replicas && !isNaN(Number(replicas))) {
            const k8s = new KubernetesManager();
            const ok = await k8s.scaleDeployment(targetNamespace || connectedNamespace, deploymentName, Number(replicas));
            const message = ok ? `Deployment ${deploymentName} escalado a ${replicas} réplicas` : `Error al escalar deployment ${deploymentName}`;
            telepresenceOutputChannel.appendLine(`[Telepresence] ${message}`);
            if (ok) {
                vscode.window.showInformationMessage(`Deployment ${deploymentName} escalado a ${replicas} réplicas`);
            } else {
                vscode.window.showErrorMessage(`Error al escalar deployment ${deploymentName}`);
            }
            statusProvider.refresh();
        }
    });

    // Comando: reiniciar deployment
    const restartDeploymentCommand = vscode.commands.registerCommand('telepresence.restartDeployment', async (treeItem?: StatusTreeItem) => {
        // Obtener datos del namespace conectado y status actual
        const connectedNamespace = telepresenceManager.getConnectedNamespace();
        
        if (!connectedNamespace) {
            vscode.window.showErrorMessage('Error: No hay namespace conectado.');
            return;
        }

        // Si el treeItem no viene o es undefined, pedimos al usuario que seleccione un deployment
        let deploymentName: string | undefined;
        
        if (treeItem && treeItem.contextValue === 'deployment-item' && treeItem.deployment) {
            deploymentName = treeItem.deployment;
        } else {
            // Obtener deployments disponibles del status actual
            const status = await telepresenceManager.getFormattedTelepresenceStatus();
            const availableDeployments = status.interceptions?.map((i: any) => i.deployment) || [];
            
            if (availableDeployments.length === 0) {
                vscode.window.showErrorMessage('Error: No hay deployments disponibles.');
                return;
            }
            
            deploymentName = await vscode.window.showQuickPick(availableDeployments, {
                placeHolder: 'Selecciona el deployment a reiniciar'
            });
        }
        
        if (!deploymentName) {
            return;
        }

        const k8s = new KubernetesManager();
        const ok = await k8s.restartDeployment(connectedNamespace, deploymentName);
        vscode.window.showInformationMessage(ok ? `Deployment ${deploymentName} reiniciado` : `Error al reiniciar deployment ${deploymentName}`);
        statusProvider.refresh();
    });

    // Comando: eliminar pod
    const deletePodCommand = vscode.commands.registerCommand('telepresence.deletePod', async (treeItem?: StatusTreeItem) => {
        // Obtener datos del namespace conectado
        const connectedNamespace = telepresenceManager.getConnectedNamespace();
        
        if (!connectedNamespace) {
            vscode.window.showErrorMessage('Error: No hay namespace conectado.');
            return;
        }

        // Si el treeItem no viene o es undefined, pedimos al usuario que seleccione un pod
        let podName: string | undefined;
        let deploymentName: string | undefined;
        
        if (treeItem && treeItem.contextValue === 'pod-item' && treeItem.podName) {
            podName = treeItem.podName;
            deploymentName = treeItem.deployment;
        } else {
            // Obtener pods disponibles usando kubectl
            try {
                const k8s = new KubernetesManager();
                const podsOutput = await k8s.executeCommand(`kubectl get pods -n ${connectedNamespace} --no-headers`);
                const podLines = podsOutput.split('\n').filter(line => line.trim().length > 0);
                const availablePods = podLines.map(line => {
                    const cols = line.trim().split(/\s+/);
                    return cols[0]; // nombre del pod
                });
                
                if (availablePods.length === 0) {
                    vscode.window.showErrorMessage('Error: No hay pods disponibles.');
                    return;
                }
                
                podName = await vscode.window.showQuickPick(availablePods, {
                    placeHolder: 'Selecciona el pod a eliminar'
                });
            } catch (error) {
                vscode.window.showErrorMessage('Error: No se pudieron obtener los pods.');
                return;
            }
        }
        
        if (!podName) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `¿Eliminar pod ${podName}${deploymentName ? ` del deployment ${deploymentName}` : ''}?`,
            { modal: true },
            'Eliminar'
        );
        
        if (confirm === 'Eliminar') {
            const k8s = new KubernetesManager();
            const ok = await k8s.deletePod(connectedNamespace, podName);
            vscode.window.showInformationMessage(ok ? `Pod ${podName} eliminado` : `Error al eliminar pod ${podName}`);
            statusProvider.refresh();
        }
    });

    context.subscriptions.push(
        refreshAllCommand,
        deploymentActionsCommand,
        scaleDeploymentCommand,
        restartDeploymentCommand,
        deletePodCommand
    );
}