/**
 * T-50 / D-5a：出站时区规范化 + 注入层取样替换。
 *
 * 断言口径来自**宿主契约**（`dsh-util-time/lib/index.js:19-29` +
 * `dsh-api-session-controller/lib/index.js:738-739`），不来自我方实现（L50）。
 * 第一组是**前提自检**：若宿主本来就接受 `"+00:00"`，本任务根本不该存在。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  normalizeClientTimeZone,
  canonicalizeLikeHost,
  clientTimeZoneFields,
  installClientTimeZonePatch,
  FIXED_FRACTIONAL_OFFSET_TABLE,
} from '../src/dsht-rp-ui/src/client/time-zone.ts'

/** 行为判据：拿 ICU 自己算出的 UTC 偏移（分钟），不看字符串形状（L37）。 */
function offsetMinutesAt(tz: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(date)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name)
  if (!m) return 0 // "GMT" 无偏移后缀 = UTC+0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/** 全年 12 个月抽样：判断某区名是否**恒定**等于目标偏移。 */
function isStableAt(zone: string, wantMinutes: number): boolean {
  for (let month = 0; month < 12; month++) {
    if (offsetMinutesAt(zone, new Date(Date.UTC(2026, month, 15, 12, 0, 0))) !== wantMinutes) return false
  }
  return true
}

describe('前提自检：这些值确实是宿主会拒的（否则本任务无意义）', () => {
  it('WebView 在系统时区为 GMT 时报出的 "+00:00" 被宿主拒收', () => {
    expect(canonicalizeLikeHost('+00:00')).toBeUndefined()
  })

  it('其它偏移式写法一律被拒（无斜杠 → 不匹配 IANA Area/Location）', () => {
    expect(canonicalizeLikeHost('+08:00')).toBeUndefined()
    expect(canonicalizeLikeHost('-05:00')).toBeUndefined()
    expect(canonicalizeLikeHost('GMT')).toBeUndefined()
    expect(canonicalizeLikeHost('UTC+8')).toBeUndefined()
  })

  it('合规写法被接受并按下述口径规范化', () => {
    expect(canonicalizeLikeHost('UTC')).toBe('UTC')
    expect(canonicalizeLikeHost('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(canonicalizeLikeHost('Etc/UTC')).toBe('UTC')
    expect(canonicalizeLikeHost('Etc/GMT-8')).toBe('Etc/GMT-8')
    expect(canonicalizeLikeHost('Etc/GMT-14')).toBe('Etc/GMT-14')
  })

  it('空串 / 首尾空格 / 不存在的区域 一律被拒（与宿主逐字同构）', () => {
    expect(canonicalizeLikeHost('')).toBeUndefined()
    expect(canonicalizeLikeHost(' Asia/Shanghai')).toBeUndefined()
    expect(canonicalizeLikeHost('Asia/Shanghai ')).toBeUndefined()
    expect(canonicalizeLikeHost('Not/AZone')).toBeUndefined()
  })
})

describe('偏移式 → 宿主可接受的名字', () => {
  it('UTC 的各种别名折成字面量 "UTC"（宿主只认这一个非斜杠名）', () => {
    for (const raw of ['+00:00', '-00:00', 'GMT', 'UTC', 'Z', 'Zulu', 'UTC+0', 'GMT+0', 'Etc/UTC', 'Etc/GMT']) {
      expect(normalizeClientTimeZone(raw), raw).toBe('UTC')
    }
  })

  it('整点偏移 → Etc/GMT∓N（IANA 符号与 UTC 偏移相反）', () => {
    expect(normalizeClientTimeZone('+08:00')).toBe('Etc/GMT-8')
    expect(normalizeClientTimeZone('+8')).toBe('Etc/GMT-8')
    expect(normalizeClientTimeZone('GMT+8')).toBe('Etc/GMT-8')
    expect(normalizeClientTimeZone('UTC+08:00')).toBe('Etc/GMT-8')
    expect(normalizeClientTimeZone('-05:00')).toBe('Etc/GMT+5')
    expect(normalizeClientTimeZone('+14:00')).toBe('Etc/GMT-14')
    expect(normalizeClientTimeZone('-12:00')).toBe('Etc/GMT+12')
  })

  it('行为判据（不看形状）：规范化后的实际偏移必须与输入一致', () => {
    expect(offsetMinutesAt(normalizeClientTimeZone('+08:00')!, new Date())).toBe(480)
    expect(offsetMinutesAt(normalizeClientTimeZone('-05:00')!, new Date())).toBe(-300)
    expect(offsetMinutesAt(normalizeClientTimeZone('+14:00')!, new Date())).toBe(840)
    expect(offsetMinutesAt(normalizeClientTimeZone('+00:00')!, new Date())).toBe(0)
  })

  it('本来就合规的名字原样保留（不制造与基准的差异）', () => {
    expect(normalizeClientTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(normalizeClientTimeZone('Etc/GMT-8')).toBe('Etc/GMT-8')
    // 别名不钉具体规范名（ICU/CLDR 版本间会漂，如 Asia/Kolkata↔Asia/Calcutta）——
    // 只要求"宿主接受 + 偏移不变"，这是行为判据（L37）
    const kolkata = normalizeClientTimeZone('Asia/Kolkata')
    expect(kolkata).toBeDefined()
    expect(canonicalizeLikeHost(kolkata!)).toBe(kolkata)
    expect(offsetMinutesAt(kolkata!, new Date())).toBe(330)
  })

  it('首尾空格被吃掉（宿主拒收未 trim 的值，我方不发那种值）', () => {
    expect(normalizeClientTimeZone(' Asia/Shanghai')).toBe('Asia/Shanghai')
  })
})

describe('分数偏移：只接「全年偏移恒定」的等价区，带夏令时的一律不接', () => {
  it('存在固定偏移等价区 → 映射，且偏移与输入一致', () => {
    for (const [raw, minutes] of [['+05:30', 330], ['+05:45', 345], ['-09:30', -570], ['+09:30', 570]] as const) {
      const out = normalizeClientTimeZone(raw)
      expect(out, raw).toBeDefined()
      expect(canonicalizeLikeHost(out!), raw).toBe(out)
      expect(isStableAt(out!, minutes), `${raw} → ${out} 偏移不恒定`).toBe(true)
    }
  })

  it('没有等价区（候选都会在夏令时期间偏 1 小时）→ 不接，绝不塞近似值', () => {
    expect(normalizeClientTimeZone('+10:30')).toBeUndefined() // Lord Howe: +10:30 ↔ +11:00
    expect(normalizeClientTimeZone('+12:45')).toBeUndefined() // Chatham: +12:45 ↔ +13:45
    expect(normalizeClientTimeZone('-03:30')).toBeUndefined() // St_Johns: -03:30 ↔ -02:30
    expect(normalizeClientTimeZone('+11:30')).toBeUndefined() // Norfolk: +11:00 ↔ +12:00
  })

  it('固定偏移表的**不变式**：每条目全年 12 个月偏移必须完全等于键值', () => {
    const entries = Object.entries(FIXED_FRACTIONAL_OFFSET_TABLE)
    expect(entries.length).toBeGreaterThan(0)
    for (const [minutesStr, zone] of entries) {
      const want = Number(minutesStr)
      expect(isStableAt(zone, want), `${zone} 的全年偏移不等于 ${want}`).toBe(true)
    }
  })

  it('反向控制：把一个带夏令时的区塞进表里，上面那条不变式必须失败', () => {
    // 这一条不是测产品，是测**那条不变式本身承重**（L44：防线自己也会说谎）
    expect(isStableAt('Australia/Lord_Howe', 630)).toBe(false)
    expect(isStableAt('Pacific/Chatham', 765)).toBe(false)
  })
})

describe('不可映射 → undefined（= 请求里不带该字段，宿主放行）', () => {
  it('超出 Etc/GMT 范围 / 无法识别的形态', () => {
    expect(normalizeClientTimeZone('+15:00')).toBeUndefined()
    expect(normalizeClientTimeZone('-15:00')).toBeUndefined()
    expect(normalizeClientTimeZone('Japan')).toBeUndefined()
    expect(normalizeClientTimeZone('UTC+')).toBeUndefined()
    expect(normalizeClientTimeZone('')).toBeUndefined()
    expect(normalizeClientTimeZone('   ')).toBeUndefined()
  })

  it('非字符串输入（resolvedOptions 在某些环境可能给 undefined）', () => {
    expect(normalizeClientTimeZone(undefined)).toBeUndefined()
    expect(normalizeClientTimeZone(null)).toBeUndefined()
    expect(normalizeClientTimeZone(123)).toBeUndefined()
    expect(normalizeClientTimeZone({})).toBeUndefined()
  })
})

describe('不变式：产物要么 undefined，要么宿主一定接受', () => {
  // 这张表覆盖：真实 IANA、偏移式、别名、垃圾、边界 —— 任一条返回了
  // 宿主会拒的名字，就是"点了发送没反应"的种子。
  const samples: unknown[] = [
    'UTC', 'GMT', 'Z', 'Zulu', '+00:00', '-00:00', 'GMT+0',
    'Asia/Shanghai', 'Etc/GMT-8', 'Etc/GMT+5', 'Etc/GMT-14', 'Etc/UTC',
    'America/New_York', 'Australia/Eucla', 'Pacific/Chatham', 'Asia/Kolkata',
    '+08:00', '-05:00', '+14:00', '-12:00', '+05:30', '+05:45', '+09:30', '+15:00',
    'Japan', 'UTC+', '   ', '', 'CET', 'EST5EDT',
    undefined, null, 0, 42, {}, [], true,
  ]

  it('每一个样本都满足：undefined 或 canonicalizeLikeHost 认它', () => {
    for (const s of samples) {
      const out = normalizeClientTimeZone(s)
      if (out === undefined) continue
      expect(canonicalizeLikeHost(out), `样本 ${JSON.stringify(s)} 产出了宿主会拒的 ${out}`).toBe(out)
    }
  })
})

describe('不可映射时出声（不静默，L42）', () => {
  it('同一值只告警一次（去重），且带诊断信息', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // 用本文件里没出现过的值，避免被前面用例的告警去重吃掉
      expect(normalizeClientTimeZone('+04:45')).toBeUndefined()
      const first = spy.mock.calls.length
      expect(first).toBeGreaterThan(0)
      expect(String(spy.mock.calls[0][0])).toContain('+04:45')
      normalizeClientTimeZone('+04:45')
      normalizeClientTimeZone('+04:45')
      expect(spy.mock.calls.length).toBe(first) // 去重：不再重复刷
    } finally {
      spy.mockRestore()
    }
  })
})

describe('clientTimeZoneFields（我方调用点的统一出口）', () => {
  it('返回空对象 或 一个宿主接受的值 —— 绝不含会被拒的值', () => {
    const fields = clientTimeZoneFields()
    const keys = Object.keys(fields)
    expect(keys.length === 0 || (keys.length === 1 && keys[0] === 'clientTimeZone')).toBe(true)
    if (fields.clientTimeZone !== undefined) {
      expect(canonicalizeLikeHost(fields.clientTimeZone)).toBe(fields.clientTimeZone)
    }
  })

  it('序列化后不可映射的字段确实"不出现"（宿主按 undefined 放行）', () => {
    // 复刻 dshRpc 的信封序列化路径
    const body = JSON.stringify({ payload: { args: { request: { content: [], ...clientTimeZoneFields() } } } })
    const parsed = JSON.parse(body) as { payload: { args: { request: Record<string, unknown> } } }
    const req = parsed.payload.args.request
    if (!('clientTimeZone' in req)) {
      expect(req.clientTimeZone).toBeUndefined()
    } else {
      expect(typeof req.clientTimeZone).toBe('string')
    }
  })
})

describe('installClientTimeZonePatch：把取样结果换掉（主发送路径的真正落点）', () => {
  // 判据不靠 mock：ICU 允许用偏移式 zone id 建格式化器，
  // 于是 `new Intl.DateTimeFormat('en-US',{timeZone:'+00:00'})` 就是一个
  // "WebView 在 GMT 下"的等价复现物。
  it('装之前，偏移式 zone id 原样返回（= 复现缺陷）', () => {
    // 若宿主将来接受该写法，这条会红 —— 那是契约变了，应重评本模块，而不是改断言
    const raw = new Intl.DateTimeFormat('en-US', { timeZone: '+00:00' }).resolvedOptions().timeZone
    expect(raw).toBe('+00:00')
    expect(canonicalizeLikeHost(raw)).toBeUndefined()
  })

  it('装之后，同一构造的取样结果变成宿主接受的名字', () => {
    installClientTimeZonePatch()
    expect(new Intl.DateTimeFormat('en-US', { timeZone: '+00:00' }).resolvedOptions().timeZone).toBe('UTC')
    expect(new Intl.DateTimeFormat('en-US', { timeZone: '+08:00' }).resolvedOptions().timeZone).toBe('Etc/GMT-8')
    expect(new Intl.DateTimeFormat('en-US', { timeZone: '+05:30' }).resolvedOptions().timeZone).toBeDefined()
  })

  it('合规名字与其它字段不受影响（只换名字，不动语义）', () => {
    installClientTimeZonePatch()
    const r = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai' }).resolvedOptions()
    expect(r.timeZone).toBe('Asia/Shanghai')
    expect(typeof r.locale).toBe('string')
    expect(typeof r.calendar).toBe('string')
    expect(typeof r.numberingSystem).toBe('string')
    // 行为判据（不断言形状）：格式化结果必须仍落在该区的墙上时间（UTC+8）
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })
      .format(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))
    expect(s).toBe('08')
  })

  it('幂等：重复安装不会叠加包装', () => {
    installClientTimeZonePatch()
    installClientTimeZonePatch()
    expect(new Intl.DateTimeFormat('en-US', { timeZone: '+00:00' }).resolvedOptions().timeZone).toBe('UTC')
  })

  it('装完仍能正常格式化（没有把 Intl 弄坏）', () => {
    installClientTimeZonePatch()
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/GMT-8', year: 'numeric' }).format(new Date(0))
    expect(typeof s).toBe('string')
    expect(s.length).toBeGreaterThan(0)
  })
})
