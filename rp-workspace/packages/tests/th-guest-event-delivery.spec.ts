/**
 * T-82 心跳 74 续：**guest 楼层帧（`.dsht-rp-message-frame`）的事件投递**。
 *
 * 缺陷（实机发现，基准已取证）：`SessionRuntime.emitSessionEvent()` 只遍历 `this.frames`
 * （脚本帧），而 guest 楼层帧在另一个表 `guestFrames` 里 —— 楼层帧内 `eventOn(...)`
 * **注册成功、永不回调**（静默失败）。基准行为：
 *   · `src/iframe/predefine.js` 把 `TavernHelper._bind`（含 `_eventOn`，
 *     `src/function/index.ts:221`）逐项 bind 到 **该 iframe 的 window**；
 *   · 该 predefine 同时注入 `src/panel/script/iframe.ts:12`（脚本帧）**与**
 *     `src/panel/render/iframe.ts:94`（消息渲染帧）⇒ 与帧类型无关；
 *   · `_eventOn` 直接 `eventSource.on(...)`（`src/function/event.ts:44`），共用同一实例。
 *
 * 本文件为**源码级断言**（`RpScriptHost.tsx` 是 React 组件，实例化需整页环境；
 * 与 `th-host-events.spec.ts` 同款手法），锁住四件事：
 *   A. guest 分支存在，且被 `guestReady` 门控（未就绪 ⇒ 入队，不是丢弃）
 *   B. 握手点（guest `{th:'status',phase:'running'}`）标记就绪并补投
 *   C. **承重反控**：事件路径**不得**复用 `pushContextToGuest` 的 4 次重试梯子
 *      —— 快照幂等覆盖，事件**不幂等**（卡按 `MESSAGE_RECEIVED` 计数会翻倍）= L36「不能多」
 *   D. 摘除路径（release / destroy）不留悬挂队列
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = resolve(HERE, '../src/dsht-rp-ui/src/client')
const SRC = readFileSync(join(CLIENT, 'RpScriptHost.tsx'), 'utf8')

/** 按「首个 `{` 配对收尾」抽出方法体（够用于本文件的形状断言；不做完整解析） */
function bodyOf(src: string, signature: string): string {
  const i = src.indexOf(signature)
  if (i < 0) throw new Error(`未找到签名：${signature}`)
  const open = src.indexOf('{', i)
  if (open < 0) throw new Error(`签名后无方法体：${signature}`)
  let depth = 0
  for (let j = open; j < src.length; j++) {
    const c = src[j]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open + 1, j) }
  }
  throw new Error(`方法体未闭合：${signature}`)
}

const emitBody = bodyOf(SRC, 'emitSessionEvent(eventType: string, args: unknown[]): void {')
const flushGuestBody = bodyOf(SRC, 'private flushPendingGuestEvents(scriptId: string): void {')
const releaseBody = bodyOf(SRC, 'releaseGuestFrame(scriptId: string): void {')
const destroyBody = bodyOf(SRC, 'destroy(): void {')
const handleBody = bodyOf(SRC, 'handleMessage(msg: ReturnType<typeof parseIncomingMessage>): void {')
const contextLadderBody = bodyOf(SRC, 'private pushContextToGuest(scriptId: string): void {')

// ---------------------------------------------------------------------------
// A. guest 分支：存在 + 就绪门 + 入队（不丢弃）
// ---------------------------------------------------------------------------

describe('T-82 A · emitSessionEvent 覆盖 guest 楼层帧', () => {
  it('遍历 guestFrames（此前只遍历 frames ⇒ 楼层帧静默收不到）', () => {
    expect(emitBody).toContain('this.guestFrames.keys()')
  })

  it('发的是 th:"event" 且载荷与脚本帧同形（eventType/args/secret/scriptId）', () => {
    const guestPart = emitBody.slice(emitBody.indexOf('this.guestFrames.keys()'))
    expect(guestPart).toContain("th: 'event'")
    expect(guestPart).toContain('eventType, args')
    expect(guestPart).toContain('secret: this.secret')
  })

  it('未就绪 ⇒ 入队 pendingGuestEvents（不是直接投、也不是丢弃）', () => {
    expect(emitBody).toContain('this.guestReady.has(scriptId)')
    expect(emitBody).toContain('this.pendingGuestEvents.set(scriptId, q)')
  })

  it('队列上限 50 —— 与脚本帧 pendingEvents 同口径（防永不就绪的帧撑爆内存）', () => {
    // 脚本帧分支与 guest 分支各出现一次 `< 50`
    expect(emitBody.split('< 50').length - 1).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// B. 握手点：guest running 信标 ⇒ 标记就绪 + 补投
// ---------------------------------------------------------------------------

describe('T-82 B · 就绪握手与补投', () => {
  it('handleMessage 在 guest running 信标处标记就绪', () => {
    expect(handleBody).toContain('this.guestReady.add(msg.scriptId)')
  })

  it('同一处补投积压（否则队列只进不出 = 换一种静默失败）', () => {
    expect(handleBody).toContain('this.flushPendingGuestEvents(msg.scriptId)')
  })

  it('同一处仍保留原有的快照补推（T-82 不得顶掉既有 P3a 逻辑）', () => {
    expect(handleBody).toContain('this.pushContextToGuest(msg.scriptId)')
  })

  it('flushPendingGuestEvents 投递 th:"event" 且投后清队列（幂等：不会二次补投）', () => {
    expect(flushGuestBody).toContain("th: 'event'")
    expect(flushGuestBody).toContain('this.pendingGuestEvents.delete(scriptId)')
  })
})

// ---------------------------------------------------------------------------
// C. 承重反控：事件路径**不得**复用幂等快照的 4 次重试梯子
// ---------------------------------------------------------------------------

describe('T-82 C · 承重反控：事件不幂等 ⇒ 禁止重试梯子', () => {
  it('正控：pushContextToGuest 确实用 0/400/1200/2800 梯子（对照组成立）', () => {
    expect(contextLadderBody).toContain('[0, 400, 1200, 2800]')
    expect(contextLadderBody).toContain('setTimeout')
  })

  it('emitSessionEvent 内**无** setTimeout / 延迟梯子（有则一条事件会投多次）', () => {
    expect(emitBody).not.toContain('setTimeout')
    expect(emitBody).not.toContain('[0, 400')
  })

  it('flushPendingGuestEvents 内同样无重试梯子（补投是"一次性排空"）', () => {
    expect(flushGuestBody).not.toContain('setTimeout')
    expect(flushGuestBody).not.toContain('[0, 400')
  })
})

// ---------------------------------------------------------------------------
// D. 摘除路径不留悬挂
// ---------------------------------------------------------------------------

describe('T-82 D · 摘除/销毁清理', () => {
  it('releaseGuestFrame 同时摘路由 + 就绪标记 + 待投队列', () => {
    expect(releaseBody).toContain('this.guestFrames.delete(scriptId)')
    expect(releaseBody).toContain('this.guestReady.delete(scriptId)')
    expect(releaseBody).toContain('this.pendingGuestEvents.delete(scriptId)')
  })

  it('destroy 清掉两张 guest 表（否则重挂后沿用旧就绪态 = 把未就绪帧当就绪投）', () => {
    expect(destroyBody).toContain('this.guestReady.clear()')
    expect(destroyBody).toContain('this.pendingGuestEvents.clear()')
  })
})
