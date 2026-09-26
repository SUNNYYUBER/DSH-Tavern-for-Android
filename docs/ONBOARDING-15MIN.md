# 15 分钟上手（从 clone 到你的第一个 PR）

> 建立：2026-09-23。
> **目标**：让你在 15 分钟内**真正跑起来**并**真的改出一行代码**，而不是读完一堆文档。
> 全程**不需要**：真机、模拟器、Android SDK、那 100MB 第三方二进制。
>
> 如果你卡在任何一步，**直接开 Issue 说卡在哪一步**——那是文档的 bug，我会修。

---

## 第 0 分钟：你需要什么

- Node.js 24+（`node -v` 确认）
- Git
- 一个能跑 `pnpm` 的终端（`npx` 会自己拉，不用先装）

不需要 Android Studio。不需要 Java。不需要手机。

---

## 第 1–3 分钟：克隆 + 装依赖

```powershell
git clone https://github.com/SUNNYYUBER/DSH-Tavern-for-Android.git
cd DSH-Tavern-for-Android/rp-workspace/packages
npx -y pnpm@10 install --frozen-lockfile
node ../scripts/vendor-deps.mjs
```

> **为什么是 `rp-workspace/packages` 而不是仓库根**：这个目录是个自包含工作区，
> 有独立的 `pnpm-workspace.yaml`。RP 兼容层的全部源码与测试都在这里。
> 仓库根目录是 Android 构建链（那才需要 SDK / NDK / 100MB 二进制），**你现在用不到**。
>
> **为什么多一步 `vendor-deps.mjs`**：有 7 个构建期 vendor 包（jquery / handlebars /
> dompurify 等）按设计**不在 lockfile 里**（逐包理由见 `../scripts/vendor-deps.json`），
> `pnpm install` 不会装它们 —— 跳过这步，下一步测试会报
> `Failed to resolve import "dompurify"`。这不是你的环境有问题，是文档此前漏了这步。

---

## 第 3–5 分钟：跑测试（确认你拿到的是能跑的状态）

```powershell
npx -y pnpm@10 test
```

预期（约 10 秒）：

```
Test Files  86 passed (86)
     Tests  1846 passed | 2 skipped (1848)
```

**如果这里不是全绿**：先确认上一步 `vendor-deps.mjs` 跑过且输出 `OK — 7 个构建期 vendor 包…`；
确认过仍红，再开 Issue 贴完整输出。——那才是一个值得报的 bug。

类型检查也一样（可选）：

```powershell
npx -y pnpm@10 typecheck
```

---

## 第 5–8 分钟：找到你要改的地方

不要读 `MASTER_TODO.md`（461KB）。用 [ARCHITECTURE.md](ARCHITECTURE.md) 的**查表**：

| 你想改 | 去这里 |
|---|---|
| 世界书触发 | `packages/src/lore/` |
| MVU 变量 | `packages/src/state/mvu.ts` |
| 正则 | `packages/src/regex/engine.ts` |
| 宏 | `packages/src/macros/engine.ts` |
| 酒馆助手 API | `packages/src/dsht-rp-ui/src/client/th-shim.ts` |
| UI 面板 | `packages/src/dsht-rp-ui/src/client/` |
| 导入导出 | `packages/src/import/` |

**更省事的方法**：把你的目标直接问 AI——

> 「我要改 DSHTavern 的 XX 功能。架构见 `docs/ARCHITECTURE.md`，
> 现状见 `MASTER_TODO.md`（很大，按需检索）。这个功能在哪个文件？怎么改？」

——这正是本项目「AI 深度参与」的正向用法：**文档是给 AI 的燃料**。

---

## 第 8–12 分钟：改一行 + 跑一个测试

**你的第一个 PR 不需要是惊天动地的功能。** 从最小的开始：

### 路线 A：修一条测试（最容易成功）

跑一个具体文件，看断言在说什么：

```powershell
npx -y pnpm@10 exec vitest run tests/lore.spec.ts
```

测试文件在 `packages/tests/`，按功能命名。挑一个你感兴趣的功能，
读它的 `it('...')` 描述——那就是这个功能的**行为契约**。
如果你发现某个断言与源码行为不符、或断言写错了，**那就是一个真 bug**。

### 路线 B：加一条测试（零风险，最欢迎）

本项目最缺的不是功能，是**验证**。找一个你认为「这里应该有测试但没有」的行为，
补一条 `it(...)`。看相邻测试怎么写的，照抄结构。

### 路线 C：改一个 UI 面板的样式

`packages/src/dsht-rp-ui/src/client/style.ts` 里改一个值，
跑 `npx -y pnpm@10 test` 确认没弄坏既有断言（有 `touch-target-audit.spec.ts` 这类
会在你改小触控目标时报红的测试——**注意它是在帮你**）。

### 必看：跑测试确认

```powershell
npx -y pnpm@10 test          # 全绿
npx -y pnpm@10 typecheck     # 0 错
```

---

## 第 12–15 分钟：提 PR

```powershell
git checkout -b my-first-fix
git add -A
git commit -m "fix(lore): 一句话说清你改了什么、为什么"
git push origin my-first-fix
```

然后在 GitHub 上开 PR。**PR 描述里请包含**：

1. **你跑了什么命令、结果是什么**（贴输出，不要只写「已测试」）
   —— 本项目纪律：**只贴结论不算证据**
2. **你为什么这么改**（如果是照基准改的，贴基准的位置）

> 本项目有 40+ 条常驻门禁，但你改的绝大多数地方**不需要**过完整构建链。
> 我会在 review 时处理剩下的事。**风格不完全一致没关系，我合并后再调**——
> 见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

---

## 你可能会撞上的三件事（提前说）

**① `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS`**
`packages/pnpm-workspace.yaml` 已放行 esbuild，正常不该出现。若出现，贴给我。

**② 测试里出现中文 stderr 日志**
那是**预期输出**（降级/未就绪时的出声提示），不是失败。看最后的
`Test Files / Tests` 汇总行判断。

**③ 想改 Android 壳 / 构建脚本，发现跑不起来**
那需要完整构建链（Android SDK + NDK + 100MB 第三方二进制，耗时以小时计）。
**先别走这条路**——它门槛高且容易挫败。改 RP 逻辑（`packages/src/`）用不到它。

---

## 接下来

- **找活干** → [CONTRIBUTING.md](../CONTRIBUTING.md)「五类可以认领的活」
- **懂架构** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **懂边界**（哪些坏了算 bug、哪些是明确不做）→ [V0.3-FREEZE.md](V0.3-FREEZE.md)
- **只想报 bug** → 不用写代码：App 内「设置 → 导出诊断包」，把文件拖进 Issue 即可
