/**
 * instanceDom —— 画布实例级 DOM 查询。
 *
 * 一个页面可以同时挂多个画布实例；节点 DOM 的 data-id 只在本实例内唯一。
 * 查询必须从本实例的根元素出发，不能退回 document.querySelector，否则双画布会互相串线。
 */

/** 在指定画布根内按节点 id 找节点 DOM；根未挂载时返回 null。 */
export function queryNodeElIn(
  root: ParentNode | null | undefined,
  nodeId: string,
): HTMLElement | null {
  if (!root) return null
  return root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${nodeId}"]`)
}
