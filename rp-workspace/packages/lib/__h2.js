// src/dsht-plugin-tavern-helper/index.ts
import { mkdir as mkdir4, readFile as readFile5, readdir as readdir4, writeFile as writeFile4 } from "node:fs/promises";
import { dirname as dirname4, join as join7 } from "node:path";

// src/dsht-plugin-tavern-helper/variables.ts
function decodeSeg(seg) {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}
function parsePath(path) {
  return path.split("/").filter((s) => s.length > 0).map(decodeSeg);
}
function getByPath(tree, path) {
  let cur = tree;
  for (const seg of parsePath(path)) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function setByPath(tree, path, value) {
  const segs = parsePath(path);
  const next = structuredClone(tree);
  if (segs.length === 0) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : next;
  }
  let cur = next;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const existing = cur[seg];
    if (existing === void 0 || existing === null || typeof existing !== "object") cur[seg] = {};
    cur = cur[seg];
  }
  cur[segs[segs.length - 1]] = value;
  return next;
}
function deleteByPath(tree, path) {
  const segs = parsePath(path);
  if (segs.length === 0) return {};
  const next = structuredClone(tree);
  let cur = next;
  for (let i = 0; i < segs.length - 1; i++) {
    const existing = cur[segs[i]];
    if (existing === null || typeof existing !== "object") return next;
    cur = existing;
  }
  delete cur[segs[segs.length - 1]];
  return next;
}
function deepMergeVars(low, high) {
  const out = { ...low };
  for (const [k, v] of Object.entries(high)) {
    const prev = out[k];
    if (prev !== null && v !== null && typeof prev === "object" && typeof v === "object" && !Array.isArray(prev) && !Array.isArray(v)) {
      out[k] = deepMergeVars(prev, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function mergeScopes(global, character, chat) {
  return deepMergeVars(deepMergeVars(global, character), chat);
}
function mergeAllScopes(scopes) {
  return deepMergeVars(
    deepMergeVars(
      deepMergeVars(deepMergeVars(scopes.global ?? {}, scopes.preset ?? {}), scopes.character ?? {}),
      scopes.chat ?? {}
    ),
    scopes.message ?? {}
  );
}

// src/dsht-plugin-tavern-helper/scripts.ts
var ACTION_TYPES = /* @__PURE__ */ new Set(["set-variable", "delete-variable", "insert-note", "log"]);
var SCOPES = ["global", "preset", "character", "chat", "message", "script"];
function validateScript(raw) {
  if (!raw || typeof raw !== "object") return "script must be object";
  const s = raw;
  if (typeof s.id !== "string" || !s.id.trim()) return "script.id required";
  const trigger = s.trigger;
  if (!trigger || typeof trigger !== "object") return "script.trigger required";
  if (!["manual", "on-variable-change", "on-turn"].includes(String(trigger.type))) return `unknown trigger.type: ${String(trigger.type)}`;
  if (trigger.type === "on-variable-change" && typeof trigger.variable !== "string") return "on-variable-change requires trigger.variable";
  if (!Array.isArray(s.actions)) return "script.actions must be array";
  for (const a of s.actions) {
    if (!a || typeof a !== "object") return "action must be object";
    if (!ACTION_TYPES.has(String(a.type))) return `unknown action.type: ${String(a.type)}`;
    if (a.type === "set-variable" || a.type === "delete-variable") {
      if (!SCOPES.includes(a.scope)) return `action.scope must be one of ${SCOPES.join("/")}`;
      if (typeof a.path !== "string" || !a.path) return "action.path required";
    }
    if ((a.type === "insert-note" || a.type === "log") && typeof (a.text ?? a.message) !== "string") {
      return `action.${a.type === "insert-note" ? "text" : "message"} required`;
    }
  }
  return null;
}
function interpolateValue(value, merged) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, p) => {
    const v = getByPath(merged, String(p).startsWith("/") ? String(p) : `/${String(p).replaceAll(".", "/")}`);
    return v === void 0 ? m : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}
function runScript(script, trees) {
  const next = {
    global: structuredClone(trees.global),
    character: structuredClone(trees.character),
    chat: structuredClone(trees.chat),
    preset: structuredClone(trees.preset ?? {}),
    message: structuredClone(trees.message ?? {}),
    script: structuredClone(trees.script ?? {})
  };
  const notes = [];
  const logs = [];
  const mergedView = () => deepMergeVars(
    mergeAllScopes({
      global: next.global,
      preset: next.preset,
      character: next.character,
      chat: next.chat,
      message: next.message
    }),
    next.script
  );
  for (const action of script.actions) {
    switch (action.type) {
      case "set-variable":
        next[action.scope] = setByPath(next[action.scope], action.path, interpolateValue(action.value, mergedView()));
        break;
      case "delete-variable":
        next[action.scope] = deleteByPath(next[action.scope], action.path);
        break;
      case "insert-note":
        notes.push({ text: String(interpolateValue(action.text, mergedView())), depth: action.depth ?? 1 });
        break;
      case "log":
        logs.push(String(interpolateValue(action.message, mergedView())));
        break;
    }
  }
  return { ok: true, trees: next, notes, logs };
}

// src/dsht-plugin-tavern-helper/session-store.ts
var TAVERN_SCOPES = ["global", "preset", "character", "chat", "message", "script"];
var SNAPSHOT_KEY = "tavern";
function emptySnapshot() {
  return { format: 0, revision: 0, scopes: { preset: {}, message: {} }, scripts: {} };
}
function isTree(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decodeSnapshot(raw) {
  if (!isTree(raw)) return void 0;
  if (raw.format !== 0) return void 0;
  const revision = raw.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return void 0;
  const scopes = raw.scopes;
  if (!isTree(scopes) || !isTree(scopes.preset) || !isTree(scopes.message)) return void 0;
  const scripts = raw.scripts;
  if (!isTree(scripts)) return void 0;
  const parsedScripts = {};
  for (const [id, tree] of Object.entries(scripts)) {
    if (!isTree(tree)) return void 0;
    parsedScripts[id] = tree;
  }
  let lastMutation;
  if (raw.lastMutation !== void 0) {
    const m = raw.lastMutation;
    if (!isTree(m)) return void 0;
    if (m.scope !== "preset" && m.scope !== "message" && m.scope !== "script") return void 0;
    if (typeof m.ts !== "number" || !Number.isFinite(m.ts)) return void 0;
    if (m.scriptId !== void 0 && typeof m.scriptId !== "string") return void 0;
    lastMutation = {
      scope: m.scope,
      ...m.scriptId === void 0 ? {} : { scriptId: m.scriptId },
      ts: m.ts
    };
  }
  return {
    format: 0,
    revision,
    scopes: {
      preset: structuredClone(scopes.preset),
      message: structuredClone(scopes.message)
    },
    scripts: structuredClone(parsedScripts),
    ...lastMutation === void 0 ? {} : { lastMutation }
  };
}
function readSnapshotFromStateFile(file) {
  if (file === null) return void 0;
  return decodeSnapshot(file[SNAPSHOT_KEY]);
}
function writeSnapshotIntoStateFile(file, snapshot) {
  return { ...file, [SNAPSHOT_KEY]: snapshot };
}
function applySnapshotMutation(snapshot, mutation) {
  const ts = mutation.ts ?? Date.now();
  const tree = structuredClone(mutation.tree);
  if (mutation.scope === "script") {
    return {
      ...snapshot,
      revision: snapshot.revision + 1,
      scripts: { ...snapshot.scripts, [mutation.scriptId]: tree },
      lastMutation: { scope: "script", scriptId: mutation.scriptId, ts }
    };
  }
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    scopes: { ...snapshot.scopes, [mutation.scope]: tree },
    lastMutation: { scope: mutation.scope, ts }
  };
}
var TavernSessionStore = class {
  #io;
  #cache = /* @__PURE__ */ new Map();
  constructor(io) {
    this.#io = io;
  }
  async get(sessionId) {
    const cached = this.#cache.get(sessionId);
    if (cached !== void 0) return cached;
    const file = await this.#io.readStateFile(sessionId);
    const snapshot = readSnapshotFromStateFile(file) ?? emptySnapshot();
    this.#cache.set(sessionId, snapshot);
    return snapshot;
  }
  async mutate(sessionId, mutation) {
    const current = await this.get(sessionId);
    const next = applySnapshotMutation(current, mutation);
    this.#cache.set(sessionId, next);
    const file = await this.#io.readStateFile(sessionId) ?? {};
    await this.#io.writeStateFile(sessionId, writeSnapshotIntoStateFile(file, next));
    return next;
  }
  /** 失效内存缓存（外部改动 state 文件后由调用方触发） */
  invalidate(sessionId) {
    this.#cache.delete(sessionId);
  }
};

// src/dsht-plugin-tavern-helper/facade.ts
import { createReadStream } from "node:fs";
import { mkdir as mkdir3, readFile as readFile3, readdir as readdir3, rm as rm3, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname3, join as join4, relative, resolve } from "node:path";
import { createInterface } from "node:readline";

// src/preset/schema.ts
var DEFAULT_BUDGET = {
  maxToolRounds: 2,
  maxCallsPerRun: 8,
  delegationMaxPerRun: 8,
  delegationResultBudgetTokens: 8e3,
  modelRetry: { maxRetries: 3, intervalMs: 3e3 }
};
function emptyPreset(id, displayName) {
  return {
    schemaVersion: 1,
    id,
    displayName,
    model: {},
    path: "direct",
    toggles: [],
    slots: [
      { id: "main", type: "system", content: "", enabled: true },
      { id: "worldBefore", type: "marker", enabled: true },
      { id: "charDesc", type: "marker", enabled: true },
      { id: "charPersonality", type: "marker", enabled: true },
      { id: "scenario", type: "marker", enabled: true },
      { id: "persona", type: "marker", enabled: true },
      { id: "stateSummary", type: "state", enabled: true },
      { id: "configSummary", type: "configSummary", enabled: true },
      { id: "chatHistory", type: "marker", enabled: true },
      { id: "worldAfter", type: "marker", enabled: true },
      { id: "jb", type: "system", content: "", enabled: true, depth: 2 }
    ],
    knowledge: { books: [], scanDepth: 2, budgetPercent: 25 },
    budget: { ...DEFAULT_BUDGET },
    sampling: { temperature: 1, topP: 0.95 }
  };
}

// src/preset/demo.ts
function demoDirectPreset() {
  const p = emptyPreset("rp-demo-direct", "\u793A\u8303 \xB7 \u76F4\u7B54\u578B");
  p.description = "\u5355\u6B21\u8C03\u7528\u76F4\u51FA\uFF0Ctoken = ST oneshot\u3002\u9002\u5408\u65E5\u5E38\u5267\u60C5\u63A8\u8FDB\u3002";
  p.path = "direct";
  p.toggles = [
    {
      group: "writingStyle",
      label: "\u6587\u98CE",
      options: [
        { id: "realistic", label: "\u771F\u5B9E\u611F", content: "\u6587\u98CE\uFF1A\u5199\u5B9E\u7EC6\u817B\uFF0C\u4E94\u611F\u63CF\u5199\u5145\u5206\uFF0C\u60C5\u7EEA\u514B\u5236\u800C\u6709\u5F20\u529B\u3002", selected: true },
        { id: "lightnovel", label: "\u8F7B\u5C0F\u8BF4", content: "\u6587\u98CE\uFF1A\u8F7B\u5FEB\u660E\u4EAE\u7684\u8F7B\u5C0F\u8BF4\u7B14\u8C03\uFF0C\u591A\u7528\u77ED\u53E5\u4E0E\u5FC3\u7406\u72EC\u767D\u3002" },
        { id: "cinematic", label: "\u7535\u5F71\u611F", content: "\u6587\u98CE\uFF1A\u955C\u5934\u5316\u53D9\u4E8B\uFF0C\u4EE5\u753B\u9762\u4E0E\u52A8\u4F5C\u63A8\u8FDB\uFF0C\u5C11\u76F4\u63A5\u5FC3\u7406\u63CF\u5199\u3002" }
      ]
    },
    {
      group: "replyLength",
      label: "\u56DE\u590D\u957F\u5EA6",
      options: [
        { id: "short", label: "\u77ED", content: "\u56DE\u590D\u957F\u5EA6\uFF1A\u6BCF\u8F6E 2-3 \u6BB5\u4EE5\u5185\uFF0C\u5FEB\u8282\u594F\u63A8\u8FDB\u3002" },
        { id: "medium", label: "\u4E2D", content: "\u56DE\u590D\u957F\u5EA6\uFF1A\u6BCF\u8F6E 3-5 \u6BB5\uFF0C\u53D9\u4E8B\u4E0E\u5BF9\u767D\u5747\u8861\u3002", selected: true },
        { id: "long", label: "\u957F", content: "\u56DE\u590D\u957F\u5EA6\uFF1A\u6BCF\u8F6E 5 \u6BB5\u4EE5\u4E0A\uFF0C\u5145\u5206\u94FA\u9648\u573A\u666F\u4E0E\u5FC3\u7406\u3002" }
      ]
    }
  ];
  const main = p.slots.find((s) => s.id === "main");
  if (main) main.content = "\u4F60\u662F\u5267\u60C5\u7684\u5171\u540C\u53D9\u8FF0\u8005\uFF1A\u626E\u6F14\u5168\u90E8 NPC \u4E0E\u4E16\u754C\uFF0C\u7EDD\u4E0D\u66FF\u7528\u6237\u626E\u6F14\u7684\u4E3B\u89D2\u505A\u51B3\u5B9A\u6216\u4EE3\u8A00\u5176\u5FC3\u7406\u3002";
  const jb = p.slots.find((s) => s.id === "jb");
  if (jb) jb.content = "\u8BB0\u4F4F\uFF1A\u4E0D\u8981\u603B\u7ED3\u5267\u60C5\uFF0C\u4E0D\u8981\u8DF3\u51FA\u89D2\u8272\uFF0C\u4E0D\u8981\u590D\u8FF0\u7528\u6237\u7684\u8BDD\u3002";
  return p;
}
function demoLightAgentPreset() {
  const p = demoDirectPreset();
  p.id = "rp-demo-light-agent";
  p.displayName = "\u793A\u8303 \xB7 \u8F7B agent \u578B";
  p.description = "\u76F4\u7B54 + \u6A21\u578B\u6309\u9700\u8C03\u7528 lore_query \u6DF1\u67E5\u4E16\u754C\u4E66\uFF08\u8F6F\u9884\u7B97 2 \u8F6E\u5C01\u9876\uFF09\u3002\u9002\u5408\u8BBE\u5B9A\u8F83\u91CD\u7684\u4E16\u754C\u89C2\u3002";
  p.path = "lightAgent";
  p.budget = {
    maxToolRounds: 2,
    maxCallsPerRun: 4,
    delegationMaxPerRun: 0,
    delegationResultBudgetTokens: 0,
    modelRetry: { maxRetries: 2, intervalMs: 3e3 }
  };
  const main = p.slots.find((s) => s.id === "main");
  if (main) {
    main.content = "\u4F60\u662F\u5267\u60C5\u7684\u5171\u540C\u53D9\u8FF0\u8005\uFF1A\u626E\u6F14\u5168\u90E8 NPC \u4E0E\u4E16\u754C\uFF0C\u7EDD\u4E0D\u66FF\u7528\u6237\u626E\u6F14\u7684\u4E3B\u89D2\u505A\u51B3\u5B9A\u6216\u4EE3\u8A00\u5176\u5FC3\u7406\u3002\n\u8BBE\u5B9A\u5BC6\u96C6\u7684\u4E16\u754C\u89C2\u5728\u4E0A\u4E0B\u6587\u7F3A\u5931\u65F6\uFF0C\u5148\u7528 lore_query \u5DE5\u5177\u67E5\u8BE2\u4E16\u754C\u4E66\uFF0C\u518D\u4F5C\u7B54\u2014\u2014\u4E0D\u8981\u51ED\u7A7A\u7F16\u9020\u8BBE\u5B9A\u3002";
  }
  return p;
}

// src/lore/entry.ts
var WI_POSITION = {
  BEFORE: 0,
  AFTER: 1,
  AN_TOP: 2,
  AN_BOTTOM: 3,
  AT_DEPTH: 4,
  EM_TOP: 5,
  EM_BOTTOM: 6,
  OUTLET: 7
};

// src/dsht-plugin-shared/session-surgery.ts
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
async function readFirstLine(path) {
  let handle = null;
  try {
    handle = await open(path, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, 8192, 0);
    if (bytesRead === 0) return null;
    const chunk = buf.subarray(0, bytesRead).toString("utf8");
    const nl = chunk.indexOf("\n");
    return nl === -1 ? chunk : chunk.slice(0, nl);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {
    });
  }
}
async function scanSessionHeaders(dshHome) {
  const root = join(dshHome, "sessions");
  const out = [];
  let projects = [];
  try {
    projects = await readdir(root);
  } catch {
    return out;
  }
  for (const project of projects) {
    let sdirs = [];
    try {
      sdirs = await readdir(join(root, project));
    } catch {
      continue;
    }
    for (const sdir of sdirs) {
      const firstLine = await readFirstLine(join(root, project, sdir, "session.jsonl"));
      if (firstLine === null) continue;
      try {
        const header = JSON.parse(firstLine);
        if (header?.type !== "session" || typeof header.id !== "string") continue;
        out.push({
          sessionId: header.id,
          cwd: typeof header.cwd === "string" ? header.cwd : void 0,
          project,
          sdir,
          firstLine
        });
      } catch {
      }
    }
  }
  return out;
}

// src/dsht-plugin-shared/file-snapshots.ts
import { mkdir, open as open2, readFile, readdir as readdir2, rm, writeFile } from "node:fs/promises";
import { dirname, join as join2 } from "node:path";
function snapshotDir(dshHome, sessionId) {
  return join2(dshHome, "rp", "file-history", sessionId);
}
function isSnapshotEligible(relPath) {
  const p = relPath.replaceAll("\\", "/");
  if (!p || p.includes("..") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  if (p === "skills" || p.startsWith("skills/")) return false;
  const base = p.split("/").pop() ?? "";
  if (base === "card.json" || base === "avatar.png") return false;
  return true;
}
async function readLatestTurn(sessionJsonlPath) {
  let handle = null;
  try {
    handle = await open2(sessionJsonlPath, "r");
    const { size } = await handle.stat();
    if (size === 0) return null;
    const tail = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(tail);
    await handle.read(buf, 0, tail, size - tail);
    const lines = buf.toString("utf8").split("\n");
    let latest = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || !line.includes('"turn"')) continue;
      try {
        const ev = JSON.parse(line);
        const t = ev?.data?.turn;
        if (typeof t === "number" && Number.isInteger(t)) latest = Math.max(latest ?? t, t);
      } catch {
      }
    }
    return latest;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {
    });
  }
}
async function resolveSessionTurnAnchor(dshHome, sessionId) {
  const hit = (await scanSessionHeaders(dshHome)).find((h) => h.sessionId === sessionId);
  if (!hit) return null;
  return readLatestTurn(join2(dshHome, "sessions", hit.project, hit.sdir, "session.jsonl"));
}
async function snapshotBeforeWrite(dshHome, sessionId, relPaths, turnAnchor) {
  const empty = { snapshotted: 0, skipped: 0, anchor: null };
  if (!sessionId || relPaths.length === 0) return empty;
  const anchor = turnAnchor ?? await resolveSessionTurnAnchor(dshHome, sessionId);
  if (anchor === null || !Number.isInteger(anchor)) return empty;
  const eligible = relPaths.filter(isSnapshotEligible);
  const result = { snapshotted: 0, skipped: relPaths.length - eligible.length, anchor };
  if (eligible.length === 0) return result;
  const file = join2(snapshotDir(dshHome, sessionId), `${anchor}.json`);
  let snapshot = { turn: anchor, createdAt: Date.now(), files: [] };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(parsed?.files)) snapshot = { turn: anchor, createdAt: parsed.createdAt ?? Date.now(), files: parsed.files };
  } catch {
  }
  const seen = new Set(snapshot.files.map((f) => f.path));
  for (const rel of eligible) {
    if (seen.has(rel)) continue;
    let existed = true;
    let content = "";
    try {
      content = (await readFile(join2(dshHome, ...rel.split("/")))).toString("base64");
    } catch {
      existed = false;
    }
    snapshot.files.push({ path: rel, existed, content });
    seen.add(rel);
    result.snapshotted++;
  }
  if (result.snapshotted > 0) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(snapshot), "utf8");
  }
  return result;
}

// src/dsht-plugin-shared/schema.ts
var SCHEMA_MAX_DEPTH = 5;
function validateSchemaSubset(value, schema, path = "$", depth = 0) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return [];
  if (depth >= SCHEMA_MAX_DEPTH) return [];
  const s = schema;
  const type = typeof s.type === "string" ? s.type : "";
  if (type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [{ path, message: "\u5E94\u4E3A\u5BF9\u8C61\uFF08object\uFF09" }];
    }
    const issues = [];
    const tree = value;
    if (Array.isArray(s.required)) {
      for (const raw of s.required) {
        const key = String(raw);
        if (!(key in tree)) issues.push({ path: `${path}.${key}`, message: "\u7F3A\u5C11\u5FC5\u586B\u952E\uFF08required\uFF09" });
      }
    }
    if (s.properties !== null && typeof s.properties === "object" && !Array.isArray(s.properties)) {
      for (const [key, sub] of Object.entries(s.properties)) {
        if (tree[key] === void 0) continue;
        issues.push(...validateSchemaSubset(tree[key], sub, `${path}.${key}`, depth + 1));
      }
    }
    return issues;
  }
  if (type === "string") {
    return typeof value === "string" ? [] : [{ path, message: "\u5E94\u4E3A\u5B57\u7B26\u4E32\uFF08string\uFF09" }];
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? [] : [{ path, message: "\u5E94\u4E3A\u6570\u5B57\uFF08number\uFF09" }];
  }
  if (type === "boolean") {
    return typeof value === "boolean" ? [] : [{ path, message: "\u5E94\u4E3A\u5E03\u5C14\uFF08boolean\uFF09" }];
  }
  return [];
}

// src/dsht-plugin-shared/undo.ts
import { appendFile, mkdir as mkdir2, readFile as readFile2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2, join as join3 } from "node:path";

// src/dsht-plugin-shared/macros.ts
function parseVarPath(path) {
  const p = path.trim();
  if (p.startsWith("/")) {
    return p.split("/").filter((s) => s.length > 0).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return p.split(".").map((s) => s.trim()).filter((s) => s.length > 0);
}
function toPointer(path) {
  const segs = parseVarPath(path);
  return "/" + segs.map((s) => s.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}
function readVarPath(tree, path) {
  let cur = tree;
  for (const seg of parseVarPath(path)) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function writeVarPath(tree, path, value) {
  const segs = parseVarPath(path);
  if (segs.length === 0) return tree;
  const next = structuredClone(tree);
  let cur = next;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const existing = cur[seg];
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) cur[seg] = {};
    cur = cur[seg];
  }
  cur[segs[segs.length - 1]] = value;
  return next;
}
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function splitMacroList(listString) {
  if (listString.includes("::")) return listString.split("::");
  return listString.replace(/\\,/g, "\0COMMA\0").split(",").map((item) => item.trim().replace(/ COMMA /g, ","));
}
function rollDice(formula) {
  const m = formula.replace(/\s+/g, "").match(/^(\d*)d(\d+)([+-]\d+)?$|^(\d+)$/);
  if (m?.[4]) return Number(m[4]);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3]) : 0;
  if (count < 1 || count > 1e3 || sides < 2 || sides > 1e5) return null;
  let total = mod;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
  return total;
}
function stringifyVar(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
var MACRO_PATTERN = /\{\{([^{}]+)\}\}/g;
var WEEKDAYS = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
var customMacros = /* @__PURE__ */ new Map();
var CUSTOM_MACRO_NAME = /^[a-zA-Z][\w-]{0,63}$/;
var BUILTIN_MACRO_NAMES = /* @__PURE__ */ new Set([
  "user",
  "char",
  "persona",
  "noop",
  "getvar",
  "setvar",
  "addvar",
  "incvar",
  "decvar",
  "get_message_variable",
  "get_chat_variable",
  "get_character_variable",
  "get_preset_variable",
  "get_global_variable",
  "format_message_variable",
  "format_chat_variable",
  "format_character_variable",
  "format_preset_variable",
  "format_global_variable",
  "random",
  "pick",
  "roll",
  "dice",
  "time",
  "date",
  "datetime",
  "weekday",
  "isotime",
  "isodate"
]);
function hydrateCustomMacros(entries) {
  for (const [k, v] of Object.entries(entries ?? {})) {
    const key = k.trim().toLowerCase();
    if (!CUSTOM_MACRO_NAME.test(key) || BUILTIN_MACRO_NAMES.has(key)) continue;
    if (typeof v === "string") customMacros.set(key, v);
  }
}
var MACRO_MAX_ROUNDS = 10;
function expandTavernMacros(text, ctx) {
  const writes = [];
  const overlay = {};
  let current = text;
  let unknownMacros = [];
  for (let round = 0; round < MACRO_MAX_ROUNDS; round++) {
    const r = expandOnce(current, ctx, overlay, writes);
    unknownMacros = r.unknownMacros;
    if (r.text === current || !r.text.includes("{{")) {
      current = r.text;
      break;
    }
    current = r.text;
  }
  return { text: current, writes, unknownMacros };
}
function expandOnce(text, ctx, overlay, writes) {
  const unknownMacros = [];
  const now = ctx.now ?? /* @__PURE__ */ new Date();
  const rawHash = fnv1a(text);
  const readVar = (path) => {
    const local = readVarPath(overlay, path);
    if (local !== void 0) return local;
    return ctx.getVar?.(path);
  };
  const readScopeVar = (kind, path) => {
    let v = ctx.scopeGet?.(kind, path);
    if (v === void 0 && kind === "preset") v = ctx.scopeGet?.("global", path);
    if (v === void 0) v = readVar(path);
    return v;
  };
  const formatVar = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) return v.toLocaleString("en-US");
    return stringifyVar(v);
  };
  const addNumericVar = (path, delta) => {
    if (!path) return "";
    const cur = Number(readVar(path));
    const next = (Number.isFinite(cur) ? cur : 0) + delta;
    const value = String(next);
    const pointer = toPointer(path);
    writeInto(overlay, path, value);
    writes.push({ path: pointer, value });
    ctx.setVar?.(pointer, value);
    return "";
  };
  const writeInto = (tree, path, value) => {
    const next = writeVarPath(tree, path, value);
    for (const k of Object.keys(tree)) delete tree[k];
    Object.assign(tree, next);
  };
  const result = text.replace(MACRO_PATTERN, (full, body, offset) => {
    if (body.startsWith("//") || body.startsWith("!")) return "";
    const sep = body.indexOf("::") >= 0 ? "::" : ":";
    const sepAt = body.indexOf(sep);
    const name2 = (sepAt >= 0 ? body.slice(0, sepAt) : body).trim();
    const args = sepAt >= 0 ? body.slice(sepAt + sep.length) : "";
    switch (name2) {
      case "user":
        return ctx.user;
      case "char":
        return ctx.char;
      case "persona":
        return ctx.persona ?? "";
      case "noop":
        return "";
      case "getvar":
        return stringifyVar(readVar(args.trim()));
      case "setvar": {
        const innerSep = args.indexOf("::") >= 0 ? "::" : ":";
        const innerAt = args.indexOf(innerSep);
        const path = (innerAt >= 0 ? args.slice(0, innerAt) : args).trim();
        const value = innerAt >= 0 ? args.slice(innerAt + innerSep.length).replace(/^\s+|\s+$/g, "") : "";
        if (!path) return "";
        const pointer = toPointer(path);
        writeInto(overlay, path, value);
        writes.push({ path: pointer, value });
        ctx.setVar?.(pointer, value);
        return "";
      }
      case "addvar": {
        const innerSep = args.indexOf("::") >= 0 ? "::" : ":";
        const innerAt = args.indexOf(innerSep);
        const path = (innerAt >= 0 ? args.slice(0, innerAt) : args).trim();
        const delta = innerAt >= 0 ? Number(args.slice(innerAt + innerSep.length).trim()) : 0;
        return addNumericVar(path, Number.isFinite(delta) ? delta : 0);
      }
      case "incvar":
        return addNumericVar(args.trim(), 1);
      case "decvar":
        return addNumericVar(args.trim(), -1);
      // C2 类宏（MVU 作用域变量）：get 走 scopeGet（保持 unknown 语义——未命中不吞原文由 stringifyVar 决定）
      case "get_message_variable":
      case "get_chat_variable":
        return stringifyVar(readScopeVar("chat", args.trim()));
      case "get_character_variable":
        return stringifyVar(readScopeVar("character", args.trim()));
      case "get_preset_variable":
        return stringifyVar(readScopeVar("preset", args.trim()));
      case "get_global_variable":
        return stringifyVar(readScopeVar("global", args.trim()));
      case "format_message_variable":
      case "format_chat_variable":
        return formatVar(readScopeVar("chat", args.trim()));
      case "format_character_variable":
        return formatVar(readScopeVar("character", args.trim()));
      case "format_preset_variable":
        return formatVar(readScopeVar("preset", args.trim()));
      case "format_global_variable":
        return formatVar(readScopeVar("global", args.trim()));
      case "random": {
        const list = splitMacroList(args);
        if (list.length === 0) return "";
        return list[Math.floor(Math.random() * list.length)];
      }
      case "pick": {
        const list = splitMacroList(args);
        if (list.length === 0) return "";
        const seed = fnv1a(`${ctx.stableSeed ?? ""}-${rawHash}-${offset}`);
        const rng = mulberry32(seed);
        return list[Math.floor(rng() * list.length)];
      }
      case "roll":
      case "dice": {
        const formula = args.trim();
        const norm = /^\d+$/.test(formula) ? `1d${formula}` : formula;
        const r = rollDice(norm);
        return r == null ? "" : String(r);
      }
      case "time":
        return now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      case "date":
        return now.toLocaleDateString("zh-CN");
      case "datetime":
        return `${now.toLocaleDateString("zh-CN")} ${now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
      case "weekday":
        return `\u661F\u671F${WEEKDAYS[now.getDay()]}`;
      case "isotime":
        return now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
      case "isodate": {
        const p2 = (n) => String(n).padStart(2, "0");
        return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
      }
      default: {
        const custom = customMacros.get(name2.toLowerCase());
        if (custom !== void 0) {
          if (typeof custom === "function") {
            try {
              return custom(args, ctx);
            } catch {
              return full;
            }
          }
          return custom;
        }
        unknownMacros.push(full);
        return full;
      }
    }
  });
  return { text: result, unknownMacros };
}

// src/dsht-plugin-shared/undo.ts
function undoLogPath(dshHome, sessionId) {
  return join3(dshHome, "rp", "state", `${sessionId}.undo.jsonl`);
}
function makeUndoEntry(scope, slug, path, tree, ts = Date.now()) {
  const pointer = toPointer(path);
  const oldValue = readVarPath(tree, pointer);
  return { ts, scope, slug, path: pointer, oldValue: oldValue === void 0 ? null : oldValue, had: oldValue !== void 0 };
}
async function appendUndoEntries(dshHome, sessionId, entries) {
  if (!sessionId || entries.length === 0) return;
  const file = undoLogPath(dshHome, sessionId);
  await mkdir2(dirname2(file), { recursive: true });
  await appendFile(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}
function flattenLeaves(tree, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const key = `${prefix}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenLeaves(v, key));
    } else {
      out.push([key, v]);
    }
  }
  return out;
}
function diffUndoEntries(scope, slug, before, after, ts = Date.now()) {
  const entries = [];
  const beforeFlat = new Map(flattenLeaves(before));
  const afterFlat = new Map(flattenLeaves(after));
  for (const [path, value] of afterFlat) {
    const old = beforeFlat.get(path);
    if (old !== void 0 && JSON.stringify(old) === JSON.stringify(value)) continue;
    entries.push({ ts, scope, slug, path, oldValue: old === void 0 ? null : old, had: old !== void 0 });
  }
  for (const [path, old] of beforeFlat) {
    if (!afterFlat.has(path)) entries.push({ ts, scope, slug, path, oldValue: old, had: true });
  }
  return entries;
}

// src/dsht-plugin-tavern-helper/for-session.ts
var STATE_RESERVED_KEYS = /* @__PURE__ */ new Set(["presetId", "state", "variables", "variableSchema", "cursor", "loreTimed", "tavern"]);
function isTree2(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function normalizeButton(raw) {
  if (!isTree2(raw)) return { enabled: false, buttons: [] };
  const buttons = Array.isArray(raw.buttons) ? raw.buttons.filter((b) => isTree2(b)).map((b) => ({ name: String(b.name ?? ""), visible: b.visible !== false })).filter((b) => b.name.length > 0) : [];
  return { enabled: raw.enabled === true, buttons };
}
function flattenScriptLibrary(raw, source) {
  if (!isTree2(raw) || !Array.isArray(raw.scripts)) return [];
  const out = [];
  const walk = (entries, folderEnabled) => {
    for (const e of entries) {
      if (!isTree2(e)) continue;
      const entry = e;
      if (Array.isArray(entry.scripts)) {
        walk(entry.scripts, folderEnabled && entry.enabled !== false);
        continue;
      }
      if (!folderEnabled || entry.enabled === false) continue;
      const id = String(entry.id ?? "");
      if (!id) continue;
      const button = normalizeButton(entry.button);
      out.push({
        id,
        name: String(entry.name ?? id),
        content: typeof entry.content === "string" ? entry.content : "",
        buttonEnabled: button.enabled,
        buttons: button.buttons,
        data: isTree2(entry.data) ? entry.data : {},
        source
      });
    }
  };
  walk(raw.scripts, true);
  return out;
}
function mergeSessionScripts(presetRaw, characterRaw) {
  const byId = /* @__PURE__ */ new Map();
  for (const s of flattenScriptLibrary(presetRaw, "preset")) byId.set(s.id, s);
  for (const s of flattenScriptLibrary(characterRaw, "character")) byId.set(s.id, s);
  return [...byId.values()];
}
function presetIdFromStateFile(file) {
  if (!isTree2(file)) return null;
  if (!Object.keys(file).some((k) => STATE_RESERVED_KEYS.has(k))) return null;
  const pid = file.presetId;
  return typeof pid === "string" && pid ? pid : null;
}
function activePresetNameFromSettings(raw) {
  if (!isTree2(raw)) return null;
  const oai = raw.oai_settings;
  if (!isTree2(oai)) return null;
  const name2 = oai.preset_settings_openai;
  return typeof name2 === "string" && name2.trim() ? name2.trim() : null;
}
function matchPresetByDisplayName(presets, activeName) {
  if (!activeName) return null;
  for (const p of [...presets].sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.displayName === activeName) return p.id;
  }
  return null;
}
function lodashPathToPointer(path) {
  if (path.startsWith("/")) return path;
  const segs = [];
  const re = /[^.[\]]+|\[(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g;
  for (const m of path.matchAll(re)) {
    let seg = m[0];
    if (seg.startsWith("[")) {
      seg = seg.slice(1, -1);
      if (seg.startsWith('"') && seg.endsWith('"') || seg.startsWith("'") && seg.endsWith("'")) {
        seg = seg.slice(1, -1);
      }
    }
    if (seg) segs.push(seg.replace(/~/g, "~0").replace(/\//g, "~1"));
  }
  return "/" + segs.join("/");
}

// src/dsht-plugin-tavern-helper/facade.ts
function isTree3(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function buildStPromptView(preset) {
  const prompts = [];
  const order = [];
  for (const slot of preset.slots) {
    prompts.push({
      identifier: slot.id,
      name: slot.id,
      role: slot.role ?? "system",
      content: slot.content ?? "",
      system_prompt: slot.type === "system" || slot.type === "skillRef",
      marker: slot.type === "marker",
      injection_position: slot.depth != null ? 1 : 0,
      injection_depth: slot.depth ?? 100
    });
    order.push({ identifier: slot.id, enabled: slot.enabled });
  }
  for (const group of preset.toggles) {
    for (const option of group.options) {
      const identifier = `toggle-${group.group}-${option.id}`;
      prompts.push({
        identifier,
        name: option.label,
        role: "system",
        content: option.content,
        system_prompt: true,
        marker: false,
        injection_position: 0,
        injection_depth: 100
      });
      order.push({ identifier, enabled: option.selected === true });
    }
  }
  return { prompts, prompt_order: [{ character_id: 100001, order }] };
}
async function listPresets(dshHome) {
  const out = [];
  let dirs = [];
  try {
    dirs = await readdir3(join4(dshHome, "rp-presets"));
  } catch {
    return out;
  }
  for (const id of dirs.sort()) {
    try {
      const p = JSON.parse(await readFile3(join4(dshHome, "rp-presets", id, "preset.json"), "utf8"));
      if (isTree3(p)) out.push({ id, displayName: typeof p.displayName === "string" && p.displayName ? p.displayName : id, preset: p });
    } catch {
    }
  }
  return out;
}
async function resolveSessionPresetId(dshHome, sessionId) {
  try {
    const file = JSON.parse(await readFile3(join4(dshHome, "rp", "state", `${sessionId}.json`), "utf8"));
    const pid = presetIdFromStateFile(file);
    if (pid) return pid;
  } catch {
  }
  try {
    const batches = (await readdir3(join4(dshHome, "rp-import"))).filter((b) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(b)).sort().reverse();
    for (const b of batches) {
      const dir = join4(dshHome, "rp-import", b);
      let stRoot = "data/default-user";
      try {
        const meta = JSON.parse(await readFile3(join4(dir, "meta.json"), "utf8"));
        if (typeof meta.manifest?.stRoot === "string" && meta.manifest.stRoot) stRoot = meta.manifest.stRoot;
      } catch {
      }
      let activeName = null;
      try {
        activeName = activePresetNameFromSettings(JSON.parse(await readFile3(join4(dir, "unpacked", stRoot, "settings.json"), "utf8")));
      } catch {
        continue;
      }
      if (!activeName) continue;
      const presets = (await listPresets(dshHome)).map((p) => ({ id: p.id, displayName: p.displayName }));
      return matchPresetByDisplayName(presets, activeName);
    }
  } catch {
  }
  return null;
}
async function presetIdByName(dshHome, name2) {
  if (!name2) return null;
  const presets = await listPresets(dshHome);
  return matchPresetByDisplayName(presets.map((p) => ({ id: p.id, displayName: p.displayName })), name2);
}
function slugifyPresetId(name2) {
  const slug = name2.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  if (!slug) return "preset";
  return /^[a-z0-9]/.test(slug) ? slug : `p-${slug}`;
}
async function characterNameOf(dshHome, slug) {
  try {
    const rp = JSON.parse(await readFile3(join4(dshHome, "rp", slug, "rp.json"), "utf8"));
    return typeof rp?.characterName === "string" && rp.characterName ? rp.characterName : slug;
  } catch {
    return slug;
  }
}
async function snapshotFor(dshHome, sessionId, relPaths) {
  if (!sessionId) return;
  try {
    await snapshotBeforeWrite(dshHome, sessionId, relPaths);
  } catch {
  }
}
function homePath(dshHome, relPath) {
  return join4(dshHome, ...relPath.split("/"));
}
async function context(dshHome, body) {
  const sessionId = String(body.sessionId ?? "");
  const slug = String(body.slug ?? "");
  if (!sessionId) return { status: 400, body: { error: "sessionId required" } };
  const presetId = await resolveSessionPresetId(dshHome, sessionId);
  if (!presetId) return { status: 404, body: { error: "\u4F1A\u8BDD\u65E0\u6709\u6548\u9884\u8BBE" } };
  let preset;
  try {
    preset = JSON.parse(await readFile3(homePath(dshHome, `rp-presets/${presetId}/preset.json`), "utf8"));
  } catch {
    if (presetId === "rp-demo-direct") preset = demoDirectPreset();
    else if (presetId === "rp-demo-light-agent") preset = demoLightAgentPreset();
    else return { status: 404, body: { error: `preset.json not found: ${presetId}` } };
  }
  const view = buildStPromptView(preset);
  const characterName = slug ? await characterNameOf(dshHome, slug) : "";
  return {
    status: 200,
    body: {
      presetId,
      presetName: typeof preset.displayName === "string" ? preset.displayName : presetId,
      character: { name: characterName },
      chatCompletionSettings: { prompts: view.prompts, prompt_order: view.prompt_order }
    }
  };
}
async function presetNames(dshHome, body) {
  const sessionId = String(body.sessionId ?? "");
  const presets = await listPresets(dshHome);
  let loaded = null;
  if (sessionId) {
    const pid = await resolveSessionPresetId(dshHome, sessionId);
    loaded = presets.find((p) => p.id === pid)?.displayName ?? null;
  }
  return { status: 200, body: { names: presets.map((p) => p.displayName), loaded } };
}
async function resolvePresetIdByName(dshHome, name2, sessionId) {
  if (name2 === "in_use") return resolveSessionPresetId(dshHome, sessionId);
  const presets = await listPresets(dshHome);
  return matchPresetByDisplayName(presets.map((p) => ({ id: p.id, displayName: p.displayName })), name2);
}
async function presetGet(dshHome, body) {
  const name2 = String(body.name ?? "");
  if (!name2) return { status: 400, body: { error: "name required" } };
  const presetId = await resolvePresetIdByName(dshHome, name2, String(body.sessionId ?? ""));
  const hit = presetId ? (await listPresets(dshHome)).find((p) => p.id === presetId) : void 0;
  if (!hit) return { status: 200, body: { found: false, preset: null } };
  const view = buildStPromptView(hit.preset);
  return {
    status: 200,
    body: { found: true, preset: { name: hit.displayName, prompts: view.prompts, prompt_order: view.prompt_order } }
  };
}
async function presetExport(dshHome, body) {
  const name2 = String(body.name ?? "");
  if (!name2) return { status: 400, body: { error: "name required" } };
  const presetId = await resolvePresetIdByName(dshHome, name2, String(body.sessionId ?? ""));
  const hit = presetId ? (await listPresets(dshHome)).find((p) => p.id === presetId) : void 0;
  if (!hit) return { status: 404, body: { error: `preset not found: ${name2}` } };
  const view = buildStPromptView(hit.preset);
  const regexScripts = [];
  try {
    const parsed = JSON.parse(await readFile3(homePath(dshHome, `rp-presets/${hit.id}/regex.json`), "utf8"));
    for (const s of Array.isArray(parsed?.scripts) ? parsed.scripts : []) {
      regexScripts.push({
        scriptName: s.scriptName,
        findRegex: s.findRegex,
        replaceString: s.replaceString,
        trimStrings: s.trimStrings,
        placement: s.placement,
        disabled: s.disabled,
        markdownOnly: s.markdownOnly,
        promptOnly: s.promptOnly,
        runOnEdit: s.runOnEdit,
        substituteRegex: s.substituteRegex,
        minDepth: s.minDepth,
        maxDepth: s.maxDepth
      });
    }
  } catch {
  }
  return {
    status: 200,
    body: {
      name: hit.displayName,
      json: {
        name: hit.displayName,
        prompts: view.prompts,
        prompt_order: view.prompt_order,
        extensions: { regex_scripts: regexScripts }
      }
    }
  };
}
async function presetPut(dshHome, body) {
  const name2 = String(body.name ?? "");
  if (!name2) return { status: 400, body: { error: "name required" } };
  const rawPrompts = Array.isArray(body.prompts) ? body.prompts : null;
  if (!rawPrompts) return { status: 400, body: { error: "prompts array required" } };
  const sessionId = String(body.sessionId ?? "");
  const presetId = await resolvePresetIdByName(dshHome, name2, sessionId);
  let preset;
  let targetId;
  if (presetId) {
    targetId = presetId;
    preset = (await listPresets(dshHome)).find((p) => p.id === presetId).preset;
  } else if (body.create === true) {
    targetId = slugifyPresetId(name2);
    preset = emptyPreset(targetId, name2);
  } else {
    return { status: 404, body: { error: `preset not found: ${name2}` } };
  }
  const orders = Array.isArray(body.prompt_order) ? body.prompt_order.filter(isTree3) : [];
  const orderEntry = orders.find((o) => o.character_id === 100001 && Array.isArray(o.order)) ?? orders.find((o) => Array.isArray(o.order));
  const enabledById = /* @__PURE__ */ new Map();
  if (orderEntry) {
    for (const it of orderEntry.order.filter(isTree3)) {
      if (typeof it.identifier === "string") enabledById.set(it.identifier, it.enabled !== false);
    }
  }
  const usedIds = new Set(preset.slots.map((s) => s.id));
  for (const raw of rawPrompts) {
    if (!isTree3(raw)) continue;
    const identifier = typeof raw.identifier === "string" ? raw.identifier : "";
    const pName = typeof raw.name === "string" ? raw.name : "";
    const content = typeof raw.content === "string" ? raw.content : "";
    const role2 = raw.role === "user" || raw.role === "assistant" ? raw.role : "system";
    const enabled = enabledById.get(identifier) ?? true;
    const depth = raw.injection_position === 1 && typeof raw.injection_depth === "number" && Number.isFinite(raw.injection_depth) ? raw.injection_depth : null;
    const slot = preset.slots.find((s) => s.id === identifier);
    if (slot) {
      slot.enabled = enabled;
      if (slot.type !== "marker") {
        slot.content = content;
        slot.role = role2;
        if (depth != null) slot.depth = depth;
        else delete slot.depth;
      }
      continue;
    }
    let toggleHit = false;
    for (const g of preset.toggles) {
      for (const o of g.options) {
        if (identifier === `toggle-${g.group}-${o.id}`) {
          o.content = content;
          o.selected = enabled;
          toggleHit = true;
        }
      }
    }
    if (toggleHit) continue;
    const markerSlot = preset.slots.find((s) => s.type === "marker" && s.id === pName);
    if (markerSlot) {
      markerSlot.enabled = enabled;
      continue;
    }
    if (raw.marker === true) continue;
    let base = (pName || identifier || "prompt").trim().slice(0, 40);
    if (!base) base = "prompt";
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    const newSlot = { id, type: "system", content, enabled, role: role2 };
    if (depth != null) newSlot.depth = depth;
    preset.slots.push(newSlot);
  }
  const relPath = `rp-presets/${targetId}/preset.json`;
  await snapshotFor(dshHome, sessionId, [relPath]);
  await mkdir3(dirname3(homePath(dshHome, relPath)), { recursive: true });
  await writeFile3(homePath(dshHome, relPath), JSON.stringify(preset, null, 1), "utf8");
  console.log(`[dsht-th] preset/put: ${name2} \u2192 ${targetId}\uFF08slots=${preset.slots.length}\uFF09`);
  return { status: 200, body: { ok: true, presetId: targetId } };
}
async function presetDelete(dshHome, body) {
  const name2 = String(body.name ?? "");
  if (!name2) return { status: 400, body: { error: "name required" } };
  const presetId = await presetIdByName(dshHome, name2);
  if (!presetId) return { status: 404, body: { error: `preset not found: ${name2}` } };
  const sessionId = String(body.sessionId ?? "");
  await snapshotFor(dshHome, sessionId, [`rp-presets/${presetId}/preset.json`, `rp-presets/${presetId}/regex.json`]);
  await rm3(join4(dshHome, "rp-presets", presetId), { recursive: true, force: true });
  console.log(`[dsht-th] preset/delete: ${name2} \u2192 ${presetId}`);
  return { status: 200, body: { ok: true } };
}
async function presetRename(dshHome, body) {
  const name2 = String(body.name ?? "");
  const newName = String(body.newName ?? "");
  if (!name2 || !newName) return { status: 400, body: { error: "name and newName required" } };
  const presetId = await presetIdByName(dshHome, name2);
  if (!presetId) return { status: 404, body: { error: `preset not found: ${name2}` } };
  const relPath = `rp-presets/${presetId}/preset.json`;
  let preset;
  try {
    preset = JSON.parse(await readFile3(homePath(dshHome, relPath), "utf8"));
  } catch {
    return { status: 404, body: { error: `preset.json not found: ${presetId}` } };
  }
  preset.displayName = newName;
  await snapshotFor(dshHome, String(body.sessionId ?? ""), [relPath]);
  await writeFile3(homePath(dshHome, relPath), JSON.stringify(preset, null, 1), "utf8");
  console.log(`[dsht-th] preset/rename: ${name2} \u2192 ${newName}\uFF08${presetId}\uFF09`);
  return { status: 200, body: { ok: true, presetId } };
}
async function presetLoad(dshHome, body) {
  const sessionId = String(body.sessionId ?? "");
  const name2 = String(body.name ?? "");
  if (!sessionId) return { status: 400, body: { error: "sessionId required" } };
  if (!name2) return { status: 400, body: { error: "name required" } };
  const presetId = await presetIdByName(dshHome, name2);
  if (!presetId) return { status: 404, body: { error: `preset not found: ${name2}` } };
  const relPath = `rp/state/${sessionId}.json`;
  let file = {};
  try {
    const parsed = JSON.parse(await readFile3(homePath(dshHome, relPath), "utf8"));
    if (isTree3(parsed)) file = parsed;
  } catch {
  }
  if (!Object.keys(file).some((k) => STATE_RESERVED_KEYS.has(k)) && Object.keys(file).length > 0) {
    file = { variables: file };
  }
  file.presetId = presetId;
  await snapshotFor(dshHome, sessionId, [relPath]);
  await mkdir3(dirname3(homePath(dshHome, relPath)), { recursive: true });
  await writeFile3(homePath(dshHome, relPath), JSON.stringify(file), "utf8");
  console.log(`[dsht-th] preset/load: ${name2} \u2192 ${presetId}\uFF08sid=${sessionId}\uFF09`);
  return { status: 200, body: { ok: true, presetId } };
}
function rpSlugFromCwd(dshHome, cwd) {
  if (!cwd) return null;
  const rel = relative(join4(dshHome, "rp"), resolve(cwd));
  if (!rel || rel.startsWith("..")) return null;
  const slug = rel.split(/[\\/]/)[0];
  return slug || null;
}
async function chatMessages(dshHome, body) {
  const sessionId = String(body.sessionId ?? "");
  if (!sessionId) return { status: 400, body: { error: "sessionId required" } };
  const hit = (await scanSessionHeaders(dshHome)).find((h) => h.sessionId === sessionId);
  if (!hit) return { status: 404, body: { error: `session not found: ${sessionId}` } };
  let charName = "Assistant";
  const slug = rpSlugFromCwd(dshHome, hit.cwd);
  if (slug) {
    try {
      const rp = JSON.parse(await readFile3(homePath(dshHome, `rp/${slug}/rp.json`), "utf8"));
      if (typeof rp?.characterName === "string" && rp.characterName) charName = rp.characterName;
    } catch {
    }
  }
  const messages = [];
  const rl = createInterface({
    input: createReadStream(join4(dshHome, "sessions", hit.project, hit.sdir, "session.jsonl"), "utf8"),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try {
      ev = JSON.parse(t);
    } catch {
      continue;
    }
    let role2;
    let msg;
    if (ev.type === "user/message") {
      role2 = "user";
      msg = ev.data;
    } else if (ev.type === "assistant/message") {
      role2 = "assistant";
      msg = ev.data?.message;
    } else continue;
    if (!isTree3(msg)) continue;
    const source = isTree3(msg.source) ? msg.source : null;
    if (source?.form === "snapshot") continue;
    const content = msg.content;
    const text = Array.isArray(content) ? content.filter(isTree3).filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n") : typeof content === "string" ? content : "";
    if (!text) continue;
    messages.push({
      message_id: messages.length,
      // L1a：携带事件 seq（TH 事件桥的楼层解析锚——客户端节点视图以 seq 定位楼层）
      ...typeof ev.seq === "number" ? { seq: ev.seq } : {},
      name: role2 === "user" ? "User" : charName,
      role: role2,
      message: text,
      is_system: false
    });
  }
  return { status: 200, body: { messages } };
}
async function loadTaggedScripts(dshHome, relPath, scope) {
  try {
    const parsed = JSON.parse(await readFile3(homePath(dshHome, relPath), "utf8"));
    if (!Array.isArray(parsed.scripts)) return [];
    return parsed.scripts.filter(isTree3).map((s) => ({ ...s, _dshtScope: scope }));
  } catch {
    return [];
  }
}
async function loadCharacterRegex(dshHome, slug) {
  try {
    const rp = JSON.parse(await readFile3(homePath(dshHome, `rp/${slug}/rp.json`), "utf8"));
    if (!Array.isArray(rp.regex)) return [];
    return rp.regex.filter(isTree3).map((s) => ({ ...s, _dshtScope: "character" }));
  } catch {
    return [];
  }
}
async function regexesGet(dshHome, body) {
  const slug = String(body.slug ?? "");
  const sessionId = String(body.sessionId ?? "");
  const regexes = [
    ...await loadTaggedScripts(dshHome, "rp/regex/global.json", "global"),
    ...slug ? await loadCharacterRegex(dshHome, slug) : []
  ];
  let presetId = null;
  if (sessionId) {
    presetId = await resolveSessionPresetId(dshHome, sessionId);
    if (presetId) regexes.push(...await loadTaggedScripts(dshHome, `rp-presets/${presetId}/regex.json`, "preset"));
  }
  return { status: 200, body: { regexes, presetId, slug: slug || null } };
}
async function regexesReplace(dshHome, body) {
  const scope = String(body.scope ?? "");
  const slug = String(body.slug ?? "");
  const sessionId = String(body.sessionId ?? "");
  if (!Array.isArray(body.regexes)) return { status: 400, body: { error: "regexes array required" } };
  const scripts = body.regexes.filter(isTree3);
  if (scope === "global") {
    const relPath = "rp/regex/global.json";
    await snapshotFor(dshHome, sessionId, [relPath]);
    await mkdir3(dirname3(homePath(dshHome, relPath)), { recursive: true });
    await writeFile3(homePath(dshHome, relPath), JSON.stringify({ scripts }, null, 1), "utf8");
    console.log(`[dsht-th] regexes/replace global: ${scripts.length}`);
    return { status: 200, body: { ok: true, count: scripts.length } };
  }
  if (scope === "character") {
    if (!slug) return { status: 400, body: { error: "slug required for character scope" } };
    const relPath = `rp/${slug}/rp.json`;
    let rp;
    try {
      rp = JSON.parse(await readFile3(homePath(dshHome, relPath), "utf8"));
    } catch {
      return { status: 404, body: { error: `rp.json not found: ${slug}` } };
    }
    rp.regex = scripts;
    await snapshotFor(dshHome, sessionId, [relPath]);
    await writeFile3(homePath(dshHome, relPath), JSON.stringify(rp, null, 1), "utf8");
    console.log(`[dsht-th] regexes/replace character: ${slug} \u2192 ${scripts.length}`);
    return { status: 200, body: { ok: true, count: scripts.length } };
  }
  if (scope === "preset") {
    const presetId = String(body.presetId ?? "") || (sessionId ? await resolveSessionPresetId(dshHome, sessionId) : null);
    if (!presetId) return { status: 400, body: { error: "presetId required\uFF08\u6216\u63D0\u4F9B\u53EF\u89E3\u6790\u7684 sessionId\uFF09" } };
    const dir = join4(dshHome, "rp-presets", presetId);
    try {
      await readdir3(dir);
    } catch {
      return { status: 404, body: { error: `\u9884\u8BBE\u4E0D\u5B58\u5728\uFF1A${presetId}` } };
    }
    const relPath = `rp-presets/${presetId}/regex.json`;
    await snapshotFor(dshHome, sessionId, [relPath]);
    await writeFile3(join4(dir, "regex.json"), JSON.stringify({ scripts }, null, 1), "utf8");
    console.log(`[dsht-th] regexes/replace preset: ${presetId} \u2192 ${scripts.length}`);
    return { status: 200, body: { ok: true, count: scripts.length } };
  }
  return { status: 400, body: { error: "scope must be global/character/preset" } };
}
async function worldbookList(dshHome, _body) {
  const books = [];
  const seen = /* @__PURE__ */ new Set();
  try {
    for (const dir of (await readdir3(join4(dshHome, "skills"))).sort()) {
      if (!dir.startsWith("wb-")) continue;
      const lorePath = `skills/${dir}/references/lore.json`;
      if (seen.has(lorePath)) continue;
      try {
        const parsed = JSON.parse(await readFile3(homePath(dshHome, lorePath), "utf8"));
        seen.add(lorePath);
        books.push({ name: typeof parsed?.name === "string" && parsed.name ? parsed.name : dir, lorePath });
      } catch {
      }
    }
  } catch {
  }
  try {
    const g = JSON.parse(await readFile3(homePath(dshHome, "rp/global-books.json"), "utf8"));
    if (Array.isArray(g.books)) {
      for (const b of g.books.filter(isTree3)) {
        if (typeof b.lorePath !== "string" || !b.lorePath || seen.has(b.lorePath)) continue;
        seen.add(b.lorePath);
        books.push({ name: typeof b.name === "string" && b.name ? b.name : b.lorePath, lorePath: b.lorePath });
      }
    }
  } catch {
  }
  return { status: 200, body: { books } };
}
async function locateBook(dshHome, name2) {
  try {
    for (const dir of (await readdir3(join4(dshHome, "skills"))).sort()) {
      if (!dir.startsWith("wb-")) continue;
      const lorePath = `skills/${dir}/references/lore.json`;
      if (dir === name2) return lorePath;
      try {
        const parsed = JSON.parse(await readFile3(homePath(dshHome, lorePath), "utf8"));
        if (parsed?.name === name2) return lorePath;
      } catch {
      }
    }
  } catch {
  }
  try {
    const g = JSON.parse(await readFile3(homePath(dshHome, "rp/global-books.json"), "utf8"));
    if (Array.isArray(g.books)) {
      for (const b of g.books.filter(isTree3)) {
        if (b.name === name2 && typeof b.lorePath === "string" && b.lorePath) return b.lorePath;
      }
    }
  } catch {
  }
  try {
    const dir = join4(dshHome, "rp", "chat-worldbooks");
    for (const f of (await readdir3(dir)).sort()) {
      if (!f.endsWith(".json")) continue;
      const p = `rp/chat-worldbooks/${f}`;
      if (f.replace(/\.json$/, "") === name2) return p;
      try {
        const parsed = JSON.parse(await readFile3(homePath(dshHome, p), "utf8"));
        if (parsed?.name === name2) return p;
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function loreEntryToSt(entry, uid) {
  return {
    uid,
    comment: entry.comment,
    content: entry.content,
    key: entry.keys,
    keysecondary: entry.secondaryKeys,
    selectiveLogic: entry.selectiveLogic,
    constant: entry.constant,
    selective: entry.selective,
    position: entry.position,
    depth: entry.depth,
    role: entry.role,
    scanDepth: entry.scanDepth,
    preventRecursion: entry.preventRecursion,
    excludeRecursion: entry.excludeRecursion,
    order: entry.insertionOrder,
    sticky: entry.sticky,
    cooldown: entry.cooldown,
    delay: entry.delay,
    group: entry.group,
    groupOverride: entry.groupOverride,
    disabled: !entry.enabled
  };
}
function stEntryToLore(st, bookName, id) {
  const arr = (v) => (Array.isArray(v) ? v : v === void 0 || v === null ? [] : [v]).map(String).filter((k) => k !== "");
  const num = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
  return {
    id,
    comment: typeof st.comment === "string" ? st.comment : "",
    content: typeof st.content === "string" ? st.content : "",
    keys: arr(st.key ?? st.keys),
    secondaryKeys: arr(st.keysecondary ?? st.secondaryKeys),
    selectiveLogic: num(st.selectiveLogic, 0),
    constant: st.constant === true,
    selective: st.selective === true,
    position: num(st.position, WI_POSITION.BEFORE),
    depth: num(st.depth, 4),
    role: st.role === "user" || st.role === "assistant" ? st.role : "system",
    scanDepth: typeof st.scanDepth === "number" && Number.isFinite(st.scanDepth) ? st.scanDepth : null,
    preventRecursion: st.preventRecursion === true,
    excludeRecursion: st.excludeRecursion === true,
    insertionOrder: num(st.order ?? st.insertionOrder, 100),
    sticky: num(st.sticky, 0),
    cooldown: num(st.cooldown, 0),
    delay: num(st.delay, 0),
    group: typeof st.group === "string" ? st.group : "",
    groupOverride: st.groupOverride === true,
    enabled: st.disabled !== true,
    book: bookName
  };
}
async function worldbookGet(dshHome, body) {
  const name2 = String(body.name ?? "");
  if (!name2) return { status: 400, body: { error: "name required" } };
  const lorePath = await locateBook(dshHome, name2);
  if (!lorePath) return { status: 404, body: { error: `worldbook not found: ${name2}` } };
  let book;
  try {
    book = JSON.parse(await readFile3(homePath(dshHome, lorePath), "utf8"));
  } catch {
    return { status: 404, body: { error: `lore.json \u8BFB\u53D6\u5931\u8D25: ${lorePath}` } };
  }
  const entries = Array.isArray(book.entries) ? book.entries : [];
  return {
    status: 200,
    body: {
      name: typeof book.name === "string" && book.name ? book.name : name2,
      lorePath,
      entries: entries.map((e, i) => loreEntryToSt(e, i)),
      importWarnings: Array.isArray(book.importWarnings) ? book.importWarnings : []
    }
  };
}
async function worldbookEntryPut(dshHome, body) {
  const name2 = String(body.name ?? "");
  if (!name2) return { status: 400, body: { error: "name required" } };
  if (!isTree3(body.entry)) return { status: 400, body: { error: "entry object required" } };
  const entry = body.entry;
  const lorePath = await locateBook(dshHome, name2);
  if (!lorePath) return { status: 404, body: { error: `worldbook not found: ${name2}` } };
  let book;
  try {
    book = JSON.parse(await readFile3(homePath(dshHome, lorePath), "utf8"));
  } catch {
    return { status: 404, body: { error: `lore.json \u8BFB\u53D6\u5931\u8D25: ${lorePath}` } };
  }
  const entries = Array.isArray(book.entries) ? book.entries : [];
  const comment = typeof entry.comment === "string" ? entry.comment : "";
  const uidNum = Number(entry.uid);
  const uidOk = Number.isInteger(uidNum) && uidNum >= 0 && uidNum < entries.length;
  let idx = uidOk ? uidNum : entries.findIndex((e) => comment !== "" && e.comment === comment);
  if (idx >= 0) {
    entries[idx] = stEntryToLore(entry, name2, entries[idx].id);
  } else {
    entries.push(stEntryToLore(entry, name2, `lore-${name2}-${entries.length}`));
    idx = entries.length - 1;
  }
  book.name = typeof book.name === "string" && book.name ? book.name : name2;
  book.entries = entries;
  await snapshotFor(dshHome, String(body.sessionId ?? ""), [lorePath]);
  await mkdir3(dirname3(homePath(dshHome, lorePath)), { recursive: true });
  await writeFile3(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), "utf8");
  console.log(`[dsht-th] worldbook/entry-put: ${name2} #${idx}\uFF08\u5171 ${entries.length} \u6761\uFF09`);
  return { status: 200, body: { ok: true, uid: idx, count: entries.length } };
}
async function loadSessionStateFile(dshHome, sessionId) {
  try {
    const parsed = JSON.parse(await readFile3(homePath(dshHome, `rp/state/${sessionId}.json`), "utf8"));
    if (!isTree3(parsed)) return {};
    if (!Object.keys(parsed).some((k) => STATE_RESERVED_KEYS.has(k)) && Object.keys(parsed).length > 0) {
      return { variables: parsed };
    }
    return parsed;
  } catch {
    return {};
  }
}
async function variablesMerge(dshHome, body) {
  const sessionId = String(body.sessionId ?? "");
  if (!sessionId) return { status: 400, body: { error: "sessionId required" } };
  if (!isTree3(body.variables)) return { status: 400, body: { error: "variables object required" } };
  const relPath = `rp/state/${sessionId}.json`;
  const file = await loadSessionStateFile(dshHome, sessionId);
  const before = isTree3(file.variables) ? file.variables : {};
  const merged = deepMergeVars(before, body.variables);
  if (JSON.stringify(before) === JSON.stringify(merged)) {
    return { status: 200, body: { ok: true, variables: merged, unchanged: true } };
  }
  if (file.variableSchema != null) {
    const issues = validateSchemaSubset(merged, file.variableSchema);
    if (issues.length > 0) return { status: 422, body: { error: "variableSchema \u6821\u9A8C\u5931\u8D25", issues } };
  }
  await appendUndoEntries(dshHome, sessionId, diffUndoEntries("chat", "", before, merged));
  await snapshotFor(dshHome, sessionId, [relPath]);
  await mkdir3(dirname3(homePath(dshHome, relPath)), { recursive: true });
  await writeFile3(homePath(dshHome, relPath), JSON.stringify({ ...file, variables: merged }), "utf8");
  console.log(`[dsht-th] variables/merge: sid=${sessionId}\uFF08${Object.keys(body.variables).length} \u9876\u5C42\u952E\uFF09`);
  return { status: 200, body: { ok: true, variables: merged } };
}
async function variableSchemaRegister(dshHome, body) {
  const sessionId = String(body.sessionId ?? "");
  if (!sessionId) return { status: 400, body: { error: "sessionId required" } };
  if (!isTree3(body.variableSchema)) return { status: 400, body: { error: "variableSchema object required" } };
  const name2 = typeof body.name === "string" ? body.name.trim() : "";
  const relPath = `rp/state/${sessionId}.json`;
  const file = await loadSessionStateFile(dshHome, sessionId);
  const vars = isTree3(file.variables) ? file.variables : {};
  const target = name2 ? vars[name2] : vars;
  if (target !== void 0) {
    const issues = validateSchemaSubset(target, body.variableSchema, name2 ? `$${name2}` : "$");
    if (issues.length > 0) return { status: 422, body: { error: "\u65E2\u6709\u53D8\u91CF\u4E0E schema \u4E0D\u5339\u914D", issues } };
  }
  if (name2) {
    const base = isTree3(file.variableSchema) ? file.variableSchema : {};
    const props = isTree3(base.properties) ? { ...base.properties } : {};
    props[name2] = body.variableSchema;
    file.variableSchema = { ...base, type: typeof base.type === "string" ? base.type : "object", properties: props };
  } else {
    file.variableSchema = body.variableSchema;
  }
  await snapshotFor(dshHome, sessionId, [relPath]);
  await mkdir3(dirname3(homePath(dshHome, relPath)), { recursive: true });
  await writeFile3(homePath(dshHome, relPath), JSON.stringify(file), "utf8");
  console.log(`[dsht-th] variables/schema: sid=${sessionId} ${name2 || "(\u6574\u6811)"}`);
  return { status: 200, body: { ok: true } };
}
async function worldbookReplaceEntries(dshHome, body) {
  const name2 = String(body.name ?? "");
  if (!name2) return { status: 400, body: { error: "name required" } };
  if (!Array.isArray(body.entries)) return { status: 400, body: { error: "entries array required" } };
  const lorePath = await locateBook(dshHome, name2);
  if (!lorePath) return { status: 404, body: { error: `worldbook not found: ${name2}` } };
  let book;
  try {
    book = JSON.parse(await readFile3(homePath(dshHome, lorePath), "utf8"));
  } catch {
    return { status: 404, body: { error: `lore.json \u8BFB\u53D6\u5931\u8D25: ${lorePath}` } };
  }
  const entries = body.entries.filter(isTree3).map((st, i) => stEntryToLore(st, name2, typeof st.id === "string" && st.id ? st.id : `lore-${name2}-${i}`));
  book.name = typeof book.name === "string" && book.name ? book.name : name2;
  book.entries = entries;
  await snapshotFor(dshHome, String(body.sessionId ?? ""), [lorePath]);
  await mkdir3(dirname3(homePath(dshHome, lorePath)), { recursive: true });
  await writeFile3(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), "utf8");
  console.log(`[dsht-th] worldbook/replace-entries: ${name2} \u2192 ${entries.length} \u6761`);
  return { status: 200, body: { ok: true, count: entries.length } };
}
async function resolveBookList(dshHome, names) {
  const out = [];
  for (const name2 of names) {
    const lorePath = await locateBook(dshHome, name2);
    if (!lorePath) return null;
    out.push({ name: name2, lorePath });
  }
  return out;
}
async function worldbookRebindGlobal(dshHome, body) {
  if (!Array.isArray(body.books)) return { status: 400, body: { error: "books array required" } };
  const names = body.books.map((n) => String(n)).filter((n) => n !== "");
  const resolved = await resolveBookList(dshHome, names);
  if (resolved === null) return { status: 404, body: { error: `worldbook not found in: [${names.join(", ")}]` } };
  const relPath = "rp/global-books.json";
  await snapshotFor(dshHome, String(body.sessionId ?? ""), [relPath]);
  await mkdir3(dirname3(homePath(dshHome, relPath)), { recursive: true });
  await writeFile3(homePath(dshHome, relPath), JSON.stringify({ books: resolved }, null, 1), "utf8");
  console.log(`[dsht-th] worldbook/rebind-global: [${names.join(", ")}]`);
  return { status: 200, body: { ok: true, count: resolved.length } };
}
async function worldbookRebindChar(dshHome, body) {
  const slug = String(body.slug ?? "");
  if (!slug) return { status: 400, body: { error: "slug required" } };
  if (!Array.isArray(body.books)) return { status: 400, body: { error: "books array required" } };
  const names = body.books.map((n) => String(n)).filter((n) => n !== "");
  const relPath = `rp/${slug}/rp.json`;
  let rp;
  try {
    rp = JSON.parse(await readFile3(homePath(dshHome, relPath), "utf8"));
  } catch {
    return { status: 404, body: { error: `rp.json not found: ${slug}` } };
  }
  const resolved = await resolveBookList(dshHome, names);
  if (resolved === null) return { status: 404, body: { error: `worldbook not found in: [${names.join(", ")}]` } };
  rp.books = resolved;
  await snapshotFor(dshHome, String(body.sessionId ?? ""), [relPath]);
  await writeFile3(homePath(dshHome, relPath), JSON.stringify(rp, null, 1), "utf8");
  console.log(`[dsht-th] worldbook/rebind-char: ${slug} \u2192 [${names.join(", ")}]`);
  return { status: 200, body: { ok: true, count: resolved.length } };
}
async function worldbookChatGetOrCreate(dshHome, body) {
  const sessionId = String(body.sessionId ?? "");
  if (!sessionId) return { status: 400, body: { error: "sessionId required" } };
  const name2 = `chat-${sessionId}`;
  const lorePath = `rp/chat-worldbooks/${sessionId}.json`;
  try {
    const existing = JSON.parse(await readFile3(homePath(dshHome, lorePath), "utf8"));
    if (isTree3(existing)) return { status: 200, body: { name: typeof existing.name === "string" && existing.name ? existing.name : name2, created: false } };
  } catch {
  }
  const book = { name: name2, entries: [], importWarnings: [] };
  await snapshotFor(dshHome, sessionId, [lorePath]);
  await mkdir3(dirname3(homePath(dshHome, lorePath)), { recursive: true });
  await writeFile3(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), "utf8");
  console.log(`[dsht-th] worldbook/chat-get-or-create: sid=${sessionId} \u2192 ${name2}`);
  return { status: 200, body: { name: name2, created: true } };
}

// src/dsht-plugin-tavern-helper/macros.ts
import { readFile as readFile4 } from "node:fs/promises";
import { join as join5 } from "node:path";
async function loadActivePersona(dshHome) {
  try {
    const parsed = JSON.parse(await readFile4(join5(dshHome, "rp", "persona.json"), "utf8"));
    const list = Array.isArray(parsed.list) ? parsed.list : [];
    const activeName = typeof parsed.active === "string" ? parsed.active : null;
    const hit = activeName !== null ? list.find((p) => p?.name === activeName) : void 0;
    if (!hit) return null;
    return {
      name: String(hit.name ?? ""),
      description: typeof hit.description === "string" ? hit.description : ""
    };
  } catch {
    return null;
  }
}
async function resolveIdentity(dshHome, slug) {
  let char = "";
  let macrosUser = "";
  if (slug) {
    try {
      const rp = JSON.parse(await readFile4(join5(dshHome, "rp", slug, "rp.json"), "utf8"));
      char = typeof rp?.macros?.char === "string" && rp.macros.char ? rp.macros.char : String(rp?.characterName ?? "");
      macrosUser = typeof rp?.macros?.user === "string" ? rp.macros.user : "";
    } catch {
    }
  }
  const persona = await loadActivePersona(dshHome);
  return {
    user: persona?.name || macrosUser || "\u7528\u6237",
    char: char || "\u89D2\u8272",
    persona: persona?.description ?? ""
  };
}
async function runMacroExpand(deps, input) {
  const slug = input.slug ?? "";
  const sessionId = input.sessionId ?? "";
  try {
    const disk = JSON.parse(await readFile4(join5(deps.dshHome, "rp", "macros.json"), "utf8"));
    hydrateCustomMacros(disk);
  } catch {
  }
  const identity = await resolveIdentity(deps.dshHome, slug);
  const globalTree = await deps.loadScope("global", "", "");
  const characterTree = slug ? await deps.loadScope("character", slug, "") : {};
  const chatTree = sessionId ? await deps.loadScope("chat", "", sessionId) : {};
  const merged = mergeScopes(globalTree, characterTree, chatTree);
  const r = expandTavernMacros(input.text, {
    user: identity.user,
    char: identity.char,
    persona: identity.persona,
    getVar: (path) => readVarPath(merged, path),
    // C2 类宏作用域读取：kind → 各自作用域树（preset 无独立落盘 → global 兜底；
    // chat/message 宏族 → chat 树），unknown 语义不变
    scopeGet: (kind, path) => {
      if (kind === "character") return readVarPath(characterTree, path);
      if (kind === "preset" || kind === "global") return readVarPath(globalTree, path);
      return readVarPath(chatTree, path);
    },
    stableSeed: sessionId ? `rp-${sessionId}` : slug ? `rp-${slug}` : "rp-global"
  });
  if (r.writes.length > 0) {
    const scope = sessionId ? "chat" : slug ? "character" : "global";
    let tree = await deps.loadScope(scope, slug, sessionId);
    if (sessionId) {
      const seq = [];
      let evolving = tree;
      for (const w of r.writes) {
        seq.push(makeUndoEntry(scope, slug, w.path, evolving));
        evolving = setByPath(evolving, w.path, w.value);
      }
      await appendUndoEntries(deps.dshHome, sessionId, seq);
      tree = evolving;
    } else {
      for (const w of r.writes) tree = setByPath(tree, w.path, w.value);
    }
    await deps.beforeSave?.(scope, slug, sessionId);
    await deps.saveScope(scope, slug, sessionId, tree);
  }
  return { result: r.text, writes: r.writes, unknownMacros: r.unknownMacros };
}

// src/dsht-plugin-shared/http.ts
import { homedir } from "node:os";
import { resolve as resolve2, join as join6 } from "node:path";
function resolveDshHome() {
  const envHome = process.env.DSH_HOME?.trim();
  return envHome ? resolve2(envHome) : join6(homedir(), ".dsh");
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
function queryOf(url) {
  const q = (url ?? "").split("?")[1] ?? "";
  return new URLSearchParams(q);
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
Schema.extend = function extend(type, resolve4) {
  resolvers[type] = resolve4;
};
Schema.resolve = function resolve3(data, schema, options = {}, strict = false) {
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

// src/dsht-plugin-tavern-helper/index.ts
var name = "dsht-plugin-tavern-helper";
var inject = ["webServer", "settings"];
var SCOPES2 = [...TAVERN_SCOPES];
var SESSION_HELD = /* @__PURE__ */ new Set(["preset", "message", "script"]);
function scopeArgError(scope, slug, sessionId, scriptId) {
  if (!SCOPES2.includes(scope)) return `scope must be one of ${SCOPES2.join("/")}`;
  if (scope === "character" && !slug) return "slug required for character scope";
  if (SESSION_HELD.has(scope) && !sessionId) return `sessionId required for ${scope} scope`;
  if (scope === "chat" && !sessionId) return "sessionId required for chat scope";
  if (scope === "script" && !scriptId) return "scriptId required for script scope";
  return null;
}
function apply(ctx, _config) {
  const dshHome = resolveDshHome();
  registerSettingsNamespace(ctx, "dsht-plugin-tavern-helper", "dsht-th");
  const scriptsPath = join7(dshHome, "rp", "tavern-helper", "scripts.json");
  const sessionStore = new TavernSessionStore({
    readStateFile: async (sid) => {
      try {
        const parsed = JSON.parse(await readFile5(join7(dshHome, "rp", "state", `${sid}.json`), "utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    writeStateFile: async (sid, file) => {
      const p = join7(dshHome, "rp", "state", `${sid}.json`);
      await mkdir4(dirname4(p), { recursive: true });
      await writeFile4(p, JSON.stringify(file), "utf8");
    }
  });
  const loadScope = async (scope, slug, sessionId, scriptId = "") => {
    try {
      if (scope === "global") {
        const parsed2 = JSON.parse(await readFile5(join7(dshHome, "rp", "variables", "global.json"), "utf8"));
        return parsed2 && typeof parsed2 === "object" && !Array.isArray(parsed2) ? parsed2 : {};
      }
      if (scope === "character") {
        if (!slug) return {};
        const parsed2 = JSON.parse(await readFile5(join7(dshHome, "rp", slug, "variables.json"), "utf8"));
        return parsed2 && typeof parsed2 === "object" && !Array.isArray(parsed2) ? parsed2 : {};
      }
      if (scope === "preset" || scope === "message") {
        const snap = await sessionStore.get(sessionId);
        return structuredClone(snap.scopes[scope]);
      }
      if (scope === "script") {
        const snap = await sessionStore.get(sessionId);
        return structuredClone(snap.scripts[scriptId] ?? {});
      }
      if (!sessionId) return {};
      const parsed = JSON.parse(await readFile5(join7(dshHome, "rp", "state", `${sessionId}.json`), "utf8"));
      const vars = parsed?.variables;
      return vars && typeof vars === "object" && !Array.isArray(vars) ? vars : {};
    } catch {
      return {};
    }
  };
  const saveScope = async (scope, slug, sessionId, tree, scriptId = "") => {
    if (scope === "global") {
      const p2 = join7(dshHome, "rp", "variables", "global.json");
      await mkdir4(dirname4(p2), { recursive: true });
      await writeFile4(p2, JSON.stringify(tree), "utf8");
      return;
    }
    if (scope === "character") {
      const p2 = join7(dshHome, "rp", slug, "variables.json");
      await mkdir4(dirname4(p2), { recursive: true });
      await writeFile4(p2, JSON.stringify(tree), "utf8");
      return;
    }
    if (scope === "preset" || scope === "message") {
      await sessionStore.mutate(sessionId, { scope, tree });
      return;
    }
    if (scope === "script") {
      await sessionStore.mutate(sessionId, { scope: "script", scriptId, tree });
      return;
    }
    const p = join7(dshHome, "rp", "state", `${sessionId}.json`);
    let file = {};
    try {
      const parsed = JSON.parse(await readFile5(p, "utf8"));
      if (parsed && typeof parsed === "object") file = parsed;
    } catch {
    }
    file.variables = tree;
    await mkdir4(dirname4(p), { recursive: true });
    await writeFile4(p, JSON.stringify(file), "utf8");
  };
  const loadScripts = async () => {
    try {
      const parsed = JSON.parse(await readFile5(scriptsPath, "utf8"));
      return Array.isArray(parsed.scripts) ? parsed.scripts : [];
    } catch {
      return [];
    }
  };
  const saveScripts = async (scripts) => {
    await mkdir4(dirname4(scriptsPath), { recursive: true });
    await writeFile4(scriptsPath, JSON.stringify({ scripts }, null, 1), "utf8");
  };
  const snapshotFiles = async (sessionId, relPaths) => {
    if (!sessionId) return;
    try {
      await snapshotBeforeWrite(dshHome, sessionId, relPaths);
    } catch {
    }
  };
  const scopeRelPath = (scope, slug, sessionId) => scope === "global" ? "rp/variables/global.json" : scope === "character" ? `rp/${slug}/variables.json` : `rp/state/${sessionId}.json`;
  registerPrefix(ctx, "/dsht-tavern-helper", "dsht-th", async (sub, req, res) => {
    const method = req.method ?? "GET";
    const q = queryOf(req.url);
    if (sub === "/settings") {
      const p = join7(dshHome, "rp", "th-settings.json");
      const defaults = {
        scriptEnabled: true,
        macroEnabled: true,
        render: { enabled: true, collapseCodeBlock: "frontend_only", allowStreaming: false, useBlobUrl: false, optimizeHljs: true, depth: 0, depthIgnoreHidden: false },
        optimize: {
          disableIncompatibleOption: true,
          betterMessageToLoad: true,
          betterCharacterUpdate: true,
          betterCharacterExport: true,
          betterCharacterDeletion: true,
          forceRecommendedWorldbookGlobalSettings: true,
          savePresetWhenSavingPresetEntries: true,
          maximizePresetContextLength: true
        },
        listener: { enabled: false, enableEcho: true, url: "http://localhost:6621", duration: 1e3 }
      };
      const loadMerged = async () => {
        const stored = await readFile5(p, "utf8").then((t) => JSON.parse(t)).catch(() => ({}));
        const out = { ...defaults };
        for (const k of Object.keys(defaults)) {
          const d = defaults[k], s = stored[k];
          if (k === "scriptEnabled" || k === "macroEnabled") {
            out[k] = typeof s === "boolean" ? s : d;
            continue;
          }
          if (d && typeof d === "object" && s && typeof s === "object") out[k] = { ...d, ...s };
          else if (s !== void 0) out[k] = s;
        }
        return out;
      };
      if (method === "GET") return sendJson(res, 200, await loadMerged());
      if (method === "PUT" || method === "POST") {
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object") return sendJson(res, 400, { error: "bad json" });
        const merged = await loadMerged();
        for (const k of ["scriptEnabled", "macroEnabled"]) {
          if (typeof body[k] === "boolean") merged[k] = body[k];
        }
        for (const g of ["render", "optimize", "listener"]) {
          const gv = body[g];
          if (gv && typeof gv === "object" && !Array.isArray(gv)) {
            merged[g] = { ...merged[g], ...gv };
          }
        }
        const rc = merged.render.collapseCodeBlock;
        if (rc !== "none" && rc !== "frontend_only" && rc !== "all") merged.render.collapseCodeBlock = "frontend_only";
        await mkdir4(dirname4(p), { recursive: true });
        await writeFile4(p, JSON.stringify(merged, null, 1), "utf8");
        console.log(`[dsht-th] settings: scriptEnabled=${merged.scriptEnabled} macroEnabled=${merged.macroEnabled}`);
        return sendJson(res, 200, { ok: true, settings: merged });
      }
      return sendJson(res, 405, { error: "GET/PUT only" });
    }
    const fromQuery = {
      scope: String(q.get("scope") ?? ""),
      slug: String(q.get("slug") ?? ""),
      sessionId: String(q.get("sessionId") ?? ""),
      scriptId: String(q.get("scriptId") ?? ""),
      path: String(q.get("path") ?? "")
    };
    if (sub === "/variables") {
      if (method === "GET") {
        const { scope: scope2, slug: slug2, sessionId: sessionId2, scriptId: scriptId2, path: path2 } = fromQuery;
        const argErr2 = scopeArgError(scope2, slug2, sessionId2, scriptId2);
        if (argErr2) return sendJson(res, 400, { error: argErr2 });
        const tree2 = await loadScope(scope2, slug2, sessionId2, scriptId2);
        if (!path2) return sendJson(res, 200, { variables: tree2 });
        return sendJson(res, 200, { value: getByPath(tree2, path2) });
      }
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: "bad json" });
      const scope = String(body.scope ?? "");
      const slug = String(body.slug ?? fromQuery.slug);
      const sessionId = String(body.sessionId ?? fromQuery.sessionId);
      const scriptId = String(body.scriptId ?? fromQuery.scriptId);
      const rawPath = String(body.path ?? fromQuery.path);
      const path = rawPath && !rawPath.startsWith("/") ? lodashPathToPointer(rawPath) : rawPath;
      const argErr = scopeArgError(scope, slug, sessionId, scriptId);
      if (argErr) return sendJson(res, 400, { error: argErr });
      const tree = await loadScope(scope, slug, sessionId, scriptId);
      if (method === "PUT" || method === "POST") {
        const next = path ? setByPath(tree, path, body.value) : body.variables && typeof body.variables === "object" ? body.variables : tree;
        if (JSON.stringify(next) === JSON.stringify(tree)) {
          return sendJson(res, 200, { ok: true, unchanged: true });
        }
        if (sessionId && !SESSION_HELD.has(scope)) {
          const entries = path ? [makeUndoEntry(scope, slug, path, tree)] : diffUndoEntries(scope, slug, tree, next);
          await appendUndoEntries(dshHome, sessionId, entries);
          await snapshotFiles(sessionId, [scopeRelPath(scope, slug, sessionId)]);
        }
        await saveScope(scope, slug, sessionId, next, scriptId);
        console.log(`[dsht-th] set ${scope}${path || ":/"} (${slug || sessionId || "-"}${scriptId ? ` script=${scriptId}` : ""})`);
        return sendJson(res, 200, { ok: true });
      }
      if (method === "DELETE") {
        if (!path) return sendJson(res, 400, { error: "path required for DELETE" });
        if (sessionId && !SESSION_HELD.has(scope)) {
          await appendUndoEntries(dshHome, sessionId, [makeUndoEntry(scope, slug, path, tree)]);
          await snapshotFiles(sessionId, [scopeRelPath(scope, slug, sessionId)]);
        }
        await saveScope(scope, slug, sessionId, deleteByPath(tree, path), scriptId);
        console.log(`[dsht-th] delete ${scope}:${path} (${slug || sessionId || "-"})`);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: "GET/PUT/DELETE only" });
    }
    if (sub === "/variables/merged") {
      if (method !== "GET" && method !== "POST") return sendJson(res, 405, { error: "GET/POST only" });
      let slug = fromQuery.slug;
      let sessionId = fromQuery.sessionId;
      let path = fromQuery.path;
      if (method === "POST") {
        const body = await readJsonBody(req);
        if (!body) return sendJson(res, 400, { error: "bad json" });
        slug = String(body.slug ?? slug);
        sessionId = String(body.sessionId ?? sessionId);
        path = String(body.path ?? path);
      }
      const merged = mergeScopes(
        await loadScope("global", "", ""),
        slug ? await loadScope("character", slug, "") : {},
        sessionId ? await loadScope("chat", "", sessionId) : {}
      );
      if (!path) return sendJson(res, 200, { variables: merged });
      return sendJson(res, 200, { value: getByPath(merged, path) });
    }
    if (sub === "/scripts") {
      if (method === "GET") return sendJson(res, 200, { scripts: await loadScripts() });
      if (method === "PUT" || method === "POST") {
        const body = await readJsonBody(req);
        const scripts = body?.scripts;
        if (!Array.isArray(scripts)) return sendJson(res, 400, { error: "scripts array required" });
        for (const s of scripts) {
          const err = validateScript(s);
          if (err) return sendJson(res, 400, { error: `invalid script: ${err}` });
        }
        await saveScripts(scripts);
        console.log(`[dsht-th] scripts saved: ${scripts.length}`);
        return sendJson(res, 200, { ok: true, count: scripts.length });
      }
      return sendJson(res, 405, { error: "GET/PUT only" });
    }
    if (sub === "/scripts/run") {
      if (method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: "bad json" });
      const id = String(body.id ?? "");
      if (!id) return sendJson(res, 400, { error: "id required" });
      const slug = String(body.slug ?? "");
      const sessionId = String(body.sessionId ?? "");
      const scripts = await loadScripts();
      const script = scripts.find((s) => s.id === id);
      if (!script) return sendJson(res, 404, { error: `script not found: ${id}` });
      if (script.enabled === false) return sendJson(res, 400, { error: `script disabled: ${id}` });
      const trees = {
        global: await loadScope("global", "", ""),
        character: slug ? await loadScope("character", slug, "") : {},
        chat: sessionId ? await loadScope("chat", "", sessionId) : {}
      };
      const result = runScript(script, trees);
      if (sessionId) {
        const entries = [
          ...diffUndoEntries("global", "", trees.global, result.trees.global),
          ...slug ? diffUndoEntries("character", slug, trees.character, result.trees.character) : [],
          ...diffUndoEntries("chat", "", trees.chat, result.trees.chat)
        ];
        await appendUndoEntries(dshHome, sessionId, entries);
        await snapshotFiles(sessionId, [
          scopeRelPath("global", "", ""),
          ...slug ? [scopeRelPath("character", slug, "")] : [],
          scopeRelPath("chat", "", sessionId)
        ]);
      }
      await saveScope("global", "", "", result.trees.global);
      if (slug) await saveScope("character", slug, "", result.trees.character);
      if (sessionId) await saveScope("chat", "", sessionId, result.trees.chat);
      for (const line of result.logs) console.log(`[dsht-th] script ${id}: ${line}`);
      console.log(`[dsht-th] script run: ${id} notes=${result.notes.length}`);
      return sendJson(res, 200, { ok: result.ok, notes: result.notes, error: result.error ?? null });
    }
    if (sub === "/macros/expand") {
      if (method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: "bad json" });
      const text = String(body.text ?? "");
      if (!text) return sendJson(res, 400, { error: "text required" });
      const thCfg = await readFile5(join7(dshHome, "rp", "th-settings.json"), "utf8").then((t) => JSON.parse(t)).catch(() => ({ macroEnabled: true }));
      if (thCfg.macroEnabled === false) {
        return sendJson(res, 200, { result: text, writes: [], unknownMacros: [], macroDisabled: true });
      }
      const out = await runMacroExpand(
        {
          dshHome,
          loadScope,
          saveScope,
          // 任务 1：setvar 落盘前的文件级 before 快照
          beforeSave: async (scope, slug2, sid) => {
            await snapshotFiles(sid, [scopeRelPath(scope, slug2, sid)]);
          }
        },
        { text, slug: String(body.slug ?? ""), sessionId: String(body.sessionId ?? "") }
      );
      console.log(`[dsht-th] macros/expand: ${text.length}ch \u2192 writes=${out.writes.length} unknown=${out.unknownMacros.length}`);
      return sendJson(res, 200, out);
    }
    if (sub === "/scripts/for-session") {
      if (method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: "bad json" });
      const sessionId = String(body.sessionId ?? "");
      const slug = String(body.slug ?? "");
      if (!sessionId) return sendJson(res, 400, { error: "sessionId required" });
      let presetId = null;
      try {
        const file = JSON.parse(await readFile5(join7(dshHome, "rp", "state", `${sessionId}.json`), "utf8"));
        presetId = presetIdFromStateFile(file);
      } catch {
      }
      if (!presetId) {
        try {
          const batches = (await readdir4(join7(dshHome, "rp-import"))).filter((b) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(b)).sort().reverse();
          let activeName = null;
          for (const b of batches) {
            const dir = join7(dshHome, "rp-import", b);
            let stRoot = "data/default-user";
            try {
              const meta = JSON.parse(await readFile5(join7(dir, "meta.json"), "utf8"));
              if (typeof meta.manifest?.stRoot === "string" && meta.manifest.stRoot) stRoot = meta.manifest.stRoot;
            } catch {
            }
            let text = "";
            try {
              text = await readFile5(join7(dir, "unpacked", stRoot, "settings.json"), "utf8");
            } catch {
              continue;
            }
            activeName = activePresetNameFromSettings(JSON.parse(text));
            if (activeName) break;
          }
          if (activeName) {
            const presets = [];
            try {
              for (const id of (await readdir4(join7(dshHome, "rp-presets"))).sort()) {
                try {
                  const p = JSON.parse(await readFile5(join7(dshHome, "rp-presets", id, "preset.json"), "utf8"));
                  presets.push({ id, displayName: p.displayName });
                } catch {
                }
              }
            } catch {
            }
            presetId = matchPresetByDisplayName(presets, activeName);
          }
        } catch {
        }
      }
      const readLibrary = async (p) => {
        try {
          return JSON.parse(await readFile5(p, "utf8"));
        } catch {
          return null;
        }
      };
      const presetRaw = presetId ? await readLibrary(join7(dshHome, "rp-presets", presetId, "tavern-helper-scripts.json")) : null;
      const charRaw = slug ? await readLibrary(join7(dshHome, "rp", slug, "tavern-helper-scripts.json")) : null;
      const scripts = mergeSessionScripts(presetRaw, charRaw);
      for (const s of scripts) {
        if (Object.keys(s.data).length === 0) continue;
        const snap = await sessionStore.get(sessionId);
        if (snap.scripts[s.id] === void 0) {
          await sessionStore.mutate(sessionId, { scope: "script", scriptId: s.id, tree: s.data });
        }
      }
      console.log(`[dsht-th] scripts/for-session: sid=${sessionId} preset=${presetId ?? "-"} slug=${slug || "-"} scripts=${scripts.length}`);
      return sendJson(res, 200, { scripts, presetId, slug });
    }
    if (sub === "/inject" || sub === "/uninject") {
      const injDir = join7(dshHome, "rp", "th-injections");
      const injPath = (sid2) => join7(injDir, `${sid2}.json`);
      const readInjections = async (sid2) => {
        try {
          const parsed = JSON.parse(await readFile5(injPath(sid2), "utf8"));
          return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : [];
        } catch {
          return [];
        }
      };
      if (sub === "/inject" && method === "GET") {
        const sid2 = String(q.get("sessionId") ?? "");
        if (!sid2) return sendJson(res, 400, { error: "sessionId required" });
        return sendJson(res, 200, { injections: await readInjections(sid2) });
      }
      if (method !== "POST") return sendJson(res, 405, { error: `${sub === "/inject" ? "GET/POST" : "POST"} only` });
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: "bad json" });
      const sid = String(body.sessionId ?? "");
      if (!sid) return sendJson(res, 400, { error: "sessionId required" });
      const existing = await readInjections(sid);
      if (sub === "/inject") {
        const rawList = Array.isArray(body.injections) ? body.injections : [body];
        const incoming = [];
        for (const raw of rawList) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const rec = raw;
          const key = typeof rec.key === "string" ? rec.key.trim() : "";
          if (!key) continue;
          incoming.push({
            key,
            prompt: typeof rec.prompt === "string" ? rec.prompt : "",
            order: typeof rec.order === "number" && Number.isFinite(rec.order) ? rec.order : 100,
            depth: typeof rec.depth === "number" && Number.isFinite(rec.depth) ? rec.depth : 4,
            position: typeof rec.position === "number" && Number.isFinite(rec.position) ? rec.position : 0,
            role: rec.role === "user" || rec.role === "assistant" ? rec.role : "system",
            should_scan: rec.should_scan === true,
            once: rec.once === true
          });
        }
        if (incoming.length === 0) return sendJson(res, 400, { error: "injections with key required" });
        const byKey = new Map(existing.map((x) => [String(x.key ?? ""), x]));
        for (const inj of incoming) byKey.set(String(inj.key), inj);
        await mkdir4(injDir, { recursive: true });
        const list = [...byKey.values()];
        await writeFile4(injPath(sid), JSON.stringify(list), "utf8");
        console.log(`[dsht-th] inject: sid=${sid} keys=[${incoming.map((i) => i.key).join(",")}] total=${list.length}`);
        return sendJson(res, 200, { ok: true, count: list.length });
      }
      const keys = (Array.isArray(body.keys) ? body.keys : []).map((k) => String(k)).filter((k) => k !== "");
      if (keys.length === 0) return sendJson(res, 400, { error: "keys required" });
      const keySet = new Set(keys);
      const next = existing.filter((x) => !keySet.has(String(x.key ?? "")));
      await mkdir4(injDir, { recursive: true });
      await writeFile4(injPath(sid), JSON.stringify(next), "utf8");
      console.log(`[dsht-th] uninject: sid=${sid} keys=[${keys.join(",")}] remain=${next.length}`);
      return sendJson(res, 200, { ok: true, count: next.length });
    }
    if (sub === "/generate") {
      if (method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJsonBody(req);
      if (!body) return sendJson(res, 400, { error: "bad json" });
      const system = String(body.system ?? "");
      const prompt = String(body.prompt ?? "");
      if (!prompt.trim()) return sendJson(res, 400, { error: "prompt required" });
      const host = String(req.headers.host ?? "").trim() || "127.0.0.1";
      try {
        const resp = await fetch(`http://${host}/dsht-rp/llm/classify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ system, prompt })
        });
        const data = await resp.json().catch(() => ({ error: `upstream HTTP ${resp.status}` }));
        if (!resp.ok) return sendJson(res, resp.status === 503 ? 503 : 502, data);
        console.log(`[dsht-th] generate: ${String(data.text ?? "").length}ch\uFF08loopback llm/classify\uFF09`);
        return sendJson(res, 200, data);
      } catch (e) {
        return sendJson(res, 502, { error: `llm \u901A\u9053\u8F6C\u53D1\u5931\u8D25\uFF1A${e.message}` });
      }
    }
    const facadePost = async (run) => {
      if (method !== "POST") {
        sendJson(res, 405, { error: "POST only" });
        return;
      }
      const body = await readJsonBody(req);
      if (!body) {
        sendJson(res, 400, { error: "bad json" });
        return;
      }
      const r = await run(dshHome, body);
      sendJson(res, r.status, r.body);
    };
    if (sub === "/context") return facadePost(context);
    if (sub === "/variables/merge") return facadePost(variablesMerge);
    if (sub === "/variables/schema") return facadePost(variableSchemaRegister);
    if (sub === "/preset/names") return facadePost(presetNames);
    if (sub === "/preset/export") return facadePost(presetExport);
    if (sub === "/preset/get") return facadePost(presetGet);
    if (sub === "/preset/put") return facadePost(presetPut);
    if (sub === "/preset/delete") return facadePost(presetDelete);
    if (sub === "/preset/rename") return facadePost(presetRename);
    if (sub === "/preset/load") return facadePost(presetLoad);
    if (sub === "/chat/messages") return facadePost(chatMessages);
    if (sub === "/regexes/get") return facadePost(regexesGet);
    if (sub === "/regexes/replace") return facadePost(regexesReplace);
    if (sub === "/worldbook/list") return facadePost(worldbookList);
    if (sub === "/worldbook/get") return facadePost(worldbookGet);
    if (sub === "/worldbook/entry-put") return facadePost(worldbookEntryPut);
    if (sub === "/worldbook/replace-entries") return facadePost(worldbookReplaceEntries);
    if (sub === "/worldbook/rebind-global") return facadePost(worldbookRebindGlobal);
    if (sub === "/worldbook/rebind-char") return facadePost(worldbookRebindChar);
    if (sub === "/worldbook/chat-get-or-create") return facadePost(worldbookChatGetOrCreate);
    return sendJson(res, 404, { error: "unknown endpoint" });
  });
}
export {
  apply,
  inject,
  name
};
