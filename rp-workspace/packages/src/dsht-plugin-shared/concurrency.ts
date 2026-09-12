/**
 * 有界并发映射（T-70 · 心跳 63D）
 * ============================================================================
 * 【为什么需要它】`/rp/sessions-audit` 原实现**逐个会话串行**读日志
 *（`dsh-plugin/index.ts` 的 `collectSessionsAudit`），设备实测暖态 **6.4 s** / 冷态 **48 s**
 *（81 个会话、合计约 242 MB，最大单会话 104,794 事件）。每个会话的处理彼此**完全独立**
 * ⇒ 天然可并行，原实现只是在排队。
 *
 * ⚠️ **定位纠正（心跳 63D 实测）**：本文件初版把根因写成「I/O = O(全部字节) 且一次只有一个流在跑」，
 * 这是**不准确的**。实测证据：
 *   · 设备裸磁盘读 65 MB 仅 **65 ms**（≈1 GB/s）⇒ **I/O 带宽根本不是瓶颈**
 *   · 宿主上同一份文件：现行 `readline` 逐行 **442 ms** vs 字节扫描 **21 ms**（62.3 MB，**20.9×**）
 * ⇒ 真瓶颈是**单线程 CPU 在逐行字符串化**。因此**只加并发收效有限**：实测仅 1.4×（6.4 → 5.3 s），
 *   因为单线程 JS 里并发不产生 CPU 并行，只重叠 I/O 等待。
 *   **主修复是换算法**（`jsonl-scan.ts` 的 `scanJsonlEdges`），本原语是**叠加**收益
 *   （让多个会话的读同时挂起，冷态 I/O 延迟仍可被重叠）。
 *   教训：**优化前先量「瓶颈在哪一类资源」**，否则会把 I/O 当 CPU、把并行当提速。
 *
 * 【为什么不加缓存/索引】会话写入虽是 append，但修复器会**整体重写**文件
 *（心跳 53 的 `fixPruneSurfaceSpans` 即如此），任何 `(size, mtime)` 水位都可能把"慢"
 * 换成**静默陈旧**（本项目主力缺陷族）。并发化则是**纯并行**：同一个读法、同一份输出。
 *
 * 【语义契约（被单测逐条钉住）】
 *  1. **结果顺序 == 输入顺序**（按下标回填，不按完成先后）——调用方可能依赖稳定顺序
 *     （`sessions-autoclean` 的 dryRun targets 直接展示给用户）。
 *  2. **同时在跑的任务数 ≤ limit**（有界，避免同时打开过多 fd / 打满 I/O）。
 *  3. **单个任务抛错不中断其余**：该槽为 `null`，其余照常（= 原实现里 `catch { continue }`）。
 *     抛错通过 `onError` 上报（L42：有意跳过 ≠ 可以静默）。
 *  4. 空输入返回 `[]`；`limit` 非法（0/NaN/负数/小数）时收敛到 ≥1。
 */

/** 并发上限的默认值：8 个流同时读，足以打满手机 I/O 又不会耗尽 fd */
export const DEFAULT_MAP_CONCURRENCY = 8

export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R | null>,
  onError?: (err: unknown, index: number) => void,
): Promise<Array<R | null>> {
  const n = items.length
  if (n === 0) return []
  const width = Math.min(n, Math.max(1, Math.floor(limit) || 1))
  const results: Array<R | null> = new Array(n).fill(null)
  let cursor = 0
  await Promise.all(Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= n) return
      try {
        results[index] = await worker(items[index] as T, index)
      } catch (err) {
        results[index] = null
        if (onError !== undefined) onError(err, index)
      }
    }
  }))
  return results
}
