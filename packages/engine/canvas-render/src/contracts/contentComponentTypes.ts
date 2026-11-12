/**
 * contentComponentTypes —— 节点 content/toolbar 段组件的类型化契约（C 项收口）。
 *
 * 背景（全量审查 P0-4 / C 项）：content 组件经 BaseNode 壳的段路由渲染，BaseNode 给每段统一注入
 * `:id` 与 `:data` props（见 theme-default BaseNode.vue 模板）。早期组件误以为能在根 Context 上直读
 * ctx.xxx 服务（根 Context 无插件属性 Proxy），已改为 ctx.get('服务名')。本文件把这些 props 形状收口成
 * 可复用类型，插件 content 组件声明 props 时直接引用，避免各包手写漂移。
 *
 * 纯类型、零运行时、零 Vue import（保持 Node 单测不拉运行时）；import type 自 vue 的 Component。
 */
import type { Component } from 'vue'

/** 段组件从 BaseNode 壳收到的节点数据载荷（浅读 data；写操作请经服务如 ctx.get('text').editText 完成） */
export interface SegmentNodeData {
  /** 任意业务数据（imageUrl/text/parentId 等） */
  [key: string]: unknown
  /** 通用标题字段（BaseNode 就地改名写回 data.label） */
  label?: string
}

/** content/段组件 props（BaseNode 注入形状；组件按需声明子集） */
export interface SegmentContentProps {
  /** 节点 id（写回服务 / 路由判定用；text content 编辑必需） */
  id: string
  /** 节点数据（响应式对象引用；只读展示，改动请走服务） */
  data: SegmentNodeData
}

/**
 * 段组件最小形状（BaseNode 段路由 <component :is> 消费；Content 组件作者声明满足该形状即可被渲染）。
 * 用宽松的对象签名而非 Component 全量类型——避免要求插件包 import Vue 运行时。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SegmentComponent = Component<any> | Record<string, unknown>

/** content 段组件引用（随插件 nodes.register({content}) / nodes.contribute 注册进 nodeRegistry） */
export type ContentComponent = SegmentComponent





