/**
 * E2 / P-1 单测：**读宿主 SessionSnapshot / ChatSnapshot 的字段只许一处实现**，
 * 且缺字段不得崩。
 *
 * ## 为什么这组测试存在
 * goal 轨道 E 的 E2 原文要求：「客户端对官方快照的字段做『存在性 + 类型』防御性读取，
 * 缺字段不得整页崩」。而 2026-09-14 W4 复核发现：
 *   · 官方投影读取散落 **48 处**（客户端 22 + 宿主侧 26），各自写 `?.` / `??` / 裸读；
 *   · 其中 **13 处非可选链深层读取**（`data.blocks` / `agent.session.header.cwd` /
 *     `session.surface.nodes`）——官方改形状即抛；
 *   · 同**一字段多套口径**：`session.blank` 有 3 种判定，其中两种对「缺失」结论**相反**；
 *   · 既有护栏只扫 `dsht-rp-ui/src/client` 一个包，而裸读集中在 `dsh-plugin` 系。
 *
 * ## 判据
 *   ① **正控（读取器真值）**：每个字段的优先级 / 兜底值 / 类型不符时的行为；
 *   ② **负控（缺字段不抛）**：`null` / `undefined` / 基本类型 / 数组 / 同名不同类型
 *      等异常形态**一律不抛**（官方投影未定型，必须扛住）；
 *   ③ **结构护栏（单源化）**：全仓**五个包**不得再出现这些字段的裸读或逐点复制；
 *      读取器定义只许一处（`dsht-plugin-shared/host-projection.ts`）。
 *
 * 局限（诚实边界）：③ 是**源码结构**断言，只能证明「没有复制的读法」，
 * 不能证明「运行时真的读到了正确值」——后者已由 ①②（纯函数真值）覆盖。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readSessionCwd } from '../src/dsht-rp-ui/src/client/RpStateFloat.tsx'
import {
  readBlocks, readChat, readFinalMessageId, readFinalSeq, readFinalTiming,
  readHeader, readHeaderAgentPreset, readHostSessionId, readNodeData, readNodeKey,
  readNodeKind, readNodeSeq, readNodeStatus, readNodeTime, readNodeTurn,
  readSessionBlank, readSessionChat, readSessionId, readSessionRunning,
  readSourceKind, readSurfaceNodes, readSurfaceNodesOrNull, forEachChatNode,
} from '../src/dsht-plugin-shared/host-projection.ts'

// ---------------------------------------------------------------------------
// 一、真值（正控 + 负控）
// ---------------------------------------------------------------------------

/** 各种「官方投影未定型」的异常输入：一律不得抛 */
const WEIRD: unknown[] = [
  null, undefined, 0, 1, -1, NaN, '', false, true, [], [1, 2], 'string', Symbol('s'),
  () => {}, new Date(), new Map(),
]

describe('E2 防御性读取：readSessionCwd 的存在性 + 类型口径', () => {
  it('【正控】header.cwd 优先', () => {
    expect(readSessionCwd({ header: { cwd: '/a/b' } })).toBe('/a/b')
    // 两者都在 ⇒ 用 header（与历史惯用法 `s.header?.cwd ?? s.cwd` 同口径）
    expect(readSessionCwd({ header: { cwd: '/h' }, cwd: '/t' })).toBe('/h')
  })

  it('【正控】顶层 cwd 兜底（官方历史版本把 cwd 放顶层）', () => {
    expect(readSessionCwd({ cwd: '/only/top' })).toBe('/only/top')
    expect(readSessionCwd({ header: {}, cwd: '/top' })).toBe('/top')
  })

  it('【负控】各种缺字段/类型不符形态**一律不抛**，返回空串表示「未就绪」', () => {
    const weird: unknown[] = [
      ...WEIRD,
      {}, { header: null }, { header: undefined }, { header: 123 },
      { header: { cwd: 123 } }, { header: { cwd: null } }, { header: { cwd: '' } },
      { cwd: 456 }, { cwd: null }, { cwd: '' },
    ]
    for (const w of weird) {
      expect(() => readSessionCwd(w), `输入 ${String(JSON.stringify(w))} 不应抛`).not.toThrow()
      expect(readSessionCwd(w)).toBe('')
    }
  })

  it('【负控】空串 header.cwd 视为缺失 ⇒ 继续取顶层（不得把空串当有效值）', () => {
    expect(readSessionCwd({ header: { cwd: '' }, cwd: '/fallback' })).toBe('/fallback')
  })

  it('【边界】非对象 header（数组）不崩，且不误取数组元素', () => {
    expect(readSessionCwd({ header: ['/x'], cwd: '/y' })).toBe('/y')
  })
})

describe('E2 防御性读取：id 类（readSessionId / readHostSessionId）', () => {
  it('【正控】sessionId 优先，id 兜底；宿主侧只有 id', () => {
    expect(readSessionId({ sessionId: 's1' })).toBe('s1')
    expect(readSessionId({ id: 'i1' })).toBe('i1')
    expect(readSessionId({ sessionId: 's1', id: 'i1' })).toBe('s1')
    expect(readHostSessionId({ id: 'i1' })).toBe('i1')
  })

  it('【负控】数字/对象 id **不得**被 String() 成 "123"/"[object Object]"', () => {
    // 这是 W4 收口前的真实缺陷：`String((session as {id?}).id ?? '')` 把数字 id
    // 变成 '123'（非空真值！）→ 被当成 sessionId 写进日志/快照目录名。
    expect(readHostSessionId({ id: 123 })).toBe('')
    expect(readHostSessionId({ id: {} })).toBe('')
    expect(readSessionId({ sessionId: 123, id: 'ok' })).toBe('ok')
  })

  it('【负控】异常形态一律不抛', () => {
    for (const w of WEIRD) {
      expect(() => readSessionId(w)).not.toThrow()
      expect(() => readHostSessionId(w)).not.toThrow()
      expect(readSessionId(w)).toBe('')
      expect(readHostSessionId(w)).toBe('')
    }
  })
})

describe('E2 防御性读取：readSessionBlank / readSessionRunning（口径唯一）', () => {
  it('【正控】只有明确 true 才算「空白 / 生成中」', () => {
    expect(readSessionBlank({ blank: true })).toBe(true)
    expect(readSessionBlank({ blank: false })).toBe(false)
    expect(readSessionRunning({ running: true })).toBe(true)
    expect(readSessionRunning({ running: false })).toBe(false)
  })

  it('【负控 · P-1 核心】字段缺失一律视为「非空白 / 未生成」（缺失方向不得翻转）', () => {
    // 收口前三种口径对「缺失」结论相反（`!== true` / `=== true` / `!== false`）。
    // 本判据钉住唯一口径：缺失 ⇒ false。任何新增的第三种读法都会被这条挡住。
    for (const w of WEIRD) {
      expect(readSessionBlank(w), `${String(JSON.stringify(w))} 的 blank 应为 false`).toBe(false)
      expect(readSessionRunning(w)).toBe(false)
    }
    expect(readSessionBlank({})).toBe(false)
    expect(readSessionBlank({ blank: 'true' })).toBe(false) // 字符串不算
    expect(readSessionBlank({ blank: 1 })).toBe(false)
    expect(readSessionRunning({ running: 'yes' })).toBe(false)
  })
})

describe('E2 防御性读取：chat / node / data 三层', () => {
  it('【正控】readChat 取 order + nodes（nodes 必须是带 values 函数的对象）', () => {
    const nodes = { values: () => ['n'] }
    const c = readChat({ order: ['a', 'b'], nodes })
    expect(c.order).toEqual(['a', 'b'])
    expect(c.nodes).toBe(nodes)
  })

  it('【负控】order 元素非字符串被滤掉；nodes 缺 values 函数当缺失（不静默空转）', () => {
    expect(readChat({ order: ['a', 1, null, 'b'] }).order).toEqual(['a', 'b'])
    // 数组也有 .values()，但语义是「元素」而非「节点」⇒ 必须判为缺失（P-3 静默族）
    expect(readChat({ order: [], nodes: [1, 2, 3] }).nodes).toBeNull()
    expect(readChat({ nodes: {} }).nodes).toBeNull()
    for (const w of WEIRD) {
      expect(() => readChat(w)).not.toThrow()
      expect(readChat(w).order).toEqual([])
      expect(readChat(w).nodes).toBeNull()
    }
  })

  it('【正控】forEachChatNode 迭代节点，缺失时零次且不抛', () => {
    let n = 0
    expect(forEachChatNode({ nodes: { values: () => [1, 2, 3] } }, () => { n += 1 })).toBe(3)
    expect(n).toBe(3)
    for (const w of WEIRD) {
      expect(forEachChatNode(w, () => { n += 1 })).toBe(0)
    }
  })

  it('【正控】readSessionChat 从会话快照取 chat 投影（会话快照的 chat 可能缺席）', () => {
    const nodes = { values: () => ['x'] }
    expect(readSessionChat({ chat: { order: ['k'], nodes } }).order).toEqual(['k'])
    expect(readSessionChat({}).nodes).toBeNull()
    for (const w of WEIRD) expect(() => readSessionChat(w)).not.toThrow()
  })

  it('【正控】readBlocks 兼容 blocks / content 两名；缺一取另一', () => {
    expect(readBlocks({ blocks: [{ kind: 'text' }] })).toHaveLength(1)
    expect(readBlocks({ content: [{ type: 'text' }] })).toHaveLength(1)
    // blocks 空但 content 有 ⇒ 取 content（user 节点形态）
    expect(readBlocks({ blocks: [], content: [{ type: 'text' }] })).toHaveLength(1)
    // 元素非对象被滤掉（调用点可安全 `.kind`）
    expect(readBlocks({ blocks: [1, null, { kind: 'x' }] })).toEqual([{ kind: 'x' }])
  })

  it('【负控 · 最高危】readBlocks 对任何异常形态返回空数组，**绝不抛**', () => {
    // 收口前 `for (const block of data.blocks)` 是渲染热路径裸迭代：
    // 官方改形状即抛 → SlotErrorBoundary 吞掉 → 整片楼层消失且零报错。
    for (const w of WEIRD) {
      expect(() => readBlocks(w), `readBlocks(${String(JSON.stringify(w))}) 不应抛`).not.toThrow()
      expect(readBlocks(w)).toEqual([])
    }
    expect(readBlocks({ blocks: 'not-array' })).toEqual([])
    expect(readBlocks({ blocks: null })).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 【2026-09-16 W24b】引用稳定性回归锁（**设备实测抓到的真缺陷**）
  //
  // ## 缺陷形态（P-8 幂等的 React 变体）
  // `readBlocks` 原实现用 `v.filter(isPlainObjectLike)` ⇒ **每次调用都新建数组**。
  // 而消费点 `RpNativeChat.tsx` 写 `const blocks = readBlocks(data)`，再把 `blocks`
  // 直接放进 `processed` useMemo 的依赖数组 ⇒ 引用恒变 ⇒ **useMemo 每次渲染都失效**
  // ⇒ 每个 assistant 楼层每次渲染都重跑 `runDisplayScripts`（14 条 display 正则，
  // 含 `([\s\S]*)\[OS\]([\s\S]*)` 这类两头贪婪形态）× 50 楼层 ⇒ 主线程饱和。
  //
  // ## 设备证据（可复现）
  //   · M7 两次都停在首卡 J4 之后；WebView 渲染进程 CPU 持续 **100%**
  //   · CDP 连 `Runtime.evaluate("1+1")` 都超时（`ef-journey-all.mjs` 的 send() 原无超时
  //     ⇒ 整个 M7 **静默挂死**，不报错不退出 —— P-3）
  //   · `Debugger.pause` ×3：两次精确停在 `runDisplayScripts`，调用链
  //     `RpAssistantNodeView` → React `useMemo` → `runDisplayScripts`
  //   · 现场局部量：`scripts 总数=14`、`matches=0`、`source.length=3716`
  //   · **静止态 CPU = 0%** ⇒ 不是死循环，是「每次渲染都全量重算」
  //
  // ## 为什么这条判据必须存在（P-20 判据自带杠杆）
  // 「返回值内容正确」的既有断言**测不出**本缺陷（内容逐字相同，只有引用身份不同）。
  // 没有本条，同一个错误随时会被再写回来，且**回归时全绿**。
  describe('W24b 引用稳定性（useMemo 依赖必须稳定，否则热路径全量重算）', () => {
    it('【正控】同一 data 连续多次 readBlocks ⇒ **同一引用**（否则 useMemo 必失效）', () => {
      const data = { blocks: [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }] }
      expect(readBlocks(data)).toBe(readBlocks(data))
      // 20 次「渲染」只应产生 1 个引用（= memo 最多重算 1 次）
      const seen = new Set<unknown>()
      for (let i = 0; i < 20; i += 1) seen.add(readBlocks(data))
      expect(seen.size).toBe(1)
    })

    it('【正控】content 分支（user 节点）同样引用稳定', () => {
      const data = { content: [{ type: 'text', text: 'x' }] }
      expect(readBlocks(data)).toBe(readBlocks(data))
    })

    it('【正控】缺失/异常形态返回**共享**空数组（不是每次新建 `[]`）', () => {
      expect(readBlocks(null)).toBe(readBlocks(undefined))
      expect(readBlocks({})).toBe(readBlocks({ blocks: null }))
      expect(readBlocks({ blocks: 'not-array' })).toBe(readBlocks({ blocks: [] }))
    })

    it('【正控】含非对象元素（需过滤）的分支也引用稳定，且**内容正确**', () => {
      const data = { blocks: [1, null, { kind: 'x' }] }
      const a = readBlocks(data)
      const b = readBlocks(data)
      expect(a).toBe(b)
      expect(a).toEqual([{ kind: 'x' }])
    })

    it('【负控】底层数组**真的换了** ⇒ 必须返回**不同**引用（不得靠缓存掩盖变化）', () => {
      const d1 = { blocks: [{ kind: 'text', text: 'a' }] }
      const d2 = { blocks: [{ kind: 'text', text: 'a' }] } // 内容相同但不同数组对象
      expect(readBlocks(d1)).not.toBe(readBlocks(d2))
      // 含非对象元素那条分支同样不得掩盖（换数组 ⇒ 换引用）
      const d3 = { blocks: [1, { kind: 'x' }] }
      const d4 = { blocks: [1, { kind: 'x' }] }
      expect(readBlocks(d3)).not.toBe(readBlocks(d4))
    })

    it('【负控】data.blocks 与 data.content 都非空时取 blocks（口径未变）', () => {
      const onlyContent = { blocks: [], content: [{ type: 'text' }] }
      const both = { blocks: [{ kind: 'text' }], content: [{ type: 'text' }] }
      expect(readBlocks(onlyContent)).toHaveLength(1)
      expect(readBlocks(both)).toEqual([{ kind: 'text' }])
    })

    it('【P-20 杠杆】判据能区分「稳定」与「每次新引用」两种实现', () => {
      // 合成一个「每次新引用」的实现（= 修复前的形态），断言本组判据会对它报红。
      // 没有这条断言，「测试通过」也可能只是判据自己写错了（P-19/P-30）。
      // 判「是不是对象」用最小内联实现（不为此扩大 host-projection 的导出面）。
      const isObj = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v)
      const broken = (data: unknown): readonly Record<string, unknown>[] => {
        if (!isObj(data)) return []
        const d = data as Record<string, unknown>
        const pick = (v: unknown): readonly Record<string, unknown>[] =>
          Array.isArray(v) ? (v.filter(isObj) as readonly Record<string, unknown>[]) : []
        const b = pick(d.blocks)
        return b.length > 0 ? b : pick(d.content)
      }
      const data = { blocks: [{ kind: 'text' }] }
      // 好实现（被测）：稳定
      expect(readBlocks(data)).toBe(readBlocks(data))
      // 坏实现（合成正控）：不稳定 ⇒ 若被测实现退化成这样，上面的断言必然报红
      expect(broken(data)).not.toBe(broken(data))
    })
  })

  it('【正控】readNodeData 兜底空对象（调用点永不需判空）；readNodeKey/Kind/Status', () => {
    expect(readNodeData({ data: { a: 1 } })).toEqual({ a: 1 })
    for (const w of WEIRD) expect(readNodeData(w)).toEqual({})
    expect(readNodeData({ data: [] })).toEqual({}) // 数组不当对象
    expect(readNodeKey({ key: 'k' })).toBe('k')
    expect(readNodeKey({ key: 1 })).toBe('')
    expect(readNodeKind({ kind: 'user' })).toBe('user')
    expect(readNodeStatus({ status: 'running' })).toBe('running')
    expect(readNodeStatus({})).toBe('') // 不冒充 settled
  })

  it('【正控】readNodeSeq / Turn / Time 三兄弟只认 number', () => {
    expect(readNodeSeq({ seq: 3 })).toBe(3)
    expect(readNodeTurn({ turn: 2 })).toBe(2)
    expect(readNodeTime({ time: 100 })).toBe(100)
    for (const w of WEIRD) {
      expect(readNodeSeq(w)).toBeUndefined()
      expect(readNodeTurn(w)).toBeUndefined()
      expect(readNodeTime(w)).toBeUndefined()
    }
    expect(readNodeSeq({ seq: '3' })).toBeUndefined()
  })

  it('【正控】readFinalSeq / MessageId / Timing（回退·变体·耗时全部判据的锚点）', () => {
    expect(readFinalSeq({ finalNode: { seq: 7 } })).toBe(7)
    expect(readFinalMessageId({ finalNode: { messageId: 'm1' } })).toBe('m1')
    expect(readFinalTiming({ finalNode: { timing: { stepStartTime: 1, completedTime: 5 } } }))
      .toEqual({ stepStartTime: 1, completedTime: 5 })
    // finalNode 存在但 timing 缺席 ⇒ null（不是 {0,0}——不冒充真实耗时）
    expect(readFinalTiming({ finalNode: {} })).toBeNull()
    expect(readFinalTiming({ finalNode: { timing: { stepStartTime: null } } }))
      .toEqual({ stepStartTime: null, completedTime: null })
  })

  it('【负控】readFinalSeq / Timing 对异常形态返回 undefined / null，不抛', () => {
    for (const w of WEIRD) {
      expect(() => readFinalSeq(w)).not.toThrow()
      expect(readFinalSeq(w)).toBeUndefined()
      expect(readFinalMessageId(w)).toBeUndefined()
      expect(readFinalTiming(w)).toBeNull()
    }
    expect(readFinalSeq({ finalNode: { seq: '7' } })).toBeUndefined()
  })

  it('【正控】readSourceKind（user 消息真伪判定：仅 "user" 算真人输入）', () => {
    expect(readSourceKind({ source: { kind: 'user' } })).toBe('user')
    expect(readSourceKind({ source: { kind: 'plugin' } })).toBe('plugin')
    // 缺席 ⇒ ''（视为「非真人输入」，与历史 `!== 'user'` 判定同效）
    expect(readSourceKind({})).toBe('')
    for (const w of WEIRD) expect(readSourceKind(w)).toBe('')
  })
})

describe('E2 防御性读取：宿主侧 header / surface', () => {
  it('【正控】readHeader 缺失/非对象 ⇒ null；readHeaderAgentPreset 缺 ⇒ ""', () => {
    expect(readHeader({ header: { cwd: '/x' } })).toEqual({ cwd: '/x' })
    expect(readHeader({})).toBeNull()
    expect(readHeader({ header: [] })).toBeNull() // 数组不算对象
    expect(readHeaderAgentPreset({ header: { agentPreset: 'p1' } })).toBe('p1')
    expect(readHeaderAgentPreset({ header: {} })).toBe('')
  })

  it('【正控】readSurfaceNodes 只保留 number（官方是 seq 数字数组）', () => {
    expect(readSurfaceNodes({ surface: { nodes: [1, 2, 3] } })).toEqual([1, 2, 3])
    expect(readSurfaceNodes({ surface: { nodes: [1, 'a', null, 2] } })).toEqual([1, 2])
    expect(readSurfaceNodes({})).toEqual([])
  })

  it('【负控】readSurfaceNodes / OrNull 对异常形态一律不抛', () => {
    for (const w of WEIRD) {
      expect(() => readSurfaceNodes(w)).not.toThrow()
      expect(readSurfaceNodes(w)).toEqual([])
      expect(() => readSurfaceNodesOrNull(w)).not.toThrow()
      expect(readSurfaceNodesOrNull(w)).toBeNull()
    }
  })

  it('【边界 · P-2】OrNull 变体必须**区分**「字段缺席」与「空视图」', () => {
    // 这两个状态在回退/变体路由里语义不同：缺席 = 会话未就绪 ⇒ 409；
    // 空数组 = 就绪但无消息 ⇒ 合法（交给业务逻辑处理）。合并成一个就分不开了。
    expect(readSurfaceNodesOrNull({ surface: { nodes: [] } })).toEqual([])
    expect(readSurfaceNodesOrNull({ surface: {} })).toBeNull()
    expect(readSurfaceNodesOrNull({})).toBeNull()
  })

  it('【正控·等价性】两个 surface 读取器对「合法输入」结论必须一致', () => {
    const cases: unknown[] = [
      { surface: { nodes: [1, 2] } },
      { surface: { nodes: [] } },
      { surface: { nodes: [1, 'x'] } },
      { surface: { nodes: 'no' } },
      { surface: [] },
      {},
    ]
    for (const c of cases) {
      const a = readSurfaceNodes(c)
      const b = readSurfaceNodesOrNull(c)
      // b 为 null 时 a 必为空数组；否则 b 与 a 逐元素相同（不得出现「一个读到、一个读不到」）
      if (b === null) expect(a).toEqual([])
      else expect(a).toEqual(b)
    }
  })
})

// ---------------------------------------------------------------------------
// 二、结构护栏（单源化）—— 覆盖全部五个包
// ---------------------------------------------------------------------------

/** 工作区 packages/src（含全部消费包） */
const SRC = join(import.meta.dirname, '..', 'src')
/** 单源模块（读取器的**唯一**定义处） */
const SSOT = join(SRC, 'dsht-plugin-shared', 'host-projection.ts')

/** 递归收集 .ts/.tsx（跳过派生/产物目录） */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'lib' || name === 'dist' || name === 'node_modules' || name === 'assets') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** 剥注释后再匹配（P-19：本仓习惯把反例原文写进注释，不剥注释 ⇒ 判据被自己的文档触发成假红）。
 *  **保留换行**：行号要准（报错时人要靠它去定位）。块注释整体换成等量空行。 */
const stripComments = (text: string): string => text
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))  // 块注释（含 JSDoc）：留行数
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')                          // 行注释（避开 `http://`）

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

/**
 * 官方投影「绕开单源直接读」的检测规则。
 *
 * 【为什么要抽成纯函数】判据自身也要能被正控/负控验证（P-19）：只在真实仓库上跑一次
 * 「0 命中」不能证明判据有效——它可能是**恒不命中**（正则写错/被剥注释吃掉）。
 * 抽出来后可以喂合成样本，证明「该报的报、不该报的不报」。
 */
type BareRule = { label: string; re: RegExp; guardedBy?: RegExp }
const BARE_RULES: BareRule[] = [
  { label: 'session.header.cwd（裸读）', re: /(?:session|snapshot|agent\.session)\.header\.cwd/ },
  { label: 'header?.cwd ??（逐点复制）', re: /header\?\.cwd\s*\?\?/ },
  { label: 'session.surface.nodes（裸读）', re: /(?:session|live)\.surface\.nodes/ },
  { label: 'surface?.nodes ??（逐点复制）', re: /surface\?\.nodes\s*\?\?/ },
  { label: 'session.blank（裸比）', re: /\.blank\s*(?:===|!==)\s*(?:true|false)/ },
  {
    label: 'data.blocks（裸迭代/裸方法）',
    // 【P-19 实证一】首版写成 `[\w.]*\.data\.blocks`（前缀点**必需**）⇒ 裸读 `of data.blocks`
    // 不命中。正控样本立刻抓到（「在真实仓库上 0 命中」永远发现不了——它看起来像「代码很干净」）。
    // 【P-19 实证二】第二版把 `of X.blocks` 一律当裸读 ⇒ 把 `for (const block of blocks)`
    //（`blocks` 是**已经从 readBlocks 取到的局部变量**）也报成违规。**负控样本**抓到这条误报。
    // 终版只认「`.blocks` 前面确实是 `data.`」这一种形态——即官方投影字段本身。
    re: /(?:[\w$]+\.)*data\.blocks\b/,
    // 【P-29 实战】写法本身带守卫（本行或紧邻前 2 行有 Array.isArray）⇒ 不算缺陷。
    // 这条豁免是靠**真实假 FAIL** 换来的：首次跑本判据时 session-surgery.ts:81 被报，
    // 而该处上一行正是 `if (isSnapshot && Array.isArray(ev.data?.content))` ——
    // 证据串（含守卫的代码）与结论（「无守卫」）自相矛盾，正是判据写错的识别特征。
    guardedBy: /Array\.isArray\s*\([^)]*\.(?:blocks|content)\b/,
  },
  {
    label: 'data.content（裸迭代）',
    // 同 data.blocks：只认 `.content` 前面是 `data.` 的形态（局部变量 `content` 不报）。
    re: /(?:[\w$]+\.)*data\.content\b/,
    guardedBy: /Array\.isArray\s*\([^)]*\.(?:blocks|content)\b/,
  },
  { label: 'chat.nodes.values()（裸调）', re: /(?:chat|snapshot)[\w.]*\.nodes\.values\(\)/ },
  { label: 'chat?.nodes?.values()（逐点复制）', re: /nodes\?\.values\(\)/ },
  { label: 'finalNode.seq（裸读）', re: /finalNode\?\.seq|finalNode\.seq\b/ },
  { label: 'data.status（裸比）', re: /\bdata\?\.status\s*(?:===|!==)|\bdata\.status\s*(?:===|!==)/ },
]

/** 扫描一段源码文本，返回命中清单（行号 + 规则名）。纯函数，供正控/负控与真实扫描共用。 */
const findBareReads = (source: string): string[] => {
  const out: string[] = []
  const lines = stripComments(source).split('\n')
  for (const { label, re, guardedBy } of BARE_RULES) {
    for (const [i, line] of lines.entries()) {
      if (!re.test(line)) continue
      if (guardedBy !== undefined && guardedBy.test(lines.slice(Math.max(0, i - 2), i + 1).join('\n'))) continue
      out.push(`${i + 1} [${label}]`)
    }
  }
  return out
}

describe('E2/P-1 单源化：官方投影读取不得再逐点复制', () => {
  const files = walk(SRC)

  it('读取器的定义**只许**在 dsht-plugin-shared/host-projection.ts 一处', () => {
    const defs: string[] = []
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      if (/export\s+(?:async\s+)?function\s+read(?:Chat|Session|Node|Blocks|Final|Header|Source|Surface)/.test(code)) defs.push(f)
    }
    expect(defs, `读取器定义出现在 ${defs.length} 处（应为 1）：${defs.map(basename).join(', ')}`).toEqual([SSOT])
  })

  it('客户端别名文件**不得**含读取逻辑（只许 re-export）', () => {
    const alias = join(SRC, 'dsht-rp-ui', 'src', 'client', 'host-projection.ts')
    const code = stripComments(readFileSync(alias, 'utf8'))
    expect(/export\s+function\s+read/.test(code), '客户端 host-projection.ts 出现了读取器实现（会出现第二套口径）').toBe(false)
    expect(/export\s*\{/.test(code), '客户端 host-projection.ts 未做 re-export').toBe(true)
  })

  it('全仓**五个包**不得出现官方投影字段的**无守卫**深层读取', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (f === SSOT) continue // 单源模块内部当然是「裸读」——它就是那个唯一的读法
      for (const hit of findBareReads(readFileSync(f, 'utf8'))) offenders.push(`${basename(f)}:${hit}`)
    }
    expect(offenders, `发现逐点复制/裸读官方投影（应改用 host-projection.ts 的读取器）：\n${offenders.join('\n')}`).toEqual([])
  })

  it('【判据正控】合成样本里的每一类裸读**都必须被报出**（防「恒不命中」的假绿）', () => {
    // P-19：在真实仓库上跑出「0 命中」不能证明判据有效——正则写错也会 0 命中。
    // 这里逐类喂合成样本，证明每条规则**真的会报**。
    const samples: Array<[string, string]> = [
      ['header.cwd', 'const slug = rpSlugFromCwd(agent.session.header.cwd, home)'],
      ['header 兜底复制', "const slug = rpSlugFromCwd(s.header?.cwd ?? s.cwd, home)"],
      ['surface.nodes', 'for (const seq of session.surface.nodes) { use(seq) }'],
      ['surface 兜底复制', 'const view = live.surface?.nodes ?? []'],
      ['blank 裸比', "const hide = s.blank !== false && s.blank !== true"],
      ['blocks 裸迭代', 'for (const block of node.data.blocks) { emit(block) }'],
      ['blocks 裸方法', "const has = data.blocks.some(b => b.kind !== 'tool-call')"],
      ['content 裸迭代', 'for (const b of data.content) { push(b) }'],
      ['nodes.values 裸调', 'for (const n of chat.nodes.values()) { use(n) }'],
      ['nodes?.values 复制', 'for (const n of chat?.nodes?.values() ?? []) { use(n) }'],
      ['finalNode.seq 裸读', "const mySeq = typeof n.data?.finalNode?.seq === 'number' ? n.data.finalNode.seq : undefined"],
      ['data.status 裸比', "if (data.status === 'running') return"],
    ]
    const missed = samples.filter(([, src]) => findBareReads(src).length === 0).map(([name]) => name)
    expect(missed, `以下合成样本未被判据报出（判据失效）：${missed.join(', ')}`).toEqual([])
  })

  it('【判据负控】走单源的写法与注释里的反例**都不得被报**（防真红）', () => {
    const clean: Array<[string, string]> = [
      ['单源读取器', 'const slug = rpSlugFromCwd(readSessionCwd(agent.session), home)'],
      ['单源 blocks', 'for (const block of readBlocks(data)) { emit(block) }'],
      ['单源 surface', 'for (const seq of readSurfaceNodes(session)) { use(seq) }'],
      ['单源 blank', 'const blank = readSessionBlank(props.session)'],
      ['单源 finalSeq', 'const mySeq = readFinalSeq(data)'],
      ['单源 chat 迭代', 'forEachChatNode(snapshot, (n) => { use(n) })'],
      // 行注释里的反例原文（本仓习惯）：剥注释后不得触发
      ['行注释里的反例', "// 此前写 `s.header?.cwd ?? s.cwd`，见 readSessionCwd"],
      ['块注释里的反例', '/**\n * 历史形态：for (const block of data.blocks) 会抛\n */\nconst x = readBlocks(data)'],
      // 带守卫的写法（P-29 实战豁免）
      ['Array.isArray 守卫（同行）', 'for (const block of (Array.isArray(ev.data.content) ? ev.data.content : [])) { use(block) }'],
      ['Array.isArray 守卫（上一行）', 'if (isSnapshot && Array.isArray(ev.data?.content)) {\n  for (const block of ev.data.content) { use(block) }\n}'],
    ]
    const falsePositives = clean.filter(([, src]) => findBareReads(src).length > 0)
      .map(([name, src]) => `${name} → ${findBareReads(src).join(' / ')}`)
    expect(falsePositives, `以下干净样本被误报（判据过宽）：\n${falsePositives.join('\n')}`).toEqual([])
  })

  it('readSessionCwd 是**唯一**实现（定义仅一处）', () => {
    const defs: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      if (/export\s+function\s+readSessionCwd\s*\(/.test(text)) defs.push(f)
    }
    expect(defs.length, `readSessionCwd 定义处 ${defs.length} 个（应为 1）：${defs.map(basename).join(', ')}`).toBe(1)
  })

  it('【正控】消费方确实在使用它（防「定义了没人用」的假单源化）', () => {
    const users: string[] = []
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      const calls = code.split('\n').filter(l => /readSessionCwd\s*\(/.test(l) && !/export\s+function\s+readSessionCwd/.test(l))
      if (calls.length > 0) users.push(basename(f))
    }
    // 历史 5 处调用点分布在 4 个文件：RpGreetingDock / RpScriptHost×2 / RpStateFloat / RpTokenMeter
    expect(users.length, `消费方仅 ${users.length} 个（应 ≥4）：${users.join(', ')}`).toBeGreaterThanOrEqual(4)
  })

  it('【正控】宿主侧消费方也真的在用单源（跨包覆盖，防护栏只守一个包）', () => {
    // W4 的核心教训之一：旧护栏只扫 dsht-rp-ui。这条钉住宿主侧四包**确实**接入了单源。
    const REQUIRED: Array<[string, string]> = [
      ['dsh-plugin/index.ts', 'readSurfaceNodes'],
      ['dsh-plugin/index.ts', 'readSessionCwd'],
      ['dsh-plugin/index.ts', 'readHostSessionId'],
      ['dsht-plugin-memory/index.ts', 'readSurfaceNodes'],
      ['dsht-plugin-memory/index.ts', 'readSessionCwd'],
      ['dsht-plugin-undo/index.ts', 'readSessionCwd'],
      ['dsht-plugin-prompt-template/index.ts', 'readSurfaceNodes'],
      ['dsht-plugin-shared/host-projection.ts', 'readHeaderAgentPreset'],
      ['dsht-plugin-shared/host-projection.ts', 'readBlocks'],
      ['dsht-plugin-shared/host-projection.ts', 'readFinalTiming'],
    ]
    const missing: string[] = []
    for (const [rel, fn] of REQUIRED) {
      const text = readFileSync(join(SRC, ...rel.split('/')), 'utf8')
      if (!new RegExp(`${fn}\\s*\\(`).test(text)) missing.push(`${rel} 未使用 ${fn}`)
    }
    expect(missing, `单源未接入：${missing.join('; ')}`).toEqual([])
  })
})
