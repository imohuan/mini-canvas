/**
 * 导出前清理「XML 非法注释」。
 *
 * 为什么需要：html-to-image 把 DOM 塞进 <foreignObject>，再用 XMLSerializer 序列化成
 * data:image/svg+xml 去解码。XML 规范不允许注释里出现两个连续减号，而开发期的 Vue 模板
 * 注释经常写 CSS 变量名（也带那两个减号）。注释留在 DOM 里，整张 SVG 就解不出来，
 * 表现为「某一块截图失败」、导出图缺一块（生产构建会删注释，所以只在开发环境复现）。
 *
 * 注释不参与渲染，导出期间摘掉不会有任何视觉变化；截完再按原位置放回。
 */

/** 这条注释会不会让 XML 序列化失败：XML 注释内不允许出现两个连续减号 */
export function isXmlUnsafeComment(text: string): boolean {
  return text.includes('--')
}

interface CommentRecord {
  node: Comment
  parent: Node
  next: Node | null
}

/**
 * 临时移除 root 子树里所有「XML 非法注释」，返回还原函数。
 * 调用方必须在 finally 里调用还原函数，否则 DOM 里会永久少掉这些注释锚点。
 */
export function stripXmlUnsafeComments(root: Node): () => void {
  const doc = root.ownerDocument ?? (root as Document)
  if (!doc || typeof doc.createTreeWalker !== 'function') return () => {}
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  const found: CommentRecord[] = []
  let node = walker.nextNode()
  while (node) {
    const comment = node as Comment
    if (isXmlUnsafeComment(comment.data)) {
      found.push({ node: comment, parent: comment.parentNode ?? root, next: comment.nextSibling })
    }
    node = walker.nextNode()
  }
  for (const record of found) {
    // 记下还原点：取「紧邻的下一个兄弟」。它在卸载后仍是同一个节点对象，
    // 只要它还在原来的父节点里，就能把注释插回原位；被窗口搬走的注释退到末尾即可
    // （注释不参与渲染，位置只影响调试可读性）。
    record.next = record.node.nextSibling
    record.node.parentNode?.removeChild(record.node)
  }
  return () => {
    for (const record of found) {
      if (record.node.parentNode) continue
      if (record.next && record.next.parentNode === record.parent) {
        record.parent.insertBefore(record.node, record.next)
      } else {
        record.parent.appendChild(record.node)
      }
    }
  }
}

/**
 * 导出期间给 XMLSerializer 加一层兜底：序列化前把克隆树里的非法注释摘掉。
 *
 * 为什么不只依赖「实时 DOM 上摘注释」：html-to-image 克隆是异步的，Vue 在克隆途中
 * 仍可能补回注释锚点；而序列化拿到的是**已经克隆好的树**，在这里清理最稳。
 * 只改导出期间、结束后恢复原方法，不影响页面其它功能。
 */
export async function withXmlSafeSerialization<T>(run: () => Promise<T>): Promise<T> {
  if (typeof XMLSerializer === 'undefined') return run()
  const proto = XMLSerializer.prototype as XMLSerializer & {
    serializeToString: (node: Node) => string
  }
  const original = proto.serializeToString
  proto.serializeToString = function patched(node: Node): string {
    try {
      const doc = node.ownerDocument ?? document
      const walker = doc.createTreeWalker(node, NodeFilter.SHOW_COMMENT)
      const unsafe: Comment[] = []
      let current = walker.nextNode()
      while (current) {
        if (isXmlUnsafeComment((current as Comment).data)) unsafe.push(current as Comment)
        current = walker.nextNode()
      }
      for (const comment of unsafe) comment.parentNode?.removeChild(comment)
    } catch {
      // 清理失败也继续序列化：让原方法自己报错，不吞掉真正的问题
    }
    return original.call(this, node)
  }
  try {
    return await run()
  } finally {
    proto.serializeToString = original
  }
}
