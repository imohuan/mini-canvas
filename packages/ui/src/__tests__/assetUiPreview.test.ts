/**
 * 预览：可视化节点（节点包）要能看 —— 用户 2026-10-14 口径：
 *   「我发现点击之后会进入全屏预览，但我当前的节点无法进行预览。
 *     或者，可以在预览中添加一个 iframe 预览框。这个也可以啊」。
 *
 * 根因：节点包没有"可加载的媒体地址"，把它的 url 丢给 MediaViewer 就是一片空白。
 * 做法：取回包 → 解出里面的 HTML → 交给 MediaViewer 新增的 iframe 分支。
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openAssetPreviewFromAsset, assetPreview } from '../composables/assetUiBus'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

describe('预览分流：普通媒体直给 url，节点包要先解包', () => {
  it('图片/视频/音频 → 原样开预览（带 id，可删）', async () => {
    await openAssetPreviewFromAsset({ id: 'a1', name: '封面', url: '/api/a.png', kind: 'image' })
    expect(assetPreview.value).toMatchObject({ id: 'a1', name: '封面', kind: 'image', url: '/api/a.png' })
  })

  it('★ 取包失败 → 回一段**能看懂的文字**（不是静默全屏空白）', async () => {
    // 没起后台 → peekPack 会失败；这里就验证失败分支的兜底
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    await openAssetPreviewFromAsset({ id: 'p1', name: '演示节点.mcnode', url: '/api/assets/files/x.mcnode', kind: 'node-package' })
    expect(assetPreview.value?.kind).toBe('text')
    expect(String(assetPreview.value?.text)).toContain('读不出来')
    vi.unstubAllGlobals()
  })

  it('★ 取包成功 → 走 ui 分支（把包里的 HTML 交给 iframe）', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/api/node-ui/info')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, origin: 'http://x' }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, html: '<div id="paint">hi</div>', manifest: { name: '演示' }, scripts: { scale: 'x' } }),
      }
    })
    await openAssetPreviewFromAsset({ id: 'p2', name: '演示.mcnode', url: '/api/assets/files/y.mcnode', kind: 'node-package' })
    expect(assetPreview.value?.kind).toBe('ui')
    expect(assetPreview.value?.html).toContain('id="paint"')
    vi.unstubAllGlobals()
  })

  it('★ 切张到节点包：类型按当前张走（不再沿用第一张的视频类型）', async () => {
    // 清单带 kinds：第 0 张视频、第 1 张节点包。从视频切到节点包后，
    // currentAssetPreview() 必须回 kind='ui' + 节点包 url（外壳据此取包开 iframe）。
    const { currentAssetPreview } = await import('../composables/assetUiBus')
    // 先开一张视频（同层清单里混着节点包）
    await openAssetPreviewFromAsset(
      { id: 'v', name: '视频', url: '/v.mp4', kind: 'video' },
      { list: ['/v.mp4', '/p.mcnode'], names: ['视频', '节点包'], kinds: ['video', 'node-package'], index: 0 },
    )
    expect(assetPreview.value?.kind).toBe('video')
    // 模拟 ← / → 切到第二张（setAssetPreviewIndex 的同一条路）
    const { setAssetPreviewIndex } = await import('../composables/assetUiBus')
    setAssetPreviewIndex(1)
    const cur = currentAssetPreview()
    expect(cur?.kind).toBe('ui')
    expect(cur?.url).toBe('/p.mcnode')
    expect(cur?.name).toBe('节点包')
  })

  it('★ 切到另一个节点包时旧界面必须失效（否则连切两张画面不变）', async () => {
    const { currentAssetPreview, assetPreview } = await import('../composables/assetUiBus')
    // 已解出第一个包（html 来自 /p1.mcnode）
    assetPreview.value = {
      name: '包一', kind: 'ui', html: '<div>包一</div>', htmlUrl: '/p1.mcnode',
      list: ['/p1.mcnode', '/p2.mcnode'], names: ['包一', '包二'],
      kinds: ['node-package', 'node-package'], index: 0,
    }
    // 切到第二个包：html 仍是包一的 —— 必须当作"还没取"
    assetPreview.value = { ...assetPreview.value, index: 1 }
    const second = currentAssetPreview()
    expect(second?.url).toBe('/p2.mcnode')
    expect(second?.html).toBeUndefined()
    // 切回第一个包：html 本来就属于它，保留（不重复取包）
    assetPreview.value = { ...assetPreview.value, index: 0 }
    expect(currentAssetPreview()?.html).toBe('<div>包一</div>')
  })
})

describe('MediaViewer 有 kind="ui" 的 iframe 分支', () => {
  const viewer = read('../../../plugins/plugin-theme-default/src/components/ui/MediaViewer.vue')

  it('模板里有 iframe + srcdoc，绑的是 item.html', () => {
    expect(viewer).toContain("kind === 'ui'")
    expect(viewer).toMatch(/<iframe[\s\S]{0,300}:srcdoc="item\.html"/)
    // 沙箱：只给脚本权限（节点界面本来就是一段自包含 HTML）
    expect(viewer).toMatch(/sandbox="allow-scripts"/)
  })

  it('节点还没画过时给一句占位，不是一片空白', () => {
    expect(viewer).toContain('还没有画过内容')
  })

  it('item 类型声明里有 html 字段', () => {
    expect(viewer).toMatch(/html\?: string/)
  })
})

describe('两处宿主都走统一入口', () => {
  it('LeftDrawer 的 openAsset 用 openAssetPreviewFromAsset（不是直接把 url 丢给预览）', () => {
    const drawer = read('../components/areas/LeftDrawer.vue')
    // 2026-10-14 起多带一个「同层文件清单」参数（全局预览的 ← / → 列表），
    // 落点没变：仍然是这条统一入口，不是把 url 直接丢给预览。
    expect(drawer).toContain('openAssetPreviewFromAsset(item, group)')
    expect(drawer).not.toContain('openAssetPreview({ id: item.id, name: item.name, kind: assetKindOf(item), url: item.url })')
  })

  it('★ AssetUiSlot 要把 html / text 一起透传给 MediaViewer（漏了就永远是"还没画过"）', () => {
    // 真机踩到：分流对了（走 ui 分支），但外壳只透传 name/kind/url，
    // iframe 拿不到 html → 显示成"这个可视化节点还没有画过内容"。
    const slot = read('../components/AssetUiSlot.vue')
    expect(slot).toContain('...(p.html !== undefined ? { html: p.html } : {})')
    expect(slot).toContain('...(p.text !== undefined ? { text: p.text } : {})')
  })

  it('★ 切张取包不得写回预览总线（写回会自激：页面卡死，且同层清单被覆盖）', () => {
    const slot = read('../components/AssetUiSlot.vue')
    // 取包结果存在外壳本地（packView），不碰 assetUiBus 的 openAssetPreview
    expect(slot).toContain('const packView = ref')
    expect(slot).not.toMatch(/import[^\n]*openAssetPreview[^\n]*assetUiBus/)
    // 换包时按 url 命中判断：新地址不会复用旧包的界面
    expect(slot).toMatch(/packView\.value\?\.url === p\.url/)
  })
})
