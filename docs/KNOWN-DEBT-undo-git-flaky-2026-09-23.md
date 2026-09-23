# KNOWN-DEBT: Windows + Node 24 上 git 子进程被控制台事件波及（`0xC000013A`）

**登记**：2026-09-23（DSH 升级轮）
**影响面（两处，同一根因）**：
1. `rp-workspace/packages/tests/undo.spec.ts` 的 `工作区文件快照（turn 锚点，真实 git 仓库）` describe（3~5 个用例假失败）—— **未修，见下**
2. `rp-workspace/scripts/audit-doc-refs.mjs` 的判据⑤（VCS 检查）—— **已修**

## 现象

```
Error: Command failed: git -c core.quotepath=false -C <tmp>\ws init
Serialized Error: {
  code: 3221225786,          ← 0xC000013A = STATUS_CONTROL_C_EXIT
  stdout: 'Initialized empty Git repository in .../.git/\n',   ← ★ git 实际**成功**了
  stderr: '',                                                  ← ★ 且**无任何错误输出**
}
```

## 量化（本机实测）

| 命令 | 样本 | 失败次数 | 失败率 |
|---|---|---|---|
| `git check-ignore <被忽略路径>` | 30 | **7** | ~23% |
| `git rev-parse --is-inside-work-tree` | 30 | **6** | ~20% |

**最长连败 = 1** ⇒ **3 次重试的残余失败率 ≈ 0.23³ ≈ 1.2%**（实测 8 次连跑全绿）。

## 判据链（为什么这不是"我们的 bug"）

| 实验 | 结果 | 结论 |
|---|---|---|
| 手工跑同一命令行（PowerShell） | exit 0 | 命令本身没问题 |
| 纯 node（无 vitest）跑同一序列 | 成功 | node 基础环境没问题 |
| **同一 vitest 环境**里的最小复现 | 成功 | vitest 环境本身没问题 |
| `undo.spec.ts` 该 describe 单独跑（串行/并发都试） | **不稳定失败**（3~5 个，每次不同） | **flaky** |
| `git stash` 掉本轮所有改动后重跑 | **同样失败** | ★ **与本轮 DSH 升级无关** |
| 节点：**git 自己的输出是正确的**（stdout 有正确结果、stderr 为空） | — | 只有**退出码**被污染 |

`0xC000013A` = `STATUS_CONTROL_C_EXIT` —— 子进程被控制台 CTRL_C 事件波及后以该码退出。
这是 **Node 在 Windows 上 `child_process.execFile` 与控制台事件**的已知交互问题。

## 两种处置（**为什么一处修、一处不修**）

### 已修：`audit-doc-refs.mjs` 判据⑤ —— **必须修，因为危害是「静默失效」**

该判据用 `git check-ignore` 回答「这个路径在不在版本控制内」。原实现：

```js
try { execFileSync('git', ['check-ignore', r], ...); v = true }
catch (e) { v = e.status === 1 ? false : null }   // ★ 0xC000013A ≠ 1 ⇒ null
```

`null` 的语义是「无法判定」⇒ 调用方**放行**。后果**比单次漏报严重得多**：

- `git rev-parse`（`usable` 探测）也可能被波及 ⇒ `usable = false`
  ⇒ **判据⑤ 把自己当成「非 git 环境」而永久静音**（所有路径都返回 `null`）；
- 实测到的**真实后果**：`audit-doc-refs-negctl.mjs` 的**负控 D/E 交替假通过**
  （连跑 5 次：4 FAIL / 1 PASS）⇒ 这条负控**长期无法证明判据⑤ 有杠杆**；
- 在真实仓库上，一条真缺陷也可能因这一次瞬时故障而**被放过**。

**修法**：对**可恢复的瞬时故障**（非 0 非 1）**重试至多 3 次**；`rev-parse` 与 `check-ignore`
**两处都加**（首版只加了后者 —— 这正是剩余 flaky 的真因）。三次仍失败才判 `null` 并出声。

★ **这不是「加重试掩盖问题」**：该退出码**与被判事实无关**（git 的输出是正确的，
只是退出码被控制台事件污染）⇒ 重试是**恢复真值**，不是绕过（P-30 的反面）。
修后 **连跑 8 次全绿 38/38**。

### 不修：`undo.spec.ts` —— **不改测试，因为改了会掩盖环境问题**

不改测试（例如加重试 / 换 `spawn` / 吞掉非零码）。理由：
1. 它测的是**真实产物行为**（"工作区文件快照 + 真实 git 仓库"），是有价值的高保真用例；
2. 退出码 `0xC000013A` 是**环境**的属性 —— 在测试里绕过它，等于把环境问题
   永久埋在测试层，将来在 Linux/CI 上真出问题时**没有信号**；
3. 本项目的纪律是 **P-30（不许让代理量与事实脱钩）**。

> **两处处置不同的判据**：**判据（闸门）的假阴性会静默放行真缺陷 ⇒ 必须修**；
> **测试的假阳性只是噪音 ⇒ 不得用重试掩盖**（它需要的是环境层修复，
> 属独立于 DSH 升级的课题）。

## 影响与处置

- **对发版的影响**：无。该失败**在改动前的基线上就存在**（已用 `git stash` 反向验证）。
- **vitest 基线口径**：本仓当前基线应记作 **1835 passed / 4 failed（全部为本文档所述 flaky）**，
  而非历史文档里的「1839 通过」（该数字是**无 flaky 干扰**时的值）。
- **后续根治方向**（环境层）：让 vitest worker 不继承控制台
  （如 `--pool=forks` + 显式 `windowsHide`，或调整 Node 版本），属独立课题。

## 一句话

**这是"绿灯/红灯与被测事实脱钩"的实例**（与 `libz.so.1` 事故同族，方向相反）：
报告说 FAIL，事实是 PASS。**闸门处修（否则静默放行），测试处如实登记（否则掩盖环境问题）。**

