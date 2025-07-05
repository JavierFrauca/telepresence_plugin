// types.ts - Definiciones de tipos para la extensión

// Interfaces relacionadas con Telepresence
export interface TelepresenceInterception {
    deployment: string;
    namespace: string;
    status: 'intercepted' | 'available' | 'error';
    localPort?: number;
    targetPort?: number;
    interceptedBy?: string;
    clusterIP?: string;
    serviceIP?: string;
    fullDeploymentName?: string; // Para operaciones con telepresence
}

export interface TelepresenceSession {
    id: string;
    namespace: string;
    deployment: string;           // Nombre completo del deployment (ej: payrollapi-devendi74761)
    originalService: string;      // Nombre original proporcionado por el usuario (ej: payroll)
    localPort: number;
    status: 'connecting' | 'connected' | 'disconnecting' | 'error';
    process?: any;                // ChildProcess no está disponible en types compartidos
    startTime: Date;
    error?: string;
}

// Interface para estado de namespace
export interface NamespaceConnection {
    namespace: string;
    status: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
    startTime?: Date;
    error?: string;
}

export interface AuthenticationStatus {
    status: 'authenticated' | 'unauthenticated' | 'not-required' | 'error';
    isRequired: boolean;
    message?: string;
}

// Interfaces para mensajes del webview
export interface WebviewMessage {
    type: string;
    [key: string]: any;
}

// Mensajes desde el webview a la extensión
export interface ConnectNamespaceMessage extends WebviewMessage {
    type: 'connectNamespace';
    namespace: string;
}

export interface DisconnectNamespaceMessage extends WebviewMessage {
    type: 'disconnectNamespace';
}

export interface InterceptTrafficMessage extends WebviewMessage {
    type: 'interceptTraffic';
    data: {
        microservice: string;
        localPort: string;
    };
}

export interface DisconnectInterceptionMessage extends WebviewMessage {
    type: 'disconnectInterception';
    sessionId: string;
}

export interface DisconnectAllInterceptionsMessage extends WebviewMessage {
    type: 'disconnectAllInterceptions';
}

export interface GetNamespacesMessage extends WebviewMessage {
    type: 'getNamespaces';
}

export interface GetDeploymentsMessage extends WebviewMessage {
    type: 'getDeployments';
    namespace: string;
}

export interface CheckPrerequisitesMessage extends WebviewMessage {
    type: 'checkPrerequisites';
}

export interface GetTelepresenceStatusMessage extends WebviewMessage {
    type: 'getTelepresenceStatus';
}

export interface WebviewLoadedMessage extends WebviewMessage {
    type: 'webviewLoaded';
}

// Mensajes desde la extensión al webview
export interface LocalizedStringsMessage extends WebviewMessage {
    type: 'localizedStrings';
    strings: Record<string, string>;
    language: string;
    error?: string;
}

export interface NamespacesUpdateMessage extends WebviewMessage {
    type: 'namespacesUpdate';
    namespaces: string[];
}

export interface DeploymentsUpdateMessage extends WebviewMessage {
    type: 'deploymentsUpdate';
    namespace: string;
    deployments: string[];
}

export interface TelepresenceStatusUpdateMessage extends WebviewMessage {
    type: 'telepresenceStatusUpdate';
    status: {
        interceptions: any[];
        listOutput: string;
        connectionStatus: string;
        daemonStatus: string;
        timestamp: string;
        namespaceConnection: any;
        error?: string;
    };
}

export interface SessionsUpdateMessage extends WebviewMessage {
    type: 'sessionsUpdate';
    sessions: any[];
    namespaceConnection: any;
}

export interface ErrorMessage extends WebviewMessage {
    type: 'error';
    message: string;
    details?: string;
}