# 第三方组件许可清单（THIRD_PARTY LICENSES）

> 建立日期：2026-09-03（⑦ 许可证核对）。覆盖范围：**DSHTavern APK 实际打包再分发**的全部
> 第三方组件。扫描方法：遍历 `dsh-runtime/node_modules` 全量 package.json 的 license 字段
> （含嵌套 node_modules），逐包核对。
>
> **结论：全部打包组件均为宽松许可（MIT / ISC / BSD-3-Clause / Apache-2.0 / MIT+GPL 双许可
> 选 MIT），无 copyleft（GPL/AGPL/LGPL）打包物，可再分发。**

## 1. DSH 官方运行时（DeepSeek 官方程序，APK 主体）

- **@deepseek-ai/dsh 全家桶**（约 170 个包，0.1.0-rc.8）：**MIT** —— 含 dsh/dsh-agent-loop/
  dsh-client-runtime/dsh-client-ui-*/dsh-compaction/dsh-llm-* 等全部 dsh-* 包
- **cordis / cosmokit / schemastery 及 cordis-plugin-\***：**MIT**
- **node-addon-landlock-run**（原生沙箱插件）：**BSD-3-Clause**

## 2. 运行时传递依赖（node_modules 全量扫描）

- 绝大多数：**MIT / ISC / Apache-2.0**（@aws-sdk 系列 / @opentelemetry 系列 = Apache-2.0，
  @mistralai/mistralai = Apache-2.0，body-parser / type-is / open = MIT，
  @earendil-works/pi-ai = MIT）
- **argparse**：**Python-2.0**（PSF 许可，BSD 风格宽松许可，允许再分发）
- 全量扫描非宽松许可命中数：**0**（无 GPL/AGPL/LGPL）

## 3. 客户端 vendor（th-vendor / host-vendor，构建期内嵌）

| 包 | 版本 | 许可 |
|---|---|---|
| jquery | 3.7.1 | MIT |
| jquery-ui | 1.13.3 | MIT |
| zod | 4.4.3 | MIT |
| yaml | 2.9.0 | ISC |
| lodash | 4.18.1 | MIT |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later)——**选 MIT** |

## 4. 自研代码的格式兼容声明（非许可项，法律边界备注）

- **SillyTavern 格式兼容**（正则脚本 / OpenAI Settings 预设 / 角色卡 PNG-JSON / 聊天
  jsonl）：为**自研实现**（packages/src/regex/engine.ts、preset/st-import.ts、
  import/\*.ts），仅对齐**文件格式与字段语义**，**未复制 ST 源码**。SillyTavern 本体为
  AGPL-3.0，本仓库不含其任何源码。
- **酒馆助手（JS-Slash-Runner）脚本兼容层**：API 面自研复刻（dsht-rp-ui/th-shim.ts +
  dsht-plugin-tavern-helper），未打包未复制其源码；MVU 等第三方脚本**运行时经 CDN 加载**
  （不打包、不再分发，用户侧行为）。

## 5. 参考项目致谢（代码改编来源，均已核对许可）

- **dsh-worldbook**（MIT © aam452）：`lore/trigger.ts` 的 visibleMessageCursor 照抄语义
  （P0-5，源码头注已标注）
- **dsh-agent-rp / dsh-plugin-prompt-tool**（MIT）：宏引擎统一 / convertStToPreset 映射 /
  聊天种子等改编——完整对照与致谢表见 `docs/archive/REF_PROJECTS_COMPARISON.md`
  （领域六 + 消化清单）
- **vector-enhanced 楼层总结机制**：用户自有资产的插件化移植（dsht-plugin-memory）

## 6. 待办（发布工程阶段，§3.4）

- 正式许可文件落位：仓库根 LICENSE（自研部分）+ 本清单随仓库公开
- 若未来引入任何 GPL/AGPL 依赖 → 回到本清单重新评估（当前为零）
