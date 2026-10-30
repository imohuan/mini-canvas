/**
 * 「图片加载失败」标记必须在节点卸载时清掉（2026-10-30 扫描发现）。
 *
 * imageStatus 的 broken 是模块级响应式 Set，按 nodeId 记。删除节点后没人清，
 * id 就一直留着：同 id 重建（撤销删除、复制粘贴复用 id、从历史恢复）会立刻顶着
 * 「图片已失效」的空态，哪怕新图完全正常。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isImageBroken, markImageBroken, clearImageBroken } from '../imageStatus'

const content = readFileSync(new URL('../ImageContent.vue', import.meta.url), 'utf-8')

describe('imageStatus 清理', () => {
  it('ImageContent 卸载时清掉本节点的失败标记', () => {
    const unmount = content.slice(content.indexOf('onBeforeUnmount('), content.indexOf('</script>'))
    expect(unmount, '卸载钩子里没有 clearImageBroken').toMatch(/clearImageBroken\(props\.id\)/)
  })

  it('标记本身可反复移除（幂等）', () => {
    markImageBroken('x')
    expect(isImageBroken('x')).toBe(true)
    clearImageBroken('x')
    clearImageBroken('x')
    expect(isImageBroken('x')).toBe(false)
  })
})
