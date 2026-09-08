import { extractCardJsonFromPng } from './src/import/character-card.ts'

// 手工构造最小 PNG + char tEXt
const json = JSON.stringify({ data: { name: '测试角色' } })
const jsonBytes = new TextEncoder().encode(json)
let bin = ''
for (const b of jsonBytes) bin += String.fromCharCode(b)
const b64 = btoa(bin)
console.log('b64 长度:', b64.length)

const textData = new Uint8Array(5 + b64.length)
textData.set(new TextEncoder().encode('char'), 0)
textData[4] = 0
textData.set(new TextEncoder().encode(b64), 5)

const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// 简单 chunk 组装（跳过 CRC——解析器不校验 CRC）
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  return out
}

const ihdr = new Uint8Array(13)
const png = new Uint8Array(sig.length + 25 + 12 + textData.length + 12)
let pos = 0
png.set(sig, pos); pos += sig.length
const ihdrChunk = chunk('IHDR', ihdr)
png.set(ihdrChunk, pos); pos += ihdrChunk.length
const textChunk = chunk('tEXt', textData)
png.set(textChunk, pos); pos += textChunk.length
const iendChunk = chunk('IEND', new Uint8Array(0))
png.set(iendChunk, pos); pos += iendChunk.length

console.log('PNG 总长:', png.length)
const extracted = extractCardJsonFromPng(png)
console.log('解出 JSON:', extracted)
console.log(extracted === json ? '✅ 匹配' : '❌ 不匹配')
