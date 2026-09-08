/** overlay 开关的全局事件（sidebar 按钮与 overlay 组件解耦） */
export declare const RP_OPEN_EVENT = "dsht-rp-ui:open";
/** apply(ctx) 注入的原生通道（组件永远拿不到 ctx，只拿回调） */
export interface RpOverlayInjected {
    /** 原生会话打开（ctx.sessions.open）：conversation 主视图接管 */
    openSession: (sessionId: string) => Promise<void>;
    /** T2.11 补：导入完成后的侧边栏刷新（workspace.create 注册 + rename + sessions.refresh）。
     * 元素可为绝对路径字符串，或 {path, name}（消费批次 1 ExportResult.workspaces 的卡名） */
    refreshSidebar?: (workspaces: Array<string | {
        path: string;
        name?: string;
    }>) => Promise<void>;
    /** R21 会话管理：官方 workspaces.archiveSession（进程内直调；归档 = 侧边栏隐藏、数据保留） */
    archiveSession?: (sessionId: string) => Promise<void>;
}
export declare function RpOverlay(props: RpOverlayInjected): JSX.Element | null;
