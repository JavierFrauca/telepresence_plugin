import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TelepresenceOutput } from './output';

const execAsync = promisify(exec);

export interface AuthInfo {
    needsAuth: boolean;
    authType: 'kubelogin' | 'aws' | 'gcp' | 'generic' | 'none';
    provider: 'azure' | 'aws' | 'gcp' | 'unknown';
    error?: string;
}

export class KubernetesManager {
    private outputChannel: vscode.OutputChannel;
    constructor() {
        this.outputChannel = TelepresenceOutput.getChannel();
    }

    async checkKubeloginInstalled(): Promise<boolean> {
        try {
            await execAsync('kubelogin --version');
            return true;
        } catch {
            return false;
        }
    }

    async getClusterAuthInfo(): Promise<AuthInfo> {
        this.outputChannel.appendLine(`🔍 Getting cluster authentication info...`);
        
        try {
            // 1. Analizar configuración de kubectl
            const config = await this.executeCommand('kubectl config view --minify');
            const provider = this.detectProvider(config);
            const authType = this.detectAuthType(config);
            
            this.outputChannel.appendLine(`📊 Detected: provider=${provider}, authType=${authType}`);

            // 2. Probar acceso real
            try {
                await this.executeCommand('kubectl auth whoami --request-timeout=10s');
                this.outputChannel.appendLine(`✅ Authentication successful`);
                return { needsAuth: false, authType, provider };
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`❌ Auth test failed: ${errorMessage}`);
                
                const isAuthError = this.isAuthenticationError(errorMessage);
                return { 
                    needsAuth: isAuthError, 
                    authType, 
                    provider,
                    error: isAuthError ? `Authentication required: ${errorMessage}` : `Non-auth error: ${errorMessage}`
                };
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`❌ Config analysis failed: ${errorMessage}`);
            
            return {
                needsAuth: true,
                authType: 'generic',
                provider: 'unknown',
                error: `Config analysis failed: ${errorMessage}`
            };
        }
    }

    async checkClusterAuthNeeded(): Promise<boolean> {
        const authInfo = await this.getClusterAuthInfo();
        return authInfo.needsAuth;
    }

    async checkKubeloginRequired(): Promise<boolean> {
        const authInfo = await this.getClusterAuthInfo();
        return authInfo.needsAuth && authInfo.authType === 'kubelogin';
    }

    async installKubelogin(): Promise<void> {
        this.outputChannel.appendLine('🔍 Checking administrator permissions...');
        
        const hasAdmin = await this.checkAdminRights();
        
        if (!hasAdmin) {
            const errorMessage = `❌ Administrator Permissions Required

    Automatic installation of Kubelogin requires administrator permissions.

    To install Kubelogin:
    1. Run VS Code as Administrator
    2. Or install manually from: https://github.com/Azure/kubelogin/releases
    3. Or use: choco install azure-kubelogin

    Once installed, restart VS Code in normal mode.`;

            this.outputChannel.appendLine('❌ No admin rights detected - aborting kubelogin installation');
            
            vscode.window.showErrorMessage(
                'Administrator permissions are required for automatic installation of Kubelogin.',
                { modal: true },
                'Open Releases',
                'View Documentation'
            ).then(choice => {
                if (choice === 'Open Releases') {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/Azure/kubelogin/releases/latest'));
                } else if (choice === 'View Documentation') {
                    vscode.env.openExternal(vscode.Uri.parse('https://azure.github.io/kubelogin/'));
                }
            });
            
            return;
        }

        this.outputChannel.appendLine('✅ Administrator permissions confirmed - proceeding with kubelogin installation');
        
        // Código de instalación original aquí...
        const terminal = vscode.window.createTerminal({
            name: 'Kubelogin Installer',
            shellPath: 'powershell.exe',
            shellArgs: ['-ExecutionPolicy', 'Bypass']
        });

        terminal.show();
        
        const installScript = `
# Kubelogin Installation Script
Write-Host "Starting Kubelogin installation..." -ForegroundColor Green

try {
    $ProgressPreference = 'SilentlyContinue'
    
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "Installing kubelogin via Chocolatey..." -ForegroundColor Yellow
        choco install azure-kubelogin -y
    } else {
        Write-Host "Chocolatey not found. Installing manually..." -ForegroundColor Yellow
        
        $latestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/Azure/kubelogin/releases/latest"
        $downloadUrl = ($latestRelease.assets | Where-Object { $_.name -like "*windows-amd64.zip" }).browser_download_url
        
        Write-Host "Downloading from: $downloadUrl" -ForegroundColor Yellow
        Invoke-WebRequest -Uri $downloadUrl -OutFile "kubelogin.zip"
        
        $installDir = "$env:USERPROFILE\\kubelogin"
        New-Item -ItemType Directory -Force -Path $installDir
        
        Expand-Archive -Path "kubelogin.zip" -DestinationPath $installDir -Force
        Remove-Item "kubelogin.zip"
        
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($currentPath -notlike "*$installDir*") {
            Write-Host "Adding kubelogin to PATH..." -ForegroundColor Yellow
            [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$installDir", "User")
            $env:PATH = "$env:PATH;$installDir"
        }
    }
    
    Write-Host "Installation completed successfully!" -ForegroundColor Green
    Write-Host "Please restart VS Code to use kubelogin." -ForegroundColor Cyan
    
    kubelogin --version
    
} catch {
    Write-Error "Installation failed: $_"
    Write-Host "You can also install manually from: https://github.com/Azure/kubelogin/releases" -ForegroundColor Yellow
}
        `;

        terminal.sendText(installScript);
    }

    async installKubectl(): Promise<void> {
        this.outputChannel.appendLine('🔍 Checking administrator permissions...');
        const hasAdmin = await this.checkAdminRights();
        if (!hasAdmin) {
            const errorMessage = `❌ Administrator Permissions Required\n\n    Automatic installation of kubectl requires administrator permissions.\n\n    To install kubectl:\n    1. Run VS Code as Administrator\n    2. Or install manually from: https://kubernetes.io/docs/tasks/tools/#kubectl\n    3. Or use: choco install kubernetes-cli\n\n    Once installed, restart VS Code in normal mode.`;
            this.outputChannel.appendLine('❌ No admin rights detected - aborting kubectl installation');
            vscode.window.showErrorMessage(
                'Administrator permissions are required for automatic installation of kubectl.',
                { modal: true },
                'Open Releases',
                'View Documentation'
            ).then(choice => {
                if (choice === 'Open Releases') {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/kubernetes/kubernetes/releases/latest'));
                } else if (choice === 'View Documentation') {
                    vscode.env.openExternal(vscode.Uri.parse('https://kubernetes.io/docs/tasks/tools/#kubectl'));
                }
            });
            return;
        }
        this.outputChannel.appendLine('✅ Administrator permissions confirmed - proceeding with kubectl installation');
        const terminal = vscode.window.createTerminal({
            name: 'kubectl Installer',
            shellPath: 'powershell.exe',
            shellArgs: ['-ExecutionPolicy', 'Bypass']
        });
        terminal.show();
        const installScript = `
# kubectl Installation Script
Write-Host "Starting kubectl installation..." -ForegroundColor Green
try {
    $ProgressPreference = 'SilentlyContinue'
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "Installing kubectl via Chocolatey..." -ForegroundColor Yellow
        choco install kubernetes-cli -y
    } else {
        Write-Host "Chocolatey not found. Installing manually..." -ForegroundColor Yellow
        $latestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/kubernetes/kubernetes/releases/latest"
        $asset = $latestRelease.assets | Where-Object { $_.name -like '*windows-amd64.exe' } | Select-Object -First 1
        if ($asset -eq $null) { throw 'No Windows binary found in latest release.' }
        $downloadUrl = $asset.browser_download_url
        Write-Host "Downloading from: $downloadUrl" -ForegroundColor Yellow
        Invoke-WebRequest -Uri $downloadUrl -OutFile "kubectl.exe"
        $installDir = "$env:USERPROFILE\\kubectl"
        New-Item -ItemType Directory -Force -Path $installDir
        Move-Item -Path "kubectl.exe" -Destination $installDir -Force
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($currentPath -notlike "*$installDir*") {
            Write-Host "Adding kubectl to PATH..." -ForegroundColor Yellow
            [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$installDir", "User")
            $env:PATH = "$env:PATH;$installDir"
        }
    }
    Write-Host "Installation completed successfully!" -ForegroundColor Green
    Write-Host "Please restart VS Code to use kubectl." -ForegroundColor Cyan
    kubectl version --client
} catch {
    Write-Error "Installation failed: $_"
    Write-Host "You can also install manually from: https://kubernetes.io/docs/tasks/tools/#kubectl" -ForegroundColor Yellow
}`;
        terminal.sendText(installScript);
    }

    async executeKubelogin(action: 'login' | 'convert-kubeconfig' = 'login'): Promise<void> {
        try {
            if (!await this.checkKubeloginInstalled()) {
                const result = await vscode.window.showWarningMessage(
                    'Kubelogin is not installed. Do you want to install it?',
                    'Install Now',
                    'Cancel'
                );
                
                if (result === 'Install Now') {
                    await this.installKubelogin();
                    return;
                } else {
                    throw new Error('Kubelogin is required for Azure authentication');
                }
            }

            const terminal = vscode.window.createTerminal({
                name: 'Kubelogin',
                shellPath: 'powershell.exe'
            });

            terminal.show();

            let command = '';
            switch (action) {
                case 'login':
                    command = 'kubelogin login';
                    break;
                case 'convert-kubeconfig':
                    command = 'kubelogin convert-kubeconfig -l azurecli';
                    break;
            }

            this.outputChannel.appendLine(`Executing kubelogin: ${command}`);
            terminal.sendText(command);

        } catch (error) {
            vscode.window.showErrorMessage(`Kubelogin failed: ${error}`);
            throw error;
        }
    }

    async getCurrentContext(): Promise<string | null> {
        try {
            const { stdout } = await execAsync('kubectl config current-context');
            return stdout.trim();
        } catch {
            return null;
        }
    }

    async getNamespaces(): Promise<string[]> {
        try {
            const { stdout } = await execAsync('kubectl get namespaces -o jsonpath="{.items[*].metadata.name}"');
            return stdout.trim().split(' ').filter((ns: string) => ns.length > 0);
        } catch {
            return [];
        }
    }

    async getDeploymentsInNamespace(namespace: string): Promise<string[]> {
        try {
            const { stdout } = await execAsync(`kubectl get deployments -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`);
            return stdout.trim().split(' ').filter((dep: string) => dep.length > 0);
        } catch {
            return [];
        }
    }
    /**
     * List pods in a namespace
     */
    async getPodsInNamespace(namespace: string): Promise<string[]> {
        try {
            const { stdout } = await execAsync(`kubectl get pods -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`);
            return stdout.trim().split(' ').filter((pod: string) => pod.length > 0);
        } catch {
            return [];
        }
    }

    /**
     * Get details of a pod (describe)
     */
    async getPodDetails(namespace: string, podName: string): Promise<string> {
        try {
            const { stdout } = await execAsync(`kubectl describe pod ${podName} -n ${namespace}`);
            return stdout;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    /**
     * Get details of a deployment (describe)
     */
    async getDeploymentDetails(namespace: string, deploymentName: string): Promise<string> {
        try {
            const { stdout } = await execAsync(`kubectl describe deployment ${deploymentName} -n ${namespace}`);
            return stdout;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    /**
     * Delete a pod
     */
    async deletePod(namespace: string, podName: string): Promise<boolean> {
        try {
            await execAsync(`kubectl delete pod ${podName} -n ${namespace}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Delete a deployment
     */
    async deleteDeployment(namespace: string, deploymentName: string): Promise<boolean> {
        try {
            await execAsync(`kubectl delete deployment ${deploymentName} -n ${namespace}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Scale a deployment
     */
    async scaleDeployment(namespace: string, deploymentName: string, replicas: number): Promise<boolean> {
        try {
            await execAsync(`kubectl scale deployment ${deploymentName} --replicas=${replicas} -n ${namespace}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Restart a deployment (using rollout restart)
     */
    async restartDeployment(namespace: string, deploymentName: string): Promise<boolean> {
        try {
            await execAsync(`kubectl rollout restart deployment ${deploymentName} -n ${namespace}`);
            return true;
        } catch {
            return false;
        }
    }
        
    async checkKubectlInstalled(): Promise<boolean> {
        try {
            await execAsync('kubectl version --client');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Logout de Azure y limpieza de tokens
     */
    async logout(clearTokens: boolean = true): Promise<void> {
        this.outputChannel.appendLine('🚪 Starting Azure logout process...');
        
        try {
            // 1. Azure CLI logout
            try {
                await execAsync('az logout');
                this.outputChannel.appendLine('✅ Azure CLI logout successful');
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ Azure CLI logout failed: ${error}`);
            }

            // 2. Clear kubelogin token cache
            if (clearTokens) {
                await this.clearKubeloginTokens();
            }

            // 3. Reset kubectl auth
            await this.resetKubectlAuth();

            this.outputChannel.appendLine('✅ Logout process completed');

        } catch (error) {
            this.outputChannel.appendLine(`❌ Logout process failed: ${error}`);
            throw error;
        }
    }

    /**
     * Limpia tokens específicos de kubelogin
     */
    async clearKubeloginTokens(): Promise<void> {
        this.outputChannel.appendLine('🧹 Clearing kubelogin tokens...');
        
        const os = require('os');
        const fs = require('fs');
        const path = require('path');

        const tokenLocations = [
            path.join(os.homedir(), '.kube', 'cache', 'kubelogin'),
            path.join(os.homedir(), '.azure', 'msal_token_cache.json'),
            path.join(os.homedir(), '.azure', 'accessTokens.json'),
            path.join(os.homedir(), '.azure', 'azureProfile.json')
        ];

        for (const location of tokenLocations) {
            try {
                if (fs.existsSync(location)) {
                    if (fs.statSync(location).isDirectory()) {
                        fs.rmSync(location, { recursive: true, force: true });
                        this.outputChannel.appendLine(`🗑️ Removed directory: ${location}`);
                    } else {
                        fs.unlinkSync(location);
                        this.outputChannel.appendLine(`🗑️ Removed file: ${location}`);
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ Could not remove ${location}: ${error}`);
            }
        }
    }

    /**
     * Reset kubectl authentication
     */
    private async resetKubectlAuth(): Promise<void> {
        this.outputChannel.appendLine('🔄 Resetting kubectl authentication...');
        
        try {
            const contextResult = await execAsync('kubectl config current-context');
            const currentContext = contextResult.stdout.trim();
            
            // Commands to reset auth
            const resetCommands = [
                `kubectl config unset users.${currentContext}.auth-provider`,
                `kubectl config unset users.${currentContext}.token`,
                `kubectl config unset users.${currentContext}.tokenFile`,
                `kubectl config unset users.${currentContext}.exec`
            ];

            for (const cmd of resetCommands) {
                try {
                    await execAsync(cmd);
                    this.outputChannel.appendLine(`✅ ${cmd}`);
                } catch (error) {
                    // These may fail if keys don't exist, which is normal
                    this.outputChannel.appendLine(`ℹ️ ${cmd} - ${error}`);
                }
            }
            
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ Could not reset kubectl auth: ${error}`);
            // Don't throw, as this is not critical
        }
    }

    /**
     * Get detailed cluster information for detection
     */
    async getDetailedClusterInfo(): Promise<any> {
        this.outputChannel.appendLine('🔍 Getting detailed cluster information...');
        
        try {
            const results: any = {};
            
            // Get kubeconfig
            try {
                const configResult = await execAsync('kubectl config view --minify -o json');
                results.kubeconfig = JSON.parse(configResult.stdout);
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ Could not get kubeconfig: ${error}`);
            }

            // Get cluster info
            try {
                const clusterInfoResult = await execAsync('kubectl cluster-info --request-timeout=5s');
                results.clusterInfo = clusterInfoResult.stdout;
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ Could not get cluster info: ${error}`);
            }

            // Get server version
            try {
                const versionResult = await execAsync('kubectl version -o json --request-timeout=5s');
                results.version = JSON.parse(versionResult.stdout);
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ Could not get version info: ${error}`);
            }

            // Get nodes info (first node only)
            try {
                const nodesResult = await execAsync('kubectl get nodes -o json --request-timeout=5s');
                const nodesData = JSON.parse(nodesResult.stdout);
                results.nodes = nodesData.items?.slice(0, 1);
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ Could not get nodes info: ${error}`);
            }

            return results;

        } catch (error) {
            this.outputChannel.appendLine(`❌ Failed to get detailed cluster info: ${error}`);
            throw error;
        }
    }

    /**
     * Execute kubelogin with custom configuration
     */
    async executeKubeloginWithConfig(config: any): Promise<void> {
        this.outputChannel.appendLine('🔐 Executing kubelogin with custom configuration...');
        
        try {
            if (!await this.checkKubeloginInstalled()) {
                throw new Error('Kubelogin is not installed');
            }

            // Build command based on config
            let command = 'kubelogin convert-kubeconfig';
            command += ` -l ${config.loginMethod}`;

            if (config.tenantId) command += ` --tenant-id "${config.tenantId}"`;
            if (config.clientId) command += ` --client-id "${config.clientId}"`;
            if (config.clientSecret) command += ` --client-secret "${config.clientSecret}"`;
            if (config.username) command += ` --username "${config.username}"`;
            if (config.password) command += ` --password "${config.password}"`;
            if (config.serverPort) command += ` --server-port ${config.serverPort}`;
            if (config.environment && config.environment !== 'AzurePublicCloud') {
                command += ` --environment ${config.environment}`;
            }
            if (config.isLegacy) command += ' --legacy';
            if (config.tokenCacheDir) command += ` --token-cache-dir "${config.tokenCacheDir}"`;
            if (config.useAzureRMTerraformEnv) command += ' --use-azurerm-env-vars';
            if (config.federatedTokenFile) command += ` --federated-token-file "${config.federatedTokenFile}"`;
            if (config.authority) command += ` --authority "${config.authority}"`;

            this.outputChannel.appendLine(`🔄 Executing: kubelogin convert-kubeconfig [with custom config]`);
            
            // Execute with timeout
            const result = await execAsync(command, { timeout: 120000 });
            
            this.outputChannel.appendLine('✅ Kubelogin execution completed successfully');
            this.outputChannel.appendLine(`Output: ${result.stdout}`);

        } catch (error) {
            this.outputChannel.appendLine(`❌ Kubelogin execution failed: ${error}`);
            throw error;
        }
    }

    private detectProvider(config: string): 'azure' | 'aws' | 'gcp' | 'unknown' {
        const configLower = config.toLowerCase();
        
        if (configLower.includes('azmk8s.io') || configLower.includes('azure') || configLower.includes('kubelogin')) {
            return 'azure';
        } else if (configLower.includes('eks.amazonaws.com') || configLower.includes('aws')) {
            return 'aws';
        } else if (configLower.includes('container.googleapis.com') || configLower.includes('gcp') || configLower.includes('gke')) {
            return 'gcp';
        }
        
        return 'unknown';
    }

    private detectAuthType(config: string): 'kubelogin' | 'aws' | 'gcp' | 'generic' {
        const configLower = config.toLowerCase();
        
        if (configLower.includes('kubelogin') || configLower.includes('azurecli')) {
            return 'kubelogin';
        } else if (configLower.includes('aws-iam-authenticator') || configLower.includes('eks')) {
            return 'aws';
        } else if (configLower.includes('gke-gcloud-auth-plugin') || configLower.includes('gcp')) {
            return 'gcp';
        }
        
        return 'generic';
    }

    private isAuthenticationError(errorMessage: string): boolean {
        const authErrorKeywords = [
            'unauthorized', 'forbidden', 'authentication', 'token', 'auth', 'login', 
            'credential', 'permission', 'expired', 'denied', 'access', 'certificate'
        ];
        
        return authErrorKeywords.some(keyword => 
            errorMessage.toLowerCase().includes(keyword)
        );
    }

    /**
     * Ejecuta un comando de shell y devuelve el resultado
     * Este método está disponible para componentes que necesitan ejecutar comandos
     */
    public async runCommand(command: string): Promise<{success: boolean, stdout?: string, stderr?: string}> {
        this.outputChannel.appendLine(`Running command: ${command}`);
        
        try {
            const execOptions = process.platform === 'win32' 
                ? { shell: 'powershell.exe' as const }
                : { shell: '/bin/bash' as const };
                
            const { stdout, stderr } = await execAsync(command, execOptions);
            
            if (stderr) {
                this.outputChannel.appendLine(`Warning: ${stderr}`);
            }
            
            return { success: true, stdout, stderr };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Error executing command: ${errorMessage}`);
            
            if (error instanceof Error && 'stderr' in error) {
                const execError = error as any;
                return { 
                    success: false, 
                    stderr: execError.stderr ? String(execError.stderr) : errorMessage 
                };
            }
            
            return { success: false, stderr: errorMessage };
        }
    }

    public async executeCommand(command: string): Promise<string> {
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

    public async checkAdminRights(): Promise<boolean> {
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

    /**
     * Check if Azure CLI is installed
     */
    async checkAzureCliInstalled(): Promise<boolean> {
        try {
            await execAsync('az --version');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if AWS CLI is installed
     */
    async checkAwsCliInstalled(): Promise<boolean> {
        try {
            await execAsync('aws --version');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if Google Cloud CLI is installed
     */
    async checkGcloudCliInstalled(): Promise<boolean> {
        // Paths where gcloud might be installed
        const possiblePaths = [
            'gcloud',                                                         // On PATH
            'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',  // Default Windows install path
            '%LOCALAPPDATA%\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',          // User install path (Windows)
            '%ProgramFiles%\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',          // Alternative Windows path
            '/usr/bin/gcloud',                                                // Linux path
            '/usr/local/bin/gcloud',                                          // Another Linux path
            '/opt/google-cloud-sdk/bin/gcloud',                                // Custom Linux path
            '$HOME/google-cloud-sdk/bin/gcloud'                                // User install path (Linux/Mac)
        ];

        this.outputChannel.appendLine(`🔍 Checking for Google Cloud CLI installation...`);
        
        for (const path of possiblePaths) {
            try {
                // Expand environment variables in the path
                const expandedPath = this.expandEnvVars(path);
                this.outputChannel.appendLine(`⏳ Trying path: ${expandedPath}`);
                
                // Try with the full path or just 'gcloud' for PATH lookup
                const command = path === 'gcloud' ? 'gcloud --version' : `"${expandedPath}" --version`;
                const result = await execAsync(command);
                
                this.outputChannel.appendLine(`✅ Google Cloud CLI found at: ${expandedPath}`);
                this.outputChannel.appendLine(`   Version info: ${result.stdout.split('\n')[0]}`);
                return true;
            } catch (error) {
                // Continue to next path
                this.outputChannel.appendLine(`❌ Not found at: ${path}`);
            }
        }
        
        this.outputChannel.appendLine(`❌ Google Cloud CLI not found in any standard location`);
        return false;
    }
    
    /**
     * Expands environment variables in a path string
     */
    private expandEnvVars(path: string): string {
        return path.replace(/%([^%]+)%/g, (_, envVar) => {
            return process.env[envVar] || '';
        }).replace(/\$([A-Za-z0-9_]+)/g, (_, envVar) => {
            return process.env[envVar] || '';
        });
    }

    /**
     * Check if minikube is installed
     */
    async checkMinikubeInstalled(): Promise<boolean> {
        try {
            await execAsync('minikube version');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Install a CLI tool based on provider type
     */
    async installCliTool(toolType: 'az' | 'aws' | 'gcloud' | 'kubectl' | 'kubelogin' | 'minikube'): Promise<void> {
        this.outputChannel.appendLine(`🔧 Preparing to install ${toolType}...`);
        
        // Installation instructions by tool type
        const instructions: Record<string, { command: string, manualUrl: string }> = {
            az: { 
                command: 'winget install Microsoft.AzureCLI',
                manualUrl: 'https://docs.microsoft.com/en-us/cli/azure/install-azure-cli'
            },
            aws: { 
                command: 'winget install Amazon.AWSCLI',
                manualUrl: 'https://aws.amazon.com/cli/'
            },
            gcloud: { 
                command: 'winget install Google.CloudSDK',
                manualUrl: 'https://cloud.google.com/sdk/docs/install'
            },
            kubectl: { 
                command: 'winget install Kubernetes.kubectl',
                manualUrl: 'https://kubernetes.io/docs/tasks/tools/'
            },
            kubelogin: { 
                command: 'winget install Azure.kubelogin',
                manualUrl: 'https://github.com/Azure/kubelogin'
            },
            minikube: { 
                command: 'winget install Kubernetes.minikube',
                manualUrl: 'https://minikube.sigs.k8s.io/docs/start/'
            }
        };

        const info = instructions[toolType];
        
        // Ask user for permission
        const installResponse = await vscode.window.showInformationMessage(
            `${toolType} is required but not installed. Would you like to install it now?`,
            { modal: true },
            'Install',
            'Manual Install',
            'Cancel'
        );
        
        if (installResponse === 'Install') {
            try {
                const terminal = vscode.window.createTerminal(`Installing ${toolType}`);
                terminal.show();
                terminal.sendText(info.command);
                
                this.outputChannel.appendLine(`🚀 Starting installation of ${toolType}...`);
                
                // Mostrar un mensaje enfático sobre la necesidad de reiniciar
                const message = `${toolType} está siendo instalado.\n\nIMPORTANTE: Después de que la instalación se complete, DEBERÁ REINICIAR VS Code para que la herramienta sea detectada correctamente.`;
                
                // Usar un mensaje modal con botón explícito para que el usuario lo note
                vscode.window.showWarningMessage(
                    message,
                    { modal: true, detail: 'Las nuevas herramientas instaladas requieren reiniciar VS Code para actualizar la configuración del sistema.' },
                    'Entendido'
                ).then(() => {
                    // Después de que el usuario cierre el mensaje, programar otro recordatorio
                    setTimeout(() => {
                        vscode.window.showInformationMessage(
                            `Recuerde reiniciar VS Code después de que la instalación de ${toolType} se complete.`,
                            'Reiniciar ahora',
                            'Más tarde'
                        ).then(selection => {
                            if (selection === 'Reiniciar ahora') {
                                vscode.commands.executeCommand('workbench.action.reloadWindow');
                            }
                        });
                    }, 10000); // Mostrar el recordatorio después de 10 segundos
                });
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`❌ Error during installation: ${errorMessage}`);
                
                vscode.window.showErrorMessage(
                    `Failed to install ${toolType}. Please install it manually.`
                );
            }
        } else if (installResponse === 'Manual Install') {
            vscode.env.openExternal(vscode.Uri.parse(info.manualUrl));
        }
    }

    /**
     * Helps troubleshoot Google Cloud CLI installation issues
     */
    async troubleshootGcloudInstallation(): Promise<void> {
        this.outputChannel.appendLine(`\n🛠️ Iniciando solución de problemas de Google Cloud CLI...`);
        
        // 1. Intentar encontrar la instalación de gcloud
        const isInstalled = await this.checkGcloudCliInstalled();
        
        if (isInstalled) {
            this.outputChannel.appendLine(`✅ Google Cloud CLI parece estar instalado correctamente.`);
        } else {
            this.outputChannel.appendLine(`❌ No se pudo detectar Google Cloud CLI en las rutas estándar.`);
        }
        
        // 2. Verificar la variable PATH
        this.outputChannel.appendLine(`\n🔍 Comprobando la variable PATH del sistema:`);
        try {
            const pathVar = process.env.PATH || '';
            this.outputChannel.appendLine(`   PATH = ${pathVar}`);
            
            // Verificar si alguna ruta de Cloud SDK está en el PATH
            const hasCloudSdk = pathVar.toLowerCase().includes('cloud sdk') || 
                                pathVar.toLowerCase().includes('google-cloud-sdk');
            
            if (hasCloudSdk) {
                this.outputChannel.appendLine(`✅ Se encontró una ruta de Cloud SDK en la variable PATH.`);
            } else {
                this.outputChannel.appendLine(`❌ No se encontró ninguna ruta de Cloud SDK en la variable PATH.`);
            }
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error al comprobar la variable PATH: ${error}`);
        }
        
        // 3. Sugerencias para el usuario
        this.outputChannel.appendLine(`\n📋 Sugerencias para solucionar problemas:`);
        this.outputChannel.appendLine(`   1. Reinicie completamente su sistema (no solo VS Code).`);
        this.outputChannel.appendLine(`   2. Asegúrese de que la instalación de Google Cloud SDK ha completado correctamente.`);
        this.outputChannel.appendLine(`   3. Verifique si puede ejecutar 'gcloud --version' en un terminal externo.`);
        this.outputChannel.appendLine(`   4. Si el comando funciona en un terminal externo pero no en VS Code, puede ser un problema de PATH.`);
        
        // 4. Opciones para solucionar el problema
        const selection = await vscode.window.showInformationMessage(
            'Problemas para detectar Google Cloud CLI. ¿Qué desea hacer?',
            'Abrir Terminal para Verificar', 
            'Ver Ubicaciones de Instalación',
            'Usar Cloud SDK Shell'
        );
        
        if (selection === 'Abrir Terminal para Verificar') {
            const terminal = vscode.window.createTerminal('Verificar gcloud');
            terminal.show();
            terminal.sendText('gcloud --version');
            terminal.sendText('echo %PATH%');
        } else if (selection === 'Ver Ubicaciones de Instalación') {
            this.outputChannel.appendLine(`\n📂 Ubicaciones comunes de instalación de Google Cloud SDK:`);
            this.outputChannel.appendLine(`   - C:\\Program Files (x86)\\Google\\Cloud SDK\\`);
            this.outputChannel.appendLine(`   - %LOCALAPPDATA%\\Google\\Cloud SDK\\`);
            this.outputChannel.appendLine(`   - %USERPROFILE%\\AppData\\Local\\Google\\Cloud SDK\\`);
            this.outputChannel.show();
        } else if (selection === 'Usar Cloud SDK Shell') {
            try {
                await execAsync('start cmd.exe /k "C:\\Program Files (x86)\\Google\\Cloud SDK\\cloud_env.bat"');
                this.outputChannel.appendLine(`✅ Iniciando Google Cloud SDK Shell...`);
            } catch {
                this.outputChannel.appendLine(`❌ No se pudo iniciar Google Cloud SDK Shell.`);
                vscode.window.showErrorMessage('No se pudo iniciar Google Cloud SDK Shell. Por favor, verifique su instalación.');
            }
        }
    }
}