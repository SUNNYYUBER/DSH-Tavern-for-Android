/**
 * 任务 C1：迁移验收面板（RpOverlay「导入」tab 顶部，大白话，非技术语言）。
 *
 * 用户原话：「没办法确认插件和世界书的导入是否成功、适配后的插件是否实际生效」。
 * 四块内容：
 * 1. 数据源批次（最近一批 manifest：卡/书/聊天/预设数量，/rp/status 聚合）
 * 2. 迁移结果计数（最新 migration-report.md 资源清单表，/rp/status 解析）
 * 3. 三个预适配插件功能自检（批次修复 11：ping 升级为真实写读/渲染断言，
 *    ✅ 功能正常 / ⚠️ 在线但功能异常 / ❌ 未响应 三态）
 * 4. API 连接状态（provider 名 + 模型）
 */
import { useCallback, useEffect, useState } from 'react'
import { rpApi } from './rpc.ts'
import { PROBES, type ProbeState } from './probes.ts'

// 兼容旧 import 路径（PluginCards 等复用同一份清单）
export { PROBES, type ProbeState } from './probes.ts'

interface StatusBatch {
  batchId: string
  name: string
  stagedAt: string | null
  manifest: { kind?: string; cards?: number; books?: number; chats?: number; presets?: number } | null
  hasReport: boolean
  report: Array<{ category: string; total: number; ok: number; fail: number }> | null
}

export function MigrationStatusPanel(): JSX.Element {
  const [batch, setBatch] = useState<StatusBatch | null>(null)
  const [api, setApi] = useState<{ provider: string; model: string } | null>(null)
  const [probeResults, setProbeResults] = useState<ProbeState[] | null>(null)
  const [buildInfo, setBuildInfo] = useState<{ sentinel: string | null; dshVersion: string | null } | null>(null)
  const [buildInfoError, setBuildInfoError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      const r = await rpApi<{ latestBatch: StatusBatch | null; api: { provider: string; model: string } | null }>('rp/status')
      setBatch(r.latestBatch ?? null)
      setApi(r.api ?? null)
    } catch (e) {
      setLoadError(`状态读取失败：${(e as Error).message}`)
    }
    // 构建版本（2026-09-08）：sentinel = APK 解压哨兵（.installed-v176），一眼对出新旧包
    // 【2026-09-11 心跳 46】原为 `.catch(() => setBuildInfo(null))` —— 把失败**静默**吞成
    // "没有构建信息"，导致「前端 POST、后端只认 GET」的恒 404 缺陷整整三天无人察觉。
    // 现改为把错误如实记录并在面板显示（失败必须可见，这是本项目对静默失败的一贯处置）。
    void rpApi<{ sentinel: string | null; dshVersion: string | null }>('rp/build-info')
      .then(b => { setBuildInfo(b); setBuildInfoError('') })
      .catch((e: Error) => { setBuildInfo(null); setBuildInfoError(`构建信息读取失败：${e.message}`) })
    // 插件自检独立结算，单个失败不影响其它（三态：ping 挂=未响应；ping 活但
    // 功能断言失败=在线但功能异常；功能断言过=功能正常）
    const results = await Promise.all(PROBES.map(async (p): Promise<ProbeState> => {
      try {
        if (!(await p.ping())) return 'down'
        return (await p.selftest()) ? 'ok' : 'degraded'
      } catch {
        return 'down'
      }
    }))
    setProbeResults(results)
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const m = batch?.manifest ?? null
  const manifestBits: string[] = []
  if (m) {
    if (typeof m.cards === 'number' && m.cards > 0) manifestBits.push(`角色卡 ${m.cards}`)
    if (typeof m.books === 'number' && m.books > 0) manifestBits.push(`世界书 ${m.books}`)
    if (typeof m.chats === 'number' && m.chats > 0) manifestBits.push(`聊天 ${m.chats}`)
    if (typeof m.presets === 'number' && m.presets > 0) manifestBits.push(`预设 ${m.presets}`)
  }

  // 摘要行（折叠时可见）：四态计数 + API 状态 + 构建哨兵 —— 一眼看出有没有异常/新旧包
  const okCount = probeResults?.filter(r => r === 'ok').length ?? 0
  const badCount = probeResults?.filter(r => r !== 'ok').length ?? null
  const summaryBits: string[] = []
  summaryBits.push(api === null ? 'API 未配置' : `API ✓`)
  if (buildInfo?.sentinel) summaryBits.push(buildInfo.sentinel.replace('.installed-', '构建 '))
  if (probeResults !== null) summaryBits.push(`插件 ${okCount}/${PROBES.length} 正常${badCount !== null && badCount > 0 ? `（${badCount} 项异常）` : ''}`)

  // 折叠用 React 受控状态而非 <details>：部分 WebView（卓易通真机）details 原生
  // 折叠失效（裸 details 实测 open=false 内容照常渲染）——条件渲染保证收起即不占位
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="dsht-rp-section dsht-rp-verification dsht-rp-fold">
      <div
        className="dsht-rp-fold-summary-row"
        role="button"
        tabIndex={0}
        onClick={() => { setExpanded(v => !v) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}
      >
        <span className={'dsht-rp-fold-arrow' + (expanded ? ' open' : '')}>▸</span>
        <span className="dsht-rp-fold-title">导入与运行状态</span>
        <span className="dsht-rp-fold-summary">{summaryBits.join(' · ')}</span>
        <button type="button" className="dsht-rp-back" aria-label="刷新状态" title="刷新"
          disabled={loading}
          onClick={(e) => { e.stopPropagation(); void refresh() }}>{loading ? '…' : '⟳'}</button>
      </div>
      {expanded && (
        <div className="dsht-rp-fold-body">
        {/* 【2026-09-13 修复·读屏语义（F-6）】两处错误行加 role=status，读屏可播报 */}
        {loadError && <p className="dsht-rp-note" role="status" style={{ marginTop: 8 }}>{loadError}</p>}
        {buildInfoError !== '' && <p className="dsht-rp-note" role="status" style={{ marginTop: 8 }}>{buildInfoError}</p>}

        <div className="dsht-rp-kv" style={{ marginTop: 8 }}>
          <span className="k">数据源批次</span>
          <span className="v">
            {batch === null
              ? '还没有导入过数据包'
              : `最近一批「${batch.name}」${manifestBits.length > 0 ? `：${manifestBits.join(' · ')}` : ''}`}
          </span>
        </div>

        <div className="dsht-rp-kv">
          <span className="k">迁移结果</span>
          <span className="v">
            {batch === null && '—'}
            {batch !== null && !batch.hasReport && '迁移报告还没生成（适配完成后会出现在这里）'}
            {batch !== null && batch.hasReport && (batch.report ?? []).length === 0 && '迁移报告已生成'}
            {batch !== null && (batch.report ?? []).map(r => (
              <div key={r.category}>
                {r.fail > 0 ? '⚠️' : '✅'} {r.category}：{r.ok}/{r.total} 成功{r.fail > 0 ? `（${r.fail} 项失败）` : ''}
              </div>
            ))}
          </span>
        </div>

        <div className="dsht-rp-kv">
          {/* 【D2 术语桥接 2026-09-13】ST 老用户找的是「Extensions / 扩展」，
              而本项目叫「预适配插件」⇒ 加 ST 原词对照。只加对照、不改名（boundary B5）。 */}
          <span className="k">预适配插件<br /><span className="dsht-rp-note">（SillyTavern 的 Extensions / 扩展）</span></span>
          <span className="v">
            {PROBES.map((p, i) => (
              <div key={p.listName}>
                {probeResults === null ? '…' : { ok: '✅ 功能正常', degraded: '⚠️ 在线但功能异常', down: '❌ 未响应' }[probeResults[i] ?? 'down']}　{p.label}
                <span className="dsht-rp-note" style={{ marginLeft: 6 }}>（插件列表里叫 {p.listName}）</span>
              </div>
            ))}
          </span>
        </div>

        <div className="dsht-rp-kv">
          <span className="k">API 连接</span>
          <span className="v">
            {api === null ? '❌ 未配置——到「预设」页检查，或重新导入 ST API 配置' : `✅ 已连接 ${api.provider}（${api.model}）`}
          </span>
        </div>

        <p className="dsht-rp-note" style={{ marginTop: 10 }}>
          提示：系统「设置 → 插件」的全部插件列表里有 170+ 个插件，搜索 dsht 即可找到上面三个；
          它们随应用自动运行，不需要手动配置。
        </p>
        </div>
      )}
    </div>
  )
}
