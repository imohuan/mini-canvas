/**
 * 可见集合引用稳定性（真机回归，2026-11-05）。
 *
 * 现象：浏览器控制台报
 *   Uncaught (in promise) Maximum recursive updates exceeded in component <CanvasSurface>
 * 根因：computeVisibleIds 每次都新建 Set，而 cullIds 是 shallowRef。
 * refreshCull 无脑赋值 → 引用变化 → 依赖它的 syncNodesFromStore / watch 重跑 →
 * 再算一次可见集合 → 又换引用，形成自激循环，Vue 判定递归更新超限。
 *
 * 契约：可见集合**内容相同就保持旧引用**，只有真的变了才替换。
 * 这里钉住实现（computeVisibleIds 的返回值 + 写入函数的行为），
 * 组件级挂载在 node 环境跑不起来，源码级守卫是这层最可靠的锁。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.resolve(HERE, '../canvas-host/useCanvasCulling.ts'), 'utf8')

describe('可见集合引用稳定（Maximum recursive updates 回归）', () => {
  it('写入统一走 setCullIds，不能到处直接赋值', () => {
    const directWrites = source.match(/cullIds.values*=/g) ?? []
    // 只允许 setCullIds 内部的两处赋值（null 分支 + 变更分支）
    expect(directWrites.length, 'cullIds.value 应在 setCullIds 内集中赋值').toBeLessThanOrEqual(2)
  })

  it('setCullIds 对相同内容直接返回，不替换引用', () => {
    const at = source.indexOf('function setCullIds')
    expect(at, '缺少 setCullIds').toBeGreaterThanOrEqual(0)
    // 取足够长的窗口（setCullIds 内部有嵌套 }，且后面紧跟注释块，不能按 } 或下一个 function 截）
    const body = source.slice(at, at + 1200)
    expect(body, '必须比较内容').toContain('prev.size === next.size')
    expect(body, '内容相同要提前 return').toContain('if (same) return')
  })

  it('三处刷新入口（保护/常规/视口帧）都不得绕过 setCullIds', () => {
    for (const name of ['applyCullProtection', 'refreshCull']) {
      const at = source.indexOf('function ' + name)
      expect(at, '缺少 ' + name).toBeGreaterThanOrEqual(0)
      const body = source.slice(at, at + 1600)
      expect(body, name + ' 必须走 setCullIds').toContain('setCullIds(')
      expect(body, name + ' 不应直接给 cullIds.value 赋值').not.toMatch(/cullIds.value\s*=/)
    }
  })
})
