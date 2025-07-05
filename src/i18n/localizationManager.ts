import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Define an interface for default values to enable indexing by string
interface DefaultStrings {
    [key: string]: string;
}

/**
 * Class to manage localization in the extension
 */
export class LocalizationManager {
    private static instance: LocalizationManager;
    private strings: Record<string, string> = {};
    private language: string = 'en';

    /**
     * Gets the singleton instance of the localization manager
     */
    public static getInstance(): LocalizationManager {
        if (!LocalizationManager.instance) {
            LocalizationManager.instance = new LocalizationManager();
        }
        return LocalizationManager.instance;
    }

    /**
     * Initializes the localization manager with the current language
     * @param extensionPath - Path to the extension
     */
    public async initialize(extensionPath: string): Promise<void> {
        // Get VS Code display language
        this.language = this.getVSCodeLanguage();
        
        // Load language strings
        await this.loadLanguageStrings(extensionPath);
    }

    /**
     * Gets a localized text string
     * @param key - Text key in format "file.function.text"
     * @param args - Arguments to format the text
     * @returns Localized text string
     */
    public localize(key: string, ...args: any[]): string {
        let text = this.strings[key] || key;
        
        // Replace placeholders {0}, {1}, etc. with arguments
        if (args.length > 0) {
            args.forEach((arg, index) => {
                text = text.replace(new RegExp(`\\{${index}\\}`, 'g'), arg);
            });
        }
        
        return text;
    }

    /**
     * Gets all localized strings for the webview
     * @returns Object with all localized strings
     */
    public getLocalizedStrings(): Record<string, string> {
        // Ensure we have all required translations for UI elements even if loading from file failed
        const requiredKeys = [
            'webview.app.title',
            'webview.app.heading',
            'webview.app.subtitle',
            'webview.system.telepresence',
            'webview.system.kubectl',
            'webview.system.kubelogin',
            'webview.system.context',
            'webview.system.authentication',
            'webview.system.namespace',
            'webview.system.checking',
            'webview.context.click',
            'webview.panel.namespace.title',
            'connection.status.disconnected',
            'webview.panel.namespace.label',
            'webview.panel.namespace.placeholder',
            'webview.panel.namespace.connect',
            'webview.panel.namespace.disconnect',
            'webview.panel.intercept.title',
            'interception.requirement',
            'webview.panel.intercept.serviceLabel',
            'webview.panel.intercept.servicePlaceholder',
            'webview.panel.intercept.portLabel',
            'webview.panel.intercept.button',
            'webview.panel.intercept.disconnectAll',
            'webview.panel.status.title',
            'webview.panel.status.refresh',
            'webview.panel.status.unknown',
            'webview.panel.status.neverUpdated',
            'webview.panel.status.loading',
            'webview.panel.activeInterceptions.title',
            'webview.panel.activeInterceptions.none',
            'webview.footer.developed',
            'webview.footer.license',
            'webview.footer.moreInfo',
            'scripts.ui.noInterceptions'
        ];
        
        // Add default values for missing keys - this ensures UI will display properly
        // even if translations failed to load
        const defaultValues: DefaultStrings = {
            'webview.app.title': 'Telepresence Control Panel',
            'webview.app.heading': 'Telepresence GUI',
            'webview.app.subtitle': 'Advanced microservices management in Kubernetes',
            'webview.system.telepresence': 'Telepresence',
            'webview.system.kubectl': 'kubectl',
            'webview.system.kubelogin': 'kubelogin',
            'webview.system.context': 'Context',
            'webview.system.authentication': 'Authentication',
            'webview.system.namespace': 'Namespace',
            'webview.system.checking': 'Checking...',
            'webview.context.click': 'Click to change context',
            'webview.panel.namespace.title': '🔌 Step 1: Namespace Connection',
            'connection.status.disconnected': 'Disconnected',
            'webview.panel.namespace.label': 'Namespace:',
            'webview.panel.namespace.placeholder': 'Select a namespace',
            'webview.panel.namespace.connect': '🔌 Connect',
            'webview.panel.namespace.disconnect': '🔌 Disconnect',
            'webview.panel.intercept.title': '🎯 Step 2: Traffic Interception',
            'interception.requirement': 'Connect to a namespace first to intercept traffic',
            'webview.panel.intercept.serviceLabel': 'Microservice:',
            'webview.panel.intercept.servicePlaceholder': 'Connect to a namespace first',
            'webview.panel.intercept.portLabel': 'Local Port:',
            'webview.panel.intercept.button': '🎯 Intercept',
            'webview.panel.intercept.disconnectAll': '⛔ Disconnect All',
            'webview.panel.status.title': '📊 Telepresence Status',
            'webview.panel.status.refresh': '🔄 Refresh Status',
            'webview.panel.status.unknown': 'Unknown',
            'webview.panel.status.neverUpdated': 'Never updated',
            'webview.panel.status.loading': 'Loading telepresence status...',
            'webview.panel.activeInterceptions.title': '🎯 Active Interceptions',
            'webview.panel.activeInterceptions.none': 'No active interceptions',
            'webview.footer.developed': 'Developed by',
            'webview.footer.license': 'MIT License',
            'webview.footer.moreInfo': 'More information',
            'scripts.ui.noInterceptions': 'No interceptions available'
        };
        
        // Combine loaded strings with default values for missing keys
        const result: Record<string, string> = { ...this.strings };
        
        // Ensure all required keys are present
        requiredKeys.forEach(key => {
            if (!result[key]) {
                // Use a type assertion to tell TypeScript this is a valid operation
                result[key] = (defaultValues as Record<string, string>)[key] || key;
            }
        });
        
        return result;
    }

    /**
     * Gets the current language
     * @returns Language code
     */
    public getLanguage(): string {
        return this.language;
    }

    /**
     * Gets the VS Code display language
     * @returns Language code
     */
    private getVSCodeLanguage(): string {
        const vscodeLanguage = vscode.env.language;
        console.log(`[Telepresence] 🌐 VS Code language detected: ${vscodeLanguage}`);
        
        // Keep just the language part (e.g., 'en-US' -> 'en')
        const langCode = vscodeLanguage.split('-')[0].toLowerCase();
        console.log(`[Telepresence] 🌐 Language code extracted: ${langCode}`);
        
        // Forzar 'es' para pruebas si VS Code está en español
        if (langCode === 'es' || vscodeLanguage.toLowerCase().includes('es')) {
            console.log(`[Telepresence] 🌐 Idioma español detectado: ${langCode}`);
            return 'es';
        }
        
        // We only support 'en' and 'es' currently
        const finalLang = (langCode === 'es') ? 'es' : 'en';
        console.log(`[Telepresence] 🌐 Final language selected: ${finalLang}`);
        
        return finalLang;
    }

    /**
     * Loads language strings from the JSON file
     * @param extensionPath - Path to the extension
     */
    private async loadLanguageStrings(extensionPath: string): Promise<void> {
        try {
            // Define paths to try for both out/i18n and src/i18n
            const possiblePaths = [
                // First try out/i18n (compiled)
                path.join(extensionPath, 'out', 'i18n', `${this.language}.json`),
                // Then try src/i18n (source)
                path.join(extensionPath, 'src', 'i18n', `${this.language}.json`),
                // Finally try l10n (standard VS Code location)
                path.join(extensionPath, 'l10n', `${this.language}.json`)
            ];
            
            // Define fallback paths
            const fallbackPaths = [
                path.join(extensionPath, 'out', 'i18n', 'en.json'),
                path.join(extensionPath, 'src', 'i18n', 'en.json'),
                path.join(extensionPath, 'l10n', 'en.json')
            ];
            
            console.log(`[Telepresence] 🌐 Trying to load language file for '${this.language}'`);
            
            // Try to load the requested language from any of the possible paths
            let loaded = false;
            for (const langPath of possiblePaths) {
                if (fs.existsSync(langPath)) {
                    console.log(`[Telepresence] 🌐 Found language file at: ${langPath}`);
                    const content = fs.readFileSync(langPath, 'utf8');
                    this.strings = JSON.parse(content);
                    loaded = true;
                    break;
                } else {
                    console.log(`[Telepresence] 🌐 Language file not found at: ${langPath}`);
                }
            }
            
            // If requested language wasn't loaded, try English fallbacks
            if (!loaded) {
                console.log(`[Telepresence] 🌐 Falling back to English`);
                for (const fallbackPath of fallbackPaths) {
                    if (fs.existsSync(fallbackPath)) {
                        console.log(`[Telepresence] 🌐 Found fallback language file at: ${fallbackPath}`);
                        const content = fs.readFileSync(fallbackPath, 'utf8');
                        this.strings = JSON.parse(content);
                        this.language = 'en';
                        loaded = true;
                        break;
                    }
                }
            }
            
            // If both fail, use an empty object
            if (!loaded) {
                console.log(`[Telepresence] 🌐 No language files found at all, using empty strings`);
                this.strings = {};
            }
        } catch (error) {
            console.error(`Error loading language strings: ${error}`);
            this.strings = {};
        }
    }
}

// Export the singleton instance
export const i18n = LocalizationManager.getInstance();
