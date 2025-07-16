import * as vscode from 'vscode';
import { TelepresenceManager, TelepresenceSession, TelepresenceInterception } from './telepresenceManager';
import { KubernetesManager } from './kubernetesManager';

/**
 * Provider para las 3 vistas del Activity Bar:
 * 1. Namespace Connection
 * 2. Active Interceptions  
 * 3. Telepresence Status
 */

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
                    `✅ Connected: ${connectedNamespace}`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'connected-namespace',
                    'debug-start',
                    connectedNamespace
                ));
            } else {
                items.push(new NamespaceTreeItem(
                    '🔌 Connect to Namespace',
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

        // ...existing code...
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

            // Usa el namespace conectado de TelepresenceManager para cargar los pods
            let podInfoByNamespace: Record<string, Record<string, Array<{ name: string; ready: string; status: string; restarts: string; age: string }>>> = {};
            const connectedNamespace = this.telepresenceManager.getConnectedNamespace();
            if (connectedNamespace) {
                try {
                    const kubernetesManager = new KubernetesManager();
                    const stdout = await kubernetesManager.executeCommand(`kubectl get pods -n ${connectedNamespace}`);
                    const lines = stdout.split('\n').slice(1).filter((l: string) => l.trim().length > 0);
                    let podInfoByDeployment: Record<string, Array<{ name: string; ready: string; status: string; restarts: string; age: string }>> = {};
                    for (const line of lines) {
                        const cols = line.trim().split(/\s+/);
                        if (cols.length >= 5) {
                            const [name, ready, status, restarts, age] = cols;
                            // Extraer deployment del nombre del pod
                            const match = name.match(/^([a-zA-Z0-9-]+-deploy)/);
                            const deployment = match ? match[1] : undefined;
                            if (deployment) {
                                if (!podInfoByDeployment[deployment]) podInfoByDeployment[deployment] = [];
                                podInfoByDeployment[deployment].push({ name, ready, status, restarts, age });
                            }
                        }
                    }
                    podInfoByNamespace[String(connectedNamespace)] = podInfoByDeployment;
                } catch (err) {
                    // Si falla, no hay pods en ese namespace
                }
            }

            const targetStatus = element.contextValue === 'intercepted-list' ? 'intercepted' : 'available';
            const filtered = this.lastStatus.interceptions.filter((i: any) => i.status === targetStatus);
            return filtered.map((interception: any) => {
                const nsKey = connectedNamespace ? String(connectedNamespace) : '';
                const pods = podInfoByNamespace[nsKey]?.[interception.deployment] || [];
                return new StatusTreeItem(
                    interception.deployment,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'deployment-item',
                    targetStatus === 'intercepted' ? 'debug-start' : 'circle-outline',
                    { ...interception, pods }
                );
            });
        }

        // Mostrar pods bajo cada deployment
        if (element && element.contextValue === 'deployment-item' && element.interception) {
            const pods: StatusTreeItem[] = [];
            // Mostrar los pods ya cargados en interception.pods
            const podList = (element.interception as any).pods || [];
            for (const pod of podList) {
                pods.push(new StatusTreeItem(
                    `${pod.name} | Ready: ${pod.ready} | Status: ${pod.status} | Restarts: ${pod.restarts} | Age: ${pod.age}`,
                    vscode.TreeItemCollapsibleState.None,
                    'pod-item',
                    pod.status === 'Running' ? 'debug-start' : 'circle-slash',
                    {
                        deployment: element.interception.deployment,
                        namespace: element.interception.namespace,
                        podName: pod.name,
                        status: pod.status,
                        age: pod.age,
                        restarts: pod.restarts,
                        ready: pod.ready
                    }
                ));
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
                          `Namespace: ${interception.namespace}\n` +
                          `Status: ${interception.status}`;
            // Solo si es TelepresenceInterception
            if ('localPort' in interception && interception.localPort) {
                tooltip += `\nLocal Port: ${interception.localPort}`;
            }
            if ('clusterIP' in interception && interception.clusterIP) {
                tooltip += `\nCluster IP: ${interception.clusterIP}`;
            }
            this.tooltip = tooltip;
        }
        // Tooltip for pod items
        if (contextValue === 'pod-item' && interception && 'podName' in interception) {
            this.tooltip = `Pod: ${interception.podName}\n` +
                          `Namespace: ${interception.namespace}\n` +
                          `Status: ${interception.status}\n` +
                          `Age: ${interception.age}\n` +
                          `Restarts: ${interception.restarts}`;
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
    // Refresh all views
    const refreshAllCommand = vscode.commands.registerCommand('telepresence.refreshActivityBar', () => {
        namespaceProvider.refresh();
        interceptionsProvider.refresh();
        statusProvider.refresh();
    });

    context.subscriptions.push(
        refreshAllCommand
    );
}