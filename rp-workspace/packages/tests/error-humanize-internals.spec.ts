/**
 * F1 单测：**官方内部实现细节必须挡在用户可见面之外**。
 *
 * ## 为什么这组测试存在
 * 用户实测（2026-09-14）在错误面板看到：
 *   `pi-ai detected context overflow for model "deepseek/deepseek-v4-flash"`
 *
 * 这句话逐字来自**官方包内部**（`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1394`
 * 的 `mapStopReason`），其中的 `pi-ai` 是第三方 SDK 名
 * （`@earendil-works/pi-ai`）——对用户完全无意义的内部选型细节。
 *
 * 我们不能改官方源码（合规红线），所以必须在我方 UI 层做隔离。本组测试钉住三件事：
 *   ① 泄漏形态被替换成人话（含**可行动建议**，这才是用户真正需要的）；
 *   ② 未泄漏的错误**不被误改**（负控：证明隔离机制没有把正常错误一起吞掉）；
 *   ③ 机制是**模式驱动**的（新增泄漏形态加一条规则即可，不需逐个字符串打补丁）。
 */
import { describe, expect, it } from 'vitest'
import { humanizeError, humanizeErrorCode, humanizeLeakedInternals } from '../src/dsht-rp-ui/src/client/rpc.ts'

// ---------------------------------------------------------------------------
// 1. 用户实测的那条：上下文超限（含 SDK 名泄漏）
// ---------------------------------------------------------------------------

describe('F1 上下文超限：SDK 名被隔离 + 给出可行动建议', () => {
  it('官方原文（含 pi-ai）→ 人话，不再出现 SDK 名', () => {
    const raw = 'pi-ai detected context overflow for model "deepseek/deepseek-v4-flash"'
    const out = humanizeError(new Error(raw))
    expect(out).not.toContain('pi-ai') // SDK 名必须隔离
    // 模型名保留（对用户有用：知道是哪个模型满了），但冗余 provider 前缀被剥掉
    expect(out).toContain('deepseek-v4-flash')
    expect(out).not.toContain('deepseek/deepseek-v4-flash')
    expect(out).toContain('上下文')
  })

  it('给出**可行动建议**（只说「出错了」不算解决——用户要知道下一步做什么）', () => {
    const raw = 'pi-ai detected context overflow for model "deepseek/deepseek-v4-flash"'
    const out = humanizeError(new Error(raw))
    // 三条出路至少给出一条可执行指引
    expect(out).toMatch(/回退|删除|换用|设置/)
  })

  it('错误码形态（CONTEXT_WINDOW_EXCEEDED）同样命中', () => {
    expect(humanizeLeakedInternals('boom', 'CONTEXT_WINDOW_EXCEEDED')).not.toBeNull()
    expect(humanizeLeakedInternals('context window exceeded', '')).not.toBeNull()
  })

  it('官方英文变体（context window is full）也命中', () => {
    expect(humanizeLeakedInternals('the context window is full', '')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. 空回复（同类：官方文案把 model id 拼进用户面）
// ---------------------------------------------------------------------------

describe('F1 空回复：内部 model id 被隔离', () => {
  it('官方空回复原文 → 人话 + 可执行动作（重新生成）', () => {
    const raw = 'model "deepseek/deepseek-v4-flash" returned a completed response with no content'
    const out = humanizeError(new Error(raw))
    expect(out).not.toContain('returned a completed response')
    expect(out).toMatch(/重新生成|重试/)
  })

  it('错误码 EMPTY_RESPONSE 命中', () => {
    expect(humanizeLeakedInternals('boom', 'EMPTY_RESPONSE')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. 通用形态：包名 / 源文件路径外泄
// ---------------------------------------------------------------------------

describe('F1 通用形态：包名与源文件路径外泄', () => {
  it('裸 pi-ai（非上下文超限语境的其它用法）也被隔离', () => {
    const out = humanizeError(new Error('pi-ai upstream returned 502'))
    expect(out).not.toContain('pi-ai')
  })

  it('@earendil-works/pi-ai 全名被隔离', () => {
    const out = humanizeError(new Error('failed to load @earendil-works/pi-ai/provider'))
    expect(out).not.toContain('earendil')
  })

  it('@deepseek-ai/xxx 包名被隔离', () => {
    const out = humanizeError(new Error('cannot find module @deepseek-ai/dsh-session'))
    expect(out).not.toContain('@deepseek-ai')
  })

  it('源文件路径（lib/index.js:1394）被隔离', () => {
    const out = humanizeError(new Error('TypeError at lib/index.js:1394'))
    expect(out).not.toContain('lib/index.js')
  })

  it('node_modules 路径被隔离', () => {
    const out = humanizeError(new Error('ENOENT node_modules/foo/bar.js'))
    // 注意：含 node_modules 时可能先被「网络层」规则截获（ENOENT 非 fetch），故只断言不泄漏路径
    expect(out).not.toContain('node_modules/foo')
  })
})

// ---------------------------------------------------------------------------
// 4. 负控：隔离机制不得误伤正常错误
// ---------------------------------------------------------------------------

describe('F1 负控：正常错误不被误改', () => {
  it('普通业务错误原样保留（兜底不吞信息）', () => {
    const raw = 'scriptId required'
    expect(humanizeError(new Error(raw))).toContain('scriptId')
  })

  it('HTTP 状态码路径仍按原规则翻译（隔离规则没有抢走它）', () => {
    const out = humanizeError(new Error('save failed: HTTP 401'))
    expect(out).toContain('API Key')
  })

  it('网络层错误仍按原规则翻译', () => {
    const e = Object.assign(new TypeError('Failed to fetch'), {})
    expect(humanizeError(e)).toContain('无法连接到本地服务')
  })

  it('网关重载窗口仍按原规则翻译', () => {
    const e = Object.assign(new Error('gateway down'), { code: 'gateway/service-unavailable' })
    expect(humanizeError(e)).toMatch(/重载|再点一次/)
  })

  it('未命中的普通中文消息原样返回（不包装、不截断）', () => {
    const raw = '这个会话里没有可回退的内容'
    expect(humanizeError(new Error(raw))).toBe(raw)
  })

  it('null/undefined 有确定行为（不抛）', () => {
    expect(humanizeError(null)).toBe('未知错误')
    expect(humanizeError(undefined)).toBe('未知错误')
  })

  it('humanizeLeakedInternals 对干净文本返回 null（负控：证明它不是恒真）', () => {
    expect(humanizeLeakedInternals('一切正常')).toBeNull()
    expect(humanizeLeakedInternals('HTTP 500 internal error')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. 机制形态：模式驱动（加规则即可，不改逻辑）
// ---------------------------------------------------------------------------

describe('F1 机制形态：规则表驱动', () => {
  it('每条泄漏规则都同时提供 match 与 toUser（结构自检，防半残条目）', () => {
    // 通过公开行为间接验证：多种形态都能命中且都不泄漏内部名
    const samples = [
      'pi-ai detected context overflow for model "x/y"',
      'model "a/b" returned a completed response with no content',
      'boom pi-ai',
      'cannot find module @deepseek-ai/dsh-foo',
      'crash at lib/index.js:12',
    ]
    for (const s of samples) {
      const out = humanizeError(new Error(s))
      expect(out.length).toBeGreaterThan(0)
      expect(out).not.toMatch(/pi-ai|@deepseek-ai|lib\/index\.js|@earendil-works/)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. 【E4】官方错误码表（集中单源）
// ---------------------------------------------------------------------------

describe('F1/E4 官方错误码表：结构化信号优先于文案匹配', () => {
  it('已收录的 code 全部给出人话（且不含英文大写下划线枚举）', () => {
    const codes = [
      'CONTEXT_WINDOW_EXCEEDED', 'EMPTY_RESPONSE', 'QUOTA', 'INVALID_CREDENTIAL',
      'INVALID_REQUEST', 'MAX_TOKENS', 'LLM_STREAM_IDLE_TIMEOUT', 'gateway/service-unavailable',
    ]
    for (const c of codes) {
      const out = humanizeError(Object.assign(new Error(c), { code: c }))
      expect(out).not.toBe(c) // 不许原样透出
      expect(out).not.toMatch(/^[A-Z_]{6,}$/) // 不许退化成裸枚举
      expect(out.length).toBeGreaterThan(8)
    }
  })

  it('✅ 结构化 code 优先：即便 message 措辞陌生，也能翻成人话（官方明示措辞会变）', () => {
    // 模拟「上游换了措辞、我们的正则全不命中」——此时只剩 code 可依赖
    const out = humanizeError(Object.assign(new Error('unknown upstream phrasing 0x9f'), { code: 'CONTEXT_WINDOW_EXCEEDED' }))
    expect(out).toContain('上下文')
    expect(out).toMatch(/回退|换用/)
  })

  it('模型名从原文提取并保留；provider 前缀被剥掉（那是内部路由细节）', () => {
    const out = humanizeError(Object.assign(
      new Error('pi-ai detected context overflow for model "deepseek/deepseek-v4-flash"'),
      { code: 'CONTEXT_WINDOW_EXCEEDED' },
    ))
    expect(out).toContain('deepseek-v4-flash')
    expect(out).not.toContain('deepseek/deepseek-v4-flash')
    expect(out).not.toContain('pi-ai')
  })

  it('负控：未收录的 code 返回 null（不假装认识，交后续规则）', () => {
    expect(humanizeErrorCode('SOME_UNKNOWN_CODE', 'boom')).toBeNull()
    expect(humanizeErrorCode('', 'boom')).toBeNull()
  })

  it('负控：code 大小写敏感（官方枚举全大写；小写不得误命中，避免吞掉其它语义）', () => {
    expect(humanizeErrorCode('context_window_exceeded', 'boom')).toBeNull()
  })

  it('可行动性：每条建议都指向某个具体出路（不是「请重试」式空话）', () => {
    const out401 = humanizeError(Object.assign(new Error('x'), { code: 'INVALID_CREDENTIAL' }))
    expect(out401).toMatch(/设置|API Key/)
    const outQuota = humanizeError(Object.assign(new Error('x'), { code: 'QUOTA' }))
    expect(outQuota).toMatch(/额度|再试/)
  })
})

// ---------------------------------------------------------------------------
// 7. 【E4 2026-09-14 设备实测补充】M7 旅程在真机上抓到的**第二种泄漏形态**：
//    不是 SDK 名，而是「错误码未收录 + 官方把内部 provider id 拼进 message」。
//
//    实测原文（错误面板）：
//      provider "ts-custom" model "google/gemini-3.7-flash" does not support reasoning effort "auto"
//      UNSUPPORTED_REASONING_EFFORT
//    当时 OFFICIAL_ERROR_CODES 里没有这个码 ⇒ `humanizeErrorCode` 返回 null ⇒
//    模式表也没有对应规则 ⇒ **整段英文原文直透用户面**，连内部 provider 名
//    （`ts-custom`）和内部 `provider/model` 路由形态一起暴露。
//    这与 F1 的「SDK 名泄漏」是**同一族**（P-5 边界隔离），但入口不同 ⇒ 必须同样有判据。
// ---------------------------------------------------------------------------

describe('F1/E4 实测形态：UNSUPPORTED_REASONING_EFFORT（内部 provider id 泄漏）', () => {
  const RAW = 'provider "ts-custom" model "google/gemini-3.7-flash" does not support reasoning effort "auto"'

  it('正控：带该官方 code 的错误 → 人话，且内部 provider id 不出现', () => {
    const out = humanizeError(Object.assign(new Error(RAW), { code: 'UNSUPPORTED_REASONING_EFFORT' }))
    expect(out).not.toContain('ts-custom')
    expect(out).not.toContain('does not support')
    expect(out).not.toMatch(/^[A-Z_]{6,}$/)
    expect(out.length).toBeGreaterThan(10)
  })

  it('正控：**没有 code** 时，模式表也能兜住（README 明示措辞会变 ⇒ 两条路互为兜底）', () => {
    const out = humanizeError(new Error(RAW))
    expect(out).not.toContain('ts-custom')
    expect(out).not.toContain('google/gemini-3.7-flash')
    expect(out).toContain('gemini-3.7-flash') // 模型名对用户有用，保留
  })

  it('正控：给出**可行动**建议（去设置里改思考强度 / 换模型）', () => {
    const out = humanizeError(new Error(RAW))
    expect(out).toMatch(/思考强度|设置|换用/)
  })

  it('负控：干净的普通错误不被这条规则误伤（证明判据有区分力）', () => {
    const out = humanizeError(new Error('这个会话里没有可回退的内容'))
    expect(out).toBe('这个会话里没有可回退的内容')
  })

  it('负控：小写/变体写法不得误命中错误码表（大小写敏感）', () => {
    expect(humanizeErrorCode('unsupported_reasoning_effort', RAW)).toBeNull()
  })

  it('本轮新增的其余实测码也都在表里（防「加一条漏一条」）', () => {
    for (const c of ['UNSUPPORTED_MODEL', 'INVALID_MODEL', 'RATE_LIMITED', 'NETWORK_ERROR']) {
      const out = humanizeError(Object.assign(new Error(c), { code: c }))
      expect(out).not.toBe(c)
      expect(out).not.toMatch(/^[A-Z_]{6,}$/)
    }
  })
})
