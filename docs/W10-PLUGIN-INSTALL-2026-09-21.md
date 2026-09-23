# W-10 插件安装通道调研（2026-09-21）

> **任务来源**：[GOAL-DSH-ANDROID-COMPLETE](GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md) §三 W-10
> **要求**：App 内从 ZIP/GitHub URL 装 RP 插件 —— 先调研 DSH 插件加载机制的**外部目录注入点**，可行再实施（独立插件区 / 懒加载 / 冲突出声）。
> **验收**：调研明确注入点；实施则 ZIP 装进 → 可用 → 卸载无残留。
> **结论先行**：**注入点已明确（3 个）**；但**当前不具备「实施」的完整条件**——缺「卸载无残留」与「冲突出声」两个必需面，且本案已定位一处**必须先修**的既有脆弱点（`NodeService` 子串幂等判据）。故 **W-10 本轮收口为「调研 + 注入点定案 + 实施前置条件清单」**，实施另立一轮。

---

## 1. 注入点（本调研的核心交付）

### 1.1 插件列表是怎么被组装出来的

`dsh/lib/profile-boot-*.js:232-257` 的 `composeProfile()`：把四层 patch **flatten 成一个列表**，再一次性套在**空数组**上。

```js
for (const row of composeEntries([
    bundlePatches,      // ① dsh.profile.bundles 各包的 dsh.bundle.patch
    profile.patches,    // ② profile 的 cordis.patch.yml
    homePatches,        // ③ $DSH_HOME/cordis.patch.yml
    overlays            // ④ --patch <file> 命令行叠加层
])) if (typeof row.id === "string") rows.set(row.id, row);
```

基座是空的（`dsh-app-boot/lib/index.js:904-909`：`applyEntryPatches([], …)`），
所以**所有插件行都是 patch 出来的** ⇒ patch 就是唯一注入面。

**多顶层 `- insert:` 块是合法的**（`dsh-app-boot/lib/index.js:85`：`data.push(...insert)`）——
这正是我方 `NodeService` 采用追加式写入的依据，也是**「独立插件区」的天然载体**。

### 1.2 ★ 注入点 A（首选）：`name` 写路径 —— 官方**显式支持**，无需 pnpm

`dsh-app-boot/lib/index.js:1169-1178`：

```js
function anchorInsertedPluginNames(patches, file) {
	const base = dirname(resolve(file));
	const visit = (entry) => {
		if (typeof entry.name === "string" && (isAbsolute(entry.name) || entry.name.startsWith("./") || entry.name.startsWith("../")))
			entry.name = pathToFileURL(resolve(base, entry.name)).href;
		...
	};
	for (const patch of patches) patch.insert?.forEach(visit);
	return patches;
}
```

**含义**：patch 里 `- insert: - name: /abs/path/plugin.js`（或 `./rel`、`../rel`，相对**该 patch 文件所在目录**）
会被自动转成 `file://` URL ⇒ 直接加载。**不需要 pnpm、不需要改 `dsh.profile.bundles`、不需要包是合法 npm 包**。

> **这是 App 装插件最干净的通道**：把插件解到 App 私有目录的某个「插件区」，
> 在 `cordis.patch.yml` 追加一行指向它的绝对路径即可。

### 1.3 注入点 B：裸包名（我方现状）

`cordis-plugin-loader/src/config/tree.ts:112-129`：裸包名走 Node 内部 ESM loader，
`parentURL = this.ctx.baseUrl`。而 `ctx.baseUrl` 由 root Include 的配置文件位置决定
（`dsh-app-boot/lib/index.js:146-148` + `profile-boot:304`），即
**`file:///…/.dsh/profiles/web/`** ⇒ 裸包名从 **`profiles/web/node_modules/`** 解析。

这与我方 `NodeService.kt:414-415` 的注释完全一致（「loader 的包名解析基准是 profile 目录」），
也是 W-3 事故的诊断根基。

### 1.4 注入点 C：`--patch <file>` 命令行叠加层

`dsh/lib/bin.js:85`（`option("--patch <path>", …, collect)`，可重复）。
Android 侧 argv 由 `NodeService.kt:844` 拼装 ⇒ 可扩展。**但需改原生层**，且它的语义是「额外 patch 文件」，
与注入点 A 相比没有额外收益 ⇒ **不推荐**。

### 1.5 **不可用**的候选（穷举，避免后人重走）

| 候选 | 判定 | 依据 |
|---|---|---|
| `.dsh-module-fallback/node_modules/` | ❌ **会被自动回收** | `healProfileModuleFallback()`（`dsh-app-boot/lib/index.js:711-739`）每次 boot 反向删除不在 bundle 依赖闭包里的链接（`:730` `removeProfileSymlink`）；手工放普通目录会被 `ensureSymlink`（`:416`）抛错 |
| `$DSH_HOME/.dsh/profiles/node_modules/` | ❌ 同上（是**安装包自身**的依赖闭包镜像，非用户目录） | `healProfilesModuleFallback()`（`:657-667`） |
| env 变量（`DSH_PLUGIN_DIR` / `NODE_PATH` 等） | ❌ **不存在** | 全库无读取点；且 `BOOTSTRAP_NAMES` 含 `NODE_PATH`、`BOOTSTRAP_PREFIXES` 含 `DSH_`（`:948-1005`），在 `.env` 里声明这些名字**直接 throw**（`:1051-1057`） |
| `bareModuleBaseUrl`（loader 配置） | ❌ 代码存在但 CLI 不启用 | `dsh-app-boot/lib/index.js:1322-1333` 定义了 hook，但 `runProfile` 调 `boot()` 时**没传该参数**（`profile-boot:311-319`） |
| `Loader.Config.baseUrl` | ❌ CLI 不可达 | `cordis-plugin-loader/src/index.ts:60-63`；Loader 由 `boot()` 无 config 挂载（`dsh-app-boot/lib/index.js:1531`） |
| `additionalBundles` / 配置文件 `overlays` 字段 | ❌ **不存在** | 全库无此标识符（`overlays` 只是内部变量名） |
| **懒加载** | ❌ **机制不存在** | 所有 entry 在 boot 时并发挂载（`cordis-plugin-loader/src/index.ts:129-166`） |

### 1.6 `dsh plugin add` 的真实语义（为什么 Android 不能照抄）

`dsh/lib/plugin-*.js:101-128`：它只是 **pnpm 转发器** —— 在 profile 目录跑 `pnpm <args>`，
成功后 `reconcilePlugins()` 扫描 `dependencies`，把**声明了 `dsh.bundle.patch` 的依赖**追加进 `dsh.profile.bundles`（`:46-78`）。

关键事实：
- **它完全不碰 `cordis.patch.yml`**（该文件 129 行里没有 import 任何 patch 符号）；
- **强依赖 pnpm 可执行文件**（`spawnSync("pnpm", …)`，`:109`；缺失报 `pnpm not found on PATH`）；
- **没有 ZIP 支持**：pnpm tarball 是 `.tar.gz`，装 ZIP 必须先解成目录再 `pnpm add <dir>`；
- **Android 上没有 pnpm**（`packages/src/dsh-plugin/cordis.patch.yml:20-21` 已记录「APK 里没有 pnpm 那套流程」；
  `NodeService.kt` 也从未探测/调用它）。

⇒ **Android 侧的插件安装必须走注入点 A（直接写 path 到 patch），不能依赖 `dsh plugin add`。**

---

## 2. 冲突与卸载（**当前的两个硬缺口**）

### 2.1 冲突：**没有检测机制**，是「最后者胜」

- patch 阶段：`applyEntryPatches()` 用 `Map` 建索引（`dsh-app-boot/lib/index.js:62-69`），`Map.set` 同键**静默覆盖**，无 warn/throw。
- 运行时：`EntryGroup.create()` 用 `this.tree.store[id] ??= new Entry(...)` + `update(options, true, true)`
  （`cordis-plugin-loader/src/config/group.ts:20-29`）—— 已存在则**复用并替换 options**。
- 唯一有防碰撞的地方是**匿名 id 生成**（`tree.ts:51-58` 的 `do…while`），**显式给了 `id` 就直接用，不校验唯一性**。

⇒ **后果**：两个包声明同一 `id` ⇒ 后者覆盖前者（或匿名行重复挂载）⇒ route/settings/slot 冲突，
**而没有任何一处会报「id 冲突」**。

> 我方已有相关风险登记：`packages/src/dsh-plugin/cordis.patch.yml:26-27` 写明
> 「若将来 Android 也把本包加进 bundles，必须同时移除 NodeService 的 insert 写入，否则会**重复注册**」。

**好消息**：装载失败是 **loud fail**（`assertEntriesLoaded` `:1434-1440` / `assertEntriesActivated` `:1465-1493`），
即「写错」会在启动时明确报出来（W-3 事故即由此暴露）。但「id 冲突」本身不报。

### 2.2 卸载：**官方无 patch 行清理，Android 侧也无对称删除**

| 面 | 有无自动清理 |
|---|---|
| `node_modules/<pkg>`（bundles 通道） | ✅ `pnpm remove` 自动 |
| `dependencies.<pkg>` | ✅ pnpm 自动 |
| `dsh.profile.bundles` | ✅ `reconcilePlugins()` 自动摘（`plugin-*.js:61-68`） |
| **`cordis.patch.yml` 的 insert 行** | ❌ **无人清理**（官方完全不碰该文件） |
| **Android 的包目录** | ❌ **无通道**——`ensureRpPluginPatch()` 只有「拷贝 + 追加」 |

我方 Android 侧现状（`NodeService.kt:418-514`）的幂等策略 = 「空模板填充 `[]` 占位；否则只**追加缺失的顶层 insert 块**，已有块永不重写」
（`:494-510`）。**卸载路径只有一条硬编码的遗留清理**（`dsht-rp-ui`，`:434-435` 删目录 + `:484-493` 按行过滤摘 patch 行）。

⇒ **「卸载无残留」当前不可达**，须先补对称的删除通道。

### 2.3 ⚠️ 一处**必须先修**的既有脆弱点（本调研的额外发现）

`NodeService.kt:502` 的幂等判据是**子串匹配**：

```kotlin
val missing = pluginRows.filter { (_, pkg) -> !text.contains("name: '$pkg'") }
```

**没有语义解析**。若 patch 文本里任何位置出现 `name: 'dsht-plugin-mvu'`（例如注释、或被注释掉的行），
该包会被**误判为已安装而跳过**，且**卸载后残留**同样会被误判。

> 这与 W-3 事故同族（都是「看起来对、静默不做」）。**建议在任何「装插件」实施之前先把它改成结构化判定**
> （解析出 insert 行的 name 集合，而非子串搜索）。

---

## 3. App 侧可复用的既有能力

| 能力 | 现状 | 可复用度 |
|---|---|---|
| **ZIP 解包（浏览器侧）** | `packages/src/import/data-zip.ts:16, 294-295`（JSZip）+ **反斜杠路径归一化**（`:139, 312`，对 Windows 压缩工具产出的 ZIP 必需） | ✅ 直接复用 |
| **分片上传 → 落盘** | `import-center.html:480-496, 535`（`/dsht-rp/rp/import-stage` 分片 POST） | ✅ 直接复用 |
| **GitHub 出站范式** | `packages/src/dsht-plugin-shared/update-feed.ts:13, 30-34, 60`（`UpdateFeedKind = 'github' \| 'json'`、Releases URL 识别、`tag_name` 解析） | ✅ 直接复用 |
| `INTERNET` 权限 | `AndroidManifest.xml:5` | ✅ 已有 |
| **Android 原生 HTTP 客户端** | ❌ 未找到 OkHttp / HttpURLConnection 用法（全部命中是注释或字符串拼接） | — |
| **Android 原生 ZIP 解包** | ❌ 未找到 | — |
| **App 内插件安装 UI/路由** | ❌ 未找到（现有路由服务于 ST 数据迁移） | — |

**关键说明**：App 侧唯一网络面是**自写入站代理**（`NodeService.kt:1026-1126` 的 `LanProxy`，纯字节转发，鉴权交给 DSH 的 token 栅栏），
**不是出站下载**。⇒ 出站下载应走 **Node 侧**（已有 `update-feed.ts` 范式），而非原生层。

---

## 4. 决策与实施前置条件

### 4.1 决策

**本轮收口为「调研 + 注入点定案」**（符合任务原文「先调研…可行再实施」的次序）。

**推荐实施方案（下一轮）**——基于注入点 A 的「独立插件区」：

```
$DSH_HOME/plugins/<pkg>/            ← 独立插件区（App 私有目录内，SELinux 保护）
        ├── package.json            ← 校验形态（name/version/main）
        └── lib/index.js
cordis.patch.yml:
    - insert:
        - id: user-<pkg>
          name: '/data/data/<pkg>/files/.dsh/plugins/<pkg>/lib/index.js'   ← 绝对路径 → file:// (注入点 A)
```

理由：
- **不需要 pnpm**（Android 上没有）✅
- **不需要是合法 npm 包**（可只放单文件产物）✅
- **与内置插件物理隔离**（独立目录 + 独立 id 前缀）⇒ 升级 runtime 不会误删用户插件 ✅
- **卸载 = 删目录 + 摘该行**，语义清晰可实现 ✅
- 与 `.dsh-module-fallback` 不同，该目录**不会被 loader 自动回收**（它不是 fallback 目录）✅

### 4.2 **实施前置条件清单**（缺一不可，均为本轮调研新识别）

1. **修 `NodeService` 的子串幂等判据**（§2.3）——否则「装了不生效 / 卸了还残留」且静默。
2. **补对称的卸载通道**（§2.2）——「删包目录 + 摘 patch 行」，且必须**幂等**。
3. **自建冲突出声**（§2.1）——在写入前检测「`id` 已存在」与「`name` 路径重复」，冲突则拒绝并明确报出。
4. **ZIP 形态校验**——包内必须有可解析的 `package.json` 且 `main` 指向存在的文件；
   不合法时**拒绝安装并说明原因**（而非装进去再在启动时炸）。
5. **卸载残留的判据**——定义「无残留」的可测口径（目录已删 / patch 行已摘 / 下次启动 loader 不再引用）。

### 4.3 明确**不采用**的方案（附理由）

- **照抄 `dsh plugin add`**：Android 无 pnpm；且它走 `dsh.profile.bundles` 通道，语义是「npm 包依赖闭包」，
  与「用户手装单文件插件」不匹配。
- **用 `.dsh-module-fallback` 当插件区**：会被 boot 自动回收（§1.5）。
- **依赖环境变量注入目录**：不存在这样的变量；且 `DSH_*` 前缀在 `.env` 里声明会直接 throw。
- **做懒加载**：loader 无此机制（§1.5），自造会破坏 `assertEntriesLoaded` 的启动校验语义。

---

## 5. 参考

- 代码：`dsh-app-boot/lib/index.js`（`anchorInsertedPluginNames` :1169-1178 · `applyEntryPatches` :59-108 ·
  `healProfileModuleFallback` :711-739 · `assertEntriesLoaded` :1434-1440）
- 代码：`cordis-plugin-loader/src/config/tree.ts`（`import` :112-129）· `src/config/group.ts`（`create` :20-29）
- 代码：`dsh/lib/plugin-*.js`（`reconcilePlugins` :46-78 · `runPlugin` :101-128）· `dsh/lib/bin.js:85`
- 代码：[NodeService.kt](file:///d:/DSH%20RolePlay/rp-workspace/android/app/src/main/java/com/dshtavern/app/NodeService.kt)（`ensureRpPluginPatch` :418-514）
- 代码：[data-zip.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/import/data-zip.ts) · [update-feed.ts](file:///d:/DSH%20RolePlay/rp-workspace/packages/src/dsht-plugin-shared/update-feed.ts)
- [GOAL-DSH-ANDROID-COMPLETE](GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md) §三 W-10 · [W-3 事故记录](W3-DEVICE-TOOLS-DESIGN-2026-09-21.md)
