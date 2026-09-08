/**
 * PROJECT_PLAN 补全：世界书条目管理面板（数据面 = dsht-tavern-helper worldbook API）。
 *
 * - /worldbook/list {} → {books:[{name,lorePath}]}：书列表（库内 wb-* skill + 全局书单）；
 * - /worldbook/get {name} → {name,lorePath,entries:[ST World Info 形状]}：条目只读快照；
 * - /worldbook/entry-put {name, entry}：uid（= 数组下标）锚定原位合并回 lore.json。
 *
 * 功能：书列表 → 选书看条目（搜索框按 comment/content/key 过滤、条目级 enabled
 * 开关切换、展开编辑 comment/content/keys 后保存 entry-put）。position/depth 等
 * 高级字段不暴露编辑（ST 触发语义，误改易坏触发）——保存整条回传时原样保留。
 *
 * 挂载点：RpOverlay「世界书」tab（BooksPanel 顶部「条目编辑」按钮拉起，替换总览内容；
 * onBack 返回书总览，onChanged 透传给 BooksPanel 刷新绑定卡条目数）。
 */
import { type JSX } from 'react';
export declare function RpLorePanel(props: {
    onBack?: () => void;
    onChanged?: () => void;
}): JSX.Element;
