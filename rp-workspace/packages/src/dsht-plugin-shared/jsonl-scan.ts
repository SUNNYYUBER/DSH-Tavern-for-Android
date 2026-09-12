/**
 * jsonl-scan.ts — JSONL 会话日志的「边缘信息」扫描原语（T-70 性能根因修复 · 心跳 63D）
 * ============================================================================
 * 【为什么需要它】`/rp/sessions-audit` 只需要每个会话的**三样东西**：
 *   ① 首非空行（header）② 非空行数 ③ 末非空行的 `.time`
 * 原实现用 `node:readline` 的 `for await (const row of rl)` 逐行迭代并 `count++` ——
 * **为了拿到一个行数，把文件全部字节逐行字符串化**（100k+ 次字符串分配 + 100k+ 次
 * async 迭代 await）。设备上 81 个会话 / 约 242 MB ⇒ 暖态 **6.4 s**。
 *
 * 【根因是 CPU，不是 I/O —— 这一点决定了修复方向】心跳 63D 实测（同一份真实会话文件）：
 *   · 设备裸磁盘读：65 MB / **65 ms**（≈1 GB/s）⇒ I/O 完全不是瓶颈
 *   · 宿主 A 法（现行 readline）：62.3 MB → **442 ms**；26.4 MB → **142 ms**
 *   · 宿主 B 法（本文件实现）  ：62.3 MB →  **21 ms**；26.4 MB →  **17 ms**  ⇒ **8–21×**
 * 因此「只把串行读改成并行读」（`mapBounded`）**必然收效有限**（实测仅 1.4×）——
 * 单线程 JS 里并发不产生 CPU 并行，只重叠 I/O 等待。**换算法才是主修复**，并发是次要叠加。
 *
 * 【实现要点（性能关键，别改回 async）】主循环**必须同步**。本轮第一版把 `handleRow` 写成
 * `async`、在 `for await`/`while` 里逐行 `await` —— 于是**每一行**都产生一个 Promise + 一次
 * microtask 排队。宿主实测（79.3 MB / **314,383 行**，与设备形态同量级）：async 版 **119 ms**，
 * 同步版 **~32 ms**（**3.7×**）。⚠️ 注意这与「换掉 readline」是**两件事**：
 * 换 readline 解决的是"把全部字节变成字符串"（8–21×，在**行长很大**的语料上最明显），
 * 同步化解决的是"每行一次 Promise"（在**行数很多**的语料上最明显）——
 * 设备真实语料恰好是**后者**（311,484 行 / 242 MB）⇒ 两个都要做。
 * 做法：绝大多数行以 `{` 开头，一次字节比较即可定论 ⇒ 同步判完；只有"行首字节不是 JSON 起始符"
 * 的行才进 `slowRows` 队列，循环结束后统一做精确 `trim()` 判定。
 *
 * 【为什么不做缓存/索引】会话写入虽是 append，但修复器会**整体重写**文件
 *（心跳 53 的 `fixPruneSurfaceSpans` 即如此），任何 `(size, mtime)` 水位都可能把"慢"
 * 换成**静默陈旧**（本项目主力缺陷族，见 T-70 正文）。本文件是**纯算法替换**：
 * 同样的输入、同样的输出，只是不再把每个字节变成字符串。
 *
 * 【语义契约 —— 与旧 readline 实现**逐字同口径**，被单测逐条钉住】
 *   1. `lines`   = 「**非空行数** - 1」，且下限为 0。非空行的判据与 `String.prototype.trim()`
 *      等价（`row.trim() === ''` 的行不计入）—— 包括 `\r`、U+00A0 等 Unicode 空白。
 *   2. `header`  = 首非空行 `JSON.parse` 的结果；该行解析失败（或文件无非空行）时返回 `{}`。
 *   3. `lastTime`= 末非空行解析出的 `.time`，经 `Number(v ?? 0) || null`；失败/缺失/为 0 ⇒ `null`。
 *   4. 行分隔只认 `LF`。`CRLF` 的尾部 `\r` 被剥离（与 readline 的 `crlfDelay: Infinity` 同效）。
 *   5. 末行**不带换行符**时同样计入（与 `readline` 的 `crlfDelay` 行为一致）。
 *
 * 【为什么需要「慢路径」】绝大多数 JSON 行以 `{` / `[` 起始 ⇒ 一次字节比较即可判定非空（O(1)）。
 * 只有行首字节**不是** JSON 起始符时，才回读该行做真正的 `trim()` 判定 —— 这条慢路径的存在
 * 是为了让「非空行」判据与 `trim()` **严格等价**（例如只含 U+00A0 的行，靠 ASCII 字节判会误判）。
 */

import { open } from 'node:fs/promises'

/** 单次预读块大小：1 MiB 在「syscall 次数」与「内存峰值」之间取平衡 */
const CHUNK = 1 << 20

/** 扫描结果（会话审计只需要这三样；完整解析留给真正的读取方） */
export interface JsonlEdges {
  /** 非空行数 - 1（下限 0）。与旧 `readline` 实现的 `lines` 逐字同值。 */
  lines: number
  /** 首非空行 `JSON.parse` 结果；解析失败或不存在时为 `{}`。 */
  header: Record<string, unknown>
  /** 末非空行的 `.time`（`Number(v ?? 0) || null`）；失败/缺失/为 0 时为 `null`。 */
  lastTime: number | null
}

/**
 * 字节是否可能作为「非空白行」的起始。
 * 取 JSON 值合法起始符的超集：`{` `[` `"` `-` 数字 `t`(true) `f`(false) `n`(null)。
 * 命中即**必定非空**（这些字符不属于任何 Unicode 空白），可跳过慢路径。
 */
function startsJsonValue(b: number): boolean {
  return b === 0x7b /* { */ || b === 0x5b /* [ */ || b === 0x22 /* " */ ||
    b === 0x2d /* - */ || (b >= 0x30 && b <= 0x39) /* 0-9 */ ||
    b === 0x74 /* t */ || b === 0x66 /* f */ || b === 0x6e /* n */
}

/** 剥离行尾的 `\r`（`CRLF` 文件的读法对齐 readline 的 `crlfDelay: Infinity`） */
function stripCr(buf: Buffer): Buffer {
  return buf.length > 0 && buf[buf.length - 1] === 0x0d ? buf.subarray(0, buf.length - 1) : buf
}

/**
 * 扫描一个 JSONL 文件，取出 `lines` / `header` / `lastTime`。
 *
 * 内存恒定：只持有 `CHUNK` 大小的预读块 + 首/末两个**行区间**的字节（不是整个文件）。
 * 读取失败（文件不存在、权限、I/O 错误）会**抛出**，由调用方决定语义
 *（`collectSessionsAudit` 保留原「该会话本次不计入」语义，但会出声告警）。
 */
export async function scanJsonlEdges(filePath: string): Promise<JsonlEdges> {
  const fh = await open(filePath, 'r')
  try {
    const { size } = await fh.stat()
    const chunk = Buffer.allocUnsafe(CHUNK)

    let nonBlank = 0                                   // 非空行数
    let firstIndex = -1                                // 首个非空行的**行序号**（-1 = 还没有）
    let firstRange: readonly [number, number] | null = null
    let lastIndex = -1                                 // 末个非空行的行序号
    let lastRange: readonly [number, number] | null = null
    let rowIndex = 0                                   // 行序号（每遇到一个 '\n' 或 EOF 末行 +1）
    let rowStart = 0                                   // 当前行的**文件内**起始偏移
    let pos = 0                                        // 当前块的文件内起始偏移
    let chunkLen = 0                                   // 当前块**有效**字节数（`chunk` 是复用的，尾部是上次残留）
    /**
     * 慢路径候选队列。**这一层是性能的关键**：主循环必须**同步**跑完 ——
     * 初版把 `handleRow`/`isNonBlankRow` 写成 `async`，于是**每一行**都产生一个 Promise + 一次
     * microtask 排队；设备语料有 **311,484 行** ⇒ 宿主实测（79.3 MB / 314,383 行）真实实现
     * **119 ms**，而**同步**写法只需 **~32 ms**。绝大多数行以 `{` 开头，一次字节比较就能定论，
     * 完全不需要进队列；只有"行首字节不是 JSON 起始符"（疑似整行空白）才留到循环后精确判定。
     */
    const slowRows: Array<{ i: number; from: number; to: number }> = []

    /** 读取 [from, to) 的精确字节（用于两端的行内容 + 慢路径判定） */
    const readRange = async (from: number, to: number): Promise<Buffer> => {
      const len = to - from
      if (len <= 0) return Buffer.alloc(0)
      const b = Buffer.allocUnsafe(len)
      let got = 0
      while (got < len) {
        const { bytesRead } = await fh.read(b, got, len - got, from + got)
        if (bytesRead <= 0) break
        got += bytesRead
      }
      return got === len ? b : b.subarray(0, got)
    }

    /**
     * **同步**快速判定：`true` = 确定非空 / `false` = 确定是空行（长度为 0）/ `null` = 需慢路径。
     * 与 `String.prototype.trim() !== ''` 严格等价 —— `startsJsonValue` 命中的字节都属于
     * **非空白**字符，故命中即可定论；未命中一律交给慢路径，绝不在这里猜。
     */
    const classifyFast = (from: number, to: number): boolean | null => {
      if (to <= from) return false                     // 长度为 0 的行
      const localFrom = from - pos                     // 行首字节落在当前块**有效区**内才可快速判定
      if (localFrom >= 0 && localFrom < chunkLen) {
        if (startsJsonValue(chunk[localFrom] as number)) return true
      }
      return null
    }

    /** 记账一个**已判定为非空**的行 */
    const record = (i: number, from: number, to: number): void => {
      nonBlank++
      if (firstIndex === -1) { firstIndex = i; firstRange = [from, to] as const }
      lastIndex = i; lastRange = [from, to] as const
    }

    /** 处理一个完整行 [from, to)（`to` 为该行后第一个 `\n` 的位置，或 EOF）—— **同步** */
    const handleRow = (from: number, to: number): void => {
      const i = rowIndex++
      const fast = classifyFast(from, to)
      if (fast === true) record(i, from, to)
      else if (fast === null) slowRows.push({ i, from, to })
      // fast === false ⇒ 空行，不计入
    }

    while (pos < size) {
      const want = Math.min(CHUNK, size - pos)
      const { bytesRead } = await fh.read(chunk, 0, want, pos)
      if (bytesRead <= 0) break
      chunkLen = bytesRead
      // 只在**有效区**内找换行：`chunk` 是复用的，其尾部可能残留上一次读入的字节。
      // ⚠️ 内层**全同步**（不 await）—— 这是本文件性能的关键，见 `slowRows` 的注释。
      const view = chunk.subarray(0, bytesRead)
      let idx = view.indexOf(0x0a)
      while (idx !== -1) {
        handleRow(rowStart, pos + idx)
        rowStart = pos + idx + 1
        idx = view.indexOf(0x0a, idx + 1)
      }
      pos += bytesRead
    }
    // 末行不带换行符：区间为 [rowStart, EOF)
    if (rowStart < size) handleRow(rowStart, size)
    // `rowStart === size` ⇒ 文件以 '\n' 结尾，没有额外的末行（与 readline 一致）

    // 慢路径（通常为空）：只对"行首字节不是 JSON 起始符"的行做真正的 `trim()` 判定。
    // 与旧实现 `row.trim() === ''` 同语义，覆盖 U+00A0 / U+3000 / BOM 等非 ASCII 空白。
    for (const s of slowRows) {
      const row = (await readRange(s.from, s.to)).toString('utf8')
      if (row.trim() === '') continue
      nonBlank++
      // 行序号 `s.i` 在扫描时递增 ⇒ 与外层同步判定用同一套「首/末」比较即可保持语义
      if (firstIndex === -1 || s.i < firstIndex) { firstIndex = s.i; firstRange = [s.from, s.to] as const }
      if (s.i > lastIndex) { lastIndex = s.i; lastRange = [s.from, s.to] as const }
    }

    const header: Record<string, unknown> = {}
    if (firstRange !== null) {
      try {
        const parsed = JSON.parse(stripCr(await readRange(firstRange[0], firstRange[1])).toString('utf8'))
        if (parsed !== null && typeof parsed === 'object') {
          Object.assign(header, parsed as Record<string, unknown>)
        }
      } catch { /* 坏行忽略（与旧实现同） */ }
    }

    let lastTime: number | null = null
    if (lastRange !== null) {
      try {
        const parsed = JSON.parse(stripCr(await readRange(lastRange[0], lastRange[1])).toString('utf8')) as { time?: unknown }
        lastTime = Number(parsed.time ?? 0) || null
      } catch { /* 无 time（与旧实现同） */ }
    }

    return { lines: Math.max(0, nonBlank - 1), header, lastTime }
  } finally {
    await fh.close()
  }
}

/**
 * 单测对拍用的**参考实现**：与 `collectSessionsAudit` 改造前**逐字相同**的 readline 读法。
 * 只存在于导出面是为了让「新旧等价」成为可执行的判据（而不是靠人读代码相信）。
 * 生产代码**不应**调用它（它是被替换掉的那条慢路径）。
 */
export async function scanJsonlEdgesReference(filePath: string): Promise<JsonlEdges> {
  const { createReadStream } = await import('node:fs')
  const { createInterface } = await import('node:readline')
  let count = 0
  let firstRow = ''
  let lastRow = ''
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const row of rl) {
    if (row.trim() === '') continue
    if (count === 0) firstRow = row
    lastRow = row
    count++
  }
  const lines = Math.max(0, count - 1)
  let header: Record<string, unknown> = {}
  let lastTime: number | null = null
  try { header = JSON.parse(firstRow) as Record<string, unknown> } catch { /* 坏行忽略 */ }
  try { lastTime = Number((JSON.parse(lastRow) as { time?: unknown }).time ?? 0) || null } catch { /* 无 time */ }
  return { lines, header, lastTime }
}
