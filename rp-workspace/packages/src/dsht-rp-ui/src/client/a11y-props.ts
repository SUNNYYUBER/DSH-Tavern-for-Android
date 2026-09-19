/**
 * a11y-props.ts —— 弹层/折叠区的**可达性单源**（P-1 收口，2026-09-15 第二十三轮续 W8）
 * ============================================================================
 * 两个导出，各收口一处「同一语义被复制多份」：
 *   ① `useEscapeClose`   —— 弹层面板的 Esc 关闭（原 **4 份**逐字相同）
 *   ② `foldRowA11yProps` —— 可点击折叠头的 `role=button` + Enter/Space（原 **2 份**逐字相同）
 *
 * ## 为什么必须有这个模块（而不是各组件各写一份）
 *
 * 2026-09-13 的「键盘不可达（F-2）」修复给弹层面板补了 Esc 关闭。当时的修法是
 * **逐个组件复制同一段 `useEffect`**，于是同一份逻辑出现了 **4 份逐字相同**的实现：
 *   · `RpContextPanel.tsx:62-66`
 *   · `RpSearchPanel.tsx:53-57`
 *   · `RpStateView.tsx:38-42`
 *   · `RpTablesView.tsx:57-61`
 * 其中两处的注释直接写着「**与 RpSearchPanel 同款**」—— 即作者自己也知道这是复制，
 * 但复制这件事**没有任何机器判据拦得住**（本轮实测：D 闸门判据 4 的两个口径
 * 「只收 `function` 声明形态」+「只判跨包」**都躲过了**，见下方「为什么审计抓不到」）。
 *
 * ## 为什么这是真问题（不是「代码风格」）
 * 这与 P-1「同一语义只允许一处权威实现」的**失效后果**完全一致：
 *   · 要改行为（如「Esc 只在最上层面板生效」）时必须**同时改对 4 处**，漏一处就出现
 *     「某个面板关不掉 / 一次关掉两层」的不一致；
 *   · 4 份实现里的 `keydown` 监听**都不带 `capture`**，也**都不 `stopPropagation`**
 *     ⇒ 若两个面板同时挂载，按一次 Esc 会**同时关闭两个**（互相不可见的行为耦合）。
 *
 * ## 为什么审计脚本抓不到（本轮 W8 的结论，已写进 §6.17j）
 * `audit-impl-duplication.mjs` 判据 4 有两条口径，**这处重复同时躲过两条**：
 *   ① 只提取 `function name(...) { }` **声明形态** ⇒ 看不到 `useEffect(() => {…})` 里的箭头函数体；
 *   ② 只判**跨包**重复 ⇒ 而这 4 份在**同一个包内**。
 * ⇒ 护栏必须另立（见 `shared-single-source.spec.ts` 的 `useEscapeClose` 一节），
 *   它的判据是「**单源存在性 + 不得回退到就地实现**」，与审计脚本互补。
 *
 * ## ⚠️ 本模块刻意**不**改行为（只收口）
 * 收口的目标是「同一语义一处实现」，不是顺手改语义。故两个导出**逐字保持**原实现行为。
 * 语义变更（若要）必须作为独立变更取证后单独做。
 *
 * ## 已知缺口（诚实标注，登记为后续工作面）
 * 「多层弹层时 Esc 应该只关最上层」这一语义**当前没有实现**（原 4 份实现都没有）。
 * 本模块提供了**唯一收口点**，将来要补只需改这一处（这正是收口的价值）。
 * 在那之前，同一时刻挂载多个面板时按 Esc 会全部关闭 —— 属既有行为，本轮不改变。
 */
import { useEffect } from 'react'

/**
 * 挂一个「Esc 关闭」键盘监听（挂载期间有效，卸载即摘除）。
 *
 * @param onClose 关闭回调。必须**稳定**（用 `useCallback` 包或用 setState 的 setter）——
 *                它是 `useEffect` 的唯一依赖，不稳定会导致每次渲染都重挂监听。
 */
export function useEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent): void => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])
}

/**
 * 「可点击折叠头」的可达性属性（`role="button"` + `tabIndex` + Enter/Space）。
 *
 * ## 为什么收在这里（同一轮 W8 的第二个复制点）
 * `MigrationStatusPanel.tsx` 与 `UpdatePanel.tsx` 各写了一份**逐字相同**的四行：
 *
 * ```tsx
 * role="button"
 * tabIndex={0}
 * onClick={() => { setExpanded(v => !v) }}
 * onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}
 * ```
 *
 * 这是**键盘可达性**（F-2 系列修复的产物）。复制体的漂移后果与 Esc 那处同族：
 * 一处补了「Escape 也能收起」或换了判据，另一处没有
 * ⇒ 用户在不同面板上遇到**不一样的键盘行为**，且完全无报错。
 *
 * ## ⚠️ 本工厂**逐字保持**两处原实现的行为（收口只搬不改）
 * 原实现是「Enter/Space 即切换，**不** preventDefault、**不**判修饰键」。
 * 本工厂保持完全一致 —— 语义变更（若要）必须作为独立变更取证后单独做，
 * 不得夹在「收口」里顺手改（否则两侧漂移风险并未消除，只是换了个地方）。
 *
 * ## 已知观察项（**未取证，故不改**）
 * `role="button"` 的非原生元素聚焦时按 Space 会**同时**触发页面滚动 ——
 * 原生 `<button>` 不会（浏览器对它 `preventDefault`）。这**可能**是真实缺陷，
 * 但本轮未做设备取证，故**保持现状**并登记为观察项（P-17：没测出来 ≠ 事实否定，
 * 也 ≠ 事实肯定 —— 不据此改代码）。
 */
export function foldRowA11yProps(onToggle: () => void): {
  role: 'button'
  tabIndex: 0
  onClick: () => void
  onKeyDown: (e: { key: string }) => void
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onToggle,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') onToggle() },
  }
}
