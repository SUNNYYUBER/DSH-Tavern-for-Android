export declare const inject: string[];
export declare function apply(ctx: {
    effect: (fn: () => () => void, label?: string) => unknown;
    slots: {
        register: (options: Record<string, unknown>, component: unknown) => () => void;
        inject: (key: string, factory: () => () => void) => () => void;
    };
    layout?: {
        toggleSidebar?: () => void;
    } | undefined;
}): void;
