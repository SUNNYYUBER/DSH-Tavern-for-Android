/**
 * T-20 契约断言测试：正则门面 ↔ 真 TH TavernRegex 形状对齐
 * ============================================================================
 * 准据（唯一权威）：JS-Slash-Runner `@types/function/tavern_regex.d.ts`
 *   D:\SillyTavern-1.16.0\旧sillytavern\Luker-现在在用的版本\data\default-user\extensions\JS-Slash-Runner\@types\function\tavern_regex.d.ts
 *
 * 背景：我方内部存储（engine.ts RegexScript）沿用 ST **磁盘格式**（camelCase + disabled），
 *   而真 TH **公开 API 契约**用 snake_case + enabled（极性相反）。照着磁盘格式做 = 脚本
 *   一个字段都读不到却不报错（COMPAT-AUDIT §1「最危险的字段形状偏差」）。
 *   门面（th-shim.ts）现做双向映射，本文件锁定该映射，防再次漂移。
 *
 * 断言值全部来自上述 d.ts 并标注字段名；改动契约必须同步改本文件。
 */
import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import { buildShimSource } from '../src/dsht-rp-ui/src/client/th-shim.ts'

interface FakeFrame {
  ctx: vm.Context
  posted: Array<Record<string, unknown>>
  handlers: Record<string, Array<(e: unknown) => void>>
  fireHost: (msg: Record<string, unknown>) => void
}

function makeFrame(scriptId: string, secret = 'sec'): FakeFrame {
  const posted: Array<Record<string, unknown>> = []
  const handlers: Record<string, Array<(e: unknown) => void>> = {}
  const sandbox: Record<string, unknown> = {}
  sandbox.window = sandbox
  sandbox.parent = { postMessage: (msg: Record<string, unknown>) => { posted.push(msg) } }
  sandbox.name = scriptId
  sandbox.addEventListener = (type: string, fn: (e: unknown) => void) => {
    ;(handlers[type] ??= []).push(fn)
  }
  sandbox.document = { body: { childElementCount: 0 } }
  sandbox.setTimeout = () => 0
  sandbox.console = console
  const ctx = vm.createContext(sandbox)
  vm.runInContext(buildShimSource({ scriptId, scriptName: scriptId, secret, version: 'test' }), ctx)
  return {
    ctx,
    posted,
    handlers,
    fireHost: (msg) => { for (const fn of handlers.message ?? []) fn({ data: msg }) },
  }
}

function callsOf(f: FakeFrame): Array<{ callId: number; api: string; args: unknown[] }> {
  return f.posted.filter(m => m.th === 'call') as never
}

/** 内部存储形状（engine.ts RegexScript / ST 磁盘格式）——门面的输入源 */
const INTERNAL_REGEX = {
  id: 'r1',
  scriptName: '思维链美化',
  findRegex: '<think>(.*?)</think>',
  replaceString: '<details><summary>思考</summary>$1</details>',
  trimStrings: ['【', '】'],
  placement: [1, 2],
  disabled: false,          // 内部：disabled=false = 启用
  markdownOnly: false,
  promptOnly: true,
  runOnEdit: true,
  substituteRegex: 2,
  minDepth: 0,
  maxDepth: 1,
  _dshtScope: 'global',
}

/** 让 regexes:get 返回给定内部形状列表，并驱动 getTavernRegexes 完成 */
async function fetchRegexes(f: FakeFrame, internalList: unknown[]): Promise<unknown> {
  runScript(f, `window.__r = null; getTavernRegexes({ type: 'global' }).then(v => { window.__r = v });`)
  const call = callsOf(f).at(-1)!
  f.fireHost({ __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'result', callId: call.callId, ok: true, value: { regexes: internalList } })
  await new Promise(r => setImmediate(r))
  return vm.runInContext('window.__r', f.ctx)
}

function runScript(f: FakeFrame, code: string): void {
  vm.runInContext(code, f.ctx)
}

describe('T-20 正则门面契约对齐（准据：tavern_regex.d.ts）', () => {
  it('出口映射：camelCase → snake_case（d.ts TavernRegex 字段名逐项）', async () => {
    const f = makeFrame('s1')
    const out = await fetchRegexes(f, [INTERNAL_REGEX]) as Array<Record<string, unknown>>
    expect(out).toHaveLength(1)
    const r = out[0]!
    // d.ts: id / script_name / find_regex / replace_string / trim_strings / run_on_edit / min_depth / max_depth
    expect(r.id).toBe('r1')
    expect(r.script_name).toBe('思维链美化')
    expect(r.find_regex).toBe('<think>(.*?)</think>')
    expect(r.replace_string).toBe('<details><summary>思考</summary>$1</details>')
    expect(r.trim_strings).toEqual(['【', '】'])
    expect(r.run_on_edit).toBe(true)
    expect(r.min_depth).toBe(0)
    expect(r.max_depth).toBe(1)
  })

  it('enabled 极性反转：内部 disabled=false → 契约 enabled=true（d.ts: enabled 真值=启用）', async () => {
    const f = makeFrame('s1')
    const enabled = await fetchRegexes(f, [INTERNAL_REGEX]) as Array<Record<string, unknown>>
    expect(enabled[0]!.enabled).toBe(true)
    expect(enabled[0]!.disabled).toBeUndefined() // 契约面不暴露 disabled

    const g = makeFrame('s1')
    const disabled = await fetchRegexes(g, [{ ...INTERNAL_REGEX, disabled: true }]) as Array<Record<string, unknown>>
    expect(disabled[0]!.enabled).toBe(false)
  })

  it('source 结构：placement[] → {user_input, ai_output, slash_command, world_info}（d.ts source 四布尔）', async () => {
    const f = makeFrame('s1')
    // placement [1,2] = USER_INPUT + AI_OUTPUT
    const out = await fetchRegexes(f, [INTERNAL_REGEX]) as Array<Record<string, unknown>>
    expect(out[0]!.source).toEqual({ user_input: true, ai_output: true, slash_command: false, world_info: false })
  })

  it('destination 结构：markdownOnly/promptOnly → {display, prompt}（d.ts destination 两布尔）', async () => {
    const f = makeFrame('s1')
    // 内部 promptOnly=true（仅格式提示词）→ 契约 display=false / prompt=true
    const out = await fetchRegexes(f, [INTERNAL_REGEX]) as Array<Record<string, unknown>>
    expect(out[0]!.destination).toEqual({ display: false, prompt: true })
  })

  it('destination 结构（反例）：markdownOnly=true → {display:true, prompt:false}', async () => {
    const f = makeFrame('s1')
    const out = await fetchRegexes(f, [{ ...INTERNAL_REGEX, markdownOnly: true, promptOnly: false }]) as Array<Record<string, unknown>>
    expect(out[0]!.destination).toEqual({ display: true, prompt: false })
  })

  it('入口映射 + enabled 极性反算：契约对象 → 内部形状（写路径）', async () => {
    const f = makeFrame('s1')
    const thShape = [{
      id: 'r9',
      script_name: '舞台少女',
      enabled: true,                        // 契约：启用
      find_regex: 'foo',
      replace_string: 'bar',
      trim_strings: [],
      source: { user_input: true, ai_output: false, slash_command: false, world_info: false },
      destination: { display: true, prompt: true },
      run_on_edit: false,
      min_depth: null,
      max_depth: null,
    }]
    runScript(f, `window.__p = replaceTavernRegexes(${JSON.stringify(thShape)}, { type: 'global' });`)
    const call = callsOf(f).at(-1)!
    expect(call.api).toBe('regexes:replace')
    const sent = (call.args as unknown[])[0] as Array<Record<string, unknown>>
    expect(sent[0]).toMatchObject({
      id: 'r9',
      scriptName: '舞台少女',
      findRegex: 'foo',
      replaceString: 'bar',
      disabled: false,        // enabled=true → disabled=false
      placement: [1],         // user_input=true → placement 含 1
      markdownOnly: false,    // destination.prompt=true → markdownOnly=false
      promptOnly: false,      // destination.display=true → promptOnly=false
    })
  })

  it('N2：未知 option 显式抛错（不再静默降级 global）', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__err = null;
      try { getTavernRegexes({ type: 'scoped', scope: 'character' }); }
      catch (e) { window.__err = e.message; }
    `)
    expect(vm.runInContext('window.__err', f.ctx)).toContain('不支持的 option')
  })

  it('N2：character option 携带快照 slug（真 TH {type:"character"} 语义）', async () => {
    const f = makeFrame('s1')
    f.fireHost({
      __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'context',
      context: { slug: 'wuwa-solaris', messages: [], name1: '漂泊者' },
    })
    runScript(f, `getTavernRegexes({ type: 'character' });`)
    const call = callsOf(f).at(-1)!
    expect(call.api).toBe('regexes:get')
    expect((call.args as unknown[])[0]).toBe('wuwa-solaris')
  })

  it('N3：updateTavernRegexesWith 只写回 option 指定作用域（不牵连其他组）', async () => {
    const f = makeFrame('s1')
    runScript(f, `
      window.__done = false;
      updateTavernRegexesWith(rs => rs.map(r => { r.enabled = true; return r }), { type: 'global' })
        .then(() => { window.__done = true });
    `)
    // 第一次 regexes:get
    const getCall = callsOf(f).at(-1)!
    expect(getCall.api).toBe('regexes:get')
    f.fireHost({
      __dsht_th: true, secret: 'sec', scriptId: 's1', th: 'result', callId: getCall.callId, ok: true,
      value: { regexes: [INTERNAL_REGEX, { ...INTERNAL_REGEX, id: 'r2', _dshtScope: 'character' }] },
    })
    await new Promise(r => setImmediate(r))
    // 写回调用：应只有 global 一个 replace
    const replaces = callsOf(f).filter(c => c.api === 'regexes:replace')
    expect(replaces).toHaveLength(1)
    expect((replaces[0]!.args as unknown[])[1]).toBe('global')
    // 且角色组那条不该被写进 global 桶
    const bucket = (replaces[0]!.args as unknown[])[0] as Array<Record<string, unknown>>
    expect(bucket.every(b => b.id !== 'r2')).toBe(true)
  })

  it('N4：formatAsTavernRegexedString 同步返回 string（真 TH 契约 d.ts: => string）', () => {
    const f = makeFrame('s1')
    runScript(f, `window.__t = typeof formatAsTavernRegexedString('hello', 'ai_output', 'display');`)
    expect(vm.runInContext('window.__t', f.ctx)).toBe('string')
  })

  it('N4：缓存空时 formatAsTavernRegexedString 原样返回（不抛错、不返回 Promise 字面量）', () => {
    const f = makeFrame('s1')
    runScript(f, `window.__s = formatAsTavernRegexedString('原文', 'ai_output', 'display');`)
    expect(vm.runInContext('window.__s', f.ctx)).toBe('原文')
  })

  it('N5：isCharacterTavernRegexesEnabled 返回布尔（d.ts => boolean）', () => {
    const f = makeFrame('s1')
    runScript(f, `window.__b = typeof isCharacterTavernRegexesEnabled();`)
    expect(vm.runInContext('window.__b', f.ctx)).toBe('boolean')
  })

  it('兼容：已是内部形状的对象入口不做二次极性翻转（防 enabled→disabled 又翻回去）', async () => {
    const f = makeFrame('s1')
    runScript(f, `window.__p = replaceTavernRegexes(${JSON.stringify([INTERNAL_REGEX])}, { type: 'global' });`)
    const call = callsOf(f).at(-1)!
    const sent = (call.args as unknown[])[0] as Array<Record<string, unknown>>
    expect(sent[0]).toMatchObject({ scriptName: '思维链美化', disabled: false, placement: [1, 2] })
  })
})
