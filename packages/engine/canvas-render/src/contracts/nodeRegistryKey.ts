/**
 * nodeRegistryKey —— 节点数据写回回调的**类型**契约。
 *
 * 旧的 NODE_REGISTRY_KEY / NODE_WRITE_KEY 注入令牌已删除：渲染子树统一经
 * useCanvasRender() 单令牌取 registry/nodeWrite（见 contracts/renderContext.ts）。
 * 本文件只保留 NodeWrite 形状，供宿主构造写回回调与消费方标注类型。
 */

/**
 * 节点数据写回回调：宿主注入后，BaseNode 内的就地编辑(如标题重命名)才能把改动写回
 * 内核(经宿主桥接 ctx/nodeStore)并落盘。宿主不注入则节点仅展示、不可编辑（安全降级）。
 *
 * patch 语义：
 * - 普通 key → 写进 node.data（标题/文本内容等）；
 * - 保留 key `size` → 写进 nodeStore 的**正式尺寸字段** node.size（不塞进 data）。
 *
 * 为什么 size 要走这里：卡片 resize 必须落到唯一的正式尺寸字段 node.size 上。
 * 曾经把尺寸另存一份到 data.cardWidth/cardHeight，结果两份各说各话（2026-11-14 已删除镜像）。
 */
export type NodeWritePatch = Record<string, unknown> & { size?: { w: number; h: number } }
export type NodeWrite = (id: string, patch: NodeWritePatch) => void
