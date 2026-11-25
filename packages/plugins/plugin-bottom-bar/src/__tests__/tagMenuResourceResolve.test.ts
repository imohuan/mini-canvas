/**
 * 标签下拉：只有 `resourceId` 的节点也要拿到可显示地址（用户 2026-11-25 截图 3）。
 *
 * 新图片节点只写 `resourceId`，data 里没有 `imageUrl`。菜单行首缩略图与 hover 预览
 * 都只认 `entry.url` —— 不补这一步，行首永远显示默认图标、hover 也没有预览。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useBottomBarTagMenu } from '../node-bottom-bar/useBottomBarTagMenu'

function depsFor(nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>, resolve: (ref: string) => Promise<string | undefined>) {
  return {
    ctx: {
      tryGet: (name: string) =>
        name === 'doc'
          ? { getNodes: () => nodes }
          : name === 'resources'
            ? { resolve }
            : undefined,
    },
    props: { id: 'target', data: {} },
    shownMaterials: ref([]),
    videoThumbTick: ref(0),
    videoThumbOf: () => undefined,
    videoProvider: () => undefined,
    replaceChipWith: async () => {},
    getAnchorEl: () => null,
    focusSearch: () => {},
  } as unknown as Parameters<typeof useBottomBarTagMenu>[0]
}

describe('标签菜单补齐资源地址', () => {
  it('只有 resourceId 的图片节点：取回地址后缩略图与预览都能用', async () => {
    const menu = useBottomBarTagMenu(
      depsFor(
        [{ id: 'n1', type: 'image', data: { label: '图片 11', resourceId: 'canvas/hash.png' } }],
        async (r) => (r === 'canvas/hash.png' ? 'blob:http://x/hash' : undefined),
      ),
    )
    // 取之前：条目在，但没有地址（UI 只能画默认图标）
    expect(menu.tagMenuEntries.value[0]?.url).toBeUndefined()
    await menu.resolveTagMenuResourceUrls()
    expect(menu.tagMenuEntries.value[0]?.url).toBe('blob:http://x/hash')
    expect(menu.tagMenuThumbOf(menu.tagMenuEntries.value[0]!)).toBe('blob:http://x/hash')
  })

  it('同一个节点只请求一次（结果按 id 缓存）', async () => {
    let calls = 0
    const menu = useBottomBarTagMenu(
      depsFor(
        [{ id: 'n1', type: 'image', data: { label: '图片', resourceId: 'r1' } }],
        async () => {
          calls += 1
          return 'blob:r1'
        },
      ),
    )
    await menu.resolveTagMenuResourceUrls()
    await menu.resolveTagMenuResourceUrls()
    expect(calls).toBe(1)
    expect(menu.tagMenuEntries.value[0]?.url).toBe('blob:r1')
  })

  it('已经有地址的节点不再请求（旧存档不额外打资源服务）', async () => {
    let calls = 0
    const menu = useBottomBarTagMenu(
      depsFor(
        [
          { id: 'n1', type: 'image', data: { label: '图片', imageUrl: 'https://x/a.png', resourceId: 'r1' } },
          { id: 'n2', type: 'text', data: { label: '文本', text: 'hi', resourceId: 'r2' } },
        ],
        async () => {
          calls += 1
          return 'blob:r'
        },
      ),
    )
    await menu.resolveTagMenuResourceUrls()
    expect(calls).toBe(0)
  })
})

describe('标签菜单的条目构建', () => {
  it('自身节点不进候选（不能引用自己）', () => {
    const menu = useBottomBarTagMenu(
      depsFor(
        [
          { id: 'target', type: 'image', data: { label: '自己', imageUrl: 'https://x/self.png' } },
          { id: 'n1', type: 'image', data: { label: '图', imageUrl: 'https://x/a.png' } },
        ],
        async () => undefined,
      ),
    )
    expect(menu.tagMenuEntries.value.map((e) => e.id)).toEqual(['n1'])
  })
})

/**
 * 用户 2026-11-25：编辑菜单与标签 hover 预览**不能同时出现**。
 * 菜单一开就要把编辑器那边的预览收掉并禁止再弹；关掉后恢复。
 */
describe('编辑菜单与 hover 预览互斥', () => {
  it('打开菜单：通知编辑器压制这颗标签的预览；关闭：解除压制', async () => {
    const calls: Array<string | undefined> = []
    const deps = depsFor(
      [{ id: 'n1', type: 'image', data: { label: '图', imageUrl: 'https://x/a.png' } }],
      async () => undefined,
    )
    ;(deps as unknown as { suppressEditorPreview: (id?: string) => void }).suppressEditorPreview = (id) => {
      calls.push(id)
    }
    const menu = useBottomBarTagMenu(deps)
    menu.openTagMenu(
      { id: 'ref-node:n1', name: '图片1', category: '素材' },
      { left: 100, top: 100, right: 160, bottom: 124 },
    )
    expect(calls, '打开时按这颗标签 id 压制').toEqual(['ref-node:n1'])
    await new Promise((r) => setTimeout(r, 0))
    menu.closeTagMenu()
    expect(calls, '关闭时解除压制').toEqual(['ref-node:n1', undefined])
  })

  /**
   * Esc / 点外关闭走的是受控 Dropdown 的 @update:open，不经过 closeTagMenu。
   * 若只在 closeTagMenu 里解除压制，按一次 Esc 就会把这颗标签的预览永久禁掉。
   */
  it('★ 直接关 open（Esc / 点外）也要解除压制', async () => {
    const calls: Array<string | undefined> = []
    const deps = depsFor(
      [{ id: 'n1', type: 'image', data: { label: '图', imageUrl: 'https://x/a.png' } }],
      async () => undefined,
    )
    ;(deps as unknown as { suppressEditorPreview: (id?: string) => void }).suppressEditorPreview = (id) => {
      calls.push(id)
    }
    const menu = useBottomBarTagMenu(deps)
    menu.openTagMenu(
      { id: 'ref-node:n1', name: '图片1', category: '素材' },
      { left: 100, top: 100, right: 160, bottom: 124 },
    )
    await new Promise((r) => setTimeout(r, 0))
    calls.length = 0
    // 模拟 Dropdown 自己关（用户按 Esc）：只改 open
    menu.tagMenuOpen.value = false
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toContain(undefined)
  })
})
