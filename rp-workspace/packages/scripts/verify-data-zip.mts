// 一次性验证脚本：用真实 data zip 跑 analyzeDataZip，核对修复后的识别与统计
import { readFileSync } from 'node:fs'
import { analyzeDataZip } from '../src/import/data-zip.ts'

const zipPath = process.argv[2]
const buf = readFileSync(zipPath)

console.time('analyze')
const report = await analyzeDataZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), (s, d) => {
  if (s === 0) console.log(`[阶段${s}] ${d}`)
})
console.timeEnd('analyze')

console.log('rootPath:', report.rootPath || '(zip 根)')
console.log('stats:', JSON.stringify(report.stats, null, 2))
console.log('settings:', JSON.stringify(report.settings))
console.log('配对率:', report.relations.pairingRate + '%')
console.log('全局书单:', report.relations.globalSelectedBooks.length, '缺失', report.relations.globalSelectedMissing.length)
console.log('卡→书配对:', report.relations.cardWorldPairs.length, '缺失', report.relations.cardWorldMissing.length)
console.log('聊天归属:', report.relations.chatOwnerPairs.length, '孤儿目录', report.relations.chatOrphans.length)
console.log('复合卡 top3:', JSON.stringify(report.compositeCards.slice(0, 3).map(c => ({ n: c.name, book: c.embeddedBookEntries, regex: c.embeddedRegexCount })), null, 1))
console.log('warnings:', report.warnings.length, '条')
report.warnings.slice(0, 8).forEach(w => console.log('  ⚠', w))
