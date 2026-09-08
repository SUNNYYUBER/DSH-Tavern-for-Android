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
export function installComposerEnterFix() {
    const handler = (e) => {
        // 只拦裸 Enter（无修饰键）——Shift+Enter 是原生换行通道，Ctrl/Meta+Enter 是原生强制提交
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey)
            return;
        // IME 组合保护（中文输入法正在输入时 Enter 是确认候选，不是换行）
        if (e.isComposing || e.keyCode === 229)
            return;
        // 菜单弹窗打开时不拦截（否则破坏选项确认）
        if (document.querySelector('[data-lexical-composer-menu]') !== null)
            return;
        const target = e.target;
        if (target === null)
            return;
        // 只拦 composer 内的 Enter（contenteditable div）
        const composer = target.closest('[data-composer-input]');
        if (composer === null)
            return;
        // 拦截：preventDefault + stopImmediatePropagation（抢在 Lexical 的 KEY_ENTER_COMMAND 之前）
        e.preventDefault();
        e.stopImmediatePropagation();
        // 插入换行（Lexical 的 MutationObserver 接管同步）
        document.execCommand('insertLineBreak', false);
    };
    // capture 阶段挂 document（抢在 Lexical 的 keydown 监听之前）
    document.addEventListener('keydown', handler, true);
    // 顺手设置 enterKeyHint='enter'——手机键盘显示「换行」键而非「发送」图标
    const setHint = () => {
        document.querySelectorAll('[data-composer-input]').forEach(el => {
            el.enterKeyHint = 'enter';
        });
    };
    setHint();
    // composer 是动态挂载的（会话切换时重建）——MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(() => setHint());
    observer.observe(document.body, { childList: true, subtree: true });
}
