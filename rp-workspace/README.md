# DSHTavern

DSH（DeepSeek Harness）的 Android 角色扮演发行版：把 SillyTavern 生态（角色卡/世界书/预设/聊天/变量插件）完整迁移进 DSH 的 agent 运行时，迁移由适配 agent（PTC 预设 + st-migration skill）亲自执行。

## 致谢（参考项目）

本项目在以下开源项目（均 MIT 许可）的启发与参考下开发，特此致谢：

| 项目 | 参考点 | 许可证 |
|---|---|---|
| [dsh-agent-rp](https://github.com/hewzhew/dsh-agent-rp)（hewzhew） | 确定性会话 seed、可回放宏引擎（展开/绕插值器转义）、display 正则三段编译、agent 编排双轴分离、受管预设安装 | MIT |
| [dsh-tavern](https://github.com/flizzywine/dsh-tavern)（flizzywine） | 回合编排与 nativeCommits 快照回退（本会话内文件快照回退的范本）、三层正则投影（私用区 token 还原/防空白守卫）、TavernMessageFrame iframe 骨架、确定性世界书召回、移动端 CSS 五件套、候选项/剧本模式 | MIT |
| [dsh-roleplay](https://github.com/lutrodev/dsh-roleplay)（lutrodev） | 零私有事件/零第二消息仓库、空 replacement 遮蔽 + ancestry 失活、显式 forkAt 分支取舍、MVU 声明式子集化 | MIT |
| [agent-loop-rp](https://github.com/2428139739pregnant-web/agent-loop-rp)（2428139739pregnant-web） | MVU 状态从聊天历史折叠、Tavern Helper 双 adapter、EJS QuickJS 子集、swipe 无叠加语义（SVG 展示白名单） | MIT |
| [dsh-worldbook](https://github.com/aam452/dsh-worldbook)（aam452） | ST World Info 全语义（时间游标/per-turn 闸门/递归/组互斥/@D 深度/AI 自写三层守卫）、注入时机对齐 | MIT |
| [dsh-plugin-prompt-tool](https://github.com/Czerror/dsh-plugin-prompt-tool)（Czerror） | 6 层提示词注入引擎、convertStToPreset 映射表、skill-search 替代全量注入、manifest 版本化 skill 部署 | MIT |

同时感谢 SillyTavern 社区（MVU 变量框架、酒馆助手、提示词模板等插件的原始生态）及 DSHA（qiannianhuanxiang/DSHA）提供的 Android 运行参考。

> 引用以上项目源码的模块在各自头注释里注明出处与 MIT 许可。
