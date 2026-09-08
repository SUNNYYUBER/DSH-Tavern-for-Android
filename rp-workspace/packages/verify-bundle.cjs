// bundle 验证：直接 require 不可用（IIFE），用 Function 构造器模拟浏览器全局
const fs = require('fs')
const code = fs.readFileSync('../android/app/src/main/assets/import-center/app.js', 'utf8')
const mod = new Function('window', 'TextDecoder', 'TextEncoder', 'atob', code + '\nreturn DSHT')
const DSHT = mod(global, TextDecoder, TextEncoder, (b64) => Buffer.from(b64, 'base64').toString('binary'))

console.log('DSHT 全局键:', Object.keys(DSHT).join(', '))

// 复合卡
const png = fs.readFileSync('D:/SillyTavern-1.16.0/SillyTavern（now using）/SillyTavern-1.16.0/.Luker-现在在用的版本/data/default-user/characters/ExampleGame ExampleWorld MVU Edition 0607.png')
const card = DSHT.importCharacterPng(new Uint8Array(png), 'wuwa')
const bundle = DSHT.summarizeBundle(card)
console.log('复合卡:', bundle.manifest.character, '| 内嵌书:', bundle.manifest.embeddedBook.entryCount, '条 | 正则:', bundle.manifest.embeddedRegexCount)

// 世界书 + 触发器
const wb = JSON.parse(fs.readFileSync('D:/SillyTavern-1.16.0/SillyTavern（now using）/SillyTavern-1.16.0/.Luker-现在在用的版本/data/default-user/worlds/ExampleGame World Info MVU 0607.json', 'utf8'))
const book = DSHT.importLoreBook('ExampleGame', wb)
const trig = DSHT.triggerWorldInfo(book.entries, ['今州城 守岸人 出现'], { matchWholeWords: false })
console.log('世界书:', book.entries.length, '条 | 触发:', trig.activated.length, '个激活 |', trig.recursionRounds, '轮递归')
console.log('OK bundle 验证通过（引擎在无 Node API 环境下可运行 = WebView 兼容）')
