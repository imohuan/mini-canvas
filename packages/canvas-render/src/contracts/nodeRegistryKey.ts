/**
 * nodeRegistryKey —— 节点注册表 / 节点数据写回 注入令牌（Vue provide/inject 用）。
 *
 * 放在 kernel 的组件层(src/components，非 core)：因为 BaseNode(壳) 与宿主(CanvasDemo)
 * 都要用它来跨层传 NodeRegistry，令牌归壳组件所有、宿主 import 即可，不反向依赖 demo-web。
 * 仅 type 级 import vue，不把 vue 运行时拉进 Node 单测路径。
 */
import type { InjectionKey } from 'vue'
import type { NodeRegistry } from '@mini-canvas/canvas-core-v2'

export const NODE_REGISTRY_KEY: InjectionKey<NodeRegistry> = Symbol('canvas-v2-node-registry')

/**
 * 节点数据写回回调：宿主注入后，BaseNode 内的就地编辑(如标题重命名)才能把改动写回
 * 内核(经宿主桥接 ctx/nodeStore)并落盘。宿主不注入则节点仅展示、不可编辑（安全降级）。
 *
 * patch 语义：
 * - 普通 key → 写进 node.data（标题/文本内容等）；
 * - 保留 key `size` → 写进 nodeStore 的**正式尺寸字段** node.size（不塞进 data）。
 *
 * 为什么 size 要走这里（用户反馈 + 审查结论）：卡片 resize 原先只写 data.cardWidth/cardHeight，
 * 漏掉 node.size，于是"同一尺寸存两份、正式字段恒空"；布局回退链（实测 > size > 类型默认）断在中间，
 * 一旦实测链路异常就按类型默认尺寸错算。让两者在同一个 patch 里更新，可保证只产生一条撤销记录。
 */
export type NodeWritePatch = Record<string, unknown> & { size?: { w: number; h: number } }
export type NodeWrite = (id: string, patch: NodeWritePatch) => void

export const NODE_WRITE_KEY: InjectionKey<NodeWrite> = Symbol('canvas-v2-node-write')
