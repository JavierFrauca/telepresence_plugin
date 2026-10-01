import * as vscode from 'vscode';
import { exec, spawn, ChildProcess, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { InjectedTelepresenceSettingsManager, ConnectionConfig } from './settingsManager';
import { KubernetesManager, AuthInfo, TelepresenceWorkload, formatReplicas } from './kubernetesManager';
import { TelepresenceOutput } from './output';
import { i18n } from './i18n/localizationManager';
import { runShell } from './shell';

const execAsync = promisify(exec);

export interface TelepresenceSession {
    id: string;
    namespace: string;
    deployment: string;           // Nombre completo del deployment (ej: payrollapi-devendi74761)
    originalService: string;      // Nombre original proporcionado por el usuario (ej: payroll)
    localPort: number;
    status: 'connecting' | 'connected' | 'disconnecting' | 'error';
    process?: ChildProcess;
    startTime: Date;
    error?: string;
}

export interface TelepresenceInterception {
    deployment: string;
    namespace: string;
    status: 'intercepted' | 'available' | 'error';
    localPort?: number;
    targetPort?: number;
    interceptedBy?: string;
    clusterIP?: string;
    serviceIP?: string;
    fullDeploymentName?: string; // For operations with telepresence
    replicas?: string; // Información de réplicas del deployment (ej: "2/2")
}

export interface NamespaceResources {
    deployments: Array<{ name: string; namespace: string; replicas: string; available: string; age: string }>;
    pods: Array<{ name: string; ready: string; status: string; restarts: string; age: string; deployment: string }>;
}

export interface TelepresenceStatusSnapshot {
    interceptions: TelepresenceInterception[];
    rawOutput: string;
    connectionStatus: string;
    daemonStatus: string;
    timestamp: string;
    namespaceConnection: NamespaceConnection | null;
    error?: string;
    namespaceResources?: NamespaceResources;
}

// NEW: Interface for namespace connection state
export interface NamespaceConnection {
    namespace: string;
    status: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
    startTime?: Date;
    error?: string;
}

export interface StatusRefreshMetadata {
    autoRefreshInterval: number;
    autoRefreshEnabled: boolean;
    manualOnly: boolean;
    lastTrigger: string | null;
    lastRunStartedAt: number | null;
    lastRunCompletedAt: number | null;
    lastDurationMs: number | null;
    inProgress: boolean;
    lastError: string | null;
}

interface StatusRefreshOptions {
    trigger?: string;
    allowQueue?: boolean;
}

// Versión mínima: "detach" (sustituto de "leave") llegó en 2.30.0 y "--format json" en 2.29.0
export const MIN_TELEPRESENCE_VERSION = '2.30.0';
export const TELEPRESENCE_INSTALL_URL = 'https://telepresence.io/docs/install/client';

function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

// Subconjunto de "telepresence status --format json"
interface TelepresenceStatusJson {
    user_daemon?: {
        running?: boolean;
        status?: string;
        namespace?: string;
        kubernetes_context?: string;
    };
}

export interface ForceQuitOptions {
    uninstallAgents?: boolean;
    clearNamespaceConnection?: boolean;
    resetCaches?: boolean;
    resetStatusSnapshot?: boolean;
    label?: string;
}

export class TelepresenceManager {
    private sessions: Map<string, TelepresenceSession> = new Map();
    private namespaceConnection: NamespaceConnection | null = null; // NEW: Namespace connection state
    private outputChannel: vscode.OutputChannel = TelepresenceOutput.getChannel();
    private settingsManager: InjectedTelepresenceSettingsManager;
    private manualDisconnectTimestamp: number = 0;
    private kubernetesManager: KubernetesManager;
    private namespaceCache: string[] = [];
    private namespaceCacheTimestamp = 0;
    private namespacesChangedEmitter = new vscode.EventEmitter<string[]>();
    public readonly onNamespacesChanged = this.namespacesChangedEmitter.event;
    private namespaceConnectionEmitter = new vscode.EventEmitter<NamespaceConnection | null>();
    public readonly onNamespaceConnectionChanged = this.namespaceConnectionEmitter.event;
    private sessionsChangedEmitter = new vscode.EventEmitter<TelepresenceSession[]>();
    public readonly onSessionsChanged = this.sessionsChangedEmitter.event;
    private statusSnapshot: TelepresenceStatusSnapshot | null = null;
    private statusSnapshotTimestamp = 0;
    private statusSnapshotEmitter = new vscode.EventEmitter<TelepresenceStatusSnapshot>();
    public readonly onStatusSnapshotChanged = this.statusSnapshotEmitter.event;
    private statusUpdatesSuspended = false;
    private statusUpdateSuspendedReason: string | null = null;
    private statusUpdatesSuspendedEmitter = new vscode.EventEmitter<{ suspended: boolean; reason?: string | null }>();
    public readonly onStatusUpdatesSuspendedChanged = this.statusUpdatesSuspendedEmitter.event;
    private statusAutoRefreshIntervalSeconds = 20;
    private statusAutoRefreshTimer: NodeJS.Timeout | null = null;
    private statusRefreshInProgress = false;
    private statusRefreshQueued = false;
    private statusRefreshPromise: Promise<TelepresenceStatusSnapshot | null> | null = null;
    private statusRefreshMetadata: StatusRefreshMetadata = {
        autoRefreshInterval: 20,
        autoRefreshEnabled: true,
        manualOnly: false,
        lastTrigger: null,
        lastRunStartedAt: null,
        lastRunCompletedAt: null,
        lastDurationMs: null,
        inProgress: false,
        lastError: null
    };

    constructor(workspaceState: vscode.Memento) {
        // outputChannel ya inicializado arriba
        this.settingsManager = new InjectedTelepresenceSettingsManager(workspaceState);
        this.kubernetesManager = new KubernetesManager();
    }

    private notifyNamespacesChanged(): void {
        this.namespacesChangedEmitter.fire([...this.namespaceCache]);
    }

    private notifySessionsChanged(): void {
        this.sessionsChangedEmitter.fire(this.getSessions());
    }

    private updateNamespaceConnection(state: NamespaceConnection | null): void {
        if (state) {
            this.namespaceConnection = { ...state };
            this.namespaceConnectionEmitter.fire({ ...this.namespaceConnection });
        } else {
            this.namespaceConnection = null;
            this.namespaceConnectionEmitter.fire(null);
        }
        this.evaluateStatusAutoRefreshLoop(true);
    }

    private emitStatusSnapshot(snapshot: TelepresenceStatusSnapshot): void {
        this.statusSnapshot = snapshot;
        this.statusSnapshotTimestamp = Date.now();
        this.statusSnapshotEmitter.fire({ ...snapshot });
    }

    getCachedStatusSnapshot(): TelepresenceStatusSnapshot | null {
        if (!this.statusSnapshot) {
            return null;
        }

        const clone: TelepresenceStatusSnapshot = {
            ...this.statusSnapshot,
            interceptions: this.statusSnapshot.interceptions.map(interception => ({ ...interception })),
            namespaceConnection: this.statusSnapshot.namespaceConnection
                ? { ...this.statusSnapshot.namespaceConnection }
                : null,
            namespaceResources: this.statusSnapshot.namespaceResources
                ? {
                    deployments: this.statusSnapshot.namespaceResources.deployments.map(dep => ({ ...dep })),
                    pods: this.statusSnapshot.namespaceResources.pods.map(pod => ({ ...pod }))
                }
                : undefined
        };

        return clone;
    }

    getStatusRefreshMetadata(): StatusRefreshMetadata {
        return { ...this.statusRefreshMetadata };
    }

    setStatusAutoRefreshInterval(seconds: number): void {
        const sanitized = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
        this.statusAutoRefreshIntervalSeconds = sanitized;
        this.statusRefreshMetadata.autoRefreshInterval = sanitized;
        this.statusRefreshMetadata.autoRefreshEnabled = sanitized > 0;
        this.statusRefreshMetadata.manualOnly = sanitized <= 0;

        if (sanitized <= 0) {
            this.stopStatusAutoRefreshTimer();
        }

        this.evaluateStatusAutoRefreshLoop(true);
    }

    private stopStatusAutoRefreshTimer(): void {
        if (this.statusAutoRefreshTimer) {
            clearTimeout(this.statusAutoRefreshTimer);
            this.statusAutoRefreshTimer = null;
        }
    }

    private canAutoRefresh(): boolean {
        return this.statusAutoRefreshIntervalSeconds > 0 &&
            this.isConnectedToNamespace() &&
            !this.statusUpdatesSuspended;
    }

    private evaluateStatusAutoRefreshLoop(immediate = false): void {
        if (!this.canAutoRefresh()) {
            this.stopStatusAutoRefreshTimer();
            return;
        }

        if (this.statusAutoRefreshTimer || this.statusRefreshInProgress) {
            return;
        }

        const delay = immediate ? 0 : this.statusAutoRefreshIntervalSeconds * 1000;
        this.statusAutoRefreshTimer = setTimeout(() => {
            this.statusAutoRefreshTimer = null;
            this.autoRefreshTick().catch(error => {
                TelepresenceOutput.appendLine(`⚠️ Auto refresh failed: ${error}`);
            });
        }, delay);
    }

    private async autoRefreshTick(): Promise<void> {
        if (!this.canAutoRefresh()) {
            return;
        }

        await this.refreshStatusSnapshot({ trigger: 'auto', allowQueue: false });
        this.evaluateStatusAutoRefreshLoop();
    }

    async refreshStatusSnapshot(options?: StatusRefreshOptions): Promise<TelepresenceStatusSnapshot | null> {
        const trigger = options?.trigger ?? 'manual';
        const allowQueue = options?.allowQueue ?? true;

        if (this.statusRefreshInProgress) {
            if (allowQueue) {
                this.statusRefreshQueued = true;
            }
            return this.statusRefreshPromise;
        }

        this.statusRefreshInProgress = true;
        this.statusRefreshMetadata.inProgress = true;
        this.statusRefreshMetadata.lastTrigger = trigger;
        this.statusRefreshMetadata.lastRunStartedAt = Date.now();

        const runner = (async () => {
            try {
                const snapshot = await this.getFormattedTelepresenceStatus();
                this.emitStatusSnapshot(snapshot);
                this.statusRefreshMetadata.lastError = null;
                return snapshot;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.statusRefreshMetadata.lastError = errorMessage;
                TelepresenceOutput.appendLine(`⚠️ Status refresh failed [${trigger}]: ${errorMessage}`);
                return null;
            } finally {
                const completedAt = Date.now();
                this.statusRefreshMetadata.lastRunCompletedAt = completedAt;
                if (this.statusRefreshMetadata.lastRunStartedAt) {
                    this.statusRefreshMetadata.lastDurationMs = completedAt - this.statusRefreshMetadata.lastRunStartedAt;
                } else {
                    this.statusRefreshMetadata.lastDurationMs = null;
                }
                this.statusRefreshMetadata.inProgress = false;
                this.statusRefreshInProgress = false;
                this.statusRefreshPromise = null;

                if (this.statusRefreshQueued) {
                    this.statusRefreshQueued = false;
                    this.evaluateStatusAutoRefreshLoop(true);
                } else {
                    this.evaluateStatusAutoRefreshLoop();
                }
            }
        })();

        this.statusRefreshPromise = runner;
        return runner;
    }

    async forceQuitTelepresenceCleanup(options?: ForceQuitOptions): Promise<void> {
        const {
            uninstallAgents = false,
            clearNamespaceConnection = true,
            resetCaches = false,
            resetStatusSnapshot = false,
            label
        } = options ?? {};

        const startTime = Date.now();
        TelepresenceOutput.appendLine(`${'='.repeat(80)}`);
        const modeLabel = label ? ` (${label})` : '';
        TelepresenceOutput.appendLine(`🧹 FORCE QUIT REQUESTED${modeLabel}: Running "telepresence quit -s" to clean stale sessions`);
        TelepresenceOutput.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        TelepresenceOutput.appendLine(`${'='.repeat(80)}`);

        try {
            try {
                const quitOutput = await this.executeCommand('telepresence quit -s');
                TelepresenceOutput.appendLine('✅ telepresence quit -s completed successfully');
                if (quitOutput?.trim()) {
                    TelepresenceOutput.appendLine(quitOutput.trim());
                }
            } catch (error) {
                TelepresenceOutput.appendLine(`⚠️ telepresence quit -s failed: ${error}`);
            }

            if (uninstallAgents) {
                try {
                    const uninstallOutput = await this.executeCommand('telepresence uninstall --all-agents');
                    TelepresenceOutput.appendLine('✅ telepresence uninstall --all-agents completed successfully');
                    if (uninstallOutput?.trim()) {
                        TelepresenceOutput.appendLine(uninstallOutput.trim());
                    }
                } catch (error) {
                    TelepresenceOutput.appendLine(`⚠️ telepresence uninstall --all-agents failed: ${error}`);
                }
            }

            try {
                await this.killTelepresenceDaemons();
                TelepresenceOutput.appendLine('✅ killTelepresenceDaemons executed after quit');
            } catch (error) {
                TelepresenceOutput.appendLine(`⚠️ killTelepresenceDaemons failed: ${error}`);
            }

            // Reset local state so UI reflects cleared environment
            this.sessions.clear();
            this.notifySessionsChanged();
            this.manualDisconnectTimestamp = Date.now();
            if (clearNamespaceConnection) {
                this.updateNamespaceConnection(null);
                TelepresenceOutput.appendLine('ℹ️ Cleared namespace connection state');
            }

            if (resetCaches) {
                this.namespaceCache = [];
                this.namespaceCacheTimestamp = 0;
                this.notifyNamespacesChanged();
                TelepresenceOutput.appendLine('ℹ️ Cleared namespace cache');
            }

            if (resetStatusSnapshot) {
                this.statusSnapshot = null;
                this.statusSnapshotTimestamp = 0;
                TelepresenceOutput.appendLine('ℹ️ Cleared status snapshot cache');
            }

            TelepresenceOutput.appendLine('ℹ️ Cleared cached sessions');

            await this.refreshStatusSnapshot({ trigger: 'forceQuitCleanup', allowQueue: false });
            TelepresenceOutput.appendLine('🔄 Status snapshot refreshed after force quit');
        } finally {
            const duration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`⏱️ Force quit duration: ${duration}ms`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}
`);
        }
    }

    suspendStatusUpdates(reason?: string): void {
        if (this.statusUpdatesSuspended) {
            if (reason) {
                this.statusUpdateSuspendedReason = reason;
                this.statusUpdatesSuspendedEmitter.fire({ suspended: true, reason });
            }
            return;
        }

        this.statusUpdatesSuspended = true;
        this.statusUpdateSuspendedReason = reason ?? null;
        this.statusUpdatesSuspendedEmitter.fire({ suspended: true, reason: this.statusUpdateSuspendedReason });
        this.evaluateStatusAutoRefreshLoop();
    }

    resumeStatusUpdates(): void {
        if (!this.statusUpdatesSuspended) {
            return;
        }

        const reason = this.statusUpdateSuspendedReason;
        this.statusUpdatesSuspended = false;
        this.statusUpdateSuspendedReason = null;
        this.statusUpdatesSuspendedEmitter.fire({ suspended: false, reason });
        this.evaluateStatusAutoRefreshLoop(true);
    }

    areStatusUpdatesSuspended(): boolean {
        return this.statusUpdatesSuspended;
    }

    getStatusUpdateSuspendedReason(): string | null {
        return this.statusUpdateSuspendedReason;
    }

    async refreshNamespaces(options?: { force?: boolean }): Promise<string[]> {
        const force = options?.force ?? false;
        const cacheTtlMs = 30_000;

        if (!force && this.namespaceCache.length > 0) {
            const age = Date.now() - this.namespaceCacheTimestamp;
            if (age < cacheTtlMs) {
                this.notifyNamespacesChanged();
                return [...this.namespaceCache];
            }
        }

        try {
            const namespaces = await this.kubernetesManager.getNamespaces();
            this.namespaceCache = namespaces;
            this.namespaceCacheTimestamp = Date.now();
            this.notifyNamespacesChanged();
            return [...this.namespaceCache];
        } catch (error) {
            TelepresenceOutput.appendLine(`⚠️ Could not refresh namespaces: ${error}`);
            return [...this.namespaceCache];
        }
    }

    async listNamespaces(): Promise<string[]> {
        return this.refreshNamespaces();
    }

    getCachedNamespaces(): string[] {
        return [...this.namespaceCache];
    }

    async checkTelepresenceInstalled(): Promise<boolean> {
        try {
            await execAsync('telepresence version');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Versión del cliente de telepresence (ej: "2.32.1"), o null si no está instalado
     */
    async getTelepresenceVersion(): Promise<string | null> {
        try {
            const { stdout } = await execAsync('telepresence version');
            // Formato: "OSS Client : v2.32.1"
            const match = stdout.match(/Client\s*:\s*v?(\d+\.\d+\.\d+)/i) ?? stdout.match(/v?(\d+\.\d+\.\d+)/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    /**
     * Comprueba que la versión instalada soporta los comandos que usa la extensión
     * (detach llegó en 2.30.0). Si no está instalado devuelve ok para que lo gestione
     * la comprobación de instalación.
     */
    async checkTelepresenceVersion(): Promise<{ ok: boolean; version: string | null }> {
        const version = await this.getTelepresenceVersion();
        if (!version) {
            return { ok: true, version: null };
        }
        return { ok: compareVersions(version, MIN_TELEPRESENCE_VERSION) >= 0, version };
    }

    private async ensureSupportedTelepresenceVersion(): Promise<void> {
        const { ok, version } = await this.checkTelepresenceVersion();
        TelepresenceOutput.appendLine(`📊 Telepresence version: ${version ?? 'unknown'} (minimum ${MIN_TELEPRESENCE_VERSION})`);
        if (!ok) {
            throw new Error(i18n.localize('telepresence.version.unsupported', version, MIN_TELEPRESENCE_VERSION));
        }
    }

    async findMatchingDeployment(namespace: string, microservice: string): Promise<string | null> {
        const deployments = await this.kubernetesManager.getDeploymentsInNamespace(namespace);
        const matching = deployments.find((dep: string) => dep.toLowerCase().includes(microservice.toLowerCase()));
        
        TelepresenceOutput.appendLine(`🔍 Looking for '${microservice}' in namespace '${namespace}'`);
        TelepresenceOutput.appendLine(`📋 Available deployments: ${deployments.join(', ')}`);
        TelepresenceOutput.appendLine(`✅ Found matching deployment: ${matching || 'none'}`);
        
        return matching || null;
    }


    async forceResetConnectionState(): Promise<void> {
        TelepresenceOutput.appendLine(`🔄 Force resetting connection state...`);
        this.updateNamespaceConnection(null);
        TelepresenceOutput.appendLine(`✅ Connection state reset`);
    }

    async connectToNamespace(namespace: string): Promise<void> {
        if (await this.kubernetesManager.checkClusterAuthNeeded()===true)
            {
                TelepresenceOutput.appendLine(`❌ FAILURE: Relogin to cluster`,true);
                return;
            }

        const startTime = Date.now();
        TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
        TelepresenceOutput.appendLine(`🚀 STARTING connectToNamespace(namespace: "${namespace}")`,true);
        TelepresenceOutput.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        TelepresenceOutput.appendLine(`${'='.repeat(80)}`);
        
        // 1. Verificaciones mínimas
        TelepresenceOutput.appendLine(`\n📋 STEP 1: Prerequisites verification`);
        TelepresenceOutput.appendLine(`🔍 Checking if telepresence is installed...`);
        
        const telepresenceInstalled = await this.checkTelepresenceInstalled();
        TelepresenceOutput.appendLine(`📊 Telepresence installed: ${telepresenceInstalled}`);
        
        if (!telepresenceInstalled) {
            TelepresenceOutput.appendLine(`❌ FAILURE: Telepresence is not installed`);
            throw new Error('Telepresence is not installed');
        }

        await this.ensureSupportedTelepresenceVersion();

        TelepresenceOutput.appendLine(`🔍 Getting current kubectl context...`);
        const currentContext = await this.kubernetesManager.getCurrentContext();
        TelepresenceOutput.appendLine(`📊 Current context: "${currentContext}"`);
        
        TelepresenceOutput.appendLine(`☁️ Checking kubelogin...`);
        const kubeloginInstalled = await this.kubernetesManager.checkKubeloginInstalled();
        TelepresenceOutput.appendLine(`📊 Kubelogin installed: ${kubeloginInstalled}`);
            
        if (!kubeloginInstalled) {
            TelepresenceOutput.appendLine(`❌ FAILURE: Kubelogin is required for Azure contexts but is not installed`);
            throw new Error('Kubelogin is required for Azure contexts but is not installed');
        }
        TelepresenceOutput.appendLine(`✅ Azure prerequisites OK`);
        
        // 2. Estado interno
        TelepresenceOutput.appendLine(`\n📋 STEP 2: Setting internal state`);
        TelepresenceOutput.appendLine(`📊 Previous namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
        
    this.updateNamespaceConnection({ namespace, status: 'connecting', startTime: new Date() });
    TelepresenceOutput.appendLine(`📊 New namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
        TelepresenceOutput.appendLine(`✅ Internal state set to 'connecting'`);
        
        // 2.5. Verificar autenticación si es necesario
        if (currentContext) {
            TelepresenceOutput.appendLine(`🔐 Verificando autenticación del cluster...`);
            const authInfo = await this.kubernetesManager.getClusterAuthInfo();
            TelepresenceOutput.appendLine(`📊 Auth check results:`);
            TelepresenceOutput.appendLine(`  - Needs auth: ${authInfo.needsAuth}`);
            TelepresenceOutput.appendLine(`  - Auth type: ${authInfo.authType}`);
            TelepresenceOutput.appendLine(`  - Provider: ${authInfo.provider}`);
        
            if (authInfo.needsAuth) {
                let errorMessage = '';
                let suggestion = '';
                
                switch (authInfo.authType) {
                    case 'kubelogin':
                        errorMessage = i18n.localize('telepresence.auth.azureError');
                        suggestion = i18n.localize('telepresence.auth.azureSuggestion');
                        break;
                        
                    case 'aws':
                        errorMessage = i18n.localize('telepresence.auth.awsError');
                        suggestion = i18n.localize('telepresence.auth.awsSuggestion');
                        break;
                        
                    case 'gcp':
                        errorMessage = i18n.localize('telepresence.auth.gcpError');
                        suggestion = i18n.localize('telepresence.auth.gcpSuggestion');
                        break;
                        
                    default:
                        errorMessage = i18n.localize('telepresence.auth.genericError');
                        suggestion = i18n.localize('telepresence.auth.genericSuggestion');
                }
                
                TelepresenceOutput.appendLine(`❌ FAILURE: ${errorMessage}`);
                TelepresenceOutput.appendLine(`💡 SUGGESTION: ${suggestion}`);
                
                const fullError = i18n.localize('telepresence.auth.combined', errorMessage, suggestion);
                throw new Error(fullError);
            }
            
            TelepresenceOutput.appendLine(`✅ Authentication verified successfully`);
        } else {
            TelepresenceOutput.appendLine(`ℹ️ No context check needed`);
        }


        // Mientras se conecta no se lanzan otros comandos de telepresence (refrescos de estado)
        const wasStatusUpdatesSuspended = this.areStatusUpdatesSuspended();
        if (!wasStatusUpdatesSuspended) {
            this.suspendStatusUpdates(`connectToNamespace:${namespace}`);
        }

        try {
            // 2.9. Cerrar la sesión previa solo si apunta a otro contexto/namespace.
            // "quit" sin -s deja vivo el root daemon: con -s el connect siguiente tiene que esperar
            // a que vuelva a arrancar y puede fallar con "unable to dial root daemon"
            TelepresenceOutput.appendLine(`📋 STEP 2.9: Checking existing telepresence session`);
            const existing = await this.getTelepresenceStatusJson().catch(() => null);
            const existingDaemon = existing?.user_daemon;
            const alreadyConnected = existingDaemon?.status === 'Connected' &&
                existingDaemon.namespace === namespace &&
                (!currentContext || existingDaemon.kubernetes_context === currentContext);

            if (existingDaemon?.status === 'Connected' && !alreadyConnected) {
                TelepresenceOutput.appendLine(`📊 Connected to ${existingDaemon.kubernetes_context}/${existingDaemon.namespace}, quitting session first`);
                try {
                    const quitResult = await this.executeCommand('telepresence quit');
                    TelepresenceOutput.appendLine(`✅ telepresence quit completed: ${quitResult.trim() || '(empty output)'}`);
                } catch (quitError) {
                    TelepresenceOutput.appendLine(`⚠️ telepresence quit failed: ${quitError}`);
                }
            }

            // 4. Conectar como con todo limpio
            TelepresenceOutput.appendLine(`📋 STEP 4: Connecting to namespace`);
            // --context hace que telepresence use ese contexto sin tocar el kubeconfig (sin kubectl)
            const contextArg = currentContext ? ` --context ${currentContext}` : '';
            const connectCommand = `telepresence connect${contextArg} -n ${namespace}`;
            TelepresenceOutput.appendLine(`🔗 Command to execute: "${connectCommand}"`);
            TelepresenceOutput.appendLine(`⏱️ Starting telepresence connect at: ${new Date().toISOString()}`);
            
            const connectStartTime = Date.now();
            try {
                if (alreadyConnected) {
                    TelepresenceOutput.appendLine(`ℹ️ Already connected to ${existingDaemon?.kubernetes_context}/${namespace}, skipping connect`);
                } else {
                    const connectResult = await this.executeCommand(connectCommand);
                    const connectDuration = Date.now() - connectStartTime;

                    TelepresenceOutput.appendLine(`✅ telepresence connect completed in ${connectDuration}ms`);
                    TelepresenceOutput.appendLine(`📊 Connect command output:`);
                    TelepresenceOutput.appendLine(`${connectResult || '(empty output)'}`);
                }

            } catch (connectError) {
                const connectDuration = Date.now() - connectStartTime;
                TelepresenceOutput.appendLine(`❌ telepresence connect FAILED after ${connectDuration}ms`);
                TelepresenceOutput.appendLine(`📊 Connect error details: ${connectError}`);
                throw connectError;
            }
            
            // 5. Estado final
            TelepresenceOutput.appendLine(`📋 STEP 5: Setting final state`);
            const connectionStart = this.namespaceConnection?.startTime ?? new Date();
            this.updateNamespaceConnection({ namespace, status: 'connected', startTime: connectionStart });
            TelepresenceOutput.appendLine(`📊 Final namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
            
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`✅ SUCCESS: connectToNamespace completed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Connected to namespace: "${namespace}"`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);

            await this.refreshStatusSnapshot({ trigger: 'connectToNamespace', allowQueue: false });
            
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`📋 STEP: ERROR HANDLING`);
            TelepresenceOutput.appendLine(`❌ Error occurred: ${error}`);
            TelepresenceOutput.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            
            const errorState: NamespaceConnection = {
                namespace,
                status: 'error',
                startTime: this.namespaceConnection?.startTime,
                error: error instanceof Error ? error.message : String(error)
            };
            this.updateNamespaceConnection(errorState);
            TelepresenceOutput.appendLine(`📊 Error namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
            
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`❌ FAILURE: connectToNamespace failed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Failed namespace: "${namespace}"`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);

            throw error;
        } finally {
            if (!wasStatusUpdatesSuspended) {
                this.resumeStatusUpdates();
            }
        }
    }

    async disconnectFromNamespace(): Promise<void> {
        const startTime = Date.now();
        TelepresenceOutput.appendLine(`${'='.repeat(80)}`);
        TelepresenceOutput.appendLine(`🔄 STARTING disconnectFromNamespace() - GENERAL CLEANUP`,true);
        TelepresenceOutput.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        TelepresenceOutput.appendLine(`${'='.repeat(80)}`);
        
        // Verificar estado inicial - PERO CONTINUAR SIEMPRE
        TelepresenceOutput.appendLine(`📋 STEP 1: Initial state verification`);
        TelepresenceOutput.appendLine(`📊 Current namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);
        TelepresenceOutput.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
        
        const hasActiveConnection = this.namespaceConnection && this.namespaceConnection.status === 'connected';
        const hasActiveSessions = this.sessions.size > 0;
        
        if (!hasActiveConnection && !hasActiveSessions) {
            TelepresenceOutput.appendLine(`ℹ️ No active connections detected - performing general cleanup`);
        } else {
            TelepresenceOutput.appendLine(`📊 Active connection/sessions detected - performing full disconnect`);
        }
        
        const namespace = this.namespaceConnection?.namespace || 'unknown';
        TelepresenceOutput.appendLine(`📊 Target namespace: "${namespace}"`);

        // CAMBIAR: Solo cambiar estado si hay conexión activa
        if (this.namespaceConnection) {
            this.updateNamespaceConnection({
                namespace: this.namespaceConnection.namespace,
                status: 'disconnecting',
                startTime: this.namespaceConnection.startTime
            });
            TelepresenceOutput.appendLine(`📊 Updated namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);
        }
    
        try {
            // 1. Desconectar intercepciones
            TelepresenceOutput.appendLine(`📋 STEP 3: Disconnecting active interceptions`);
            if (this.sessions.size > 0) {
                TelepresenceOutput.appendLine(`📊 Found ${this.sessions.size} active interceptions to disconnect:`);
                Array.from(this.sessions.values()).forEach((session, index) => {
                    TelepresenceOutput.appendLine(`  ${index + 1}. ${session.id} (${session.originalService}) - Status: ${session.status}`);
                });
                
                const disconnectStartTime = Date.now();
                await this.disconnectAllInterceptions();
                const disconnectDuration = Date.now() - disconnectStartTime;
                
                TelepresenceOutput.appendLine(`✅ All interceptions disconnected in ${disconnectDuration}ms`);
                TelepresenceOutput.appendLine(`📊 Remaining sessions: ${this.sessions.size}`);
            } else {
                TelepresenceOutput.appendLine(`ℹ️ No active interceptions to disconnect`);
            }
    
            // 2. telepresence quit -s
            TelepresenceOutput.appendLine(`📋 STEP 4: Executing telepresence quit -s`);
            const quitCommand = 'telepresence quit -s';
            TelepresenceOutput.appendLine(`🛑 Command to execute: "${quitCommand}"`);
            TelepresenceOutput.appendLine(`⏱️ Starting telepresence quit -s at: ${new Date().toISOString()}`);

            const quitStartTime = Date.now();
            try {
                const quitResult = await this.executeCommand(quitCommand);
                const quitDuration = Date.now() - quitStartTime;

                TelepresenceOutput.appendLine(`✅ telepresence quit -s completed in ${quitDuration}ms`);
                TelepresenceOutput.appendLine(`📊 Quit command output:`);
                TelepresenceOutput.appendLine(`${quitResult || '(empty output)'}`);
                
            } catch (quitError) {
                const quitDuration = Date.now() - quitStartTime;
                TelepresenceOutput.appendLine(`⚠️ telepresence quit -s FAILED after ${quitDuration}ms`);
                TelepresenceOutput.appendLine(`📊 Quit error details: ${quitError}`);
                TelepresenceOutput.appendLine(`ℹ️ Continuing with process kill (this is expected behavior)`);
            }
            
            // 3. Matar procesos por si acaso
            TelepresenceOutput.appendLine(`\n📋 STEP 5: Killing telepresence processes (safety measure)`);
            TelepresenceOutput.appendLine(`💀 Executing killTelepresenceDaemons()...`);
            
            const killStartTime = Date.now();
            await this.killTelepresenceDaemons();
            const killDuration = Date.now() - killStartTime;
            
            TelepresenceOutput.appendLine(`✅ killTelepresenceDaemons() completed in ${killDuration}ms`);
            
            // 4. Limpiar estado
            TelepresenceOutput.appendLine(`📋 STEP 6: Cleaning internal state`);
            TelepresenceOutput.appendLine(`📊 Previous namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);

            this.manualDisconnectTimestamp = Date.now();
            TelepresenceOutput.appendLine(`📊 Manual disconnect timestamp set: ${this.manualDisconnectTimestamp}`);
            
            this.updateNamespaceConnection(null);
            TelepresenceOutput.appendLine(`📊 New namespaceConnection: ${this.namespaceConnection}`);
                        
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`✅ SUCCESS: disconnectFromNamespace completed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Disconnected from namespace: "${namespace}"`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);
            await this.refreshStatusSnapshot({ trigger: 'disconnectFromNamespace', allowQueue: false });
    
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`📋 STEP: ERROR HANDLING`);
            TelepresenceOutput.appendLine(`❌ Error occurred: ${error}`);
            TelepresenceOutput.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            
            if (this.namespaceConnection) {
                this.updateNamespaceConnection({
                    namespace: this.namespaceConnection.namespace,
                    status: 'error',
                    startTime: this.namespaceConnection.startTime,
                    error: error instanceof Error ? error.message : String(error)
                });
                TelepresenceOutput.appendLine(`📊 Error namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
            }
            
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`❌ FAILURE: disconnectFromNamespace failed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Failed during disconnect from: "${namespace}"`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);
            
            throw error;
        }
        
    }

    async interceptTraffic(microservice: string, localPort: number): Promise<string> {
        if (await this.kubernetesManager.checkClusterAuthNeeded()===true)
            {
                TelepresenceOutput.appendLine(`❌ FAILURE: Relogin to cluster`, true);
                throw new Error('Must be reconect to a cluster first.');
            }

        const startTime = Date.now();
        TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
        TelepresenceOutput.appendLine(`🎯 STARTING interceptTraffic(microservice: "${microservice}", localPort: ${localPort})`,true);
        TelepresenceOutput.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        TelepresenceOutput.appendLine(`${'='.repeat(80)}`);
        
        // 1. Verificar conexión a namespace
        TelepresenceOutput.appendLine(`📋 STEP 1: Namespace connection verification`);
        TelepresenceOutput.appendLine(`📊 Current namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);
        
        if (!this.namespaceConnection || this.namespaceConnection.status !== 'connected') {
            TelepresenceOutput.appendLine(`❌ FAILURE: Not connected to namespace`);
            TelepresenceOutput.appendLine(`📊 namespaceConnection status: ${this.namespaceConnection?.status || 'null'}`);
            throw new Error(i18n.localize('telepresence.intercept.connectFirst'));
        }
    
        const namespace = this.namespaceConnection.namespace;
        TelepresenceOutput.appendLine(`✅ Connected to namespace: "${namespace}"`);
        TelepresenceOutput.appendLine(`📊 Connection start time: ${this.namespaceConnection.startTime}`);
    
        // 2. Buscar deployment
        TelepresenceOutput.appendLine(`📋 STEP 2: Finding matching deployment`);
        TelepresenceOutput.appendLine(`🔍 Looking for deployment containing: "${microservice}"`);
        TelepresenceOutput.appendLine(`📊 Target namespace: "${namespace}"`);
        
        const deploymentStartTime = Date.now();
        const deployment = await this.findMatchingDeployment(namespace, microservice);
        const deploymentDuration = Date.now() - deploymentStartTime;
        
        TelepresenceOutput.appendLine(`📊 Deployment search completed in ${deploymentDuration}ms`);
        TelepresenceOutput.appendLine(`📊 Found deployment: "${deployment || 'null'}"`);
        
        if (!deployment) {
            TelepresenceOutput.appendLine(`❌ FAILURE: No deployment found`);
            TelepresenceOutput.appendLine(`📊 Search criteria: contains "${microservice}" in namespace "${namespace}"`);
            throw new Error(`No deployment found in namespace '${namespace}' containing '${microservice}'`);
        }
    
        // 3. Verificar sesión existente
        TelepresenceOutput.appendLine(`📋 STEP 3: Checking for existing session`);
        const sessionId = deployment;
        TelepresenceOutput.appendLine(`📊 Session ID will be: "${sessionId}"`);
        TelepresenceOutput.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
        
        if (this.sessions.size > 0) {
            TelepresenceOutput.appendLine(`📊 Existing sessions:`);
            Array.from(this.sessions.values()).forEach((session, index) => {
                TelepresenceOutput.appendLine(`  ${index + 1}. ${session.id} (${session.originalService}) - Status: ${session.status}`);
            });
        }
        
        const existingSession = this.sessions.get(sessionId);
        TelepresenceOutput.appendLine(`📊 Existing session for "${sessionId}": ${existingSession ? 'EXISTS' : 'NOT_FOUND'}`);
        
        if (existingSession) {
            TelepresenceOutput.appendLine(`❌ FAILURE: Session already exists`);
            TelepresenceOutput.appendLine(`📊 Existing session details: ${JSON.stringify(existingSession)}`);
            throw new Error(`Interception already exists for '${deployment}' in namespace '${namespace}'`);
        }
    
        let suspendedByOperation = false;
        const suspensionReason = `interceptTraffic:${sessionId}`;
        if (!this.areStatusUpdatesSuspended()) {
            this.suspendStatusUpdates(suspensionReason);
            suspendedByOperation = true;
        }

        // 4. Crear nueva sesión
        TelepresenceOutput.appendLine(`📋 STEP 4: Creating new session`);
        const session: TelepresenceSession = {
            id: sessionId,
            namespace,
            deployment,
            originalService: microservice,
            localPort,
            status: 'connecting',
            startTime: new Date()
        };
        
        TelepresenceOutput.appendLine(`📊 New session object: ${JSON.stringify(session)}`);
        
        this.sessions.set(sessionId, session);
        TelepresenceOutput.appendLine(`✅ Session added to sessions map`);
        TelepresenceOutput.appendLine(`📊 Total sessions now: ${this.sessions.size}`);
        this.notifySessionsChanged();
    
        try {
            // 5. Ejecutar intercept
            TelepresenceOutput.appendLine(`\n📋 STEP 5: Executing telepresence intercept`);
            const portMapping = `${localPort}`;

            TelepresenceOutput.appendLine(`📊 Namespace: "${namespace}"`);
            TelepresenceOutput.appendLine(`📊 Port mapping: "${portMapping}"`);

            // El .env va a la raíz del workspace; el cwd del proceso de VS Code puede no ser escribible
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const envFileArg = workspaceRoot ? ` --env-file "${path.join(workspaceRoot, '.env')}"` : '';
            TelepresenceOutput.appendLine(`📊 Env file: ${workspaceRoot ? path.join(workspaceRoot, '.env') : '(no workspace open, skipped)'}`);

            // Sin comando tras "--", intercept crea la intercepción y termina: se espera su resultado
            // para que cualquier error llegue a la UI en lugar de perderse en un proceso en segundo plano
            const interceptCommand = `telepresence intercept ${deployment} -p ${portMapping} -n ${namespace}${envFileArg} --mount=false`;

            TelepresenceOutput.appendLine(`📊 Intercept command: ${interceptCommand}`);
            TelepresenceOutput.appendLine(`⏱️ Starting telepresence intercept at: ${new Date().toISOString()}`);

            const interceptStartTime = Date.now();
            let interceptOutput: string;
            try {
                interceptOutput = await this.executeCommand(interceptCommand);
            } catch (interceptError) {
                // La intercepción ya está activa en el cluster (por ejemplo, creada antes de recargar VS Code)
                if (String(interceptError).includes('already exists')) {
                    TelepresenceOutput.appendLine(`ℹ️ Intercept for "${deployment}" already exists, reusing it`);
                    interceptOutput = '(intercept already active)';
                } else {
                    throw interceptError;
                }
            }
            TelepresenceOutput.appendLine(`✅ telepresence intercept completed in ${Date.now() - interceptStartTime}ms`);
            TelepresenceOutput.appendLine(`📊 Intercept command output:`);
            TelepresenceOutput.appendLine(`${interceptOutput || '(empty output)'}`);

            session.status = 'connected';
            this.sessions.set(sessionId, session);
            this.notifySessionsChanged();

            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`✅ SUCCESS: interceptTraffic completed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Session ID: "${sessionId}"`);
            TelepresenceOutput.appendLine(`📊 Deployment: "${deployment}"`);
            TelepresenceOutput.appendLine(`📊 Port mapping: ${portMapping}`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);
    
            await this.refreshStatusSnapshot({ trigger: 'interceptTraffic', allowQueue: false });
            return sessionId;
    
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`\n📋 STEP: ERROR HANDLING`);
            TelepresenceOutput.appendLine(`❌ Error occurred: ${error}`,true);
            TelepresenceOutput.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            
            session.status = 'error';
            session.error = error instanceof Error ? error.message : String(error);
            TelepresenceOutput.appendLine(`📊 Session temporary error state: ${JSON.stringify(session)}`);

            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`❌ FAILURE: interceptTraffic failed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Failed session ID: "${sessionId}"`);
            TelepresenceOutput.appendLine(`📊 Failed deployment: "${deployment}"`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);

            if (this.sessions.has(sessionId)) {
                TelepresenceOutput.appendLine(`🧹 Removing temporary interception panel for failed session "${sessionId}"`);
                this.sessions.delete(sessionId);
                this.notifySessionsChanged();
            }

            throw error;
        } finally {
            if (suspendedByOperation) {
                this.resumeStatusUpdates();
            }
        }
    }
    
    async disconnectInterception(sessionId: string): Promise<void> {
        const startTime = Date.now();
        TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
        TelepresenceOutput.appendLine(`🔄 STARTING disconnectInterception(sessionId: "${sessionId}")`,true);
        TelepresenceOutput.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        TelepresenceOutput.appendLine(`${'='.repeat(80)}`);
        
        // STEP 1: Finding session
        TelepresenceOutput.appendLine(`\n📋 STEP 1: Finding session`);
        TelepresenceOutput.appendLine(`📊 Looking for session ID: "${sessionId}"`);
        TelepresenceOutput.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
        
        if (this.sessions.size > 0) {
            TelepresenceOutput.appendLine(`📊 Available sessions:`);
            Array.from(this.sessions.keys()).forEach((id, index) => {
                TelepresenceOutput.appendLine(`  ${index + 1}. "${id}"`);
            });
        } else {
            TelepresenceOutput.appendLine(`📊 No sessions currently active`);
        }
        
        const session = this.sessions.get(sessionId);
        if (!session) {
            TelepresenceOutput.appendLine(`❌ FAILURE: Session not found`);
            TelepresenceOutput.appendLine(`📊 Requested: "${sessionId}"`);
            TelepresenceOutput.appendLine(`📊 Available: [${Array.from(this.sessions.keys()).join(', ')}]`);
            
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`❌ FAILURE: disconnectInterception failed - session not found`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);
            
            throw new Error(`Interception not found: ${sessionId}`);
        }
    
        TelepresenceOutput.appendLine(`✅ Session found`);
        TelepresenceOutput.appendLine(`📊 Session details:`);
        TelepresenceOutput.appendLine(`  - ID: "${session.id}"`);
        TelepresenceOutput.appendLine(`  - Namespace: "${session.namespace}"`);
        TelepresenceOutput.appendLine(`  - Deployment: "${session.deployment}"`);
        TelepresenceOutput.appendLine(`  - Original Service: "${session.originalService}"`);
        TelepresenceOutput.appendLine(`  - Local Port: ${session.localPort}`);
        TelepresenceOutput.appendLine(`  - Status: "${session.status}"`);
        TelepresenceOutput.appendLine(`  - Start Time: ${session.startTime}`);
        TelepresenceOutput.appendLine(`  - Has Process: ${!!session.process}`);
        if (session.process) {
            TelepresenceOutput.appendLine(`  - Process PID: ${session.process.pid}`);
            TelepresenceOutput.appendLine(`  - Process Killed: ${session.process.killed}`);
        }
    
        // STEP 2: Setting disconnecting state
        TelepresenceOutput.appendLine(`\n📋 STEP 2: Setting disconnecting state`);
        TelepresenceOutput.appendLine(`📊 Previous status: "${session.status}"`);
        session.status = 'disconnecting';
        this.sessions.set(sessionId, session);
        TelepresenceOutput.appendLine(`📊 New status: "${session.status}"`);
        TelepresenceOutput.appendLine(`✅ Session state updated`);

        this.notifySessionsChanged();

        const wasStatusUpdatesSuspended = this.areStatusUpdatesSuspended();
        if (!wasStatusUpdatesSuspended) {
            this.suspendStatusUpdates(`disconnectInterception:${sessionId}`);
        }
    
        try {
            // STEP 3: Terminating intercept process
            TelepresenceOutput.appendLine(`\n📋 STEP 3: Terminating intercept process`);
            if (session.process) {
                TelepresenceOutput.appendLine(`💀 Found active process with PID: ${session.process.pid}`);
                TelepresenceOutput.appendLine(`📊 Process killed status: ${session.process.killed}`);
                TelepresenceOutput.appendLine(`📊 Process exit code: ${session.process.exitCode}`);
                TelepresenceOutput.appendLine(`📊 Process signal code: ${session.process.signalCode}`);
                
                const killStartTime = Date.now();
                TelepresenceOutput.appendLine(`🔪 Sending SIGTERM to process...`);
                session.process.kill('SIGTERM');
                TelepresenceOutput.appendLine(`📊 SIGTERM sent to process at: ${new Date().toISOString()}`);
                
                // Esperar terminación graceful
                TelepresenceOutput.appendLine(`⏳ Waiting 2 seconds for graceful termination...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                TelepresenceOutput.appendLine(`📊 After SIGTERM - Killed: ${session.process.killed}, Exit Code: ${session.process.exitCode}`);
                
                if (!session.process.killed && session.process.exitCode === null) {
                    TelepresenceOutput.appendLine(`⚠️ Process still alive after SIGTERM, sending SIGKILL...`);
                    session.process.kill('SIGKILL');
                    TelepresenceOutput.appendLine(`💀 SIGKILL sent to process at: ${new Date().toISOString()}`);
                    
                    TelepresenceOutput.appendLine(`⏳ Waiting 1 second after SIGKILL...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    TelepresenceOutput.appendLine(`📊 After SIGKILL - Killed: ${session.process.killed}, Exit Code: ${session.process.exitCode}`);
                }
                
                const killDuration = Date.now() - killStartTime;
                TelepresenceOutput.appendLine(`✅ Process termination sequence completed in ${killDuration}ms`);
                TelepresenceOutput.appendLine(`📊 Final process state:`);
                TelepresenceOutput.appendLine(`  - Killed: ${session.process.killed}`);
                TelepresenceOutput.appendLine(`  - Exit Code: ${session.process.exitCode}`);
                TelepresenceOutput.appendLine(`  - Signal Code: ${session.process.signalCode}`);
            } else {
                TelepresenceOutput.appendLine(`ℹ️ No active process found for session`);
                TelepresenceOutput.appendLine(`📊 Session was likely already terminated or never had a process`);
            }
    
            // STEP 4: Executing telepresence detach
            TelepresenceOutput.appendLine(`
📋 STEP 4: Executing telepresence detach`);
            const deploymentName = session.deployment;
            const namespace = session.namespace;
    
            TelepresenceOutput.appendLine(`📊 Deployment to detach: "${deploymentName}"`);
            TelepresenceOutput.appendLine(`📊 Namespace: "${namespace}"`);
    
            const detachCommand = `telepresence detach ${deploymentName} -n ${namespace}`;
            TelepresenceOutput.appendLine(`🔓 Command to execute: "${detachCommand}"`);
            TelepresenceOutput.appendLine(`⏱️ Starting telepresence detach at: ${new Date().toISOString()}`);
    
            const leaveStartTime = Date.now();
            try {
                const leaveOutput = await this.executeCommand(detachCommand);
                const leaveDuration = Date.now() - leaveStartTime;
                
                TelepresenceOutput.appendLine(`✅ telepresence detach completed in ${leaveDuration}ms`);
                TelepresenceOutput.appendLine(`📊 Detach command output:`);
                TelepresenceOutput.appendLine(`${leaveOutput || '(empty output)'}`);
                
            } catch (leaveError) {
                const leaveDuration = Date.now() - leaveStartTime;
                TelepresenceOutput.appendLine(`❌ telepresence detach FAILED after ${leaveDuration}ms`);
                TelepresenceOutput.appendLine(`📊 Detach error details: ${leaveError}`);
                TelepresenceOutput.appendLine(`📊 Error type: ${leaveError instanceof Error ? leaveError.constructor.name : typeof leaveError}`);
                
                // Si falla el detach específico, intentar sin -n
                TelepresenceOutput.appendLine(`
🔄 FALLBACK: Attempting telepresence detach without -n...`);
                const genericLeaveStartTime = Date.now();
                try {
                    const genericLeaveCommand = `telepresence detach ${deploymentName}`;
                    TelepresenceOutput.appendLine(`🔓 Fallback command: "${genericLeaveCommand}"`);
                    
                    const genericLeaveOutput = await this.executeCommand(genericLeaveCommand);
                    const genericLeaveDuration = Date.now() - genericLeaveStartTime;
                    
                    TelepresenceOutput.appendLine(`✅ Generic detach successful in ${genericLeaveDuration}ms`);
                    TelepresenceOutput.appendLine(`📊 Generic detach output: ${genericLeaveOutput}`);
                } catch (genericError) {
                    const genericLeaveDuration = Date.now() - genericLeaveStartTime;
                    TelepresenceOutput.appendLine(`❌ Generic detach also failed after ${genericLeaveDuration}ms`);
                    TelepresenceOutput.appendLine(`📊 Generic detach error: ${genericError}`);
                    
                    // Último intento: telepresence detach sin parámetros
                    TelepresenceOutput.appendLine(`
🔄 LAST RESORT: Attempting bare telepresence detach...`);
                    const bareLeaveStartTime = Date.now();
                    try {
                        const bareLeaveOutput = await this.executeCommand('telepresence detach');
                        const bareLeaveDuration = Date.now() - bareLeaveStartTime;
                        
                        TelepresenceOutput.appendLine(`✅ Bare detach successful in ${bareLeaveDuration}ms`);
                        TelepresenceOutput.appendLine(`📊 Bare detach output: ${bareLeaveOutput}`);
                    } catch (bareError) {
                        const bareLeaveDuration = Date.now() - bareLeaveStartTime;
                        TelepresenceOutput.appendLine(`❌ Bare detach failed after ${bareLeaveDuration}ms`);
                        TelepresenceOutput.appendLine(`📊 Bare detach error: ${bareError}`);
                        TelepresenceOutput.appendLine(`⚠️ All detach attempts failed, but continuing with session cleanup`);
                    }
                }
            }
    
            // STEP 5: Cleaning session
            TelepresenceOutput.appendLine(`\n📋 STEP 5: Cleaning session from internal state`);
            TelepresenceOutput.appendLine(`📊 Removing session "${sessionId}" from sessions map`);
            TelepresenceOutput.appendLine(`📊 Sessions before removal: ${this.sessions.size}`);
            
            const sessionExisted = this.sessions.delete(sessionId);
            TelepresenceOutput.appendLine(`📊 Session deletion result: ${sessionExisted}`);
            TelepresenceOutput.appendLine(`📊 Sessions after removal: ${this.sessions.size}`);
            
            if (this.sessions.size > 0) {
                TelepresenceOutput.appendLine(`📊 Remaining sessions:`);
                Array.from(this.sessions.values()).forEach((remainingSession, index) => {
                    TelepresenceOutput.appendLine(`  ${index + 1}. ${remainingSession.id} (${remainingSession.originalService}) - Status: ${remainingSession.status}`);
                });
            } else {
                TelepresenceOutput.appendLine(`📊 No remaining sessions`);
            }

            this.notifySessionsChanged();
            
            // SUCCESS
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`✅ SUCCESS: disconnectInterception completed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Disconnected session: "${sessionId}"`);
            TelepresenceOutput.appendLine(`📊 Deployment: "${deploymentName}"`);
            TelepresenceOutput.appendLine(`📊 Namespace: "${namespace}"`);
            TelepresenceOutput.appendLine(`📊 Original service: "${session.originalService}"`);
            TelepresenceOutput.appendLine(`📊 Local port: ${session.localPort}`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);
            await this.refreshStatusSnapshot({ trigger: `disconnectInterception:${sessionId}`, allowQueue: false });
    
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            TelepresenceOutput.appendLine(`\n📋 STEP: ERROR HANDLING`);
            TelepresenceOutput.appendLine(`❌ Critical error occurred: ${error}`,true);
            TelepresenceOutput.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            TelepresenceOutput.appendLine(`📊 Error message: ${error instanceof Error ? error.message : String(error)}`);
            
            if (error instanceof Error && error.stack) {
                TelepresenceOutput.appendLine(`📊 Error stack trace:`);
                TelepresenceOutput.appendLine(`${error.stack}`);
            }
            
            // Update session with error but don't remove it
            session.status = 'error';
            session.error = error instanceof Error ? error.message : String(error);
            this.sessions.set(sessionId, session);
            TelepresenceOutput.appendLine(`📊 Session updated with error status: ${JSON.stringify(session)}`);

            this.notifySessionsChanged();
            
            TelepresenceOutput.appendLine(`\n${'='.repeat(80)}`);
            TelepresenceOutput.appendLine(`❌ FAILURE: disconnectInterception failed`);
            TelepresenceOutput.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            TelepresenceOutput.appendLine(`📊 Failed session: "${sessionId}"`);
            TelepresenceOutput.appendLine(`📊 Session left in error state for debugging`);
            TelepresenceOutput.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            TelepresenceOutput.appendLine(`${'='.repeat(80)}\n`);
    
            throw error;
        } finally {
            if (!wasStatusUpdatesSuspended) {
                this.resumeStatusUpdates();
            }
        }
    }

    async disconnectAllInterceptions(): Promise<void> {
        const sessionIds = Array.from(this.sessions.keys());
        
        TelepresenceOutput.appendLine(`🔄 Stopping all ${sessionIds.length} traffic interceptions`);
        
        // Desconectar sesiones conocidas individualmente
        const promises = sessionIds.map(async (id: string) => {
            try {
                await this.disconnectInterception(id);
            } catch (err) {
                TelepresenceOutput.appendLine(`Failed to stop interception ${id}: ${err}`);
            }
        });
        
        await Promise.all(promises);
        
        // Limpiar intercepciones que puedan no estar en nuestro estado
        try {
            TelepresenceOutput.appendLine('Cleaning up any remaining interceptions...');
            // Get current list and leave each intercepted deployment
            const interceptions = await this.getTelepresenceInterceptions();
            for (const interception of interceptions) {
                if (interception.status === 'intercepted') {
                    try {
                        await this.executeCommand(`telepresence detach ${interception.fullDeploymentName || interception.deployment}`);
                        TelepresenceOutput.appendLine(`✅ Left: ${interception.deployment}`);
                    } catch (leaveError) {
                        TelepresenceOutput.appendLine(`⚠️ Failed to leave ${interception.deployment}: ${leaveError}`);
                    }
                }
            }
        } catch (cleanupError) {
            TelepresenceOutput.appendLine(`⚠️ Cleanup failed: ${cleanupError}`);
        }

        await this.refreshStatusSnapshot({ trigger: 'disconnectAllInterceptions', allowQueue: false });
    }

    async disconnectSession(sessionId: string): Promise<void> {
        await this.disconnectInterception(sessionId);
    }

    async disconnectAll(): Promise<void> {
        await this.disconnectAllInterceptions();
        
        // Si hay conexión al namespace, también desconectarla
        if (this.namespaceConnection && this.namespaceConnection.status === 'connected') {
            await this.disconnectFromNamespace();
        }
    }

    async connectSession(namespace: string, microservice: string, localPort: number): Promise<string> {
        if (await this.kubernetesManager.checkClusterAuthNeeded()===true)
            {
                TelepresenceOutput.appendLine(`❌ FAILURE: Relogin to cluster`,true);
                throw new Error('Must be reconect to a cluster first.');
            }

        // If we're not connected to the namespace, connect first
        if (!this.namespaceConnection || this.namespaceConnection.status !== 'connected' || 
            this.namespaceConnection.namespace !== namespace) {
            
            // If we're connected to a different namespace, disconnect first
            if (this.namespaceConnection && this.namespaceConnection.status === 'connected') {
                await this.disconnectFromNamespace();
            }
            
            await this.connectToNamespace(namespace);
        }

        // Ahora interceptar el tráfico
        return await this.interceptTraffic(microservice, localPort);
    }

    isConnectedToNamespace(): boolean {
        return this.namespaceConnection !== null && this.namespaceConnection.status === 'connected';
    }

    getConnectedNamespace(): string | null {
        return this.isConnectedToNamespace() ? this.namespaceConnection!.namespace : null;
    }

    getSessions(): TelepresenceSession[] {
        return Array.from(this.sessions.values());
    }

    getSession(sessionId: string): TelepresenceSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Parse telepresence list output and extract structured information
     */
    async getTelepresenceInterceptions(): Promise<TelepresenceInterception[]> {
        if (await this.kubernetesManager.checkClusterAuthNeeded()===true)
            {
                TelepresenceOutput.appendLine(`❌ FAILURE: Relogin to cluster`);
                return[];
            }

        TelepresenceOutput.appendLine(`\n📋 Getting telepresence interceptions...`);
        
        try {
            const namespace = this.namespaceConnection?.namespace || 'default';
            TelepresenceOutput.appendLine(`📊 Using namespace: "${namespace}"`);
            TelepresenceOutput.appendLine(`🔄 Executing: telepresence list -n ${namespace} --format json`);

            const workloads = await this.kubernetesManager.getWorkloads(namespace);
            const interceptions = this.parseWorkloads(workloads, namespace);
            TelepresenceOutput.appendLine(`✅ Parsed ${interceptions.length} interceptions`);

            return interceptions;
        } catch (error) {
            TelepresenceOutput.appendLine(`❌ Failed to get telepresence interceptions: ${error}`);
            return [];
        }
    }

    /**
     * Convierte la salida de "telepresence list --format json" en intercepciones
     */
    private parseWorkloads(workloads: TelepresenceWorkload[], namespace: string): TelepresenceInterception[] {
        return workloads.map(workload => {
            // Un array "*_info" con elementos (intercept_info, y los equivalentes de replace/ingest/wiretap)
            // indica que el workload está enganchado desde un cliente
            const engagements = Object.entries(workload)
                .filter(([key, value]) => /_infos?$/.test(key) && Array.isArray(value) && value.length > 0)
                .flatMap(([, value]) => value as any[]);
            const servicePort = workload.services?.[0]?.ports?.[0]?.port;

            const interception: TelepresenceInterception = {
                deployment: workload.name,
                namespace: workload.namespace || namespace,
                status: engagements.length > 0 ? 'intercepted' : 'available',
                fullDeploymentName: workload.name,
                replicas: formatReplicas(workload),
                targetPort: servicePort
            };

            if (engagements.length > 0) {
                const spec = engagements[0]?.spec ?? engagements[0] ?? {};
                const localPort = Number(spec.target_port ?? spec.targetPort);
                if (localPort) interception.localPort = localPort;
                const podIP = engagements[0]?.pod_ip ?? engagements[0]?.podIp;
                if (podIP) interception.clusterIP = podIP;
            }

            return interception;
        });
    }

    private formatWorkloadsForDisplay(interceptions: TelepresenceInterception[]): string {
        return interceptions
            .map(i => `${i.deployment}: ${i.status === 'intercepted' ? `intercepted${i.localPort ? ` -> localhost:${i.localPort}` : ''}` : 'ready to intercept'} (${i.replicas})`)
            .join('\n');
    }

    /**
     * Get formatted telepresence status with parsed interceptions
     */
    async getFormattedTelepresenceStatus(): Promise<{ 
        interceptions: TelepresenceInterception[];
        rawOutput: string;
        connectionStatus: string;
        daemonStatus: string;
        timestamp: string;
        namespaceConnection: NamespaceConnection | null;
        error?: string;
    }> {
        TelepresenceOutput.appendLine(`📋 Get telepresence status...`,true);
        
        try {
            if (await this.kubernetesManager.checkClusterAuthNeeded()===true)
                {
                    TelepresenceOutput.appendLine(`❌ FAILURE: Relogin to cluster`);
                    return {
                        interceptions: [],
                        rawOutput: 'Authentication required. Please relogin to cluster.',
                        connectionStatus: 'error',
                        daemonStatus: 'unknown',
                        timestamp: new Date().toLocaleTimeString(),
                        namespaceConnection: this.namespaceConnection,
                        error: 'Authentication required. Please relogin to cluster.'
                    };
                }
            let interceptions: TelepresenceInterception[] = [];
            let rawOutput = '';

            TelepresenceOutput.appendLine(`🔍 Getting interceptions list...`);
            try {
                const namespace = this.namespaceConnection?.namespace || 'default';
                TelepresenceOutput.appendLine(`🔄 Executing: telepresence list -n ${namespace} --format json`);

                const workloads = await this.kubernetesManager.getWorkloads(namespace);
                interceptions = this.parseWorkloads(workloads, namespace);
                rawOutput = this.formatWorkloadsForDisplay(interceptions);
                TelepresenceOutput.appendLine(`✅ Interceptions retrieved: ${interceptions.length} found`);
            } catch (listError) {
                const errorStr = listError instanceof Error ? listError.message : String(listError);
                TelepresenceOutput.appendLine(`⚠️ List command failed: ${errorStr}`);
                rawOutput = `Error getting telepresence list: ${errorStr}`;
            }
            
            // 🆕 NUEVA LÓGICA: Sincronizar sesiones con intercepciones detectadas
            TelepresenceOutput.appendLine(`📋 SYNC: Synchronizing sessions with detected interceptions...`);
            TelepresenceOutput.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
            TelepresenceOutput.appendLine(`📊 Detected interceptions: ${interceptions.length}`);
            
            // PASO 1: Crear sesiones para intercepciones activas faltantes
            const interceptedDeployments = interceptions.filter(i => i.status === 'intercepted');
            TelepresenceOutput.appendLine(`📊 Active interceptions: ${interceptedDeployments.length}`);
            
            interceptedDeployments.forEach(interception => {
                const sessionId = interception.fullDeploymentName || interception.deployment;
                
                if (!this.sessions.has(sessionId)) {
                    TelepresenceOutput.appendLine(`➕ Creating session for existing interception: ${sessionId}`);
                    
                    // Extraer nombre original del servicio (quitar sufijos como -devend175444-deploy)
                    let originalService = interception.deployment;
                    
                    // Patrón para microservicios: nombre-devend######-deploy
                    const serviceMatch = interception.deployment.match(/^([^-]+)(?:-devend\d+.*)?$/);
                    if (serviceMatch) {
                        originalService = serviceMatch[1];
                        TelepresenceOutput.appendLine(`📊 Extracted original service: "${originalService}" from "${interception.deployment}"`);
                    } else {
                        TelepresenceOutput.appendLine(`📊 Using full deployment name as service: "${originalService}"`);
                    }
                    
                    // Crear nueva sesión
                    const newSession: TelepresenceSession = {
                        id: sessionId,
                        namespace: interception.namespace,
                        deployment: interception.deployment,
                        originalService: originalService,
                        localPort: interception.localPort || 5001,
                        status: 'connected',
                        startTime: new Date(), // Tiempo aproximado
                        // process: no disponible para intercepciones detectadas
                    };
                    
                    this.sessions.set(sessionId, newSession);
                    TelepresenceOutput.appendLine(`✅ Session created: ${JSON.stringify(newSession)}`);
                } else {
                    TelepresenceOutput.appendLine(`ℹ️ Session already exists for: ${sessionId}`);
                }
            });
            
            // PASO 2: Limpiar sesiones obsoletas (que ya no están interceptadas)
            const sessionIds = Array.from(this.sessions.keys());
            TelepresenceOutput.appendLine(`📊 Checking ${sessionIds.length} existing sessions for cleanup...`);
            
            sessionIds.forEach(sessionId => {
                const session = this.sessions.get(sessionId);
                if (!session) return;
                
                // Buscar si esta sesión todavía tiene intercepción activa
                const stillIntercepted = interceptedDeployments.find(interception => {
                    const deploymentId = interception.fullDeploymentName || interception.deployment;
                    return deploymentId === sessionId;
                });
                
                if (!stillIntercepted) {
                    TelepresenceOutput.appendLine(`🗑️ Removing obsolete session: ${sessionId} (no longer intercepted)`);
                    this.sessions.delete(sessionId);
                } else {
                    TelepresenceOutput.appendLine(`✅ Session still valid: ${sessionId}`);
                }
            });
            
            TelepresenceOutput.appendLine(`📊 Final sessions count: ${this.sessions.size}`);
            if (this.sessions.size > 0) {
                TelepresenceOutput.appendLine(`📊 Active sessions:`);
                Array.from(this.sessions.values()).forEach((session, index) => {
                    TelepresenceOutput.appendLine(`  ${index + 1}. ${session.id} (${session.originalService}) - Status: ${session.status}`);
                });
            }

            this.notifySessionsChanged();
            
            // Verificar status basado en estado real, no solo daemon
            let connectionStatus = 'disconnected';
            let daemonStatus = 'stopped';
            
            TelepresenceOutput.appendLine(`🔍 Getting telepresence status...`);
            
            // Determinar estado basado en nuestro estado interno y intercepciones
            const hasNamespaceConnection = this.namespaceConnection && this.namespaceConnection.status === 'connected';
            const hasActiveInterceptions = interceptions.length > 0 && interceptions.some(i => i.status === 'intercepted');
            
            TelepresenceOutput.appendLine(`📊 Has namespace connection: ${hasNamespaceConnection}`);
            TelepresenceOutput.appendLine(`📊 Has active interceptions: ${hasActiveInterceptions}`);
            TelepresenceOutput.appendLine(`📊 Total interceptions found: ${interceptions.length}`);
            
            if (hasNamespaceConnection || hasActiveInterceptions) {
                connectionStatus = 'connected';
                daemonStatus = 'running';
                TelepresenceOutput.appendLine(`✅ Status: Connected with active session`);
            } else {
                connectionStatus = 'disconnected';
                daemonStatus = 'stopped';
                TelepresenceOutput.appendLine(`📋 Status: Disconnected - no active sessions`);
            }
            
            // Verificación adicional con telepresence status como fallback
            try {
                const status = await this.getTelepresenceStatusJson();

                // Solo override si detectamos algo inesperado
                if (status.user_daemon?.status === 'Connected' && !hasNamespaceConnection && !hasActiveInterceptions) {
                    TelepresenceOutput.appendLine(`⚠️ Daemon shows connected but no internal state - possible inconsistency`);
                    connectionStatus = 'connected';
                    daemonStatus = 'running';
                }
            } catch (statusError) {
                TelepresenceOutput.appendLine(`⚠️ Status command failed: ${statusError}`);
                // Si no podemos ejecutar telepresence status, asumir stopped
                if (!hasNamespaceConnection && !hasActiveInterceptions) {
                    daemonStatus = 'stopped';
                    connectionStatus = 'disconnected';
                }
            }

            const result = {
                interceptions,
                rawOutput,
                connectionStatus,
                daemonStatus,
                timestamp: new Date().toLocaleTimeString(),
                namespaceConnection: this.namespaceConnection
            };
            
            TelepresenceOutput.appendLine(`✅ Status completed: ${connectionStatus}, daemon: ${daemonStatus}, interceptions: ${interceptions.length}`);
            
            return result;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            TelepresenceOutput.appendLine(`❌ Error in getFormattedTelepresenceStatus: ${errorMessage}`);
            
            return {
                interceptions: [],
                rawOutput: 'Error getting telepresence status',
                connectionStatus: 'error',
                daemonStatus: 'unknown',
                timestamp: new Date().toLocaleTimeString(),
                namespaceConnection: this.namespaceConnection,
                error: errorMessage
            };
        }
    }

    // En telepresenceManager.ts
    async installTelepresence(): Promise<void> {
        TelepresenceOutput.appendLine('🔍 Checking administrator permissions...');
        
        const hasAdmin = await this.checkAdminRights();
        
        if (!hasAdmin) {
            const errorMessage = `❌ Administrator Permissions Required

    Automatic installation of Telepresence requires administrator permissions.

    To install Telepresence:
    1. Run VS Code as Administrator
    2. Or install manually from: https://github.com/telepresenceio/telepresence/releases
    3. Or use a package manager like Chocolatey/Scoop

    Once installed, restart VS Code in normal mode.`;

            TelepresenceOutput.appendLine('❌ No admin rights detected - aborting installation');
            
            vscode.window.showErrorMessage(
                'Administrator permissions are required for automatic installation of Telepresence.',
                { modal: true },
                'Open Releases',
                'View Documentation'
            ).then(choice => {
                if (choice === 'Open Releases') {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/telepresenceio/telepresence/releases/latest'));
                } else if (choice === 'View Documentation') {
                    vscode.env.openExternal(vscode.Uri.parse('https://www.telepresence.io/docs/latest/install/'));
                }
            });
            
            return;
        }

        TelepresenceOutput.appendLine('✅ Administrator permissions confirmed - proceeding with installation');
        
        // Código de instalación original aquí...
        const terminal = vscode.window.createTerminal({
            name: 'Telepresence Installer',
            shellPath: 'powershell.exe',
            shellArgs: ['-ExecutionPolicy', 'Bypass']
        });

        terminal.show();
        
        // ... resto del script original
    }

    async executeCommand(command: string): Promise<string> {
        
        try {
            const { stdout, stderr } = await runShell(command);
            
            if (stderr) {
                TelepresenceOutput.appendLine(`⚠️ Warning: ${stderr}`);
            }
            
            return stdout;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            TelepresenceOutput.appendLine(`❌ Command failed: ${errorMessage}`);
            throw new Error(`Command failed: ${command}\n${errorMessage}`);
        }
    }
 
    private async getTelepresenceStatusJson(): Promise<TelepresenceStatusJson> {
        return this.kubernetesManager.runTelepresenceJson<TelepresenceStatusJson>('status');
    }

    async checkCurrentTelepresenceStatus(): Promise<void> {
        try {
            // Si acabamos de desconectar manualmente hace menos de 30 segundos, no verificar
            const timeSinceManualDisconnect = Date.now() - this.manualDisconnectTimestamp;
            if (timeSinceManualDisconnect < 30000) {
                TelepresenceOutput.appendLine(`📋 Skipping status check - manual disconnect ${Math.floor(timeSinceManualDisconnect/1000)}s ago`);
                return;
            }
    
            TelepresenceOutput.appendLine(`📋 Checking current telepresence status...`);
            
            // Check if telepresence is connected
            const status = await this.getTelepresenceStatusJson();

            if (status.user_daemon?.status === 'Connected') {
                const connectedNamespace = status.user_daemon.namespace ?? null;
                TelepresenceOutput.appendLine(`📊 Namespace from status: "${connectedNamespace}"`);

                // Mantener el contexto con el que está conectado el daemon
                if (status.user_daemon.kubernetes_context) {
                    this.kubernetesManager.setSelectedContext(status.user_daemon.kubernetes_context);
                }

                if (connectedNamespace && connectedNamespace !== 'default' && connectedNamespace !== 'ambassador') {
                    this.updateNamespaceConnection({
                        namespace: connectedNamespace,
                        status: 'connected',
                        startTime: new Date()
                    });
                    TelepresenceOutput.appendLine(`✅ Detected existing connection to namespace: ${connectedNamespace}`);
                } else {
                    TelepresenceOutput.appendLine(`📋 Connected but namespace is '${connectedNamespace}' - ignoring`);
                    this.updateNamespaceConnection(null);
                }
            } else {
                // No hay conexión
                this.updateNamespaceConnection(null);
                TelepresenceOutput.appendLine(`📋 No telepresence connection detected`);
            }
        } catch (error) {
            // Error ejecutando comando o no hay conexión
            this.updateNamespaceConnection(null);
            TelepresenceOutput.appendLine(`📋 No telepresence connection found: ${error}`);
        }
    }
    
    // Métodos para acceder al settings manager
    getSettingsManager(): InjectedTelepresenceSettingsManager {
        return this.settingsManager;
    }

    dispose(): void {
        // Desconectar todas las sesiones y namespace al cerrar
        this.disconnectAll().catch((err: Error) => {
            TelepresenceOutput.appendLine(`❌ Error during cleanup: ${err.message}`);
        });
        
        this.outputChannel.dispose();
    }

    private async checkAdminRights(): Promise<boolean> {
        try {
            if (process.platform === 'win32') {
                // En Windows: intentar acceder a información de sesión (requiere admin)
                await execAsync('net session', { timeout: 3000 });
                return true;
            } else {
                // En Linux/Mac: verificar si es root o tiene sudo
                const result = await execAsync('id -u', { timeout: 3000 });
                return result.stdout.trim() === '0' || process.getuid?.() === 0; // 👈 CORREGIDO
            }
        } catch (error) {
            // Si falla, no tiene permisos de admin
            TelepresenceOutput.appendLine(`🔒 Admin check failed: ${error}`);
            return false;
        }
    }

    private async killTelepresenceDaemons(): Promise<void> {
        try {
            await this.executeCommand('telepresence quit -s');
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (quitError) {
            try {
                TelepresenceOutput.appendLine(`💀 Starting aggressive telepresence cleanup...`);
                
                if (process.platform === 'win32') {
                    // Windows - comandos PowerShell compatibles
                    const commands = [
                        'try { taskkill /F /IM telepresence.exe } catch { Write-Host "No telepresence.exe found" }',
                        'try { taskkill /F /IM telepresence-daemon.exe } catch { Write-Host "No telepresence-daemon.exe found" }',
                        'Get-Process | Where-Object { $_.ProcessName -like "*telepresence*" } | Stop-Process -Force -ErrorAction SilentlyContinue',
                        'Get-WmiObject Win32_Process | Where-Object { $_.Name -like "*telepresence*" } | ForEach-Object { $_.Terminate() } -ErrorAction SilentlyContinue'
                    ];
                    
                    for (const cmd of commands) {
                        try {
                            TelepresenceOutput.appendLine(`🔄 Executing PowerShell: ${cmd}`);
                            const result = await this.executeCommand(cmd);
                            TelepresenceOutput.appendLine(`✅ Result: ${result || 'Command completed'}`);
                        } catch (error) {
                            TelepresenceOutput.appendLine(`⚠️ Command completed with expected errors: ${cmd}`);
                        }
                    }
                    
                    // Comando adicional usando cmd /c para compatibilidad
                    try {
                        TelepresenceOutput.appendLine(`🔄 Executing fallback CMD command...`);
                        await this.executeCommand('cmd /c "taskkill /F /IM telepresence.exe 2>nul & taskkill /F /IM telepresence-daemon.exe 2>nul"');
                    } catch (error) {
                        TelepresenceOutput.appendLine(`⚠️ Fallback command completed: ${error}`);
                    }
                    
                } else {
                    // Linux/macOS - sin cambios
                    const commands = [
                        'pkill -9 -f telepresence 2>/dev/null || echo "No telepresence processes found"',
                        'killall -9 telepresence 2>/dev/null || echo "No telepresence processes to kill"',
                        'ps aux | grep telepresence | grep -v grep | awk \'{print $2}\' | xargs -r kill -9 2>/dev/null || echo "No specific telepresence PIDs found"'
                    ];
                    
                    for (const cmd of commands) {
                        try {
                            TelepresenceOutput.appendLine(`🔄 Executing: ${cmd}`);
                            const result = await this.executeCommand(cmd);
                            TelepresenceOutput.appendLine(`✅ Result: ${result}`);
                        } catch (error) {
                            TelepresenceOutput.appendLine(`⚠️ Command completed: ${cmd}`);
                        }
                    }
                }
                
                // Esperar que los procesos terminen completamente
                await new Promise(resolve => setTimeout(resolve, 10000));
                TelepresenceOutput.appendLine(`✅ Telepresence daemon cleanup completed`);
                
            } catch (error) {
                TelepresenceOutput.appendLine(`⚠️ Error in daemon cleanup (may be normal): ${error}`);
            }
        }
    }        
}