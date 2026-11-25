/**
 * MCP 工具的展示信息（下拉工具行与输入框标签共用）。
 *
 * 为什么单独拆一份：同一个工具会在两个地方出现 ——
 *   ① MCP 下拉展开后的工具行；
 *   ② 引用到输入框后的 `.ac-tag` 标签。
 * 两处必须显示同一张卡片（标题 / 描述 / 参数），所以数据整理也收在这里。
 */

export interface McpToolMeta {
  /** 工具名，例如 `canvas_get` */
  name: string
  /** 服务名，例如 `canvas` */
  server: string
  description: string
  /** SDK 全名，例如 `mcp__canvas__canvas_get` */
  fullName: string
  /** MCP 的 inputSchema（JSON Schema） */
  parameters?: Record<string, unknown>
}

export interface McpToolParamRow {
  name: string
  type: string
  required: boolean
  description: string
  defaultValue: string
  enumValues: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** JSON Schema 里常见的类型写法：type 字符串/数组、enum、const、oneOf/anyOf、items */
export function schemaTypeLabel(def: unknown): string {
  if (!isRecord(def)) return 'any'
  if (Array.isArray(def.enum) && def.enum.length) return def.enum.map((v) => String(v)).join(' | ')
  if (def.const !== undefined) return JSON.stringify(def.const)
  const type = def.type
  if (Array.isArray(type) && type.length) {
    return type.map((t) => schemaTypeLabel({ ...def, type: t, enum: undefined, const: undefined })).join(' | ')
  }
  if (typeof type === 'string') {
    if (type === 'array' && isRecord(def.items)) return schemaTypeLabel(def.items) + '[]'
    return type
  }
  for (const key of ['oneOf', 'anyOf']) {
    const list = def[key]
    if (Array.isArray(list) && list.length) {
      const labels = Array.from(new Set(list.map((v) => schemaTypeLabel(v))))
      return labels.join(' | ')
    }
  }
  if (isRecord(def.properties)) return 'object'
  if (def.items) return 'any[]'
  return 'any'
}

function defaultTextOf(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  try {
    const json = JSON.stringify(value)
    return json.length > 80 ? json.slice(0, 79) + '…' : json
  } catch {
    return String(value)
  }
}

/**
 * 把 MCP 的 inputSchema 摊平成卡片要显示的参数行。
 *
 * 只展开**第一层属性**：工具入参的嵌套结构通常很深，全铺开会把卡片撑成一大段
 * 没法读的 JSON。第一层够用户判断「这个工具要什么」，嵌套类型仍会以 `object` /
 * `array` 标出来。
 */
export function mcpToolParamRows(parameters?: Record<string, unknown> | null): McpToolParamRow[] {
  if (!isRecord(parameters)) return []
  const properties = isRecord(parameters.properties) ? parameters.properties : null
  if (!properties) return []
  const required = new Set(
    Array.isArray(parameters.required)
      ? parameters.required.filter((v): v is string => typeof v === 'string')
      : [],
  )
  return Object.entries(properties).map(([name, raw]) => {
    const def = isRecord(raw) ? raw : {}
    return {
      name,
      type: schemaTypeLabel(def),
      required: required.has(name),
      description: textOf(def.description),
      defaultValue: defaultTextOf(def.default),
      enumValues: Array.isArray(def.enum)
        ? def.enum.filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean').map((v) => String(v))
        : [],
    }
  })
}

/** 从探测行补全服务名（服务端已经给 server，缺失时才拆 fullName） */
export function mcpToolMetaOfRow(
  row: { name?: string; server?: string; description?: string; fullName?: string; parameters?: Record<string, unknown> },
): McpToolMeta {
  const fullName = String(row.fullName ?? '')
  const parsed = fullName.match(/^mcp__(.+?)__(.+)$/)
  return {
    name: String(row.name ?? parsed?.[2] ?? ''),
    server: String(row.server ?? parsed?.[1] ?? ''),
    description: String(row.description ?? ''),
    fullName,
    ...(row.parameters && typeof row.parameters === 'object' ? { parameters: row.parameters } : {}),
  }
}

function splitMcpFullName(fullName: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(fullName)
  if (!match) return null
  return { server: match[1], tool: match[2] }
}

/**
 * 从标签 DOM 的 data-* 属性认出「这是哪个 MCP 工具」。
 *
 * 为什么从 DOM 认、不在插入时挂回调：输入框里的标签会在刷新 / 回填时
 * 由 ProseMirror 重新创建（可能只剩最小条目），插回调会随 DOM 一起丢。
 * data-id / data-ref-value 会写进文档，重新渲染后仍在。
 */
export function mcpToolFullNameOfChip(attrs: {
  id?: string | null
  refKind?: string | null
  refValue?: string | null
  name?: string | null
}): string | null {
  const id = String(attrs.id ?? '')
  if (id.startsWith('mcp-tool:mcp__')) return id.slice('mcp-tool:'.length)
  const refValue = String(attrs.refValue ?? '')
  const isMcp = String(attrs.refKind ?? '') === 'mcp' || id.startsWith('mcp-tool:')
  if (isMcp && refValue.startsWith('mcp__')) return refValue
  const name = String(attrs.name ?? '').trim()
  const dot = name.indexOf('.')
  // 「服务.工具」只在确实标明是 MCP 时才拆：资产名也可能带点号（「素材 v1.2」）。
  if (!isMcp) return null
  if (dot > 0 && dot < name.length - 1) return 'mcp__' + name.slice(0, dot) + '__' + name.slice(dot + 1)
  return null
}

/** 只有全名、没有探测数据时的最小卡片内容（标签仍能显示服务、工具名） */
export function mcpToolMetaFallback(fullName: string, description = ''): McpToolMeta | null {
  const parts = splitMcpFullName(fullName)
  if (!parts) return null
  return { name: parts.tool, server: parts.server, description, fullName }
}
