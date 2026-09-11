# T-25 发布卫生只读预检报告

> 生成：2026-09-11（心跳 59，自动化轮次）· 类型：**只读预检**（未修改任何被扫文件）
> 判据工具：`rp-workspace/scripts/audit-publish-hygiene.mjs`（本报告由它产出，可复跑复现）
> ⚠️ **本报告按与工具相同的掩码口径书写**——域名只留前缀、人名/卡名只留首字，
> 以免「为了清理敏感信息而新增敏感信息」。

---

## 1. 结论摘要

**扫描范围**：`git ls-files` 的 **609 个受控文本文件**（= 真正会被发布出去的发布面）。
**未扫**：`backup/`、`tmp/`、`stage3-device/`、`deepseek-harness/`、`_pending-deploy/` —— 均已在
`.gitignore` 中，不进仓库即不构成发布风险。

| 判据 | 命中 | 严重度 | 说明 |
|---|---|---|---|
| **SECRET** 真实 API 密钥 | **1** | 🔴 **发布阻断** | 用户真实上游密钥被逐字记入受控文档 |
| **WXID** 个人微信 ID | **16** | 🟠 高 | 不可逆的个人身份标识，同一 ID 反复出现 |
| **WORDLIST** 真实卡名/人设名/预设名 | **200** | 🟠 高 | 集中在 2 份文档 + 1 份抓包 |
| **PAYLOAD** 抓包正文 | **8**（约 1.29 MB） | 🟠 高 | 受控 `golden/*.json` 含真实对话正文 |
| **SERVER** 外部服务器地址 | **11**（3 个域名） | 🟡 中 | 真实 provider 网关 + 真实卡脚本托管域 |
| **LOCALPATH** 本机绝对路径 | **70** | 🟡 中 | 泄露本机用户名，多为脚本里的硬编码路径 |
| **合计** | **306** | | |

**发布阻塞判断**：`audit-publish-hygiene.mjs` 当前 **exit 1** ⇒ 按 T-25「一票否决」口径，
**现在不能公开**。清理后退出码归 0 即为达标判据。

**曝光范围（重要，决定紧迫度）**：`git remote -v` **为空** —— 本仓库 **117 个提交从未推送**。
故 Sec1 的密钥**仅存在于本机磁盘与本地 git 历史**，不构成对外事故；
但**若先推送再清理，密钥将永久留在远端历史** ⇒ 必须先清理、后推送。

---

## 2. 逐类明细

### 2.1 SECRET（1）🔴 发布阻断

| 位置 | 形态 | 性质 |
|---|---|---|
| `DSH Android Roleplay App Plan.md:3809` | `sk-REMOVED…`（32 位混合字符） | **用户真实上游 API 密钥**——由用户在某轮对话中粘贴，文档逐字记录 |

- **历史暴露面**：`git log -S` 命中 **1 个提交**（`9a82342`），即密钥自该提交起进入本地历史。
- **修复分两步（缺一不可）**：
  1. **轮换密钥**（只有你能做）——该密钥已在本地明文存在多轮，应按「已泄露」处置；
  2. **清理工作树 + 历史**——仅改文件不够，`9a82342` 仍在历史里。
- **历史清理的代价**：改写历史会**变更全部后续提交的 SHA**（117 个提交）——
  若尚无远端、无协作者，代价可接受；这也是**必须在首次推送之前**做掉的理由。

### 2.2 WXID（16）🟠

| 位置 | 数量 |
|---|---|
| `DSH Android Roleplay App Plan.md` | 15 处（`:911 :2465 :12056 :12069 :12141 :16284 :16356 :19067 :24160 :24610 :24856 :25239 :25608 :25939 :26052`） |
| `rp-workspace/scripts/golden-import.mjs:6` | 1 处 |

- 形态统一（同一个 `wxid_…`），多为 Windows 本机路径片段（`…\xwechat_files\wxid_…\msg\file\…`）。
- `golden-import.mjs:6` 是**脚本默认参数**里的硬编码路径 → 属应改成参数/环境变量的代码缺陷（非纯文档问题）。

### 2.3 WORDLIST（200）🟠

按词聚合（**掩码**显示；词表存于未入库的 `scripts/publish-hygiene-words.txt`）：

| 类别 | 词（掩码） | 命中 | 主要文件 |
|---|---|---|---|
| 预设名 | `狐＊抚`、`毓＊忻` | 42 / 11 | `DSH Android Roleplay App Plan.md`、`MASTER_TODO.md` |
| 角色卡名 | `W＊＊a`、`鸣＊潮`、`Sola＊＊＊s-3` | 41 / 33 / 21 | `AUDIT_TASKLIST.md`、`.workbuddy/memory/2026-09-11.md`、`TASK-LIST.md` |
| 世界书/卡 | `玄＊狐`、`命＊＊诗`、`劣＊＊＊＊＊＊案`、`偶＊＊＊＊L`、`狐＊映` | 13 / 3 / 3 / 1 / 1 | `DSH Android Roleplay App Plan.md`、`golden/dsht/dedup-after.json` |
| 人设 persona | `纪＊者`、`凌＊依`、`克＊雷` | 16 / 8 / 7 | `DSH Android Roleplay App Plan.md`、`docs/archive/IMPORT_REWORK_PLAN.md` |

- 集中度极高：**`DSH Android Roleplay App Plan.md` 一份就占绝大多数**（它是历史对话的逐字归档）。
- 注意 `.workbuddy/memory/*.md` **也在受控面内**（6 个文件）—— 项目记忆文档同样含真实卡名。

### 2.4 PAYLOAD（8，约 1.29 MB）🟠

| 文件 | 体积 | 形态 |
|---|---|---|
| `golden/dsht/dedup-after.json` | 240,693 B | `content`×21 / 长正文×3 |
| `golden/dsht/rx-001.json` | 240,693 B | 同上（与上者同尺寸，疑为同批） |
| `golden/dsht/llm-001.json` | 36,073 B | `content`×2 / 长正文×1 |
| `golden/dsht/llm-002.json` | 33,161 B | 同上 |
| `golden/st/dump-002 / 004 / 006 / 008-*.json` | 各 223,015 B | `content`×25 / 长正文×3 |

- 这些是 **Golden Master 对照用的真实请求体抓包**，含真实世界书正文与对话。
- **注意**：`golden/tt-sampling/` 已被 `.gitignore` 排除，但 `golden/dsht/` 与 `golden/st/` **仍在受控面内**
  —— 属**忽略规则的不一致**（同类内容、两种处置）。

### 2.5 SERVER（11，3 个域名）🟡

| 域名（掩码） | 命中 | 位置 |
|---|---|---|
| `api.comm＊＊＊.ai` | 5 | `DSH Android Roleplay App Plan.md:12159`、`docs/archive/IMPORT_REWORK_PLAN.md:215,402`、`golden/dsht/llm-001.json:6`、`llm-002.json:6` |
| `api.silic＊＊＊＊＊.com` | 4 | `DSH Android Roleplay App Plan.md:6036,6048,6269,6350` |
| `jnai2d9k＊＊＊＊＊＊.com` | 2 | `TASK-LIST.md:293`、**`rp-workspace/packages/src/dsht-rp-ui/src/client/host-vendor.ts:130`** |

- 前两者 = 用户实际使用的 provider 网关（属"真实服务器地址"）。
- 第三者是**卡脚本的托管域名**，且已**嵌入产品源码注释**（`host-vendor.ts`）→ 清理时须同步改注释，
  否则留一个"看起来是配置"的地址。

### 2.6 LOCALPATH（70）🟡

分布在 **24 个文件**，形态两类：
1. **构建/脚本硬编码本机路径**：`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`
   （`build-dsht.ps1:31`、`build-wb.sh:22`、`docs/archive/UPDATE-SOP.md:14`）——暴露本机 JDK 安装与用户名；
2. **探针脚本默认参数**（`golden-*.mjs`、`stage4-regression.mjs`、`env-restore.sh`、`tools-cu/cu.py` 等）。
3. `.workbuddy/memory/*.md`（3 个文件）。

> 判别：这一类**多数不构成"人名/卡名/服务器地址"**（T-25 的原文判据），
> 但 `C:\Users\<用户名>\` 形式确实泄露本机用户名。建议**归入"顺手一起改"**而非阻断项。

---

## 3. 清理方案（分阶段 · 含风险与回滚）

> 前置：**T-25 仍在数据冻结期**（用户指令：全部功能干好之前，仓库 RP 数据冻结不动）。
> 本报告**只做预检、不动任何文件**。下列方案在执行前仍需一次确认。

| 阶段 | 动作 | 风险 | 回滚 |
|---|---|---|---|
| **P0** | 轮换上游密钥（用户侧） | 无（只增新 key） | 保留旧 key 至确认新 key 可用 |
| **P0** | 推送前**必须**先做 P1/P2，否则远端历史永久留密 | — | — |
| **P1** | 清 `golden/dsht/`、`golden/st/dump-00{2,4,6,8}*.json`（1.29 MB 抓包）→ 移出受控面（`git rm --cached` + `.gitignore` 补齐 `golden/dsht/`、`golden/st/`） | 低：文件仍在工作区，可随时取回 | `git restore --staged` |
| **P1** | 脱敏 `DSH Android Roleplay App Plan.md` 的密钥 / `wxid_…` / 真实域名（替换为占位） | 低：纯替换 | `git checkout` |
| **P2** | 改 `golden-import.mjs` 等脚本的硬编码本机路径 → 参数/环境变量 | 低 | `git checkout` |
| **P2** | 卡名/人设名：`docs/archive/*`（归档文档）**整体移出受控面**；活跃文档改中性化表述 | 中：doc 可读性下降 | `git checkout` |
| **P3** | 历史改写（`git filter-repo`）清掉 `9a82342` 的密钥 | **高：全部 SHA 变更** | 备份 `backup/` 或 `git bundle` |

**推荐顺序**：P0 轮换 → P1 抓包+密钥 → P2 → P3 历史（若决定公开仓库）→ **最后**才推送。

---

## 4. 达标判据（可复跑）

```bash
cd rp-workspace && node scripts/audit-publish-hygiene.mjs
# 退出码 0 = 六类全清（T-25 达标）；1 = 仍有命中
node scripts/audit-publish-hygiene.mjs --selftest   # 扫描器自身正控（17/17）
```

**说明**：工具最初 60 项 `SERVER` 中有 49 项是白名单误报（jQuery/lodash 官网、示例域、
正则截断的伪域名），已按「白名单只放任何人都会写到的公开地址」收窄到 11 项真信号；
`--selftest` 也在开发中当场抓出检测器自身的一个**假绿**（`sk-` 前缀匹配把真密钥当占位符放过）——
这正是它必须自带正控的理由（L44）。

---

## 5. 本报告**未**做的事（边界声明）

- ❌ 未修改、未删除、未 `git rm` 任何文件（数据冻结期内）；
- ❌ 未写入真实密钥 / wxid / 卡名到本报告（全文掩码）；
- ❌ 未改写 git 历史；
- ❌ 未把 `publish-hygiene-words.txt`（词表）入库 —— 它已在 `.gitignore` 中（自指悖论：扫描器含敏感词即成泄露源）。
