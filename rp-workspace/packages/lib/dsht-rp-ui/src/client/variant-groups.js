/**
 * swipe 变体组前端归一化（批次修复 3）。
 *
 * 问题（真机实测）：后端 variant/switch 每切一次就 append 一条 replace 事件，
 * collectVariantGroups 把它当新变体入组——左右滑几次 members 一路涨（2/2→3/3→4/4…），
 * 计数不断叠加。
 *
 * 归一化语义（swipe 的用户可见语义 = 「同一位置上 N 个不同文本选其一」）：
 * - members 按文本去重（保留首次出现的 seq——它是真实组员 seq，variant/switch
 *   的 targetSeq 直接可用；文本完全相同的变体对用户本就不可区分）；
 * - activeSeq 映射为与原始 active 同文本的去重代表 seq；
 * - memberSeqs 保留全部原始组员 seq（含被去重的）：surface 上的 assistant 消息
 *   可能是最新 replace 事件，其 seq 若被去重掉会丢组匹配——groupOf 用它判归属。
 * 纯函数零依赖（单测见 tests/variant-groups.spec.ts）。
 */
/**
 * 变体组归一化：按文本去重 + active 归位。
 * - 同文本成员合并到首次出现者；active 落在同文本代表上；
 * - active 文本不在 members（防御：后端数据残缺）时归位到最后一个成员。
 */
export function normalizeVariantGroups(raw) {
    return raw.map(g => {
        const members = [];
        for (const m of g.members) {
            if (!members.some(x => x.text === m.text))
                members.push({ seq: m.seq, text: m.text });
        }
        const activeText = g.members.find(m => m.seq === g.activeSeq)?.text;
        // 注意不能用 (cond && find()) ?? fallback：&& 短路产出 false，?? 只对 nullish 回退
        const rep = activeText !== undefined ? members.find(m => m.text === activeText) : undefined;
        const activeRep = rep ?? members[members.length - 1];
        return {
            members,
            activeSeq: activeRep?.seq ?? g.activeSeq,
            memberSeqs: g.members.map(m => m.seq),
        };
    });
}
/** 找包含 seq 的组（任一原始组员 seq 命中即归属——切换/去重事件都是组员） */
export function groupOf(groups, seq) {
    return groups.find(g => g.memberSeqs.includes(seq) || g.activeSeq === seq);
}
