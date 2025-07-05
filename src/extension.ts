import * as vscode from 'vscode';
import { TelepresenceManager } from './telepresenceManager';
import { KubernetesManager, AuthInfo } from './kubernetesManager';
import { TelepresenceWebviewProvider } from './webviewProvider';
import { TelepresenceTreeProvider, registerTreeViewCommands } from './treeProvider';
import { 
    NamespaceTreeProvider, 
    InterceptionsTreeProvider, 
    StatusTreeProvider, 
    registerActivityBarCommands 
} from './telepresenceActivityBarProvider';
import { getPackageInfo, getVersion, getDisplayName } from './packageUtils';
import { TelepresenceOutput } from './output';
import { SimpleKubeLoginProvider } from './simpleKubeLoginProvider';
import { i18n } from './i18n/localizationManager';
import { ThrottleUtility } from './utils/throttleUtility';
import { I18nAuditor } from './utils/i18nAuditor';

export function activate(context: vscode.ExtensionContext) {
    
    // Initialize the localization manager
    i18n.initialize(context.extensionPath).then(() => {
        outputChannel.appendLine(`[Telepresence] 🌐 Localization initialized. Language: ${i18n.getLanguage()}`);
    });
    
    const packageInfo = getPackageInfo();
    const outputChannel = TelepresenceOutput.getChannel();

    outputChannel.appendLine('[Telepresence] 🚀 Telepresence GUI extension is now active!');
    outputChannel.appendLine(`[Telepresence] 📦 Extension version: ${packageInfo.version}`);

    const telepresenceManager = new TelepresenceManager(context.workspaceState);
    const kubernetesManager = new KubernetesManager();
    const webviewProvider = new TelepresenceWebviewProvider(context.extensionUri, telepresenceManager, kubernetesManager);
    
    // Tree Providers para el Activity Bar - 3 vistas específicas
    const treeProvider = new TelepresenceTreeProvider(telepresenceManager, kubernetesManager);
    const namespaceProvider = new NamespaceTreeProvider(telepresenceManager, kubernetesManager);
    const interceptionsProvider = new InterceptionsTreeProvider(telepresenceManager);
    const statusProvider = new StatusTreeProvider(telepresenceManager);

    // Registrar TreeViews en el Activity Bar

    const namespaceTreeView = vscode.window.createTreeView('telepresenceNamespace', {
        treeDataProvider: namespaceProvider,
        showCollapseAll: false
    });

    const interceptionsTreeView = vscode.window.createTreeView('telepresenceInterceptions', {
        treeDataProvider: interceptionsProvider,
        showCollapseAll: false
    });

    const statusTreeView = vscode.window.createTreeView('telepresenceStatus', {
        treeDataProvider: statusProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(
        namespaceTreeView,
        interceptionsTreeView,
        statusTreeView
    );
    
    outputChannel.appendLine('[Telepresence] ✅ Activity Bar views registered successfully');

    // Verificar estado de telepresence al activar
    telepresenceManager.checkCurrentTelepresenceStatus().then(() => {
        outputChannel.appendLine('[Telepresence] ✅ Telepresence status checked on activation');
    }).catch(error => {
        outputChannel.appendLine(`[Telepresence] ⚠️ Could not check telepresence status: ${error}`);
    });

    // Comando para abrir la GUI
    const openGuiCommand = vscode.commands.registerCommand('telepresence.openGui', () => {
        const panel = vscode.window.createWebviewPanel(
            'telepresenceGui',
            'Telepresence Control Panel',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        webviewProvider.setupWebview(panel.webview);
    });

    // NUEVO: Comando para conectar solo al namespace
    const connectNamespaceCommand = vscode.commands.registerCommand('telepresence.connectNamespace', async () => {
        try {
            const settingsManager = telepresenceManager.getSettingsManager();
            const allNamespaces = await kubernetesManager.getNamespaces();
            const namespaceOptions = [...new Set([...allNamespaces])];
            
            const namespace = await vscode.window.showQuickPick(namespaceOptions, {
                placeHolder: 'Selecciona el namespace para conectar',
                title: 'Conectar a Namespace'
            });
            
            if (!namespace) {
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Conectando al namespace ${namespace}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Establishing connection...' });
                
                try {
                    await telepresenceManager.connectToNamespace(namespace);
                    vscode.window.showInformationMessage(i18n.localize('extension.namespace.connected', namespace));
                    treeProvider.refresh();
                    namespaceProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(i18n.localize('extension.namespace.connectError', error));
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(i18n.localize('extension.error.generic', error));
        }
    });

    // NUEVO: Comando para desconectar del namespace
    const disconnectNamespaceCommand = vscode.commands.registerCommand('telepresence.disconnectNamespace', async () => {
        try {
            const currentNamespace = telepresenceManager.getConnectedNamespace();
            
            if (!currentNamespace) {
                vscode.window.showInformationMessage('No namespace connected');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Disconnect from namespace '${currentNamespace}'? This will also disconnect all active interceptions.`,
                { modal: true },
                'Desconectar'
            );
            
            if (confirm === 'Desconectar') {
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Desconectando del namespace ${currentNamespace}`,
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'Desconectando...' });
                    
                    try {
                        await telepresenceManager.disconnectFromNamespace();
                        vscode.window.showInformationMessage(`Disconnected from namespace '${currentNamespace}'`);
                        treeProvider.refresh();
                        namespaceProvider.refresh();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Error desconectando: ${error}`);
                    }
                });
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    });

    // NUEVO: Comando para interceptar tráfico
    const interceptTrafficCommand = vscode.commands.registerCommand('telepresence.interceptTraffic', async () => {
        try {
            if (!telepresenceManager.isConnectedToNamespace()) {
                const connectFirst = await vscode.window.showWarningMessage(
                    'You must be connected to a namespace first. Do you want to connect now?',
                    'Conectar a Namespace',
                    'Cancelar'
                );
                
                if (connectFirst === 'Conectar a Namespace') {
                    await vscode.commands.executeCommand('telepresence.connectNamespace');
                    return;
                } else {
                    return;
                }
            }

            const currentNamespace = telepresenceManager.getConnectedNamespace()!;

            // Obtener microservicio
            const microservice = await vscode.window.showInputBox({
                prompt: 'Nombre del microservicio (parcial)',
                title: `Interceptar tráfico en ${currentNamespace}`
            });
            
            if (!microservice) {
                return;
            }

            // Obtener puerto local
            const settingsManager = telepresenceManager.getSettingsManager();
            const defaultPort = settingsManager.getDefaultLocalPort().toString();
            const portInput = await vscode.window.showInputBox({
                prompt: 'Local port for interception',
                value: defaultPort,
                title: 'Local Port',
                validateInput: (value) => {
                    const port = parseInt(value);
                    if (isNaN(port) || port < 1 || port > 65535) {
                        return 'Port must be a number between 1 and 65535';
                    }
                    return null;
                }
            });
            
            if (!portInput) {
                return;
            }

            const localPort = parseInt(portInput);

            // Interceptar tráfico
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Interceptando tráfico de ${microservice}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Estableciendo intercepción...' });
                
                try {
                    const sessionId = await telepresenceManager.interceptTraffic(microservice, localPort);
                    
                    vscode.window.showInformationMessage(
                        `Intercepción establecida: ${microservice} -> localhost:${localPort}`
                    );
                    treeProvider.refresh();
                    interceptionsProvider.refresh();
                    statusProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Error interceptando tráfico: ${error}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    });

    // UPDATED: Command to connect (maintain compatibility - uses the complete flow)
    const connectCommand = vscode.commands.registerCommand('telepresence.connect', async () => {
        try {
            const settingsManager = telepresenceManager.getSettingsManager();
            
            // Obtener namespace
            const allNamespaces = await kubernetesManager.getNamespaces();
            const namespaceOptions = [...new Set([...allNamespaces])];
            
            const namespace = await vscode.window.showQuickPick(namespaceOptions, {
                placeHolder: 'Selecciona el namespace',
                title: 'Namespace de Kubernetes'
            });
            
            if (!namespace) {
                return;
            }

            // Obtener microservicio
            const microservice = await vscode.window.showInputBox({
                prompt: 'Microservice name (partial)',
                title: 'Microservice to intercept'
            });
            
            if (!microservice) {
                return;
            }

            // Obtener puerto local
            const defaultPort = settingsManager.getDefaultLocalPort().toString();
            const portInput = await vscode.window.showInputBox({
                prompt: 'Puerto local para el mapeo',
                value: defaultPort,
                title: 'Puerto Local',
                validateInput: (value) => {
                    const port = parseInt(value);
                    if (isNaN(port) || port < 1 || port > 65535) {
                        return 'Puerto debe ser un número entre 1 y 65535';
                    }
                    return null;
                }
            });
            
            if (!portInput) {
                return;
            }

            const localPort = parseInt(portInput);

            // Conectar (usando el método legacy que maneja los 2 pasos automáticamente)
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Estableciendo conexión Telepresence',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Conectando...' });
                
                try {
                    const sessionId = await telepresenceManager.connectSession(namespace, microservice, localPort);
                    
                    vscode.window.showInformationMessage(
                        `Connection established: ${microservice} -> localhost:${localPort}`
                    );
                    
                    // Update tree views
                    treeProvider.refresh();
                    namespaceProvider.refresh();
                    interceptionsProvider.refresh();
                    statusProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Error connecting: ${error}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    });

    // UPDATED: Command to disconnect (now handles interceptions)
    const disconnectCommand = vscode.commands.registerCommand('telepresence.disconnect', async () => {
        const sessions = telepresenceManager.getSessions();
        
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No active interceptions');
            return;
        }

        if (sessions.length === 1) {
            // Solo una intercepción, desconectar directamente
            const session = sessions[0];
            const confirm = await vscode.window.showWarningMessage(
                `¿Desconectar intercepción de ${session.originalService || session.deployment}?`,
                { modal: true },
                'Desconectar'
            );
            
            if (confirm === 'Desconectar') {
                try {
                    await telepresenceManager.disconnectInterception(session.id);
                    
                    vscode.window.showInformationMessage('Intercepción desconectada');
                    treeProvider.refresh();
                    interceptionsProvider.refresh();
                    statusProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Error al desconectar: ${error}`);
                }
            }
        } else {
            // Múltiples intercepciones, mostrar selector
            const options = sessions.map(session => ({
                label: session.originalService || session.deployment,
                description: `${session.namespace}:${session.localPort}`,
                detail: `Estado: ${session.status}`,
                sessionId: session.id
            }));

            options.push({
                label: '⛔ Disconnect all interceptions',
                description: 'Disconnect all interceptions (maintain namespace)',
                detail: 'Cleans all interceptions but maintains namespace connection',
                sessionId: 'all-interceptions'
            });

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Select interception to disconnect',
                title: 'Disconnect Interception'
            });

            if (selected) {
                try {
                    if (selected.sessionId === 'all-interceptions') {
                        await telepresenceManager.disconnectAllInterceptions();
                        vscode.window.showInformationMessage('Todas las intercepciones desconectadas');
                    } else {
                        await telepresenceManager.disconnectInterception(selected.sessionId);
                        vscode.window.showInformationMessage(`Intercepción ${selected.label} desconectada`);
                    }
                    treeProvider.refresh();
                    interceptionsProvider.refresh();
                    statusProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Error al desconectar: ${error}`);
                }
            }
        }
    });

    // El comando openClusterLoginCommand ha sido eliminado y reemplazado por loginToKubernetesCommand

    // NUEVO: Comando para login simple a Kubernetes
    const loginToKubernetesCommand = vscode.commands.registerCommand('telepresence.loginToKubernetes', async () => {
        try {
            // Crear el panel de webview para el login simple
            const panel = vscode.window.createWebviewPanel(
                'telepresenceKubeLogin',
                i18n.localize('login.title', 'Login to Kubernetes'),
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [context.extensionUri]
                }
            );

            // Configuramos el webview con nuestro nuevo SimpleKubeLoginProvider
            const simpleLoginProvider = new SimpleKubeLoginProvider(context.extensionUri, kubernetesManager);
            simpleLoginProvider.setupWebview(panel.webview);
        } catch (error) {
            vscode.window.showErrorMessage(`Error al iniciar login: ${error}`);
        }
    });
    
    // Resto de comandos existentes...
    const installTelepresenceCommand = vscode.commands.registerCommand('telepresence.installTelepresence', async () => {
        try {
            await telepresenceManager.installTelepresence();
            vscode.window.showInformationMessage('Proceso de instalación de Telepresence iniciado');
        } catch (error) {
            vscode.window.showErrorMessage(`Error al instalar Telepresence: ${error}`);
        }
    });

    const installKubeloginCommand = vscode.commands.registerCommand('telepresence.installKubelogin', async () => {
        try {
            await kubernetesManager.installKubelogin();
            vscode.window.showInformationMessage('Proceso de instalación de Kubelogin iniciado');
        } catch (error) {
            vscode.window.showErrorMessage(`Error al instalar Kubelogin: ${error}`);
        }
    });

    const installKubectlCommand = vscode.commands.registerCommand('telepresence.installKubectl', async () => {
        try {
            await kubernetesManager.installKubectl();
            vscode.window.showInformationMessage('Proceso de instalación de Kubectl iniciado');
        } catch (error) {
            vscode.window.showErrorMessage(`Error al instalar Kubectl: ${error}`);
        }
    });

    const refreshStatusCommand = vscode.commands.registerCommand('telepresence.refreshStatus', () => {
        treeProvider.refresh();
        namespaceProvider.refresh();
        interceptionsProvider.refresh();
        statusProvider.refresh();
        vscode.window.showInformationMessage('Status updated');
    });

    const showConfigCommand = vscode.commands.registerCommand('telepresence.showConfig', () => {
        const config = vscode.workspace.getConfiguration('telepresence');
        const settingsManager = telepresenceManager.getSettingsManager();
        
        const configInfo = {
            'Default namespace': config.get('defaultNamespace') || 'Not configured',
            'Default local port': config.get('defaultLocalPort') || 5002,
            'Required context': config.get('requiredContext') || 'Any',
            'Remember last connection': config.get('rememberLastConnection') ? 'Yes' : 'No',
            'Show context warnings': config.get('showContextWarning') ? 'Yes' : 'No',
            'Refresh interval': config.get('autoRefreshInterval') + 's' || '30s',
            'Namespace connection': telepresenceManager.isConnectedToNamespace() ? 
                telepresenceManager.getConnectedNamespace() : 'Disconnected',
            'Active interceptions': telepresenceManager.getSessions().length
        };

        const message = Object.entries(configInfo)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');

        vscode.window.showInformationMessage(message, { modal: true });
    });

    const showVersionCommand = vscode.commands.registerCommand('telepresence.showVersion', async () => {
        try {
            
            // Verificar versiones de herramientas instaladas
            let telepresenceVersion = 'Not installed';
            let kubectlVersion = 'Not installed';
            let kubeloginVersion = 'Not installed';
            
            try {
                const telepresenceOutput = await telepresenceManager.executeCommand('telepresence version');
                const telepresenceMatch = telepresenceOutput.match(/telepresence\s+(\d+\.\d+\.\d+)/i);
                if (telepresenceMatch) {
                    telepresenceVersion = telepresenceMatch[1];
                } else {
                    telepresenceVersion = 'Installed (version not detected)';
                }
            } catch (error) {
                telepresenceVersion = 'Not installed';
            }
            
            try {
                const kubectlOutput = await telepresenceManager.executeCommand('kubectl version --client --short');
                const kubectlMatch = kubectlOutput.match(/Client Version:\s*v?(\d+\.\d+\.\d+)/i);
                if (kubectlMatch) {
                    kubectlVersion = kubectlMatch[1];
                } else {
                    kubectlVersion = 'Installed (version not detected)';
                }
            } catch (error) {
                kubectlVersion = 'Not installed';
            }
            
            try {
                const kubeloginOutput = await telepresenceManager.executeCommand('kubelogin --version');
                const kubeloginMatch = kubeloginOutput.match(/kubelogin\s+version\s+v?(\d+\.\d+\.\d+)/i);
                if (kubeloginMatch) {
                    kubeloginVersion = kubeloginMatch[1];
                } else {
                    kubeloginVersion = 'Installed (version not detected)';
                }
            } catch (error) {
                kubeloginVersion = 'Not installed';
            }

            const currentContext = await kubernetesManager.getCurrentContext();
            const settingsManager = telepresenceManager.getSettingsManager();
            const requiredContext = settingsManager.getRequiredContext();
            
            const connectedNamespace = telepresenceManager.getConnectedNamespace();
            const activeSessions = telepresenceManager.getSessions().length;
            
            const versionInfo = `
    
    ${packageInfo.displayName}
    📦 Versión de la extensión: ${packageInfo.version}

    🔧 Herramientas instaladas:
    • Telepresence: ${telepresenceVersion}
    • kubectl: ${kubectlVersion}
    • kubelogin: ${kubeloginVersion}

    ☸️ Kubernetes Context:
    • Current: ${currentContext || 'Not configured'}
    • Required: ${requiredContext || 'Any'}

    🔌 Estado de Telepresence:
    • Connected namespace: ${connectedNamespace || 'None'}
    • Active interceptions: ${activeSessions}

    📊 Sistema:
    • Plataforma: ${process.platform}
    • Arquitectura: ${process.arch}

    🔗 Enlaces útiles:
    • Documentación: https://github.com/JavierFrauca/telepresence_plugin
    • Issues: https://github.com/JavierFrauca/telepresence_plugin/issues
            `.trim();

            const action = await vscode.window.showInformationMessage(
                versionInfo,
                { 
                    modal: true,
                    detail: 'Información completa de la extensión Telepresence GUI'
                },
                'Copy Info',
                'Open GitHub',
                'Check for Updates'
            );

            if (action === 'Copy Info') {
                await vscode.env.clipboard.writeText(versionInfo);
                vscode.window.showInformationMessage('Information copied to clipboard');
            } else if (action === 'Open GitHub') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/JavierFrauca/telepresence_plugin'));
            } else if (action === 'Check for Updates') {
                vscode.window.showInformationMessage('Checking for updates in VS Code Marketplace...');
                vscode.commands.executeCommand('workbench.extensions.action.checkForUpdates');
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Error al obtener información de versión: ${error}`);
        }
    });

    const checkAuthCommand = vscode.commands.registerCommand('telepresence.checkAuth', async () => {
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Verificando autenticación del cluster',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Conectando al cluster...' });
                
                const authInfo = await kubernetesManager.getClusterAuthInfo();
                
                if (!authInfo.needsAuth) {
                    vscode.window.showInformationMessage(`✅ Successfully authenticated in cluster ${authInfo.provider}`);
                } else {
                    let message = `🔐 ${authInfo.authType} authentication required for cluster ${authInfo.provider}`;
                    const actions = authInfo.authType === 'kubelogin' ? ['Azure Login', 'Configurar Azure'] : ['Configurar kubectl'];
                    
                    const action = await vscode.window.showWarningMessage(message, ...actions);
                    
                    if (action === 'Azure Login') {
                        await vscode.commands.executeCommand('telepresence.kubelogin');
                    } else if (action === 'Configurar Azure') {
                        await vscode.commands.executeCommand('telepresence.kubeloginConfig');
                    }
                }
                
                treeProvider.refresh();
                namespaceProvider.refresh();
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error verificando autenticación: ${error}`);
        }
    });

    const refreshNamespaceCommand = vscode.commands.registerCommand('telepresence.refreshNamespace', () => {
        outputChannel.appendLine('[Telepresence] 🔄 Manual refresh: Namespace view');
        namespaceProvider.refresh();
        vscode.window.showInformationMessage('Namespace view updated');
    });

    const refreshInterceptionsCommand = vscode.commands.registerCommand('telepresence.refreshInterceptions', () => {
        outputChannel.appendLine('[Telepresence] 🔄 Manual refresh: Interceptions view');
        interceptionsProvider.refresh();
        vscode.window.showInformationMessage('Interceptions view updated');
    });

    const refreshTelepresenceStatusCommand = vscode.commands.registerCommand('telepresence.refreshTelepresenceStatus', () => {
        outputChannel.appendLine('[Telepresence] 🔄 Manual refresh: Telepresence Status view');
        statusProvider.refresh();
        vscode.window.showInformationMessage('Telepresence Status updated');
    });
    // Registrar comandos del tree view principal y activity bar
    registerTreeViewCommands(context, telepresenceManager, treeProvider);
    registerActivityBarCommands(context, telepresenceManager, namespaceProvider, interceptionsProvider, statusProvider);    // Registrar todos los comandos
    context.subscriptions.push(
        openGuiCommand,
        // openClusterLoginCommand eliminado ya que fue reemplazado por loginToKubernetesCommand
        connectNamespaceCommand,        
        disconnectNamespaceCommand,     
        interceptTrafficCommand,        
        connectCommand,
        disconnectCommand,
        installTelepresenceCommand,
        installKubeloginCommand,
        installKubectlCommand,
        refreshNamespaceCommand,
        refreshInterceptionsCommand,
        refreshTelepresenceStatusCommand,                      
        refreshStatusCommand,
        showConfigCommand,
        showVersionCommand,
        checkAuthCommand,
        loginToKubernetesCommand, // Único comando de login
        I18nAuditor.registerCommand(context) // Comando para auditar internacionalización
    );

    // Auto-refresh
    const config = vscode.workspace.getConfiguration('telepresence');
    const generalRefreshInterval = config.get<number>('generalRefreshInterval') || 15;
    const telepresenceRefreshInterval = config.get<number>('telepresenceRefreshInterval') || 5;

    // Aplicar throttling a las funciones de actualización
    const throttledNamespaceRefresh = ThrottleUtility.throttle(() => {
        namespaceProvider.refresh();
    }, 1000); // Throttle a 1 segundo como mínimo

    const throttledTreeRefresh = ThrottleUtility.throttle(() => {
        treeProvider.refresh();
    }, 1000);

    const throttledInterceptionsRefresh = ThrottleUtility.throttle(() => {
        interceptionsProvider.refresh();
    }, 1000);

    const throttledStatusRefresh = ThrottleUtility.throttle(() => {
        statusProvider.refresh();
    }, 1000);

    const generalIntervalId = setInterval(() => {
        throttledTreeRefresh();
        throttledNamespaceRefresh();
    }, generalRefreshInterval * 1000);

    const telepresenceIntervalId = setInterval(() => {
        throttledInterceptionsRefresh();
        throttledStatusRefresh();
    }, telepresenceRefreshInterval * 1000);

    context.subscriptions.push(
        {
            dispose: () => {
                clearInterval(generalIntervalId);
                clearInterval(telepresenceIntervalId);
            },
        }
    );

    // Verificar prerequisitos al iniciar
    telepresenceManager.checkTelepresenceInstalled().then(installed => {
        if (!installed) {
            vscode.window.showWarningMessage(
                'Telepresence is not installed or not found in PATH', 
                'Install Now', 
                'Manual Instructions'
            ).then(selection => {
                if (selection === 'Install Now') {
                    vscode.commands.executeCommand('telepresence.installTelepresence');
                }
            });
        }
    });

    // Verificar kubectl siempre al iniciar
    kubernetesManager.checkKubectlInstalled().then(installed => {
        if (!installed) {
            vscode.window.showWarningMessage(
                'kubectl is not installed or not found in PATH',
                'Install Kubectl',
                'Manual Instructions'
            ).then(selection => {
                if (selection === 'Install Kubectl') {
                    vscode.commands.executeCommand('telepresence.installKubectl');
                }
            });
        }
    });

    // NUEVO: Verificar kubelogin siempre al iniciar (no solo en Azure)
    kubernetesManager.checkKubeloginInstalled().then(installed => {
        if (!installed) {
            vscode.window.showInformationMessage(
                'Kubelogin is recommended for Kubernetes clusters',
                'Install Kubelogin',
                'Dismiss'
            ).then(selection => {
                if (selection === 'Install Kubelogin') {
                    vscode.commands.executeCommand('telepresence.installKubelogin');
                }
            });
        }
    });

    // Verificar kubectl siempre al iniciar
    kubernetesManager.checkKubectlInstalled().then(installed => {
        if (!installed) {
            vscode.window.showWarningMessage(
                'kubectl is not installed or not found in PATH',
                'Install Kubectl',
                'Manual Instructions'
            ).then(selection => {
                if (selection === 'Install Kubectl') {
                    vscode.commands.executeCommand('telepresence.installKubectl');
                }
            });
        }
    });

    // Verificar kubelogin siempre al iniciar (no solo en Azure)
    kubernetesManager.checkKubeloginInstalled().then(installed => {
        if (!installed) {
            vscode.window.showInformationMessage(
                'Kubelogin is recommended for Kubernetes clusters',
                'Install Kubelogin',
                'Dismiss'
            ).then(selection => {
                if (selection === 'Install Kubelogin') {
                    vscode.commands.executeCommand('telepresence.installKubelogin');
                }
            });
        }
    });
}

export function deactivate() {
    const outputChannel = TelepresenceOutput.getChannel();
    outputChannel.appendLine('[Telepresence] Telepresence GUI extension is now deactivated');
}