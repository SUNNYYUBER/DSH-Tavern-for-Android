/** Android 壳深链消费标记（PROJECT_PLAN §4.16.2 B 类）：MainActivity evaluateJavascript
 * 派发 locate-session 后同步读取——前端监听器置 true 表示已注册并消费，壳侧据此
 * 决定是否 400ms 重试（前端未就绪场景）。 */
declare global {
    interface Window {
        __dshtLocateConsumed?: boolean;
    }
}
export declare const inject: string[];
export declare function apply(ctx: {
    effect: (fn: () => () => void, label?: string) => unknown;
    slots: {
        register: (options: Record<string, unknown>, component: unknown) => () => void;
        inject: (key: string, factory: () => () => void) => () => void;
    };
    sessions?: {
        open: (id: string) => void;
    };
    workspaces?: {
        archiveSession?: (id: string) => Promise<void>;
    };
}): void;
