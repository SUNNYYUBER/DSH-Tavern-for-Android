/**
 * F5 单源化回归测试：**复制即必然漂移**的判据（P-1b）。
 *
 * ## 为什么这组测试存在
 * 审计脚本 `scripts/audit-impl-duplication.mjs` 发现了 4 组跨包复制。它们不是「代码风格问题」，
 * 而是**静默数据一致性风险**——每组的漂移后果都无法从报错中发现：
 *
 * | 函数 | 若两侧漂移的后果 |
 * |---|---|
 * | `hash36` | 同一张卡**导入与导出得到不同 id**（「导入的卡导出后变成另一张卡」），零报错 |
 * | `rpSlugFromCwd` | Android 上 `/data/user/0` 与 `/data/data` 两形态判成两个工作区 |
 * | `decodePointerSeg` | 变量路径解歪 → **状态写到错误位置**，零报错 |
 *
 * 本组测试的作用：把「单源」这件事钉住——**如果将来有人又在某个包里复制一份，
 * 这些测试不会报错，但审计脚本会**；而这些测试负责证明**当前单源实现本身的正确性**。
 * 两者配合：审计脚本管「有没有复制」，本测试管「单源那份对不对」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hash36 } from '../src/dsht-plugin-shared/hash.ts'
import { normalizeAndroidPath, rpSlugFromCwd } from '../src/dsht-plugin-shared/rp-workspace.ts'
import { decodePointerSeg, encodePointerSeg, parsePathSegments, toJsonPointer } from '../src/dsht-plugin-shared/json-pointer.ts'
import { stripMatchingQuotes } from '../src/dsht-plugin-shared/text-normalize.ts'
import { isSafeSessionId } from '../src/dsht-plugin-shared/session-surgery.ts'
import { isMergeableObject } from '../src/dsht-plugin-shared/deep-merge.ts'

// ---------------------------------------------------------------------------
// hash36
// ---------------------------------------------------------------------------

describe('hash36（导入/导出 id 的稳定哈希，单源）', () => {
  it('确定性：同输入 → 同输出（这是「导入导出一致」的前提）', () => {
    expect(hash36('Kemini Dramatron')).toBe(hash36('Kemini Dramatron'))
  })

  it('已知向量的**钉死值**（改算法会让导入/导出对同一张卡算出不同 id）', () => {
    // 这些值一旦变化，说明算法被改过 —— 已有用户的卡/会话 id 会全部失配。
    // 若确实需要改算法，必须同时提供迁移方案，而不是让本测试静默通过。
    // 空串 → 未经过循环，输出 FNV offset basis 0x811c9dc5 的 base36
    expect(hash36('')).toBe((0x811c9dc5 >>> 0).toString(36))
    expect(hash36('a')).toMatch(/^[0-9a-z]+$/)
    // FNV-1a 32bit 的标准自检值：'foobar' 的 FNV-1a-32 = 0xbf9cf968
    expect(hash36('foobar')).toBe((0xbf9cf968 >>> 0).toString(36))
  })

  it('中文输入可用（角色卡名多为中文——这是本函数存在的原因）', () => {
    expect(hash36('示例游戏')).toBe(hash36('示例游戏'))
    expect(hash36('示例游戏')).not.toBe(hash36('示例游戏二'))
  })

  it('输出恒为 base36 字符集（DSH 要求 id 是 kebab-case 安全字符）', () => {
    for (const s of ['a', '角色卡', 'x'.repeat(500), '!@#$%^&*()']) {
      expect(hash36(s)).toMatch(/^[0-9a-z]+$/)
    }
  })

  it('长度为 1~7（32bit → base36 上限）', () => {
    for (const s of ['a', 'bb', 'ccc', '角色卡名很长很长']) {
      const h = hash36(s)
      expect(h.length).toBeGreaterThanOrEqual(1)
      expect(h.length).toBeLessThanOrEqual(7)
    }
  })
})

// ---------------------------------------------------------------------------
// rpSlugFromCwd
// ---------------------------------------------------------------------------

describe('rpSlugFromCwd（cwd → rp 工作区 slug，单源）', () => {
  const HOME = '/data/data/com.dshtavern.app/files/dsh-home'

  it('正常形态：<home>/rp/<slug> → slug', () => {
    expect(rpSlugFromCwd(`${HOME}/rp/my-card`, HOME)).toBe('my-card')
  })

  it('✅ npm android 路径两形态等价（/data/user/0 vs /data/data）——漂移会在 Android 上炸', () => {
    const userForm = HOME.replace('/data/data/', '/data/user/0/')
    // cwd 用 /data/data 形态、home 用 /data/user/0 形态：必须仍能识别出同一 slug
    expect(rpSlugFromCwd(`${HOME}/rp/my-card`, userForm)).toBe('my-card')
    expect(rpSlugFromCwd(`${userForm}/rp/my-card`, HOME)).toBe('my-card')
  })

  it('不在 rp/ 下 → null', () => {
    expect(rpSlugFromCwd(`${HOME}/rp-import/batch-1`, HOME)).toBe(null)
    expect(rpSlugFromCwd('/tmp/whatever', HOME)).toBe(null)
  })

  it('就是 rp/ 本身（无 slug 段）→ null', () => {
    expect(rpSlugFromCwd(`${HOME}/rp`, HOME)).toBe(null)
    expect(rpSlugFromCwd(`${HOME}/rp/`, HOME)).toBe(null)
  })

  it('多段路径（slug 下还有子目录）→ null（slug 只允许一段）', () => {
    expect(rpSlugFromCwd(`${HOME}/rp/my-card/sub`, HOME)).toBe(null)
  })

  it('cwd 为空/undefined → null（不抛）', () => {
    expect(rpSlugFromCwd(undefined, HOME)).toBe(null)
    expect(rpSlugFromCwd('', HOME)).toBe(null)
  })

  // 【2026-09-14 回归护栏】本次单源化时曾把两种宽严度当同一语义合并 ⇒ 立刻炸在这里。
  // 真因：门面侧 cwd 由 path.join 产出（Windows 下是 `\`），严格版前缀比较不匹配
  // ⇒ 角色名静默回落 'Assistant'（facade.spec.ts 断言失败）。
  it('✅ Windows 反斜杠分隔符必须归一（否则同一 cwd 在两种环境下得出不同结论）', () => {
    const winHome = 'D:\\DSH RolePlay\\.dsh'
    expect(rpSlugFromCwd('D:\\DSH RolePlay\\.dsh\\rp\\my-card', winHome)).toBe('my-card')
    // 混合分隔符（path.join 在 Windows 上对混合输入的行为）
    expect(rpSlugFromCwd('D:\\DSH RolePlay/.dsh\\rp/my-card', winHome)).toBe('my-card')
  })

  it('mode 语义差显式化：exact（默认）拒绝更深层，first-segment 宽容取首段', () => {
    const deep = `${HOME}/rp/my-card/sub`
    // dsh-plugin 用它做「会话归属」判定 —— 深层不是 RP 工作区
    expect(rpSlugFromCwd(deep, HOME)).toBe(null)
    expect(rpSlugFromCwd(deep, HOME, 'exact')).toBe(null)
    // 门面用它做「取角色名」兜底 —— 宽容取首段即可（迁移前的行为，必须保持）
    expect(rpSlugFromCwd(deep, HOME, 'first-segment')).toBe('my-card')
    // 两种模式下表层形态结论一致
    expect(rpSlugFromCwd(`${HOME}/rp/my-card`, HOME, 'first-segment')).toBe('my-card')
    expect(rpSlugFromCwd(`${HOME}/rp/`, HOME, 'first-segment')).toBe(null)
  })

  it('normalizeAndroidPath：只转前缀，不动其它出现位置', () => {
    expect(normalizeAndroidPath('/data/user/0/com.x/a/b')).toBe('/data/data/com.x/a/b')
    // 非前缀位置不转（避免误伤用户目录名）
    expect(normalizeAndroidPath('/sdcard/data/user/0/x')).toBe('/sdcard/data/user/0/x')
    expect(normalizeAndroidPath('/data/data/com.x')).toBe('/data/data/com.x')
  })
})

// ---------------------------------------------------------------------------
// JSON Pointer（decodePointerSeg / encodePointerSeg / parsePathSegments）
// ---------------------------------------------------------------------------

describe('JSON Pointer（变量路径编解码，单源）', () => {
  it('decodePointerSeg：~1 → /（RFC 6901）', () => {
    expect(decodePointerSeg('a~1b')).toBe('a/b')
  })

  it('decodePointerSeg：~0 → ~', () => {
    expect(decodePointerSeg('a~0b')).toBe('a~b')
  })

  it('✅ 转义顺序正确：~01 → ~1（不是 /）——**顺序颠倒会解错**，这是本单源化的核心价值', () => {
    // RFC 6901 规定先解 ~1 再解 ~0。若实现反序（先 ~0 后 ~1），
    // '~01' 会先变 '~1' 再变 '/' —— 得到错误的 '/'。
    expect(decodePointerSeg('~01')).toBe('~1')
  })

  it('encodePointerSeg：~ → ~0（必须先转，否则会把刚生成的 ~1 再转一次）', () => {
    expect(encodePointerSeg('a/b')).toBe('a~1b')
    expect(encodePointerSeg('a~b')).toBe('a~0b')
    expect(encodePointerSeg('~1')).toBe('~01')
  })

  it('编解码往返恒等（对含特殊字符的段）', () => {
    for (const seg of ['plain', 'a/b', 'a~b', '~1', '~0', 'a~/b']) {
      expect(decodePointerSeg(encodePointerSeg(seg))).toBe(seg)
    }
  })

  it('parsePathSegments：JSONPointer 形态（斜杠分隔 + 转义解码）', () => {
    expect(parsePathSegments('/a/b/c')).toEqual(['a', 'b', 'c'])
    expect(parsePathSegments('/a~1b/c')).toEqual(['a/b', 'c'])
    expect(parsePathSegments('/a~0b')).toEqual(['a~b'])
  })

  it('parsePathSegments：点号形态（ST setvar 风格；**不做**转义解码）', () => {
    expect(parsePathSegments('a.b.c')).toEqual(['a', 'b', 'c'])
    // 点号形态下 ~1 是字面量（ST 语义），不解码
    expect(parsePathSegments('a.~1b')).toEqual(['a', '~1b'])
  })

  it('parsePathSegments：空段被过滤（// 与首尾 / 不产生空段）', () => {
    expect(parsePathSegments('/a//b/')).toEqual(['a', 'b'])
    expect(parsePathSegments('')).toEqual([])
  })

  it('toJsonPointer：段数组 → 规范 JSONPointer', () => {
    expect(toJsonPointer(['a', 'b'])).toBe('/a/b')
    expect(toJsonPointer(['a/b'])).toBe('/a~1b')
    expect(toJsonPointer([])).toBe('/')
  })

  it('往返：parsePathSegments(toJsonPointer(segs)) === segs', () => {
    const segs = ['a', 'b/c', 'd~e', '~1']
    expect(parsePathSegments(toJsonPointer(segs))).toEqual(segs)
  })
})

// ---------------------------------------------------------------------------
// 【2026-09-14 判据 4 收口】「不同名但函数体逐字相同」的六组
// ---------------------------------------------------------------------------
/**
 * 这组测试的由来：`scripts/audit-impl-duplication.mjs` 的**判据 4** 在 2026-09-14
 * 首次上线后，立刻抓到 3 组此前**完全不可见**的复制（判据 2 只比名字，抓不到改名复制）：
 *
 * | 复制体 A | 复制体 B | 单源落点 |
 * |---|---|---|
 * | `dsh-plugin/index.ts:atomicWriteFile` | `atomic-fs.ts:atomicWriteText` | `atomic-fs.ts` |
 * | `state/mvu.ts:stripQuotes` | `dsht-plugin-memory/tables.ts:stripArgQuotes` | `text-normalize.ts` |
 * | `dsht-plugin-tavern-helper/{facade,for-session,session-store}.ts:isTree` | `deep-merge.ts:isMergeableObject` | `deep-merge.ts` |
 *
 * 「收口」= 把重复函数体换成 `const local = shared`（保留本地名，破坏面最小）。
 * 这组测试负责证明：**收口后的委托真的生效**（不是删了函数体却忘了 import，
 * 也不是留了个空壳导致运行期 undefined）。
 */

describe('stripMatchingQuotes（引号剥离单源；原 mvu.stripQuotes ≡ tables.stripArgQuotes）', () => {
  it('半角双引号成对剥离', () => {
    expect(stripMatchingQuotes('"abc"')).toBe('abc')
  })

  it('半角单引号成对剥离', () => {
    expect(stripMatchingQuotes("'abc'")).toBe('abc')
  })

  it('✅ 全角弯引号成对剥离（这是复制的**真实风险点**：一处补了 `“”` 另一处没补即行为不一致）', () => {
    expect(stripMatchingQuotes('“abc”')).toBe('abc')
  })

  it('不成对 → 原样（只 trim；不误伤内容里的引号）', () => {
    expect(stripMatchingQuotes('"abc')).toBe('"abc')
    expect(stripMatchingQuotes('a"b"c')).toBe('a"b"c')
    // 注意既有口径是「**首尾**成对即剥」而非「引号成对计数」——首尾都是 `"` 就剥，
    // 中间那个 `"` 不动（这是原实现的既有行为，本次单源化只搬不改，不得顺手"修正"）
    expect(stripMatchingQuotes('"a"b"')).toBe('a"b')
  })

  it('混合引号（前后不同）→ 不剥离', () => {
    // 内容 = 单引号开头 + 双引号结尾（模板串写法规避单双引号转义）
    const mixed = `'abc"`
    expect(stripMatchingQuotes(mixed)).toBe(mixed)
  })

  it('首尾空白先 trim 再判成对', () => {
    expect(stripMatchingQuotes('  "abc"  ')).toBe('abc')
  })

  it('单字符 / 空串 → 原样（长度 <2 不成对）', () => {
    expect(stripMatchingQuotes('"')).toBe('"')
    expect(stripMatchingQuotes('')).toBe('')
  })

  it('中文内容 + 全角引号（角色卡实际形态）', () => {
    expect(stripMatchingQuotes('“云梦璃”')).toBe('云梦璃')
  })
})

describe('isSafeSessionId（sessionId 安全判据单源；原 memory ≡ tables 两处逐字复制）', () => {
  it('普通 sessionId → 安全', () => {
    expect(isSafeSessionId('abc-123')).toBe(true)
    expect(isSafeSessionId('sid_中文')).toBe(true)
  })

  it('⛔ 路径穿越 `..` → 不安全', () => {
    expect(isSafeSessionId('../etc/passwd')).toBe(false)
    expect(isSafeSessionId('a..b')).toBe(false)
  })

  it('⛔ 路径分隔符 `/` `\\` → 不安全', () => {
    expect(isSafeSessionId('a/b')).toBe(false)
    expect(isSafeSessionId('a\\b')).toBe(false)
  })

  it('⛔ 等于 `.` → 不安全', () => {
    expect(isSafeSessionId('.')).toBe(false)
  })

  it('⛔ 首尾有空白（trim 不变量被破坏）→ 不安全', () => {
    expect(isSafeSessionId(' abc')).toBe(false)
    expect(isSafeSessionId('abc ')).toBe(false)
  })

  it('⛔ 非字符串（undefined / null / number）→ 不安全', () => {
    expect(isSafeSessionId(undefined)).toBe(false)
    expect(isSafeSessionId(null)).toBe(false)
    expect(isSafeSessionId(123)).toBe(false)
  })

  it('⛔ 空串 → 不安全', () => {
    expect(isSafeSessionId('')).toBe(false)
  })

  it('边界：长度 120 → 安全；121 → 不安全', () => {
    expect(isSafeSessionId('a'.repeat(120))).toBe(true)
    expect(isSafeSessionId('a'.repeat(121))).toBe(false)
  })
})

describe('isMergeableObject（可合并对象判据单源；原 isTree 三处副本）', () => {
  it('普通对象 → true', () => {
    expect(isMergeableObject({ a: 1 })).toBe(true)
    expect(isMergeableObject({})).toBe(true)
  })

  it('⛔ 数组 → false（数组一律整体替换，不做逐元素合并）', () => {
    expect(isMergeableObject([1, 2])).toBe(false)
    expect(isMergeableObject([])).toBe(false)
  })

  it('⛔ null / undefined → false', () => {
    expect(isMergeableObject(null)).toBe(false)
    expect(isMergeableObject(undefined)).toBe(false)
  })

  it('⛔ 原始值 → false', () => {
    expect(isMergeableObject(1)).toBe(false)
    expect(isMergeableObject('a')).toBe(false)
    expect(isMergeableObject(true)).toBe(false)
  })
})

describe('判据 4 收口的**结构性护栏**（源码级：本地名必须委托到共享层，不许留空壳）', () => {
  const SRC = join(import.meta.dirname, '..', 'src')
  const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

  it('atomicWriteFile 委托 atomicWriteText（且本地不得再有裸函数体）', () => {
    const s = read('dsh-plugin/index.ts')
    expect(s).toContain('export const atomicWriteFile = atomicWriteText')
    // 判据：本文件不得再出现 `function atomicWriteFile(`
    expect(s).not.toMatch(/function\s+atomicWriteFile\s*\(/)
  })

  it('mvu.stripQuotes 与 tables.stripArgQuotes 都委托 stripMatchingQuotes', () => {
    const mvu = read('state/mvu.ts')
    expect(mvu).toContain('const stripQuotes = stripMatchingQuotes')
    expect(mvu).toContain("from '../dsht-plugin-shared/text-normalize.ts'")
    const tables = read('dsht-plugin-memory/tables.ts')
    expect(tables).toContain('const stripArgQuotes = stripMatchingQuotes')
    expect(tables).toContain("from '../dsht-plugin-shared/text-normalize.ts'")
  })

  it('三处 isTree 都委托 isMergeableObject（facade / for-session / session-store）', () => {
    const facade = read('dsht-plugin-tavern-helper/facade.ts')
    expect(facade).toContain('isMergeableObject as isTree')
    expect(facade).not.toMatch(/function\s+isTree\s*\(/)

    const forSession = read('dsht-plugin-tavern-helper/for-session.ts')
    expect(forSession).toContain('isMergeableObject as isTree')
    expect(forSession).not.toMatch(/function\s+isTree\s*\(/)

    const store = read('dsht-plugin-tavern-helper/session-store.ts')
    expect(store).toContain('isMergeableObject(value)')
    expect(store).not.toMatch(/function\s+isTree\s*\(/)
  })

  it('isValidMemorySessionId / isValidTablesSessionId 都委托 isSafeSessionId', () => {
    expect(read('dsh-plugin/memory.ts')).toContain('const isValidMemorySessionId = isSafeSessionId')
    expect(read('dsht-plugin-memory/tables.ts')).toContain('const isValidTablesSessionId = isSafeSessionId')
  })

  it('neutralizeMacros 委托 escapeResidualMacros', () => {
    expect(read('dsht-plugin-memory/index.ts')).toContain('const neutralizeMacros = escapeResidualMacros')
  })
})

// ---------------------------------------------------------------------------
// 【W8 第二十三轮续】`useEscapeClose` 单源收口（P-1）
//
// ## 为什么这组测试存在（以及为什么审计脚本抓不到）
// D 轨道 `audit-impl-duplication.mjs` **判据 4** 只提取 `function name(...) { }` **声明形态**，
// 且**只判跨包**。而这处重复是**箭头函数体**（`useEffect(() => {…})`）且在**同一个包内**
// ⇒ **两个口径都躲过**（已固化为「盲区 ①/③」的诚实标注）。
//
// 本轮用 AST 扩展扫描后实测发现它（4 个面板逐字相同，其中两处注释还写着「与 RpSearchPanel 同款」）。
// 收口到 `use-escape-close.ts` 后，本组测试负责两件事：
//   ① **单源存在性**：4 个面板必须都委托 hook，且**不得**再留就地实现（防回退）
//   ② **行为等价**：hook 的行为必须与原 4 份实现逐点相同（收口只搬不改语义）
// ---------------------------------------------------------------------------

describe('useEscapeClose（弹层 Esc 关闭单源；原 4 个面板逐字复制）', () => {
  const SRC = join(import.meta.dirname, '..', 'src')
  const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

  /** 原 4 份就地实现的**指纹**：`keydown` 监听 + `Escape` 判据（换行/空白无关） */
  const INLINE_ESCAPE_RE = /window\.addEventListener\(\s*'keydown'\s*,\s*onKey\s*\)/

  const panels = [
    'dsht-rp-ui/src/client/RpContextPanel.tsx',
    'dsht-rp-ui/src/client/RpSearchPanel.tsx',
    'dsht-rp-ui/src/client/RpStateView.tsx',
    'dsht-rp-ui/src/client/RpTablesView.tsx',
  ]

  it('✅ 4 个面板都委托 useEscapeClose（单源入口）', () => {
    for (const p of panels) {
      const s = read(p)
      expect(s, `${p} 未 import 单源模块`).toContain("from './a11y-props.ts'")
      expect(s, `${p} 未调用 useEscapeClose`).toContain('useEscapeClose(onClose)')
    }
  })

  it('✅ 4 个面板都不再保留就地实现（防回退到复制形态）', () => {
    for (const p of panels) {
      // 判据点：就地实现必然带**函数体**里的 keydown 监听（hook 内部那处不在这些文件里）
      expect(read(p), `${p} 又出现了就地 keydown 监听（应改用 useEscapeClose）`).not.toMatch(INLINE_ESCAPE_RE)
    }
  })

  it('✅ 单源那份逐点保持原行为（收口只搬不改：keydown + Escape + 依赖 onClose）', () => {
    const s = read('dsht-rp-ui/src/client/a11y-props.ts')
    // ① 事件类型与目标：window 上的 keydown（原 4 份都是 window，不是 document）
    expect(s).toContain("window.addEventListener('keydown', onKey)")
    // ② 判据：严格等于 'Escape'（不是 includes / 不是 keyCode）
    expect(s).toContain("ev.key === 'Escape'")
    // ③ 卸载即摘除（原实现都有 cleanup；漏掉会累积监听）
    expect(s).toContain("window.removeEventListener('keydown', onKey)")
    // ④ deps 必须只有 onClose（多写会让监听反复重挂）
    expect(s).toMatch(/\},\s*\[onClose\]\)/)
  })

  it('✅【W8 第二处】折叠头 a11y 属性也单源（原 2 份逐字相同）+ 两处都委托', () => {
    const foldUsers = [
      'dsht-rp-ui/src/client/MigrationStatusPanel.tsx',
      'dsht-rp-ui/src/client/UpdatePanel.tsx',
    ]
    for (const p of foldUsers) {
      const s = read(p)
      expect(s, `${p} 未委托 foldRowA11yProps`).toContain('foldRowA11yProps(')
      // 不得再留就地写法（判据点：同一元素上直接写 role="button" + onKeyDown 内联 Enter/Space）
      expect(s, `${p} 又出现了就地 role="button" 折叠头`).not.toMatch(/role="button"[\s\S]{0,200}?e\.key === 'Enter'/)
    }
    // 单源那份必须保持原判据（Enter + Space），且**不加** preventDefault（收口只搬不改）
    const src = read('dsht-rp-ui/src/client/a11y-props.ts')
    expect(src).toContain("e.key === 'Enter' || e.key === ' '")
    expect(src).toMatch(/role: 'button'/)
    expect(src).toMatch(/tabIndex: 0/)
  })

  it('✅【P-20 杠杆】扫描面必须真的覆盖到这几个面板（防「文件改名后判据恒真」）', () => {
    // 若 4 个文件都读不到（改名/移动），上一组断言会因「读空串」而**看起来通过**
    for (const p of panels) {
      const s = read(p)
      expect(s.length, `${p} 内容为空（路径漂移？判据已失效）`).toBeGreaterThan(500)
      expect(s, `${p} 不像面板组件`).toContain('export function')
    }
  })
})

// ---------------------------------------------------------------------------
// 【W8 第二十三轮续】AST 探针抓到的**同包跨文件 / 跨包**复制 —— 收口护栏
//
// 这 3 组是 `audit-body-dup-ast.mjs`（新常驻门禁第 10 项）抓出来的，
// 既有 D 闸门判据 4 因「只收 function 声明形态 + 只判跨包」而**全部漏报**。
// ---------------------------------------------------------------------------

describe('W8 同包/跨包函数体复制的收口（AST 探针抓到的 3 组）', () => {
  const SRC = join(import.meta.dirname, '..', 'src')
  const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

  it('✅ replaceRange 单源：session-repair 委托 session-write（原逐字相同的私有副本）', () => {
    const s = read('dsht-plugin-shared/session-repair.ts')
    expect(s, '未 import 单源实现').toContain("import { replaceRange } from './session-write.ts'")
    expect(s, '未委托单源（本地名应指向它）').toContain('const replaceRangeOf = replaceRange')
    // 负控：本地不得再出现**函数体**形态（即不得再有 `function replaceRangeOf`）
    expect(s, '又出现了就地实现（应委托）').not.toMatch(/function\s+replaceRangeOf\s*\(/)
  })

  it('✅ isMergeableObject 单源：host-projection 委托 deep-merge（原逐字相同的 isPlainObjectLike）', () => {
    const s = read('dsht-plugin-shared/host-projection.ts')
    expect(s, '未 import 单源实现').toContain("import { isMergeableObject } from './deep-merge.ts'")
    expect(s, '未委托单源').toContain('const isPlainObjectLike = isMergeableObject')
    expect(s, '又出现了就地实现').not.toMatch(/function\s+isPlainObjectLike\s*\(/)
  })

  it('✅ sendJson 单源：dsh-plugin 的内联 send 委托 shared/http（原逐字相同的跨包复制）', () => {
    const s = read('dsh-plugin/index.ts')
    expect(s, '未 import 单源实现').toContain("import { sendJson } from '../dsht-plugin-shared/http.ts'")
    expect(s, '未委托单源').toContain('sendJson(res, code, body)')
    // 负控：闭包里不得再出现就地两行实现（writeHead + JSON.stringify 连写）
    expect(s, '又出现了就地实现').not.toMatch(/res\.writeHead\(code,\s*\{\s*'Content-Type':\s*'application\/json'\s*\}\)\s*\n\s*res\.end\(JSON\.stringify\(body\)\)/)
  })

  it('✅ snapshotFor 单源：tavern-helper/index 委托 facade（原逐字相同的 snapshotFiles）', () => {
    const idx = read('dsht-plugin-tavern-helper/index.ts')
    expect(idx, '未委托 facade 的单源实现').toContain('facade.snapshotFor(dshHome, sessionId, relPaths)')
    // 负控：不得再就地写 snapshotBeforeWrite（那是被收口掉的旧形态）
    expect(idx, '又出现了就地快照实现').not.toContain('await snapshotBeforeWrite(dshHome, sessionId, relPaths)')
    // 单源那份必须导出（否则 index 无法委托）
    const fc = read('dsht-plugin-tavern-helper/facade.ts')
    expect(fc, 'facade 未导出单源实现').toContain('export async function snapshotFor(')
  })

  it('✅【P-20 杠杆】AST 探针存在且带自证（防「门禁被删后无人察觉」）', () => {
    const probe = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'audit-body-dup-ast.mjs'), 'utf8')
    expect(probe, '探针缺 --selftest 自证').toContain('--selftest')
    expect(probe, '探针未覆盖「同包跨文件」这一档').toContain('samePkgCrossFile')
    expect(probe.length, '探针内容异常短（被清空？）').toBeGreaterThan(2000)
  })
})
