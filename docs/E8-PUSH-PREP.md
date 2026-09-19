# E8 推送准备清单（不执行 push）

> 依据用户 goal 轨道 E8：「推送准备（**不执行 push**）」。
> 生成 2026-09-14；**同日用户拍板公开档位**：**公开但静默**。
> **本文件是准备清单，未推送任何内容。**

## 当前仓库状态（现场核实）

| 项 | 值 |
|---|---|
| 分支 | `main`（**无上游**） |
| remote | **无**（纯本地仓库，`git remote -v` 空输出） |

## 公开档位：**公开但静默**（用户 2026-09-14 拍板）

| 项 | 设置 | 说明 |
|---|---|---|
| 仓库可见性 | **Public** | 代码可查、可 fork、可学 |
| **Issues** | **关闭** | 无入口 ⇒ 零响应义务 |
| **Pull Requests** | **关闭** | 不接收任何人写的代码 |
| **Discussions** | 不启用 | 默认即关 |
| **Wiki** | 不启用 | 默认即关 |
| 分支保护 | 仅 owner 可推 main | 防止误操作 |
| 贡献声明 | `CONTRIBUTING.md` | 明确写「不接受 Issue/PR」，挡掉不知情的 PR |

**为什么是这个档位**：用户自述「不是专业程序员，对 GitHub 社区协作没经验、心里没底」。
本档位的实质 = **GitHub 只当「带版本历史的公开存档 + 备份盘」**，
不承担任何社区协作义务。别人能看、能 fork，但**没有任何入口能打扰到作者**。

**这不是一锤定音**：随时可关仓库、可开 Issue、可退回私有。唯一不可逆的是
「代码公开过 ⇒ 别人拷走的副本收不回」（决定公开前已知悉）。

## 大文件（推送前须确认 Git 托管方容量策略）

| 文件 | 体积 | 说明 |
|---|---|---|
| `rp-workspace/android/app/src/main/jniLibs/arm64-v8a/libnode.so` | 47.4 MB | Node 二进制（用户决策入库） |
| `rp-workspace/android/app/src/main/jniLibs/x86_64/libnode.so` | 46.9 MB | 同上 |
| `jniLibs/` 全目录 | 约 100.3 MB | 14 个 `.so`（Node + proot + busybox + 依赖库） |

**说明**：这是**有意决策**（`clone` 即可构建，见 README「为什么把 jniLibs 入库」）。
GitHub 单文件上限 100 MB、单仓库建议 < 1 GB ⇒ 当前规模**可直推**，无需 LFS。
若将来超限，再评估 `git lfs migrate`（会重写历史，须先备份）。

⚠️ **公开仓库还须注意**：大文件会让 clone 变慢（约 100 MB 二进制）。
这是已知代价，已在 README 明示。

## 推送前检查清单（逐项可复跑）

- [x] 无明文密钥：`node rp-workspace/scripts/audit-publish-hygiene.mjs` → exit 0（六类判据 0 命中）
- [x] 无本机绝对路径：同上（LOCALPATH 0）
- [x] 无抓包正文 / 私有卡名：同上（PAYLOAD / WORDLIST 0）
- [x] 历史无密钥残留：`git log -S` 无命中（A3 已重写历史）
- [x] 构建产物不入库：`android/app/build/`、`dsh-runtime-android/`、`docs-archive/`、`golden/` 已入 gitignore
- [x] 许可证齐备：`LICENSE`（MIT）+ `docs/THIRD_PARTY_LICENSES.md`
- [x] 贡献声明：`CONTRIBUTING.md`（不接受 Issue/PR）
- [x] README 定稿：含项目定位 / 功能全景 / 致谢 / 设计思路 / Alpha 限制 / 法律边界 / 安卓平台限制 / 反馈与贡献

## 推送命令（**待用户确认后**执行）

```bash
# 1. 建**公开**仓库并关联（GitHub CLI 示例）
gh repo create DSHTavern --public --source=. --remote=origin

# 2. 首推（-u 建立上游跟踪）
git push -u origin main
```

**推送后立即关掉 Issues / PR**（GitHub 网页）：
`Settings → General → Features` → 取消勾选 **Issues** 与 **Pull requests** → Save。

⚠️ **纪律**：本次未执行任何 push。以上命令须由用户自行决定时机。

## 首次推送后的验证（可复现构建）

```bash
git clone <repo> && cd <repo>
# 依赖：node 24 / JDK 21 / gradle 8.14（rp-workspace/downloads/gradle）
cd rp-workspace/packages && npm install
npx vitest run          # 预期 67 文件 / 1381 通过
cd .. && npm run typecheck   # 预期 三段 0 错
```

## 公开前须再审的内容（低优先）

| 项 | 现状 | 建议 |
|---|---|---|
| `docs/T-25-PUBLISH-HYGIENE-2026-09-11.md` | 含**截断**密钥引用（非完整密钥） | 可保留（截断形态不构成可用密钥）；如不放心可移出 |
| `rp-workspace/scripts/publish-hygiene-words.txt` | 自定义敏感词表（**已 gitignore**） | 保持现状即可（自指悖论：入库反成泄露源） |
| `docs/E7-PRE-RELEASE-REVIEW-2026-09-13.md` | 开源前审查结论（AFPL 低风险） | 可保留（结论已公开化） |
| `AI-COLLAB-RULES.md` / `MASTER_TODO.md` / `TASK-LIST.md` | AI 协作过程记录（含"踩坑"叙述） | **保留**：这些是项目真实工程史，与"诚实说明"定位一致 |
