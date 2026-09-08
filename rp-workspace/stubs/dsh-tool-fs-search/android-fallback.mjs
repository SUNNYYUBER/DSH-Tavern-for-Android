// DSHTavern 打包期补丁资产：dsh-tool-fs-search 的 Android 纯 JS 搜索降级。
// Android 上 @vscode/ripgrep 没有可用二进制（linux 预编译是 glibc，bionic 不可加载），
// glob/grep 工具在 process.platform === "android" 时改走本模块：
//   glob：fs 递归枚举 + 简化通配（** / * / ? / {a,b}），mtime 新→旧排序
//   grep：逐文件 utf8 读取 + 逐行 RegExp，产出 rg --json 兼容的 NDJSON 供原解析链消费
// 目标只是"能搜"：不支持 rg 完整 glob 语法（字符类、[[:alpha:]] 等）与忽略规则；
// VCS 目录恒排除（对齐原工具的 GLOB_VCS_EXCLUDES）。
import { open, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

const VCS_DIRS = new Set([".git", ".svn", ".hg", ".bzr", ".jj", ".sl"]);
const MAX_FILES = 20000;   // 降级安全阀：防巨型工作区枚举失控
const MAX_MATCHES = 5000;  // 远超模型侧 inline 上限（grepMaxMatches 默认 250），防 OOM
const GREP_FILE_MAX_BYTES = 8 * 1024 * 1024; // 超过则跳过（rp 工作区常含数百 MB 媒体/zip，全读会卡死）
const SNIFF_BYTES = 8192;                    // 二进制嗅探窗口：首块含 NUL 视为二进制（对齐 rg 语义）
const GREP_CONCURRENCY = 16;                 // I/O 并发度：串行 await 在模拟器/真机上扫大工作区必超 30s 工具超时
// 明确二进制的扩展名：连 stat/sniff 都省（rg 语义本来也搜不出可读文本）
const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svgz", ".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".flac", ".webm", ".avi", ".mkv", ".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".bin", ".dat", ".db", ".sqlite", ".wasm", ".so", ".dll", ".exe", ".class", ".jar", ".apk"]);

function escapeRe(s) {
	return s.replace(/[.+^$()[\]\\|]/g, "\\$&");
}

// 简化 glob → RegExp source：** 跨目录、* 单段内任意、? 单字符、{a,b} 分支
function globToRegExpSource(pattern) {
	let out = "";
	let i = 0;
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*") {
			if (pattern[i + 1] === "*") {
				if (pattern[i + 2] === "/") {
					out += "(?:[^/]+/)*";
					i += 3;
				} else {
					out += ".*";
					i += 2;
				}
			} else {
				out += "[^/]*";
				i += 1;
			}
		} else if (c === "?") {
			out += "[^/]";
			i += 1;
		} else if (c === "{") {
			let depth = 1;
			let j = i + 1;
			let cur = "";
			const alts = [];
			while (j < pattern.length && depth > 0) {
				const d = pattern[j];
				if (d === "{") { depth++; cur += d; }
				else if (d === "}") { depth--; if (depth > 0) cur += d; }
				else if (d === "," && depth === 1) { alts.push(cur); cur = ""; }
				else cur += d;
				j++;
			}
			alts.push(cur);
			out += "(?:" + alts.map((a) => globToRegExpSource(a)).join("|") + ")";
			i = j;
		} else {
			out += escapeRe(c);
			i += 1;
		}
	}
	return out;
}

// rg 语义：无 "/" 的模式匹配任意深度 basename；含 "/" 锚定搜索根相对路径
function matchGlob(re, pattern, relPath) {
	const rel = relPath.split(sep).join("/");
	if (!pattern.includes("/")) {
		const base = rel.slice(rel.lastIndexOf("/") + 1);
		return re.test(base);
	}
	return re.test(rel);
}

async function walkFiles(rootAbs) {
	const out = [];
	const stack = [rootAbs];
	while (stack.length > 0 && out.length < MAX_FILES) {
		const dir = stack.pop();
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = dir + sep + entry.name;
			if (entry.isDirectory()) {
				if (!VCS_DIRS.has(entry.name)) stack.push(full);
			} else if (entry.isFile()) out.push(full);
			if (out.length >= MAX_FILES) break;
		}
	}
	return out;
}

function relOf(rootAbs, file) {
	return file.startsWith(rootAbs + sep) ? file.slice(rootAbs.length + 1) : file;
}

/**
 * runRipgrep 的 Android 替代：与 buildGlobCommand/buildGrepCommand 的固定 argv
 * 模板对齐（glob：--files --glob=PAT [-- ROOT]；grep：--json --regexp=PAT
 * [--glob=INC] [-- TARGET]），返回 { stdout, noMatches, workdir }。
 * glob 的 stdout 是每行一个绝对路径（调用侧 toWorkdirRelative 转工作区相对）；
 * grep 的 stdout 是 rg --json 兼容 NDJSON（仅 match 记录）。
 */
export async function dshtAndroidJsSearch(exec, toolName, argv) {
	const workdir = exec.agent?.session?.header?.cwd ?? process.cwd();
	let pattern;
	let include;
	let rootArg;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--") {
			rootArg = argv[i + 1];
			break;
		}
		if (a.startsWith("--glob=")) {
			if (a.startsWith("--glob=!")) continue; // 负向排除（VCS）由 VCS_DIRS 内置承担
			if (toolName === "glob") pattern = a.slice(7);
			else include = a.slice(7);
		} else if (a.startsWith("--regexp=")) pattern = a.slice(9);
	}
	const rootAbs = rootArg !== void 0 ? (isAbsolute(rootArg) ? rootArg : resolve(workdir, rootArg)) : workdir;

	if (toolName === "glob") {
		const pat = pattern ?? "*";
		const re = globToRegExpPrepared(pat);
		const matched = [];
		for (const f of await walkFiles(rootAbs)) {
			if (matchGlob(re, pat, relOf(rootAbs, f))) matched.push(f);
		}
		// --sort=modified：mtime 新→旧
		const withMtime = [];
		for (const f of matched) {
			let m = 0;
			try {
				m = (await stat(f)).mtimeMs;
			} catch {}
			withMtime.push([m, f]);
		}
		withMtime.sort((a, b) => b[0] - a[0]);
		return {
			stdout: withMtime.map(([, f]) => f).join("\n"),
			noMatches: withMtime.length === 0,
			workdir
		};
	}

	// grep
	let re;
	try {
		re = new RegExp(pattern ?? "");
	} catch (e) {
		throw new Error(`grep pattern rejected by js fallback: ${e.message}`);
	}
	const incRe = include !== void 0 ? globToRegExpPrepared(include) : void 0;
	let files;
	const rootStat = await stat(rootAbs).catch(() => void 0);
	if (rootStat !== void 0 && rootStat.isFile()) files = [rootAbs];
	else files = await walkFiles(rootAbs);
	// 16 路并发 worker 池：单文件独立扫描返回记录串，外部汇总。
	// 每文件前检查 abort（30s 工具超时经 exec.signal 传入），超时后快速收兵不再空转。
	const records = [];
	let idx = 0;
	const worker = async () => {
		while (idx < files.length && records.length < MAX_MATCHES) {
			if (exec.signal?.aborted === true) return;
			const f = files[idx++];
			const rel = relOf(rootAbs, f);
			if (incRe !== void 0 && !matchGlob(incRe, include, rel)) continue;
			const dot = rel.lastIndexOf(".");
			if (dot !== -1 && BINARY_EXTS.has(rel.slice(dot).toLowerCase())) continue;
			let text;
			try {
				// 两步读：先 stat 限尺寸 + open 嗅 8KB 二进制，媒体/zip 只花 8KB 的代价就跳过；
				// 直接 readFile 全读会把含数百 MB 媒体的工作区 grep 卡死（真机实测教训）
				const st = await stat(f);
				if (!st.isFile() || st.size > GREP_FILE_MAX_BYTES) continue;
				const fh = await open(f, "r");
				let binary = false;
				try {
					const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, Math.max(st.size, 1)));
					const { bytesRead } = await fh.read(sniff, 0, sniff.length, 0);
					binary = sniff.subarray(0, bytesRead).includes(0);
				} finally {
					await fh.close();
				}
				if (binary) continue;
				text = await readFile(f, "utf8");
			} catch {
				continue;
			}
			let lineNo = 0;
			for (const line of text.split("\n")) {
				lineNo++;
				re.lastIndex = 0;
				if (re.test(line)) {
					records.push(JSON.stringify({
						type: "match",
						data: {
							path: { text: f },
							line_number: lineNo,
							lines: { text: line.endsWith("\n") ? line : line + "\n" }
						}
					}));
					if (records.length >= MAX_MATCHES) return;
				}
			}
		}
	};
	await Promise.all(Array.from({ length: GREP_CONCURRENCY }, worker));
	return {
		stdout: records.join("\n"),
		noMatches: records.length === 0,
		workdir
	};
}

function globToRegExpPrepared(pattern) {
	return new RegExp("^" + globToRegExpSource(pattern) + "$");
}
