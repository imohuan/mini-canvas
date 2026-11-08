import type { EditorView } from 'prosemirror-view'
import type { ResourceItem } from '../types'
import { chipRenderSig, chipSignature, itemRegistry } from './chipRegistry'
import { applyThumbByIds, chipAttrsNeedUpdate } from './resourceNode'
import { mySchema } from './schema'

/**
 * 找到正文里 id 相同的资源标签并**原地替换**它的样子（url / name / 状态）。
 *
 * 为什么需要它：底栏的「待输入」槽位填好内容后，正文里那个标签要立刻从虚线变实线、
 * 显示缩略图/新名字 —— 删了重插会丢光标位置，而且用户的正文顺序会跳（标签会跑到文末）。
 * 只在文档里那个节点存在时改属性，不碰选区。
 *
 * @returns 找到并替换了 → true；正文里没有这个 id → false（调用方自行决定要不要插入）
 */
export function replaceResource(view: EditorView | null, item: ResourceItem): boolean {
  if (!view) return false
  const nodeType = mySchema.nodes.resource
  if (!nodeType) return false
  /**
   * 换绑（用户 2026-10-28：替换插槽内容时，正文里的标签名称要跟着换成新节点）。
   *
   * `previousId` 给了且与新 id 不同 → 找旧身份那颗标签，**整颗换成新身份**。
   * 为什么必须改 id 而不只改名字：标签的身份就是「绑定了谁」，只改显示名的话，
   * 下一次刷新会按旧节点把名字又拉回去（而且失效判断也会错）。
   */
  const previousId = item.previousId
  if (previousId && previousId !== item.id) {
    const prevItem = itemRegistry.get(previousId)
    itemRegistry.delete(previousId)
    itemRegistry.set(item.id, item.renderEditor || !prevItem ? item : { ...prevItem, ...item })
    let rebound = false
    let changed = false
    const tr = view.state.tr
    view.state.doc.descendants((node, pos) => {
      if (rebound || node.type.name !== 'resource' || node.attrs.id !== previousId) return
      rebound = true
      changed = chipAttrsNeedUpdate(node.attrs, {
        id: item.id,
        name: item.name,
        url: item.url ?? '',
        chipIndex: item.chipIndex ?? 0,
      }) || String(node.attrs.chipKind ?? '') !== String(item.chipKind ?? '')
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        id: item.id,
        name: item.name,
        url: item.url ?? '',
        thumbnail_url: item.thumbnail_url ?? '',
        value: item.value ?? '',
        category: item.category,
        chipKind: item.chipKind ?? '',
        chipIndex: item.chipIndex ?? 0,
      })
    })
    if (!rebound) return false
    /**
     * 内容没变就不派发事务（用户 2026-10-27 报「点标签后光标跳来跳去」）：
     * 底栏的刷新 watcher 会反复调这里，无条件 dispatch 会反复重建节点、丢光标。
     */
    if (changed) view.dispatch(tr)
    return true
  }
  // 名字 undefined = 保留注册表里原条目的名字（引用名是提示词的一部分，
  // 排序/替换只换图 —— 注册表条目如果被 undefined 覆盖，chip 文字会漂移）。
  const prev = itemRegistry.get(item.id)
  // renderEditor 等外观字段也要从 prev 继承（item 只带数据，不带渲染函数）。
  itemRegistry.set(item.id, item.name === undefined && prev ? { ...prev, ...item, name: prev.name } : item)
  /**
   * 失效标签（用户 2026-10-29：失效了还挂着旧缩略图）：
   * 一旦标成 invalid，就把 url / 类型 / 缩略图**一起清空**，只留名字。
   * 否则 toDOM 会从 attrs 里把旧图捡回来，看着像「还连着」。
   */
  const clearing = item.invalid === true
  let found = false
  let changed = false
  const tr = view.state.tr
  view.state.doc.descendants((node, pos) => {
    if (found || node.type.name !== 'resource' || node.attrs.id !== item.id) return
    found = true
    // registry（按节点 id 存）也要同步 url —— chip 走 renderEditor 分支渲染时
    // 读的是 registry 条目，只改 attrs 不改 registry 的话缩略图不会变（真机踩过）。
    const reg = itemRegistry.get(node.attrs.id)
    if (reg) {
      itemRegistry.set(node.attrs.id, {
        ...reg,
        url: item.url ?? '',
        thumbnail_url: '',
        name: String(node.attrs.name ?? reg.name),
        ...(typeof item.chipIndex === 'number' ? { chipIndex: item.chipIndex } : {}),
      })
    }
    const nextAttrs = {
      ...node.attrs,
      // name 传 undefined = 保留原名字：标签名是用户提示词的一部分（引用名），
      // 排序/替换只换缩略图，绝不能改写它（真机踩过：排序后"图片3"被改成别的名字）。
      name: item.name ?? node.attrs.name,
      url: item.url ?? '',
      // 缩略图必须跟着新 url 重算：留着旧 attrs 的话 toDOM 会继续用旧 thumbnail_url，
      // 表现为「排序/替换后标签缩略图不更新」（真机踩过）。
      thumbnail_url: item.thumbnail_url ?? '',
      value: item.value ?? '',
      category: item.category,
      chipKind: item.chipKind ?? '',
      // 序号跟着注册表一起更新（参考卡拖拽后标签上的「N · 」要变）
      chipIndex: typeof item.chipIndex === 'number' ? item.chipIndex : 0,
    }
    if (clearing) {
      nextAttrs.url = ''
      nextAttrs.thumbnail_url = ''
      nextAttrs.chipKind = ''
      nextAttrs.value = ''
      nextAttrs.chipIndex = 0
    }
    changed = chipAttrsNeedUpdate(node.attrs, {
      name: nextAttrs.name,
      url: nextAttrs.url,
      chipIndex: nextAttrs.chipIndex,
    }) || String(node.attrs.chipKind ?? '') !== String(nextAttrs.chipKind)
    tr.setNodeMarkup(pos, undefined, nextAttrs)
  })
  if (!found) return false
  if (changed) view.dispatch(tr)
  return true
}

/**
 * 按**标签名字**（图片2）更新正文中该标签的缩略图 —— 名字（引用）保持不动。
 * 用户口径：资源卡片排序只换「第 N 格现在放哪张图」，正文标签的名字绝不能变。
 * 找不到同名标签 → false（调用方决定要不要插入）。
 */
export function replaceResourceThumbByName(view: EditorView | null, name: string, url: string): boolean {
  if (!view) return false
  const nodeType = mySchema.nodes.resource
  if (!nodeType) return false
  let found = false
  let changed = false
  const tr = view.state.tr
  view.state.doc.descendants((node, pos) => {
    if (found || node.type.name !== 'resource' || node.attrs.name !== name) return
    found = true
    /**
     * 内容没变就一个字都别动（用户 2026-10-27 报：点标签后光标先跳到前面再跳回来）。
     *
     * 根因：底栏的标签刷新会反复调用这个函数，以前无条件 setNodeMarkup —— 即使 url
     * 一模一样，也会重建标签节点、让文档"改"一次。节点一重建，整颗选中就没了，
     * 浏览器顺手把光标就近放到标签**前面**，0.5s 计时器再把它挪到后面。
     */
    if (!chipAttrsNeedUpdate(node.attrs, { url })) {
      // 文档不动；注册表仍需同步（toDOM 读的是它），这一步不产生事务
      const reg0 = itemRegistry.get(node.attrs.id)
      if (!reg0 || reg0.url !== url) {
        itemRegistry.set(node.attrs.id, {
          ...(reg0 ?? { id: node.attrs.id, category: node.attrs.category }),
          url,
          thumbnail_url: '',
          name: String(node.attrs.name ?? reg0?.name ?? name),
        })
      }
      return
    }
    // registry（按节点 id 存）同步 url —— chip 走 renderEditor(registry item) 渲染，
    // 只改 attrs 不改 registry，toDOM 重渲染时缩略图还是旧图（真机踩过）。
    const reg = itemRegistry.get(node.attrs.id)
    // 名字固定为正文 attrs.name（用户提示词的引用名，绝不改写）；图随格子换。
    if (reg) itemRegistry.set(node.attrs.id, { ...reg, url, thumbnail_url: '', name: String(node.attrs.name ?? reg.name) })
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      url,
      // 缩略图跟着新 url 重算（旧 thumbnail_url 不清会显示旧图，真机踩过）
      thumbnail_url: '',
    })
    changed = true
  })
  if (!found) return false
  if (changed) view.dispatch(tr)
  return true
}

/**
 * 按 id 列表换缩略图（拖拽排序后按「该类型数组第 N 项」取图时用）。
 *
 * 只改 url、不改 name；没有命中或内容未变时不产生事务。
 */
export function replaceResourceThumbByIds(view: EditorView | null, ids: readonly string[], url: string): boolean {
  if (!view) return false
  const next = applyThumbByIds(view.state.doc, ids, url)
  if (next === view.state.doc) return false
  // registry 也同步：chip 走 renderEditor(registry item) 渲染，只改 attrs 不改 registry，
  // 重渲染时缩略图还是旧图（真机踩过）。
  const set = new Set(ids.filter(Boolean))
  for (const id of set) {
    const reg = itemRegistry.get(id)
    if (reg) itemRegistry.set(id, { ...reg, url, thumbnail_url: '' })
  }
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content))
  return true
}

/**
 * 把正文里所有 ref-slot 标签**就地重渲染**一遍（注册表里已是最新 item）。
 *
 * 为什么需要整体刷新：底栏的参考内容随连线变化（上传/替换/断开），同一颗「待输入」
 * 标签要跟着从虚线变实线、换名字与缩略图。逐个 replaceResource 也可以，但调用方
 * 得自己枚举 id；给一个"全刷"入口，调用方一行就够。只对 ref-slot:* 生效，
 * 用户手工插入的其它引用不受影响。没有可刷的节点 → 不 dispatch。
 */
export function refreshChips(view: EditorView | null): void {
  if (!view) return
  // 标签身份不再自动迁移（旧格式按失效处理，用户 2026-10-28 定案）
  // 注册表已更新（调用方先 itemRegistry.set），toDOM 每次渲染都会读 ——
  // 这里用一行**无操作事务**（带标记）逼 ProseMirror 重画这些节点：
  // setNodeMarkup 用原 attrs 也会触发 toDOM 重建（注册表已新，外观即为新）。
  const tr = view.state.tr
  let changed = false
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'resource') return
    // 刷所有**注册表里有条目**的资源节点：正文标签的身份有两种（@声明的 ref-slot:*、
    // 资源面板插入的节点 id）—— 只刷 ref-slot:* 会漏掉后者（真机踩过：排序后那类
    // 标签的缩略图不更新）。registry 没有的（用户手打的裸引用）不动。
    const item = itemRegistry.get(String(node.attrs.id ?? ''))
    if (!item) return
    /**
     * 只刷「外观真的变了」的标签。
     *
     * 用户 2026-10-27 报「点标签后光标先跳到前面再跳回来」：这个函数被底栏 watcher
     * 反复调用，以前**无条件**对每颗标签 setNodeMarkup —— attrs 一个字没变也算文档
     * 改动，节点被重建、整颗选中被销毁，浏览器顺手把光标放到标签前面。
     * 外观相同就不该产生事务。
     */
    const chipId = String(node.attrs.id ?? '')
    const sig = chipSignature(item)
    /*
     * 序号也在这里对齐（用户 2026-11-08）：参考卡拖拽换序后注册表里的 chipIndex 变了，
     * 但文档属性没变的话 ProseMirror 不会重建标签 —— 用户看到「拖了，标签里的号不动」。
     * 把 chipIndex 一起写回去，节点才算真的变了。
     */
    const wantIndex = typeof item.chipIndex === 'number' && item.chipIndex > 0 ? item.chipIndex : 0
    const indexStale = (Number(node.attrs.chipIndex ?? 0) || 0) !== wantIndex
    if (!chipAttrsNeedUpdate(node.attrs, { url: item.url ?? '', name: item.name ?? node.attrs.name ?? '', chipIndex: wantIndex })
      && chipRenderSig.get(chipId) === sig) return
    chipRenderSig.set(chipId, sig)
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, chipIndex: indexStale ? wantIndex : node.attrs.chipIndex })
    changed = true
  })
  if (changed) view.dispatch(tr)
}

