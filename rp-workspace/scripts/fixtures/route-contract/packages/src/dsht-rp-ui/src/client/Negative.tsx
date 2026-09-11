// 路由契约审计的**负向对照样本**（正控用；不参与产品构建，也不被审计脚本的 walk 扫到）
import { rpApi } from './rpc'

// ① 应违约：服务端没有这个路径（前缀不一致）—— 对应心跳 63C 的真实缺陷形态
export const negMissingPrefix = (): unknown => rpApi('sessions-audit')
// ② 应 OK：存在且挂在 POST 区
export const okPost = (): unknown => rpApi('rp/ok-post')
// ③ 应违约：只挂在 GET 区（心跳 46 的原始缺陷形态）
export const negGetOnly = (): unknown => rpApi('rp/only-get')
// ④ 应违约：服务端完全没有该路径
export const negAbsent = (): unknown => rpApi('rp/never-mounted')
