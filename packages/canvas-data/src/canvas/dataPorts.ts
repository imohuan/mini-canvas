/**
 * dataPorts —— 节点数据契约（produces / consumes）的类型与校验。
 *
 * 纯逻辑、零 Vue：
 * - 节点类型声明“我对外产出什么、从上游读什么”；
 * - 三个字段 refField / valueField / externalUrlField 恰好给一个；
 * - refField 指向持久资源引用（resourceId），不允许把 URL 当引用。
 *
 * 当前只做“类型 + 校验 + 投影”；真正的读取统一走 upstream 能力（见 upstreamGraph.ts）。
 */

/** 一个数据槽的声明 */
export interface DataPortDef {
  /** 内容类型（与 PortDef.contentType/acceptsTypes 同词表） */
  kind: string
  /** 资源持久引用字段（节点数据只存 ID）；与 valueField/externalUrlField 三选一 */
  refField?: string
  /** 非资源的普通值字段（如 text）；与 refField/externalUrlField 三选一 */
  valueField?: string
  /** 仅无资源实体的外部地址才声明；与 refField/valueField 互斥 */
  externalUrlField?: string
  /** 消费方是否必须拿到；缺了显示空态 */
  required?: boolean
}

/** 节点类型的数据声明 */
export interface NodeDataTypeDef {
  /** 本节点对外提供的数据，按槽名 */
  produces?: Record<string, DataPortDef>
  /** 本节点读取上游的数据，按槽名 */
  consumes?: Record<string, DataPortDef>
}

/** 声明错误（注册时抛出，带槽名与原因） */
export class DataPortError extends Error {
  constructor(message: string) {
    super('[data-port] ' + message)
    this.name = 'DataPortError'
  }
}

/** 检查一个槽恰好声明了 refField / valueField / externalUrlField 之一 */
export function assertDataPortDef(slot: string, def: DataPortDef): DataPortDef {
  if (!def || typeof def !== 'object') throw new DataPortError(`槽 "${slot}" 的声明不是对象`)
  if (typeof def.kind !== 'string' || def.kind.trim() === '') {
    throw new DataPortError(`槽 "${slot}" 缺少 kind`)
  }
  const fields = [def.refField, def.valueField, def.externalUrlField].filter(
    (v): v is string => typeof v === 'string' && v !== '',
  )
  if (fields.length !== 1) {
    throw new DataPortError(
      `槽 "${slot}" 必须且只能声明 refField / valueField / externalUrlField 之一（当前 ${fields.length} 个）`,
    )
  }
  return def
}

/** 校验整张 produces/consumes 表；返回原对象（链式用） */
export function assertDataPorts(
  which: 'produces' | 'consumes',
  ports: Record<string, DataPortDef> | undefined,
): Record<string, DataPortDef> | undefined {
  if (!ports) return undefined
  for (const [slot, def] of Object.entries(ports)) assertDataPortDef(`${which}.${slot}`, def)
  return ports
}

/** 从节点 data 投影出一个槽的值；id 缺失返回 undefined */
export function readDataPort(
  node: { type?: string; data?: Record<string, unknown> },
  def: DataPortDef,
): unknown {
  const data = node.data ?? {}
  if (def.refField) return data[def.refField]
  if (def.valueField) return data[def.valueField]
  if (def.externalUrlField) return data[def.externalUrlField]
  return undefined
}

/** 该值是不是逻辑资源引用（不是 URL / blob / data） */
export function isResourceRefValue(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !/^(https?:|blob:|data:)/i.test(value)
}
