/**
 * testLogic —— 前端面板里**可单测的纯逻辑**（从 ShowcasePage 抽出，Node 环境可跑）。
 *
 * 抽出的动机：:id 真实取值链是附录 B.9 点名的坑（写死 id 一重启就 404），
 * 它的逻辑值得测试锁住；请求示例代码生成（在线文档的代码块）也一样。
 */

export interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
}

/** 端点执行时的默认请求体（与面板 runOne 的行为一致） */
export function defaultBody(method: string, path: string, now = new Date()): unknown {
  if (method === 'GET' || method === 'DELETE') return undefined
  if (path.includes('/echo')) return { hello: 'showcase', n: 1 }
  if (path.includes('/todos') && method === 'POST') return { title: '手动创建的一条 todo' }
  if (path.includes('/todos') && method === 'PUT') return { done: true }
  if (path.includes('store/notes/:key')) return { note: '写在插件私有存储里的值', at: now.toISOString() }
  if (path.includes('jobs/heartbeat') && method === 'POST') return { intervalMs: 1000 }
  return undefined
}

/**
 * :id / :key 解析（附录 B.9 真实取值链的第一步）：
 * 返回「占位替换需要的前置动作」描述；没有占位返回 null。
 */
export function placeholderOf(path: string): { kind: 'todo-id' | 'store-key' } | null {
  if (path.includes('todos/:id')) return { kind: 'todo-id' }
  if (path.includes('store/notes/:key')) return { kind: 'store-key' }
  return null
}

/** 在线文档的 fetch 示例代码块（与面板 codeOf 一致） */
export function codeOf(e: Endpoint): string {
  const body = defaultBody(e.method, e.path)
  return (
    'await fetch(' + JSON.stringify(e.path) + ', {' +
    (e.method === 'GET' ? '' : "\n  method: '" + e.method + "',") +
    (body !== undefined
      ? "\n  headers: { 'content-type': 'application/json' }," +
        "\n  body: JSON.stringify(" + JSON.stringify(body) + '),'
      : '') +
    '\n})'
  )
}
