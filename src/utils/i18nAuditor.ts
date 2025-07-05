import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { i18n } from '../i18n/localizationManager';

/**
 * Utilidad para auditar y asegurar la correcta internacionalización
 * de la extensión.
 */
export class I18nAuditor {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly extensionPath: string;
    private englishStrings: Record<string, string> = {};
    private spanishStrings: Record<string, string> = {};
    private missingKeys: { key: string, lang: string }[] = [];
    
    /**
     * Constructor
     * @param extensionPath - Ruta al directorio de la extensión
     */
    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
        this.outputChannel = vscode.window.createOutputChannel('Telepresence I18n Auditor');
    }
    
    /**
     * Carga todos los archivos de localización
     */
    private loadLocalizationFiles(): void {
        // Cargar archivo inglés
        const enPath = path.join(this.extensionPath, 'src', 'i18n', 'en.json');
        if (fs.existsSync(enPath)) {
            this.englishStrings = JSON.parse(fs.readFileSync(enPath, 'utf8'));
        }
        
        // Cargar archivo español
        const esPath = path.join(this.extensionPath, 'src', 'i18n', 'es.json');
        if (fs.existsSync(esPath)) {
            this.spanishStrings = JSON.parse(fs.readFileSync(esPath, 'utf8'));
        }
    }
    
    /**
     * Verifica la consistencia de los archivos de localización
     */
    public auditLocalizationFiles(): boolean {
        this.loadLocalizationFiles();
        this.missingKeys = [];
        
        // Verificar que todas las claves de inglés existan en español
        Object.keys(this.englishStrings).forEach(key => {
            if (!this.spanishStrings[key]) {
                this.missingKeys.push({ key, lang: 'es' });
            }
        });
        
        // Verificar que todas las claves de español existan en inglés
        Object.keys(this.spanishStrings).forEach(key => {
            if (!this.englishStrings[key]) {
                this.missingKeys.push({ key, lang: 'en' });
            }
        });
        
        // Reportar resultados
        if (this.missingKeys.length === 0) {
            this.outputChannel.appendLine('✅ All localization keys are consistent across languages');
            return true;
        } else {
            this.outputChannel.appendLine(`⚠️ Found ${this.missingKeys.length} inconsistent localization keys:`);
            this.missingKeys.forEach(item => {
                this.outputChannel.appendLine(`  - Key "${item.key}" is missing in ${item.lang} language file`);
            });
            this.outputChannel.show();
            return false;
        }
    }
    
    /**
     * Ejecuta una auditoría para buscar strings hardcodeados en los archivos
     * @param filePaths - Lista de rutas a archivos .ts
     */
    public auditHardcodedStrings(filePaths: string[]): void {
        this.outputChannel.appendLine('🔍 Starting audit for hardcoded strings...');
        
        const hardcodedPatterns = [
            /vscode\.window\.showInformationMessage\(['"](.+?)['"]/g,
            /vscode\.window\.showErrorMessage\(['"](.+?)['"]/g,
            /vscode\.window\.showWarningMessage\(['"](.+?)['"]/g,
            /title:\s*['"](.+?)['"]/g,
            /prompt:\s*['"](.+?)['"]/g,
            /placeHolder:\s*['"](.+?)['"]/g,
            /label:\s*['"](.+?)['"]/g,
            /description:\s*['"](.+?)['"]/g
        ];
        
        let totalHardcoded = 0;
        
        filePaths.forEach(filePath => {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                let fileHasHardcoded = false;
                
                hardcodedPatterns.forEach(pattern => {
                    const matches = Array.from(content.matchAll(pattern));
                    if (matches.length > 0) {
                        if (!fileHasHardcoded) {
                            this.outputChannel.appendLine(`\n📄 ${path.basename(filePath)}:`);
                            fileHasHardcoded = true;
                        }
                        
                        matches.forEach(match => {
                            const text = match[1];
                            // Ignorar strings que parecen ser claves de localización
                            if (!text.includes('.') || text.split('.').length < 2) {
                                this.outputChannel.appendLine(`  - "${text}"`);
                                totalHardcoded++;
                            }
                        });
                    }
                });
            }
        });
        
        if (totalHardcoded === 0) {
            this.outputChannel.appendLine('✅ No hardcoded strings found in UI text');
        } else {
            this.outputChannel.appendLine(`\n⚠️ Found ${totalHardcoded} potentially hardcoded strings that should be localized`);
            this.outputChannel.appendLine('   Consider moving these strings to localization files');
            this.outputChannel.show();
        }
    }
    
    /**
     * Crea un comando para ejecutar la auditoría de internacionalización
     */
    public static registerCommand(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.commands.registerCommand('telepresence.auditI18n', async () => {
            const auditor = new I18nAuditor(context.extensionPath);
            
            // Obtener todos los archivos .ts
            const tsFiles: string[] = [];
            const basePath = context.extensionPath;
            
            // Función recursiva para encontrar archivos .ts
            const findTsFiles = (dir: string) => {
                const items = fs.readdirSync(dir);
                items.forEach(item => {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory() && item !== 'node_modules' && item !== 'out') {
                        findTsFiles(fullPath);
                    } else if (stat.isFile() && fullPath.endsWith('.ts') && !fullPath.endsWith('.d.ts')) {
                        tsFiles.push(fullPath);
                    }
                });
            };
            
            findTsFiles(path.join(basePath, 'src'));
            
            // Auditar archivos de localización
            const localizationConsistent = auditor.auditLocalizationFiles();
            
            // Auditar strings hardcodeados
            auditor.auditHardcodedStrings(tsFiles);
            
            if (localizationConsistent) {
                vscode.window.showInformationMessage(i18n.localize('extension.i18n.auditComplete'));
            } else {
                vscode.window.showWarningMessage(i18n.localize('extension.i18n.auditInconsistencies'));
            }
        });
    }
}
