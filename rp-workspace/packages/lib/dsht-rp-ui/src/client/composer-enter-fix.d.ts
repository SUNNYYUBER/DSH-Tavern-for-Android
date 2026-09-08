/**
 * ⑦修复（2026-09-05）：手机键盘点「换行」（Enter/Return）直接发送消息。
 *
 * 根因（dsh-013-src/packages/client/ui-conversation/src/client/input/editor/keymap.ts:109-129）：
 * DSH 原生 composer 是 Lexical contenteditable div，KEY_ENTER_COMMAND 无条件提交
 * （仅 Shift+Enter 放行换行，移动端没有 Shift）。enterKeyHint 未设置（默认「换行」键
 * 显示「发送」图标），用户点「换行」实际是触发提交。
 *
 * 修法：插件侧在 document 挂 capture 阶段 keydown 拦截器——命中 composer 内的
 * 裸 Enter（无 Shift/Ctrl/Meta）时 preventDefault + stopImmediatePropagation，
 * 再 execCommand('insertLineBreak') 插入换行（Lexical 的 MutationObserver 接管同步）。
 * IME 组合保护（isComposing/keyCode 229）与菜单弹窗打开时不拦截（不破坏选项确认）。
 * 发送仍走界面上的发送按钮（原生提交通道）。
 */
export declare function installComposerEnterFix(): void;
