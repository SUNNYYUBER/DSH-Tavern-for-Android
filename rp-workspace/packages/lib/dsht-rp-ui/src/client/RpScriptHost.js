/**
 * 酒馆助手（TavernHelper）脚本运行时宿主——conversation.input.dock 席位。
 *
 * 验收意图：ST 酒馆助手核心功能之一是加载执行脚本库；本组件把已落盘的
 * tavern-helper-scripts.json（预设 + 卡两作用域 enabled 脚本）真正跑起来。
 *
 * - 执行形态：每脚本一个 sandbox="allow-scripts" srcdoc iframe（不给 same-origin，
 *   脚本为不可信代码），iframe 铺满会话视口（position:fixed inset:0、pointer-events:none）
 *   ——脚本自渲染的 fixed 部件视觉等效 ST 顶层注入；交互走脚本按钮面板。
 *   会话级单例（sessionId → SessionRuntime，iframe 挂 document.body，跨组件重挂载存活）。
 * - TavernHelper shim：iframe 内注入 window.TavernHelper + 裸全局，postMessage 桥到本宿主，
 *   再调 /dsht-tavern-helper/* 数据面（变量六作用域 / 预设 CRUD / 聊天消息只读 / 正则 /
 *   世界书名单与条目读）/ 本地事件总线。
 * - 上下文快照：start / reloadAll 装载脚本后、以及每次 generation_ended 投递后，拉
 *   /context + /chat/messages 合并成快照，postMessage({th:'context'}) 推给全部 iframe
 *   ——iframe 内 getContext() / SillyTavern.getContext() 同步读（推送失败静默不影响脚本）。
 * - 事件投递：diff 会话快照（chat.order 长度 / 末条 kind / running）→
 *   MESSAGE_SENT / MESSAGE_RECEIVED / GENERATION_STARTED / GENERATION_ENDED；
 *   【实机审计修复 2026-09-05】补投 CHAT_CHANGED（会话打开）与 message_swiped / message_edited
 *   （RpNativeChat 变体切换 / 会话编辑成功回调经 TH_HOST_EVENT CustomEvent 桥入）。
 * - 失败诚实化：单脚本抛错/超时只标记自身；调到 shim 没有的 API 记名，
 *   面板逐脚本显示 状态（运行中/失败原因/缺什么 API）。
 * - C15 最小 Toolbox：面板内「日志」抽屉（iframe console 经 th:console 桥实时汇入，
 *   最多 200 条）与「变量」查看器（GET /dsht-mvu/variables 只读 JSON 树）。
 * - D8 通知：桥上 422（variableSchema 校验失败）console.warn + 开关放行时 DOM toast
 *   （rp/mvu-settings.json 的 mvu_notification_failure/success 类键，缺省静默）。
 */
import { useEffect, useRef, useState } from 'react';
import { rpApi } from './rpc.ts';
import { useRpSlug } from './RpStateFloat.tsx';
import { buildIframeDocument, deepMergeAssign, deepMergeInsert, getButtonEventId, handleBridgeCall, parseIncomingMessage, } from './th-shim.ts';
// getTavernHelperVersion 必须返回真 TH 语义的 semver：MVU bundle 等脚本会拿它跑
// compare-versions（>= 4.0.14 判定）——非 semver 字符串会让整包 ready 回调炸掉、Mvu 挂不上。
// 构建标记另存 __DSHT_SHIM_BUILD__（不进脚本版本判定）。
const SHIM_VERSION = '4.8.5'; // 对齐真 TH 大版本（脚本兼容性判定用）
const SHIM_BUILD = 'dsht-th-shim/6-toolbox'; // /6：C7/C8/C9/C15/C17/C18/D6/D8 扩展面 + console 桥
const READY_TIMEOUT_MS = 15_000;
// ---------------------------------------------------------------------------
// 数据面（/dsht-tavern-helper/*；与 rpApi 同约定，前缀不同）
// ---------------------------------------------------------------------------
// D8：422（variableSchema 校验失败）通知钩子——thApi 是模块级函数拿不到运行时实例，
// SessionRuntime 构造时注入；开关（rp/mvu-settings.json 的 mvu_notification_failure 类键）
// 由 notifyUser 统一裁决，关 = 只 console.warn。
let schemaFailureNotifier = null;
async function thApi(path, payload = {}, method = 'POST') {
    const resp = await fetch(`/dsht-tavern-helper/${path.replace(/^\//, '')}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(payload),
    });
    const body = await resp.json();
    if (body.error) {
        if (resp.status === 422) {
            console.warn('[dsht-th] 变量结构校验失败（422）:', path, body);
            schemaFailureNotifier?.(String(body.error));
        }
        throw new Error(String(body.error));
    }
    return body;
}
/** D8：轻量 DOM toast（右下角浮层；4s 自动消失——比 window alert 温和，不阻塞脚本） */
function showDomToast(level, message) {
    if (typeof document === 'undefined')
        return;
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:14vh', 'z-index:99999', 'max-width:340px',
        'padding:8px 12px', 'border-radius:8px', 'font-size:12px', 'line-height:1.5', 'color:#fff',
        level === 'error' ? 'background:#b3261e' : 'background:#2e7d32',
        'opacity:0.95', 'box-shadow:0 4px 12px rgba(0,0,0,.4)', 'pointer-events:none',
    ].join(';');
    document.body.append(el);
    setTimeout(() => el.remove(), 4000);
}
async function thVarsGet(scope, slug, sessionId, scriptId) {
    const q = new URLSearchParams({ scope });
    if (slug)
        q.set('slug', slug);
    if (sessionId)
        q.set('sessionId', sessionId);
    if (scriptId)
        q.set('scriptId', scriptId);
    const resp = await fetch(`/dsht-tavern-helper/variables?${q.toString()}`);
    const body = await resp.json();
    if (body.error)
        throw new Error(body.error);
    return body.variables ?? {};
}
// ---------------------------------------------------------------------------
// 会话运行时（会话级单例）
// ---------------------------------------------------------------------------
/** 【实机审计修复 2026-09-05】RpNativeChat 成功回调 → TH 事件桥（message_swiped/message_edited）：
 * 变体切换 / 会话编辑成功处 dispatch 的 window CustomEvent 名（detail: {sessionId, eventType, messageId}） */
export const TH_HOST_EVENT = 'dsht-rp-ui:th-host-event';
class SessionRuntime {
    sessionId;
    slug;
    secret;
    scripts = [];
    statuses = new Map();
    toasts = [];
    logs = [];
    frames = new Map();
    container = null;
    started = false;
    uiListeners = new Set();
    prevOrder = -1;
    prevRunning = false;
    destroyed = false;
    /** 最近一次 advance 的会话快照（messageId → 楼层号解析用；message_swiped/edited 桥） */
    lastSnapshot = null;
    /** 最近一次成功组装的上下文快照（regexes/replace preset 作用域解析 presetId 用） */
    contextSnapshot = null;
    /** C15：console 转发的节流刷新计时器（高日志频脚本不刷爆 React） */
    consoleNotifyTimer = 0;
    /** D8：MVU 通知开关（GET /dsht-mvu/settings 懒加载缓存；null = 未加载） */
    notifySwitches = null;
    constructor(sessionId, slug) {
        this.sessionId = sessionId;
        this.slug = slug;
        this.secret = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        // D8：thApi 收到 422 时经钩子走通知（开关放行才 toast，默认静默）
        schemaFailureNotifier = (message) => this.notifyUser('failure', `变量结构校验失败：${message}`);
    }
    /** UI 订阅（脚本面板刷新） */
    subscribe(fn) {
        this.uiListeners.add(fn);
        return () => { this.uiListeners.delete(fn); };
    }
    notify() {
        for (const fn of this.uiListeners) {
            try {
                fn();
            }
            catch { /* UI 订阅者异常不影响运行时 */ }
        }
    }
    get scriptCount() { return this.scripts.length; }
    /** 拉取并装载脚本（幂等；started 守卫） */
    start() {
        if (this.started || this.destroyed)
            return;
        this.started = true;
        void thApi('scripts/for-session', { sessionId: this.sessionId, slug: this.slug })
            .then(r => {
            if (this.destroyed)
                return;
            this.scripts = Array.isArray(r.scripts) ? r.scripts : [];
            for (const s of this.scripts)
                this.mountScript(s);
            // 装载完成后拉一次上下文快照推给 iframe（getContext 同步面就绪）
            this.loadContextSnapshot();
            // 【实机审计修复 2026-09-05】chat_id_changed（ST CHAT_CHANGED）：会话打开（运行时
            // 创建首次 start、脚本装载完成）时投递一次，参数 = 会话 id（ST 传 chat 文件名的等价位）
            this.emitSessionEvent('chat_id_changed', [this.sessionId]);
            this.notify();
        })
            .catch(e => {
            console.warn('[dsht-th] scripts/for-session 拉取失败:', e.message);
            this.notify();
        });
    }
    /** 重载全部脚本（真 TH reloadAll 同款：销毁 iframe 重建） */
    reloadAll() {
        for (const f of this.frames.values())
            f.remove();
        this.frames.clear();
        for (const s of this.scripts)
            this.mountScript(s);
        // 重建的 iframe 没有快照记忆：重推一次
        this.loadContextSnapshot();
        this.notify();
    }
    destroy() {
        this.destroyed = true;
        if (this.consoleNotifyTimer) {
            clearTimeout(this.consoleNotifyTimer);
            this.consoleNotifyTimer = 0;
        }
        for (const f of this.frames.values())
            f.remove();
        this.frames.clear();
        this.container?.remove();
        this.container = null;
        this.uiListeners.clear();
    }
    // ---- D8：MVU 通知（开关裁决 + DOM toast + 面板最近提示） ----
    /** rp/mvu-settings.json 的通知开关（mvu_notification_failure / mvu_notification_success 类键；缺省全关） */
    async notifySwitchesLoaded() {
        if (this.notifySwitches)
            return this.notifySwitches;
        let sw = { failure: false, success: false };
        try {
            const resp = await fetch('/dsht-mvu/settings');
            const body = await resp.json();
            const st = body.settings ?? {};
            sw = {
                failure: st['mvu_notification_failure'] === true || st['notification_failure'] === true,
                success: st['mvu_notification_success'] === true || st['notification_success'] === true,
            };
        }
        catch { /* 设置读取失败 = 全关（默认静默） */ }
        this.notifySwitches = sw;
        return sw;
    }
    /** D8 通知入口：开关放行才可见（DOM toast + 面板最近提示）；失败/成功提醒共用 */
    notifyUser(level, message) {
        void this.notifySwitchesLoaded().then(sw => {
            if (level === 'failure' && !sw.failure)
                return;
            if (level === 'success' && !sw.success)
                return;
            const lv = level === 'failure' ? 'error' : 'success';
            this.toasts.push({ ts: Date.now(), level: lv, message, scriptId: 'dsht-mvu' });
            if (this.toasts.length > 50)
                this.toasts.shift();
            showDomToast(lv, message);
            this.notify();
        });
    }
    // ---- iframe 挂载 ----
    ensureContainer() {
        if (this.container === null) {
            const el = document.createElement('div');
            el.dataset['dshtThRuntime'] = this.sessionId;
            document.body.append(el);
            this.container = el;
        }
        return this.container;
    }
    mountScript(script) {
        const status = {
            phase: 'loading',
            missing: [],
            buttons: script.buttons.map(b => ({ ...b })),
        };
        this.statuses.set(script.id, status);
        const iframe = document.createElement('iframe');
        // 同源形态复刻（用户拍板的定案）：真酒馆助手（TH/JS-Slash-Runner）的脚本 iframe 是
        // srcdoc + same-origin（sandbox 无限制），predefine.js 直接 window.parent.$、从 parent
        // 合并 ['EjsTemplate','TavernHelper','YAML','showdown','toastr','z']。此前我们只给
        // allow-scripts（opaque origin），「飞讯 0703」卡的 window.parent.$ 直接被跨域拦截——
        // 不是系统限制，是我们自己的 sandbox 设置。现在放开 allow-same-origin：srcdoc + 这两个
        // token = 与宿主同源，脚本可访问 parent（配合 host-vendor 在宿主 window 上补挂的
        // $/_/z/YAML 全局，等效真 TH 形态）。同源后 localStorage 原生可用（shim 的存储垫
        // 探测成功即自动不遮蔽，无需改动）。
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.name = script.id;
        iframe.title = `TH 脚本：${script.name}`;
        // 默认隐藏（真 TH v-show=false 同款）：实测深色宿主里满视口 iframe 的画布会
        // 以不透明白色打底（内部 html/body 透明也压不住），16 个脚本 iframe 叠层把
        // 整个聊天区刷白。脚本报 hasUi（th:ui）后才显示——有 UI 的脚本画布透明、
        // 只露出自己的浮动部件。铺满视口：position:fixed 部件视觉等效 ST 顶层注入。
        iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;pointer-events:none;z-index:1;background:transparent;visibility:hidden';
        iframe.srcdoc = buildIframeDocument({
            scriptId: script.id,
            scriptName: script.name,
            secret: this.secret,
            version: SHIM_VERSION,
            content: script.content,
        });
        this.frames.set(script.id, iframe);
        this.ensureContainer().append(iframe);
        // 执行超时 watchdog（只判 loading 期；运行期错误记 error 不翻转状态）
        setTimeout(() => {
            const st = this.statuses.get(script.id);
            if (st && st.phase === 'loading') {
                st.phase = 'failed';
                st.error = `执行超时（${READY_TIMEOUT_MS / 1000}s 未就绪）`;
                this.notify();
            }
        }, READY_TIMEOUT_MS);
    }
    // ---- 桥消息处理 ----
    handleMessage(msg) {
        if (!msg || msg.secret !== this.secret)
            return;
        const st = this.statuses.get(msg.scriptId);
        if (msg.th === 'status') {
            if (!st)
                return;
            if (msg.phase === 'running') {
                if (st.phase === 'loading')
                    st.phase = 'running';
            }
            else if (msg.phase === 'failed') {
                // 诚实化：loading 期失败翻转状态；运行期错误只记录（脚本可能部分可用）
                if (st.phase === 'loading')
                    st.phase = 'failed';
                st.error = msg.error ?? '未知错误';
            }
            this.notify();
            return;
        }
        if (msg.th === 'missing') {
            if (st && !st.missing.includes(msg.api)) {
                st.missing.push(msg.api);
                this.notify();
            }
            return;
        }
        if (msg.th === 'toast') {
            console.log(`[dsht-th] toast(${msg.level}) ${msg.scriptId}: ${msg.message}`);
            this.toasts.push({ ts: Date.now(), level: msg.level, message: msg.message, scriptId: msg.scriptId });
            if (this.toasts.length > 50)
                this.toasts.shift();
            this.notify();
            return;
        }
        if (msg.th === 'ui') {
            if (st) {
                st.hasUi = msg.hasUi;
                const frame = this.frames.get(msg.scriptId);
                if (frame) {
                    if (msg.hasUi && msg.rect && msg.rect.w > 0 && msg.rect.h > 0) {
                        // iframe 只包住脚本 UI 的并集矩形（满视口画布在深色宿主会刷白盖住聊天区）；
                        // 收小后可放心开 pointer-events——脚本浮动部件可点了（沙箱隔离不变）
                        const { x, y, w, h } = msg.rect;
                        frame.style.left = `${x}px`;
                        frame.style.top = `${y}px`;
                        frame.style.width = `${w}px`;
                        frame.style.height = `${h}px`;
                        frame.style.inset = 'auto';
                        frame.style.visibility = 'visible';
                        frame.style.pointerEvents = 'auto';
                    }
                    else {
                        frame.style.visibility = 'hidden';
                        frame.style.pointerEvents = 'none';
                    }
                }
                this.notify();
            }
            return;
        }
        if (msg.th === 'console') {
            // C15 日志抽屉：脚本 iframe console 汇入（最多 200 条；节流刷新防高日志频刷爆 React）
            this.logs.push({ ts: Date.now(), level: msg.level, message: msg.message, scriptId: msg.scriptId });
            if (this.logs.length > 200)
                this.logs.shift();
            if (!this.consoleNotifyTimer) {
                this.consoleNotifyTimer = setTimeout(() => {
                    this.consoleNotifyTimer = 0;
                    this.notify();
                }, 400);
            }
            return;
        }
        // call：幂等可追溯
        const call = msg;
        console.debug(`[dsht-th] call ${call.scriptId} ${call.api}`, call.args);
        const respond = (ok, value, error) => {
            const frame = this.frames.get(call.scriptId);
            frame?.contentWindow?.postMessage({
                '__dsht_th': true, secret: this.secret, scriptId: call.scriptId,
                th: 'result', callId: call.callId, ok, ...(ok ? { value } : { error }),
            }, '*');
        };
        handleBridgeCall(this.bridgeDeps, call.scriptId, call.api, call.args)
            .then(value => respond(true, value ?? null))
            .catch((e) => respond(false, undefined, e.message));
    }
    bridgeDeps = {
        varsGet: (scope, scriptId) => thVarsGet(scope, this.slug, this.sessionId, scriptId),
        varsPut: async (scope, tree, scriptId) => {
            await thApi('variables', { scope, slug: this.slug, sessionId: this.sessionId, scriptId, variables: tree });
        },
        varsMerge: async (scope, vars, mode, scriptId) => {
            const cur = await thVarsGet(scope, this.slug, this.sessionId, scriptId);
            const next = mode === 'insert' ? deepMergeInsert(cur, vars) : deepMergeAssign(cur, vars);
            await thApi('variables', { scope, slug: this.slug, sessionId: this.sessionId, scriptId, variables: next });
        },
        varsDelete: async (scope, path, scriptId) => {
            await thApi('variables', { scope, slug: this.slug, sessionId: this.sessionId, scriptId, path }, 'DELETE');
        },
        varsAll: async (scriptId) => {
            const [global, preset, character, script, chat] = await Promise.all([
                thVarsGet('global', '', '', ''),
                thVarsGet('preset', '', this.sessionId, ''),
                thVarsGet('character', this.slug, '', ''),
                thVarsGet('script', '', this.sessionId, scriptId),
                thVarsGet('chat', '', this.sessionId, ''),
            ]);
            // 真 TH _getAllVariables 顺序：global < character < script < chat（preset 位于 global 与 character 之间）
            return deepMergeAssign(deepMergeAssign(deepMergeAssign(deepMergeAssign(global, preset), character), script), chat);
        },
        buttonsGet: (scriptId) => [...(this.statuses.get(scriptId)?.buttons ?? [])],
        buttonsSet: (scriptId, buttons) => {
            const st = this.statuses.get(scriptId);
            if (!st)
                return;
            st.buttons = buttons
                .filter(b => b && typeof b.name === 'string' && b.name)
                .map(b => ({ name: b.name, visible: b.visible !== false }));
            this.notify();
        },
        primaryLorebook: async () => {
            return await this.fetchPrimaryLorebook();
        },
        // ---- 上下文 / 预设 / 聊天消息 / 正则 / 世界书（sessionId/slug 空缺回填运行时会话/工作区）----
        ctxGet: async (sessionId, slug) => {
            try {
                return await thApi('context', { sessionId: sessionId || this.sessionId, slug: slug || this.slug });
            }
            catch (e) {
                console.warn('[dsht-th] ctx:get 失败:', e.message);
                return null;
            }
        },
        presetNames: (sessionId) => thApi('preset/names', { sessionId: sessionId || this.sessionId }),
        // presetGet/presetPut 带 sessionId：ST 哨兵名 'in_use'（= 当前加载预设）由 facade 按会话解析
        presetGet: (name) => thApi('preset/get', { name, sessionId: this.sessionId }),
        presetPut: async (name, prompts, prompt_order, create) => {
            await thApi('preset/put', { name, prompts, prompt_order, sessionId: this.sessionId, ...(create ? { create: true } : {}) });
        },
        presetDelete: async (name) => { await thApi('preset/delete', { name }); },
        presetRename: async (name, newName) => { await thApi('preset/rename', { name, newName }); },
        presetLoad: async (sessionId, name) => {
            await thApi('preset/load', { sessionId: sessionId || this.sessionId, name });
        },
        chatMessages: (sessionId) => thApi('chat/messages', { sessionId: sessionId || this.sessionId }),
        regexesGet: (slug, sessionId) => thApi('regexes/get', { slug: slug || this.slug, sessionId: sessionId || this.sessionId }),
        regexesReplace: async (regexes, scope, slug, sessionId) => {
            // 精确按契约组装：global 只需 scope；character 需 slug；preset 需 presetId（快照解析，缺则给 sessionId 兜底）
            const payload = { regexes, scope };
            if (scope === 'character')
                payload['slug'] = slug || this.slug;
            if (scope === 'preset') {
                const presetId = this.contextSnapshot?.presetId;
                if (presetId)
                    payload['presetId'] = presetId;
                payload['sessionId'] = sessionId || this.sessionId;
            }
            await thApi('regexes/replace', payload);
        },
        wbList: () => thApi('worldbook/list', {}),
        wbGet: (name) => thApi('worldbook/get', { name }),
        wbEntryPut: async (name, entry) => { await thApi('worldbook/entry-put', { name, entry }); },
        // ---- 【实机审计修复 2026-09-05】P1/P2 长尾 deps ----
        // substitudeMacros：运行期宏展开（{{setvar}} 等写盘语义在 facade 内收口）
        macrosExpand: (text) => thApi('macros/expand', { text, slug: this.slug, sessionId: this.sessionId }),
        // replaceLorebookEntries：世界书条目整表替换
        wbReplaceEntries: async (name, entries) => {
            await thApi('worldbook/replace-entries', { name, entries, sessionId: this.sessionId });
        },
        // rebindGlobalWorldbooks：全局激活书单整组重绑
        wbRebindGlobal: async (names) => {
            await thApi('worldbook/rebind-global', { books: names, sessionId: this.sessionId });
        },
        // rebindCharWorldbooks：角色工作区书单整组重绑
        wbRebindChar: async (slug, names) => {
            await thApi('worldbook/rebind-char', { slug, books: names, sessionId: this.sessionId });
        },
        // getOrCreateChatWorldbook：会话绑定世界书缺则建
        wbChatGetOrCreate: () => thApi('worldbook/chat-get-or-create', { sessionId: this.sessionId, slug: this.slug }),
        // ---- C7/C8/C9/D6 扩展面 ----
        // chat 作用域深合并：facade /variables/merge（服务端 undo/快照/D7 schema 校验收口）
        varsAssignChat: async (vars) => {
            await thApi('variables/merge', { sessionId: this.sessionId, variables: vars });
        },
        // C7 registerVariableSchema 数据面（成功提醒走 D8 开关）
        varsSchemaPut: async (name, schema) => {
            await thApi('variables/schema', { sessionId: this.sessionId, name, variableSchema: schema });
            this.notifyUser('success', `变量结构已注册${name ? `：${name}` : '（整树）'}`);
        },
        // C8 prompt 注入存储（消费接线归 dsh-plugin 主线程排程，宿主只落盘）
        injectsPut: async (injections) => {
            await thApi('inject', { sessionId: this.sessionId, injections });
        },
        injectsRemove: async (keys) => {
            await thApi('uninject', { sessionId: this.sessionId, keys });
        },
        // C9 一次性补全（TH 插件 loopback 转发 /dsht-rp/llm/classify）
        generate: (system, prompt) => thApi('generate', { sessionId: this.sessionId, system, prompt }),
        // D6 window.Mvu 数据面（/dsht-mvu/* 直连，不经 thApi 前缀）
        mvuVariables: async () => {
            const resp = await fetch(`/dsht-mvu/variables?sessionId=${encodeURIComponent(this.sessionId)}`);
            const body = await resp.json();
            if (body.error)
                throw new Error(body.error);
            return body.variables ?? {};
        },
        mvuReplace: async (data) => {
            const resp = await fetch('/dsht-mvu/variables/register', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, variables: data, replace: true }),
            });
            const body = await resp.json();
            if (resp.status === 422) {
                // D8：schema 校验失败——console.warn + 开关放行时提醒
                console.warn('[dsht-th] MVU 变量替换校验失败（422）:', body);
                this.notifyUser('failure', String(body.error ?? '变量结构校验失败'));
            }
            if (body.error)
                throw new Error(body.error);
            this.notifyUser('success', 'MVU 变量数据已替换写入');
        },
    };
    // ---- 上下文快照（getContext 同步面）----
    /** 当前角色 primary 世界书名（rp/workspaces 第一本；快照 characterLorebook 字段供 getCharWorldbookNames 同步读） */
    async fetchPrimaryLorebook() {
        try {
            const r = await rpApi('rp/workspaces');
            const ws = (r.workspaces ?? []).find(w => w.slug === this.slug);
            return ws?.books?.[0]?.name ?? null;
        }
        catch {
            return null;
        }
    }
    /**
     * 拉取 /context + /chat/messages 合并成快照，postMessage({th:'context'}) 推给全部 iframe。
     * iframe 内 getContext() / SillyTavern.getContext() 同步读；失败静默（console.warn），不影响脚本运行。
     */
    loadContextSnapshot() {
        if (this.destroyed)
            return;
        void Promise.all([
            thApi('context', { sessionId: this.sessionId, slug: this.slug }),
            thApi('chat/messages', { sessionId: this.sessionId }),
            this.fetchPrimaryLorebook(),
        ]).then(([ctx, chat, characterLorebook]) => {
            if (this.destroyed)
                return;
            const snapshot = {
                ...ctx,
                slug: this.slug,
                characterLorebook,
                messages: Array.isArray(chat?.messages) ? chat.messages : [],
            };
            this.contextSnapshot = snapshot;
            for (const [scriptId, frame] of this.frames) {
                frame.contentWindow?.postMessage({
                    '__dsht_th': true, secret: this.secret, scriptId,
                    th: 'context', context: snapshot,
                }, '*');
            }
        }).catch((e) => {
            console.warn('[dsht-th] 上下文快照拉取失败:', e.message);
        });
    }
    // ---- 会话事件流（快照 diff → ST 事件投递）----
    emitSessionEvent(eventType, args) {
        for (const [scriptId, frame] of this.frames) {
            frame.contentWindow?.postMessage({
                '__dsht_th': true, secret: this.secret, scriptId,
                th: 'event', eventType, args,
            }, '*');
        }
    }
    /** 快照推进（组件 props 变化驱动；RP 会话才调用） */
    advance(snapshot) {
        this.lastSnapshot = snapshot;
        const order = snapshot.chat?.order?.length ?? snapshot.surface?.nodes?.length ?? 0;
        const nodes = snapshot.surface?.nodes;
        const lastKind = nodes && nodes.length > 0 ? String(nodes[nodes.length - 1]?.kind ?? '') : '';
        const running = snapshot.running === true;
        if (this.prevOrder >= 0 && order > this.prevOrder) {
            const idx = order - 1;
            if (lastKind === 'user')
                this.emitSessionEvent('message_sent', [idx]);
            else if (lastKind)
                this.emitSessionEvent('message_received', [idx]);
        }
        if (!this.prevRunning && running)
            this.emitSessionEvent('generation_started', []);
        if (this.prevRunning && !running) {
            this.emitSessionEvent('generation_ended', [order]);
            // 生成结束后消息面已变：重拉快照推给 iframe（getContext 同步面保持新鲜）
            this.loadContextSnapshot();
        }
        this.prevOrder = order;
        this.prevRunning = running;
    }
    /**
     * 【实机审计修复 2026-09-05】RpNativeChat 成功回调桥（message_swiped / message_edited）：
     * 变体切换 / 会话编辑成功处 dispatch 的 TH_HOST_EVENT 进来后，把锚（assistant 的
     * messageId / user 的 nodeKey）解析为楼层号再投递。楼层号 = chat.order 下标（与
     * advance() 的 message_sent/received 楼层口径一致）；解析不到（快照未含该消息）静默跳过。
     */
    emitNativeChatEvent(sessionId, eventType, anchor) {
        if (sessionId !== this.sessionId)
            return;
        const chat = this.lastSnapshot?.chat;
        const order = chat?.order;
        const nodes = chat?.nodes;
        if (!order || !nodes)
            return;
        const messageIdByKey = new Map();
        for (const n of nodes.values()) {
            if (typeof n.key === 'string')
                messageIdByKey.set(n.key, n.data?.finalNode?.messageId);
        }
        let floor = -1;
        let i = 0;
        for (const key of order) {
            const k = String(key);
            if ((anchor.nodeKey !== undefined && k === anchor.nodeKey)
                || (anchor.messageId !== undefined && messageIdByKey.get(k) === anchor.messageId)) {
                floor = i;
                break;
            }
            i++;
        }
        if (floor >= 0)
            this.emitSessionEvent(eventType, [floor]);
    }
    clickButton(scriptId, buttonName) {
        this.emitSessionEvent(getButtonEventId(scriptId, buttonName), []);
    }
}
/** 会话级单例注册表 */
const runtimes = new Map();
function runtimeFor(sessionId, slug) {
    // 单会话活跃：挂载新会话的运行时时，销毁其他会话的残留运行时
    //（实测：iframe 挂 document.body 跨视图存活，离开会话后脚本仍在首页刷白屏）
    for (const [sid, rt] of runtimes) {
        if (sid !== sessionId) {
            rt.destroy();
            runtimes.delete(sid);
        }
    }
    let rt = runtimes.get(sessionId);
    if (rt === undefined) {
        rt = new SessionRuntime(sessionId, slug);
        runtimes.set(sessionId, rt);
    }
    return rt;
}
/** 离开一切 RP 会话（首页/非 RP 会话视图）：销毁全部运行时 */
function destroyAllRuntimes() {
    for (const rt of runtimes.values())
        rt.destroy();
    runtimes.clear();
}
/** 全局 message 分发（一次注册） */
let messageListenerInstalled = false;
function ensureMessageListener() {
    if (messageListenerInstalled || typeof window === 'undefined')
        return;
    messageListenerInstalled = true;
    window.addEventListener('message', (e) => {
        const msg = parseIncomingMessage(e.data);
        if (!msg)
            return;
        for (const rt of runtimes.values()) {
            if (rt.statuses.has(msg.scriptId)) {
                rt.handleMessage(msg);
                return;
            }
        }
    });
    // 【实机审计修复 2026-09-05】message_swiped / message_edited 桥：RpNativeChat 的
    // 变体切换 / 会话编辑成功回调 dispatch（宿主页同源 CustomEvent，零新依赖）
    window.addEventListener(TH_HOST_EVENT, (ev) => {
        const detail = ev.detail;
        if (!detail?.sessionId || !detail.eventType)
            return;
        runtimes.get(detail.sessionId)?.emitNativeChatEvent(detail.sessionId, detail.eventType, { messageId: detail.messageId, nodeKey: detail.nodeKey });
    });
}
const PANEL_POS = { right: '4vw', bottom: '12vh' };
export function RpScriptHost(props) {
    const s = (props.session ?? {});
    const sessionId = s.sessionId ?? s.id ?? '';
    const { slug, resolved } = useRpSlug(s.header?.cwd ?? s.cwd, sessionId);
    const [, forceTick] = useState(0);
    const [open, setOpen] = useState(false);
    // C15 Toolbox：日志抽屉 / 变量查看器（互斥 tab；none = 都收起）
    const [tab, setTab] = useState('none');
    const [varsText, setVarsText] = useState('');
    const [varsLoading, setVarsLoading] = useState(false);
    const rtRef = useRef(null);
    // 运行时启动（slug 解析完成后）；离开一切 RP 会话（首页无 sessionId /
    // 非 RP 会话 slug 落定 null）时销毁全部残留运行时——iframe 挂 document.body，
    // 不主动收就会漏到其他视图（实测首页被残留脚本 iframe 刷白）
    useEffect(() => {
        if (!sessionId) {
            destroyAllRuntimes();
            return;
        }
        if (resolved && !slug) {
            destroyAllRuntimes();
            return;
        }
        if (!slug)
            return;
        ensureMessageListener();
        const rt = runtimeFor(sessionId, slug);
        rtRef.current = rt;
        rt.start();
        return rt.subscribe(() => forceTick(t => t + 1));
    }, [sessionId, slug, resolved]);
    // 会话快照推进 → 事件投递
    useEffect(() => {
        rtRef.current?.advance(s);
    });
    // C15 变量查看器：切到「变量」tab 时拉一次 MVU 变量树（GET /dsht-mvu/variables，只读）
    useEffect(() => {
        if (tab !== 'vars' || !sessionId)
            return;
        let alive = true;
        setVarsLoading(true);
        fetch(`/dsht-mvu/variables?sessionId=${encodeURIComponent(sessionId)}`)
            .then(r => r.json())
            .then(b => {
            if (!alive)
                return;
            if (b.error)
                setVarsText(`读取失败：${b.error}`);
            else
                setVarsText(JSON.stringify(b.variables ?? {}, null, 2));
        })
            .catch((e) => { if (alive)
            setVarsText(`读取失败：${e.message}`); })
            .finally(() => { if (alive)
            setVarsLoading(false); });
        return () => { alive = false; };
    }, [tab, sessionId]);
    if (!slug || !sessionId)
        return null;
    const rt = rtRef.current;
    if (rt === null || rt.scriptCount === 0)
        return null;
    const scripts = rt.scripts;
    const allButtons = scripts.flatMap(sc => (rt.statuses.get(sc.id)?.buttons ?? [])
        .filter(b => b.visible && (sc.buttonEnabled || rt.statuses.get(sc.id)?.phase === 'running'))
        .map(b => ({ scriptId: sc.id, scriptName: sc.name, name: b.name })));
    return (<>
      <button type="button" className="dsht-rp-scriptball" title={`酒馆助手脚本（${scripts.length} 个已装载）`} onClick={() => setOpen(o => !o)}>🧩</button>
      {open && (<div className="dsht-rp-script-panel" role="dialog" aria-label="酒馆助手脚本" style={PANEL_POS}>
          <div className="sf-head">
            <span>🧩 酒馆助手脚本</span>
            <span className="sf-head-actions">
              {/* C15 Toolbox：日志抽屉 / 变量查看器 */}
              <button type="button" className="sf-btn" style={tab === 'logs' ? { opacity: 1, fontWeight: 700 } : undefined} onClick={() => setTab(t => (t === 'logs' ? 'none' : 'logs'))}>日志</button>
              <button type="button" className="sf-btn" style={tab === 'vars' ? { opacity: 1, fontWeight: 700 } : undefined} onClick={() => setTab(t => (t === 'vars' ? 'none' : 'vars'))}>变量</button>
              <button type="button" className="sf-btn" onClick={() => { rt.reloadAll(); }}>重载</button>
              <button type="button" className="sf-btn" onClick={() => { setOpen(false); setTab('none'); }}>✕</button>
            </span>
          </div>
          <div className="sf-body">
            {allButtons.length > 0 && (<div className="th-buttons">
                {allButtons.map(b => (<button key={`${b.scriptId}:${b.name}`} type="button" className="sf-btn th-btn" title={`${b.scriptName} · ${b.name}`} onClick={() => { rt.clickButton(b.scriptId, b.name); }}>{b.name}</button>))}
              </div>)}
            {scripts.map(sc => {
                const st = rt.statuses.get(sc.id);
                return (<div key={sc.id} className="th-row">
                  <span className={`th-badge th-${st?.phase ?? 'loading'}`}>
                    {st?.phase === 'running' ? '运行中' : st?.phase === 'failed' ? '失败' : '加载中'}
                  </span>
                  <span className="sf-key">{sc.name}</span>
                  <span className="th-src">{sc.source === 'preset' ? '预设' : '卡'}</span>
                  {st?.error && <div className="sf-error th-detail">错误：{st.error}</div>}
                  {st !== undefined && st.missing.length > 0 && (<div className="th-detail th-missing">缺 API：{st.missing.join('、')}</div>)}
                  {st?.hasUi === true && <div className="th-detail">（脚本自有 UI 已按内容区域显示，可直接点按）</div>}
                </div>);
            })}
            {rt.toasts.length > 0 && (<div className="th-detail th-toasts">
                最近提示：{rt.toasts[rt.toasts.length - 1]?.message}
              </div>)}
            {/* C15 日志抽屉：脚本 iframe console 实时汇入（最新在上；最多 200 条） */}
            {tab === 'logs' && (<div className="th-toolbox" style={{ maxHeight: 240, overflowY: 'auto', marginTop: 6, borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 6 }}>
                {rt.logs.length === 0
                    ? <div className="th-detail">（暂无脚本日志；脚本 console 输出实时汇入，最多保留 200 条）</div>
                    : rt.logs.slice().reverse().map((l, i) => (<div key={i} className="th-detail" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      <span style={{ opacity: 0.6 }}>[{new Date(l.ts).toLocaleTimeString()}] {l.scriptId}/{l.level}</span>{' '}
                      {l.message}
                    </div>))}
              </div>)}
            {/* C15 变量查看器：MVU 变量树只读 JSON 视图（GET /dsht-mvu/variables） */}
            {tab === 'vars' && (<div className="th-toolbox" style={{ maxHeight: 300, overflowY: 'auto', marginTop: 6, borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 6 }}>
                <div className="th-detail">MVU 变量树（/dsht-mvu/variables，只读）</div>
                <pre style={{ margin: '4px 0 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {varsLoading ? '读取中…' : (varsText || '（空）')}
                </pre>
              </div>)}
          </div>
        </div>)}
    </>);
}
