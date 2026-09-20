# dsh-plugin-lint

DSH（DeepSeek Harness）插件的静态检查器：打包闭包、client face 依赖嗅探、Android 约束预判。
规则全部来自真实实测案例（见 [PLUGIN-COMPAT](https://github.com/SUNNYYUBER/DSH-Tavern-for-Android/blob/main/docs/PLUGIN-COMPAT.md) 的冲突类型学），不写想象中的规则。

## 用法

```bash
npx dsh-plugin-lint <包目录|包.tgz>          # 人类可读报告
npx dsh-plugin-lint <包目录> --json          # 机器可读
```

## 输出

分面结论（各自 pass / risk / fail）：

| 面 | 含义 |
|---|---|
| `host` | 装得上 + 加载不崩（import 闭包 / 插件清单 / 必备字段 / files 存在性） |
| `android` | Android 适配预判（原生模块必挂 = fail；白名单外系统工具 = 提示） |
| `stability` | 跨版本稳定风险（client face 内部投影依赖 = 类型学 ⑧） |

退出码：`0` pass / `1` risk / `2` fail —— 可直接进 CI。

## 规则与案例的对应

| 规则 | 级别 | 面 | 来源案例 |
|---|---|---|---|
| S1-closure | fail | host | zhipu-toolkit 0.2.1：缺 lib/usage-stats.js → 宿主 crash-loop（类型学 ⑨） |
| S2-bare-undeclared | fail | host | bare import 未声明 dependencies |
| S3-plugin-manifest | fail | host | cordis.patch.yml / dsh.plugin.json 均无 = 装不上 |
| S4-engines-dsh | info | host | 建议钉兼容窗口（`>=0.1.5-rc.1 <0.1.6` 形态） |
| S5-files-exist | fail | host | files 清单项不存在（glob 项豁免） |
| S6-required-fields | fail | host | name/version/description/license + main 或 exports["."] |
| N1-client-face | risk | stability | turn-index 条目恒空 / outline snapshot.nodes 崩溃（类型学 ⑧） |
| A1-native-module | fail | android | sharp/koffi/node-pty 等原生模块 Android 不可用 |
| A2-subprocess-tool | info | android | spawn 白名单外工具（白名单 = bash/sh/rg/git/zstd，DSHTavern P1 内置） |

## 金标准回放

规则的正确性用「人工实测结论回放」守护：5 个已在真机/模拟器实测的社区插件包
（session-pin / better-stats / turn-index / outline / zhipu-toolkit）跑 lint，
分面结论必须与人工实测一致（仓库内 `test/golden-replay.mjs`）。

## License

MIT
