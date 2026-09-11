// rp-workspace/packages/src/dsht-plugin-undo/index.ts
import { readFile as readFile2 } from "node:fs/promises";

// rp-workspace/packages/src/dsht-plugin-shared/http.ts
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

// rp-workspace/packages/src/dsht-plugin-shared/session-surgery.ts
import { open, readdir } from "node:fs/promises";
import { join as join2 } from "node:path";
function truncateSessionJsonl(content, keepThroughSeq) {
  const lines = content.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return { content, kept: 0, dropped: 0, error: "\u7A7A\u6587\u4EF6" };
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return { content, kept: 0, dropped: 0, error: "header \u4E0D\u662F\u5408\u6CD5 JSON" };
  }
  if (header?.type !== "session") return { content, kept: 0, dropped: 0, error: "\u9996\u884C\u4E0D\u662F session header" };
  const kept = [];
  let dropped = 0;
  for (let i = 1; i < lines.length; i++) {
    let ev;
    try {
      ev = JSON.parse(lines[i]);
    } catch {
      return { content, kept: 0, dropped: 0, error: `\u7B2C ${i + 1} \u884C\u4E0D\u662F\u5408\u6CD5 JSON` };
    }
    if (typeof ev?.seq === "number" && ev.seq <= keepThroughSeq) kept.push(lines[i]);
    else dropped++;
  }
  return { content: [lines[0], ...kept].join("\n") + "\n", kept: kept.length, dropped };
}
function findLastUserMessage(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev?.type !== "user/message") continue;
    const d = ev.data;
    if (d?.source?.kind === "plugin") continue;
    const text = (d?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    return { seq: ev.seq, text };
  }
  return null;
}
var ACTION_LABEL = {
  rollback: "\u56DE\u9000",
  edit: "\u7F16\u8F91",
  regenerate: "\u91CD\u65B0\u751F\u6210"
};
function canSurgicallyTruncate(isLive, action) {
  if (!isLive) return { allowed: true };
  return {
    allowed: false,
    error: `session live\uFF08\u5185\u5B58\u6001\u6743\u5A01\uFF09\uFF1A\u5148\u5728 DSH \u91CC\u5173\u95ED\u8BE5\u4F1A\u8BDD\u518D${ACTION_LABEL[action]}`
  };
}
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
function pickCurrentSessionFilename(entries) {
  let best = null;
  let bestVersion = -1;
  for (const name2 of entries) {
    const m = /^session\.v(\d+)\.jsonl$/.exec(name2);
    if (m === null) continue;
    const v = Number(m[1]);
    if (v > bestVersion) {
      bestVersion = v;
      best = name2;
    }
  }
  return best ?? "session.jsonl";
}
async function scanSessionHeaders(dshHome) {
  const root = join2(dshHome, "sessions");
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
      sdirs = await readdir(join2(root, project));
    } catch {
      continue;
    }
    for (const sdir of sdirs) {
      let entries = [];
      try {
        entries = await readdir(join2(root, project, sdir));
      } catch {
        continue;
      }
      const file = join2(root, project, sdir, pickCurrentSessionFilename(entries));
      const firstLine = await readFirstLine(file);
      if (firstLine === null) continue;
      try {
        const header = JSON.parse(firstLine);
        if (header?.type !== "session" || typeof header.id !== "string") continue;
        out.push({
          sessionId: header.id,
          cwd: typeof header.cwd === "string" ? header.cwd : void 0,
          project,
          sdir,
          firstLine,
          file
        });
      } catch {
      }
    }
  }
  return out;
}

// rp-workspace/packages/src/dsht-plugin-shared/file-snapshots.ts
function snapshotRestoreBoundary(originalContent, keepThroughSeq) {
  const turns = [];
  for (const line of originalContent.split("\n").slice(1)) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      const turn = ev?.data?.turn;
      if (typeof ev?.seq === "number" && typeof turn === "number" && Number.isInteger(turn)) {
        turns.push({ seq: ev.seq, turn });
      }
    } catch {
    }
  }
  const fromTurn = turns.filter((t) => t.seq <= keepThroughSeq).reduce((m, t) => Math.max(m, t.turn), 0);
  const includeBoundary = fromTurn > 0 && turns.some((t) => t.seq > keepThroughSeq && t.turn === fromTurn);
  return { fromTurn, includeBoundary };
}

// rp-workspace/packages/src/dsht-plugin-shared/atomic-fs.ts
import { open as open2, rename } from "node:fs/promises";
import { dirname } from "node:path";
var atomicWriteSeq = 0;
async function atomicWriteText(path, content) {
  const tmp = `${path}.${Date.now()}.${atomicWriteSeq++}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const handle = await open2(tmp, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
  try {
    const dirHandle = await open2(dirname(path), "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
  }
}

// rp-workspace/packages/src/dsht-plugin-undo/workspace-snapshots.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir as readdir2, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { dirname as dirname2, isAbsolute, join as join3 } from "node:path";
function positiveInt(value, fallback) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
function resolveWorkspaceSnapshotConfig(dshHome, config = {}) {
  if (config.enabled === false) return null;
  return {
    storageDir: join3(dshHome, "undo", "file-history"),
    maxFiles: positiveInt(config.maxFiles, 1e5),
    maxFileBytes: positiveInt(config.maxFileBytes, 16 * 1024 * 1024),
    maxSnapshotBytes: positiveInt(config.maxSnapshotBytes, 512 * 1024 * 1024),
    maxTurnsPerSession: positiveInt(config.maxTurnsPerSession, 30),
    excludePrefixes: (config.excludePrefixes ?? []).filter((p) => typeof p === "string" && p !== "").map((p) => p.replaceAll("\\", "/"))
  };
}
function snapshotsDir(config, sessionId) {
  return join3(config.storageDir, "snapshots", sessionId);
}
function manifestPath(config, sessionId, turn) {
  return join3(snapshotsDir(config, sessionId), `${turn}.json`);
}
function blobsDir(config) {
  return join3(config.storageDir, "blobs");
}
async function hasTurnSnapshot(config, sessionId, turn) {
  try {
    await lstat(manifestPath(config, sessionId, turn));
    return true;
  } catch {
    return false;
  }
}
var GIT_MAX_BUFFER = 32 * 1024 * 1024;
function git(cwd, args, signal) {
  return new Promise((resolvePromise, reject) => {
    execFile("git", ["-c", "core.quotepath=false", "-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
    }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`git ${args.join(" ")} failed in ${JSON.stringify(cwd)}: ${String(stderr).trim() || error.message}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}
async function discoverWorkspaceRoot(cwd, signal) {
  const canonical = await realpath(cwd);
  const root = await realpath((await git(canonical, ["rev-parse", "--show-toplevel"], signal)).trim());
  if (!isAbsolute(root)) throw new Error(`git \u8FD4\u56DE\u975E\u7EDD\u5BF9\u5DE5\u4F5C\u6811\u6839: ${JSON.stringify(root)}`);
  return root;
}
function validateRelativePath(path) {
  const p = path.replaceAll("\\", "/");
  if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) {
    throw new Error(`\u975E\u6CD5\u4ED3\u5E93\u76F8\u5BF9\u8DEF\u5F84: ${JSON.stringify(path)}`);
  }
  return p;
}
function splitNul(value) {
  if (value === "") return [];
  const parts = value.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}
async function listEligiblePaths(root, config, signal) {
  const output = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], signal);
  const all = [...new Set(splitNul(output).filter((p) => !p.endsWith("/")).map(validateRelativePath))].sort();
  const prefixes = config.excludePrefixes;
  const paths = prefixes.length === 0 ? all : all.filter((p) => !prefixes.some((prefix) => p === prefix || p.startsWith(prefix)));
  if (paths.length > config.maxFiles) {
    throw new Error(`[TOO_MANY_FILES] \u5DE5\u4F5C\u533A\u6709 ${paths.length} \u4E2A\u53EF\u5FEB\u7167\u6587\u4EF6\uFF0C\u8D85\u8FC7\u914D\u7F6E\u4E0A\u9650 ${config.maxFiles}`);
  }
  return paths;
}
async function captureEntry(root, path, config, store, signal) {
  const target = join3(root, ...path.split("/"));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    let before;
    try {
      before = await lstat(target);
    } catch {
      return void 0;
    }
    const mode = before.mode & 511;
    if (before.isSymbolicLink()) {
      const linkTarget = await readlink(target);
      const after2 = await lstat(target);
      if (before.mtimeMs !== after2.mtimeMs || before.size !== after2.size) continue;
      return { entry: { kind: "symlink", target: linkTarget, mode } };
    }
    if (!before.isFile()) return void 0;
    if (before.size > config.maxFileBytes) {
      throw new Error(`[FILE_TOO_LARGE] ${JSON.stringify(path)} \u6709 ${before.size} \u5B57\u8282\uFF0C\u8D85\u8FC7\u5355\u6587\u4EF6\u4E0A\u9650 ${config.maxFileBytes}`);
    }
    const content = await readFile(target);
    signal?.throwIfAborted();
    const after = await lstat(target);
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || content.length !== after.size) continue;
    const blob = createHash("sha256").update(content).digest("hex");
    if (store) {
      const dir = blobsDir(config);
      await mkdir(dir, { recursive: true });
      try {
        await writeFile(join3(dir, blob), content, { flag: "wx" });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    }
    return { entry: { kind: "file", blob, size: content.length, mode }, content };
  }
  throw new Error(`[WORKSPACE_CHANGED_DURING_CAPTURE] ${JSON.stringify(path)} \u6355\u83B7\u671F\u95F4\u53CD\u590D\u53D8\u5316`);
}
async function captureTree(root, config, store, signal) {
  const paths = await listEligiblePaths(root, config, signal);
  const entries = /* @__PURE__ */ Object.create(null);
  let totalBytes = 0;
  for (const path of paths) {
    signal?.throwIfAborted();
    const captured = await captureEntry(root, path, config, store, signal);
    if (captured === void 0) continue;
    if (captured.entry.kind === "file") {
      totalBytes += captured.entry.size;
      if (totalBytes > config.maxSnapshotBytes) {
        throw new Error(`[SNAPSHOT_TOO_LARGE] \u53EF\u5FEB\u7167\u6587\u4EF6\u805A\u5408\u8D85\u8FC7\u4E0A\u9650 ${config.maxSnapshotBytes} \u5B57\u8282`);
      }
    }
    entries[path] = captured.entry;
  }
  return { entries, totalBytes };
}
async function captureWorkspaceSnapshot(options) {
  const { sessionId, turn, config } = options;
  if (await hasTurnSnapshot(config, sessionId, turn)) {
    return { root: "", turn, fileCount: 0, totalBytes: 0, skipped: true };
  }
  const root = await discoverWorkspaceRoot(options.cwd, options.signal);
  const tree = await captureTree(root, config, true, options.signal);
  const snapshot = {
    version: 1,
    sessionId,
    turn,
    createdAt: Date.now(),
    root,
    fileCount: Object.keys(tree.entries).length,
    totalBytes: tree.totalBytes,
    entries: tree.entries
  };
  const file = manifestPath(config, sessionId, turn);
  await mkdir(dirname2(file), { recursive: true });
  await atomicWriteText(file, JSON.stringify(snapshot));
  await pruneSessionSnapshots(config, sessionId);
  return { root, turn, fileCount: snapshot.fileCount, totalBytes: tree.totalBytes, skipped: false };
}
async function pruneSessionSnapshots(config, sessionId) {
  const turns = await listSnapshotTurns(config, sessionId);
  const stale = turns.sort((a, b) => b - a).slice(config.maxTurnsPerSession);
  for (const turn of stale) await rm(manifestPath(config, sessionId, turn), { force: true });
  if (stale.length > 0) await collectGarbageBlobs(config);
}
async function listSnapshotTurns(config, sessionId) {
  let names = [];
  try {
    names = await readdir2(snapshotsDir(config, sessionId));
  } catch {
    return [];
  }
  return names.map((n) => /^(\d+)\.json$/.exec(n)?.[1]).filter((s) => typeof s === "string").map(Number);
}
async function collectGarbageBlobs(config) {
  const referenced = /* @__PURE__ */ new Set();
  let sessionIds = [];
  try {
    sessionIds = await readdir2(join3(config.storageDir, "snapshots"));
  } catch {
    return;
  }
  for (const sessionId of sessionIds) {
    for (const turn of await listSnapshotTurns(config, sessionId)) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath(config, sessionId, turn), "utf8"));
        for (const entry of Object.values(manifest.entries ?? {})) {
          if (entry.kind === "file") referenced.add(entry.blob);
        }
      } catch {
      }
    }
  }
  let blobs = [];
  try {
    blobs = await readdir2(blobsDir(config));
  } catch {
    return;
  }
  for (const blob of blobs) {
    if (!referenced.has(blob)) await rm(join3(blobsDir(config), blob), { force: true }).catch(() => {
    });
  }
}
function entriesDiffer(left, right) {
  if (left.kind !== right.kind) return true;
  if (left.kind === "file" && right.kind === "file") return left.blob !== right.blob || left.size !== right.size;
  if (left.kind === "symlink" && right.kind === "symlink") return left.target !== right.target;
  return true;
}
async function restoreWorkspaceSnapshots(options) {
  const { sessionId, boundary, config } = options;
  const result = { restoredTurns: [], filesRestored: 0, filesDeleted: 0, errors: [] };
  const turns = (await listSnapshotTurns(config, sessionId)).filter((t) => t > boundary.fromTurn || boundary.includeBoundary && t === boundary.fromTurn).sort((a, b) => b - a);
  for (const turn of turns) {
    const file = manifestPath(config, sessionId, turn);
    let snapshot;
    try {
      snapshot = JSON.parse(await readFile(file, "utf8"));
      if (typeof snapshot.root !== "string" || typeof snapshot.entries !== "object" || snapshot.entries === null) {
        throw new Error("\u6E05\u5355\u7F3A\u5C11 root/entries");
      }
    } catch (e) {
      result.errors.push(`${turn}.json: \u5FEB\u7167\u635F\u574F\uFF08${e.message}\uFF09\uFF0C\u8DF3\u8FC7`);
      continue;
    }
    let current = /* @__PURE__ */ Object.create(null);
    try {
      current = (await captureTree(snapshot.root, config, false)).entries;
    } catch (e) {
      result.errors.push(`${turn}.json: \u5F53\u524D\u5DE5\u4F5C\u6811\u6E05\u70B9\u5931\u8D25\uFF08${e.message}\uFF09\uFF0C\u4EC5\u6062\u590D\u65E2\u6709\u6587\u4EF6`);
    }
    const paths = [.../* @__PURE__ */ new Set([...Object.keys(snapshot.entries), ...Object.keys(current)])].sort();
    for (const path of paths) {
      const before = snapshot.entries[path];
      const now = current[path];
      const target = join3(snapshot.root, ...path.split("/"));
      try {
        if (before !== void 0 && (now === void 0 || entriesDiffer(before, now))) {
          if (before.kind === "file") {
            const content = await readFile(join3(blobsDir(config), before.blob));
            await rm(target, { force: true });
            await mkdir(dirname2(target), { recursive: true });
            await writeFile(target, content);
          } else {
            const { symlink } = await import("node:fs/promises");
            await rm(target, { force: true });
            await mkdir(dirname2(target), { recursive: true });
            await symlink(before.target, target);
          }
          result.filesRestored++;
        } else if (before === void 0 && now !== void 0) {
          await rm(target, { force: true });
          result.filesDeleted++;
        }
      } catch (e) {
        result.errors.push(`${path}: ${e.message}`);
      }
    }
    await rm(file, { force: true });
    result.restoredTurns.push(turn);
  }
  if (result.restoredTurns.length > 0) await collectGarbageBlobs(config);
  return result;
}

// rp-workspace/packages/src/dsht-plugin-undo/index.ts
var name = "dsht-plugin-undo";
var inject = ["webServer", "sessions"];
async function locateSessionFile(dshHome, sessionId) {
  const hit = (await scanSessionHeaders(dshHome)).find((h) => h.sessionId === sessionId);
  return hit ? hit.file : null;
}
async function restoreFilesAfterTruncation(deps, sessionId, originalContent, keepThroughSeq) {
  if (deps.snapshots === void 0) return void 0;
  try {
    return await restoreWorkspaceSnapshots({
      sessionId,
      boundary: snapshotRestoreBoundary(originalContent, keepThroughSeq),
      config: deps.snapshots
    });
  } catch (e) {
    return { restoredTurns: [], filesRestored: 0, filesDeleted: 0, errors: [`\u6587\u4EF6\u5FEB\u7167\u6062\u590D\u5931\u8D25\uFF1A${e.message}`] };
  }
}
function fileSnapshotsBody(r) {
  return { turns: r.restoredTurns, restored: r.filesRestored, deleted: r.filesDeleted, errors: r.errors };
}
async function rollbackSession(deps, payload) {
  const sessionId = String(payload.sessionId ?? "");
  const keepThroughSeq = Number(payload.keepThroughSeq ?? -1);
  if (!sessionId) return { code: 400, body: { error: "sessionId required" } };
  if (!Number.isInteger(keepThroughSeq) || keepThroughSeq < 0) {
    return { code: 400, body: { error: "keepThroughSeq \u987B\u4E3A >= 0 \u7684\u6574\u6570" } };
  }
  const rollbackGuard = canSurgicallyTruncate(deps.isLive(sessionId), "rollback");
  if (!rollbackGuard.allowed) {
    return { code: 409, body: { error: rollbackGuard.error } };
  }
  const file = await locateSessionFile(deps.dshHome, sessionId);
  if (file === null) return { code: 404, body: { error: `session not found: ${sessionId}` } };
  const content = await readFile2(file, "utf8");
  const r = truncateSessionJsonl(content, keepThroughSeq);
  if (r.error) return { code: 400, body: { error: r.error } };
  if (r.dropped === 0) return { code: 200, body: { kept: r.kept, dropped: 0, truncatedTo: keepThroughSeq, note: "no-op\uFF08\u6CA1\u6709\u66F4\u9760\u540E\u7684\u4E8B\u4EF6\uFF09" } };
  await atomicWriteText(`${file}.bak`, content);
  await atomicWriteText(file, r.content);
  const fsnap = await restoreFilesAfterTruncation(deps, sessionId, content, keepThroughSeq);
  console.log(`[dsht-plugin-undo] rollback: ${sessionId} \u2192 kept=${r.kept} dropped=${r.dropped} snapshotTurns=${fsnap?.restoredTurns.join(",") ?? "(off)"}`);
  return {
    code: 200,
    body: {
      kept: r.kept,
      dropped: r.dropped,
      truncatedTo: keepThroughSeq,
      ...fsnap === void 0 ? {} : { fileSnapshots: fileSnapshotsBody(fsnap) }
    }
  };
}
async function regenerateSession(deps, payload) {
  const sessionId = String(payload.sessionId ?? "");
  if (!sessionId) return { code: 400, body: { error: "sessionId required" } };
  const regenGuard = canSurgicallyTruncate(deps.isLive(sessionId), "regenerate");
  if (!regenGuard.allowed) {
    return { code: 409, body: { error: regenGuard.error } };
  }
  const file = await locateSessionFile(deps.dshHome, sessionId);
  if (file === null) return { code: 404, body: { error: `session not found: ${sessionId}` } };
  const content = await readFile2(file, "utf8");
  const events = [];
  for (const line of content.split("\n").slice(1)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
    }
  }
  const lastUser = findLastUserMessage(events);
  if (!lastUser) return { code: 400, body: { error: "\u4F1A\u8BDD\u91CC\u6CA1\u6709\u7528\u6237\u6D88\u606F\uFF08\u65E0\u53EF\u91CD\u65B0\u751F\u6210\u7684\u951A\u70B9\uFF09" } };
  const r = truncateSessionJsonl(content, lastUser.seq);
  if (r.error) return { code: 400, body: { error: r.error } };
  if (r.dropped === 0) {
    return { code: 200, body: { truncatedTo: lastUser.seq, truncated: 0, lastUserText: lastUser.text, note: "no-op\uFF08\u6700\u540E\u4E00\u6761\u7528\u6237\u6D88\u606F\u4E4B\u540E\u6CA1\u6709\u4E8B\u4EF6\uFF09" } };
  }
  await atomicWriteText(`${file}.bak`, content);
  await atomicWriteText(file, r.content);
  const fsnap = await restoreFilesAfterTruncation(deps, sessionId, content, lastUser.seq);
  console.log(`[dsht-plugin-undo] regenerate: ${sessionId} \u2192 anchor=${lastUser.seq} truncated=${r.dropped} snapshotTurns=${fsnap?.restoredTurns.join(",") ?? "(off)"}`);
  return {
    code: 200,
    body: {
      truncatedTo: lastUser.seq,
      truncated: r.dropped,
      lastUserText: lastUser.text,
      ...fsnap === void 0 ? {} : { fileSnapshots: fileSnapshotsBody(fsnap) }
    }
  };
}
async function editUserMessage(deps, payload) {
  const sessionId = String(payload.sessionId ?? "");
  const seq = Number(payload.seq ?? -1);
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!sessionId) return { code: 400, body: { error: "sessionId required" } };
  if (!Number.isInteger(seq) || seq < 0) return { code: 400, body: { error: "seq \u987B\u4E3A >= 0 \u7684\u6574\u6570" } };
  if (!text.trim()) return { code: 400, body: { error: "text \u4E0D\u80FD\u4E3A\u7A7A" } };
  const editGuard = canSurgicallyTruncate(deps.isLive(sessionId), "edit");
  if (!editGuard.allowed) {
    return { code: 409, body: { error: editGuard.error } };
  }
  const file = await locateSessionFile(deps.dshHome, sessionId);
  if (file === null) return { code: 404, body: { error: `session not found: ${sessionId}` } };
  const content = await readFile2(file, "utf8");
  const lines = content.split("\n");
  let targetIdx = -1;
  const events = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let ev = null;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev === null || typeof ev.seq !== "number") continue;
    if (targetIdx === -1 && ev.type === "user/message" && ev.seq === seq && ev.data?.source?.kind === "user") {
      targetIdx = events.length;
    }
    events.push({ seq: ev.seq });
  }
  if (targetIdx === -1) return { code: 404, body: { error: `\u672A\u627E\u5230\u8BE5\u6D88\u606F\uFF08seq=${seq} \u7684\u771F\u7528\u6237\u6D88\u606F\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u622A\u65AD\uFF09` } };
  const keepThroughSeq = targetIdx > 0 ? events[targetIdx - 1].seq : -1;
  const r = truncateSessionJsonl(content, keepThroughSeq);
  if (r.error) return { code: 400, body: { error: r.error } };
  if (r.dropped === 0) return { code: 200, body: { truncatedTo: keepThroughSeq, truncated: 0, note: "no-op\uFF08\u8BE5\u6D88\u606F\u4E4B\u540E\u6CA1\u6709\u4E8B\u4EF6\uFF09" } };
  await atomicWriteText(`${file}.bak`, content);
  await atomicWriteText(file, r.content);
  const fsnap = await restoreFilesAfterTruncation(deps, sessionId, content, keepThroughSeq);
  console.log(`[dsht-plugin-undo] edit: ${sessionId} seq=${seq} \u2192 keep=${keepThroughSeq} truncated=${r.dropped} snapshotTurns=${fsnap?.restoredTurns.join(",") ?? "(off)"}`);
  return {
    code: 200,
    body: {
      truncatedTo: keepThroughSeq,
      truncated: r.dropped,
      ...fsnap === void 0 ? {} : { fileSnapshots: fileSnapshotsBody(fsnap) }
    }
  };
}
var TurnSnapshotCoordinator = class {
  constructor(config) {
    this.config = config;
  }
  config;
  /** 同一 (sessionId, turn) 的在途捕获去重（完成即清，幂等性由快照文件存在性兜底） */
  captures = /* @__PURE__ */ new Map();
  /** 同一工作树的捕获串行化（多会话同仓库时避免交错读树） */
  workspaceTails = /* @__PURE__ */ new Map();
  async capture(payload) {
    const sessionId = payload.agent?.id;
    const cwd = payload.agent?.session?.header?.cwd;
    const turn = payload.turn;
    if (typeof sessionId !== "string" || sessionId === "" || typeof cwd !== "string" || cwd === "") return;
    if (typeof turn !== "number" || !Number.isInteger(turn) || turn < 0) return;
    const key = `${sessionId}\0${turn}`;
    const existing = this.captures.get(key);
    if (existing !== void 0) return existing;
    const signal = payload.signal;
    const task = (async () => {
      try {
        await this.serializeWorkspace(cwd, async () => {
          const r = await captureWorkspaceSnapshot({
            sessionId,
            turn,
            cwd,
            config: this.config,
            ...signal === void 0 ? {} : { signal }
          });
          if (!r.skipped) {
            console.log(`[dsht-plugin-undo] snapshot: ${sessionId} turn ${turn} \u2192 ${r.fileCount} \u6587\u4EF6 / ${r.totalBytes} \u5B57\u8282 @ ${r.root}`);
          }
        });
      } catch (e) {
        console.warn(`[dsht-plugin-undo] snapshot failed for ${sessionId} turn ${turn}: ${e.message}`);
      } finally {
        this.captures.delete(key);
      }
    })();
    this.captures.set(key, task);
    await task;
  }
  async serializeWorkspace(workspace, task) {
    const previous = this.workspaceTails.get(workspace) ?? Promise.resolve();
    const current = previous.catch(() => void 0).then(task);
    this.workspaceTails.set(workspace, current);
    try {
      await current;
    } finally {
      if (this.workspaceTails.get(workspace) === current) this.workspaceTails.delete(workspace);
    }
  }
};
function apply(ctx, rawConfig) {
  const dshHome = resolveDshHome();
  const snapshots = resolveWorkspaceSnapshotConfig(dshHome, rawConfig ?? {}) ?? void 0;
  const deps = {
    dshHome,
    isLive: (sessionId) => ctx.sessions?.get(sessionId) !== void 0,
    ...snapshots === void 0 ? {} : { snapshots }
  };
  if (snapshots !== void 0 && typeof ctx.on === "function") {
    const coordinator = new TurnSnapshotCoordinator(snapshots);
    ctx.on("agent/pre-step", async (payload, next) => {
      const p = payload;
      if (p?.step === 1) await coordinator.capture(p);
      return next();
    }, { prepend: true });
    console.log(`[dsht-plugin-undo] workspace snapshots on (maxFiles=${snapshots.maxFiles} excludePrefixes=[${snapshots.excludePrefixes.join(", ")}] dir=${snapshots.storageDir})`);
  }
  registerPrefix(ctx, "/dsht-undo", name, async (sub, req, res) => {
    const request = req;
    if (request.method !== "POST") return sendJson(res, 405, { error: "POST only" });
    const payload = await readJsonBody(request);
    if (payload === null) return sendJson(res, 400, { error: "bad json body" });
    if (sub === "/rollback") {
      const r = await rollbackSession(deps, payload);
      return sendJson(res, r.code, r.body);
    }
    if (sub === "/regenerate") {
      const r = await regenerateSession(deps, payload);
      return sendJson(res, r.code, r.body);
    }
    if (sub === "/edit") {
      const r = await editUserMessage(deps, payload);
      return sendJson(res, r.code, r.body);
    }
    return sendJson(res, 404, { error: `unknown route: ${sub}` });
  });
}
export {
  apply,
  editUserMessage,
  inject,
  name,
  regenerateSession,
  rollbackSession
};
