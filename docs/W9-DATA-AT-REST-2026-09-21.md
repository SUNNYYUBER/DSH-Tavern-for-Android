# W-9 敏感数据落盘调研（2026-09-21）

> **任务来源**：[GOAL-DSH-ANDROID-COMPLETE](GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md) §三 W-9
> **报告须答**：① 会话 jsonl 标记字段不落盘的注入点与恢复语义风险；② Keystore 静态加密对 runtime IO 的开销实测；③ 都代价过高则如实维持现状 + 威胁模型。
> **结论先行**：**维持现状**（不引入 Keystore 静态加密）。理由与推翻条件见 §4。

---

## 1. 问题①：会话日志（jsonl）里的敏感面

### 1.1 凭据**不会**落进 jsonl（结构上不可能，不是「落了再洗」）

这一条最关键：**不是**「写了之后做脱敏」，而是**记录结构里根本没有凭据字段的位置**。三层证据：

**(A) 请求记录的字段类型不含凭据**

`dsh-llm/lib/types/call-config.d.ts:16-23`：

```ts
export interface LlmCallConfig {
    provider: string;
    model: string;
    reasoningEffort?: ReasoningEffortId;
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
}
```

`request/header` 事件的载荷是 `{ header: EpochHeader }`，而 `EpochHeader.config` 就是这个 `LlmCallConfig`
（`dsh-session/lib/types/types.d.ts:201-210` 与 `:335-340`）——**没有 `apiKey` / `headers` / `authorization` 任何一项**。

**(B) 记录方只写 header**

`dsh-agent-loop/lib/index.js:733-755`：构造请求记录时只传 `config` / `adapterDefaults` / `system` / `tools`，
`this.session.append("request/header", { header, reason })`。

**(C) 凭据在**日志边界之后**才被解析**

`dsh-llm-pi-ai/lib/index.js:690-693` 模块头注原文：

> *Credentials never reach this module's storage: the harness resolves a route's key through `ctx.credentials` before the request enters pi-ai and hands it over as a stream option.*

解析点在同文件 `:2479-2486`（`ctx.get("credentials").resolve(ref)`），结果包成 provider 库的 auth 对象
（`:743-751`）——该对象不在任何被持久化的结构里。settings 里存的只是**引用名**
（`apiKeyEnv: z.string().role("credential-ref")`，`:943`）。

### 1.2 但持久化层**没有内容级黑名单**（这是要登记的结构性风险）

`dsh-session-persistence-jsonl/lib/index.js:178-180`：

```js
function eventLines(events, packChunks) {
    return (packChunks ? packChunkRuns(events) : events).map((record) => JSON.stringify(encodeProvenanceForStorage(record))).join("\n");
}
```

只有 `encodeProvenanceForStorage`（压缩 `sourceEventSeqs` 的 seq 区间），**无 sanitize / redact**。
该文件全文检索 `sanitize|redact|whitelist|allowlist|headers|authorization|apiKey|secret` → **零匹配**。

写入前的唯一校验是**信封外层键白名单**（`type/seq/time/data/surfaceOp/sourceEventSeqs/ignorable`，
`dsh-session/lib/index.js:1114-1139`）与「`data` 必须可 JSON 序列化」（`:1409-1410`）——
即 **`data` 里放什么都会被原样写入**。

> **风险登记**：上游之所以安全，靠的是「请求记录结构里本来就没有凭据」。
> 若**任何插件**错误地把 key 放进 `session.append(type, data)` 的 `data`，会被静默明文落盘。
> 我方插件已核（`packages/src` 全文检索 `dsht-token|.credentials.yaml|apiKey|keyValue`，命中项均为
> 文件写入或引用名，**无 session.append 携带凭据值**）。但这是一条**值得常驻门禁守**的纪律
> ——见 §5「建议的门禁」。

### 1.3 我方标记字段的注入点与**恢复语义风险**

我方插件需要在会话事件里携带结构化标记（回退锚点、影子区间、快照来源等）。**合法载体只有一个**：

`dsht-plugin-shared/session-write.ts:213-241`：

```ts
/**
 * 合法 plugin source 的形态（官方 `pluginSourceValue` 白名单）：
 *   { kind:'plugin', plugin:string, form?, sections?, summary? }
 * 其它任何键（rolledBackTo / regeneratedFrom / editedFrom / thData / oneshot…）
 * 都会被 v0→v1 迁移器判 `source has unexpected member "X"`，整会话打不开。
 */
export interface MarkerSource {
  kind: 'plugin'
  plugin: string
  form: 'snapshot'
  sections: Array<{ name: string; text: string }>
}
```

即：把结构化标记 **JSON 序列化后塞进 `sections[].text`**，段落名用 `dsht:<kind>` 前缀
（`MARKER_PREFIX = 'dsht:'`，`session-write.ts:226`），读侧由 `readMarker()`（`:246-258`）解出。

**恢复语义风险（实证过的两类）**：

| 风险 | 形态 | 后果 | 现状 |
|---|---|---|---|
| **顶层自定义键** | `source.rolledBackTo` / `regeneratedFrom` / `editedFrom`（0.1.2 时代写法） | 迁移器判 `source has unexpected member` ⇒ **整会话打不开** | 已收敛：新代码一律走 `sections`；存量会话由 `readLegacySourceKeys()`（`session-write.ts:265+`）先读出来再迁移 |
| **`surfaceOp` 字段名代次** | 0.1.2 用 `start`/`end`，0.1.5 要求 `startSeq`/`endSeq` | 写错代次 ⇒ `carries an invalid replace surfaceOp` | 已收敛：`build('current')` 优先、失败降级 `legacy` 并**进程级缓存**（`session-write.ts:85-117`），且有 `isInvalidSurfaceOpError()` 精确判别（`:120-123`） |

**为什么这类风险特别危险**：标记是**恢复语义**的载体。写坏了不是「少个功能」，
而是**整个会话打不开**（数据在，但读不出来）——属于本项目最忌讳的「静默数据不可用」。

---

## 2. 问题②：Keystore 静态加密对 runtime IO 的开销

### 2.1 项目内**零** Keystore / 静态加密用法

全库检索 `Keystore|KeyStore|EncryptedFile|MasterKey|androidx\.security|Cipher|KeyGenParameterSpec|AndroidKeyStore` → **无匹配**。

依赖面实测（`android/app/build.gradle.kts:85-97`）：只有 `core-ktx` / `appcompat` / `webkit` / Shizuku 两件套
——**无 `androidx.security:security-crypto`**。旁证：`SHIZUKU-RESEARCH-2026-09-21.md:53-54` 记载项目
「零非 AndroidX 依赖」，接 Shizuku 是**第一个**第三方依赖。

⇒ **没有「Keystore 加密开销」的直接实测数据**（该功能从未立项）。本节只能给出**可测依据（分母 + 方法）**。

### 2.2 可测依据：IO 规模的**分母**

| 量 | 数值 | 证据 |
|---|---|---|
| 首启解压文件数 | **24,453** 个小文件 | `C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md:46` |
| 同批系统调用 | 近 10 万次（`mkdirs` 24453 + `utimes` 24453 + …） | 同上 `:47-49` |
| 首启解压耗时 | **≈350 秒（≈4 分钟）** | 同上 `:53-54`；`LEARNINGS.md:2527`「≈4 min」 |
| 会话 jsonl | **高频 append**，且 Android 上为**明文**（`compression:'none'` 平台补丁） | `apply-platform-patches.py:565-590`；`DATA-DIR-EVAL-2026-09-21.md:33` |
| 瓶颈归因 | **不是解压算法，是「小文件风暴」** | `C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md:42` |

**关键推论点**：`C-ANDROID-HARNESS-ASSESSMENT` 已把瓶颈定案为「小文件风暴」（每文件固定成本 × 2.4 万）。
而 Keystore 静态加密同样是**「每文件一次加解密」**——边际成本可直接乘在 24,453 这个分母上，
**与已实测的瓶颈同源叠加**。

**可复用的测量方法**（若将来要立项实测）：`B-DEVICE-VERIFY-CHECKLIST.md:213-224`
给出了 logcat 时间戳法（「`extracting runtime` → `extract done` 的间隔 = 真实解压耗时」），
可直接改为「开启/关闭加密两次测同一区间」的 A/B。

---

## 3. 问题③：现状威胁模型

### 3.1 资产与驻地

全部用户数据在 **App 私有目录** `filesDir/.dsh`（`$DSH_HOME`；`NodeService.kt:1231`、`MainActivity.kt:2148-2149`）：

- 会话 jsonl（明文，未 zstd 压缩）
- 凭据 `$DSH_HOME/.credentials.yaml`（**明文 YAML，mode 0600**）
- RP 工作区 / 技能 / 预设 / 快照 / 审计日志

### 3.2 边界（**有实证**）

| 边界 | 结论 | 证据 |
|---|---|---|
| shell 域（uid 2000）读私有目录 | **读不到**：`Permission denied` | `SHIZUKU-RESEARCH-2026-09-21.md:70-77` 实测 |
| SELinux 域隔离 | app = `u:r:untrusted_app:s0`，shell = `u:r:shell:s0`（不同域） | 同上 `:89-91` |
| `app_data_file` 的 execve | **必拒**（avc 实证）⇒ 伪装 `.so` 必须放 `nativeLibraryDir` | `NodeService.kt:52-53` |
| 系统备份 | `android:allowBackup="false"` ⇒ adb backup / 云备份拿不走私有目录 | `AndroidManifest.xml:25` |
| App 内备份导出 | 凭据**排除在外**（`BACKUP_EXCLUDE`） | `MainActivity.kt:84-89`、`:1517` |
| 交换目录（W-6） | 凭据**双向拒绝映射** | `ExchangeDir.kt:25-26, 44-49` |
| 凭据文件权限 | 启动时**强制** 0600，否则拒绝启动 | `dsh-credentials-local/lib/index.js:92-106` |

### 3.3 攻击者能力与**已知空白**

| 场景 | 现状覆盖 |
|---|---|
| 同设备第三方 App | ✅ 覆盖（SELinux 沙箱 + 私有目录） |
| adb / shell 用户 | ✅ 覆盖（实测 `Permission denied`） |
| 备份/同步外泄 | ✅ 覆盖（凭据不进备份、不进交换目录；`allowBackup=false`） |
| **root / 已解锁 BL 设备** | ❌ **无覆盖**（无实证记录；root 可读私有目录） |
| **同 uid 恶意进程** | ❌ 无讨论 |
| **物理取证（取芯片读存储）** | ❌ 无讨论 |
| 真机 SELinux 策略差异 | ⚠️ 已在 `MOBILE-TEST-METHODOLOGY.md:3061` 登记为未闭合复核项（现有实证来自模拟器/特定真机） |

> **诚实边界**：项目内**没有**独立的威胁模型文档；现有论述散落在 gap 表 B3 行与迁移评估段落里。
> 本报告 §3.3 是首次把「攻击者能力 / 资产 / 边界 / 空白」成表。

---

## 4. 决策：**维持现状**（不引入 Keystore 静态加密）

### 4.1 理由

1. **增量价值集中在已被别的措施覆盖的场景**。Keystore 静态加密的收益主要是「数据文件被拿走」——
   而本项目已用「凭据不进备份」「`allowBackup=false`」「交换目录凭据双向拒绝」把**凭据外泄面**封住；
   剩余收益仅剩「root / 物理取证」——这两类场景下 Keystore 的**密钥保护同样由设备安全模块决定**，
   收益有限且需要单独论证。
2. **代价与已知瓶颈同源叠加**。加密是「每文件一次」，而本项目已实测的瓶颈正是「2.4 万文件的小文件风暴」
   （≈350 秒）。在 IO 路径上加每文件加解密，**会直接乘在这个分母上**。
3. **会牵动数据兼容面**。会话 jsonl 的读写不止我方（官方 persistence 层 + 我方手术式读写
   `session-surgery.ts` / `session-write.ts`），加解密若下沉到文件层，需保证**所有读写路径统一**，
   否则会出现「一半加密一半明文」的静默不可用（与 §1.3 同族风险）。

### 4.2 **推翻条件**（什么情况下应重新立项）

任一条成立即重估：

1. **出现真实外泄案例**或用户明确提出「设备被拿走」的威胁诉求；
2. 用户数据面迁到**公共目录 / 云同步**（当前 `DATA-DIR-EVAL` 已定案「不迁」，若该决策反转则必须重估）；
3. 官方 DSH **上游**引入凭据/会话加密机制（届时跟进而非自造）；
4. 实测证明「每文件加密」在 2.4 万文件上的增量 **< 首启耗时的 10%**（即可忽略），
   且能一次性覆盖全部读写路径——此时成本论据不再成立。

### 4.3 本报告**新增**的两条可执行建议（不依赖上面的决策）

1. **`data` 内容级纪律**（§1.2）：加一条常驻门禁，断言我方插件的所有 `session.append(...)` 调用
   其 `data` 参数**不出现凭据形态的值**。理由：上游没有内容级脱敏，一旦写错就是**明文静默落盘**。
2. **标记载体纪律**（§1.3）：加一条常驻门禁，断言我方写入 `source` 时只用
   `markerSource()`（`form:'snapshot'` + `sections`），**不出现顶层自定义键**。
   理由：顶层自定义键会让**整会话打不开**（已实证）。

---

## 5. 参考

- [GOAL-DSH-ANDROID-COMPLETE](GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md) §三 W-9
- [SHIZUKU-RESEARCH](SHIZUKU-RESEARCH-2026-09-21.md) §2.3（shell 域读私有目录实测）、§2.4（域对照表）
- [C-ANDROID-HARNESS-ASSESSMENT](C-ANDROID-HARNESS-ASSESSMENT-2026-09-13.md)（2.4 万文件风暴的量化与归因）
- [DATA-DIR-EVAL](DATA-DIR-EVAL-2026-09-21.md)（「不迁公共目录」的定案与理由）
- [GOAL-ANDROID-GAP](GOAL-ANDROID-GAP-2026-09-21.md) B3 行（原「缓议」判断与威胁模型口径）
- [B-DEVICE-VERIFY-CHECKLIST](B-DEVICE-VERIFY-CHECKLIST.md)（解压耗时的可复用测量方法）
- 代码：`dsh-credentials-local/lib/index.js`（凭据明文 0600）、`dsh-session-persistence-jsonl/lib/index.js`（无 redact）、
  [session-write.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-plugin-shared/session-write.ts)（标记载体白名单）
