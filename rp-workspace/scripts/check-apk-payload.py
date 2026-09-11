#!/usr/bin/env python3
"""核验 APK 内 assets/dsh-runtime.zip 里的产物是否含本轮标记（解码两种 esbuild 转义形态）。

用法：
  python check-apk-payload.py <apk> [needle ...]
  python check-apk-payload.py <apk> --file <路径后缀> [needle ...]

【2026-09-11 心跳 50 泛化】原版把扫描面**写死**在 `dsht-rp-plugin/lib/index.js`
—— 但同一轮改动往往同时落在**多个产物**里（本轮既有 `dsh-plugin` 侧
`index.ts`，也有 rp-ui 侧 `host-st-surface.ts` → `dsht-rp-plugin/lib/client.js`）。
写死一个文件时，另一侧的改动**根本没被核验**，却会打印"全部 OK" —— 假绿。
现改为：默认扫描 runtime.zip 内**全部条目**，逐条报告每根标记命中的文件与次数。
"""
import io
import re
import sys
import zipfile

argv = sys.argv[1:]
apk = argv[0] if argv else 'DSH-Tavern-0.2.0-arm64-release.apk'
rest = argv[1:]

only_suffix = None
if '--file' in rest:
    i = rest.index('--file')
    only_suffix = rest[i + 1]
    rest = rest[:i] + rest[i + 2:]
needles = rest or ['assistantSettlement', 'dd.stream = []']

with zipfile.ZipFile(apk) as z:
    inner = z.read('assets/dsh-runtime.zip')
print(f'apk: {apk}')
print(f'runtime.zip: {len(inner)} B')

# 形态① \\uXXXX  形态② 给每个 CJK 字符加反斜杠
_esc1 = re.compile(r'\\u([0-9a-fA-F]{4})')
_esc2 = re.compile(r'\\([\u4e00-\u9fff\uff00-\uffef\u3000-\u303f])')


def decode(t: str) -> str:
    t = _esc1.sub(lambda m: chr(int(m.group(1), 16)), t)
    return _esc2.sub(r'\1', t)


hits = {n: [] for n in needles}
scanned = 0
with zipfile.ZipFile(io.BytesIO(inner)) as rz:
    for name in rz.namelist():
        if name.endswith('/'):
            continue
        if only_suffix is not None and not name.endswith(only_suffix):
            continue
        if not name.endswith(('.js', '.mjs', '.cjs', '.json', '.ts', '.txt', '.html')):
            continue
        try:
            raw = rz.read(name).decode('utf-8', 'replace')
        except Exception:
            continue
        scanned += 1
        dec = decode(raw)
        for n in needles:
            c = dec.count(n)
            if c:
                hits[n].append((name, c))

print(f'扫描条目: {scanned} 个（后缀过滤={only_suffix or "无"}）')
bad = 0
for n in needles:
    if hits[n]:
        where = '；'.join(f'{f} × {c}' for f, c in hits[n][:4])
        print(f'  OK   {n!r} → {where}')
    else:
        bad += 1
        print(f'  MISS {n!r}')
sys.exit(1 if bad else 0)
