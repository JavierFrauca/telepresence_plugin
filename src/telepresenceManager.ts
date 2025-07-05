import * as vscode from 'vscode';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { InjectedTelepresenceSettingsManager, ConnectionConfig } from './settingsManager';
import { KubernetesManager, AuthInfo } from './kubernetesManager';
import { TelepresenceOutput } from './output';
import { ThrottleUtility } from './utils/throttleUtility';

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
}

// NEW: Interface for namespace connection state
export interface NamespaceConnection {
    namespace: string;
    status: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
    startTime?: Date;
    error?: string;
}

export class TelepresenceManager {
    private sessions: Map<string, TelepresenceSession> = new Map();
    private namespaceConnection: NamespaceConnection | null = null; // NEW: Namespace connection state
    private outputChannel: vscode.OutputChannel = TelepresenceOutput.getChannel();
    private settingsManager: InjectedTelepresenceSettingsManager;
    private manualDisconnectTimestamp: number = 0;
    private kubernetesManager: KubernetesManager;

    constructor(workspaceState: vscode.Memento) {
        // outputChannel ya inicializado arriba
        this.settingsManager = new InjectedTelepresenceSettingsManager(workspaceState);
        this.kubernetesManager = new KubernetesManager();
    }

    async checkTelepresenceInstalled(): Promise<boolean> {
        try {
            await execAsync('telepresence version');
            return true;
        } catch {
            return false;
        }
    }

    async findMatchingDeployment(namespace: string, microservice: string): Promise<string | null> {
        const deployments = await this.kubernetesManager.getDeploymentsInNamespace(namespace);
        const matching = deployments.find((dep: string) => dep.toLowerCase().includes(microservice.toLowerCase()));
        
        this.outputChannel.appendLine(`🔍 Looking for '${microservice}' in namespace '${namespace}'`);
        this.outputChannel.appendLine(`📋 Available deployments: ${deployments.join(', ')}`);
        this.outputChannel.appendLine(`✅ Found matching deployment: ${matching || 'none'}`);
        
        return matching || null;
    }


    async forceResetConnectionState(): Promise<void> {
        this.outputChannel.appendLine(`🔄 Force resetting connection state...`);
        this.namespaceConnection = null;
        this.outputChannel.appendLine(`✅ Connection state reset`);
    }

    async connectToNamespace(namespace: string): Promise<void> {
        const startTime = Date.now();
        this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
        this.outputChannel.appendLine(`🚀 STARTING connectToNamespace(namespace: "${namespace}")`);
        this.outputChannel.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        this.outputChannel.appendLine(`${'='.repeat(80)}`);
        
        // 1. Verificaciones mínimas
        this.outputChannel.appendLine(`\n📋 STEP 1: Prerequisites verification`);
        this.outputChannel.appendLine(`🔍 Checking if telepresence is installed...`);
        
        const telepresenceInstalled = await this.checkTelepresenceInstalled();
        this.outputChannel.appendLine(`📊 Telepresence installed: ${telepresenceInstalled}`);
        
        if (!telepresenceInstalled) {
            this.outputChannel.appendLine(`❌ FAILURE: Telepresence is not installed`);
            throw new Error('Telepresence is not installed');
        }
        
        this.outputChannel.appendLine(`🔍 Getting current kubectl context...`);
        const currentContext = await this.kubernetesManager.getCurrentContext();
        this.outputChannel.appendLine(`📊 Current context: "${currentContext}"`);
        
        this.outputChannel.appendLine(`☁️ Checking kubelogin...`);
        const kubeloginInstalled = await this.kubernetesManager.checkKubeloginInstalled();
        this.outputChannel.appendLine(`📊 Kubelogin installed: ${kubeloginInstalled}`);
            
        if (!kubeloginInstalled) {
            this.outputChannel.appendLine(`❌ FAILURE: Kubelogin is required for Azure contexts but is not installed`);
            throw new Error('Kubelogin is required for Azure contexts but is not installed');
        }
        this.outputChannel.appendLine(`✅ Azure prerequisites OK`);
        
        // 2. Estado interno
        this.outputChannel.appendLine(`\n📋 STEP 2: Setting internal state`);
        this.outputChannel.appendLine(`📊 Previous namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
        
        this.namespaceConnection = { namespace, status: 'connecting', startTime: new Date() };
        this.outputChannel.appendLine(`📊 New namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
        this.outputChannel.appendLine(`✅ Internal state set to 'connecting'`);
        
        // 2.5. Verificar autenticación si es necesario
        if (currentContext) {
            this.outputChannel.appendLine(`🔐 Verificando autenticación del cluster...`);
            const authInfo = await this.kubernetesManager.getClusterAuthInfo();
            this.outputChannel.appendLine(`📊 Auth check results:`);
            this.outputChannel.appendLine(`  - Needs auth: ${authInfo.needsAuth}`);
            this.outputChannel.appendLine(`  - Auth type: ${authInfo.authType}`);
            this.outputChannel.appendLine(`  - Provider: ${authInfo.provider}`);
        
            if (authInfo.needsAuth) {
                let errorMessage = '';
                let suggestion = '';
                
                switch (authInfo.authType) {
                    case 'kubelogin':
                        errorMessage = 'You are not authenticated to the Azure cluster';
                        suggestion = 'Ejecuta "Azure Login" desde la interfaz o usa el comando "telepresence.kubelogin"';
                        break;
                        
                    case 'aws':
                        errorMessage = 'You are not authenticated to the AWS cluster';
                        suggestion = 'Configura AWS CLI con "aws configure" o usa variables de entorno';
                        break;
                        
                    case 'gcp':
                        errorMessage = 'You are not authenticated to the GCP cluster';
                        suggestion = 'Ejecuta "gcloud auth login" y "gcloud container clusters get-credentials"';
                        break;
                        
                    default:
                        errorMessage = 'You are not authenticated to the Kubernetes cluster';
                        suggestion = 'Verify your kubectl configuration and credentials';
                }
                
                this.outputChannel.appendLine(`❌ FAILURE: ${errorMessage}`);
                this.outputChannel.appendLine(`💡 SUGGESTION: ${suggestion}`);
                
                const fullError = `${errorMessage}.\n\n💡 ${suggestion}`;
                throw new Error(fullError);
            }
            
            this.outputChannel.appendLine(`✅ Authentication verified successfully`);
        } else {
            this.outputChannel.appendLine(`ℹ️ No context check needed`);
        }


        try {
            // 2.9. Desconectar intercepciones activas
            this.outputChannel.appendLine(`\n📋 STEP 2.9: Executing telepresence quit`);
            const quitStartTime = Date.now();
            try {
                const quitCommand = 'telepresence quit';
                const quitResult = await this.executeCommand(quitCommand);
                const connectDuration = Date.now() - quitStartTime;
                this.outputChannel.appendLine(`✅ telepresence connect completed in ${connectDuration}ms`);
                this.outputChannel.appendLine(`📊 Connect command output:`);
                this.outputChannel.appendLine(`${quitResult || '(empty output)'}`);
            } catch (connectError) {
                const connectDuration = Date.now() - quitStartTime;
                this.outputChannel.appendLine(`❌ telepresence disconnect FAILED after ${connectDuration}ms`);
                this.outputChannel.appendLine(`📊 Connect error details: ${connectError}`);
            }
            
            // 3. Matar procesos por si acaso
            /* this.outputChannel.appendLine(`\n📋 STEP 3: Killing telepresence processes`);
            this.outputChannel.appendLine(`💀 Executing killTelepresenceDaemons()...`);
            const killStartTime = Date.now();
            await this.killTelepresenceDaemons();
            const killDuration = Date.now() - killStartTime;
            
            this.outputChannel.appendLine(`✅ killTelepresenceDaemons() completed in ${killDuration}ms`); */
            
            // 4. Conectar como con todo limpio
            this.outputChannel.appendLine(`\n📋 STEP 4: Connecting to namespace`);
            const connectCommand = `telepresence connect -n ${namespace}`;
            this.outputChannel.appendLine(`🔗 Command to execute: "${connectCommand}"`);
            this.outputChannel.appendLine(`⏱️ Starting telepresence connect at: ${new Date().toISOString()}`);
            
            const connectStartTime = Date.now();
            try {
                const connectResult = await this.executeCommand(connectCommand);
                const connectDuration = Date.now() - connectStartTime;
                
                this.outputChannel.appendLine(`✅ telepresence connect completed in ${connectDuration}ms`);
                this.outputChannel.appendLine(`📊 Connect command output:`);
                this.outputChannel.appendLine(`${connectResult || '(empty output)'}`);
                
            } catch (connectError) {
                const connectDuration = Date.now() - connectStartTime;
                this.outputChannel.appendLine(`❌ telepresence connect FAILED after ${connectDuration}ms`);
                this.outputChannel.appendLine(`📊 Connect error details: ${connectError}`);
                throw connectError;
            }
            
            // 5. Estado final
            this.outputChannel.appendLine(`\n📋 STEP 5: Setting final state`);
            this.namespaceConnection.status = 'connected';
            this.outputChannel.appendLine(`📊 Final namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
            
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`✅ SUCCESS: connectToNamespace completed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Connected to namespace: "${namespace}"`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
            
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n📋 STEP: ERROR HANDLING`);
            this.outputChannel.appendLine(`❌ Error occurred: ${error}`);
            this.outputChannel.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            
            this.namespaceConnection.status = 'error';
            this.namespaceConnection.error = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`📊 Error namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
            
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`❌ FAILURE: connectToNamespace failed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Failed namespace: "${namespace}"`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
            
            throw error;
        }
    }

    async disconnectFromNamespace(): Promise<void> {
        const startTime = Date.now();
        this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
        this.outputChannel.appendLine(`🔄 STARTING disconnectFromNamespace() - GENERAL CLEANUP`);
        this.outputChannel.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        this.outputChannel.appendLine(`${'='.repeat(80)}`);
        
        // Verificar estado inicial - PERO CONTINUAR SIEMPRE
        this.outputChannel.appendLine(`\n📋 STEP 1: Initial state verification`);
        this.outputChannel.appendLine(`📊 Current namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);
        this.outputChannel.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
        
        const hasActiveConnection = this.namespaceConnection && this.namespaceConnection.status === 'connected';
        const hasActiveSessions = this.sessions.size > 0;
        
        if (!hasActiveConnection && !hasActiveSessions) {
            this.outputChannel.appendLine(`ℹ️ No active connections detected - performing general cleanup`);
        } else {
            this.outputChannel.appendLine(`📊 Active connection/sessions detected - performing full disconnect`);
        }
        
        const namespace = this.namespaceConnection?.namespace || 'unknown';
        this.outputChannel.appendLine(`📊 Target namespace: "${namespace}"`);

        // CAMBIAR: Solo cambiar estado si hay conexión activa
        if (this.namespaceConnection) {
            this.namespaceConnection.status = 'disconnecting';
            this.outputChannel.appendLine(`📊 Updated namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);
        }
    
        try {
            // 1. Desconectar intercepciones
            this.outputChannel.appendLine(`\n📋 STEP 3: Disconnecting active interceptions`);
            if (this.sessions.size > 0) {
                this.outputChannel.appendLine(`📊 Found ${this.sessions.size} active interceptions to disconnect:`);
                Array.from(this.sessions.values()).forEach((session, index) => {
                    this.outputChannel.appendLine(`  ${index + 1}. ${session.id} (${session.originalService}) - Status: ${session.status}`);
                });
                
                const disconnectStartTime = Date.now();
                await this.disconnectAllInterceptions();
                const disconnectDuration = Date.now() - disconnectStartTime;
                
                this.outputChannel.appendLine(`✅ All interceptions disconnected in ${disconnectDuration}ms`);
                this.outputChannel.appendLine(`📊 Remaining sessions: ${this.sessions.size}`);
            } else {
                this.outputChannel.appendLine(`ℹ️ No active interceptions to disconnect`);
            }
    
            // 2. telepresence quit
            this.outputChannel.appendLine(`\n📋 STEP 4: Executing telepresence quit`);
            const quitCommand = 'telepresence quit';
            this.outputChannel.appendLine(`🛑 Command to execute: "${quitCommand}"`);
            this.outputChannel.appendLine(`⏱️ Starting telepresence quit at: ${new Date().toISOString()}`);
            
            const quitStartTime = Date.now();
            try {
                const quitResult = await this.executeCommand(quitCommand);
                const quitDuration = Date.now() - quitStartTime;
                
                this.outputChannel.appendLine(`✅ telepresence quit completed in ${quitDuration}ms`);
                this.outputChannel.appendLine(`📊 Quit command output:`);
                this.outputChannel.appendLine(`${quitResult || '(empty output)'}`);
                
            } catch (quitError) {
                const quitDuration = Date.now() - quitStartTime;
                this.outputChannel.appendLine(`⚠️ telepresence quit FAILED after ${quitDuration}ms`);
                this.outputChannel.appendLine(`📊 Quit error details: ${quitError}`);
                this.outputChannel.appendLine(`ℹ️ Continuing with process kill (this is expected behavior)`);
            }
            
            // 3. Matar procesos por si acaso
            this.outputChannel.appendLine(`\n📋 STEP 5: Killing telepresence processes (safety measure)`);
            this.outputChannel.appendLine(`💀 Executing killTelepresenceDaemons()...`);
            
            const killStartTime = Date.now();
            await this.killTelepresenceDaemons();
            const killDuration = Date.now() - killStartTime;
            
            this.outputChannel.appendLine(`✅ killTelepresenceDaemons() completed in ${killDuration}ms`);
            
            // 4. Limpiar estado
            this.outputChannel.appendLine(`\n📋 STEP 6: Cleaning internal state`);
            this.outputChannel.appendLine(`📊 Previous namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);

            this.manualDisconnectTimestamp = Date.now();
            this.outputChannel.appendLine(`📊 Manual disconnect timestamp set: ${this.manualDisconnectTimestamp}`);
            
            this.namespaceConnection = null;
            this.outputChannel.appendLine(`📊 New namespaceConnection: ${this.namespaceConnection}`);
                        
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`✅ SUCCESS: disconnectFromNamespace completed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Disconnected from namespace: "${namespace}"`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
    
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n📋 STEP: ERROR HANDLING`);
            this.outputChannel.appendLine(`❌ Error occurred: ${error}`);
            this.outputChannel.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            
            if (this.namespaceConnection) {
                this.namespaceConnection.status = 'error';
                this.namespaceConnection.error = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`📊 Error namespaceConnection state: ${JSON.stringify(this.namespaceConnection)}`);
            }
            
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`❌ FAILURE: disconnectFromNamespace failed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Failed during disconnect from: "${namespace}"`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
            
            throw error;
        }
    }

    async interceptTraffic(microservice: string, localPort: number): Promise<string> {
        const startTime = Date.now();
        this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
        this.outputChannel.appendLine(`🎯 STARTING interceptTraffic(microservice: "${microservice}", localPort: ${localPort})`);
        this.outputChannel.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        this.outputChannel.appendLine(`${'='.repeat(80)}`);
        
        // 1. Verificar conexión a namespace
        this.outputChannel.appendLine(`\n📋 STEP 1: Namespace connection verification`);
        this.outputChannel.appendLine(`📊 Current namespaceConnection: ${JSON.stringify(this.namespaceConnection)}`);
        
        if (!this.namespaceConnection || this.namespaceConnection.status !== 'connected') {
            this.outputChannel.appendLine(`❌ FAILURE: Not connected to namespace`);
            this.outputChannel.appendLine(`📊 namespaceConnection status: ${this.namespaceConnection?.status || 'null'}`);
            throw new Error('Must be connected to a namespace first. Use "Connect to Namespace" button.');
        }
    
        const namespace = this.namespaceConnection.namespace;
        this.outputChannel.appendLine(`✅ Connected to namespace: "${namespace}"`);
        this.outputChannel.appendLine(`📊 Connection start time: ${this.namespaceConnection.startTime}`);
    
        // 2. Buscar deployment
        this.outputChannel.appendLine(`\n📋 STEP 2: Finding matching deployment`);
        this.outputChannel.appendLine(`🔍 Looking for deployment containing: "${microservice}"`);
        this.outputChannel.appendLine(`📊 Target namespace: "${namespace}"`);
        
        const deploymentStartTime = Date.now();
        const deployment = await this.findMatchingDeployment(namespace, microservice);
        const deploymentDuration = Date.now() - deploymentStartTime;
        
        this.outputChannel.appendLine(`📊 Deployment search completed in ${deploymentDuration}ms`);
        this.outputChannel.appendLine(`📊 Found deployment: "${deployment || 'null'}"`);
        
        if (!deployment) {
            this.outputChannel.appendLine(`❌ FAILURE: No deployment found`);
            this.outputChannel.appendLine(`📊 Search criteria: contains "${microservice}" in namespace "${namespace}"`);
            throw new Error(`No deployment found in namespace '${namespace}' containing '${microservice}'`);
        }
    
        // 3. Verificar sesión existente
        this.outputChannel.appendLine(`\n📋 STEP 3: Checking for existing session`);
        const sessionId = deployment;
        this.outputChannel.appendLine(`📊 Session ID will be: "${sessionId}"`);
        this.outputChannel.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
        
        if (this.sessions.size > 0) {
            this.outputChannel.appendLine(`📊 Existing sessions:`);
            Array.from(this.sessions.values()).forEach((session, index) => {
                this.outputChannel.appendLine(`  ${index + 1}. ${session.id} (${session.originalService}) - Status: ${session.status}`);
            });
        }
        
        const existingSession = this.sessions.get(sessionId);
        this.outputChannel.appendLine(`📊 Existing session for "${sessionId}": ${existingSession ? 'EXISTS' : 'NOT_FOUND'}`);
        
        if (existingSession) {
            this.outputChannel.appendLine(`❌ FAILURE: Session already exists`);
            this.outputChannel.appendLine(`📊 Existing session details: ${JSON.stringify(existingSession)}`);
            throw new Error(`Interception already exists for '${deployment}' in namespace '${namespace}'`);
        }
    
        // 4. Crear nueva sesión
        this.outputChannel.appendLine(`\n📋 STEP 4: Creating new session`);
        const session: TelepresenceSession = {
            id: sessionId,
            namespace,
            deployment,
            originalService: microservice,
            localPort,
            status: 'connecting',
            startTime: new Date()
        };
        
        this.outputChannel.appendLine(`📊 New session object: ${JSON.stringify(session)}`);
        
        this.sessions.set(sessionId, session);
        this.outputChannel.appendLine(`✅ Session added to sessions map`);
        this.outputChannel.appendLine(`📊 Total sessions now: ${this.sessions.size}`);
    
        try {
            // 5. Ejecutar replace SIEMPRE con --use
            this.outputChannel.appendLine(`\n📋 STEP 5: Executing telepresence replace with daemon selection`);
            const portMapping = `${localPort}:8080`;

            // Generar daemon name
            const currentContext = await this.kubernetesManager.getCurrentContext();
            const daemonName = `${currentContext}-${namespace}`;

            this.outputChannel.appendLine(`📊 Current context: "${currentContext}"`);
            this.outputChannel.appendLine(`📊 Namespace: "${namespace}"`);
            this.outputChannel.appendLine(`📊 Daemon name: "${daemonName}"`);
            this.outputChannel.appendLine(`📊 Port mapping: "${portMapping}"`);

            const replaceArgs = [
                'replace',
                '--use', daemonName,
                '--port', portMapping,
                '--env-file', '.env',
                deployment,
                '--mount=false'
            ];

            this.outputChannel.appendLine(`📊 Replace command: telepresence ${replaceArgs.join(' ')}`);
            this.outputChannel.appendLine(`⏱️ Starting telepresence replace at: ${new Date().toISOString()}`);

            const replaceStartTime = Date.now();

            // Spawn process
            this.outputChannel.appendLine(`🚀 Spawning telepresence replace process...`);
            const replaceProcess = spawn('telepresence', replaceArgs, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            this.outputChannel.appendLine(`📊 Process spawned with PID: ${replaceProcess.pid}`);
            this.outputChannel.appendLine(`📊 Process spawnfile: ${replaceProcess.spawnfile}`);
            this.outputChannel.appendLine(`📊 Process args: ${JSON.stringify(replaceProcess.spawnargs)}`);
    
            session.process = replaceProcess;
            session.status = 'connected';
            this.sessions.set(sessionId, session);
            
            const replaceSpawnDuration = Date.now() - replaceStartTime;
            this.outputChannel.appendLine(`✅ Process spawn completed in ${replaceSpawnDuration}ms`);
            this.outputChannel.appendLine(`📊 Updated session status: ${session.status}`);
    
            // 6. Configurar listeners
            this.outputChannel.appendLine(`\n📋 STEP 6: Setting up process listeners`);
            
            replaceProcess.stdout?.on('data', (data: Buffer) => {
                const output = data.toString().trim();
                this.outputChannel.appendLine(`[${deployment}] STDOUT: ${output}`);
            });
    
            replaceProcess.stderr?.on('data', (data: Buffer) => {
                const output = data.toString().trim();
                this.outputChannel.appendLine(`[${deployment}] STDERR: ${output}`);
            });
    
            replaceProcess.on('close', (code: number | null) => {
                this.outputChannel.appendLine(`[${deployment}] Process closed with code: ${code}`);
                this.outputChannel.appendLine(`[${deployment}] Process close time: ${new Date().toISOString()}`);
            });
    
            replaceProcess.on('error', (error: Error) => {
                this.outputChannel.appendLine(`[${deployment}] Process error: ${error.message}`);
                this.outputChannel.appendLine(`[${deployment}] Error type: ${error.constructor.name}`);
                this.outputChannel.appendLine(`[${deployment}] Error time: ${new Date().toISOString()}`);
                
                session.status = 'error';
                session.error = error.message;
                this.sessions.set(sessionId, session);
                this.outputChannel.appendLine(`📊 Session updated with error status: ${JSON.stringify(session)}`);
            });
    
            replaceProcess.on('spawn', () => {
                this.outputChannel.appendLine(`[${deployment}] Process successfully spawned`);
                this.outputChannel.appendLine(`[${deployment}] Spawn time: ${new Date().toISOString()}`);
            });
    
            replaceProcess.on('exit', (code: number | null, signal: string | null) => {
                this.outputChannel.appendLine(`[${deployment}] Process exited with code: ${code}, signal: ${signal}`);
                this.outputChannel.appendLine(`[${deployment}] Exit time: ${new Date().toISOString()}`);
            });
            
            this.outputChannel.appendLine(`✅ All process listeners configured`);
    
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`✅ SUCCESS: interceptTraffic completed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Session ID: "${sessionId}"`);
            this.outputChannel.appendLine(`📊 Deployment: "${deployment}"`);
            this.outputChannel.appendLine(`📊 Port mapping: ${portMapping}`);
            this.outputChannel.appendLine(`📊 Process PID: ${replaceProcess.pid}`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
    
            return sessionId;
    
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n📋 STEP: ERROR HANDLING`);
            this.outputChannel.appendLine(`❌ Error occurred: ${error}`);
            this.outputChannel.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            
            session.status = 'error';
            session.error = error instanceof Error ? error.message : String(error);
            this.sessions.set(sessionId, session);
            this.outputChannel.appendLine(`📊 Session updated with error: ${JSON.stringify(session)}`);
            
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`❌ FAILURE: interceptTraffic failed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Failed session ID: "${sessionId}"`);
            this.outputChannel.appendLine(`📊 Failed deployment: "${deployment}"`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
            
            throw error;
        }
    }
    
    async disconnectInterception(sessionId: string): Promise<void> {
        const startTime = Date.now();
        this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
        this.outputChannel.appendLine(`🔄 STARTING disconnectInterception(sessionId: "${sessionId}")`);
        this.outputChannel.appendLine(`⏱️ Start Time: ${new Date().toISOString()}`);
        this.outputChannel.appendLine(`${'='.repeat(80)}`);
        
        // STEP 1: Finding session
        this.outputChannel.appendLine(`\n📋 STEP 1: Finding session`);
        this.outputChannel.appendLine(`📊 Looking for session ID: "${sessionId}"`);
        this.outputChannel.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
        
        if (this.sessions.size > 0) {
            this.outputChannel.appendLine(`📊 Available sessions:`);
            Array.from(this.sessions.keys()).forEach((id, index) => {
                this.outputChannel.appendLine(`  ${index + 1}. "${id}"`);
            });
        } else {
            this.outputChannel.appendLine(`📊 No sessions currently active`);
        }
        
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.outputChannel.appendLine(`❌ FAILURE: Session not found`);
            this.outputChannel.appendLine(`📊 Requested: "${sessionId}"`);
            this.outputChannel.appendLine(`📊 Available: [${Array.from(this.sessions.keys()).join(', ')}]`);
            
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`❌ FAILURE: disconnectInterception failed - session not found`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
            
            throw new Error(`Interception not found: ${sessionId}`);
        }
    
        this.outputChannel.appendLine(`✅ Session found`);
        this.outputChannel.appendLine(`📊 Session details:`);
        this.outputChannel.appendLine(`  - ID: "${session.id}"`);
        this.outputChannel.appendLine(`  - Namespace: "${session.namespace}"`);
        this.outputChannel.appendLine(`  - Deployment: "${session.deployment}"`);
        this.outputChannel.appendLine(`  - Original Service: "${session.originalService}"`);
        this.outputChannel.appendLine(`  - Local Port: ${session.localPort}`);
        this.outputChannel.appendLine(`  - Status: "${session.status}"`);
        this.outputChannel.appendLine(`  - Start Time: ${session.startTime}`);
        this.outputChannel.appendLine(`  - Has Process: ${!!session.process}`);
        if (session.process) {
            this.outputChannel.appendLine(`  - Process PID: ${session.process.pid}`);
            this.outputChannel.appendLine(`  - Process Killed: ${session.process.killed}`);
        }
    
        // STEP 2: Setting disconnecting state
        this.outputChannel.appendLine(`\n📋 STEP 2: Setting disconnecting state`);
        this.outputChannel.appendLine(`📊 Previous status: "${session.status}"`);
        session.status = 'disconnecting';
        this.sessions.set(sessionId, session);
        this.outputChannel.appendLine(`📊 New status: "${session.status}"`);
        this.outputChannel.appendLine(`✅ Session state updated`);
    
        try {
            // STEP 3: Terminating replace process
            this.outputChannel.appendLine(`\n📋 STEP 3: Terminating replace process`);
            if (session.process) {
                this.outputChannel.appendLine(`💀 Found active process with PID: ${session.process.pid}`);
                this.outputChannel.appendLine(`📊 Process killed status: ${session.process.killed}`);
                this.outputChannel.appendLine(`📊 Process exit code: ${session.process.exitCode}`);
                this.outputChannel.appendLine(`📊 Process signal code: ${session.process.signalCode}`);
                
                const killStartTime = Date.now();
                this.outputChannel.appendLine(`🔪 Sending SIGTERM to process...`);
                session.process.kill('SIGTERM');
                this.outputChannel.appendLine(`📊 SIGTERM sent to process at: ${new Date().toISOString()}`);
                
                // Esperar terminación graceful
                this.outputChannel.appendLine(`⏳ Waiting 2 seconds for graceful termination...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                this.outputChannel.appendLine(`📊 After SIGTERM - Killed: ${session.process.killed}, Exit Code: ${session.process.exitCode}`);
                
                if (!session.process.killed && session.process.exitCode === null) {
                    this.outputChannel.appendLine(`⚠️ Process still alive after SIGTERM, sending SIGKILL...`);
                    session.process.kill('SIGKILL');
                    this.outputChannel.appendLine(`💀 SIGKILL sent to process at: ${new Date().toISOString()}`);
                    
                    this.outputChannel.appendLine(`⏳ Waiting 1 second after SIGKILL...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    this.outputChannel.appendLine(`📊 After SIGKILL - Killed: ${session.process.killed}, Exit Code: ${session.process.exitCode}`);
                }
                
                const killDuration = Date.now() - killStartTime;
                this.outputChannel.appendLine(`✅ Process termination sequence completed in ${killDuration}ms`);
                this.outputChannel.appendLine(`📊 Final process state:`);
                this.outputChannel.appendLine(`  - Killed: ${session.process.killed}`);
                this.outputChannel.appendLine(`  - Exit Code: ${session.process.exitCode}`);
                this.outputChannel.appendLine(`  - Signal Code: ${session.process.signalCode}`);
            } else {
                this.outputChannel.appendLine(`ℹ️ No active process found for session`);
                this.outputChannel.appendLine(`📊 Session was likely already terminated or never had a process`);
            }
    
            // STEP 4: Executing telepresence leave with daemon selection
            this.outputChannel.appendLine(`\n📋 STEP 4: Executing telepresence leave with daemon selection`);
            const deploymentName = session.deployment;
            const namespace = session.namespace;
    
            this.outputChannel.appendLine(`📊 Deployment to leave: "${deploymentName}"`);
            this.outputChannel.appendLine(`📊 Namespace: "${namespace}"`);
    
            // Generar daemon name SIEMPRE
            this.outputChannel.appendLine(`🔍 Getting current context for daemon name...`);
            const currentContext = await this.kubernetesManager.getCurrentContext();
            const daemonName = `${currentContext}-${namespace}`;
    
            this.outputChannel.appendLine(`📊 Current context: "${currentContext}"`);
            this.outputChannel.appendLine(`📊 Daemon name: "${daemonName}"`);
    
            const leaveCommand = `telepresence leave --use ${daemonName} ${deploymentName}`;
            this.outputChannel.appendLine(`🔓 Command to execute: "${leaveCommand}"`);
            this.outputChannel.appendLine(`⏱️ Starting telepresence leave at: ${new Date().toISOString()}`);
    
            const leaveStartTime = Date.now();
            try {
                const leaveOutput = await this.executeCommand(leaveCommand);
                const leaveDuration = Date.now() - leaveStartTime;
                
                this.outputChannel.appendLine(`✅ telepresence leave completed in ${leaveDuration}ms`);
                this.outputChannel.appendLine(`📊 Leave command output:`);
                this.outputChannel.appendLine(`${leaveOutput || '(empty output)'}`);
                
            } catch (leaveError) {
                const leaveDuration = Date.now() - leaveStartTime;
                this.outputChannel.appendLine(`❌ telepresence leave FAILED after ${leaveDuration}ms`);
                this.outputChannel.appendLine(`📊 Leave error details: ${leaveError}`);
                this.outputChannel.appendLine(`📊 Error type: ${leaveError instanceof Error ? leaveError.constructor.name : typeof leaveError}`);
                
                // Si falla el leave específico, intentar leave genérico SIN --use
                this.outputChannel.appendLine(`\n🔄 FALLBACK: Attempting generic telepresence leave without --use...`);
                const genericLeaveStartTime = Date.now();
                try {
                    const genericLeaveCommand = `telepresence leave ${deploymentName}`;
                    this.outputChannel.appendLine(`🔓 Fallback command: "${genericLeaveCommand}"`);
                    
                    const genericLeaveOutput = await this.executeCommand(genericLeaveCommand);
                    const genericLeaveDuration = Date.now() - genericLeaveStartTime;
                    
                    this.outputChannel.appendLine(`✅ Generic leave successful in ${genericLeaveDuration}ms`);
                    this.outputChannel.appendLine(`📊 Generic leave output: ${genericLeaveOutput}`);
                } catch (genericError) {
                    const genericLeaveDuration = Date.now() - genericLeaveStartTime;
                    this.outputChannel.appendLine(`❌ Generic leave also failed after ${genericLeaveDuration}ms`);
                    this.outputChannel.appendLine(`📊 Generic leave error: ${genericError}`);
                    
                    // Último intento: telepresence leave sin parámetros
                    this.outputChannel.appendLine(`\n🔄 LAST RESORT: Attempting bare telepresence leave...`);
                    const bareLeaveStartTime = Date.now();
                    try {
                        const bareLeaveOutput = await this.executeCommand('telepresence leave');
                        const bareLeaveDuration = Date.now() - bareLeaveStartTime;
                        
                        this.outputChannel.appendLine(`✅ Bare leave successful in ${bareLeaveDuration}ms`);
                        this.outputChannel.appendLine(`📊 Bare leave output: ${bareLeaveOutput}`);
                    } catch (bareError) {
                        const bareLeaveDuration = Date.now() - bareLeaveStartTime;
                        this.outputChannel.appendLine(`❌ Bare leave failed after ${bareLeaveDuration}ms`);
                        this.outputChannel.appendLine(`📊 Bare leave error: ${bareError}`);
                        this.outputChannel.appendLine(`⚠️ All leave attempts failed, but continuing with session cleanup`);
                    }
                }
            }
    
            // STEP 5: Cleaning session
            this.outputChannel.appendLine(`\n📋 STEP 5: Cleaning session from internal state`);
            this.outputChannel.appendLine(`📊 Removing session "${sessionId}" from sessions map`);
            this.outputChannel.appendLine(`📊 Sessions before removal: ${this.sessions.size}`);
            
            const sessionExisted = this.sessions.delete(sessionId);
            this.outputChannel.appendLine(`📊 Session deletion result: ${sessionExisted}`);
            this.outputChannel.appendLine(`📊 Sessions after removal: ${this.sessions.size}`);
            
            if (this.sessions.size > 0) {
                this.outputChannel.appendLine(`📊 Remaining sessions:`);
                Array.from(this.sessions.values()).forEach((remainingSession, index) => {
                    this.outputChannel.appendLine(`  ${index + 1}. ${remainingSession.id} (${remainingSession.originalService}) - Status: ${remainingSession.status}`);
                });
            } else {
                this.outputChannel.appendLine(`📊 No remaining sessions`);
            }
            
            // SUCCESS
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`✅ SUCCESS: disconnectInterception completed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Disconnected session: "${sessionId}"`);
            this.outputChannel.appendLine(`📊 Deployment: "${deploymentName}"`);
            this.outputChannel.appendLine(`📊 Namespace: "${namespace}"`);
            this.outputChannel.appendLine(`📊 Original service: "${session.originalService}"`);
            this.outputChannel.appendLine(`📊 Local port: ${session.localPort}`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
    
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            this.outputChannel.appendLine(`\n📋 STEP: ERROR HANDLING`);
            this.outputChannel.appendLine(`❌ Critical error occurred: ${error}`);
            this.outputChannel.appendLine(`📊 Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            this.outputChannel.appendLine(`📊 Error message: ${error instanceof Error ? error.message : String(error)}`);
            
            if (error instanceof Error && error.stack) {
                this.outputChannel.appendLine(`📊 Error stack trace:`);
                this.outputChannel.appendLine(`${error.stack}`);
            }
            
            // Update session with error but don't remove it
            session.status = 'error';
            session.error = error instanceof Error ? error.message : String(error);
            this.sessions.set(sessionId, session);
            this.outputChannel.appendLine(`📊 Session updated with error status: ${JSON.stringify(session)}`);
            
            this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
            this.outputChannel.appendLine(`❌ FAILURE: disconnectInterception failed`);
            this.outputChannel.appendLine(`📊 Total execution time: ${totalDuration}ms`);
            this.outputChannel.appendLine(`📊 Failed session: "${sessionId}"`);
            this.outputChannel.appendLine(`📊 Session left in error state for debugging`);
            this.outputChannel.appendLine(`⏱️ End Time: ${new Date().toISOString()}`);
            this.outputChannel.appendLine(`${'='.repeat(80)}\n`);
    
            throw error;
        }
    }

    async disconnectAllInterceptions(): Promise<void> {
        const sessionIds = Array.from(this.sessions.keys());
        
        this.outputChannel.appendLine(`🔄 Stopping all ${sessionIds.length} traffic interceptions`);
        
        // Desconectar sesiones conocidas individualmente
        const promises = sessionIds.map(async (id: string) => {
            try {
                await this.disconnectInterception(id);
            } catch (err) {
                this.outputChannel.appendLine(`Failed to stop interception ${id}: ${err}`);
            }
        });
        
        await Promise.all(promises);
        
        // Limpiar intercepciones que puedan no estar en nuestro estado
        try {
            this.outputChannel.appendLine('Cleaning up any remaining interceptions...');
            // Get current list and leave each intercepted deployment
            const interceptions = await this.getTelepresenceInterceptions();
            for (const interception of interceptions) {
                if (interception.status === 'intercepted') {
                    try {
                        await this.executeCommand(`telepresence leave ${interception.fullDeploymentName || interception.deployment}`);
                        this.outputChannel.appendLine(`✅ Left: ${interception.deployment}`);
                    } catch (leaveError) {
                        this.outputChannel.appendLine(`⚠️ Failed to leave ${interception.deployment}: ${leaveError}`);
                    }
                }
            }
        } catch (cleanupError) {
            this.outputChannel.appendLine(`⚠️ Cleanup failed: ${cleanupError}`);
        }
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
        this.outputChannel.appendLine(`\n📋 Getting telepresence interceptions...`);
        
        try {
            const currentContext = await this.kubernetesManager.getCurrentContext();
            const namespace = this.namespaceConnection?.namespace || 'default';
            const daemonName = `${currentContext}-${namespace}`;
            
            this.outputChannel.appendLine(`📊 Current context: "${currentContext}"`);
            this.outputChannel.appendLine(`📊 Using namespace: "${namespace}"`);
            this.outputChannel.appendLine(`📊 Daemon name: "${daemonName}"`);
            
            const command = `telepresence list --use ${daemonName}`;
            this.outputChannel.appendLine(`🔄 Executing: ${command}`);
            
            const listOutput = await this.executeCommand(command);
            this.outputChannel.appendLine(`📊 List output received, parsing...`);
            
            const interceptions = this.parseTelepresenceList(listOutput);
            this.outputChannel.appendLine(`✅ Parsed ${interceptions.length} interceptions`);
            
            return interceptions;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Failed to get telepresence interceptions: ${error}`);
            return [];
        }
    }

    /**
     * Parse the telepresence list output into structured data
     */
    private parseTelepresenceList(output: string): TelepresenceInterception[] {
        const interceptions: TelepresenceInterception[] = [];
        const lines = output.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('deployment ')) {
                const match = line.match(/^deployment\s+([^\s:]+)\s*:\s*(.+)$/);
                if (!match) continue;
                
                const [, deploymentName, statusPart] = match;
                
                const interception: TelepresenceInterception = {
                    deployment: deploymentName,
                    namespace: 'default',
                    status: statusPart.includes('replaced') ? 'intercepted' : 'available',
                    fullDeploymentName: deploymentName
                };
                
                // Si está interceptado, leer las siguientes líneas
                if (statusPart.includes('replaced')) {
                    let clusterIP = '';
                    let localPort = 0;
                    
                    // Buscar en las siguientes líneas hasta encontrar otro deployment
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j].trim();
                        
                        // Parar si encontramos otro deployment
                        if (nextLine.startsWith('deployment ')) break;
                        
                        // Línea con IPs: "10.244.13.200 -> 127.0.0.1"
                        const ipMatch = nextLine.match(/(\d+\.\d+\.\d+\.\d+)\s*->\s*127\.0\.0\.1/);
                        if (ipMatch) {
                            clusterIP = ipMatch[1];
                            continue;
                        }
                        
                        // Línea con puertos: "8080 -> 5001 TCP"
                        const portMatch = nextLine.match(/\d+\s*->\s*(\d+)\s+TCP/);
                        if (portMatch) {
                            localPort = parseInt(portMatch[1]);
                            break;
                        }
                    }
                    
                    if (clusterIP) interception.clusterIP = clusterIP;
                    if (localPort) interception.localPort = localPort;
                    interception.targetPort = 8080;
                }
                
                interceptions.push(interception);
            }
        }
        
        return interceptions;
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
        this.outputChannel.appendLine(`\n📋 Getting formatted telepresence status...`);
        
        try {
            // Obtener intercepciones SIEMPRE con --use
            let interceptions: TelepresenceInterception[] = [];
            let rawOutput = '';
            
            this.outputChannel.appendLine(`🔍 Getting interceptions list with --use...`);
            try {
                const currentContext = await this.kubernetesManager.getCurrentContext();
                const namespace = this.namespaceConnection?.namespace || 'default';
                const daemonName = `${currentContext}-${namespace}`;
                
                this.outputChannel.appendLine(`📊 Context: "${currentContext}", Namespace: "${namespace}", Daemon: "${daemonName}"`);
                
                const command = `telepresence list --use ${daemonName}`;
                this.outputChannel.appendLine(`🔄 Executing: ${command}`);
                
                const listOutput = await this.executeCommand(command);
                rawOutput = listOutput;
                interceptions = this.parseTelepresenceList(listOutput);
                this.outputChannel.appendLine(`✅ Interceptions retrieved: ${interceptions.length} found`);
            } catch (listError) {
                const errorStr = listError instanceof Error ? listError.message : String(listError);
                this.outputChannel.appendLine(`⚠️ List command failed: ${errorStr}`);
                rawOutput = `Error getting telepresence list: ${errorStr}`;
            }
            
            // 🆕 NUEVA LÓGICA: Sincronizar sesiones con intercepciones detectadas
            this.outputChannel.appendLine(`\n📋 SYNC: Synchronizing sessions with detected interceptions...`);
            this.outputChannel.appendLine(`📊 Current sessions count: ${this.sessions.size}`);
            this.outputChannel.appendLine(`📊 Detected interceptions: ${interceptions.length}`);
            
            // PASO 1: Crear sesiones para intercepciones activas faltantes
            const interceptedDeployments = interceptions.filter(i => i.status === 'intercepted');
            this.outputChannel.appendLine(`📊 Active interceptions: ${interceptedDeployments.length}`);
            
            interceptedDeployments.forEach(interception => {
                const sessionId = interception.fullDeploymentName || interception.deployment;
                
                if (!this.sessions.has(sessionId)) {
                    this.outputChannel.appendLine(`➕ Creating session for existing interception: ${sessionId}`);
                    
                    // Extraer nombre original del servicio (quitar sufijos como -devend175444-deploy)
                    let originalService = interception.deployment;
                    
                    // Patrón para microservicios: nombre-devend######-deploy
                    const serviceMatch = interception.deployment.match(/^([^-]+)(?:-devend\d+.*)?$/);
                    if (serviceMatch) {
                        originalService = serviceMatch[1];
                        this.outputChannel.appendLine(`📊 Extracted original service: "${originalService}" from "${interception.deployment}"`);
                    } else {
                        this.outputChannel.appendLine(`📊 Using full deployment name as service: "${originalService}"`);
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
                    this.outputChannel.appendLine(`✅ Session created: ${JSON.stringify(newSession)}`);
                } else {
                    this.outputChannel.appendLine(`ℹ️ Session already exists for: ${sessionId}`);
                }
            });
            
            // PASO 2: Limpiar sesiones obsoletas (que ya no están interceptadas)
            const sessionIds = Array.from(this.sessions.keys());
            this.outputChannel.appendLine(`📊 Checking ${sessionIds.length} existing sessions for cleanup...`);
            
            sessionIds.forEach(sessionId => {
                const session = this.sessions.get(sessionId);
                if (!session) return;
                
                // Buscar si esta sesión todavía tiene intercepción activa
                const stillIntercepted = interceptedDeployments.find(interception => {
                    const deploymentId = interception.fullDeploymentName || interception.deployment;
                    return deploymentId === sessionId;
                });
                
                if (!stillIntercepted) {
                    this.outputChannel.appendLine(`🗑️ Removing obsolete session: ${sessionId} (no longer intercepted)`);
                    this.sessions.delete(sessionId);
                } else {
                    this.outputChannel.appendLine(`✅ Session still valid: ${sessionId}`);
                }
            });
            
            this.outputChannel.appendLine(`📊 Final sessions count: ${this.sessions.size}`);
            if (this.sessions.size > 0) {
                this.outputChannel.appendLine(`📊 Active sessions:`);
                Array.from(this.sessions.values()).forEach((session, index) => {
                    this.outputChannel.appendLine(`  ${index + 1}. ${session.id} (${session.originalService}) - Status: ${session.status}`);
                });
            }
            
            // Verificar status basado en estado real, no solo daemon
            let connectionStatus = 'disconnected';
            let daemonStatus = 'stopped';
            
            this.outputChannel.appendLine(`🔍 Getting telepresence status...`);
            
            // Determinar estado basado en nuestro estado interno y intercepciones
            const hasNamespaceConnection = this.namespaceConnection && this.namespaceConnection.status === 'connected';
            const hasActiveInterceptions = interceptions.length > 0 && interceptions.some(i => i.status === 'intercepted');
            
            this.outputChannel.appendLine(`📊 Has namespace connection: ${hasNamespaceConnection}`);
            this.outputChannel.appendLine(`📊 Has active interceptions: ${hasActiveInterceptions}`);
            this.outputChannel.appendLine(`📊 Total interceptions found: ${interceptions.length}`);
            
            if (hasNamespaceConnection || hasActiveInterceptions) {
                connectionStatus = 'connected';
                daemonStatus = 'running';
                this.outputChannel.appendLine(`✅ Status: Connected with active session`);
            } else {
                connectionStatus = 'disconnected';
                daemonStatus = 'stopped';
                this.outputChannel.appendLine(`📋 Status: Disconnected - no active sessions`);
            }
            
            // Verificación adicional con telepresence status como fallback
            try {
                const statusOutput = await this.executeCommand('telepresence status');
                this.outputChannel.appendLine(`📊 Telepresence status output: ${statusOutput}`);
                
                // Solo override si detectamos algo inesperado
                if (statusOutput.includes('Connected') && !hasNamespaceConnection && !hasActiveInterceptions) {
                    this.outputChannel.appendLine(`⚠️ Daemon shows connected but no internal state - possible inconsistency`);
                    connectionStatus = 'connected';
                    daemonStatus = 'running';
                }
            } catch (statusError) {
                this.outputChannel.appendLine(`⚠️ Status command failed: ${statusError}`);
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
            
            this.outputChannel.appendLine(`✅ Status completed: ${connectionStatus}, daemon: ${daemonStatus}, interceptions: ${interceptions.length}`);
            
            return result;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`❌ Error in getFormattedTelepresenceStatus: ${errorMessage}`);
            
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
        this.outputChannel.appendLine('🔍 Checking administrator permissions...');
        
        const hasAdmin = await this.checkAdminRights();
        
        if (!hasAdmin) {
            const errorMessage = `❌ Administrator Permissions Required

    Automatic installation of Telepresence requires administrator permissions.

    To install Telepresence:
    1. Run VS Code as Administrator
    2. Or install manually from: https://github.com/telepresenceio/telepresence/releases
    3. Or use a package manager like Chocolatey/Scoop

    Once installed, restart VS Code in normal mode.`;

            this.outputChannel.appendLine('❌ No admin rights detected - aborting installation');
            
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

        this.outputChannel.appendLine('✅ Administrator permissions confirmed - proceeding with installation');
        
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
        this.outputChannel.appendLine(`Executing: ${command}`);
        
        try {
            const execOptions = process.platform === 'win32' 
                ? { shell: 'powershell.exe' as const }
                : { shell: '/bin/bash' as const };
                
            const { stdout, stderr } = await execAsync(command, execOptions);
            
            if (stderr) {
                this.outputChannel.appendLine(`Warning: ${stderr}`);
            }
            
            return stdout;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Command failed: ${errorMessage}`);
            throw new Error(`Command failed: ${command}\n${errorMessage}`);
        }
    }
 
    async checkCurrentTelepresenceStatus(): Promise<void> {
        try {
            // Si acabamos de desconectar manualmente hace menos de 30 segundos, no verificar
            const timeSinceManualDisconnect = Date.now() - this.manualDisconnectTimestamp;
            if (timeSinceManualDisconnect < 30000) {
                this.outputChannel.appendLine(`📋 Skipping status check - manual disconnect ${Math.floor(timeSinceManualDisconnect/1000)}s ago`);
                return;
            }
    
            this.outputChannel.appendLine(`📋 Checking current telepresence status...`);
            
            // Check if telepresence is connected
            const statusOutput = await this.executeCommand('telepresence status');
            this.outputChannel.appendLine(`📊 Telepresence status output: ${statusOutput}`);
            
            if (statusOutput.includes('Status            : Connected')) {
                // 🆕 NEW LOGIC: Extract namespace whenever we're connected
                let connectedNamespace = null;
                
                // Extraer namespace del status output
                const lines = statusOutput.split('\n');
                for (const line of lines) {
                    if (line.includes('Namespace         :')) {
                        const namespaceMatch = line.match(/Namespace\s+:\s+([^\s]+)/);
                        if (namespaceMatch) {
                            connectedNamespace = namespaceMatch[1];
                            this.outputChannel.appendLine(`📊 Extracted namespace from status: "${connectedNamespace}"`);
                            break;
                        }
                    }
                }
                
                if (connectedNamespace && connectedNamespace !== 'default' && connectedNamespace !== 'ambassador') {
                    // Update internal state
                    this.namespaceConnection = {
                        namespace: connectedNamespace,
                        status: 'connected',
                        startTime: new Date()
                    };
                    
                    this.outputChannel.appendLine(`✅ Detected existing connection to namespace: ${connectedNamespace}`);
                } else {
                    this.outputChannel.appendLine(`📋 Connected but namespace is '${connectedNamespace}' - ignoring`);
                    this.namespaceConnection = null;
                }
            } else {
                // No hay conexión
                this.namespaceConnection = null;
                this.outputChannel.appendLine(`📋 No telepresence connection detected`);
            }
        } catch (error) {
            // Error ejecutando comando o no hay conexión
            this.namespaceConnection = null;
            this.outputChannel.appendLine(`📋 No telepresence connection found: ${error}`);
        }
    }
    
    // Métodos para acceder al settings manager
    getSettingsManager(): InjectedTelepresenceSettingsManager {
        return this.settingsManager;
    }

    dispose(): void {
        // Desconectar todas las sesiones y namespace al cerrar
        this.disconnectAll().catch((err: Error) => {
            this.outputChannel.appendLine(`Error during cleanup: ${err.message}`);
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
            this.outputChannel.appendLine(`🔒 Admin check failed: ${error}`);
            return false;
        }
    }

    private async killTelepresenceDaemons(): Promise<void> {
        try {
            await this.executeCommand('telepresence quit');
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (quitError) {
            try {
                this.outputChannel.appendLine(`💀 Starting aggressive telepresence cleanup...`);
                
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
                            this.outputChannel.appendLine(`🔄 Executing PowerShell: ${cmd}`);
                            const result = await this.executeCommand(cmd);
                            this.outputChannel.appendLine(`✅ Result: ${result || 'Command completed'}`);
                        } catch (error) {
                            this.outputChannel.appendLine(`⚠️ Command completed with expected errors: ${cmd}`);
                        }
                    }
                    
                    // Comando adicional usando cmd /c para compatibilidad
                    try {
                        this.outputChannel.appendLine(`🔄 Executing fallback CMD command...`);
                        await this.executeCommand('cmd /c "taskkill /F /IM telepresence.exe 2>nul & taskkill /F /IM telepresence-daemon.exe 2>nul"');
                    } catch (error) {
                        this.outputChannel.appendLine(`⚠️ Fallback command completed: ${error}`);
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
                            this.outputChannel.appendLine(`🔄 Executing: ${cmd}`);
                            const result = await this.executeCommand(cmd);
                            this.outputChannel.appendLine(`✅ Result: ${result}`);
                        } catch (error) {
                            this.outputChannel.appendLine(`⚠️ Command completed: ${cmd}`);
                        }
                    }
                }
                
                // Esperar que los procesos terminen completamente
                await new Promise(resolve => setTimeout(resolve, 10000));
                this.outputChannel.appendLine(`✅ Telepresence daemon cleanup completed`);
                
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ Error in daemon cleanup (may be normal): ${error}`);
            }
        }
    }        
}