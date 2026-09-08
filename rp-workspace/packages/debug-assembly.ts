import { emptyPreset, compileSlots } from './src/preset/schema.ts'
import { assemble } from './src/assembly/pipeline.ts'
import { triggerWorldInfo } from './src/lore/trigger.ts'
import { WI_POSITION, type LoreEntry } from './src/lore/entry.ts'

const preset = emptyPreset('demo', '直答演示')
preset.slots.find(s => s.id === 'main')!.content = '你是角色扮演引擎。'
const slots = compileSlots(preset)

const lore: LoreEntry[] = [{
  id: 'loc', comment: '咖啡厅', content: '咖啡厅位于商店街尽头。',
  keys: ['咖啡厅'], secondaryKeys: [], selectiveLogic: 0, constant: false, selective: false,
  position: WI_POSITION.BEFORE, depth: 4, role: 'system', scanDepth: null,
  preventRecursion: false, excludeRecursion: false, insertionOrder: 100,
  enabled: true, book: 'demo',
}]
const wi = triggerWorldInfo(lore, ['我推门走进咖啡厅'])
console.log('WI activated:', wi.activated.map(a => `${a.entry.comment}(${a.reason})`))

const state = { stat_data: { 当前时间: '傍晚' } }
const r = assemble(
  slots,
  {
    name: '丰川祥子', description: '丰川祥子的角色描述。', personality: '认真，温柔。',
    scenario: '在咖啡厅的偶遇。', personaDescription: '旅行者是路过的乐手。',
  },
  wi.activated,
  [
    { role: 'user', content: '消息 0：内容内容内容' },
    { role: 'assistant', content: '消息 1：内容内容内容' },
    { role: 'user', content: '消息 2：内容内容内容' },
    { role: 'assistant', content: '消息 3：内容内容内容' },
  ],
  state,
  [],
  { user: '旅行者', char: '丰川祥子', stableSeed: 's1', getState: p => state },
  { maxContextTokens: 8000, reserveReplyTokens: 1024 },
)

console.log('\n=== messages ===')
r.messages.forEach((m, i) => console.log(`[${i}] (${m.role}) ${m.content.slice(0, 60).replace(/\n/g, '\\n')}`))
console.log('\n=== trace ===')
console.log('activated:', r.trace.activatedEntries)
console.log('tokens:', r.trace.tokenEstimate)
