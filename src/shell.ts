import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Ejecuta un comando en PowerShell (Windows) o bash.
 * -NoProfile evita que el perfil del usuario se ejecute y ensucie stderr con sus errores.
 */
export function runShell(command: string): Promise<{ stdout: string; stderr: string }> {
    if (process.platform === 'win32') {
        return execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { maxBuffer: 10 * 1024 * 1024 });
    }
    return execFileAsync('/bin/bash', ['-c', command], { maxBuffer: 10 * 1024 * 1024 });
}
