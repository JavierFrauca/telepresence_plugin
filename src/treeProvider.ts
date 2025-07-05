import * as vscode from 'vscode';
import { TelepresenceManager, TelepresenceSession } from './telepresenceManager';
import { KubernetesManager } from './kubernetesManager';

export class TelepresenceTreeProvider implements vscode.TreeDataProvider<TelepresenceTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TelepresenceTreeItem | undefined | null | void> = new vscode.EventEmitter<TelepresenceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TelepresenceTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private telepresenceManager: TelepresenceManager, 
                private kubernetesManager: KubernetesManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TelepresenceTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TelepresenceTreeItem): Promise<TelepresenceTreeItem[]> {
        if (!element) {
            // Root level - show sessions and status
            const sessions = this.telepresenceManager.getSessions();
            const items: TelepresenceTreeItem[] = [];

            // Add status items
            const isTelepresenceInstalled = await this.telepresenceManager.checkTelepresenceInstalled();
            const isKubectlInstalled = await this.kubernetesManager.checkKubectlInstalled();
            const isKubeloginInstalled = await this.kubernetesManager.checkKubeloginInstalled();
            const currentContext = await this.kubernetesManager.getCurrentContext();
            const settingsManager = this.telepresenceManager.getSettingsManager();
            const requiredContext = settingsManager.getRequiredContext();

            items.push(new TelepresenceTreeItem(
                `Telepresence: ${isTelepresenceInstalled ? '✅ Installed' : '❌ Missing'}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
                isTelepresenceInstalled ? 'check' : 'error'
            ));

            items.push(new TelepresenceTreeItem(
                `kubectl: ${isKubectlInstalled ? '✅ Installed' : '❌ Missing'}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
                isKubectlInstalled ? 'check' : 'error'
            ));

            items.push(new TelepresenceTreeItem(
                `kubelogin: ${isKubeloginInstalled ? '✅ Installed' : '❌ Missing'}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
                isKubeloginInstalled ? 'check' : 'warning'
            ));

            // Context status with dynamic required context
            let contextStatus = 'check';
            let contextLabel = `Context: ${currentContext || 'Not Set'}`;
            
            if (requiredContext) {
                if (currentContext === requiredContext) {
                    contextLabel = `Context: ✅ ${currentContext}`;
                    contextStatus = 'check';
                } else {
                    contextLabel = `Context: ⚠️ ${currentContext || 'Not Set'} (required: ${requiredContext})`;
                    contextStatus = 'warning';
                }
            } else {
                contextLabel = `Context: ${currentContext || 'Not Set'} (any allowed)`;
                contextStatus = 'check';
            }

            items.push(new TelepresenceTreeItem(
                contextLabel,
                vscode.TreeItemCollapsibleState.None,
                'status',
                contextStatus
            ));


            // Add separator before sessions
            if (sessions.length > 0) {
                items.push(new TelepresenceTreeItem(
                    '─────────────────',
                    vscode.TreeItemCollapsibleState.None,
                    'separator'
                ));

                // Add sessions
                sessions.forEach(session => {
                    const sessionItem = new TelepresenceTreeItem(
                        `${session.deployment}`,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'session',
                        this.getSessionIcon(session.status),
                        session
                    );
                    sessionItem.tooltip = `${session.deployment} in ${session.namespace}\nPort: ${session.localPort}\nStatus: ${session.status}`;
                    items.push(sessionItem);
                });
            } else {
                items.push(new TelepresenceTreeItem(
                    'No active sessions',
                    vscode.TreeItemCollapsibleState.None,
                    'empty',
                    'circle-slash'
                ));
            }

            return items;

        } else if (element.contextValue === 'session' && element.session) {
            // Session details
            const session = element.session;
            const items: TelepresenceTreeItem[] = [];

            items.push(new TelepresenceTreeItem(
                `Namespace: ${session.namespace}`,
                vscode.TreeItemCollapsibleState.None,
                'detail',
                'symbol-namespace'
            ));

            items.push(new TelepresenceTreeItem(
                `Local Port: ${session.localPort}`,
                vscode.TreeItemCollapsibleState.None,
                'detail',
                'port'
            ));

            items.push(new TelepresenceTreeItem(
                `Status: ${session.status}`,
                vscode.TreeItemCollapsibleState.None,
                'detail',
                this.getSessionIcon(session.status)
            ));

            const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000 / 60);
            items.push(new TelepresenceTreeItem(
                `Duration: ${duration}min`,
                vscode.TreeItemCollapsibleState.None,
                'detail',
                'clock'
            ));

            if (session.error) {
                items.push(new TelepresenceTreeItem(
                    `Error: ${session.error}`,
                    vscode.TreeItemCollapsibleState.None,
                    'error',
                    'error'
                ));
            }

            // Add action buttons
            items.push(new TelepresenceTreeItem(
                'Disconnect Session',
                vscode.TreeItemCollapsibleState.None,
                'action-disconnect',
                'debug-stop',
                session
            ));

            return items;
        }

        return [];
    }

    private getSessionIcon(status: string): string {
        switch (status) {
            case 'connected':
                return 'debug-start';
            case 'connecting':
                return 'loading';
            case 'disconnecting':
                return 'debug-stop';
            case 'error':
                return 'error';
            default:
                return 'circle-outline';
        }
    }

    private formatTimeAgo(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}d ago`;
        } else if (hours > 0) {
            return `${hours}h ago`;
        } else if (minutes > 0) {
            return `${minutes}m ago`;
        } else {
            return 'just now';
        }
    }
}

export class TelepresenceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly iconName?: string,
        public readonly session?: TelepresenceSession,
        public readonly connection?: any
    ) {
        super(label, collapsibleState);

        this.contextValue = contextValue;

        if (iconName) {
            this.iconPath = new vscode.ThemeIcon(iconName);
        }

        // Set commands for actionable items
        if (contextValue === 'action-disconnect' && session) {
            this.command = {
                command: 'telepresence.disconnectFromTree',
                title: 'Disconnect Session',
                arguments: [session.id]
            };
        } else if (contextValue === 'action-reconnect' && connection) {
            this.command = {
                command: 'telepresence.reconnectFromTree',
                title: 'Reconnect',
                arguments: [connection]
            };
        }

        // Style different item types
        switch (contextValue) {
            case 'separator':
                this.description = '';
                break;
            case 'session':
                if (session) {
                    this.description = `${session.namespace}:${session.localPort}`;
                    this.resourceUri = vscode.Uri.parse(`telepresence://session/${session.id}`);
                }
                break;
            case 'last-connection':
                if (connection) {
                    this.description = `${connection.namespace}:${connection.localPort}`;
                }
                break;
            case 'detail':
            case 'connection-detail':
                this.description = '';
                break;
            case 'empty':
                this.description = 'Click + to create a new session';
                break;
            case 'namespace-item':
            case 'context-item':
                this.description = 'Click to use';
                break;
        }
    }
}

// Register additional commands for tree view
export function registerTreeViewCommands(context: vscode.ExtensionContext, telepresenceManager: TelepresenceManager, treeProvider: TelepresenceTreeProvider) {
    // Disconnect from tree view
    const disconnectFromTreeCommand = vscode.commands.registerCommand('telepresence.disconnectFromTree', async (sessionId: string) => {
        try {
            await telepresenceManager.disconnectSession(sessionId);
            treeProvider.refresh();
            vscode.window.showInformationMessage('Session disconnected successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to disconnect: ${error}`);
        }
    });

    // Reconnect from tree view
    const reconnectFromTreeCommand = vscode.commands.registerCommand('telepresence.reconnectFromTree', async (connection: any) => {
        try {
            await telepresenceManager.connectSession(connection.namespace, connection.microservice, connection.localPort);
            treeProvider.refresh();
            vscode.window.showInformationMessage(`Reconnected: ${connection.microservice} -> localhost:${connection.localPort}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reconnect: ${error}`);
        }
    });

    // Show session details
    const showSessionDetailsCommand = vscode.commands.registerCommand('telepresence.showSessionDetails', async (sessionId: string) => {
        const session = telepresenceManager.getSession(sessionId);
        if (session) {
            const details = `
Session Details:
• Deployment: ${session.deployment}
• Namespace: ${session.namespace}
• Local Port: ${session.localPort}
• Status: ${session.status}
• Started: ${new Date(session.startTime).toLocaleString()}
• Duration: ${Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000 / 60)} minutes
${session.error ? `• Error: ${session.error}` : ''}
            `;
            
            vscode.window.showInformationMessage(details, { modal: true });
        }
    });

    // Copy session info
    const copySessionInfoCommand = vscode.commands.registerCommand('telepresence.copySessionInfo', async (sessionId: string) => {
        const session = telepresenceManager.getSession(sessionId);
        if (session) {
            const info = `localhost:${session.localPort} -> ${session.deployment}.${session.namespace}`;
            await vscode.env.clipboard.writeText(info);
            vscode.window.showInformationMessage('Session info copied to clipboard');
        }
    });

    // Quick connect from tree
    const quickConnectCommand = vscode.commands.registerCommand('telepresence.quickConnect', async () => {
        vscode.commands.executeCommand('telepresence.connect');
    });

    context.subscriptions.push(
        disconnectFromTreeCommand,
        reconnectFromTreeCommand,
        showSessionDetailsCommand,
        copySessionInfoCommand,
        quickConnectCommand
    );
}