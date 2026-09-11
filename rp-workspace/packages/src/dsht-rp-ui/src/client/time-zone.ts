/**
 * 出站时区规范化（T-50 / 作战地图 D-5a）。
 *
 * ## 为什么需要它
 * 宿主对 `session/prompt` 的 `clientTimeZone` 有**唯一一处**强校验：
 *   - `@deepseek-ai/dsh-api-session-controller/lib/index.js:738-739`
 *     `request.clientTimeZone === undefined` → **放行**（字段不出现在 `source` 里）；
 *     否则过 `@deepseek-ai/dsh-util-time/lib/index.js:19-29` `canonicalClientTimeZone()`，
 *     不合规即 `throw RemoteError('session/invalid-time-zone')`。
 *   - 合规 = `value === "UTC"` 或匹配
 *     `IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/`
 *     （**必须带 `/`**），且 `new Intl.DateTimeFormat('en-US',{timeZone:value})`
 *     规范化之后仍合规。
 *
 * Android WebView 在系统时区为 `GMT`（模拟器默认值）时，
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回 `"+00:00"` —— 不含斜杠，
 * 必然不匹配 → **整条 prompt 被拒**。症状是「点发送毫无反应」：请求根本没进
 * agent loop，会话里一行都不写，只有一闪而过的 toast，极难归因。
 *
 * ## 映射规则（注意 IANA `Etc/GMT±N` 的符号与 UTC 偏移**相反**）
 * | 输入 | 输出 |
 * |---|---|
 * | `UTC` / `Etc/UTC` / `Asia/Shanghai`（本已合规） | 原样（按宿主口径规范化） |
 * | `+00:00` / `GMT` / `Z` / `GMT+0` | `UTC` |
 * | `+08:00` / `GMT+8` / `UTC+08:00` | `Etc/GMT-8` |
 * | `-05:00` | `Etc/GMT+5` |
 * | `+05:30`（非整点） 等不可映射者 | `undefined`（= 不发送该字段） |
 *
 * ## 为什么不可映射时返回 `undefined`，而不是塞一个"近似值"
 * ① 宿主对 `undefined` 是**放行**的（只是不带时区信息）；而塞一个错值会让提示词里的
 *    时间上下文**静默偏掉** —— 比"没有"更坏（L36：跟基准一致，不能少也不能多）。
 * ② `Etc/GMT±N` 只覆盖整点小时；分数偏移没有对应的固定偏移 IANA 名。
 *    拿 `Asia/Kolkata`（+05:30）之类**城市名**去顶，会在夏令时期间给出**错误偏移**。
 * ③ 所以退回"不带时区"，但**出声**（去重告警），不静默（L42）。
 */

/** 逐字对齐宿主 `IANA_TIME_ZONE`（`dsh-util-time/lib/index.js:9`）。 */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/**
 * 逐字复刻宿主 `canonicalClientTimeZone`（`dsh-util-time/lib/index.js:19-29`）。
 * 返回 `undefined` **当且仅当**主机会拒收该名字。
 *
 * 存在的意义：我方**不允许**发出一个宿主会拒的值 —— 拒了就是整条消息发不出去。
 * 因此凡是要写进请求的时区名，都先过这道与宿主同构的判定。
 */
export function canonicalizeLikeHost(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value) return undefined
  if (value !== 'UTC' && !IANA_TIME_ZONE.test(value)) return undefined
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
    if (canonical !== 'UTC' && !IANA_TIME_ZONE.test(canonical)) return undefined
    return canonical
  } catch {
    return undefined
  }
}

/** UTC 的常见别名（其余合法写法如 `Etc/GMT` / `Etc/UTC` 由 `canonicalizeLikeHost` 直接放行）。 */
const UTC_ALIASES = new Set([
  'GMT', 'UTC', 'Z', 'UT', 'ZULU', 'UNIVERSAL', 'GMT0', 'GMT+0', 'GMT-0',
  '+00:00', '-00:00', 'UTC+0', 'UTC-0', 'UTC+00:00', 'GMT+00:00',
])

/** `+08:00` / `GMT+8` / `UTC-05:00` 这类偏移式写法。 */
const OFFSET_RE = /^(?:GMT|UTC|UT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i

/** `Etc/GMT±N` 覆盖 ±14 小时（IANA 极值 `Etc/GMT-14` 实测被 ICU 接受）。 */
const MAX_ETC_GMT_HOURS = 14

/**
 * 分数偏移 → **全年偏移恒定**的 IANA 名（键 = UTC 偏移分钟数）。
 *
 * 为什么需要：`Etc/GMT±N` 只有整点小时，`+05:30` 这类没有对应的固定偏移名；
 * 若直接放弃，则该设备的**主发送路径整条不可用**（比"时区名不准"严重得多）。
 * 因此对**确有等价固定偏移区**的少数分数偏移给出映射。
 *
 * **筛选标准是实测而非推测**：候选必须满足「全年 12 个月抽样偏移完全等于目标值」。
 * 因此排除了带夏令时的 `Australia/Lord_Howe`(+10:30) / `Pacific/Norfolk`(+11:00↔12:00) /
 * `Pacific/Chatham`(+12:45) / `America/St_Johns`(-3:30) —— 用它们会在夏令时期间
 * 给出**错误偏移**，那比"没有时区"更坏（L36）。该不变式由单测逐月复验。
 */
const FIXED_FRACTIONAL_OFFSETS: Readonly<Record<number, string>> = {
  210: 'Asia/Tehran',       // +03:30（伊朗 2022 起不再用夏令时）
  270: 'Asia/Kabul',        // +04:30
  330: 'Asia/Kolkata',      // +05:30
  345: 'Asia/Kathmandu',    // +05:45
  390: 'Asia/Yangon',       // +06:30
  525: 'Australia/Eucla',   // +08:45
  570: 'Australia/Darwin',  // +09:30
  [-570]: 'Pacific/Marquesas', // -09:30
}

const warned = new Set<string>()

/**
 * 把 WebView 报出的时区名规范成**宿主一定接受**的形态。
 * @param raw 通常是 `Intl.DateTimeFormat().resolvedOptions().timeZone`。
 * @returns 合规的 IANA 名；无法映射时 `undefined`（调用方应**整个省略**该字段）。
 */
export function normalizeClientTimeZone(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (value.length === 0) return undefined

  // 1) 本来就合规（含 Etc/GMT±N、Asia/Shanghai 等）→ 按宿主口径返回规范名
  const direct = canonicalizeLikeHost(value)
  if (direct !== undefined) return direct

  // 2) UTC 的别名
  if (UTC_ALIASES.has(value.toUpperCase())) return 'UTC'

  // 3) 偏移式 → Etc/GMT∓N（符号相反）；分数偏移查固定偏移表
  const m = OFFSET_RE.exec(value)
  if (m) {
    const sign = m[1]
    const hours = Number(m[2])
    const minutes = Number(m[3] ?? '0')
    if (minutes === 0 && hours <= MAX_ETC_GMT_HOURS) {
      if (hours === 0) return 'UTC'
      const mapped = `Etc/GMT${sign === '+' ? '-' : '+'}${hours}`
      const checked = canonicalizeLikeHost(mapped)
      if (checked !== undefined) return checked
    }
    const totalMinutes = (sign === '-' ? -1 : 1) * (hours * 60 + minutes)
    const fractional = FIXED_FRACTIONAL_OFFSETS[totalMinutes]
    if (fractional !== undefined) {
      const checked = canonicalizeLikeHost(fractional)
      if (checked !== undefined) return checked
    }
  }

  // 4) 不可映射：出声（去重），让调用方不带该字段
  if (!warned.has(raw)) {
    warned.add(raw)
    console.warn(
      `[dsht-rp-ui] clientTimeZone 无法映射为宿主接受的 IANA 名，已在请求中省略该字段：${JSON.stringify(raw)}`,
    )
  }
  return undefined
}

/**
 * 出站请求用的字段片段（`session/prompt` 的三处调用点统一走这里）。
 *
 * 不可映射时返回**空对象** —— 这样 `clientTimeZone` 这个键**根本不出现**在请求体里，
 * 宿主按 `undefined` 放行。若返回 `{clientTimeZone: undefined}` 也可以（本项目
 * `dshRpc` 走 `JSON.stringify`，`undefined` 值会被丢弃），但那依赖序列化细节；
 * 直接不出现更硬。
 */
export function clientTimeZoneFields(): { clientTimeZone?: string } {
  const zone = normalizeClientTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  return zone === undefined ? {} : { clientTimeZone: zone }
}

/** 分数偏移 → IANA 名的固定偏移表（导出供单测逐月复验"偏移恒定"不变式）。 */
export const FIXED_FRACTIONAL_OFFSET_TABLE: Readonly<Record<number, string>> = FIXED_FRACTIONAL_OFFSETS

/**
 * 把 `Intl.DateTimeFormat.prototype.resolvedOptions()` 返回的 `timeZone` 换成规范名。
 *
 * ## 为什么必须打在**原型**上，而不是只补我方调用点
 * 「在 composer 里按发送」这一**主路径**不走我方代码：composer 是 DSH 原生 Lexical
 * 受控组件，提交走原生提交通道（`composer-enter-fix.ts` 头注原话：「发送仍走界面上的
 * 发送按钮（原生提交通道）」），而 `clientTimeZone` 由**官方客户端模块**
 * `@deepseek-ai/dsh-api-session-controller` 自己采样：
 *   `lib/types/client/time-zone.js:7` `resolvedClientTimeZone()`
 *   → `lib/types/client/sessions/session.js:178/204` 组装进 `session/prompt`。
 * 「DSH 官方源零修改」是合规红线 → **唯一合法落点是在更早的注入层替换取样结果**。
 *
 * ## 替换是语义等价的
 * 只换**名字**不换**偏移**：`+00:00` 与 `UTC` 是同一时区，`+08:00` 与 `Etc/GMT-8` 亦然。
 * 任何读取该值的代码（格式化、展示、判等）行为不变；变的只是它能被 DSH 宿主接受。
 *
 * ## 幂等
 * 重复调用直接返回（在替换函数上打标记）——避免多次包装导致嵌套调用。
 */
export function installClientTimeZonePatch(): void {
  const proto: { resolvedOptions: (() => Intl.ResolvedDateTimeFormatOptions) & { __dshtTimeZonePatched?: boolean } } =
    Intl.DateTimeFormat.prototype as never
  const original = proto.resolvedOptions
  if (typeof original !== 'function' || original.__dshtTimeZonePatched === true) return

  const patched = function (this: Intl.DateTimeFormat): Intl.ResolvedDateTimeFormatOptions {
    const resolved = original.call(this)
    const fixed = normalizeClientTimeZone(resolved.timeZone)
    if (fixed === undefined || fixed === resolved.timeZone) return resolved
    return { ...resolved, timeZone: fixed }
  } as typeof proto.resolvedOptions
  patched.__dshtTimeZonePatched = true
  proto.resolvedOptions = patched
}
