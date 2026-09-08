import { ensureStyle } from './style.ts';
import { installHostVendor } from './host-vendor.ts';
import { RpOverlay, RP_OPEN_EVENT } from './RpOverlay.tsx';
import { RpAssistantNodeView, RpRegenerateAction, RpUserNodeView, RpVariantActions } from './RpNativeChat.tsx';
import { RpPresetSwitch } from './RpPresetSwitch.tsx';
import { RpImportDockEntry } from './RpImportDock.tsx';
import { RpGreetingDock } from './RpGreetingDock.tsx';
import { RpStateFloat } from './RpStateFloat.tsx';
import { RpScriptHost } from './RpScriptHost.tsx';
import { RpTokenMeter } from './RpTokenMeter.tsx';
import { PLUGIN_CARD_KEYS, makePluginCard } from './PluginCards.tsx';
import { dshRpc, rpApi } from './rpc.ts';
import { installComposerEnterFix } from './composer-enter-fix.ts';
function RpSidebarButton({ wide }) {
    return (<button type="button" className="dsht-rp-sidebar-btn" aria-label="打开角色扮演（RP）" onClick={() => { window.dispatchEvent(new CustomEvent(RP_OPEN_EVENT, { detail: { tab: 'chars' } })); }}>
      <span className="ico">🎭</span>
      {wide === true && <span>角色扮演</span>}
    </button>);
}
export const inject = ['slots', 'sessions'];
// @adapt contract:webview.abort-signal-any
/** Android WebView（System WebView 旧版）缺 AbortSignal.any——DSH 前端工作区/会话
 * 渲染用到（用户实测：选择工作区报 AbortSignal.any is not a function → 侧边栏异常）。
 * 兜底 polyfill：任一信号已中止则立即中止，否则监听首个中止。 */
function ensureAbortSignalAny() {
    const A = globalThis.AbortSignal;
    if (!A || typeof A.any === 'function')
        return;
    A.any = (signals) => {
        const controller = new AbortController();
        const onAbort = () => {
            try {
                controller.abort(controller.signal.reason);
            }
            catch {
                controller.abort();
            }
        };
        const list = signals ?? [];
        for (const s of list) {
            if (s?.aborted) {
                try {
                    controller.abort(s.reason);
                }
                catch {
                    controller.abort();
                }
                break;
            }
            s?.addEventListener('abort', onAbort);
        }
        return controller.signal;
    };
}
export function apply(ctx) {
    ensureAbortSignalAny();
    ensureStyle();
    // 宿主环境复刻（host-vendor / vendor2）：client 启动即补挂缺失的 window._/$/jQuery/z/Zod/YAML
    //（复刻 TH third_party_object.initThirdPartyObject 的 globalThis.z(zod v4)/YAML 注入 + ST
    // 自带全局 $/_；只在 undefined 时装，绝不覆盖宿主已有）——sandbox 放开同源后，脚本 iframe
    // 里 window.parent.$ / window.parent.z 的取法（真 TH 脚本常态）依赖宿主先有这些全局。
    const hostVendorMissing = installHostVendor();
    if (hostVendorMissing.length > 0) {
        console.info('[dsht-rp-ui] host-vendor 补挂宿主全局:', hostVendorMissing.join('、'));
    }
    // 批次修复 17：会话列表排序默认「手动排序」（用户定案：方便给角色卡排序）。
    // DSH ui-workspace 的视图 store 以整棵 state JSON 持久化到 localStorage（key=dsh.workspace.view.v5，
    // 无 version 包裹，缺省 init 是 orderBy:'updated'）——仅在键不存在时写入默认，绝不覆盖用户已选。
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('dsh.workspace.view.v5') === null) {
            localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({
                groupBy: 'workspace', orderBy: 'manual', groupExpansion: {},
                sessionOrderByAccount: {}, sessionUpdatedAtByAccount: {},
            }));
        }
    }
    catch { /* 存储不可用（隐私模式等）静默跳过 */ }
    // 任务 A：主会话过程折叠——【I3 已停用（2026-09-05 用户拍板）】：0.1.2 原生新增了
    // 「N 次工具调用 · M 条消息」折叠行，与我们 DOM 注入的「运行了 xx · N 个步骤」折叠行
    // 双行并存。用户拍板只保留原生折叠行——不再安装本注入器（ProcessFolder.ts 保留备查）。
    // ctx.effect(() => installProcessFolder(), 'dsht-rp-ui: process folder')
    // 通知深链消费（PROJECT_PLAN §4.16.2 B 类）：Android 壳把系统通知/外部
    // dsht://session/<id> 深链转成 window 'dsht-rp-ui:locate-session' CustomEvent 派发
    // 到本页面。消费路径与点角色卡完全一致（复用现有能力，零新路由）：
    // 刷新 session 基线（导入/迁移是服务端落盘，客户端 summaries 不刷会报 unknown session）
    // → ctx.sessions.open 打开原生会话。监听器同步置 __dshtLocateConsumed，
    // 壳侧派发 JS 据此判定监听已注册（未注册自动重试）。
    ctx.effect(() => {
        const onLocateSession = (ev) => {
            const sessionId = ev.detail?.sessionId;
            if (!sessionId)
                return;
            window.__dshtLocateConsumed = true; // 同步置位：Android 派发侧判定监听已注册
            console.info('[dsht-rp-ui] locate-session 深链:', sessionId);
            void (async () => {
                try {
                    const s = ctx.sessions;
                    if (s && typeof s.refresh === 'function') {
                        try {
                            await s.refresh();
                        }
                        catch { /* 刷新失败不阻塞打开 */ }
                    }
                    ctx.sessions?.open(sessionId);
                }
                catch (e) {
                    // 会话不存在（深链 id 失效/测试 id）等场景：不崩 UI，仅留可观测信息
                    console.info('[dsht-rp-ui] locate-session 打开会话失败:', sessionId, String(e));
                }
            })();
        };
        window.addEventListener('dsht-rp-ui:locate-session', onLocateSession);
        return () => window.removeEventListener('dsht-rp-ui:locate-session', onLocateSession);
    }, 'dsht-rp-ui: locate-session deep link');
    // 侧栏 footer 按钮（list 席位：additive，不动原生设置按钮）
    // 0.1.2 坑 #16：cordis Loader 用 Promise.allSettled 并行 apply 各 entry——跨模块 slot
    // 注册不能假设 apply 顺序（slow 设备上本插件先跑 → slot 未声明 → HARNESS 报错页）。
    // 官方姿势（ui-workspace 同款）：slots.inject(目标 slot, 回调)——声明出现才注册。
    // @adapt contract:slots.sidebar.footer.action
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsht-rp', order: 10 }, RpSidebarButton));
    // RP 启动器（shell.overlay list 席位）：点角色卡 → 原生 sessions.open
    const injectProps = () => ({
        // R21 会话管理：官方 workspaces 域的 archiveSession（client 进程内直调，
        // registry-global archivedSessionIds 集——侧边栏全隐藏、数据保留可恢复）
        archiveSession: async (sessionId) => {
            const w = ctx.workspaces;
            if (w && typeof w.archiveSession === 'function') {
                await w.archiveSession(sessionId);
                return;
            }
            throw new Error('workspaces.archiveSession 不可用（宿主 runner 未提供）');
        },
        openSession: async (sessionId) => {
            // T2.11：打开前先刷新客户端 session 基线——导入/迁移是服务端落盘，
            // 客户端 SessionManager summaries 不刷会报 sessions.select: unknown session
            const s = ctx.sessions;
            if (s && typeof s.refresh === 'function') {
                try {
                    await s.refresh();
                }
                catch { /* 刷新失败不阻塞打开 */ }
            }
            ctx.sessions?.open(sessionId);
        },
        // T2.11 补：导入完成后的侧边栏刷新——对新增工作区调 workspace.create（host 变更帧
        // → 侧边栏工作区即时出现）+ workspace.rename（卡名；R1，消费 ExportResult.workspaces
        // 的 {path, name}）+ sessions.refresh（拉全量会话）。旁路写盘不经原生
        // create，host 不会自发变更帧，必须显式触发。
        refreshSidebar: async (workspaces) => {
            const refreshSessions = async () => {
                const s = ctx.sessions;
                if (s && typeof s.refresh === 'function') {
                    try {
                        await s.refresh();
                    }
                    catch { /* 刷新失败不阻塞 */ }
                }
            };
            // R14 优先：host 侧一次性注册（扫 rp/ 全量 + 存量 cwd 修复 + 会话归组 + st-* 预设
            // 同步；workspace.* 变更帧即时推侧边栏）。路由缺失（旧插件）回退逐个 workspace.create。
            try {
                await rpApi('rp/register-workspaces', {});
                await refreshSessions();
                return;
            }
            catch { /* 回退旧路径 */ }
            const failed = [];
            for (const w of workspaces) {
                const p = typeof w === 'string' ? w : w.path;
                if (!p)
                    continue;
                try {
                    const r = await dshRpc('workspace.create', { request: { path: p } });
                    const name = typeof w === 'object' ? w.name : undefined;
                    const workspaceId = r?.workspace?.workspaceId;
                    if (name && workspaceId) {
                        try {
                            await dshRpc('workspace.rename', { request: { workspaceId, title: name } });
                        }
                        catch { /* 重名冲突/非法忽略 */ }
                    }
                }
                catch (e) {
                    // R6：create 失败不再静默——汇成显式错误上抛（RP overlay 对账提示用户）
                    failed.push(`${p.split(/[\\/]/).pop() ?? p}：${e.message}`);
                }
            }
            if (failed.length > 0)
                throw new Error(failed.join('；'));
            await refreshSessions();
        },
    });
    // shell.overlay 席位：同坑 #16，slots.inject 等声明后再注册（不假设 apply 顺序）
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsht-rp-overlay', inject: injectProps }, RpOverlay));
    // T2.5a：输出协议三组件 → assistant-step 席位 shadowing（priority -1 低于官方 0，
    // key 冲突即胜出；拔插件 = 官方 AssistantNodeView 复位，P7 可卸载性）。
    // slots.inject：声明存在时同步注册，否则等待（声明方卸载则撤销；控制器随本插件 fiber）
    // @adapt contract:slots.conversation.chat.node
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'assistant-step', priority: -1 }, RpAssistantNodeView));
    // 批次修复 4：user 节点 shadowing（priority -1；官方无 user-actions 槽位，沿用
    // assistant-step 同款方案）——RP 会话的用户气泡带「↩ 回退到此处」，非 RP 会话
    // 退化为最小纯文本气泡，拔插件官方 UserMessageNodeView 复位。
    // @adapt contract:slots.conversation.chat.node
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'user', priority: -1 }, RpUserNodeView));
    // T2.5c：变体条 ‹ n/m › → assistant-actions list 席位（IconActions 行内，copy 与 branch 之间）
    // @adapt contract:slots.conversation.chat.assistant-actions
    ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'dsht-rp-variant', order: 5 }, RpVariantActions));
    // 批次修复 6：「↻ 重新生成」→ assistant-actions 席位（与变体条共存；仅 RP 会话
    // 最后一条 assistant 消息显示）。inject 注入数据通道：后端截断最后 assistant turn
    // 并返回 lastUserText → sessions.refresh → session.prompt 重发（queue 模式）。
    // @adapt contract:slots.conversation.chat.assistant-actions
    ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions', id: 'dsht-rp-regenerate', order: 6,
        inject: () => ({
            regenerate: async (sessionId) => {
                // 后端路由：POST /dsht-rp/rp/session-regenerate {sessionId}
                // live → 逻辑回退（replace marker）+ lastUserText；前端刷新掩码隐藏旧回复
                const r = await rpApi('rp/session-regenerate', { sessionId });
                const s = ctx.sessions;
                if (s && typeof s.refresh === 'function') {
                    try {
                        await s.refresh();
                    }
                    catch { /* 刷新失败不阻塞重发 */ }
                }
                try {
                    const m = await globalThis.__dshtRpRefreshRollbackMask?.(sessionId);
                    void m;
                }
                catch { /* 掩码刷新失败不阻塞重发 */ }
                await dshRpc('session.prompt', {
                    request: {
                        requestId: crypto.randomUUID(),
                        sessionId,
                        mode: 'queue',
                        content: [{ type: 'text', text: r.lastUserText }],
                        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
                });
            },
        }),
    }, RpRegenerateAction));
    // T2.7：会话内 RP 预设切换 → session header actions 席位（原生标题行内下拉）
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'dsht-rp-preset', order: 5 }, RpPresetSwitch));
    // T2.6：会话内「导入」入口 → input dock 席位（composer 卡片上方整行位）
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsht-rp-import', order: 50 }, RpImportDockEntry));
    // 批次修复 1b：角色卡工作区空白会话的「开场白选择窗」（dock 席位，order 49 在导入按钮上方）
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsht-rp-greeting', order: 49 }, RpGreetingDock));
    // 第五轮：状态悬浮球（示例卡二 pw-state-float 意图原生移植）——dock 席位挂载，
    // fixed 定位浮球 + 状态面板；仅 RP 会话且有消息时显示，非 RP 会话零影响。
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsht-rp-statefloat', order: 48 }, RpStateFloat));
    // 酒馆助手脚本运行时宿主（TavernHelper 移植验收点）：沙箱 iframe 层 + 🧩 脚本管理浮球。
    // dock 席位挂载；仅 RP 会话且会话脚本清单非空时显示，非 RP 会话零影响。
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsht-rp-scripthost', order: 47 }, RpScriptHost));
    // PROJECT_PLAN §7 措施 8 / §4.15：token 上下文进度条 → input dock 席位
    // （order 51 = dock 序列最末，紧贴 composer 输入框上方的常驻细条；
    // 仅 RP 会话且有消息时显示，字符量估算口径见 RpTokenMeter 头注）
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsht-rp-tokenmeter', order: 51 }, RpTokenMeter));
    // 设置 → 插件 →「可配置」tab：三个预适配插件的中文辨识卡（keyed 槽位，
    // key = host 侧 registerSettingsNamespace 注册的命名空间；对照 ui-settings-plugins/index.ts 的注册形态）
    ctx.slots.inject('settings.plugin.item', function* () {
        for (const key of PLUGIN_CARD_KEYS) {
            yield ctx.slots.register({ name: 'settings.plugin.item', key }, makePluginCard(key));
        }
    });
    // ⑦修复（2026-09-05）：手机键盘点「换行」直接发送消息——composer 是 Lexical
    // contenteditable div，KEY_ENTER_COMMAND 无条件提交。插件侧挂 capture 阶段
    // keydown 拦截器，把裸 Enter 改 insertLineBreak（发送仍走界面上的发送按钮）。
    installComposerEnterFix();
}
