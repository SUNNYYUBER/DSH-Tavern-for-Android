import { describe, expect, it } from 'vitest'
import {
  abiToken,
  guessUpdateKind,
  normalizeUpdateFeed,
  pickDownloadAsset,
} from '../src/dsht-plugin-shared/update-feed.ts'

describe('guessUpdateKind', () => {
  it('显式 hint 优先', () => {
    expect(guessUpdateKind('https://example.com/whatever.json', 'github')).toBe('github')
    expect(guessUpdateKind('https://api.github.com/x', 'json')).toBe('json')
  })

  it('按 URL 形态识别 GitHub（API 与 Releases 页面两种写法）', () => {
    expect(guessUpdateKind('https://api.github.com/repos/o/r/releases/latest')).toBe('github')
    expect(guessUpdateKind('https://github.com/o/r/releases/latest')).toBe('github')
    expect(guessUpdateKind('https://raw.githubusercontent.com/o/r/main/latest.json')).toBe('json')
    expect(guessUpdateKind('https://dsht.example.com/version.json')).toBe('json')
  })
})

describe('normalizeUpdateFeed — GitHub 形态', () => {
  it('取 tag_name / html_url / body / assets[].browser_download_url', () => {
    const f = normalizeUpdateFeed({
      tag_name: 'v0.3.0',
      html_url: 'https://github.com/o/r/releases/tag/v0.3.0',
      body: '修了一堆东西',
      assets: [
        { name: 'DSH-Tavern-0.3.0-arm64-release.apk', browser_download_url: 'https://dl/a.apk', size: 123456789 },
        { name: 'DSH-Tavern-0.3.0-x86_64-debug.apk', browser_download_url: 'https://dl/b.apk', size: 98765432 },
      ],
    }, 'github')
    expect(f.version).toBe('v0.3.0')
    expect(f.url).toBe('https://github.com/o/r/releases/tag/v0.3.0')
    expect(f.notes).toBe('修了一堆东西')
    expect(f.assets).toHaveLength(2)
    expect(f.assets[0].url).toBe('https://dl/a.apk')
    expect(f.assets[0].size).toBe(123456789)
  })

  it('缺 tag_name → 抛（不静默当"没有新版本"）', () => {
    expect(() => normalizeUpdateFeed({ html_url: 'x' }, 'github')).toThrow(/tag_name/)
    expect(() => normalizeUpdateFeed({}, 'github')).toThrow()
    expect(() => normalizeUpdateFeed(null, 'github')).toThrow()
  })
})

describe('normalizeUpdateFeed — 静态 JSON 形态', () => {
  it('取 version / url / notes', () => {
    const f = normalizeUpdateFeed({ version: '0.3.0', url: 'https://x/dl', notes: 'n' }, 'json')
    expect(f.version).toBe('0.3.0')
    expect(f.url).toBe('https://x/dl')
    expect(f.notes).toBe('n')
    expect(f.assets).toEqual([])
  })

  it('允许包一层 latest', () => {
    const f = normalizeUpdateFeed({
      latest: {
        version: '0.4.0',
        url: 'https://x/dl',
        assets: [{ name: 'a.apk', url: 'https://x/a.apk' }],
      },
    }, 'json')
    expect(f.version).toBe('0.4.0')
    expect(f.assets).toHaveLength(1)
    // 静态 JSON 的资产字段用 url 而非 browser_download_url
    expect(f.assets[0].url).toBe('https://x/a.apk')
  })

  it('缺 version → 抛', () => {
    expect(() => normalizeUpdateFeed({ url: 'https://x' }, 'json')).toThrow(/version/)
  })

  it('过滤掉缺 name 或缺 url 的资产（不产出半残项）', () => {
    const f = normalizeUpdateFeed({
      version: '1.0.0',
      assets: [
        { name: 'ok.apk', url: 'https://x/ok.apk' },
        { name: '', url: 'https://x/noname.apk' },
        { name: 'nourl.apk' },
        'garbage',
        null,
      ],
    }, 'json')
    expect(f.assets.map(a => a.name)).toEqual(['ok.apk'])
  })

  it('空字符串字段视为缺失（不把 "" 当有效版本）', () => {
    expect(() => normalizeUpdateFeed({ version: '   ' }, 'json')).toThrow(/version/)
  })
})

describe('abiToken', () => {
  it('把 Android ABI 名映射成 APK 文件名标记', () => {
    expect(abiToken('arm64-v8a')).toBe('arm64')
    expect(abiToken('x86_64')).toBe('x86_64')
    expect(abiToken('armeabi-v7a')).toBe('armeabi')
    expect(abiToken('')).toBe('')
  })
})

describe('pickDownloadAsset', () => {
  const assets = [
    { name: 'DSH-Tavern-0.3.0-x86_64-debug.apk', url: 'https://dl/x', size: 1 },
    { name: 'DSH-Tavern-0.3.0-arm64-release.apk', url: 'https://dl/a', size: 2 },
    { name: 'checksums.txt', url: 'https://dl/c', size: 3 },
  ]

  it('按本机架构挑对应 APK', () => {
    expect(pickDownloadAsset(assets, 'arm64-v8a')?.url).toBe('https://dl/a')
    expect(pickDownloadAsset(assets, 'x86_64')?.url).toBe('https://dl/x')
  })

  it('架构对不上时退回第一个 APK（而不是挑到 checksums.txt）', () => {
    const only = [{ name: 'checksums.txt', url: 'https://dl/c', size: 3 }, assets[0]]
    expect(pickDownloadAsset(only, 'mips')?.name).toBe('DSH-Tavern-0.3.0-x86_64-debug.apk')
  })

  it('没有任何 .apk → null（调用方回退 release 页面，不瞎猜）', () => {
    expect(pickDownloadAsset([{ name: 'a.zip', url: 'u', size: null }], 'arm64-v8a')).toBeNull()
    expect(pickDownloadAsset([], 'arm64-v8a')).toBeNull()
  })

  it('未知 ABI 时仍返回第一个 APK', () => {
    expect(pickDownloadAsset(assets, '')?.name).toBe('DSH-Tavern-0.3.0-x86_64-debug.apk')
  })
})
