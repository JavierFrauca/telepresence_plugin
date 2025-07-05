import * as vscode from 'vscode';

/**
 * Utility class for implementing throttling to improve performance
 * by limiting how often a function can be invoked
 */
export class ThrottleUtility {
    /**
     * Creates a throttled function that only invokes the provided function at most once 
     * within the specified wait period
     * @param func - The function to throttle
     * @param wait - Throttle wait time in milliseconds
     * @returns A throttled version of the original function
     */
    public static throttle<T extends (...args: any[]) => any>(
        func: T,
        wait: number
    ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout | null = null;
        let lastExecuted = 0;

        return function(this: any, ...args: Parameters<T>): void {
            const context = this;
            const now = Date.now();
            const remaining = wait - (now - lastExecuted);

            if (remaining <= 0 || remaining > wait) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                lastExecuted = now;
                func.apply(context, args);
            } else if (!timeout) {
                timeout = setTimeout(() => {
                    lastExecuted = Date.now();
                    timeout = null;
                    func.apply(context, args);
                }, remaining);
            }
        };
    }

    /**
     * Creates a debounced function that delays invoking the provided function 
     * until after wait milliseconds have elapsed since the last time it was invoked
     * @param func - The function to debounce
     * @param wait - Debounce wait time in milliseconds
     * @returns A debounced version of the original function
     */
    public static debounce<T extends (...args: any[]) => any>(
        func: T,
        wait: number
    ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout | null = null;

        return function(this: any, ...args: Parameters<T>): void {
            const context = this;
            
            if (timeout) {
                clearTimeout(timeout);
            }
            
            timeout = setTimeout(() => {
                timeout = null;
                func.apply(context, args);
            }, wait);
        };
    }
}
