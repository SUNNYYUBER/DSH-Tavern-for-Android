import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  hasUpdate,
  parseVersion,
  relateVersions,
} from '../src/dsht-plugin-shared/version-compare.ts'

describe('parseVersion', () => {
  it('解析基本三段号', () => {
    expect(parseVersion('0.2.0')?.core).toEqual([0, 2, 0])
    expect(parseVersion('0.2.0')?.normalized).toBe('0.2.0')
  })

  it('容忍 v/V 前缀与构建元数据', () => {
    expect(parseVersion('v0.2.0')?.normalized).toBe('0.2.0')
    expect(parseVersion('V1.2.3')?.normalized).toBe('1.2.3')
    expect(parseVersion('0.2.0+build.7')?.normalized).toBe('0.2.0')
    expect(parseVersion('v0.2.0-rc.1+deadbeef')?.normalized).toBe('0.2.0-rc.1')
  })

  it('缺位补 0', () => {
    expect(parseVersion('0.2')?.core).toEqual([0, 2, 0])
    expect(parseVersion('2')?.core).toEqual([2, 0, 0])
  })

  it('解析预发布标识符（数字段转 number）', () => {
    const p = parseVersion('0.2.0-rc.1')
    expect(p?.core).toEqual([0, 2, 0])
    expect(p?.pre).toEqual(['rc', 1])
  })

  it('预发布里的 `-` 只切首个：alpha-1 保持为一个标识符', () => {
    expect(parseVersion('1.0.0-alpha-1')?.pre).toEqual(['alpha-1'])
  })

  it('拒绝非版本号（返回 null，绝不猜）', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('abc')).toBeNull()
    expect(parseVersion('nightly')).toBeNull()
    expect(parseVersion('0.2.x')).toBeNull()
    expect(parseVersion('1.2.3.4.5')).toBeNull()
    expect(parseVersion(null)).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
    expect(parseVersion(2)).toBeNull()
    expect(parseVersion({ version: '1.0.0' })).toBeNull()
    expect(parseVersion('1.0.0-')).toBeNull()
    expect(parseVersion('1.0.0-a..b')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('数值比较而非字符串比较', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
  })

  it('缺位补 0 后判等', () => {
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('0.2.0', '0.2')).toBe(0)
  })

  it('预发布小于同号正式版', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBe(1)
  })

  it('预发布之间按标识符比较', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)
    // 数字标识符 < 字母标识符
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    // 标识符多者更大（前缀相同时）
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  })

  it('任一不可解析 → null', () => {
    expect(compareVersions('0.2.0', 'latest')).toBeNull()
    expect(compareVersions('', '0.2.0')).toBeNull()
  })
})

describe('relateVersions / hasUpdate', () => {
  it('识别三种关系', () => {
    expect(relateVersions('0.2.0', '0.2.1')).toBe('newer')
    expect(relateVersions('0.2.0', '0.3.0')).toBe('newer')
    expect(relateVersions('0.2.0', '1.0.0')).toBe('newer')
    expect(relateVersions('0.2.0', '0.2.0')).toBe('same')
    expect(relateVersions('1.0.0', '0.9.0')).toBe('older')
  })

  it('当前是预发布、正式版已发布 → 提示有新版本', () => {
    expect(hasUpdate('0.2.0-rc.1', '0.2.0')).toBe(true)
    expect(hasUpdate('0.2.0', '0.2.0-rc.1')).toBe(false)
  })

  it('不可解析 → invalid（显式，不静默当"已最新"）', () => {
    expect(relateVersions('0.2.0', '未知')).toBe('invalid')
    expect(hasUpdate('0.2.0', '未知')).toBe(false)
    // invalid 绝不能折叠成 same
    expect(relateVersions('0.2.0', '未知')).not.toBe('same')
  })
})
