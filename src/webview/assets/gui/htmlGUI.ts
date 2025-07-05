import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPackageInfo } from '../../../packageUtils';
import { i18n } from '../../../i18n/localizationManager';

/**
 * Generador de HTML para el webview de Telepresence
 * Utiliza archivos CSS y JS externos para mejor organización
 */
export class WebviewHtmlGenerator {
    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Genera el contenido HTML completo del webview
     * @param webview - Instancia del webview de VS Code
     * @returns HTML string completo
     */
    public getWebviewContent(webview: vscode.Webview): string {
        const packageInfo = getPackageInfo();
        const cssUri = this.getResourceUri(webview, 'css', 'styles.css');
        const jsUri = this.getResourceUri(webview, 'js', 'scripts.js');
        const localizationJsUri = this.getResourceUri(webview, 'js', 'localization.js');
        const iconUri = this.getResourceUri(webview, 'images', 'icon.png');
        const cspSource = webview.cspSource;
        const repoUrl = packageInfo.repository?.url || 'https://github.com/JavierFrauca/telepresence_plugin';

        // Ruta absoluta al archivo HTML base
        const htmlPath = path.join(
            this.extensionUri.fsPath,
            'src',
            'webview',
            'assets',
            'gui',
            'webview.html'
        );
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Reemplazo de marcadores
        html = html.replace(/{{version}}/g, packageInfo.version)
            .replace(/{{iconUri}}/g, String(iconUri))
            .replace(/{{cssUri}}/g, String(cssUri))
            .replace(/{{jsUri}}/g, String(jsUri))
            .replace(/{{localizationJsUri}}/g, String(localizationJsUri))
            .replace(/{{cspSource}}/g, cspSource)
            .replace(/{{repoUrl}}/g, repoUrl)
            .replace(/lang="en"/g, `lang="${i18n.getLanguage()}"`);

        return html;
    }

    /**
     * Genera la URI para un archivo de recurso específico
     * @param webview - Instancia del webview
     * @param folder - Carpeta del recurso (css, js, etc.)
     * @param filename - Nombre del archivo
     * @returns URI del webview para el recurso
     */
    private getResourceUri(webview: vscode.Webview, folder: string, filename: string): vscode.Uri {
        const resourcePath = vscode.Uri.joinPath(
            this.extensionUri, 
            'src', 
            'webview', 
            'assets', 
            'gui',
            folder, 
            filename
        );
        return webview.asWebviewUri(resourcePath);
    }
}
