import * as vscode from 'vscode';
import { TelepresenceManager, TelepresenceSession } from './telepresenceManager';
import { KubernetesManager } from './kubernetesManager';
import { i18n } from './i18n/localizationManager';

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

            const installedLabel = i18n.localize('scripts.ui.installed', '✅ Installed');
            const missingLabel = i18n.localize('scripts.ui.missing', '❌ Missing');

            items.push(new TelepresenceTreeItem(
                `${i18n.localize('tree.status.telepresence', 'Telepresence')}: ${isTelepresenceInstalled ? installedLabel : missingLabel}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
                isTelepresenceInstalled ? 'check' : 'error'
            ));

            items.push(new TelepresenceTreeItem(
                `${i18n.localize('tree.status.kubectl', 'kubectl')}: ${isKubectlInstalled ? installedLabel : missingLabel}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
                isKubectlInstalled ? 'check' : 'error'
            ));

            items.push(new TelepresenceTreeItem(
                `${i18n.localize('tree.status.kubelogin', 'kubelogin')}: ${isKubeloginInstalled ? installedLabel : missingLabel}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
                isKubeloginInstalled ? 'check' : 'warning'
            ));

            // Context status with dynamic required context
            let contextStatus = 'check';
            const notSetLabel = i18n.localize('tree.context.notSet', 'Not Set');
            const displayContext = currentContext || notSetLabel;
            let contextLabel = i18n.localize('tree.status.contextLabel', displayContext);
            
            if (requiredContext) {
                if (currentContext === requiredContext) {
                    contextLabel = i18n.localize('tree.status.contextMatch', displayContext);
                    contextStatus = 'check';
                } else {
                    contextLabel = i18n.localize('tree.status.contextRequired', displayContext, requiredContext);
                    contextStatus = 'warning';
                }
            } else {
                contextLabel = i18n.localize('tree.status.contextAny', displayContext);
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
                    sessionItem.tooltip = i18n.localize('tree.session.tooltip', `${session.deployment}`, session.namespace, session.localPort, session.status);
                    items.push(sessionItem);
                });
            } else {
                items.push(new TelepresenceTreeItem(
                    i18n.localize('tree.sessions.none', 'No active sessions'),
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
                i18n.localize('tree.session.detail.namespace', session.namespace),
                vscode.TreeItemCollapsibleState.None,
                'detail',
                'symbol-namespace'
            ));

            items.push(new TelepresenceTreeItem(
                i18n.localize('tree.session.detail.localPort', session.localPort),
                vscode.TreeItemCollapsibleState.None,
                'detail',
                'port'
            ));

            items.push(new TelepresenceTreeItem(
                i18n.localize('tree.session.detail.status', session.status),
                vscode.TreeItemCollapsibleState.None,
                'detail',
                this.getSessionIcon(session.status)
            ));

            const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000 / 60);
            items.push(new TelepresenceTreeItem(
                i18n.localize('tree.session.detail.duration', duration),
                vscode.TreeItemCollapsibleState.None,
                'detail',
                'clock'
            ));

            if (session.error) {
                items.push(new TelepresenceTreeItem(
                    i18n.localize('tree.session.detail.error', session.error),
                    vscode.TreeItemCollapsibleState.None,
                    'error',
                    'error'
                ));
            }

            // Add action buttons
            items.push(new TelepresenceTreeItem(
                i18n.localize('extension.session.disconnect', 'Disconnect Session'),
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
            return i18n.localize('tree.time.daysAgo', days);
        } else if (hours > 0) {
            return i18n.localize('tree.time.hoursAgo', hours);
        } else if (minutes > 0) {
            return i18n.localize('tree.time.minutesAgo', minutes);
        } else {
            return i18n.localize('tree.time.justNow', 'just now');
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
                title: i18n.localize('extension.session.disconnect', 'Disconnect Session'),
                arguments: [session.id]
            };
        } else if (contextValue === 'action-reconnect' && connection) {
            this.command = {
                command: 'telepresence.reconnectFromTree',
                title: i18n.localize('extension.session.reconnect', 'Reconnect'),
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
                this.description = i18n.localize('tree.description.empty', 'Click + to create a new session');
                break;
            case 'namespace-item':
            case 'context-item':
                this.description = i18n.localize('tree.description.context', 'Click to use');
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
            vscode.window.showInformationMessage(i18n.localize('tree.session.disconnectSuccess', 'Session disconnected successfully'));
        } catch (error) {
            vscode.window.showErrorMessage(i18n.localize('tree.session.disconnectError', error instanceof Error ? error.message : String(error)));
        }
    });

    // Reconnect from tree view
    const reconnectFromTreeCommand = vscode.commands.registerCommand('telepresence.reconnectFromTree', async (connection: any) => {
        try {
            await telepresenceManager.connectSession(connection.namespace, connection.microservice, connection.localPort);
            treeProvider.refresh();
            vscode.window.showInformationMessage(i18n.localize('tree.session.reconnected', connection.microservice, connection.localPort));
        } catch (error) {
            vscode.window.showErrorMessage(i18n.localize('tree.session.reconnectError', error instanceof Error ? error.message : String(error)));
        }
    });

    // Show session details
    const showSessionDetailsCommand = vscode.commands.registerCommand('telepresence.showSessionDetails', async (sessionId: string) => {
        const session = telepresenceManager.getSession(sessionId);
        if (session) {
            const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000 / 60);
            const errorLine = session.error ? i18n.localize('tree.session.detail.error', session.error) : '';
            const details = i18n.localize(
                'tree.session.details',
                session.deployment,
                session.namespace,
                session.localPort,
                session.status,
                new Date(session.startTime).toLocaleString(),
                duration,
                errorLine
            );
            
            vscode.window.showInformationMessage(details, { modal: true });
        }
    });

    // Copy session info
    const copySessionInfoCommand = vscode.commands.registerCommand('telepresence.copySessionInfo', async (sessionId: string) => {
        const session = telepresenceManager.getSession(sessionId);
        if (session) {
            const info = `localhost:${session.localPort} -> ${session.deployment}.${session.namespace}`;
            await vscode.env.clipboard.writeText(info);
            vscode.window.showInformationMessage(i18n.localize('tree.session.copied', 'Session info copied to clipboard'));
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