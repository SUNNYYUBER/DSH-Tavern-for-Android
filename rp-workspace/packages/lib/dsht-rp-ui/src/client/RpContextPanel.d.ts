/**
 * RpContextPanel —— 「上下文与记忆」弹出面板（MASTER_TODO §2.3 ④⑤ 前端面，
 * 挂 RpTokenMeter 计量条点击弹出；用户拍板 2026-09-03：token 计量条弹出面板方案）。
 *
 * - ④ AI 可见楼层数即调控件：写 dsht-plugin-memory 设置（保留近M楼原文），
 *   下一轮影子化规划立即生效；「近窗字符预算」同处暴露。
 *   调小 = 下一轮窗口内多余楼层折掉（规划器自动）；调大 = 折叠区间露头部分由
 *   插件 pre-step 窗口核对自动注回（扩张后不主动收回，调小才重整——用户拍板）。
 * - ⑤ 折叠区间「展开给 AI（单次）」：POST /dsht-memory/expand 整段折叠前缀落待办
 *   → 下一轮请求注入区间原文快照，再下一轮自动收回（单次生效）。
 * - 折叠只改模型视图，界面回看零丢失（append-origin 事件流渲染）——面板只管 AI 视野。
 */
import { type JSX } from 'react';
export declare function RpContextPanel({ sessionId, onClose }: {
    sessionId: string;
    onClose: () => void;
}): JSX.Element;
