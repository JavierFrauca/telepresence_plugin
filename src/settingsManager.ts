import * as vscode from 'vscode';

export interface ConnectionConfig {
    namespace: string;
    microservice: string;
    localPort: number;
    context: string;
    timestamp: number;
}

export interface SettingsManager {
    getRequiredContext(): string | undefined;
    shouldShowContextWarning(): boolean;
    getDefaultLocalPort(): number;
    getDefaultNamespace(): string;
}

export class TelepresenceSettingsManager implements SettingsManager {

    private getConfiguration(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('telepresence');
    }

    // This method should be overridden in subclasses to provide the workspace state.
    // By default, throws an error to indicate it must be implemented.
    protected getWorkspaceState(): vscode.Memento {
        throw new Error('getWorkspaceState() not implemented. Use InjectedTelepresenceSettingsManager and provide workspaceState.');
    }
    
    getRequiredContext(): string | undefined {
        const config = this.getConfiguration();
        const requiredContext = config.get<string>('requiredContext', '');
        return requiredContext.trim() || undefined;
    }

    shouldShowContextWarning(): boolean {
        const config = this.getConfiguration();
        return config.get<boolean>('showContextWarning', true);
    }

    getDefaultLocalPort(): number {
        const config = this.getConfiguration();
        return config.get<number>('defaultLocalPort', 5002);
    }

    getDefaultNamespace(): string {
        const config = this.getConfiguration();
        return config.get<string>('defaultNamespace', '');
    }

}

// Implementación con inyección de dependencias
export class InjectedTelepresenceSettingsManager extends TelepresenceSettingsManager {
    constructor(private workspaceState: vscode.Memento) {
        super();
    }

    protected getWorkspaceState(): vscode.Memento {
        return this.workspaceState;
    }
}