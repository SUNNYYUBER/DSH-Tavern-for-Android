/**
 * 【审计 A 类修复 2026-09-08】脚本注入宿主的悬浮 UI 守卫 + 注册表协商（通用层）。
 *
 * 背景（loop 审计实证）：TH 脚本/扩展经 window.parent.$ 往宿主 document 注入悬浮
 * 部件，两类问题——
 * ① 纯装饰图层（fx 扩展球的 ball-ring 等）pointer-events:auto 覆盖宿主控件 →
 *    「看得到、点不动」→ 自动置触摸穿透（decorative guard）；
 * ② 功能性悬浮窗（wb-float-monitor 等）与宿主核心 chrome（对话标签栏等）重叠 →
 *    不能盲改穿透（功能 UI 要能点）→ **注册表 + 同意式协商**：登记进注册表、
 *    检测到与保护区碰撞时弹一次性 toast，用户点击「自动避让」才做最小位移
 *    （不改 z、不隐藏、可逆；脚本若自行挪回不重复打扰）。
 *
 * 扫描模型（真机排障教训）：全量扫描只做一次（安装时）；此后 MutationObserver
 * **增量扫新增子树（含根自身）**——querySelectorAll 只匹配后代，根自身必须单独
 * processElement，否则注入的悬浮窗本体永远漏登记（v1 实测踩坑）。
 */
/** 注册某类浮球的位置回写器；返回注销函数。selector 用于把当前 DOM 元素绑到 resolver。
 *  浮球元素可能晚于本调用挂载（cwd 补取是异步的 → 球延后渲染），因此除立即绑定外，
 *  还要持续监听 DOM 新增把 resolver 绑到新出现的元素上。 */
export declare function registerOwnFloatResolver(selector: string, resolver: (el: HTMLElement, left: number, top: number) => void): () => void;
/** 供浮球组件在拖拽落定后主动触发（拖到脚本浮窗上时立即让位，不等 3s 轮询） */
export declare function requestFloatCollisionResolve(): void;
/** 诊断快照（CDP 探针用）：列出当前跨浮窗避让的参与方与碰撞结果 */
export declare function floatCollisionSnapshot(): {
    own: number;
    others: number;
    overlapping: number;
    resolvers: number;
};
/** 安装守卫；返回卸载函数（插件 fiber 随动） */
export declare function installScriptUiGuard(): () => void;
