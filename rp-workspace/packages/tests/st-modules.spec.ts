/**
 * ST 标准模块端点（T-63）测试 —— `src/dsh-plugin/assets/st-modules/**`
 *
 * 口径：**真加载、真语义**。四个模块是构建期分发的静态 ES module 资产，
 * 故本测试用 `data:` URL **真实 import**（走 ES module 语义），而不是只读文本 grep，
 * 也不用"我认为应该是什么"的假设。
 *
 * 判据来源（卡的实测取用面，`tmp/t37-inject.js`）：
 *   :2221 `items: ['promptManager','MessageCollection','Message','sendOpenAIRequest'], from: './scripts/openai'`
 *   :2225 `items: ['streamingProcessor'], from: './script'`
 *   :2229 `items: ['getPresetManager'], from: './scripts/preset-manager'`
 *   :2233 `items: ['equalsIgnoreCaseAndAccents','getSanitizedFilename'], from: './scripts/utils'`
 *
 * 关键纪律（本项目铁律）：
 *  - 静态 import 是**原子**的 → 任一符号取不到，整段模块脚本不执行。
 *    故本测试的核心断言是「**卡的四个 import 语句各自都能解析出全部符号**」（端到端）。
 *  - 不得塞空壳 → `sendOpenAIRequest` 必须**真 reject 并具名**，不能返回假值。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const ASSETS = path.resolve(import.meta.dirname, '../src/dsh-plugin/assets/st-modules')

const FILES = {
  script: path.join(ASSETS, 'script.js'),
  utils: path.join(ASSETS, 'scripts/utils.js'),
  presetManager: path.join(ASSETS, 'scripts/preset-manager.js'),
  openai: path.join(ASSETS, 'scripts/openai.js'),
} as const

/** 把磁盘上的模块源码当 ES module 真加载（data: URL；非 TS 转译，语义等同浏览器）。
 *  ⚠️ 必须带唯一 fragment：data: URL 按完整 URL 缓存，否则第二次 load 会拿到**上次执行过**的
 *  模块命名空间（顶层副作用不重跑）→ 「取真实数据的用例」会读到上一个用例的数据。 */
let loadSeq = 0
async function loadModule(file: string): Promise<Record<string, unknown>> {
  const src = readFileSync(file, 'utf8')
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}#dsht-test-${++loadSeq}`
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>
}

/** 假 `/version` 与 TH 数据面（模块顶层会取真实数据；测试里给确定性应答并记录调用） */
function stubFetch(version: Record<string, unknown> = { pkgVersion: '1.18.0' }) {
  const calls: string[] = []
  const fn = vi.fn(async (url: string | URL) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith('/version')) {
      return { ok: true, status: 200, json: async () => version } as unknown as Response
    }
    if (u.includes('/dsht-tavern-helper/context')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          presetName: '测试预设',
          chatCompletionSettings: {
            prompts: [
              { identifier: 'main', name: '主提示', role: 'system', content: '你是 {{char}}' },
              { identifier: 'chatHistory', role: 'system', content: '' },
            ],
          },
        }),
      } as unknown as Response
    }
    if (u.includes('/dsht-tavern-helper/preset/names')) {
      return { ok: true, status: 200, json: async () => ({ names: [], loaded: '' }) } as unknown as Response
    }
    if (u.includes('/dsht-tavern-helper/preset/get')) {
      return { ok: true, status: 200, json: async () => ({ found: false, preset: null }) } as unknown as Response
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response
  })
  ;(globalThis as { fetch: unknown }).fetch = fn
  return { fn, calls }
}

let realFetch: unknown
beforeEach(() => { realFetch = (globalThis as { fetch?: unknown }).fetch })
afterEach(() => {
  ;(globalThis as { fetch: unknown }).fetch = realFetch
  delete (globalThis as { SillyTavern?: unknown }).SillyTavern
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. 最承重的一条：卡的四个 import 语句能否解析出全部符号
// ---------------------------------------------------------------------------

describe('T-63 核心判据：卡的四个静态 import 各自可解析（静态 import 是原子的）', () => {
  // 逐字来自 tmp/t37-inject.js:2219-2243 的 importFromModule 生成结果
  const CARD_IMPORTS: Array<{ from: keyof typeof FILES; items: string[] }> = [
    { from: 'openai', items: ['promptManager', 'MessageCollection', 'Message', 'sendOpenAIRequest'] },
    { from: 'script', items: ['streamingProcessor'] },
    { from: 'presetManager', items: ['getPresetManager'] },
    { from: 'utils', items: ['equalsIgnoreCaseAndAccents', 'getSanitizedFilename'] },
  ]

  for (const spec of CARD_IMPORTS) {
    it(`${spec.from}: ${spec.items.join(', ')} 全部存在`, async () => {
      stubFetch()
      const mod = await loadModule(FILES[spec.from])
      for (const name of spec.items) {
        // 取不到 = 卡的整段 module 脚本不执行（这正是被修的缺陷）
        expect(mod[name], `${spec.from} 缺导出 ${name}`).toBeDefined()
      }
    })
  }

  it('script.js 的 streamingProcessor 为 null（基准初值语义，非 undefined）', async () => {
    stubFetch()
    const mod = await loadModule(FILES.script)
    // 基准 script.js:455 `export let streamingProcessor = null`
    // 注意：undefined 也会让 import 成功，但克会把它当"缺能力"；null 是基准的确切初值
    expect('streamingProcessor' in mod).toBe(true)
    expect(mod.streamingProcessor).toBeNull()
  })

  it('反向：四个文件都真的存在（缺文件 → 路由 404 → 卡 bootstrap 整段中断）', () => {
    for (const [name, p] of Object.entries(FILES)) {
      const src = readFileSync(p, 'utf8')
      expect(src.length, `${name} 为空`).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. utils：与基准逐字同形的两个函数
// ---------------------------------------------------------------------------

describe('scripts/utils.js —— 基准逐字移植（SillyTavern-reference/scripts/utils.js）', () => {
  it('equalsIgnoreCaseAndAccents：大小写 + 音标不敏感（基准 compareIgnoreCaseAndAccents 语义）', async () => {
    stubFetch()
    const { equalsIgnoreCaseAndAccents } = await loadModule(FILES.utils) as {
      equalsIgnoreCaseAndAccents: (a: string, b: string) => boolean
    }
    expect(equalsIgnoreCaseAndAccents('Foo', 'foo')).toBe(true)
    expect(equalsIgnoreCaseAndAccents('café', 'cafe')).toBe(true)   // NFD 去音标
    expect(equalsIgnoreCaseAndAccents('foo', 'bar')).toBe(false)
    // 基准提前返回分支：任一为空串 → 交比较函数（'' === '' 为 true；'' vs 'a' 为 false）
    expect(equalsIgnoreCaseAndAccents('', '')).toBe(true)
    expect(equalsIgnoreCaseAndAccents('', 'a')).toBe(false)
  })

  it('getSanitizedFilename：非法字符被替换、空结果 reject（不静默返回空串）', async () => {
    stubFetch()
    const { getSanitizedFilename } = await loadModule(FILES.utils) as {
      getSanitizedFilename: (n: string) => Promise<string>
    }
    await expect(getSanitizedFilename('a/b:c*d?e')).resolves.toBe('a_b_c_d_e')
    // 全非法 → 净化后为空 → 必须 reject（基准 catch 里 throw error）
    await expect(getSanitizedFilename('')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. script.js：displayVersion 真值 + streamingProcessor 初值语义
// ---------------------------------------------------------------------------

describe('script.js —— 版本真值 + 基准初值语义', () => {
  it('displayVersion 取真实 /version 拼成（基准 script.js:506 同形）', async () => {
    const { calls } = stubFetch({ pkgVersion: '1.18.0' })
    const mod = await loadModule(FILES.script)
    await (mod.versionReady as Promise<unknown>)
    expect(calls.some(u => u.endsWith('/version'))).toBe(true)
    expect(mod.displayVersion).toBe('SillyTavern 1.18.0')
  })

  it('基准 :510：有 gitBranch/gitRevision 才追加（我方 /version 两者为 null → 不追加）', async () => {
    stubFetch({ pkgVersion: '1.18.0', gitBranch: null, gitRevision: null })
    const mod = await loadModule(FILES.script)
    await (mod.versionReady as Promise<unknown>)
    expect(mod.displayVersion).toBe('SillyTavern 1.18.0')
  })

  it('/version 失败：displayVersion 保持初值且**出声**（不静默）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(globalThis as { fetch: unknown }).fetch = vi.fn(async () => {
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
    })
    const mod = await loadModule(FILES.script)
    await (mod.versionReady as Promise<unknown>)
    expect(mod.displayVersion).toBe('SillyTavern')       // 基准 :422 初值
    expect(warn).toHaveBeenCalled()
  })

  it('streamingProcessor = null（基准 script.js:455 逐字同值）——不得伪造处理器', async () => {
    stubFetch()
    const mod = await loadModule(FILES.script)
    expect(mod.streamingProcessor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. openai.js：Message / MessageCollection 的真语义（卡的 instanceof 依赖它）
// ---------------------------------------------------------------------------

describe('scripts/openai.js —— Message / MessageCollection（卡的 instanceof 与 getChat 依赖）', () => {
  it('MessageCollection 拒绝非法成员（基准 :3724-3726 逐字同款，不静默吞）', async () => {
    stubFetch()
    const { MessageCollection } = await loadModule(FILES.openai) as {
      MessageCollection: new (id: string, ...items: unknown[]) => unknown
    }
    expect(() => new MessageCollection('c', { role: 'system' })).toThrow(
      'Only Message and MessageCollection instances can be added to MessageCollection',
    )
  })

  it('instanceof 判定成立（卡的 `item instanceof SPresetImports.Message` 依赖它）', async () => {
    stubFetch()
    const mod = await loadModule(FILES.openai) as {
      Message: new (r: string, c: string, i: string) => unknown
      MessageCollection: new (id: string, ...items: unknown[]) => { collection: unknown[] }
    }
    const m = new mod.Message('system', 'hi', 'main')
    const c = new mod.MessageCollection('root', m)
    expect(m instanceof mod.Message).toBe(true)
    expect(c instanceof mod.MessageCollection).toBe(true)
    expect(c.collection).toHaveLength(1)
  })

  it('getChat() 归并语义（基准 :3737）：空 content 且无 tool_calls 的条目被跳过；tool 席位补 tool_call_id', async () => {
    stubFetch()
    const mod = await loadModule(FILES.openai) as {
      Message: new (r: string, c: string, i: string) => { name?: string; tool_calls?: unknown[] }
      MessageCollection: new (id: string, ...items: unknown[]) => { getChat: () => Array<Record<string, unknown>> }
    }
    const sys = new mod.Message('system', 'S', 'a')
    sys.name = 'n'
    const empty = new mod.Message('system', '', 'b')          // 空且无 tool_calls → 跳过
    const tool = new mod.Message('tool', 'T', 'call-1')
    const col = new mod.MessageCollection('root', sys, empty, tool)
    const chat = col.getChat()
    expect(chat).toHaveLength(2)
    expect(chat[0]).toEqual({ role: 'system', content: 'S', name: 'n' })
    // tool 席位：基准 `...(message.role === 'tool' && { tool_call_id: message.identifier })`
    expect(chat[1]).toEqual({ role: 'tool', content: 'T', tool_call_id: 'call-1' })
  })

  it('getItemByIdentifier / hasItemWithIdentifier（基准 :3775/:3784）', async () => {
    stubFetch()
    const mod = await loadModule(FILES.openai) as {
      Message: new (r: string, c: string, i: string) => unknown
      MessageCollection: new (id: string, ...items: unknown[]) => {
        getItemByIdentifier: (i: string) => { identifier?: string } | undefined
        hasItemWithIdentifier: (i: string) => boolean
      }
    }
    const col = new mod.MessageCollection('root', new mod.Message('system', 'x', 'k1'))
    expect(col.getItemByIdentifier('k1')?.identifier).toBe('k1')
    expect(col.getItemByIdentifier('nope')).toBeUndefined()
    expect(col.hasItemWithIdentifier('k1')).toBe(true)
    expect(col.hasItemWithIdentifier('nope')).toBe(false)
  })

  it('sendOpenAIRequest **必须 reject 且具名**（不得返回假值 = 假成功）', async () => {
    stubFetch()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sendOpenAIRequest } = await loadModule(FILES.openai) as {
      sendOpenAIRequest: (t: unknown, m: unknown, s: unknown, o: unknown) => Promise<unknown>
    }
    await expect(sendOpenAIRequest('normal', [], undefined, {})).rejects.toThrow(/sendOpenAIRequest 在本项目不可用/)
    expect(warn).toHaveBeenCalled()
  })

  it('promptManager.messages 由真实预设投影装配（读侧忠实）', async () => {
    stubFetch()
    const mod = await loadModule(FILES.openai) as {
      promptManager: { loadMessages: () => Promise<{ collection: Array<{ identifier?: string }> }>; activePreset?: string }
    }
    const msgs = await mod.promptManager.loadMessages()
    expect(msgs.collection.map(m => m.identifier)).toEqual(['main', 'chatHistory'])
    expect(mod.promptManager.activePreset).toBe('测试预设')
  })

  // 【T-63 / D-67-1 语义变更】旧断言 = 「setChatCompletion 出声声明"写侧钩子不影响最终请求"」
  //（A 方案：不建通道、显式声明边界）。2026-09-12 拍板改为**建通道**，故该边界消失：
  // 写侧改写经 `prompt-bridge` 真的会进最终请求。现在钉的是**新的可观测契约**：
  // patch 这两个方法 = 声明写侧兴趣（零误报的开关），且 setter 不吞掉函数、不抛错。
  it('promptManager 的写侧方法可被 patch，且 patch 不改变读回值（访问器语义）', async () => {
    stubFetch()
    const mod = await loadModule(FILES.openai) as {
      promptManager: {
        preparePrompt: (p: unknown, o?: unknown) => unknown
        setChatCompletion: (c: unknown) => unknown
      }
    }
    // 默认实现：preparePrompt 原样返回入参（不抛、不改）
    const probe = { role: 'system', content: 'x', identifier: 'a' }
    expect(mod.promptManager.preparePrompt(probe, null)).toBe(probe)

    // patch 后读回的必须是**卡装的那个函数**（否则卡的 patch 静默丢失 —— 本项目最忌的失败形态）
    const patched = (p: unknown): unknown => ({ ...(p as object), touched: true })
    mod.promptManager.preparePrompt = patched
    expect(mod.promptManager.preparePrompt).toBe(patched)

    const patchedSet = (): unknown => 'ok'
    mod.promptManager.setChatCompletion = patchedSet
    expect(mod.promptManager.setChatCompletion).toBe(patchedSet)
  })
})

// ---------------------------------------------------------------------------
// 5. preset-manager.js：getPresetManager 契约
// ---------------------------------------------------------------------------

describe('scripts/preset-manager.js —— getPresetManager 契约', () => {
  it('同一 apiId 恒返回同一实例（基准 :83 记忆化语义）', async () => {
    stubFetch()
    const { getPresetManager } = await loadModule(FILES.presetManager) as {
      getPresetManager: (apiId?: string) => unknown
    }
    expect(getPresetManager('openai')).toBe(getPresetManager('openai'))
  })

  it("非 'openai' 的 apiId 返回 undefined（基准只对已注册 api 返回 manager）", async () => {
    stubFetch()
    const { getPresetManager } = await loadModule(FILES.presetManager) as {
      getPresetManager: (apiId?: string) => unknown
    }
    expect(getPresetManager('kobold')).toBeUndefined()
    expect(getPresetManager('')).toBeUndefined()
  })

  it('卡的取用面方法齐备（getCompletionPresetByName / getAllPresets / getSelectedPresetName / savePreset / deletePreset / updateList）', async () => {
    stubFetch()
    const { getPresetManager } = await loadModule(FILES.presetManager) as {
      getPresetManager: (apiId: string) => Record<string, unknown>
    }
    const m = getPresetManager('openai')
    for (const fn of [
      'getCompletionPresetByName', 'getAllPresets', 'getSelectedPresetName',
      'getSelectedPreset', 'savePreset', 'deletePreset', 'updateList',
    ]) {
      expect(typeof m[fn], `PresetManager 缺 ${fn}`).toBe('function')
    }
  })

  it('取不到预设时不抛、返回 null（卡的调用点带 `?.`；抛错会打断其 await 链）', async () => {
    stubFetch()
    const { getPresetManager } = await loadModule(FILES.presetManager) as {
      getPresetManager: (apiId: string) => { getCompletionPresetByName: (n: string) => Promise<unknown> }
    }
    await expect(getPresetManager('openai').getCompletionPresetByName('不存在')).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. 路由接线断言（静态）—— 防"资产在包里但没人提供端点"这类空防线
// ---------------------------------------------------------------------------

describe('T-63 接线断言：四个 ST 标准路径必须真的注册（静态，防空防线）', () => {
  /** 取 `index.ts` 里 ST 模块注册块（从 `ST_MODULE_ASSETS` 起到该段结束） */
  function srcOfStModules(): string {
    const src = readFileSync(path.resolve(import.meta.dirname, '../src/dsh-plugin/index.ts'), 'utf8')
    const start = src.indexOf('const ST_MODULE_ASSETS')
    // 该段结束 = 紧随其后的 console.log 行之后（注册块在同一作用域内连续书写）
    const endMark = "ST compat modules on webServer"
    const end = src.indexOf(endMark, start)
    return end > start ? src.slice(start, end) : src.slice(start)
  }
  const SRC = readFileSync(path.resolve(import.meta.dirname, '../src/dsh-plugin/index.ts'), 'utf8')

  it('index.ts 注册了四个 ST 标准模块路径', () => {
    for (const p of ['/script.js', '/scripts/utils.js', '/scripts/preset-manager.js', '/scripts/openai.js']) {
      expect(SRC, `index.ts 未注册 ${p}`).toContain(`['${p}'`)
    }
  })

  it('资产缺失时返回**真 404**（不得返回空壳模块）', () => {
    const seg = srcOfStModules()
    expect(seg).toContain('404')
    // 反向：404 分支只能 end 错误注释，**不得**在 null 分支里 writeHead(200)
    const nullBranch = seg.slice(seg.indexOf('if (body === null)'), seg.indexOf('// ES module 必须给 JS MIME'))
    expect(nullBranch).toContain('404')
    expect(nullBranch).not.toContain('200')
  })

  it('ES module 必须给 JS MIME（否则浏览器拒绝执行）', () => {
    expect(srcOfStModules()).toContain('text/javascript')
  })

  it('构建脚本 build-wb.sh 会同步 assets 树且有 A13 断言（防资产不进包）', () => {
    // 相对 tests/ → packages/ → rp-workspace/scripts/build-wb.sh
    const sh = readFileSync(path.resolve(import.meta.dirname, '../../scripts/build-wb.sh'), 'utf8')
    expect(sh).toContain('[A13]')
    expect(sh).toContain('st-modules/script.js')
  })
})
