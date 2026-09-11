#!/usr/bin/env python3
"""核验 APK 内 assets/dsh-runtime.zip 里的插件产物是否含本轮标记（解码两种 esbuild 转义形态）。"""
import io
import re
import sys
import zipfile

apk = sys.argv[1] if len(sys.argv) > 1 else 'DSH-Tavern-0.2.0-arm64-release.apk'
needles = sys.argv[2:] or ['assistantSettlement', 'dd.stream = []']

with zipfile.ZipFile(apk) as z:
    inner = z.read('assets/dsh-runtime.zip')
print(f'runtime.zip: {len(inner)} B')
with zipfile.ZipFile(io.BytesIO(inner)) as rz:
    target = [n for n in rz.namelist() if n.endswith('dsht-rp-plugin/lib/index.js')]
    if not target:
        print('MISS dsht-rp-plugin/lib/index.js')
        sys.exit(1)
    raw = rz.read(target[0]).decode('utf-8', 'replace')
print(f'{target[0]}: {len(raw)} B')

# 形态① \\uXXXX
dec = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), raw)
# 形态② 给每个 CJK 字符加反斜杠
dec = re.sub(r'\\([\u4e00-\u9fff\uff00-\uffef\u3000-\u303f])', r'\1', dec)

bad = 0
for n in needles:
    c = dec.count(n)
    ok = c > 0
    bad += 0 if ok else 1
    print(f'  {"OK  " if ok else "MISS"} {n!r} x {c}')
sys.exit(1 if bad else 0)
