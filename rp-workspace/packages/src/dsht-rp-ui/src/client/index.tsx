/**
 * dsht-rp-ui 插件入口：DSH 原生前端的 RP 扩展面。
 *
 * - sidebar.footer.action（list 席位）：「🎭 RP」入口按钮（原生 footer 按钮风格）
 * - shell.overlay（list 席位）：RP 启动器（角色宫格 / 导入 / API 配置）。
 *   架构定案（用户裁决）：点角色卡 = ctx.sessions.open 打开原生 session，
 *   conversation 主视图接管聊天——本插件不自建聊天 UI；迁移的聊天文件早已
 *   转为 session 历史，点卡即续聊。
 * - conversation.chat.node（keyed `assistant-step`，priority -1 shadowing）：
 *   T2.5a 输出协议三组件（状态栏卡片/行动选项按钮/剥壳正文）融入原生会话流；
 *   按钮点击走原生 composer 提交通道（T2.5b）。
 * - conversation.chat.assistant-actions（list 席位）：T2.5c 变体条 ‹ n/m ›
 *   （切换走 3081 /variant/switch）。
 *
 * wire 契约：lib/client.js 由 esbuild 产 CJS factory（banner/footer 见构建脚本），
 * externals 走 shell 模块表（react / cordis / ui-slots / ui-primitives）。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ensureStyle } from './style.ts'
import { installHostVendor, installHostFontAwesome, installHostToastr, installHostSillyTavern, ensureStRegexAnchor } from './host-vendor.ts'
import { RpOverlay, RP_OPEN_EVENT } from './RpOverlay.tsx'
import { RpAssistantNodeView, RpContextNodeView, RpRegenerateAction, RpSystemPromptNodeView, RpUserNodeView, RpTurnErrorView, RpVariantActions, notifyDisplayMutation } from './RpNativeChat.tsx'
import { RpPresetSwitch } from './RpPresetSwitch.tsx'
import { RpImportDockEntry } from './RpImportDock.tsx'
import { RpGreetingDock } from './RpGreetingDock.tsx'
import { RpStateFloat } from './RpStateFloat.tsx'
import { RpScriptHost, RpScriptButtonsBar, getActiveRpSessionId, getLastRpContextSnapshot, reloadActiveRpContext } from './RpScriptHost.tsx'
import { installClipboardGuard } from './clipboard-guard.ts'
import { showDomToast } from './toast.ts'
import { ensureWebviewApiGuard } from '../../../dsht-plugin-shared/webview-api-guard.ts'
import { hostSubstituteParams, hostSubstituteParamsExtended, getHostMacroEnv } from './host-macro-bridge.ts'
import { RpTokenMeter } from './RpTokenMeter.tsx'
import { installProcessFolder } from './ProcessFolder.ts'
import { PLUGIN_CARD_KEYS, makePluginCard, DshtPluginsTabPage } from './PluginCards.tsx'
import { dshRpc, rpApi } from './rpc.ts'
import { clientTimeZoneFields, installClientTimeZonePatch } from './time-zone.ts'
import { installComposerEnterFix } from './composer-enter-fix.ts'
import { installRpSendSentinel } from './send-sentinel.ts'
import { broadcastHostScheme } from './th-shim.ts'
import type { JSX } from 'react'

/** footer action 席位收到的 owner props（SidebarRoot 传 { wide }） */
interface FooterActionProps { wide?: boolean }

function RpSidebarButton({ wide }: FooterActionProps): JSX.Element {
  return (
    <button
      type="button"
      className="dsht-rp-sidebar-btn"
      aria-label="打开角色扮演（RP）"
      onClick={() => { window.dispatchEvent(new CustomEvent(RP_OPEN_EVENT, { detail: { tab: 'chars' } })) }}
    >
      <span className="ico">🎭</span>
      {wide === true && <span>角色扮演</span>}
    </button>
  )
}

// @adapt contract:slots.register
/** slots.register 的 inject 面：原生服务回调（组件拿不到 ctx，只拿回调） */
interface OverlayInjectFace {
  openSession: (sessionId: string) => Promise<void>
  refreshSidebar?: (workspaces: Array<string | { path: string; name?: string }>) => Promise<void>
  /** R21 会话管理：官方 workspaces.archiveSession（进程内直调） */
  archiveSession?: (sessionId: string) => Promise<void>
}

/** Android 壳深链消费标记（PROJECT_PLAN §4.16.2 B 类）：MainActivity evaluateJavascript
 * 派发 locate-session 后同步读取——前端监听器置 true 表示已注册并消费，壳侧据此
 * 决定是否 400ms 重试（前端未就绪场景）。 */
declare global {
  interface Window {
    __dshtLocateConsumed?: boolean
  }
}

export const inject = ['slots', 'sessions']

// @adapt contract:webview.abort-signal-any
// 【2026-09-14 轨道 A / L4 穷举】原 ensureAbortSignalAny() 的实现在此，现已**下沉**到
// webview-api-guard.ts 的 ensureWebviewApiGuard()（P-1：能力补齐是同一语义，
// 不得在 index.tsx 与别处各写一份）。那里一并补齐 crypto.randomUUID /
// structuredClone / Object.hasOwn / Array.prototype.at / queueMicrotask ——
// 穷举发现这 5 个 API 在本仓**有守卫与无守卫混用**（漏 8 处，含显示渲染主路径
// display-compiler.ts 的 .at(-1)）。契约标记在本文件保留（contracts/adaptations.json 引用），
// 实现位置见该模块头注。

export function apply(ctx: {
  effect: (fn: () => () => void, label?: string) => unknown
  slots: { register: (options: Record<string, unknown>, component: unknown) => () => void; inject: (key: string, factory: () => () => void) => () => void }
  sessions?: { open: (id: string) => void }
  workspaces?: { archiveSession?: (id: string) => Promise<void> }
}): void {
  // 【T-50 / D-5a】最先装：把 WebView 报出的偏移式时区名替换成宿主接受的 IANA 名。
  // 必须在**任何**读 `Intl…resolvedOptions().timeZone` 的代码之前生效 ——
  // 主发送路径（composer 原生提交）由官方客户端模块自己采样（详见 time-zone.ts 头注），
  // 官方源零修改，所以只能在这一层替换。不装 = 系统时区为 GMT 的设备**发不出任何消息**。
  installClientTimeZonePatch()
  // 【L4】旧 WebView 现代 API 能力补齐（一次性、幂等）。补了什么必须**出声**（R8）：
  // 非空 polyfilled 即证明这台设备内核偏旧 —— 这是可观测线索，不能静默。
  {
    const report = ensureWebviewApiGuard()
    if (report.polyfilled.length > 0) {
      console.warn(`[dsht-rp-ui] 旧 WebView 能力补齐：${report.polyfilled.join(', ')}（内核偏旧，建议更新系统 WebView）`)
    }
    if (report.missing.length > 0) {
      console.warn(`[dsht-rp-ui] 环境异常，以下能力无法补齐：${report.missing.join(', ')}`)
    }
  }
  ensureStyle()
  // 【2026-09-14 F2-B3】会话快照刷新桥：RpNativeChat 里的回退/编辑/重新生成按钮拿不到
  // ctx.sessions（组件只收 props），但操作后必须刷新会话基线，否则后续 prompt 会基于
  // 过期的 summaries；并且「回退 → 重发」路径上还会让前端误判会话代次。
  // 注册到 globalThis，由 RpNativeChat 按需调用（未注册时它自己会 warn 出声）。
  ;(globalThis as { __dshtRpSessionsRefresh?: () => Promise<void> }).__dshtRpSessionsRefresh = async (): Promise<void> => {
    const s = ctx.sessions as (typeof ctx.sessions & { refresh?: () => Promise<unknown> }) | undefined
    if (s && typeof s.refresh === 'function') await s.refresh()
  }
  // 宿主环境复刻（host-vendor / vendor2）：client 启动即补挂缺失的 window._/$/jQuery/z/Zod/YAML
  //（复刻 TH third_party_object.initThirdPartyObject 的 globalThis.z(zod v4)/YAML 注入 + ST
  // 自带全局 $/_；只在 undefined 时装，绝不覆盖宿主已有）——sandbox 放开同源后，脚本 iframe
  // 里 window.parent.$ / window.parent.z 的取法（真 TH 脚本常态）依赖宿主先有这些全局。
  const hostVendorMissing = installHostVendor()
  if (hostVendorMissing.length > 0) {
    console.info('[dsht-rp-ui] host-vendor 补挂宿主全局:', hostVendorMissing.join('、'))
  }
  // 宿主 FontAwesome：TH 脚本经 window.parent.$ 把 UI append 进宿主 body（真 TH 同态，
  // 飞讯悬浮球实证）——宿主无 FA 样式则所有 fa-* 图标渲染成空白（用户报「图标不加载」根因）。
  installHostFontAwesome()
  // 宿主 toastr：真 TH predefine.js 把父页 toastr 合并进脚本全局——脚本的 toastr 弹窗
  // 必须出现在可见宿主页（iframe 内弹窗不可见）。缺 toastr 全局则脚本通知静默丢失。
  installHostToastr()
  // 常驻 ST 正则面板锚点（心跳 57）：卡的宿主脚本对 `#saved_regex_scripts` 建**无条件**
  // MutationObserver（`inject.js:3884-3889`），元素缺席即抛并中断其 bootstrap 后续三行。
  // 必须**常驻**（不依赖用户打开我方正则面板）——基准侧该元素由 ST 扩展 `init()` 在页面加载时
  // 渲染进扩展设置容器。详见 host-vendor.ts 的 `ensureStRegexAnchor` 注释。
  if (ensureStRegexAnchor()) {
    console.info('[dsht-rp-ui] 已补常驻锚点 #saved_regex_scripts（第三方卡脚本的 DOM 存在性检查依赖）')
  }
  // 宿主 SillyTavern 门面（T-37）：真 ST 宿主页有 globalThis.SillyTavern = {libs, getContext}
  //（SillyTavern/public/script.js:292）。卡的宿主注入脚本（TH 同源形态，外链 inject.js）
  // 首行就 `SillyTavern.getContext()` → 缺它直接 ReferenceError 且整段脚本作废。
  // T-44（心跳 51）：除快照外再注入四个提供者 —— 卡脚本 `inject.js` 实际用到的
  // `getCurrentChatId`(2 处) / `reloadCurrentChat`(7 处) / `substituteParams`(4) /
  // `substituteParamsExtended`(2)（`streamingProcessor` 走门面内建 null，见 host-vendor.ts）。
  if (installHostSillyTavern({
    getSnapshot: getLastRpContextSnapshot,
    // chatId / getCurrentChatId()：当前 RP 会话 id（无可返回 undefined，与基准同形）
    getChatId: () => getActiveRpSessionId() ?? undefined,
    // reloadCurrentChat：重取会话上下文（reloadActiveRpContext）+ 失效显示面缓存并重渲染
    //（notifyDisplayMutation —— 其注释自述等价于真 TH builtin.reloadAndRenderChatWithoutEvents）。
    // 无活跃会话时不触发任何缓存副作用，返回 false 让门面出声降级。
    reloadChat: () => {
      const hit = reloadActiveRpContext()
      if (hit) notifyDisplayMutation()
      return hit
    },
    // substituteParams / substituteParamsExtended 的单实现（宏语义在 dsht-plugin-shared/macros.ts）。
    // **两者必须分别注入**：形参位置不同，混用会让 Extended 的 additionalMacro/postProcessFn
    // 静默丢失（设备实测抓到过；见 HostStContextSource 的注释）。
    substituteParams: hostSubstituteParams,
    substituteParamsExtended: hostSubstituteParamsExtended,
    // name1 / name2（真 ST 全局）：取同步宏环境里已水合的身份，**每次访问取活值**
    //（宏环境由 loadContextSnapshot 触发异步水合，若在门面构建时读一次会一直陈旧）
    getNames: () => {
      const env = getHostMacroEnv()
      return env === null ? {} : { name1: env.user, name2: env.char }
    },
  })) {
    console.info('[dsht-rp-ui] host-vendor 补挂宿主全局: SillyTavern（getContext 快照驱动 + T-44 四提供者）')
  }
  // 批次修复 17：会话列表排序默认「手动排序」（用户定案：方便给角色卡排序）。
  // DSH ui-workspace 的视图 store 以整棵 state JSON 持久化到 localStorage（key=dsh.workspace.view.v5，
  // 无 version 包裹，缺省 init 是 orderBy:'updated'）——仅在键不存在时写入默认，绝不覆盖用户已选。
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('dsh.workspace.view.v5') === null) {
      localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({
        groupBy: 'workspace', orderBy: 'manual', groupExpansion: {},
        sessionOrderByAccount: {}, sessionUpdatedAtByAccount: {},
      }))
    }
  } catch { /* 存储不可用（隐私模式等）静默跳过 */ }

  // 任务 A：主会话过程折叠——【I3 已停用（2026-09-05 用户拍板）】：0.1.2 原生新增了
  // 「N 次工具调用 · M 条消息」折叠行，与我们 DOM 注入的「运行了 xx · N 个步骤」折叠行
  // 双行并存。用户拍板只保留原生折叠行——不再安装本注入器（ProcessFolder.ts 保留备查）。
  // 【2026-09-08 复核】原生折叠行机制正常（模拟器实测：带工具调用轮次渲染
  // 「N 次工具调用 · M 条消息」可点按钮；无工具调用轮次行高 0 不可见）。
  // ctx.effect(() => installProcessFolder(), 'dsht-rp-ui: process folder')

  // 【2026-09-14 用户拍板】原「脚本注入悬浮 UI 守卫」（script-ui-guard.ts）已整体移除。
  // 移除理由（用户实测反馈）：
  //   ① 它检测到脚本浮窗与输入区重叠时弹「自动避让／忽略」——**打扰用户**，且把
  //      「我方 UI 与脚本浮窗同层」的问题转嫁成用户决策；
  //   ② 它主动改脚本浮窗位置（nudge）——卡作者布局被改，脚本下次自检又复位，来回打架；
  //   ③ 它给装饰类浮层无条件置 pointer-events:none——**脚本浮窗点不动**；
  //   ④ 真正的病根是「jQuery UI 拖拽在触摸屏上不工作」（见 vendor 触屏适配），
  //      该守卫只是掩盖症状。
  // 现改为：脚本浮窗**完全由卡脚本自己管**，宿主不做任何位移/穿透干预。

  // 【2026-09-14 L1 穷举 / P-3 / P-7】剪贴板能力守卫。
  // 背景：L1 必测项「长按/复制」静态穷举结论 = 宿主**已内置**复制按钮
  // （dsh-client-ui-chat 的 MessageIconActions → writeClipboard），故不缺入口；
  // 但官方实现在失败时**静默 return**（不改按钮态、不提示、不打日志）——属 R8 禁止的
  // 静默兜底。「复制点了没反应」是用户侧的未定义行为，我方层必须在**能力层**兜住：
  // 探测不可用 ⇒ 首次点击楼层动作钮时出一声提示（仅一次，防噪音）。
  // 不能改官方源码（B4），也不能替它重写复制（那会造出平行实现，违反 P-1）。
  ctx.effect(() => installClipboardGuard({
    notify: (m) => { showDomToast('info', m) },
  }), 'dsht-rp-ui: clipboard capability guard')

  // 通知深链消费（PROJECT_PLAN §4.16.2 B 类）：Android 壳把系统通知/外部
  // dsht://session/<id> 深链转成 window 'dsht-rp-ui:locate-session' CustomEvent 派发
  // 到本页面。消费路径与点角色卡完全一致（复用现有能力，零新路由）：
  // 刷新 session 基线（导入/迁移是服务端落盘，客户端 summaries 不刷会报 unknown session）
  // → ctx.sessions.open 打开原生会话。监听器同步置 __dshtLocateConsumed，
  // 壳侧派发 JS 据此判定监听已注册（未注册自动重试）。
  ctx.effect(() => {
    const onLocateSession = (ev: Event): void => {
      const sessionId = (ev as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (!sessionId) return
      window.__dshtLocateConsumed = true // 同步置位：Android 派发侧判定监听已注册
      console.info('[dsht-rp-ui] locate-session 深链:', sessionId)
      void (async () => {
        try {
          const s = ctx.sessions as (typeof ctx.sessions & { refresh?: () => Promise<unknown> }) | undefined
          if (s && typeof s.refresh === 'function') {
            try { await s.refresh() } catch { /* 刷新失败不阻塞打开 */ }
          }
          ctx.sessions?.open(sessionId)
        } catch (e) {
          // 会话不存在（深链 id 失效/测试 id）等场景：不崩 UI，仅留可观测信息
          console.info('[dsht-rp-ui] locate-session 打开会话失败:', sessionId, String(e))
        }
      })()
    }
    window.addEventListener('dsht-rp-ui:locate-session', onLocateSession)
    return () => window.removeEventListener('dsht-rp-ui:locate-session', onLocateSession)
  }, 'dsht-rp-ui: locate-session deep link')

  // 侧栏 footer 按钮（list 席位：additive，不动原生设置按钮）
  // 0.1.2 坑 #16：cordis Loader 用 Promise.allSettled 并行 apply 各 entry——跨模块 slot
  // 注册不能假设 apply 顺序（slow 设备上本插件先跑 → slot 未声明 → HARNESS 报错页）。
  // 官方姿势（ui-workspace 同款）：slots.inject(目标 slot, 回调)——声明出现才注册。
  // @adapt contract:slots.sidebar.footer.action
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'dsht-rp', order: 10 },
    RpSidebarButton,
  ))

  // RP 启动器（shell.overlay list 席位）：点角色卡 → 原生 sessions.open
  const injectProps = (): OverlayInjectFace => ({
    // R21 会话管理：官方 workspaces 域的 archiveSession（client 进程内直调，
    // registry-global archivedSessionIds 集——侧边栏全隐藏、数据保留可恢复）
    archiveSession: async (sessionId: string): Promise<void> => {
      const w = (ctx as { workspaces?: { archiveSession?: (id: string) => Promise<void> } }).workspaces
      if (w && typeof w.archiveSession === 'function') { await w.archiveSession(sessionId); return }
      throw new Error('workspaces.archiveSession 不可用（宿主 runner 未提供）')
    },
    openSession: async (sessionId: string): Promise<void> => {
      // T2.11：打开前先刷新客户端 session 基线——导入/迁移是服务端落盘，
      // 客户端 SessionManager summaries 不刷会报 sessions.select: unknown session
      const s = ctx.sessions as (typeof ctx.sessions & { refresh?: () => Promise<unknown> }) | undefined
      if (s && typeof s.refresh === 'function') {
        try { await s.refresh() } catch { /* 刷新失败不阻塞打开 */ }
      }
      ctx.sessions?.open(sessionId)
    },
    // T2.11 补：导入完成后的侧边栏刷新——对新增工作区调 workspace.create（host 变更帧
    // → 侧边栏工作区即时出现）+ workspace.rename（卡名；R1，消费 ExportResult.workspaces
    // 的 {path, name}）+ sessions.refresh（拉全量会话）。旁路写盘不经原生
    // create，host 不会自发变更帧，必须显式触发。
    refreshSidebar: async (workspaces: Array<string | { path: string; name?: string }>): Promise<void> => {
      const refreshSessions = async (): Promise<void> => {
        const s = ctx.sessions as (typeof ctx.sessions & { refresh?: () => Promise<unknown> }) | undefined
        if (s && typeof s.refresh === 'function') {
          try { await s.refresh() } catch { /* 刷新失败不阻塞 */ }
        }
      }
      // R14 优先：host 侧一次性注册（扫 rp/ 全量 + 存量 cwd 修复 + 会话归组 + st-* 预设
      // 同步；workspace.* 变更帧即时推侧边栏）。路由缺失（旧插件）回退逐个 workspace.create。
      try {
        await rpApi('rp/register-workspaces', {})
        await refreshSessions()
        return
      } catch { /* 回退旧路径 */ }
      const failed: string[] = []
      for (const w of workspaces) {
        const p = typeof w === 'string' ? w : w.path
        if (!p) continue
        try {
          const r = await dshRpc<{ workspace?: { workspaceId?: string } }>('workspace.create', { request: { path: p } })
          const name = typeof w === 'object' ? w.name : undefined
          const workspaceId = r?.workspace?.workspaceId
          if (name && workspaceId) {
            try { await dshRpc('workspace.rename', { request: { workspaceId, title: name } }) } catch { /* 重名冲突/非法忽略 */ }
          }
        } catch (e) {
          // R6：create 失败不再静默——汇成显式错误上抛（RP overlay 对账提示用户）
          failed.push(`${p.split(/[\\/]/).pop() ?? p}：${(e as Error).message}`)
        }
      }
      if (failed.length > 0) throw new Error(failed.join('；'))
      await refreshSessions()
    },
  })
  // shell.overlay 席位：同坑 #16，slots.inject 等声明后再注册（不假设 apply 顺序）
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsht-rp-overlay', inject: injectProps },
    RpOverlay,
  ))

  // T2.5a：输出协议三组件 → assistant-step 席位 shadowing（priority -1 低于官方 0，
  // key 冲突即胜出；拔插件 = 官方 AssistantNodeView 复位，P7 可卸载性）。
  // slots.inject：声明存在时同步注册，否则等待（声明方卸载则撤销；控制器随本插件 fiber）
  // @adapt contract:slots.conversation.chat.node
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'assistant-step', priority: -1 },
    RpAssistantNodeView,
  ))

  // 批次修复 4：user 节点 shadowing（priority -1；官方无 user-actions 槽位，沿用
  // assistant-step 同款方案）——RP 会话的用户气泡带「↩ 回退到此处」，非 RP 会话
  // 退化为最小纯文本气泡，拔插件官方 UserMessageNodeView 复位。
  // @adapt contract:slots.conversation.chat.node
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'user', priority: -1 },
    RpUserNodeView,
  ))

  // 【F1 2026-09-14】turn-error 节点 shadowing：官方把上游 SDK 的原始错误措辞
  // （如 `pi-ai detected context overflow for model "…"`）直接摆到用户面前
  // （dsh-client-ui-chat 的 failureMessage 除 AUTH 外原样透传）。我们不能改官方
  // 源码，故在本层做「内部实现细节隔离」：人话为主 + 原文折叠为技术详情。
  // @adapt contract:slots.conversation.chat.node
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-error', priority: -1 },
    RpTurnErrorView,
  ))

  // 【2026-09-19 回退连带面修复】system-prompt / context 节点 shadowing：官方这两行
  // **不认回退掩码**——它们的锚不是 surface 节点（system-prompt 锚在 turn/start、context
  // 锚在注入事件本身），回退写的 shadowedSeqs 里没有它们 ⇒ 用户实测：回退后「系统提示词 /
  // 上下文注入」仍留在会话流里。本层接管后：命中回退区间 → 返回 null（同 user/assistant-step
  // 的隐藏）；其余情况按同样信息量重绘（默认折叠一行 + 展开看正文）。拔插件官方 view 复位。
  // @adapt contract:slots.conversation.chat.node
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'system-prompt', priority: -1 },
    RpSystemPromptNodeView,
  ))
  // @adapt contract:slots.conversation.chat.node
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'context', priority: -1 },
    RpContextNodeView,
  ))

  // T2.5c：变体条 ‹ n/m › → assistant-actions list 席位（IconActions 行内，copy 与 branch 之间）
  // @adapt contract:slots.conversation.chat.assistant-actions
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
    { name: 'conversation.chat.assistant-actions', id: 'dsht-rp-variant', order: 5 },
    RpVariantActions,
  ))

  // 批次修复 6：「↻ 重新生成」→ assistant-actions 席位（与变体条共存；仅 RP 会话
  // 最后一条 assistant 消息显示）。inject 注入数据通道：后端截断最后 assistant turn
  // 并返回 lastUserText → sessions.refresh → session.prompt 重发（queue 模式）。
  // @adapt contract:slots.conversation.chat.assistant-actions
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
    {
      name: 'conversation.chat.assistant-actions', id: 'dsht-rp-regenerate', order: 6,
      inject: () => ({
        regenerate: async (sessionId: string): Promise<void> => {
          // 后端路由：POST /dsht-rp/rp/session-regenerate {sessionId}
          // live → 逻辑回退（replace marker）+ lastUserText；前端刷新掩码隐藏旧回复
          const r = await rpApi<{ lastUserText: string }>('rp/session-regenerate', { sessionId })
          const s = ctx.sessions as (typeof ctx.sessions & { refresh?: () => Promise<unknown> }) | undefined
          if (s && typeof s.refresh === 'function') {
            try { await s.refresh() } catch { /* 刷新失败不阻塞重发 */ }
          }
          try {
            const m = await (globalThis as { __dshtRpRefreshRollbackMask?: (sid: string) => Promise<void> }).__dshtRpRefreshRollbackMask?.(sessionId)
            void m
          } catch { /* 掩码刷新失败不阻塞重发 */ }
          // 【2026-09-14 B3 三路径对齐】显示面缓存失效——rollback 分支（RpNativeChat）
          // 已有此动作，本处此前漏了。显示面缓存（display 正则三源 / 预设 prompt_order）
          // 直接影响楼层 display，不失效 ⇒ 重生成后旧楼层的显示仍用旧上下文。
          try {
            const n = (globalThis as { __dshtRpNotifyDisplayMutation?: () => void }).__dshtRpNotifyDisplayMutation
            if (typeof n === 'function') n()
          } catch { /* 缓存失效失败不阻塞重发 */ }
          await dshRpc('session.prompt', {
            request: {
              requestId: crypto.randomUUID(),
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text: r.lastUserText }],
              ...clientTimeZoneFields(),
            },
          })
        },
      }),
    },
    RpRegenerateAction,
  ))

  // T2.7：会话内 RP 预设切换 → session header actions 席位（原生标题行内下拉）
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'dsht-rp-preset', order: 5 },
    RpPresetSwitch,
  ))

  // T2.6：会话内「导入」入口 → input dock 席位（composer 卡片上方整行位）
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsht-rp-import', order: 50 },
    RpImportDockEntry,
  ))

  // 批次修复 1b：角色卡工作区空白会话的「开场白选择窗」（dock 席位，order 49 在导入按钮上方）
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsht-rp-greeting', order: 49 },
    RpGreetingDock,
  ))

  // 第五轮：状态悬浮球（示例卡乙 pw-state-float 意图原生移植）——dock 席位挂载，
  // fixed 定位浮球 + 状态面板；仅 RP 会话且有消息时显示，非 RP 会话零影响。
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsht-rp-statefloat', order: 48 },
    RpStateFloat,
  ))

  // 酒馆助手脚本运行时宿主（TavernHelper 移植验收点）：沙箱 iframe 层 + 🧩 脚本管理浮球。
  // dock 席位挂载；仅 RP 会话且会话脚本清单非空时显示，非 RP 会话零影响。
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsht-rp-scripthost', order: 47 },
    RpScriptHost,
  ))

  // 【2026-09-07 ST 按钮条对齐（基准 1/316）】脚本按钮常驻胶囊条（ST 同位：输入框上方），
  // order 46 在 scripthost(47)/statefloat(48) 之下、紧贴 composer。
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsht-rp-script-pills', order: 46 },
    RpScriptButtonsBar,
  ))

  // PROJECT_PLAN §7 措施 8 / §4.15：token 上下文进度条 → input dock 席位
  // （order 51 = dock 序列最末，紧贴 composer 输入框上方的常驻细条；
  // 仅 RP 会话且有消息时显示，字符量估算口径见 RpTokenMeter 头注）
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsht-rp-tokenmeter', order: 51 },
    RpTokenMeter,
  ))

  // 设置 → 插件 →「可配置」tab：三个预适配插件的中文辨识卡（keyed 槽位，
  // key = host 侧 registerSettingsNamespace 注册的命名空间；对照 ui-settings-plugins/index.ts 的注册形态）
  //
  // ★★ **2026-09-23 DSH 升级轮 · 阶段 D.2：0.1.7 删除了 `settings.plugin.item`，改用
  //    「本地化 tab + feature-owned 整页」模型（`settings.plugins.tab`）。**
  //   0.1.5：官方 Plugins 区有「可配置插件卡片」槽位 ⇒ 4 张卡各挂一张 `<li>`。
  //   0.1.7：`settings.plugins.tab`（`kind:'list'` / `scope:'root'`）的每项贡献是**一整页**，
  //          **「卡片行」这一层被取消** ⇒ 沿用旧写法的话 4 张卡在 0.1.7 上**没有任何落点**。
  //
  //   ★★ **为什么不能「先探测再二选一」（我第一版就是这么写的，真机实测证伪）**：
  //      `settings.plugins.tab` 的 spec 由 **Plugins 分区 owner 在运行时注册时才声明**，
  //      而我方 `apply()` 跑得更早 ⇒ 那一刻 `specDynamic('settings.plugins.tab')` 恒为
  //      `undefined` ⇒ 两代分支**都不命中**，落到 else 只出声（真机日志实证：
  //      「未找到 settings.plugin.item / settings.plugins.tab ⇒ 插件设置卡**没有落点**」）。
  //      —— 这是 **P-40③ 的又一例**：判据跑在了它所判对象状态确定**之前**。
  //
  //   ★ 官方给的正确姿势（`dsh-cordis-client-runner` 对 `slots.inject` 的原文）：
  //      > Install an effect for each declaration lifetime of a slot. The callback runs
  //      > synchronously when the declaration **already exists**; otherwise it runs
  //      > **inside the declaring `register()` call after the declaration is committed**.
  //     ⇒ `inject` **本身就是「等声明」的原语**，会跟随「晚声明 / 重声明 / teardown」。
  //     所以**两条 inject 都装**：0.1.5 上 `settings.plugin.item` 的声明触发第一条，
  //     0.1.7 上 `settings.plugins.tab` 的声明触发第二条 —— **跨代无需探测**。
  //     ★ 副作用为零：某代里没有该 key ⇒ 那条 inject 的 callback **永不执行**（挂起等待，
  //       随插件卸载取消），不产生空贡献、不覆盖任何东西。
  //   ★ 判据已就位：`audit-upgrade-readiness.mjs` 的 ⑤ 装配面会在「我方引用了官方不存在的 slot
  //     且无改名映射」时报 BLOCK —— 它正是本轮**先于**这次修复报出该问题的装置。
  ctx.slots.inject('settings.plugin.item', () => {
    // 【心跳 47·T-34】原为**生成器函数** `function* () { … yield ctx.slots.register(...) }`。
    // 生成器函数返回的是 Generator 对象，而本文件声明的契约为 `factory: () => (() => void)`
    // （:99），宿主拿它当 disposer：① 函数体在 `.next()` 之前**不执行** → 三张卡从未注册；
    // ② 卸载时宿主调用该"disposer" → 生成器对象不可调用，抛 TypeError。
    // 同文件其余 14 处 slots.inject（:175/:237/:246/…）一律是"箭头函数 + 返回清理函数"，
    // 仅此处例外 → 判定为笔误。改为正常注册并返回合并后的清理函数。
    const disposers = PLUGIN_CARD_KEYS.map(key =>
      ctx.slots.register({ name: 'settings.plugin.item', key }, makePluginCard(key)))
    return () => { for (const d of disposers) d() }
  })

  // 0.1.7 路径：一个 tab 整页（`id` / `order` / `label` 三件套；label 本地化由注册方负责）。
  // 同一条 inject 机制 ⇒ 声明到来时自动生效（见上方长注）。
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
    { name: 'settings.plugins.tab', id: 'dsht', order: 60, label: 'DSHTavern' },
    DshtPluginsTabPage,
  ))

  // ⑦修复（2026-09-05）：手机键盘点「换行」直接发送消息——composer 是 Lexical
  // contenteditable div，KEY_ENTER_COMMAND 无条件提交。插件侧挂 capture 阶段
  // keydown 拦截器，把裸 Enter 改 insertLineBreak（发送仍走界面上的发送按钮）。
  installComposerEnterFix()

  // 【体检 2026-09-26 · P0-5】发送哨兵：「发消息没反应」的可观察性补丁（零官方源修改）。
  // 包装 window.fetch 只记录「/api POST 刚发生」，提交 8 秒后查插件 pre-step 心跳，
  // 管线没接手 ⇒ toast 出声（R8）。见 send-sentinel.ts 头注。
  installRpSendSentinel()

  // 【L2 穷举 2026-09-14 · P-7/P-3】宿主切主题 → 广播给**全部已存在的 RP 帧**。
  //
  // 缺陷（设备实测 `tmp/probe-theme-toggle.mjs`）：宿主主题是**应用内设置**
  //（`body[data-ds-dark-theme]` 属性，与 OS 的 `prefers-color-scheme` 可分离），
  // 而帧内 `color-scheme` 只在**建帧时求值一次** ⇒ 切主题后既有帧不跟随
  //（实测：宿主体感 dark→light、我方 token 色跟随，而帧内 `color-scheme` 仍 dark）。
  // SDK 侧已在每个帧内注入 `__dshtApplyHostScheme()`（见 th-shim 的 frameSchemeBoot），
  // 此处只负责**观测宿主属性变化并广播**——属性的唯一事实来源仍在宿主（P-1）。
  ctx.effect(() => {
    if (typeof MutationObserver !== 'function' || !document.body) return () => { /* 环境不支持：无副作用可清 */ }
    const broadcast = (): void => { broadcastHostScheme() }
    const mo = new MutationObserver(broadcast)
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    // 兜底：OS 层明暗切换（宿主属性不变但帧内 prefers-color-scheme 变了）
    let mq: MediaQueryList | null = null
    try { mq = window.matchMedia('(prefers-color-scheme: dark)') } catch { mq = null }
    const onOs = (): void => { broadcast() }
    if (mq !== null) { try { mq.addEventListener('change', onOs) } catch { /* 旧内核无 addEventListener */ } }
    broadcast() // 安装即对齐一次（防止「安装前已建的帧」漏掉）
    return () => {
      mo.disconnect()
      if (mq !== null) { try { mq.removeEventListener('change', onOs) } catch { /* noop */ } }
    }
  }, 'dsht-rp-ui: host theme → frame scheme broadcast')
}
