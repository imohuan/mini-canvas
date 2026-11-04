/**
 * refClickEvents —— 「引用标签被点了」这条**系统事件**的名字与载荷（唯一一份）。
 *
 * 为什么要一条事件、而不是一条服务（用户口径 2026-10-08）：
 *   输入框里的标签被点，最终要干的事（打开资产预览 / 打开资产管理）**属于成品应用**，
 *   而发出这个动作的是 Agent 插件。此前用 `ctx.tryGet('asset-ui')` 的服务通道：
 *   两边被一个**服务名**绑在一起，还有先后顺序的隐式要求（服务必须比消费方先注入）。
 *   改成事件之后，三方**互不认识**：
 *     ① 输入框组件只管「有一个资源节点被点了」，抛出它（不 import 任何人）；
 *     ② 本插件（Agent）把它转成一条系统事件；
 *     ③ 谁想响应谁 ctx.on 监听（应用层在这里打开预览 / 资产管理）。
 *   少一边监听也不报错（事件是广播，不是调用）。
 *
 * 名字前缀 `agent:` 表示**由 agent 插件发出**；登记进 EventBus 白名单，dev 下不 warn
 *（见 kernel 的 registerEventName 与设计文档 §7.4）。
 */
import { registerEventName } from '@mini-canvas/canvas-base'

/** 事件名（消费方 import 它来监听，不自己拼字符串） */
export const REF_CLICK_EVENT = 'agent:ref-click'

// 模块加载时登记：dev 下 emit 未登记的事件名会 warn（每个名字只提示一次）。
registerEventName(REF_CLICK_EVENT)

/**
 * 载荷：一条被点击的引用**自带的字段**（与 `<ref … />` 一一对应，不额外翻译）。
 *
 * 消费方按 type 分流（当前只有 asset 需要应用层动手）：
 *   type=asset + ext     → 单个文件（打开预览）
 *   type=asset + folderId（无 ext）→ 资产库文件夹（打开资产管理并展开到那一层）
 *   type=node + nodeId   → 画布节点（Agent 自己已聚焦，应用层通常不用管）
 */
export interface RefClickPayload {
  type: string
  name: string
  /** 本机绝对路径（资产文件 / 技能的说明书 / 文件夹的公共目录） */
  path?: string
  /** 资产扩展名；**目录没有它** */
  ext?: string
  /** 资产库文件夹 id */
  folderId?: string
  /** 画布节点 id */
  nodeId?: string
}

/** 任意「带了引用字段」的东西（输入框 item 的 ref / 气泡里的段）→ 事件载荷 */
export interface RefClickSource {
  refType?: string
  name?: string
  path?: string
  ext?: string
  folderId?: string
  nodeId?: string
}

/**
 * 组装载荷；认不出种类（没带引用字段的普通标签）返回 null —— 调用方据此不发事件。
 * 纯函数，可单测（事件名与字段口径错在浏览器里很难看出来）。
 */
export function refClickPayloadOf(src: RefClickSource): RefClickPayload | null {
  const type = (src.refType ?? '').toLowerCase()
  if (!type) return null
  return {
    type,
    name: src.name ?? '',
    ...(src.path ? { path: src.path } : {}),
    ...(src.ext ? { ext: src.ext } : {}),
    ...(src.folderId ? { folderId: src.folderId } : {}),
    ...(src.nodeId ? { nodeId: src.nodeId } : {}),
  }
}
