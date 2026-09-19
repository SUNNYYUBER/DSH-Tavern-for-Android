# -*- coding: utf-8 -*-
"""
角色卡消毒器 (card-disinfector.py)
=================================
用途：清除角色卡 / 聊天记录中作者埋的"防盗版陷阱"——
即强制模型每轮在回复结尾输出侮辱性 HTML 公告的恶意世界书条目，
以及已经混入聊天记录里的彩蛋块残留。

清理策略（特征码检测，不依赖条目名，作者改名/更新也有效）：
1. 角色卡世界书条目：content 含"强制每轮输出"特征指令 → 清空 content 并禁用条目
2. 开场白 / 聊天消息：删除含侮辱/彩蛋词的 <Tag>...</Tag> HTML 块

用法（三选一）：
  python card-disinfector.py 角色卡.json
  python card-disinfector.py 聊天记录.jsonl
  python card-disinfector.py 卡.json 聊天.jsonl   （可一次传多个文件）
也可以直接把文件拖到本脚本图标上。

所有修改前自动生成带时间戳的 .bak-备份，原文件永不丢失。
"""
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

# 强制输出特征：命中任意一条即判定为陷阱条目（正文清空+禁用）
INJECTION_PATTERNS = [
    re.compile(r'必须做到[：:]\s*每轮回复'),
    re.compile(r'任何情况下都不可省略'),
    re.compile(r'一次都不能少'),
    re.compile(r'原样输出\s*<[A-Za-z]\w*>\s*标签内的全部内容'),
    re.compile(r'该结尾是每轮回复的必要组成部分'),
]

# 彩蛋/侮辱内容特征词：HTML 块内命中任意一词即整块删除
EVIL_WORDS = [
    '哥布林', '摸草', '别玩卡', '死妈', '死绝', '盗卡', '卖卡',
    '叮咚鸡', '好想玩原神', '云☁️原神', '你不是同类',
]

# 匹配 <Tag> ... </Tag> 整块（Tag 为大写开头的字母数字下划线）
HTML_BLOCK_RE = re.compile(r'<([A-Za-z][A-Za-z0-9_]*)>.*?</\1>', re.S)

# 块删除后残留的连续空行压缩
BLANK_RUN_RE = re.compile(r'\n{3,}')


def block_is_evil(block: str) -> bool:
    """判断一个 HTML 块是否为彩蛋/侮辱内容"""
    return any(w in block for w in EVIL_WORDS)


def strip_evil_blocks(text: str):
    """从文本中删除所有含彩蛋词的 HTML 块，返回 (新文本, 删除块数, 删除字符数)"""
    removed = 0
    removed_chars = 0
    def _sub(m):
        nonlocal removed, removed_chars
        if block_is_evil(m.group(0)):
            removed += 1
            removed_chars += len(m.group(0))
            return '\n'
        return m.group(0)
    new = HTML_BLOCK_RE.sub(_sub, text)
    new = BLANK_RUN_RE.sub('\n\n', new)
    return new, removed, removed_chars


def content_is_injection(content: str) -> bool:
    """判断世界书条目正文是否为强制输出型陷阱"""
    return any(p.search(content) for p in INJECTION_PATTERNS)


def clean_character_card(path: Path):
    """清理角色卡 .json：世界书陷阱条目 + 开场白彩蛋块"""
    raw = path.read_text(encoding='utf-8')
    obj = json.loads(raw)
    log = []

    # 兼容两种结构：data.character_book.entries 与顶层 character_book.entries
    book = obj.get('data', {}).get('character_book') or obj.get('character_book')
    entries = book.get('entries', []) if book else []
    for i, e in enumerate(entries):
        content = e.get('content') or ''
        if content and content_is_injection(content):
            name = e.get('comment') or f'(未命名 #{i})'
            log.append(f'  [条目] 「{name}」 清空 {len(content)} 字符陷阱正文，并禁用条目')
            e['content'] = ''
            e['enabled'] = False

    # 开场白（first_mes 与 alternate_greetings）里可能残留彩蛋块
    data = obj.get('data', obj)
    for field, val in list(data.items()):
        if field in ('first_mes',) and isinstance(val, str):
            new, n, c = strip_evil_blocks(val)
            if n:
                data[field] = new
                log.append(f'  [开场白] first_mes 删除 {n} 个彩蛋块（{c} 字符）')
        if field == 'alternate_greetings' and isinstance(val, list):
            for j, g in enumerate(val):
                if isinstance(g, str):
                    new, n, c = strip_evil_blocks(g)
                    if n:
                        val[j] = new
                        log.append(f'  [开场白] alternate_greetings[{j}] 删除 {n} 个彩蛋块（{c} 字符）')

    return obj, log


def clean_chat_file(path: Path):
    """清理聊天记录 .jsonl：删除所有消息（mes/swipes）中的彩蛋块"""
    lines = path.read_text(encoding='utf-8').split('\n')
    log = []
    total_removed = 0

    for i, ln in enumerate(lines):
        if not ln.strip():
            continue
        try:
            msg = json.loads(ln)
        except json.JSONDecodeError:
            continue  # 非消息行（如首行 metadata 之外的异常行）跳过

        changed = False
        # 首行是聊天元数据，跳过块删除（其中不会有彩蛋块，isPostScript 等变量字段不受影响）
        if 'chat_metadata' not in msg:
            for field in ('mes',):
                v = msg.get(field)
                if isinstance(v, str) and '<' in v:
                    new, n, c = strip_evil_blocks(v)
                    if n:
                        msg[field] = new
                        total_removed += c
                        changed = True
                        log.append(f'  行{i} mes 删除 {n} 个彩蛋块（{c} 字符）')
            swipes = msg.get('swipes')
            if isinstance(swipes, list):
                for j, s in enumerate(swipes):
                    if isinstance(s, str) and '<' in s:
                        new, n, c = strip_evil_blocks(s)
                        if n:
                            swipes[j] = new
                            total_removed += c
                            changed = True
                            log.append(f'  行{i} swipe[{j}] 删除 {n} 个彩蛋块（{c} 字符）')

            if changed:
                lines[i] = json.dumps(msg, ensure_ascii=False, separators=(',', ':'))

    return '\n'.join(lines), log, total_removed


def backup(path: Path) -> Path:
    """生成带时间戳的备份，避免覆盖更早的干净备份"""
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = path.with_name(path.name + f'.bak-{stamp}')
    shutil.copy2(path, bak)
    return bak


def process(path: Path):
    print(f'\n=== 处理: {path.name} ===')
    if not path.exists():
        print('  文件不存在，跳过')
        return

    if path.suffix.lower() == '.json':
        obj, log = clean_character_card(path)
        if not log:
            print('  未发现陷阱内容，无需处理')
            return
        bak = backup(path)
        json.dump(obj, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        # 写回后自检：确认能正常解析
        json.loads(path.read_text(encoding='utf-8'))
        print(f'  已备份原文件 -> {bak.name}')
        for line in log:
            print(line)
        print('  清理完成，JSON 完整性校验通过')

    elif path.suffix.lower() == '.jsonl':
        new_text, log, _ = clean_chat_file(path)
        if not log:
            print('  未发现彩蛋块残留，无需处理')
            return
        bak = backup(path)
        path.write_text(new_text, encoding='utf-8', newline='')
        print(f'  已备份原文件 -> {bak.name}')
        for line in log:
            print(line)
        print('  清理完成')

    else:
        print('  不认识的文件类型（只支持 .json 角色卡 / .jsonl 聊天记录），跳过')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    args = [a for a in sys.argv[1:] if a.strip()]
    if not args:
        print(__doc__)
        print('示例: python card-disinfector.py "ExampleCard MVU Edition.json"')
        return
    for a in args:
        process(Path(a))
    print('\n全部处理完毕。')


if __name__ == '__main__':
    main()
