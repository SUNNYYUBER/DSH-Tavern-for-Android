// src/dsht-plugin-prompt-template/index.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join as join2 } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

// src/dsht-plugin-prompt-template/ejs.ts
function lexExpr(src) {
  const toks = [];
  let i = 0;
  const isIdStart = (c) => /[A-Za-z_$]/.test(c);
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(src[i + 1] ?? "")) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`bad number: ${src.slice(i, j)}`);
      toks.push({ t: "num", v });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let out = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") {
          const n = src[j + 1];
          out += n === "n" ? "\n" : n === "t" ? "	" : n === "r" ? "\r" : n ?? "";
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= src.length) throw new Error("unterminated string literal");
      toks.push({ t: "str", v: out });
      i = j + 1;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < src.length && isId(src[j])) j++;
      toks.push({ t: "ident", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      toks.push({ t: "op", v: three });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*%/!<>?:.,()[]".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`unexpected char in expression: ${c}`);
  }
  return toks;
}
var BIN_PREC = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "===": 3,
  "!==": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6
};
function parseExpr(src) {
  const toks = lexExpr(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => {
    const t = toks[pos++];
    if (!t) throw new Error("unexpected end of expression");
    return t;
  };
  const expectOp = (v) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new Error(`expected '${v}'`);
  };
  function parsePrimary() {
    const t = next();
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "ident") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if (t.v === "undefined") return { k: "lit", v: void 0 };
      return { k: "ref", name: t.v };
    }
    if (t.t === "op" && (t.v === "!" || t.v === "-" || t.v === "+")) {
      return { k: "un", op: t.v, a: parsePrimary() };
    }
    if (t.t === "op" && t.v === "(") {
      const e2 = parseTernary();
      expectOp(")");
      return e2;
    }
    throw new Error(`unexpected token: ${t.v}`);
  }
  function parsePostfix() {
    let e2 = parsePrimary();
    for (; ; ) {
      const t = peek();
      if (t?.t === "op" && t.v === ".") {
        next();
        const id = next();
        if (id.t !== "ident") throw new Error("expected property name after '.'");
        e2 = { k: "get", obj: e2, key: id.v };
      } else if (t?.t === "op" && t.v === "[") {
        next();
        const idx = parseTernary();
        expectOp("]");
        e2 = { k: "get", obj: e2, key: idx };
      } else break;
    }
    return e2;
  }
  function parseBin(minPrec) {
    let left = parsePostfix();
    for (; ; ) {
      const t = peek();
      if (t?.t !== "op") break;
      const prec = BIN_PREC[t.v];
      if (prec === void 0 || prec < minPrec) break;
      next();
      const right = parseBin(prec + 1);
      left = { k: "bin", op: t.v, a: left, b: right };
    }
    return left;
  }
  function parseTernary() {
    const c = parseBin(1);
    const t = peek();
    if (t?.t === "op" && t.v === "?") {
      next();
      const a = parseTernary();
      expectOp(":");
      const b = parseTernary();
      return { k: "cond", c, a, b };
    }
    return c;
  }
  const e = parseTernary();
  if (pos < toks.length) throw new Error(`trailing tokens in expression: ${src}`);
  return e;
}
function lookup(scopes, name2) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(scopes[i], name2)) return scopes[i][name2];
  }
  return void 0;
}
function looseEq(a, b) {
  return a == b;
}
function evalExpr(e, scopes) {
  switch (e.k) {
    case "lit":
      return e.v;
    case "ref":
      return lookup(scopes, e.name);
    case "get": {
      const obj = evalExpr(e.obj, scopes);
      if (obj === null || obj === void 0) return void 0;
      const key = typeof e.key === "string" ? e.key : evalExpr(e.key, scopes);
      return obj[key];
    }
    case "un": {
      const v = evalExpr(e.a, scopes);
      if (e.op === "!") return !v;
      if (e.op === "-") return -Number(v);
      return +Number(v);
    }
    case "bin": {
      if (e.op === "&&") return evalExpr(e.a, scopes) && evalExpr(e.b, scopes);
      if (e.op === "||") return evalExpr(e.a, scopes) || evalExpr(e.b, scopes);
      const a = evalExpr(e.a, scopes);
      const b = evalExpr(e.b, scopes);
      switch (e.op) {
        case "+":
          return typeof a === "string" || typeof b === "string" ? String(a ?? "") + String(b ?? "") : Number(a) + Number(b);
        case "-":
          return Number(a) - Number(b);
        case "*":
          return Number(a) * Number(b);
        case "/":
          return Number(a) / Number(b);
        case "%":
          return Number(a) % Number(b);
        case "==":
          return looseEq(a, b);
        case "!=":
          return !looseEq(a, b);
        case "===":
          return a === b;
        case "!==":
          return a !== b;
        case "<":
          return a < b;
        case "<=":
          return a <= b;
        case ">":
          return a > b;
        case ">=":
          return a >= b;
        default:
          throw new Error(`unsupported operator: ${e.op}`);
      }
    }
    case "cond":
      return evalExpr(e.c, scopes) ? evalExpr(e.a, scopes) : evalExpr(e.b, scopes);
  }
}
function lexTemplate(template) {
  const segs = [];
  let i = 0;
  let textStart = 0;
  const flushText = (end) => {
    if (end > textStart) segs.push({ t: "text", s: template.slice(textStart, end) });
  };
  while (i < template.length) {
    if (template.startsWith("<%%", i)) {
      i += 3;
      continue;
    }
    const isEjs = template.startsWith("<%", i);
    const isMacro = template.startsWith("{{", i);
    if (!isEjs && !isMacro) {
      i++;
      continue;
    }
    flushText(i);
    if (isMacro) {
      const end2 = template.indexOf("}}", i + 2);
      if (end2 === -1) throw new Error("unclosed {{");
      segs.push({ t: "out", expr: template.slice(i + 2, end2).trim(), escaped: false });
      i = end2 + 2;
      textStart = i;
      continue;
    }
    const end = template.indexOf("%>", i + 2);
    if (end === -1) throw new Error("unclosed <%");
    const inner = template.slice(i + 2, end);
    i = end + 2;
    textStart = i;
    if (inner.startsWith("#")) continue;
    if (inner.startsWith("=")) {
      segs.push({ t: "out", expr: inner.slice(1).trim(), escaped: true });
      continue;
    }
    if (inner.startsWith("-")) {
      segs.push({ t: "out", expr: inner.slice(1).trim(), escaped: false });
      continue;
    }
    segs.push({ t: "code", s: inner.trim() });
  }
  flushText(template.length);
  for (const s of segs) if (s.t === "text") s.s = s.s.replaceAll("<%%", "<%");
  return segs;
}
var RE_IF = /^if\s*\(([\s\S]+)\)\s*\{\s*$/;
var RE_ELSE_IF = /^}\s*else\s+if\s*\(([\s\S]+)\)\s*\{\s*$/;
var RE_ELSE = /^}\s*else\s*\{\s*$/;
var RE_CLOSE = /^}\s*$/;
var RE_FOR = /^for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s+of\s+([\s\S]+?)\)\s*\{\s*$/;
var RE_SET = /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]+)$/;
function parseTemplate(template) {
  const segs = lexTemplate(template);
  let pos = 0;
  function parseNodes(inBlock) {
    const nodes2 = [];
    while (pos < segs.length) {
      const seg = segs[pos];
      if (seg.t === "text") {
        nodes2.push({ k: "text", s: seg.s });
        pos++;
        continue;
      }
      if (seg.t === "out") {
        nodes2.push({ k: "out", expr: parseExpr(seg.expr || "undefined"), escaped: seg.escaped });
        pos++;
        continue;
      }
      const code = seg.s;
      let m;
      if (m = code.match(RE_ELSE_IF)) {
        if (!inBlock) throw new Error(`'} else if' without matching 'if'`);
        return { nodes: nodes2, term: "else-if", elseIfCond: parseExpr(m[1]) };
      }
      if (RE_ELSE.test(code)) {
        if (!inBlock) throw new Error(`'} else' without matching 'if'`);
        return { nodes: nodes2, term: "else" };
      }
      if (RE_CLOSE.test(code)) {
        if (!inBlock) throw new Error(`'}' without matching block`);
        return { nodes: nodes2, term: "close" };
      }
      if (m = code.match(RE_IF)) {
        pos++;
        const branches = [];
        let cond = parseExpr(m[1]);
        for (; ; ) {
          const sub = parseNodes(true);
          branches.push({ cond, body: sub.nodes });
          if (sub.term === "else-if") {
            pos++;
            cond = sub.elseIfCond ?? null;
            continue;
          }
          if (sub.term === "else") {
            pos++;
            const elseBody = parseNodes(true);
            if (elseBody.term !== "close") throw new Error(`'else' block not closed`);
            branches.push({ cond: null, body: elseBody.nodes });
            break;
          }
          if (sub.term !== "close") throw new Error(`'if' block not closed`);
          break;
        }
        pos++;
        nodes2.push({ k: "if", branches });
        continue;
      }
      if (m = code.match(RE_FOR)) {
        pos++;
        const sub = parseNodes(true);
        if (sub.term !== "close") throw new Error(`'for' block not closed`);
        pos++;
        nodes2.push({ k: "for", varName: m[1], indexVar: m[2] ?? null, iter: parseExpr(m[3]), body: sub.nodes });
        continue;
      }
      if (m = code.match(RE_SET)) {
        pos++;
        nodes2.push({ k: "set", name: m[1], expr: parseExpr(m[2]) });
        continue;
      }
      throw new Error(`unsupported statement: <% ${code.length > 60 ? code.slice(0, 60) + "\u2026" : code} %>`);
    }
    return { nodes: nodes2, term: "eof" };
  }
  const { nodes, term } = parseNodes(false);
  if (term !== "eof") throw new Error("template parse error: unbalanced block");
  return nodes;
}
function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
var parseCache = /* @__PURE__ */ new Map();
var cacheConfig = { enabled: 0, size: 0, hasher: "h32ToString" };
function configureEjsCache(cfg) {
  cacheConfig = {
    enabled: cfg.enabled === 1 || cfg.enabled === 2 ? cfg.enabled : 0,
    size: typeof cfg.size === "number" && cfg.size > 0 ? Math.floor(cfg.size) : 0,
    hasher: cfg.hasher === "h64ToString" ? "h64ToString" : "h32ToString"
  };
}
function cacheHash(template) {
  if (cacheConfig.hasher === "h64ToString") {
    let h2 = 0xcbf29ce484222325n;
    for (let i = 0; i < template.length; i++) {
      h2 ^= BigInt(template.charCodeAt(i));
      h2 = h2 * 0x100000001b3n & 0xffffffffffffffffn;
    }
    return h2.toString(16);
  }
  let h = 2166136261;
  for (let i = 0; i < template.length; i++) {
    h ^= template.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function cachedParse(template) {
  if (cacheConfig.enabled === 0) return parseTemplate(template);
  const key = `${cacheHash(template)}:${template.length}`;
  const hit = parseCache.get(key);
  if (hit) return hit;
  const nodes = parseTemplate(template);
  if (cacheConfig.size > 0 && parseCache.size >= cacheConfig.size) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== void 0) parseCache.delete(oldest);
  }
  parseCache.set(key, nodes);
  return nodes;
}
function protectPreBlocks(text) {
  if (!text.includes("<pre")) return { text, blocks: [] };
  const blocks = [];
  const replaced = text.replace(/<pre[\s\S]*?<\/pre>/gi, (m) => {
    blocks.push(m);
    return `\0EJS_PRE_${blocks.length - 1}\0`;
  });
  return { text: replaced, blocks };
}
function restorePreBlocks(text, blocks) {
  return blocks.length === 0 ? text : text.replace(/\u0000EJS_PRE_(\d+)\u0000/g, (_m, i) => blocks[Number(i)] ?? "");
}
function stringify(v) {
  if (v === void 0 || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function renderNodes(nodes, scopes, out) {
  for (const n of nodes) {
    switch (n.k) {
      case "text":
        out.push(n.s);
        break;
      case "out": {
        const v = stringify(evalExpr(n.expr, scopes));
        out.push(n.escaped ? escapeHtml(v) : v);
        break;
      }
      case "if": {
        for (const b of n.branches) {
          if (b.cond === null || evalExpr(b.cond, scopes)) {
            renderNodes(b.body, scopes, out);
            break;
          }
        }
        break;
      }
      case "for": {
        const iter = evalExpr(n.iter, scopes);
        const arr = Array.isArray(iter) ? iter : [];
        arr.forEach((item, idx) => {
          const frame = { [n.varName]: item };
          if (n.indexVar !== null) frame[n.indexVar] = idx;
          renderNodes(n.body, [...scopes, frame], out);
        });
        break;
      }
      case "set": {
        const top = scopes[scopes.length - 1];
        top[n.name] = evalExpr(n.expr, scopes);
        break;
      }
    }
  }
}
function renderEjsSubset(template, context) {
  try {
    const nodes = cachedParse(template);
    const out = [];
    renderNodes(nodes, [context, {}], out);
    return out.join("");
  } catch (e) {
    throw new Error(`[dsht-ejs] ${e.message}`);
  }
}
function isEjsProcessed(msg) {
  const mark = msg.is_ejs_processed ?? msg.extra?.is_ejs_processed;
  if (mark === true) return true;
  return Array.isArray(mark) && mark.includes(true);
}
function renderMessages(template, context, messages, options = {}) {
  let rendered = 0;
  let skipped = 0;
  const out = messages.map((msg) => {
    if (isEjsProcessed(msg)) {
      skipped++;
      return msg;
    }
    let mes = String(msg.mes ?? "");
    let preBlocks = [];
    if (options.protectPre === true) {
      const p = protectPreBlocks(mes);
      mes = p.text;
      preBlocks = p.blocks;
    }
    const next = restorePreBlocks(renderEjsSubset(template || mes, { ...context, message: msg }), preBlocks);
    rendered++;
    return { ...msg, mes: next, is_ejs_processed: true };
  });
  return { messages: out, rendered, skipped };
}

// src/dsht-plugin-prompt-template/sandbox.ts
import { createContext, Script } from "node:vm";

// src/dsht-plugin-prompt-template/injection-store.ts
var MAX_PROMPT_INJECTION_KEY_CHARS = 256;
var MAX_PROMPT_INJECTION_CHARS = 256 * 1024;
var MAX_PROMPT_INJECTIONS = 512;
function injectionText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}
function applyPromptInjectionPostprocess(value, postprocess) {
  if (!Array.isArray(postprocess)) return value;
  let result = value;
  for (const item of postprocess) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item;
    const search = record.search;
    const replace = record.replace;
    if (typeof search !== "string" || typeof replace !== "string" || search === "") continue;
    result = result.replaceAll(search, replace);
  }
  return result;
}
function createPromptInjectionStore() {
  const entries = [];
  let sequence = 0;
  return {
    inject(key, prompt, order = 100, sticky = 0, uid = "") {
      const normalizedKey = injectionText(key).trim();
      if (normalizedKey === "" || normalizedKey.length > MAX_PROMPT_INJECTION_KEY_CHARS) return;
      const normalizedPrompt = injectionText(prompt);
      if (normalizedPrompt.length > MAX_PROMPT_INJECTION_CHARS) return;
      const normalizedOrder = Number.isFinite(order) ? Math.trunc(order) : 100;
      const normalizedSticky = Number.isFinite(sticky) ? Math.max(0, Math.trunc(sticky)) : 0;
      const normalizedUid = injectionText(uid);
      if (normalizedUid !== "") {
        const existing = entries.findIndex((item) => item.key === normalizedKey && item.uid === normalizedUid);
        if (existing >= 0) {
          entries[existing] = {
            key: normalizedKey,
            prompt: normalizedPrompt,
            order: normalizedOrder,
            sticky: normalizedSticky,
            uid: normalizedUid,
            sequence: entries[existing].sequence
          };
          return;
        }
      }
      if (entries.length >= MAX_PROMPT_INJECTIONS) return;
      entries.push({
        key: normalizedKey,
        prompt: normalizedPrompt,
        order: normalizedOrder,
        sticky: normalizedSticky,
        uid: normalizedUid,
        sequence: sequence++
      });
    },
    get(key, postprocess) {
      const normalizedKey = injectionText(key).trim();
      const combined = entries.filter((item) => item.key === normalizedKey).sort((left, right) => left.order - right.order || left.sequence - right.sequence).map((item) => item.prompt).join("\n");
      return applyPromptInjectionPostprocess(combined, postprocess);
    },
    has(key) {
      const normalizedKey = injectionText(key).trim();
      return entries.some((item) => item.key === normalizedKey);
    }
  };
}

// src/dsht-plugin-prompt-template/sandbox.ts
var MAX_TEMPLATE_CHARS = 256 * 1024;
var MAX_OUTPUT_CHARS = 256 * 1024;
var DEFAULT_TIMEOUT_MS = 1e3;
var MIN_TIMEOUT_MS = 10;
var MAX_TIMEOUT_MS = 5e3;
function segments(template) {
  const result = [];
  const literalClosings = (value) => value.replaceAll("%%>", "%>");
  let cursor = 0;
  let trimLeadingWhitespace = false;
  while (cursor < template.length) {
    const ejsAt = template.indexOf("<%", cursor);
    const macroAt = template.indexOf("{{", cursor);
    const isMacro = macroAt >= 0 && (ejsAt < 0 || macroAt < ejsAt);
    const opening = isMacro ? macroAt : ejsAt;
    if (opening < 0) {
      const tail = literalClosings(trimLeadingWhitespace ? template.slice(cursor).replace(/^\s+/u, "") : template.slice(cursor));
      if (tail !== "") result.push({ kind: "text", value: tail });
      return result;
    }
    let text = template.slice(cursor, opening);
    if (trimLeadingWhitespace) text = text.replace(/^\s+/u, "");
    trimLeadingWhitespace = false;
    if (isMacro) {
      if (text !== "") result.push({ kind: "text", value: literalClosings(text) });
      const closing2 = template.indexOf("}}", opening + 2);
      if (closing2 < 0) return void 0;
      result.push({ kind: "raw", value: template.slice(opening + 2, closing2).trim() });
      cursor = closing2 + 2;
      continue;
    }
    const marker = template[opening + 2];
    if (marker === "%") {
      if (text !== "") result.push({ kind: "text", value: literalClosings(text) });
      result.push({ kind: "text", value: "<%" });
      cursor = opening + 3;
      continue;
    }
    if (marker === "_") text = text.replace(/\s+$/u, "");
    if (text !== "") result.push({ kind: "text", value: literalClosings(text) });
    const contentStart = opening + (marker === "=" || marker === "-" || marker === "#" || marker === "_" ? 3 : 2);
    const closing = template.indexOf("%>", contentStart);
    if (closing < 0) return void 0;
    const closeMarker = template[closing - 1];
    const contentEnd = closeMarker === "-" || closeMarker === "_" ? closing - 1 : closing;
    const value = template.slice(contentStart, contentEnd);
    if (marker !== "#") {
      result.push({
        kind: marker === "=" ? "escaped" : marker === "-" ? "raw" : "code",
        value
      });
    }
    cursor = closing + 2;
    if (closeMarker === "_") {
      trimLeadingWhitespace = true;
    } else if (closeMarker === "-") {
      if (template.startsWith("\r\n", cursor)) cursor += 2;
      else if (template[cursor] === "\n" || template[cursor] === "\r") cursor += 1;
    }
  }
  return result;
}
var LOCAL_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
var RESERVED_LOCALS = /* @__PURE__ */ new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "arguments",
  "eval",
  "injectPrompt",
  "getPromptsInjected",
  "hasPromptsInjected",
  "print",
  "__ctx",
  "__output",
  "__append",
  "__escape",
  "__hostInject",
  "__hostGet",
  "__hostHas"
]);
function contextLocalDeclarations(context) {
  return Object.keys(context).filter((key) => LOCAL_IDENTIFIER.test(key) && !RESERVED_LOCALS.has(key)).map((key) => `var ${key} = __ctx[${JSON.stringify(key)}];`).join("\n    ");
}
function compileTemplate(template, context) {
  const parsed = segments(template);
  if (parsed === void 0) return void 0;
  const statements = parsed.map((segment) => {
    if (segment.kind === "text") return `__append(${JSON.stringify(segment.value)});`;
    if (segment.kind === "escaped") return `__append(__escape((${segment.value})));`;
    if (segment.kind === "raw") return `__append((${segment.value}));`;
    return segment.value;
  }).join("\n    ");
  const contextJson = JSON.stringify(JSON.stringify(context ?? {}));
  return `(() => {
    'use strict';
    const __ctx = JSON.parse(${contextJson});
    let __output = '';
    const __append = value => {
      if (value === undefined || value === null) return;
      __output += typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (__output.length > ${MAX_OUTPUT_CHARS}) throw new Error('__DSHT_EJS_OUTPUT_LIMIT__');
    };
    const __escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    ${contextLocalDeclarations(context ?? {})}
    const injectPrompt = (key, prompt, order = 100, sticky = 0, uid = '') => {
      __hostInject(String(key), String(prompt ?? ''), Number(order), Number(sticky), String(uid ?? ''));
    };
    // postprocess \u7ECF JSON \u5B57\u7B26\u4E32\u8FC7\u6865\uFF0C\u89C4\u907F vm realm \u6570\u7EC4\u5728\u5BBF\u4E3B\u4FA7 Array.isArray \u5931\u7075\u3002
    const getPromptsInjected = (key, postprocess = []) => __hostGet(String(key), JSON.stringify(postprocess));
    const hasPromptsInjected = key => Boolean(__hostHas(String(key)));
    const print = (...values) => { for (const value of values) __append(value); };
    globalThis.Date = undefined;
    Math.random = () => { throw new Error('__DSHT_EJS_NONDETERMINISTIC__'); };
    ${statements}
    return __output;
  })()`;
}
function clampTimeout(timeoutMs) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(n)));
}
function failureKind(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/iu.test(message)) return "execution-limit";
  if (message.includes("__DSHT_EJS_OUTPUT_LIMIT__")) return "output-limit";
  return "runtime-error";
}
function parsePostprocess(raw) {
  if (typeof raw !== "string") return void 0;
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function renderEjsSandbox(template, context, options = {}) {
  if (template.length > MAX_TEMPLATE_CHARS) return { ok: false, kind: "source-limit" };
  const code = compileTemplate(template, context);
  if (code === void 0) return { ok: false, kind: "syntax-error" };
  const store = options.injections ?? createPromptInjectionStore();
  const sandboxGlobal = {
    __hostInject: (key, prompt, order, sticky, uid) => {
      store.inject(key, prompt, order, sticky, uid);
    },
    __hostGet: (key, postprocess) => store.get(key, parsePostprocess(postprocess)),
    __hostHas: (key) => store.has(key)
  };
  let script;
  try {
    script = new Script(code, { filename: "dsht-ejs-template.js" });
  } catch {
    return { ok: false, kind: "syntax-error" };
  }
  const isolated = createContext(sandboxGlobal, { name: "dsht-ejs" });
  try {
    const value = script.runInContext(isolated, { timeout: clampTimeout(options.timeoutMs) });
    return typeof value === "string" ? { ok: true, text: value } : { ok: false, kind: "runtime-error" };
  } catch (error) {
    return { ok: false, kind: failureKind(error) };
  }
}
function renderMessagesSandbox(template, context, messages, options = {}) {
  const store = options.injections ?? createPromptInjectionStore();
  let rendered = 0;
  let skipped = 0;
  const out = [];
  for (const msg of messages) {
    if (isEjsProcessed(msg)) {
      skipped++;
      out.push(msg);
      continue;
    }
    const mes = String(msg.mes ?? "");
    const r = renderEjsSandbox(template || mes, { ...context, message: msg }, { ...options, injections: store });
    if (!r.ok) return r;
    rendered++;
    out.push({ ...msg, mes: r.text, is_ejs_processed: true });
  }
  return { ok: true, messages: out, rendered, skipped };
}

// src/dsht-plugin-shared/http.ts
import { homedir } from "node:os";
import { resolve, join } from "node:path";
function resolveDshHome() {
  const envHome = process.env.DSH_HOME?.trim();
  return envHome ? resolve(envHome) : join(homedir(), ".dsh");
}
function isTrusted(req, webServer) {
  const host = String(req.headers.host ?? "").toLowerCase();
  const hostname = host.replace(/:\d+$/, "").replace(/^\[/, "").replace(/\]$/, "");
  const lanMode = webServer?.host === "0.0.0.0";
  if (!lanMode && !["127.0.0.1", "localhost", "::1"].includes(hostname)) return false;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "null" && !origin.endsWith(host)) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return true;
}
function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function subPath(url, prefix) {
  const p = (url ?? "").split("?")[0];
  return decodeURIComponent(p.replace(new RegExp(`^${prefix}`), "")) || "/";
}
function registerPrefix(ctx, prefix, logTag, handler) {
  if (!ctx.webServer) return;
  const webServer = ctx.webServer;
  const dispose = webServer.register({
    kind: "prefix",
    path: prefix,
    handler: (rawReq, rawRes) => {
      void (async () => {
        const req = rawReq;
        const res = rawRes;
        if (!isTrusted(req, webServer)) return sendJson(res, 403, { error: "forbidden" });
        try {
          await handler(subPath(req.url, prefix), req, res);
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      })();
    }
  });
  console.log(`[${logTag}] data plane on webServer route ${prefix}/*`);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      dispose();
    });
  }
}

// node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.3/node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b) return true;
  if (!strict && isNullable(a) && isNullable(b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (!a || !b) return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength) return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
    return true;
  }) ?? Object.keys({
    ...a,
    ...b
  }).every((key) => deepEqual(a[key], b[key], strict));
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/.pnpm/@deepseek-ai+schemastery@3.18.2/node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
var resolvers = {};
Schema.extend = function extend(type, resolve3) {
  resolvers[type] = resolve3;
};
Schema.resolve = function resolve2(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/dsht-plugin-shared/settings-ns.ts
function registerSettingsNamespace(ctx, ns, logTag) {
  const settings = ctx.settings;
  if (!settings || typeof settings.register !== "function") return;
  try {
    settings.register(ns, Schema.object({}), { base: {} });
    console.log(`[${logTag}] settings namespace registered: ${ns}`);
  } catch (e) {
    console.warn(`[${logTag}] settings namespace ${ns} \u6CE8\u518C\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u63D2\u4EF6\u672C\u4F53\uFF09\uFF1A${e.message}`);
  }
}

// src/dsht-plugin-prompt-template/index.ts
var name = "dsht-plugin-prompt-template";
var inject = ["webServer", "settings", "sessions"];
var workerPath = (() => {
  try {
    return join2(dirname(fileURLToPath(import.meta.url)), "ejs-worker.js");
  } catch {
    return null;
  }
})();
function renderViaWorker(payload) {
  if (!workerPath) return Promise.resolve(null);
  return new Promise((resolve3) => {
    let settled = false;
    let w;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        w?.terminate();
      } catch {
      }
      resolve3(v);
    };
    try {
      w = new Worker(workerPath, { workerData: payload });
      const timer = setTimeout(() => done(null), 6e3);
      timer.unref?.();
      w.on("message", (v) => {
        clearTimeout(timer);
        done(v);
      });
      w.on("error", () => {
        clearTimeout(timer);
        done(null);
      });
      w.on("exit", () => {
        clearTimeout(timer);
        done(null);
      });
    } catch {
      done(null);
    }
  });
}
function apply(ctx, _config) {
  const dshHome = resolveDshHome();
  registerSettingsNamespace(ctx, "dsht-plugin-prompt-template", "dsht-ejs");
  registerPrefix(ctx, "/dsht-prompt-template", "dsht-ejs", async (sub, req, res) => {
    if (sub === "/settings") {
      const method = req.method ?? "GET";
      const p = join2(dshHome, "rp", "ejs-settings.json");
      const defaults = {
        enabled: true,
        // 扩展总开关（= 旧 renderEnabled，兼容读取）
        generateEnabled: true,
        // 生成处理（生成期模板求值）
        generateLoaderEnabled: false,
        // [GENERATE] 世界书条目注入（ST 默认关）
        injectLoaderEnabled: false,
        // @INJECT 世界书条目注入（ST 默认关）
        renderEnabled: true,
        // 楼层消息处理
        renderLoaderEnabled: false,
        // [RENDER] 世界书条目注入（状态栏渲染，ST 默认关）
        codeBlocks: false,
        // 处理 <pre> 代码块
        permanentEvaluation: false,
        // 处理原始消息内容
        filterChatMessage: false,
        // 生成时忽略楼层模板语句
        chatDepth: -1,
        // 楼层处理最大深度（-1 无限制）
        autosaveEnabled: false,
        // 自动保存（DSH 自动落盘，项保留标注）
        preloadWorldinfo: false,
        // 预载世界书（当前无对应管线）
        withContextDisabled: false,
        // 禁用 with 语句块（EJS 编译选项——subset 引擎恒定，sandbox 消费）
        debugEnabled: false,
        // 控制台详细日志
        invertEnabled: false,
        // 旧特性兼容（无管线——存而标注）
        compileWorkers: false,
        // Web Worker 编译（浏览器端编译特性——标注）
        sandbox: false,
        // 环境隔离（= 缺省用 vm 沙箱引擎渲染）
        codeEditor: false,
        // 世界书代码编辑器（编辑器 UI 特性——标注）
        cacheEnabled: 0,
        // 缓存 0 禁用 / 1 启用 / 2 仅世界书
        cacheSize: 0,
        // 缓存大小上限（0 不限）
        cacheHasher: "h32ToString"
        // 缓存 hash（h32|h64）
      };
      const loadMerged = async () => {
        const stored = await readFile(p, "utf8").then((t) => JSON.parse(t)).catch(() => ({}));
        const out = { ...defaults };
        for (const k of Object.keys(defaults)) {
          const s = stored[k];
          if (s === void 0) continue;
          if (k === "enabled" && stored.enabled === void 0 && stored.renderEnabled !== void 0) {
            out.enabled = stored.renderEnabled !== false;
            continue;
          }
          out[k] = s;
        }
        return out;
      };
      if (method === "GET") return sendJson(res, 200, await loadMerged());
      if (method === "PUT" || method === "POST") {
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object") return sendJson(res, 400, { error: "bad json" });
        const merged = await loadMerged();
        for (const k of Object.keys(defaults)) {
          if (!(k in body)) continue;
          const v = body[k];
          const d = defaults[k];
          if (typeof d === "boolean" && typeof v === "boolean") merged[k] = v;
          else if (typeof d === "number" && typeof v === "number" && Number.isFinite(v)) merged[k] = v;
          else if (typeof d === "string" && typeof v === "string") merged[k] = v;
        }
        if (merged.chatDepth !== void 0) {
          const cd = merged.chatDepth;
          merged.chatDepth = Math.max(-1, Math.min(100, Math.round(cd)));
        }
        if (merged.cacheEnabled !== 0 && merged.cacheEnabled !== 1 && merged.cacheEnabled !== 2) merged.cacheEnabled = 0;
        if (merged.cacheHasher !== "h32ToString" && merged.cacheHasher !== "h64ToString") merged.cacheHasher = "h32ToString";
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, JSON.stringify(merged, null, 1), "utf8");
        console.log(`[dsht-ejs] settings: enabled=${merged.enabled} generateEnabled=${merged.generateEnabled} renderEnabled=${merged.renderEnabled} chatDepth=${merged.chatDepth}`);
        return sendJson(res, 200, { ok: true, settings: merged });
      }
      return sendJson(res, 405, { error: "GET/PUT only" });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
    if (sub === "/render") {
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: "bad json" });
      const cfg = await readFile(join2(dshHome, "rp", "ejs-settings.json"), "utf8").then((t) => JSON.parse(t)).catch(() => ({}));
      const flag = (k, dflt = true) => cfg[k] === void 0 ? dflt : cfg[k] === true;
      const depthLimit = typeof cfg.chatDepth === "number" ? cfg.chatDepth : -1;
      if (!flag("enabled")) {
        if (Array.isArray(body.messages)) return sendJson(res, 200, { messages: body.messages, rendered: 0, skipped: body.messages.length });
        return sendJson(res, 200, { result: String(body.template ?? "") });
      }
      const phase = body.phase === "generate" ? "generate" : "render";
      if (phase === "generate" && !flag("generateEnabled")) {
        if (Array.isArray(body.messages)) return sendJson(res, 200, { messages: body.messages, rendered: 0, skipped: body.messages.length });
        return sendJson(res, 200, { result: String(body.template ?? "") });
      }
      if (phase === "render" && !flag("renderEnabled")) {
        if (Array.isArray(body.messages)) return sendJson(res, 200, { messages: body.messages, rendered: 0, skipped: body.messages.length });
        return sendJson(res, 200, { result: String(body.template ?? "") });
      }
      const template = String(body.template ?? "");
      const context = body.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context : {};
      const engine = body.engine === "sandbox" ? "sandbox" : body.engine === "subset" ? "subset" : cfg.sandbox === true ? "sandbox" : "subset";
      configureEjsCache({
        enabled: typeof cfg.cacheEnabled === "number" ? cfg.cacheEnabled : 0,
        size: typeof cfg.cacheSize === "number" ? cfg.cacheSize : 0,
        hasher: cfg.cacheHasher === "h64ToString" ? "h64ToString" : "h32ToString"
      });
      const protectPre = cfg.codeBlocks !== true;
      const dbg = flag("debugEnabled", false);
      const wantWorker = cfg.compileWorkers === true && workerPath !== null;
      try {
        if (Array.isArray(body.messages)) {
          const all = body.messages;
          const eligibleIdx = [];
          all.forEach((m, i) => {
            const depth = all.length - 1 - i;
            if (depthLimit < 0 || depth < depthLimit) eligibleIdx.push(i);
          });
          const filtered = eligibleIdx.map((i) => all[i]);
          if (dbg) console.log(`[dsht-ejs] render messages: depthLimit=${depthLimit} in=${all.length} eligible=${filtered.length}`);
          let r = null;
          if (wantWorker) {
            r = await renderViaWorker({
              kind: "messages",
              engine,
              template,
              context,
              messages: filtered,
              protectPre
            });
          }
          if (!r) {
            if (engine === "sandbox") {
              const preList = protectPre ? filtered.map((m) => protectPreBlocks(String(m.mes ?? ""))) : [];
              const rs = renderMessagesSandbox(template, context, preList.length > 0 ? filtered.map((m, i) => ({ ...m, mes: preList[i].text })) : filtered);
              if (rs.ok && preList.length > 0) {
                rs.messages = rs.messages.map((m, i) => ({ ...m, mes: restorePreBlocks(String(m.mes ?? ""), preList[i]?.blocks ?? []) }));
              }
              r = rs;
            } else {
              r = { ok: true, ...renderMessages(template, context, filtered, { protectPre }) };
            }
          }
          if (!r.ok) return sendJson(res, 400, { error: `[dsht-ejs] ${r.kind}` });
          const outMsgs = [...all];
          eligibleIdx.forEach((origIdx, k) => {
            outMsgs[origIdx] = r.messages[k];
          });
          if (dbg) console.log(`[dsht-ejs] render messages (${engine}${wantWorker ? "+worker" : ""}): rendered=${r.rendered} skipped=${r.skipped}`);
          return sendJson(res, 200, { messages: outMsgs, rendered: r.rendered, skipped: r.skipped + (all.length - eligibleIdx.length) });
        }
        if (!template.trim()) return sendJson(res, 400, { error: "template required" });
        if (wantWorker) {
          const wr = await renderViaWorker({
            kind: "single",
            engine,
            template,
            context,
            protectPre
          });
          if (wr) {
            if (!wr.ok) return sendJson(res, 400, { error: `[dsht-ejs] ${wr.kind}` });
            if (dbg) console.log(`[dsht-ejs] render (sandbox, worker, ${phase}): ${template.length}ch \u2192 ${wr.text.length}ch`);
            return sendJson(res, 200, { result: wr.text });
          }
        }
        if (engine === "sandbox") {
          const r = renderEjsSandbox(template, context);
          if (!r.ok) return sendJson(res, 400, { error: `[dsht-ejs] ${r.kind}` });
          if (dbg) console.log(`[dsht-ejs] render (sandbox, ${phase}): ${template.length}ch \u2192 ${r.text.length}ch`);
          return sendJson(res, 200, { result: r.text });
        }
        const rendered0 = renderEjsSubset(template, context);
        const result = restorePreBlocks(renderEjsSubset(protectPre ? protectPreBlocks(template).text : template, context), protectPre ? protectPreBlocks(template).blocks : []);
        void rendered0;
        if (dbg) console.log(`[dsht-ejs] render (${phase}): ${template.length}ch \u2192 ${result.length}ch`);
        return sendJson(res, 200, { result });
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    if (sub === "/check") {
      const body = await readJsonBody(req);
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      return sendJson(res, 200, { processed: messages.map(isEjsProcessed) });
    }
    if (sub === "/permanent") {
      const body = await readJsonBody(req);
      const sessionId = String(body?.sessionId ?? "");
      const seq = Number(body?.seq ?? -1);
      const text = String(body?.text ?? "");
      if (!sessionId || !Number.isInteger(seq) || seq < 0 || !text.trim()) {
        return sendJson(res, 400, { error: "sessionId/seq/text required" });
      }
      const sessions = ctx.sessions;
      const session = sessions?.get?.(sessionId);
      if (!session) return sendJson(res, 409, { error: "session not live\uFF08B8 \u6C38\u4E45\u5199\u56DE\u4EC5\u652F\u6301\u5DF2\u6253\u5F00\u7684\u4F1A\u8BDD\uFF09" });
      const sAt = session.eventAt;
      const ev = typeof sAt === "function" ? sAt.call(session, seq) : void 0;
      if (!ev || ev.type !== "assistant/message") return sendJson(res, 400, { error: `seq=${seq} \u4E0D\u662F assistant/message` });
      const msg = ev.data?.message;
      if (!msg) return sendJson(res, 400, { error: "\u4E8B\u4EF6\u7F3A message \u5B57\u6BB5" });
      if (msg.source?.ejsProcessed === true) {
        return sendJson(res, 200, { ok: true, note: "\u5DF2\u5904\u7406\uFF08\u5E42\u7B49\u8DF3\u8FC7\uFF09" });
      }
      const append = session.append;
      if (typeof append !== "function") return sendJson(res, 500, { error: "session.append \u4E0D\u53EF\u7528" });
      append.call(session, "assistant/message", {
        ...ev.data,
        message: {
          ...msg,
          content: [{ type: "text", text }],
          // 【2026-09-07 损坏根修】必须保留原 source.kind（加载器强校验 assistant
          // 消息 source.kind ∈ {gateway, internal}——写 'plugin' 会让整个会话
          // "failed validation: message must have model source" 拒载（真机实证，
          // 用户迁移会话差点报废）。只在原 source 上追加插件标记。
          source: { ...msg.source ?? {}, plugin: "dsht-ejs", ejsProcessed: true }
        }
        // 【2026-09-07 500 根修】surfaceOp replace 的血缘 seqs 必须覆盖全部被 shadow
        // 的 surface 节点——session.append 的 surface 元数据键名是 sourceEventSeqs
        // （dsh-session append: opts[0].sourceEventSeqs → 事件字段）。缺失会被
        // assertProvenance 拒绝（"missing <seq>" 500，真机 B8 写回全数失败）。
      }, { surfaceOp: { op: "replace", start: seq, end: seq }, sourceEventSeqs: [seq] });
      try {
        if (typeof sessions?.flush === "function") await sessions.flush.call(sessions, session);
      } catch (e) {
        return sendJson(res, 500, { error: `\u5199\u56DE\u6210\u529F\u4F46 flush \u5931\u8D25\uFF1A${e.message}` });
      }
      console.log(`[dsht-ejs] permanent: session=${sessionId} seq=${seq} \u2192 ${text.length}ch \u5DF2\u5199\u56DE`);
      return sendJson(res, 200, { ok: true });
    }
    if (sub === "/render-entries") {
      const url = new URL(req.url ?? "/", "http://localhost");
      const slug = String(url.searchParams.get("slug") ?? "");
      const sessionId = String(url.searchParams.get("sessionId") ?? "");
      if (!slug) return sendJson(res, 400, { error: "slug required" });
      const cfg = await readFile(join2(dshHome, "rp", "ejs-settings.json"), "utf8").then((t) => JSON.parse(t)).catch(() => ({}));
      if (cfg.enabled === false || cfg.renderLoaderEnabled !== true) {
        return sendJson(res, 200, { before: "", after: "", note: "renderLoader \u672A\u542F\u7528" });
      }
      const rp = await readFile(join2(dshHome, "rp", slug, "rp.json"), "utf8").then((t) => JSON.parse(t)).catch(() => null);
      if (!rp) return sendJson(res, 404, { error: `rp.json not found: ${slug}` });
      const entries = [];
      for (const b of rp.books ?? []) {
        if (!b?.lorePath) continue;
        const book = await readFile(join2(dshHome, b.lorePath), "utf8").then((t) => JSON.parse(t)).catch(() => null);
        if (book && Array.isArray(book.entries)) entries.push(...book.entries);
      }
      const act = (e) => {
        if (cfg.invertEnabled === true) return true;
        return e.disable !== true;
      };
      const targets = entries.filter((e) => /\[\s*RENDER/i.test(e.content) && act(e));
      const vars = sessionId ? await readFile(join2(dshHome, "rp", "state", `${sessionId}.json`), "utf8").then((t) => JSON.parse(t)).catch(() => ({})) : {};
      const context = {
        user: rp.macros?.user || "\u7528\u6237",
        char: rp.macros?.char || rp.characterName || "\u89D2\u8272",
        variables: vars.variables ?? {},
        state: vars.state ?? {}
      };
      const evalOne = (content) => {
        const stripped = content.replace(/\[\s*RENDER\s*[:：]?[^\]]*\]/gi, "").trim();
        if (cfg.sandbox === true) {
          const r = renderEjsSandbox(stripped, context);
          return r.ok ? r.text : "";
        }
        return renderEjsSubset(stripped, context);
      };
      const parts = { before: [], after: [] };
      for (const e of targets) {
        const isAfter = /\[\s*RENDER\s*[:：]\s*AFTER\s*\]/i.test(e.content);
        parts[isAfter ? "after" : "before"].push(evalOne(e.content));
      }
      return sendJson(res, 200, { before: parts.before.filter(Boolean).join("\n"), after: parts.after.filter(Boolean).join("\n") });
    }
    return sendJson(res, 404, { error: "unknown endpoint" });
  });
}
export {
  apply,
  inject,
  name
};
