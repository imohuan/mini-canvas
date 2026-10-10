// 文件：packages/docs/public/examples/canvas-data/connection/plugin-conn-demo/src/connRules.ts
// 格式：TypeScript 模块（纯逻辑小助手）
// 位置：把 doc 的当前状态组装成连接校验要的 ValidateContext

import { typeConnectionDef, validateConnection } from '@mini-canvas/canvas-data'
import type { ConnectionInput, DocService, ValidateContext, ValidationResult } from '@mini-canvas/canvas-data'

/**
 * 从 doc 现场组装校验上下文。
 *
 * 为什么这么写：validateConnection 是**纯函数** —— 它不碰任何实例，
 * 现存节点、现存边、类型声明都得由调用方喂进去。这样它才能在 Node 里被一条条测。
 */
export function contextFromDoc(doc: DocService): ValidateContext {
  return {
    nodes: new Map(doc.getNodes().map((n) => [n.id, { id: n.id, type: n.type }])),
    edges: doc.getEdges(),
    // 类型声明从 doc 的类型表反查 —— typeConnectionDef 负责“没声明就给 undefined”
    getTypeConn: (type) => typeConnectionDef(doc.types.get(type)),
  }
}

/** 校验一条候选连接；返回原样的 ValidationResult（含 canonical，供直接建边） */
export function checkEdge(doc: DocService, conn: ConnectionInput): ValidationResult {
  return validateConnection(conn, contextFromDoc(doc))
}

/** 原因码 → 人话（渲染层有一份更全的 reasonText；这里只演示映射思路） */
const TEXT: Record<string, string> = {
  'missing-node': '两端节点不存在',
  'self-loop': '不能连自己',
  'bad-orientation': '连接方向有误',
  'no-source-port': '源节点没有输出口',
  'no-target-port': '目标节点没有输入口',
  'type-not-accepted': '类型不匹配',
  'limit-reached': '已达连接上限',
  duplicate: '已存在同一条连线',
  cycle: '会形成环',
}

export function describe(result: ValidationResult): string {
  if (result.ok) return '可以连'
  return TEXT[result.reason] ?? result.reason
}

/** 从节点表里找两个不同类型的节点，方便演示“类型不匹配”是怎么被挡下的 */
export function findPair(doc: DocService, sourceType: string, targetType: string) {
  const nodes = doc.getNodes()
  return {
    source: nodes.find((n) => n.type === sourceType)?.id,
    target: nodes.find((n) => n.type === targetType)?.id,
  }
}

