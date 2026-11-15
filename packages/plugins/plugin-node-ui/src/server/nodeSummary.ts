/**
 * node-ui 后台：手册里的节点摘要（从 server.ts 原样迁出）。
 */
import type { NodeLike, ServerCtxLike } from './shared-types.js'
import { describeNodeDoc, nodeDocOf } from '../task/nodeDoc.js'

/**
 * 由请求自己的 Host 头推「这个请求是发给谁」的 origin。
 *
 * 与注入的 `selfOrigin` 的区别（2026-11-15 修跨域时理清）：
 *   - 注入的 `selfOrigin` 是**服务启动时**定死的（`http://127.0.0.1:端口`），不随页面访问方式变；
 *   - 这个函数按请求现算：用 localhost 打开就是 `http://localhost:端口`，
 *     走反代就是反代域名（`x-forwarded-proto` 决定 http/https）。
 * 同源判断应当以它为准 —— 否则「同一个服务换个主机名打开」会被误判成跨源。
 */
export function requestOrigin(c: ServerCtxLike): string {
  const host = c.req.header('host')
  if (!host) return ''
  const proto =
    c.req.header('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('[::1]') ? 'http' : 'https')
  return proto + '://' + host
}

export function selfOrigin(c: ServerCtxLike): string {
  const host = c.req.header('host')
  if (!host) return ''
  const proto =
    c.req.header('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return proto + '://' + host
}

/** 取节点的短描述（给手册里那句「这块画布上有什么」用） */

function describeNode(n: NodeLike): string {
  const d = n.data ?? {}
  const label = typeof d.label === 'string' && d.label ? ' "' + d.label + '"' : ''
  const bits: string[] = []
  for (const key of ['text', 'imageUrl', 'videoUrl', 'audioUrl']) {
    const v = d[key]
    if (typeof v !== 'string' || !v) continue
    bits.push(key + '=' + (v.length > 80 ? v.slice(0, 80) + '…' : v))
  }
  if (n.type === 'ui') bits.push('内容:' + (typeof d.uiHtml === 'string' && d.uiHtml ? '已画' : '还是空的'))
  const head = '- 节点 ' + n.id + '（' + n.type + '）' + label + (bits.length ? ' · ' + bits.join(' · ') : '')
  // 可视化节点把说明书摊在下一行（用户要的「每个可视化节点要有详细的功能描述」）：
  // 手册是 AI 了解这块画布的第一入口，说明书藏起来等于没写。
  const doc = n.type === 'ui' ? nodeDocOf(d) : undefined
  if (!doc) return head
  return head + '\n' + describeNodeDoc(doc).split('\n').map((l) => '    ' + l).join('\n')
}

/** 读某张画布的节点（默认画布优先用宿主那份有写锁的 doc） */

