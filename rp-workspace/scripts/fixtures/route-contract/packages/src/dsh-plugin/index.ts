// 路由契约审计的**服务端样本**（正控用）：
//   · /rp/ok-post   在 POST 区
//   · /rp/only-get  只在 GET 区（应判违约）
//   · /rp/… 之外的其它路径一律"不存在"（应判违约）
export function fakeRouter(req: { method: string }, sub: string, send: (code: number, body: unknown) => unknown): unknown {
  if (req.method === 'GET') {
    if (sub === '/rp/only-get') { return send(200, { ok: true }) }
  }
  if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
  if (sub === '/rp/ok-post') { return send(200, { ok: true }) }
  return send(404, { error: 'unknown endpoint' })
}
