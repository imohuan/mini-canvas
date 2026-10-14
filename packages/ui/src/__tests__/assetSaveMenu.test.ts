/**
 * 节点右键的"收藏"入口 —— 用户 2026-10-14 口径：
 *   「你的这里右键菜单有一个加入资源库，还有一个收藏资源库。首先，你的这个加入资源库
 *     没有任何实际意义，点击没有任何反应。你这边两个只需要一个就行……
 *     我觉得还是收藏到资产库里面合适。」
 *
 * 所以钉三件事：**只有一条**收藏命令、它叫「收藏到资产库」、按节点类型分流。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const plugin = read('../assetUploadPlugin.ts')
const bus = read('../composables/assetUploadBus.ts')

describe('节点右键：收藏只有一条', () => {
  it('★ 不再有「加入资产库」那条命令（用户：两个只要一个）', () => {
    expect(plugin).not.toContain("title: '加入资产库'")
    expect(plugin).not.toContain('ui:node-save-to-assets-join')
  })

  it('留下的是「收藏到资产库」，且仍然挂在节点右键组里', () => {
    expect(plugin).toContain("title: '收藏到资产库'")
    expect(plugin).toMatch(/id: 'ui:node-save-to-assets'[\s\S]{0,120}areas: \['node'\]/)
  })

  it('两件事都从同一条命令走：媒体贴弹窗 / 可视化节点走打包', () => {
    // 可视化节点（type === 'ui'）→ savePackToAssets；其余 → queueUploadsFromNodeIds
    expect(plugin).toContain('isUiNode(node)')
    expect(plugin).toContain('await savePackToAssets(nodeId)')
    expect(plugin).toContain('queueUploadsFromNodeIds([nodeId]')
  })
})

describe('节点包收藏：预选「节点」标签 + 「节点库」位置（用户口径）', () => {
  it('★ 打包后带上 tags:[节点] 与节点库 folderId', () => {
    expect(plugin).toContain("tags: ['节点']")
    expect(plugin).toContain('ensureNodeLibraryFolder(ui)')
  })

  it('★ 「节点库」没有就自动创建（用户：如果没有，则自动创建）', () => {
    expect(plugin).toContain("const NODE_LIBRARY_FOLDER = '节点库'")
    expect(plugin).toMatch(/ensureNodeLibraryFolder[\s\S]{0,600}newAssetFolder\(NODE_LIBRARY_FOLDER\)/)
  })

  it('只在**根目录**找节点库（用户说的是"根目录下的一个节点库"）', () => {
    expect(plugin).toMatch(/f\.name === NODE_LIBRARY_FOLDER && !f\.parentId/)
  })
})

describe('上传弹窗接住预选', () => {
  const dialog = read('../components/AssetUploadDialog.vue')
  const host = read('../components/AssetUploadHost.vue')

  it('弹窗收 initialTags 并预勾上', () => {
    expect(dialog).toContain('initialTags?: string[]')
    expect(dialog).toMatch(/pickedTags = ref<string\[\]>\(\[\.\.\.\(props\.initialTags/)
  })

  it('宿主把预选从总线转给弹窗（含保存位置）', () => {
    expect(host).toContain('const preset = ref')
    expect(host).toMatch(/:initial-folder-id="preset\.folderId"/)
    expect(host).toMatch(/:initial-tags="preset\.tags"/)
  })
})

describe('★ 三类媒体字段都要认（本轮的根因）', () => {
  it('assetUploadBus 里 imageUrl / videoUrl / audioUrl 三个都读', () => {
    expect(bus).toContain("pick('imageUrl')")
    expect(bus).toContain("pick('videoUrl')")
    expect(bus).toContain("pick('audioUrl')")
  })

  it('没有媒体地址时不再静默 —— 给出可排查的日志', () => {
    expect(bus).toContain('没有可上传的媒体地址')
  })
})
