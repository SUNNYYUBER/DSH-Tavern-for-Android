"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.atomicWriteText = atomicWriteText;
/**
 * 跨插件共享的原子写（I8-2 同语义：temp 独占创建 + fsync + rename 发布 + 父目录 fsync）。
 *
 * 背景（2026-09-08 鲁棒性轮）：undo 回放（dsht-plugin-shared/undo.ts saveScopeTree）与
 * dsht-plugin-mvu 的 rp/state/<sessionId>.json 落盘此前都是裸 writeFile——该文件同时是
 * MVU 变量树唯一权威落点，并发写（回退回放 × 脚本变量写 × MVU register）半写即整树
 * 撕裂（项目既有教训：并发非原子写 JSON = 「新文档+旧文档尾部」拼接恒 parse 失败）。
 * 移动端进程被杀在写中途同理。统一走本实现（与 dsh-plugin/index.ts atomicWriteFile 同款，
 * 该本地副本保留兼容既有 import；新代码一律用本模块）。
 */
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/** 同毫秒并发写同路径的 tmp 名去重（L1b 宏注册爆发实机抓到的 EEXIST 冲突） */
let atomicWriteSeq = 0;
async function atomicWriteText(path, content) {
    const tmp = `${path}.${Date.now()}.${atomicWriteSeq++}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const handle = await (0, promises_1.open)(tmp, 'wx');
    try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await (0, promises_1.rename)(tmp, path);
    // 父目录 fsync（POSIX rename 耐久性要求；Android ext4/f2fs 私有目录有效）
    try {
        const dirHandle = await (0, promises_1.open)((0, node_path_1.dirname)(path), 'r');
        try {
            await dirHandle.sync();
        }
        finally {
            await dirHandle.close();
        }
    }
    catch { /* 目录 fsync 失败不阻塞（Windows 上目录句柄 fsync 不允许） */ }
}
