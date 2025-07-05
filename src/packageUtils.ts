import * as path from 'path';
import * as fs from 'fs';
import { TelepresenceOutput } from './output';

export interface PackageInfo {
    name: string;
    displayName: string;
    version: string;
    description: string;
    publisher: string;
    repository?: {
        url: string;
    };
}

let cachedPackageInfo: PackageInfo | null = null;

/**
 * Carga la información del package.json de forma segura
 * Funciona tanto en desarrollo como en producción (compilado)
 */
export function getPackageInfo(): PackageInfo {
    if (cachedPackageInfo) {
        return cachedPackageInfo;
    }

    // Valores por defecto en caso de que no se pueda cargar el package.json
    const defaultPackageInfo: PackageInfo = {
        name: 'telepresence-gui',
        displayName: 'Telepresence GUI',
        version: '1.0.12',
        description: 'Graphical interface for managing Telepresence in Kubernetes',
        publisher: 'JavierFrauca',
        repository: {
            url: 'https://github.com/JavierFrauca/telepresence_plugin'
        }
    };

    try {
        // Intentar diferentes rutas posibles para el package.json
        const possiblePaths = [
            path.join(__dirname, '..', 'package.json'),           // Desde out/
            path.join(__dirname, '..', '..', 'package.json'),     // Desde out/src/ o similar
            path.join(__dirname, 'package.json'),                 // En el mismo directorio
            path.join(process.cwd(), 'package.json')              // Directorio de trabajo
        ];

        let packageJsonPath: string | null = null;
        
        // Buscar el package.json en las rutas posibles
        for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
                packageJsonPath = possiblePath;
                break;
            }
        }

        if (packageJsonPath) {
            const packageContent = fs.readFileSync(packageJsonPath, 'utf8');
            const packageJson = JSON.parse(packageContent);
            
            // Crear el objeto con valores seguros
            cachedPackageInfo = {
                name: packageJson.name || defaultPackageInfo.name,
                displayName: packageJson.displayName || defaultPackageInfo.displayName,
                version: packageJson.version || defaultPackageInfo.version,
                description: packageJson.description || defaultPackageInfo.description,
                publisher: packageJson.publisher || defaultPackageInfo.publisher,
                repository: packageJson.repository || defaultPackageInfo.repository
            };

            const outputChannel = TelepresenceOutput.getChannel();
            outputChannel.appendLine(`[Telepresence] ✅ Package info loaded from: ${packageJsonPath}`);
            outputChannel.appendLine(`[Telepresence] 📦 Extension: ${cachedPackageInfo.displayName} v${cachedPackageInfo.version}`);
            
            return cachedPackageInfo;
        } else {
            const outputChannel = TelepresenceOutput.getChannel();
            outputChannel.appendLine('[Telepresence] ⚠️ package.json not found in any expected location, using defaults');
        }
    } catch (error) {
        const outputChannel = TelepresenceOutput.getChannel();
        outputChannel.appendLine(`[Telepresence] ❌ Error loading package.json: ${error}`);
    }

    // If it couldn't be loaded, use default values
    cachedPackageInfo = defaultPackageInfo;
    return cachedPackageInfo;
}

/**
 * Obtiene solo la versión del package
 */
export function getVersion(): string {
    return getPackageInfo().version;
}

/**
 * Obtiene el nombre completo para mostrar
 */
export function getDisplayName(): string {
    return getPackageInfo().displayName;
}

/**
 * Obtiene la URL del repositorio
 */
export function getRepositoryUrl(): string {
    return getPackageInfo().repository?.url || 'https://github.com/JavierFrauca/telepresence_plugin';
}