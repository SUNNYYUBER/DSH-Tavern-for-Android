# 正则 TH API 源码级对质报告（2026-09-08）

> **方法与证据基线**（此为前提，先说清楚）：
> ST 侧真源码 = `D:\SillyTavern-1.16.0\旧sillytavern\Luker-现在在用的版本\data\default-user\extensions\JS-Slash-Runner\@types\function\tavern_regex.d.ts`（扩展自带权威类型声明，即脚本实际看到的契约）。
> 我方实现 = `rp-workspace\packages\src\regex\engine.ts`（数据模型）+ `rp-workspace\packages\src\dsht-rp-ui\src\client\th-shim.ts:1011-1084`（TH 门面）。
> **勘误**：`HOOK_PARADIGM.md` §7 称"酒馆助手与 EJS 提示词模板在本机树里不存在"——不成立，实体在
> `data\default-user\extensions\JS-Slash-Runner\` 与 `ST-Prompt-Template\`，可逐行对质。

---

## 1. 字段级对照（`TavernRegex` vs `RegexScript`）

| # | 真 TH 契约（tavern_regex.d.ts） | 我方（engine.ts:13-31） | 判定 |
|---|---|---|---|
| 1 | `id: string` | `id: string` | 一致 |
| 2 | `script_name` | `scriptName` | 形状偏差 |
| 3 | **`enabled: boolean`** | **`disabled: boolean`** | **极性反转** |
| 4 | `find_regex` | `findRegex` | 形状偏差 |
| 5 | `replace_string` | `replaceString` | 形状偏差 |
| 6 | `trim_strings: string[]` | `trimStrings: string[]` | 形状偏差 |
| 7 | `source: {user_input, ai_output, slash_command, world_info}` | `placement: number[]` | 结构不同 |
| 8 | `destination: {display, prompt}` | `markdownOnly` + `promptOnly` | 结构不同 |
| 9 | `run_on_edit` | `runOnEdit` | 形状偏差 |
| 10 | `min_depth: number \| null` | `minDepth` | 形状偏差 |
| 11 | `max_depth: number \| null` | `maxDepth` | 形状偏差 |
| 12 | `scope?: 'global'\|'character'`（已 deprecated） | `_dshtScope`（内部标记） | 内部扩展 |

**11 个业务字段，9 个形状偏差，其中 1 个极性反转。**

## 2. 根因：参考错了对象

`engine.ts:12` 的注释写着「正则脚本数据（**ST 兼容字段名保留**，导入器直接映射）」——
这个注释是错的，而错误本身暴露了根因：

- ST **磁盘存储格式**（`settings.json` 的 `regex_scripts`）确实用 camelCase：`scriptName` / `findRegex`
- 真 TH **公开 API 契约**（`getTavernRegexes` 返回给卡脚本的）用 snake_case：`script_name` / `find_regex`

**我方照着 ST 的数据文件做，而不是照着 TH 的 API 契约做。** 两者命名风格正好相反，
所以"字段名看起来都对"而脚本一个都读不到。这就是「移植了表面」的精确机制——
且只要继续以 ST 数据文件为参照，这个错误会稳定复现。

## 3. 新发现（COMPAT-AUDIT §3 的 T1-T5 未覆盖）

### N1【高】`enabled` / `disabled` 极性反转 → 双向静默失败
- 读：脚本取 `regex.enabled` → `undefined`（falsy）→ 判定"全部未启用"
- 写：脚本置 `regex.enabled = true` → 新增一个我方不读的字段，`disabled` 原值不动 → **不生效**
- 证据：`tavern_regex.d.ts:33` vs `engine.ts:22`

### N2【高】`replaceTavernRegexes` 作用域参数静默落错
真 TH 传 `{type:'global'}` / `{type:'character', name?}` / `{type:'preset', name?}`（d.ts:63-77）。
我方 `th-shim.ts:1019` 只认 `o.type === 'scoped' && o.scope === ...`：
```js
if (o.type === 'scoped' && (o.scope === 'character' || o.scope === 'preset')) scope = o.scope;
```
→ 脚本传 `{type:'character'}` 时条件不成立，`scope` 恒为 `'global'`
→ **想改角色正则，实际改了全局正则，无报错**（比审计写的"落错作用域或报错"更糟：是静默）

### N3【高】`updateTavernRegexesWith` 忽略 option → 静默扩大写入范围
`th-shim.ts:1029` 首行 `void option;`，随后取**全量三源合并**并在 1043-1046 把
global / character / preset **三个作用域全部写回**。
→ 脚本只想改全局正则，结果把角色与预设正则一并覆盖。

### N4【高】`formatAsTavernRegexedString` 返回值类型不符
真 TH：`(text, source, destination, option?) => string`（**同步**，d.ts:23-28）
我方：`th-shim.ts:1057` 返回 `Promise<string>`。
→ 脚本按同步用法 `const s = formatAsTavernRegexedString(...)` 拿到 Promise，
拼进文本后输出 **`[object Promise]`**，无报错。

### N5【中】`isCharacterTavernRegexesEnabled()` 恒 true
`th-shim.ts:1084` 直接 `return true`；真 TH 查 `character_allowed_regex` 白名单（对应审计 A2）。

## 4. 一条完整失效链（说明为什么"每个字段单独看都像小事"）

```
脚本 getTavernRegexes({type:'character'})
  → 拿到 camelCase 对象（我方形状）
脚本改 regex.script_name / 置 regex.enabled = true
  → 改的是我方不存在的字段（N1 写失效）
脚本 replaceTavernRegexes(regexes, {type:'character'})
  → scope 静默降级为 'global'（N2）
  → 写入的 snake_case 对象我方引擎读 findRegex = undefined
  → 该正则永不执行，且全局正则被污染
```
四个环节各错一点，合起来是：功能存在、调用成功、返回 200、**什么都没发生，且悄悄改坏了别处**。

## 5. 修复方向（待拍板，本报告不含代码改动）

1. 在 TH 门面（`th-shim.ts`）做**契约适配层**：出口 camelCase→snake_case 映射 + `enabled` 极性换算 +
   `placement ↔ source{destination}` 双向转换；入口反向映射。内部存储形状可不动，只对脚本面做转换。
2. `replaceTavernRegexes` / `updateTavernRegexesWith` 的 option 解析改为接受真 TH 三形态，
   未知形态**显式报错**而非默认 global。
3. `formatAsTavernRegexedString` 若无法同步实现，至少在文档与门面标注异步语义；
   根治需评估 iframe 同源直读方案（对应审计 B1）。
4. 每个修复配一条**契约断言测试**：断言值来自 `tavern_regex.d.ts` 并在注释标注行号，
   防止再次照着 ST 数据文件实现。

## 6. 复用价值

`@types\function\` 下还有 21 份同类声明：`chat_message.d.ts`、`lorebook_entry.d.ts`、
`variables.d.ts`、`worldbook.d.ts`、`preset.d.ts`、`character.d.ts`、`generate.d.ts`、`inject.d.ts` 等。
**同一套对质方法可直接套用到其余模块**，把 COMPAT-AUDIT 里"低置信/推断"的百分比换成精确数字。
