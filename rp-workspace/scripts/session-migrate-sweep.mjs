#!/usr/bin/env node
/**
 * session-migrate-sweep.mjs — 阶段 3：全会话迁移扫射（静态、零风险）
 * =====================================================================
 * 对一棵会话目录树里的**每一个** session.jsonl 跑一遍官方 0.1.5 迁移链，
 * 只报告成败与耗时，默认**不写任何产物**（dry-run）。
 *
 * 目的：在动设备/改数据之前，穷举出「哪个会话会被 v3 拒绝」。
 *       这是作战地图 §5 风险登记里概率最高的两项
 *       （「convert-chat 产出被 v3 拒」「补丁正则失效」）的直接判据。
 *
 * 用法：
 *   node session-migrate-sweep.mjs <rootDir> [--jobs 1]
 *
 * 退出码：0 = 全部可迁移 / 1 = 存在失败
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DSH_SRC =
  process.env.DSH_RUNTIME_SRC ||
  "D:/DSH RolePlay/rp-workspace/dsh-runtime-src/node_modules";
const catalogMod = await import(
  pathToFileURL(
    path.join(DSH_SRC, "@deepseek-ai/dsh-session-format-catalog/lib/index.js"),
  ).href
);
const catalog = catalogMod.sessionFormatCatalog;

const root = process.argv[2];
if (!root) {
  console.error("用法: node session-migrate-sweep.mjs <rootDir> [--recovery strict|recoverable]");
  process.exit(1);
}
// 运行时真实使用的策略：dsh-session-persistence-jsonl/lib/index.js:2293 → "recoverable"
// （:984 的 "strict" 只用于头部分类）。默认对齐运行时，避免误报。
const RECOVERY = process.argv.includes("--recovery")
  ? process.argv[process.argv.indexOf("--recovery") + 1]
  : "recoverable";

function findSessions(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findSessions(p, out);
    else if (e.name === "session.jsonl" || /^session\.v\d+\.jsonl$/.test(e.name)) out.push(p);
  }
  return out;
}

async function migrateOne(file) {
  const t0 = Date.now();
  let headerValue = null;
  let restore = null;
  let rows = 0;
  const size = fs.statSync(file).size;
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      const s = line.trim();
      if (!s) continue;
      let row;
      try {
        row = JSON.parse(s);
      } catch {
        continue;
      }
      if (row && row.type === "session") {
        if (headerValue === null) headerValue = row;
        continue;
      }
      if (headerValue === null) continue;
      if (restore === null) {
        const rd = catalog.readHeader(headerValue);
        if (rd.status === "unsupported" || rd.status === "malformed")
          throw new Error(`不可迁移(${rd.status}): ${rd.reason || ""}`);
        restore = catalog.createRestore(headerValue, {
          recovery: RECOVERY,
          validation: "transformed",
        });
      }
      restore.decodeRow(row);
      rows++;
    }
    if (!restore) throw new Error("无头部行");
    const art = restore.finish();
    // 重新编码，验证编码器不拒绝（不落盘）
    catalog.encodeCurrentHeader(art.header, art.inheritedEventCount);
    let bytes = 0;
    for (const ev of art.events) bytes += JSON.stringify(catalog.encodeCurrentEvent(ev)).length;
    return {
      ok: true,
      file,
      size,
      rows,
      events: art.events.length,
      outBytes: bytes,
      storedVersion: headerValue.version,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      file,
      size,
      rows,
      storedVersion: headerValue ? headerValue.version : "?",
      ms: Date.now() - t0,
      error: String(err && err.message ? err.message : err).slice(0, 300),
    };
  }
}

const files = findSessions(root).sort();
console.log(`[sweep] 发现 ${files.length} 个会话文件，开始逐个体检（dry-run，不写产物）\n`);
const results = [];
for (const f of files) {
  const r = await migrateOne(f);
  results.push(r);
  const rel = path.relative(root, r.file).split(path.sep).slice(-2).join("/");
  const tag = r.ok ? "✓" : "✗";
  console.log(
    `  ${tag} ${rel}  v${r.storedVersion}  ${(r.size / 1024).toFixed(0)}KB  ` +
      (r.ok ? `${r.rows}行→${r.events}事件  ${r.ms}ms` : `FAIL: ${r.error}`),
  );
}

const fails = results.filter((r) => !r.ok);
console.log(`\n[sweep] 汇总：${results.length} 个会话，成功 ${results.length - fails.length}，失败 ${fails.length}`);
const totalMs = results.reduce((a, r) => a + r.ms, 0);
const totalMB = results.reduce((a, r) => a + r.size, 0) / 1048576;
console.log(`[sweep] 总数据量 ${totalMB.toFixed(1)}MB，总耗时 ${(totalMs / 1000).toFixed(1)}s`);
const big = [...results].sort((a, b) => b.size - a.size)[0];
if (big)
  console.log(
    `[sweep] 最大会话 ${(big.size / 1048576).toFixed(1)}MB → ${big.ms}ms` +
      (big.ok ? `（${big.events} 事件）` : `（失败：${big.error}）`),
  );
if (fails.length) {
  console.log("\n[sweep] 失败清单：");
  for (const f of fails) console.log(`  ✗ ${f.file}\n      ${f.error}`);
  process.exit(1);
}
console.log("\n[sweep] ✅ 全部会话均可迁移到 v3");
