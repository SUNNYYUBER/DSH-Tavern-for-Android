/**
 * T-27：版本与更新面板（RpOverlay「导入」tab，紧邻「导入与运行状态」）。
 *
 * 用户痛点（2026-09-08 原话）：「我装的到底是不是最新包」。
 * 本面板给出三件事：
 * 1. **本机是什么版本** —— APK 版本（versionName）/ 内嵌 DSH 运行时版本 / 解压哨兵，
 *    一眼对出新旧包（哨兵最大者 = 最近一次成功解压）。
 * 2. **更新源可配置** —— 发布渠道尚未决（GitHub Releases API vs 自建静态 JSON），
 *    故先把配置位落下来：填 GitHub Releases 地址或静态 JSON 地址均可，自动识别形态。
 * 3. **手动检查更新** —— 拉取更新源 → 与**本机版本**比较 → 三态显式回显
 *    （有新版本 / 已是最新 / 检查失败及失败原因）。
 *
 * 设计红线（本项目头号缺陷 = 静默失败）：
 * - 检查失败**必须**把原因摆到界面上（reason + message），绝不允许"看起来已是最新"；
 * - 版本号解析不了 → 明说"读不到本机版本号"，不假装已最新；
 * - 未配置更新源 → 明说"还没配置"，不吞成空。
 */
import { useCallback, useEffect, useState } from 'react'
import { rpApi } from './rpc.ts'

interface BuildInfo {
  sentinel: string | null
  dshVersion: string | null
  appVersion: string | null
  appVersionCode: number | null
  appAbi: string | null
}

interface CheckResult {
  ok: boolean
  reason?: string
  message?: string
  current: string | null
  relation?: 'newer' | 'same' | 'older' | 'invalid'
  hasUpdate?: boolean
  latest?: { version: string; url: string; notes: string }
  downloadUrl?: string | null
  asset?: { name: string; url: string; size: number | null } | null
  apkCount?: number
  kind?: string
  source?: string
}

const fmtSize = (n: number | null): string => {
  if (n === null || !Number.isFinite(n)) return ''
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`
}

export function UpdatePanel(): JSX.Element {
  const [info, setInfo] = useState<BuildInfo | null>(null)
  const [infoError, setInfoError] = useState('')
  const [source, setSource] = useState('')
  const [sourceDirty, setSourceDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [expanded, setExpanded] = useState(false)

  const loadInfo = useCallback(async (): Promise<void> => {
    try {
      const b = await rpApi<BuildInfo>('rp/build-info')
      setInfo(b)
      setInfoError('')
    } catch (e) {
      setInfo(null)
      // 读不到就如实说 —— 否则面板会表现为"版本一栏永远是 —"，又一次静默失败
      setInfoError(`读不到构建信息：${(e as Error).message}`)
    }
  }, [])

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      const c = await rpApi<{ source: string; kind: string }>('rp/update-config')
      setSource(c.source ?? '')
      setSourceDirty(false)
    } catch { /* 无配置（首次）——保持空输入 */ }
  }, [])

  useEffect(() => { void loadInfo(); void loadConfig() }, [loadInfo, loadConfig])

  const saveSource = useCallback(async (): Promise<void> => {
    setSaving(true)
    setSaveNote('')
    try {
      const r = await rpApi<{ ok: boolean; source: string; kind: string }>('rp/update-config', { source })
      setSaveNote(r.source === '' ? '已清空更新源' : `已保存（识别为 ${r.kind === 'github' ? 'GitHub Releases' : '静态 JSON'}）`)
      setSourceDirty(false)
    } catch (e) {
      setSaveNote(`保存失败：${(e as Error).message}`)
    }
    setSaving(false)
  }, [source])

  const doCheck = useCallback(async (): Promise<void> => {
    setChecking(true)
    setResult(null)
    try {
      const r = await rpApi<CheckResult>('rp/check-update')
      setResult(r)
    } catch (e) {
      setResult({ ok: false, reason: 'rpc', message: (e as Error).message, current: info?.appVersion ?? null })
    }
    setChecking(false)
  }, [info])

  const summaryBits: string[] = []
  summaryBits.push(info === null ? '版本读取失败' : `本机 ${info.appVersion ?? '未知'}`)
  if (info?.dshVersion) summaryBits.push(`运行时 ${info.dshVersion}`)
  if (info?.sentinel) summaryBits.push(info.sentinel.replace('.installed-', '构建 '))

  return (
    <div className="dsht-rp-section dsht-rp-fold">
      <div
        className="dsht-rp-fold-summary-row"
        role="button"
        tabIndex={0}
        onClick={() => { setExpanded(v => !v) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}
      >
        <span className={'dsht-rp-fold-arrow' + (expanded ? ' open' : '')}>▸</span>
        <span className="dsht-rp-fold-title">版本与更新</span>
        <span className="dsht-rp-fold-summary">{summaryBits.join(' · ')}</span>
      </div>
      {expanded && (
        <div className="dsht-rp-fold-body">
          {infoError !== '' && <p className="dsht-rp-note" style={{ marginTop: 8 }}>{infoError}</p>}

          <div className="dsht-rp-kv" style={{ marginTop: 8 }}>
            <span className="k">本机版本</span>
            <span className="v">
              {info === null ? '—' : (info.appVersion ?? '未知（PC 验证环境读不到）')}
              {info?.appVersionCode !== null && info?.appVersionCode !== undefined ? `（${info.appVersionCode}）` : ''}
              {info?.appAbi ? `　${info.appAbi}` : ''}
            </span>
          </div>

          <div className="dsht-rp-kv">
            <span className="k">DSH 运行时</span>
            <span className="v">{info?.dshVersion ?? '—'}</span>
          </div>

          <div className="dsht-rp-kv">
            <span className="k">构建标记</span>
            <span className="v">
              {info?.sentinel ?? '—'}
              <span className="dsht-rp-note" style={{ marginLeft: 6 }}>（数字越大越新）</span>
            </span>
          </div>

          <div className="dsht-rp-kv">
            <span className="k">更新源</span>
            <span className="v">
              <input
                className="dsht-rp-field"
                type="text"
                value={source}
                placeholder="https://api.github.com/repos/<owner>/<repo>/releases/latest"
                onChange={(e) => { setSource(e.target.value); setSourceDirty(true) }}
                style={{ width: '100%' }}
              />
            </span>
          </div>

          <div className="dsht-rp-actions" style={{ marginTop: 6 }}>
            <button type="button" className="dsht-rp-btn" disabled={saving || !sourceDirty}
              onClick={() => { void saveSource() }}>{saving ? '保存中…' : '保存更新源'}</button>
            <button type="button" className="dsht-rp-btn" disabled={checking}
              onClick={() => { void doCheck() }}>{checking ? '检查中…' : '检查更新'}</button>
          </div>
          {saveNote !== '' && <p className="dsht-rp-note">{saveNote}</p>}

          {result !== null && (
            <div className="dsht-rp-kv" style={{ marginTop: 8 }}>
              <span className="k">检查结果</span>
              <span className="v">
                {result.ok === false && (
                  <div>
                    ❌ {result.reason === 'unconfigured' ? '还没配置更新源' : '检查失败'}：{result.message ?? '未知原因'}
                  </div>
                )}
                {result.ok === true && result.hasUpdate === true && (
                  <div>
                    🔔 有新版本 <strong>{result.latest?.version}</strong>（本机 {result.current}）
                    <div className="dsht-rp-note">
                      当前安装面 {(result.apkCount ?? 0) > 1 ? `有 ${result.apkCount} 个包，` : ''}
                      按本机架构挑选下载项
                    </div>
                    {result.downloadUrl
                      ? <div><a href={result.downloadUrl} target="_blank" rel="noreferrer">前往下载{result.asset ? `（${result.asset.name}${result.asset.size !== null ? `，${fmtSize(result.asset.size)}` : ''}）` : ''}</a></div>
                      : <div className="dsht-rp-note">更新源没给出下载地址</div>}
                  </div>
                )}
                {result.ok === true && result.hasUpdate === false && result.relation === 'same' && (
                  <div>✅ 已是最新版本（{result.current}）</div>
                )}
                {result.ok === true && result.hasUpdate === false && result.relation === 'older' && (
                  <div>本机版本（{result.current}）比更新源上的（{result.latest?.version}）还新——可能填错了更新源</div>
                )}
                {result.ok === true && result.relation === 'invalid' && (
                  <div>⚠️ 更新源里的版本号「{result.latest?.version}」看不懂，无法比较（未按"已是最新"处理）</div>
                )}
              </span>
            </div>
          )}

          <p className="dsht-rp-note" style={{ marginTop: 10 }}>
            「检查更新」只做检查，不会自动下载安装。发布渠道（GitHub Releases 或自建静态 JSON）确定后填入上面的更新源即可。
          </p>
        </div>
      )}
    </div>
  )
}
