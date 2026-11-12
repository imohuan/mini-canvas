/**
 * connection/capability.ts —— 内容类型端口能力 + 输入容量判定（纯函数，零 Vue/DOM，Node 可单测）。
 *
 * 背景：端口"谁能连谁"不能按节点类型写死（多插件多节点类型）。做法是把端口能力抽成**内容类型声明**：
 *   输出口声明自己"产什么内容类型"；输入口声明"收哪些内容类型 + 容量几条"。
 *   判定 = 通用规则(方向/自连/环/重，由内核 validateConnection 负责) 之上再叠加：
 *     - 内容类型：源输出的 contentType 是否被目标输入 acceptsTypes 接受。
 *     - 容量：目标输入口当前入边数是否已达 capacity；满额但允许挤 → willEvict。
 *
 * 本模块**不关心具体节点类型**，只认"内容类型标签 + 容量数字"，语义全部由调用方(插件)声明的
 * capability 提供 → render/core 加任何新节点类型都不用改。
 *
 * 坐标系/输入：无坐标，纯逻辑判定。
 */

/** 内容类型：跨节点的"产出/可接收"语义标签（image/text/video/audio 为内置，可扩展字符串） */
export type ContentType = 'image' | 'text' | 'video' | 'audio' | (string & {})

/** 单个端口的内容类型能力声明 */
export interface PortContentCapability {
  /** 输出口产出的内容类型（连接时判定源用） */
  contentType?: ContentType
  /** 输入口接受的内容类型列表；缺省/空 = 不按内容类型限制(回落旧 accepts/人人可连) */
  acceptsTypes?: ContentType[]
  /** 输入口最多接几条入边；缺省 1。>1 允许多条；满额时(若允许)挤最老一条 */
  capacity?: number
  /** 容量满时是否允许"挤最老一条"再接新的；缺省 true。false = 满额直接拒(limit-reached) */
  evictOnFull?: boolean
}

/** 节点类型级内容类型声明：输出口产啥 / 输入口收啥 */
export interface NodeContentCapability {
  /** 输入口内容类型能力 */
  input?: PortContentCapability
  /** 输出口内容类型能力 */
  output?: PortContentCapability
}

/** 内容类型/容量判定结果（叠加在通用校验通过之后） */
export interface ContentDecision {
  /** 内容类型是否被目标输入接受 */
  typeAccepted: boolean
  /** 目标输入当前入边数 */
  incomingCount: number
  /** 是否已达容量上限 */
  full: boolean
  /** 满额但允许挤(evictOnFull) → 需要先挤最老再加；否则 full 时拒 */
  willEvict: boolean
}

/** 整条候选边在"内容类型 + 容量"维度能否连 */
export type ContentConnectResult =
  | { ok: true; reason: 'ok'; decision: ContentDecision }
  | { ok: false; reason: 'type-not-accepted' | 'limit-reached'; decision: ContentDecision }

/**
 * 内容类型接受判定：源输出 contentType 是否被目标输入 acceptsTypes 接受。
 * 双方都没声明内容类型 → 视为接受(回落旧"人人可连")。
 */
export function contentTypeAccepted(
  outputContentType: ContentType | undefined,
  inputAcceptsTypes: ContentType[] | undefined,
): boolean {
  // 源没声明产啥 → 无内容类型约束；目标没声明收啥 → 来者不拒。
  if (outputContentType === undefined) return true
  if (!inputAcceptsTypes || inputAcceptsTypes.length === 0) return true
  return inputAcceptsTypes.includes(outputContentType)
}

/**
 * 容量/挤出判定。
 * @param incomingCount 目标输入口当前入边数
 * @param capacity      该口容量上限（缺省视为 1）
 * @param evictOnFull   满额时是否允许挤最老（缺省 true）
 */
export function decideCapacity(
  incomingCount: number,
  capacity: number | undefined,
  evictOnFull: boolean | undefined,
): { full: boolean; willEvict: boolean } {
  const cap = capacity && capacity > 0 ? capacity : 1
  const full = incomingCount >= cap
  const willEvict = full && (evictOnFull ?? true)
  return { full, willEvict }
}

/**
 * 组合判定（内容类型 + 容量）。
 * 入参：源节点输出内容类型、目标节点输入能力、目标输入口当前入边数。
 * 通用规则(方向/自连/环/重)由调用方(内核 validateConnection)先跑，本函数只判内容类型与容量。
 */
export function evaluateContentConnect(input: {
  outputContentType?: ContentType
  inputCapability?: PortContentCapability
  incomingCount: number
}): ContentConnectResult {
  const cap = input.inputCapability
  const typeOk = contentTypeAccepted(input.outputContentType, cap?.acceptsTypes)
  const { full, willEvict } = decideCapacity(input.incomingCount, cap?.capacity, cap?.evictOnFull)

  // 满额且不允许挤 → 拒(limit-reached)
  if (full && !willEvict) {
    return {
      ok: false,
      reason: 'limit-reached',
      decision: { typeAccepted: typeOk, incomingCount: input.incomingCount, full, willEvict },
    }
  }
  // 内容类型不接受 → 拒
  if (!typeOk) {
    return {
      ok: false,
      reason: 'type-not-accepted',
      decision: { typeAccepted: typeOk, incomingCount: input.incomingCount, full, willEvict },
    }
  }
  // 通过（满额但可挤也算 ok，willEvict 提示 UI）
  return {
    ok: true,
    reason: 'ok',
    decision: { typeAccepted: typeOk, incomingCount: input.incomingCount, full, willEvict },
  }
}
