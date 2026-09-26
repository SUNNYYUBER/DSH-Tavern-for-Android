# DSHTavern 全面项目体检报告（2026-09-26）

> **执行**：DSH 会话（Lead + 4 个并行审计员）。工作目录 `D:\DSH RolePlay`。
> **基线**：HEAD `b837ece`（与 origin/main 同步）· versionName `0.2.7` / versionCode 9 · 内嵌 DSH runtime `0.1.7-rc.1`
> **方法**：静态核对 + **实测执行** + **模拟器真机面实证**。四条独立审计线，写入范围互不重叠，
> Lead 对全部高严重度结论做**独立复验**（复验记录见 `tmp/healthcheck/LEAD-VERIFICATION-NOTES.md`）。
> **纪律**：本报告遵守项目自身铁律 —— 只贴结论不算证据、未实测必须写「未实测」、失败必须出声。

## 分册索引（细节在这四份，本报告只做结论汇总）

| 分册 | 内容 | 规模 |
|---|---|---|
| [A：文档偏差](HEALTHCHECK-A-DOC-DRIFT-2026-09-26.md) | 文档声称 vs 代码/产物实际的 18 条偏差 | 410 行 |
| [B：门禁审计](HEALTHCHECK-B-GATE-AUDIT-2026-09-26.md) | 55 条门禁全表：真常驻 51 / 只声明 4 / 时序失效 3 | 611 行 |
| [C：真机面实证](HEALTHCHECK-C-DEVICE-2026-09-26.md) | 模拟器实测 v0.2.7（含 boot loop / 迁移 / 备份） | 603 行 |
| [D：资产与隐患](HEALTHCHECK-D-ASSET-DRIFT-2026-09-26.md) | 资产流失 / 悬空引用 / 结构性隐患 | 577 行 |
| Lead 复验记录 | 对 teammate 结论的独立复验与校正 | `tmp/healthcheck/LEAD-VERIFICATION-NOTES.md` |

---

# 一、一句话结论

**项目的工程质量远高于「个人业余项目」的平均水平，但它有一个致命的不对称：
「对外门面」与「对内事实」之间没有机器守，凡是没门禁守的面都已系统性背离。**

具体说：

- **硬骨头都啃下来了**：安卓上跑 DSH 运行时（bionic 原生路线）、v3→v4 会话格式迁移、
  55 条自研门禁、267 个子包零版本漂移、六类泄露闸门全清、release 产物哈希可验证。
- **软肋全在「声称与事实之间」**：README 落后 5 个版本、贡献者文档照做必失败、
  面板显示「API 已连接」而实际零凭据、发消息静默失败无任何提示。
- **这不是能力问题，是投资错配**：项目把防御投在了它熟悉的地方（构建链、数据层），
  漏在了它不熟悉的地方（对外文档、UI 诚实性、开发环境一致性）。

**体检直接改善了这一点**：本次 4 条高严重度发现中，有 3 条是**照现有文档/UI 走会踩的坑**。

---

# 二、体检结果总览

| 审计线 | 结论 | 计数 |
|---|---|---|
| A 文档偏差 | 门面信息已系统性滞后 | **18 条**（🔴7 / 🟡9 / 🟢2） |
| B 门禁审计 | 骨架真实（51 真常驻），但有只声明 4 + 时序失效 3 + 2 个 Python 门禁本机裸跑必崩 | **55 条**（真常驻 51 / 只声明 4 / 时序失效 3） |
| C 真机面实证 | 启动链健康，交互链有真缺陷 | **通过 10 / 未通过 2 / 未验 6**（另撤回 3） |
| D 资产与隐患 | 有知识资产流失与结构隐患 | **资产流失 3 / 悬空引用 5 / 结构隐患 7** |
| Lead 复验 | 双向纠错后 6 条高严重度结论落定 | 推翻 teammate 2 条 · 被 teammate 反证 1 条 · 收口虚警 1 条 |

## 健康面（实测通过，可放心）

| 项 | 实测证据 | 判定 |
|---|---|---|
| **版本单源一致** | `audit-dsh-version.mjs` → **5 OK / 0 FAIL**；267 个子包全部 `0.1.7-rc.1`，零漂移 | ✅ |
| **平台补丁完整** | `apply-platform-patches.py --check` → **20 项已打 / 0 失败** | ✅ |
| **RP 兼容层测试** | **86 文件 / 1846 通过 / 2 skipped**（需先 `vendor-deps.mjs`，见 🔴-2） | ✅ |
| **类型检查** | 三段式（core/ui/tests）**全 0 错** | ✅ |
| **六类泄露闸门** | 825 个受控文件，SECRET/WXID/LOCALPATH/SERVER/PAYLOAD/WORDLIST **全 0 命中** | ✅ |
| **release 产物可验证** | 本地 arm64 APK SHA256 **与 release notes 逐位一致**（`E57899A6…7754E7`） | ✅ |
| **启动链无 boot loop** | 模拟器冷启动：`starting node (attempt` **= 1 次**（历史事故 253 次）；FATAL/SIGSEGV/ANR 全 0；pid 稳定 8 分钟 | ✅ |
| **Web 服务真实可用** | `/proc/net/tcp` LISTEN + `nc 3080` 返 `HTTP/1.1 200 OK`；token 与落盘一致 | ✅ |
| **迁移机制可用** | v3 原文件保留 + 生成 `version:4` 新文件；界面显示 `mig-test · 37 事件` 可读 | ✅ |
| **备份闸门生效** | `dsht-prebak-*.zip` 生成 2 份（80/85 条目），凭据条目 **0 条** | ✅ |
| **P1 工具链** | bash/rg/zstd/git 自检全 `rc=0`，`links ready (8/8)` | ✅ |

## 缺陷面（按严重度）

| # | 严重度 | 缺陷 | 证据位置 |
|---|---|---|---|
| 1 | 🔴 | **发消息静默吞掉**：时区已修好、无任何报错、输入框清空但服务端零落盘 | C §4 |
| 2 | 🔴 | **贡献者文档照做必失败**：CONTRIBUTING/ONBOARDING 的复现路径缺 `vendor-deps` 一步 | A #2 + 本报告 §三.1 |
| 3 | 🔴 | **RP 面板 API 状态假阳性**：显示「✅ 已连接」而设备上凭据 0 条 | C §5 + 本报告 §三.2 |
| 4 | 🔴 | **README 落后 5 个版本**：中英双语仍写 0.2.2 / DSH 0.1.5-rc.1 | A #1 |
| 5 | 🔴 | **316 个受控文件行尾被静默改写**，无 `.gitattributes`；BOM 类断链复发 6+ 次仍零防御 | D H1 |
| 6 | 🔴 | **`tools-cu/cu.py` 永久流失**：从未入库，`git` 无法找回；文档仍引用 3 处 | D D-01 |
| 7 | 🔴 | **GOAL.md 基线数字漂移 56 条**，且它自己写着「不许沿用旧数字」 | A #3 |
| 8 | 🟡 | 门禁受守面盲区：`MASTER_TODO.md`（自称「唯一活文档」）不在任何引用闸门扫描面内 | D H5 |
| 9 | 🟡 | 核验工具 `apk-plugin-md5.py` 三重不可达（不存在 + 在 gitignore 内 + 文档当唯一手段） | D D-02 |
| 10 | 🟡 | 断链⑦仍敞口：`build-plugins.sh` 源码缺失只打印「跳过」，不 die | D |
| 11 | 🟡 | 知识资产单点风险：`MEMORY.md`、`LEARNINGS.md`(223KB)、`docs-archive/` 全在 gitignore 内 | D H3 |
| 12 | 🟢 | `dsht-backup.json` 的 `entries`/`sessionLogs` 口径未声明清楚（字段名有误导） | Lead 复验 5/6 |
| 13 | 🔴 | **2 个 Python 门禁本机裸跑必崩**（GBK 编码撞 `⇒` 字符）：CI 设了 `PYTHONIOENCODING`，`build-dsht.ps1` 没设 ⇒ 同一份源码本地/CI 结论相反 | B §3.1 |
| 14 | 🔴 | `audit-card-event-surface.mjs` 三重坏态：构建期零调用 + selftest 实跑 2 项 FAIL + 被多处文档点名 | B §3.5.1 |
| 15 | 🟡 | `audit-method-binding` 的 `verifyLib()`：官方库不在场即 `return true` 静默放行（P-30「失效与通过同貌」） | B §3.2 + Lead 复验 7 |
| 16 | 🟡 | A14 重编译比对对「node_modules 布局漂移」不可分辨：体检期间一次 `pnpm install` 即令单跑 A14 报红（完整构建自愈，非源码陈旧） | Lead 复验 7 |

---

# 三、Lead 独立复验（本次体检最关键的 3 条，我亲手做过）

## 三.1 🔴 贡献者文档的复现路径本身是断的 —— 我端到端复现了

**这不是推断，我做了对照实验。**

`dompurify` 与 `handlebars` 被源码静态 import
（`ext-template-render.ts:40-41`），但**既不在 `packages/package.json` 也不在 `pnpm-lock.yaml`**：

```bash
$ grep -c "dompurify" rp-workspace/packages/pnpm-lock.yaml   → 0
$ grep -c "handlebars" rp-workspace/packages/pnpm-lock.yaml  → 0
```

它们是**构建期 vendor 包**，由 `scripts/vendor-deps.mjs` 以 `npm install --no-save` 单独装。
CI 知道这回事（`.github/workflows/build-apk.yml:107` 有这一步），**但三份贡献者文档全没写**：

```bash
$ for f in CONTRIBUTING.md docs/ONBOARDING-15MIN.md README.md; do grep -c vendor-deps "$f"; done
0
0
0
```

**对照实验（我把两个包临时移走，再逐字执行 CONTRIBUTING.md 的命令）**：

| 状态 | 结果 |
|---|---|
| 两个 vendor 包在场 | `Test Files 86 passed (86)` / `Tests 1846 passed \| 2 skipped (1848)` ✅ |
| 移走（≈ 干净克隆） | **`Test Files 6 failed \| 80 passed (86)` / `Tests 1681 passed \| 2 skipped (1683)`** ❌ |
| 还原后复跑 | 回绿 ✅（证明是环境差异，非代码缺陷） |

失败原文：`Failed to resolve import "dompurify" from "src/dsht-rp-ui/src/client/ext-template-render.ts"`。

**为什么这条最该先修**：文档紧接着写「**如果这里不是全绿：先别往下走，开个 Issue**」——
它把「文档自己缺一步」的后果，**写成了「你的环境有问题」**。
这是唯一一条「照做必踩坑且会误导新贡献者」的缺陷，而修它只需两行字。

> **注**：这条同时暴露一个真实结构问题 —— `"test": "vitest run"` **不经过**
> `build-rp-ui.mjs`（那个脚本才调 `ensureVendorDeps` 自愈）⇒ **自愈机制覆盖不到测试路径**。
> 建议把自愈挂到 `pretest`。

## 三.2 🔴 RP 面板「API 连接 ✅ 已连接」是假阳性 —— 我定位到根因行

**三层证据（UI 截图 / 设备实读 / 源码行）**

1. **UI 层**（截图 `tmp/healthcheck/09-import-status.png`，我目视确认）：
   `API 连接　✅ 已连接 deepseek-official（deepseek-flash）`
2. **凭据层**（设备实读）：`.credentials.yaml` 只有 1 条 `client-connection/browser-session`，
   API 凭据 **0 条**；全盘 `grep -rl 'sk-'` 命中的是 `sk-user` **占位符**（非真密钥）
3. **渲染层**（源码定位）：
   - 前端 `MigrationStatusPanel.tsx:151`：`api === null ? '❌ 未配置…' : '✅ 已连接 …'`
   - 后端 `dsh-plugin/index.ts:6943-6944`：
     ```ts
     const sel = ctx.agentDefaultModel?.currentSelection?.()
     if (sel?.provider && sel?.model) api = { provider: sel.provider, model: sel.model }
     ```

**根因**：判据只看「**有没有配置过默认模型**」（provider/model 字段非空），
**不看**「凭据是否存在」「能否真正调用」。⇒ 只要选过模型就显示 ✅，与凭据完全无关。

**性质**：这正是项目 MEMORY.md 点名的**主力缺陷族「静默失败族」**
（"函数在、不抛错、返 200，但没干该干的事"）在 UI 层的又一实例。

**危害在于叠加**：用户同时看到 ①`✅ 已连接` ②发消息无反应 ③无任何报错 ——
三条线索互相矛盾，**极难自查**，且会误以为是网络/模型问题。

## 三.3 🔴 发消息静默吞掉 —— 我独立复现

```bash
$ adb shell "run-as com.dshtavern.app grep -rl 'TZprobe' files/.dsh/sessions/"
（空 —— 服务端零落盘）

$ adb shell "run-as com.dshtavern.app grep -rl 'MISSING_CREDENTIAL' files/.dsh/sessions/"
mig-test/session.v4.jsonl        ← 历史失败消息**有**错误卡片
```

**不对称**：历史回显有错误呈现，**即时发送没有** —— 同一条错误，两条路径处理不一致。
按项目 R8「失败必须出声」，即时发送路径属缺陷。

> **诚实边界**：无 API Key ⇒ 无法判定「有凭据时是否正常」。但**缺陷本身与凭据无关** ——
> 缺凭据时**至少应显示 MISSING_CREDENTIAL**（历史路径就是这么做的），而不是静默清空输入框。

## 三.4 我对 teammate 结论的纠错（双向复核的价值）

我推翻了 teammate **2 条**误判，也被 teammate 反证了**我自己的 1 条**判据错误：

| 项 | 原结论 | 复验后 |
|---|---|---|
| 备份闸门「不含 sessions/rp/state」 | teammate 报为潜在缺口 | ❌ **推翻**：实际含（prebak-000335 sessions 1 / 002329 sessions 4，含 `rp/state`、`rp/variables`）。原因是对方只看了 `namelist()` 前 40 条就外推 |
| 「备份漏了 mig-test 的 v4」 | teammate 报为潜在缺口 | ❌ **推翻**：备份时点 09-24 00:03/00:23，而该会话建于 08:20 / 迁移于 11:31 ⇒ 备份早 8 小时，不含它是**正确行为** |
| 备份「包内 mtime 晚于命名时点」矛盾 | teammate 主动上报、拒绝定论 | ✅ **收口为虚警**：zip 内条目 mtime 被统一改写为备份写入时刻 ⇒ 与设备原文件 mtime 本就不同源，无矛盾。其「GMT +8h 时区口径」假设由 `createdAt="…+0000"` 物证证实 |
| `sessionLogs` 口径「未声明」 | **我**的判断 | ❌ **我被反证**：teammate 定位到唯一匹配口径 = **全包 `.jsonl` 计数**（含 `rp/state/` 状态文件），字段名有误导。我先前统计得 0 是**我自己的路径匹配写错**（zip 路径以 `sessions/` 开头，不含 `/sessions/` 中间段） |

**这条教训值得写进项目方法论**：
- 「倾向某个解释但**拒绝下结论**」的写法，比直接报 bug 或直接放过**都更有价值** ——
  它不污染结论，同时保留线索，使别人能用一条判据迅速收口。
- 本次 4 条高严重度结论全部经过双向复核才落定；**teammate 复核不是形式**。

## 三.5 B 组最重发现的复验：A14 报红成立，但定性需修正（环境漂移 ≠ 源码陈旧）

gate-auditor 报「本工作区当前构建必然失败」（A14 逐字节比对 fail）。我独立复验：

**事实成立**（我逐字复现）：`audit-a14-anchor-negctl` → `2/3 FAIL, EXIT=1`，
重编译 928832 B ≠ 磁盘产物 929551 B，差 719 B —— 与 gate-auditor 的数字完全一致。

**但根因不是「源码改了没重建」**，证据链：
1. 两份产物的文本差异**集中在模块路径标注**：磁盘产物含 **142 处 `.pnpm/` 路径**
   （构建时依赖经 pnpm hoisted 布局解析），我的新编译 **0 处**（扁平解析）
2. ★ `packages/node_modules/.pnpm` 整棵树 mtime = **体检当天 21:49** —— teammate 跑
   `pnpm install` 重建了布局 ⇒ esbuild 写进产物的模块标签随之改变
3. 源码 `git status` 干净、产物 mtime 晚于源码最后提交 ⇒ 排除源码陈旧
4. Step 4.7（重编译产物）在 Step 5.4（A14）之前 ⇒ **完整构建链自愈**，
   仅单跑 A14 / `-SkipInstall` 才会拿旧产物比对

**修正后的定性**：判据本身工作正常（它按设计抓到了字节不一致），
但它对「源码陈旧 / cwd 漂移 / **node_modules 布局漂移**」三种形态**不可分辨**——
第三种是本次新发现的形态，A14 头注里预告的「构建参数/cwd 漂移」分支的变体。

**这条的价值**：A14 免哈希基线的设计前提是「esbuild 确定性」，而这隐含了
「依赖布局不漂移」。**判据的隐含前提本身需要登记** —— 这是 P-41「判据锚到事实」的延伸：
事实 = 源码 + 参数 + cwd + **依赖布局**，少盯一个就会出「真红但错因」。

**另验证 B 组两条均成立**：
- `audit-card-event-surface.mjs --selftest` 实跑 **2 项 FAIL**（表解析应 5 项实得 0）
  —— 「坏的 + 不跑的 + 被文档点名」三态确认；
- `audit-method-binding.mjs:206-207` 的 `verifyLib()` 确为
  `if (!existsSync(SESSION_LIB)) return true` —— 官方库不在场（CI 净环境）即**静默放行**，
  P-40③ 与 P-30「失效与通过同貌」双命中。

---

# 四、项目现在到底怎么样（评价）

## 4.1 被严重低估的部分

这个项目有**三样别人没有的东西**：

**① 一套真正在用的门禁体系。** 不是摆设 —— B 组实测枚举 **55 个门禁脚本，51 个真常驻**
（每个 Step 都有实际调用点），抽测的 selftest 全部真跑真绿（17/17、20/20、14/14、18/18…），
更难得的是它的**判据编号体系（P-1~P-82）+ 正控/负控纪律**，这在同类项目里几乎是独一份。
README 那句「只贴结论不算证据」是**字面执行**的。
（B 组同时找到了它的四个盲区：只声明 4 条、时序失效 3 处、编码不对称 2 个、
受守面漏掉 MASTER_TODO —— 见缺陷表 #13~#16。）

**② 安卓 bionic 原生路线的完整实证。** 包括鸿蒙/卓易通实测跑通（对方容器路线官方标注「未验证」）、
proot 真隔离、phantom process killer 规避。这条路线的工程难度高于容器派，且**已被证明可行**。

**③ 一份诚实的"失败档案"。** `MEMORY.md` 记了 10 类构建/部署断链，
`GOAL-DSH-ANDROID-COMPLETE` 会**主动推翻自己此前的 ✅**。这种自我否定的密度，
在 AI 深度参与的项目里**极其罕见**，也是项目最值钱的复利资产。

## 4.2 被高估的部分（或曰：需要警惕的自我认知）

**「文档齐全」不等于「文档可信」。**
全仓有 474KB 的 `GOAL.md`、461KB 的 `MASTER_TODO.md`、955KB 的方法论文档 ——
但本次实测：**文档可信度可精确由「该面有没有机器守」预测**。
有门禁守的高度可信；门禁声明「不核」或从未纳入扫描面的，**已系统性背离**（18 条偏差即证据）。

这形成一个**反直觉的陷阱**：文档越多，读者越倾向信任，
而**越长的文档越容易漂**（`GOAL.md` 漂 56 条、`MASTER_TODO.md` 有悬空引用无人知）。

**「自研门禁」也不等于「覆盖完整」。** 62 个 `audit-*` 脚本里，
**没有一个管 BOM/行尾** —— 而这类问题已复发 6+ 次（体检当天还在工作区复现）。

## 4.3 最需要正视的一个事实

项目最大的风险**不是技术**，而是**验证债与人力结构**：

- arm64 真机面基本空白（作者只有一台小米 11 Pro）
- `MEMORY.md` / `LEARNINGS.md`(223KB) / `docs-archive/` **全在 gitignore 内** ⇒ 仅存本机，磁盘损坏即知识归零
- 知识闭包在单人 + 单一 AI 会话里，交接成本随时间线性上升

**本次体检的直接贡献**：证明了**模拟器面可以自动化验证**（我独立跑通了冷启动、
boot loop 判定、TCP/HTTP 探针、迁移/备份核验），这为「验证债」提供了一条不依赖真机的通路。

---

# 五、接下来往哪走（建议路线）

> 与项目既定战略（`NEXT-STEPS-2026-09-19.md` §二：harness 防御、插件层主战场、生态协作优先）**一致**。
> 下面是排序建议，不是改向。

## P0 —— 先止血：修「照做必踩坑」与「静默失败」（本轮体检直接产出，成本极低）

| # | 动作 | 成本 | 收益 |
|---|---|---|---|
| P0-1 | 三份贡献者文档补 `vendor-deps.mjs` 一步；并把自愈挂到 `pretest` | ~10 行 | 消除唯一「照做必失败」路径 |
| P0-2 | README 版本号回填（中英双语 0.2.2→0.2.7；DSH 0.1.5-rc.1→0.1.7-rc.1） | ~4 行 | 门面与实际一致 |
| P0-3 | 把 README 纳入版本一致性门禁扫描面（防再次漂移） | 小 | 结构性防复发 |
| P0-4 | RP 面板 API 判据从「配置存在」改锚到「凭据存在」，并出声显示具体原因 | 中 | 消除假绿灯 + 静默失败叠加 |
| P0-5 | 发消息路径补错误呈现（对齐历史路径已有的 MISSING_CREDENTIAL 卡片） | 中 | 用户可自查 |

**建议顺序**：P0-1 → P0-2 → P0-3（一次提交解决文档面）；P0-4 → P0-5（一次提交解决 UI 诚实性面）。

## P1 —— 补结构防线（消除复发 6+ 次的根因）

- **P1-1 建 `.gitattributes`**：`*.ps1 eol=crlf` + `working-tree-encoding=UTF-8`，
  并加「恰好 1 个 BOM」硬闸。
  ⚠️ 注意：`git add --renormalize .` 会产生 316 个文件的「仅换行」diff，**必须独立提交**，
  且按 `MEMORY.md:84` 并发协议（只 add 自己文件、**禁 `git add -A`**）与其他实例协调。
- **P1-2 把 `MASTER_TODO.md` 纳入 `audit-doc-refs.mjs` 受守面**（只加清单项，不改判定逻辑）—— 投入产出比最高。
- **P1-3 断链⑦ 改硬失败**：`build-plugins.sh` 源码缺失时 `die` 而非 `say "跳过"`。
- **P1-4 用 pyautogui 重建 `tools-cu/cu.py` 并入库**（`pyautogui 0.9.54` 实测仍可用，
  13 子命令清单齐全，重建成本低）。同时按 D 组建议**只登记、不动 gitignore** 处理 `MEMORY.md` 等
  单点知识资产，改由离线备份解决。
- **P1-5 修 B 组三条门禁缺陷**（来自 [B 分册](HEALTHCHECK-B-GATE-AUDIT-2026-09-26.md)）：
  ① `build-dsht.ps1` 里给 Python 门禁统一设 `PYTHONIOENCODING=utf-8`（对齐 CI，
  消除「本地裸跑必崩 / CI 绿」的编码不对称）；② `audit-card-event-surface.mjs` 三选一：
  修好 selftest 并接入构建 / 从文档移除点名 / 显式标记废弃（现状「坏的+不跑的+被点名」最差）；
  ③ `audit-method-binding` 的 `verifyLib()` 在库不在场时改记 SKIP 出声（对齐
  `audit-pty-prebuilt --expect-compile` 的既有先例），不留「return true 静默放行」。
- **P1-6 A14 补「布局漂移」维度**：重编译比对时对 `.pnpm` 路径标注做归一化
  （或在报错文案里区分「源码陈旧」与「依赖布局漂移」两种错因）——
  见 §三.5，本次体检期间一次 `pnpm install` 即触发了「真红但错因」。

## P2 —— 回到主战场（项目既定战略）

- **插件层**：RP 兼容层是生态独一份资产，拆包后可进一切 DSH 部署（含 DSHA）。
- **验证债**：本次已证明模拟器面可自动化 ⇒ 建议把 C 组这套流程**沉淀成常驻回归脚本**，
  让「启动链 + 迁移 + 备份」这几项每轮机器验，不再依赖人工。
- **生态协作**：bychv 模式（独立包互相 compose）。

## 明确不建议现在做的

- 不要为了「体检好看」放宽任何判据（违反项目 B11）。
- 不要动 Tier 3（架构性不修，接了也会被拒）。
- 不要在 `.gitattributes` 的 renormalize 与其他人未提交改动混在一起提交。

---

# 六、诚实边界（本次体检没做到的事）

按项目 R7，以下**未实测**，不得当作已验证：

| 项 | 状态 | 原因 |
|---|---|---|
| 真实 LLM 对话闭环 | ⬜ 未验 | 无 API Key（用户凭据，不代填） |
| 真实用户数据上的 v3→v4 迁移安全性 | ⬜ 未验 | 模拟器上只有上一轮留下的**测试 fixture**（`mig-test` 里明写「【迁移测试】」），无真实用户会话 |
| arm64 真机面 | ⬜ 未测 | 无真机；本次全程 x86_64 模拟器 |
| 鸿蒙/卓易通 | ⬜ 未测 | 无设备 |
| M4 内容级核验（169 项/缺失 0）、M7 真实卡抽样 | ⬜ 未测 | 需完整构建链（耗时以小时计），本次未跑 |
| sentinel v390、约 40 项 selftest 分数 | ⬜ 未测 | 同上（A 组已在 §四显式留白） |
| 预设管线、MVU 实际行为 | ⬜ 未测 | 依赖真实卡与凭据 |

**已撤回的结论**（不作为缺陷）：备份闸门不含 sessions（C §3.3.1）、备份漏 v4（C §3.3.2）、
启动页端口未监听（C §4.3，teammate 自行撤回）。

**一处环境前置（影响复现）**：`vendor-deps.mjs` 必须先跑，否则 `pnpm install --frozen-lockfile`
之后的 `test` 会红 —— 这既是 🔴-2 缺陷，也是本报告所有测试数字的**前置条件**。

---

*报告结束。分册见同目录 `HEALTHCHECK-{A,B,C,D}-*.md`；复验原始记录见 `tmp/healthcheck/LEAD-VERIFICATION-NOTES.md`。*
