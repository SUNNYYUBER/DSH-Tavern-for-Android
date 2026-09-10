const PORT='9333'
const t=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const p=t.find(x=>x.type==='page')
const ws=new WebSocket(p.webSocketDebuggerUrl)
let s=0;const m=new Map()
const send=(me,pa={})=>new Promise((r,j)=>{const i=++s;m.set(i,{r,j});ws.send(JSON.stringify({id:i,method:me,params:pa}))})
ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id&&m.has(d.id)){const q=m.get(d.id);m.delete(d.id);d.error?q.j(new Error(JSON.stringify(d.error))):q.r(d.result)}})
await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j)})
await send('Runtime.enable')
const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true})).result?.value
console.log(await ev(`JSON.stringify({
  rollback: document.body.innerHTML.includes('回退到此处'),
  edit: document.body.innerHTML.includes('编辑'),
  regen: document.body.innerHTML.includes('重新生成'),
  undoRoutes: performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('dsht-undo')).length,
  loadedPlugins: [...document.querySelectorAll('script')].map(s=>s.src).filter(Boolean).length,
})`))
ws.close()
