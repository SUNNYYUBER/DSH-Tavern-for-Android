# E8 推送准备清单（不执行 push）

> 依据用户 goal 轨道 E8：「私库清单（**不执行 push**）」。
> 生成时间：2026-09-14。**本文件是准备清单，未推送任何内容。**

## 当前仓库状态（现场核实）

| 项 | 值 |
|---|---|
| HEAD | `4807a144fe9a8440a1f19dab9a14be56773850cd` |
| 分支 | `main`（**无上游**） |
| 提交数 | 152 |
| 跟踪文件 | 688 |
| remote | **无**（纯本地仓库，`git remote -v` 空输出） |

## 推送目标：**私有仓库**

用户已拍板：**仓库先私有**，README 定稿并经用户确认后才考虑开源。

## 大文件（推送前须确认 Git 托管方容量策略）

| 文件 | 体积 | 说明 |
|---|---|---|
| `rp-workspace/android/app/src/main/jniLibs/arm64-v8a/libnode.so` | 47.4 MB | Node 二进制（用户决策入库） |
| `rp-workspace/android/app/src/main/jniLibs/x86_64/libnode.so` | 46.9 MB | 同上 |
| `jniLibs/` 全目录 | 约 100.3 MB | 14 个 `.so`（Node + proot + busybox + 依赖库） |

**说明**：这是**有意决策**（`clone` 即可构建，见 README「为什么把 jniLibs 入库」）。
GitHub 单文件上限 100 MB、单仓库建议 < 1 GB ⇒ 当前规模**可直推**，无需 LFS。
若将来超限，再评估 `git lfs migrate`（会重写历史，须先备份）。

## 推送前检查清单（逐项可复跑）

- [x] 无明文密钥：`node rp-workspace/scripts/audit-publish-hygiene.mjs` → exit 0（六类判据 0 命中）
- [x] 无本机绝对路径：同上（LOCALPATH 0）
- [x] 无抓包正文 / 私有卡名：同上（PAYLOAD / WORDLIST 0）
- [x] 历史无密钥残留：`git log -S` 无命中（A3 已重写，140→152 提交）
- [x] 构建产物不入库：`lib/` 产物入库（发布必需）；`android/app/build/`、`dsh-runtime-android/`、`docs-archive/`、`golden/` 已入 gitignore
- [x] 许可证齐备：`LICENSE`（MIT）+ `docs/THIRD_PARTY_LICENSES.md`
- [x] README 定稿：含项目定位 / 功能全景 / 致谢 / 设计思路 / Alpha 限制 / 法律边界 / 安卓平台限制

## 推送命令（**待用户确认后**执行）

```bash
# 1. 建私有仓库后（GitHub CLI 示例）
gh repo create DSHTavern --private --source=. --remote=origin

# 2. 首推（-u 建立上游跟踪）
git push -u origin main
```

⚠️ **纪律**：本 goal 全程**不执行 push**（边界 B4）。以上命令仅供参考，须由用户自行决定时机。

## 首次推送后的验证（可复现构建）

```bash
git clone <repo> && cd <repo>
# 依赖：node 24 / JDK 21 / gradle 8.14（rp-workspace/downloads/gradle）
cd rp-workspace/packages && npm install
npx vitest run          # 预期 67 文件 / 1381 通过
cd .. && npm run typecheck   # 预期 三段 0 错
```

## 附：私库专属内容（开源前须再审视）

| 项 | 现状 | 开源前动作 |
|---|---|---|
| `docs/T-25-PUBLISH-HYGIENE-2026-09-11.md` | 含截断密钥引用（非完整密钥） | 建议整文移出或再脱敏 |
| `rp-workspace/scripts/publish-hygiene-words.txt` | 自定义敏感词表（**已 gitignore**） | 保持入库状态即可 |
| `docs/E7-PRE-RELEASE-REVIEW-2026-09-13.md` | 含开源前审查结论（AFPL 低风险） | 可保留（结论已公开化） |
