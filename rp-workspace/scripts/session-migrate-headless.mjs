#!/usr/bin/env node
/**
 * session-migrate-headless.mjs — 阶段 3：无头会话迁移驱动（副本安全）
 * =====================================================================
 * 目的：不启动 app、不碰设备生产数据，用官方 0.1.5 的 session format catalog
 *       把一份 v0/v1/v2 会话文件**就地迁移到 v3**，产出可对比的新文件。
 *
 * 依据（源码）：
 *   · node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js:33
 *     currentVersion: 3, migrations: [v0→v1, v1→v2, v2→v3]
 *   · types.d.ts: SessionFormatCatalog.createRestore / encodeCurrentHeader / encodeCurrentEvent
 *
 * 用法：
 *   node session-migrate-headless.mjs <in.jsonl> <out.jsonl> [--validation transformed|current] [--recovery strict|recoverable]
 *
 * 退出码：0 成功 / 1 失败（含不支持、malformed）
 */
import fs from "node:fs";
import readline from "node:readline";
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 通过绝对路径加载官方 catalog：这样脚本可从任意 cwd 运行，
// 且 catalog 自身的 bare import 会从 dsh-runtime-src/node_modules 解析（其自身所在目录）。
const DSH_SRC =
  process.env.DSH_RUNTIME_SRC ||
  "D:/DSH RolePlay/rp-workspace/dsh-runtime-src/node_modules";
const catalogPath = path.join(
  DSH_SRC,
  "@deepseek-ai/dsh-session-format-catalog/lib/index.js",
);
const catalogMod = await import(pathToFileURL(catalogPath).href);
const catalog = catalogMod.sessionFormatCatalog;

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error("用法: node session-migrate-headless.mjs <in.jsonl> <out.jsonl> [--validation transformed|current]");
  process.exit(1);
}
const validation = arg("--validation", "transformed");
const recovery = arg("--recovery", "strict");

const t0 = Date.now();
let headerValue = null;
let bodyCount = 0;
let badRows = 0;
let restore = null;

const rl = readline.createInterface({
  input: fs.createReadStream(input, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  const s = line.trim();
  if (!s) continue;
  let row;
  try {
    row = JSON.parse(s);
  } catch {
    badRows++;
    continue;
  }
  if (row && row.type === "session") {
    if (headerValue === null) headerValue = row;
    continue;
  }
  if (headerValue === null) continue; // 头部之前有东西，忽略
  if (restore === null) {
    const read = catalog.readHeader(headerValue);
    console.log(`[migrate] 头部分类: status=${read.status} stored=v${read.storedVersion} target=v${read.targetVersion}`);
    if (read.status === "unsupported" || read.status === "malformed") {
      console.error(`[migrate][FATAL] 会话不可迁移: ${read.reason || read.status}`);
      process.exit(1);
    }
    restore = catalog.createRestore(headerValue, { recovery, validation });
    console.log(`[migrate] 目标逻辑头部: ${JSON.stringify(restore.header)}`);
  }
  restore.decodeRow(row);
  bodyCount++;
  if (bodyCount % 100000 === 0) console.log(`[migrate] 已解码 ${bodyCount} 行...`);
}

if (!restore) {
  console.error("[migrate][FATAL] 未找到会话头部行");
  process.exit(1);
}

const artifact = restore.finish();
const tDecoded = Date.now();
console.log(`[migrate] 解码+迁移完成：${artifact.events.length} 事件，inheritedEventCount=${artifact.inheritedEventCount}`);

const out = fs.createWriteStream(output, { encoding: "utf8" });
out.write(JSON.stringify(catalog.encodeCurrentHeader(artifact.header, artifact.inheritedEventCount)) + "\n");
for (const ev of artifact.events) {
  out.write(JSON.stringify(catalog.encodeCurrentEvent(ev)) + "\n");
}
await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));

const t1 = Date.now();
console.log(`[migrate] ✅ 写出 ${output}`);
console.log(`[migrate] 耗时：读+迁移 ${((tDecoded - t0) / 1000).toFixed(2)}s / 总计 ${((t1 - t0) / 1000).toFixed(2)}s`);
if (badRows) console.log(`[migrate] ⚠️ 无法解析的行：${badRows}`);
