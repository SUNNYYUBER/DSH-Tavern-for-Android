/**
 * 官方投影读取 —— **客户端侧的入口别名**（E2 防御性读取 / P-1 单源化 · W4 收口）。
 *
 * ## 这里为什么是「空壳 re-export」
 *
 * 真正的实现在 `packages/src/dsht-plugin-shared/host-projection.ts`。
 * 消费方跨 **5 个包**（客户端 `dsht-rp-ui` + 宿主侧 `dsh-plugin` /
 * `dsht-plugin-memory` / `dsht-plugin-undo` / `dsht-plugin-prompt-template`），
 * 单源必须落在 5 个包共同依赖的 shared 层（放在 UI 包内会逼宿主侧反向依赖 UI 包）。
 *
 * 本文件只做两件事：
 *   ① 给客户端一个**包内相对路径**的引入点（`./host-projection.ts`），
 *      免去每处写 `../../../dsht-plugin-shared/host-projection.ts` 的长路径；
 *   ② 作为 `RpStateFloat.tsx` 的 `readSessionCwd` re-export 的落点（历史兼容）。
 *
 * ## 纪律：本文件**不得**出现任何读取逻辑
 * 一旦有人在这里补一个「顺手」的实现，就会出现**两套口径**——正是 W4 要消灭的
 * P-1 形态。`projection-shape-defense.spec.ts` 有护栏：读取器定义只许有一处
 * （shared 层），本文件出现 `export function read*` 即红。
 */
export {
  readSessionCwd,
  readSessionId,
  readSessionBlank,
  readSessionRunning,
  readHostSessionId,
  readHeader,
  readHeaderAgentPreset,
  readSurfaceNodes,
  readSurfaceNodesOrNull,
  readChat,
  readSessionChat,
  forEachChatNode,
  readSourceKind,
  readNodeKey,
  readNodeKind,
  readNodeData,
  readBlocks,
  readNodeStatus,
  readNodeSeq,
  readNodeTurn,
  readNodeTime,
  readFinalSeq,
  readFinalMessageId,
  readFinalTiming,
  type ProjectedChat,
} from '../../../dsht-plugin-shared/host-projection.ts'
