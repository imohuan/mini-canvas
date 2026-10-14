/**
 * uiAssetUploadPlugin —— 「把画布上的图存进资产库」的成品应用入口（**注册式**，不改任何插件）。
 *
 * 用户口径（2026-10-07）：
 *   「在注册一个右键菜单，功能是加入资产库，点击之后功能和左侧侧边栏点击一样，上传资产把图片贴入进去；
 *     然后再注册一个多选的顶端控制按钮，功能也是一样只不过是可以贴入多张图」。
 *
 * 两个入口、同一件事（贴进左侧「上传资产」那个弹窗）：
 *   ① 节点右键菜单「加入资产库」—— 单选：把该节点的图贴进去；
 *   ② 多选上控制栏「加入资产库」—— 多选：选中节点的每张图都贴进去。
 *
 * 为什么住在 packages/ui（而不是某个插件）：
 *   上传弹窗 / 资产清单 / 文件夹树都是**成品应用**的东西，插件拿不到 ui 层的 assets 服务。
 *   这里只借用两个通用接缝，两个插件一行都不用改：
 *     · ctx.commands.register({ areas:['node'], ... }) —— 右键菜单按 areas 收命令（context-menu 插件既有语义）；
 *     · ctx.selectionRegion.attach({ region:'out:top', ... }) —— 多选插件暴露的"上控制栏注册函数"。
 */
import { markRaw } from 'vue'
import type { PluginModule } from '@mini-canvas/kernel'
import SelectionSaveAssetsToolbar from './components/SelectionSaveAssetsToolbar.vue'
import { pendingUploads, queueUploadsFromNodeIds } from './composables/assetUploadBus'
import { buildPack, downloadBytes, packFileName, resolvePackBase, bytesToBlob } from './composables/nodePack'
import { queueUploads } from './composables/assetUploadBus'
import { useUi } from './composables/ui'
import { assetKindOf } from './composables/assetModel'

export const name = 'ui-asset-upload'

/** 本插件在本场里的 id（诊断用） */
export const ASSET_UPLOAD_ID = name

interface CtxLike {
  /**
   * 命令注册。返回值是**可撤销句柄**（见 canvas-data 的 capabilityTypes）——
   * 资源库里的包被删掉时用 handle.dispose() 摘掉对应菜单项，
   * 不依赖"按 id 注销"（那个能力段里没有）。
   */
  commands: { register(req: Record<string, unknown>): { dispose?: () => void } }
  selectionRegion?: { attach(req: Record<string, unknown>): unknown }
  get<T>(key: string): T
}

export const uiAssetUploadPlugin: PluginModule = {
  name,
  apply(scope) {
    // 内核 PluginScope 的 commands.register 收 CommandDef；本插件只用得到这四件事，
    // 收窄成 CtxLike 便于阅读（运行时同一对象）。
    const ctx = scope as unknown as CtxLike
    /** 成品应用单例（上传弹窗 / 文件夹清单都在它上面） */
    const ui = useUi()
    // ① 节点右键「收藏到资产库」：**一条命令管全部节点类型**。
    //
    //    用户口径（2026-10-14）：「你的这里右键菜单有一个加入资源库，还有一个收藏资源库。
    //    首先，你的这个加入资源库没有任何实际意义，点击没有任何反应。你这边两个只需要一个就行……
    //    我觉得还是收藏到资产库里面合适。如果是你的这个视频的话，图片的话，你这边依然是一样的，
    //    将它做成那种上传资源的那个弹出框里面进行一个上传。你可以参考一下可视化节点的一个收藏功能。」
    //
    //    所以：**合并成一条**（旧「加入资产库」删掉），并按节点类型分流 ——
    //      · 图片 / 视频 / 音频 → 把它的媒体贴进上传弹窗（和左侧「上传资产」同一个弹窗）；
    //      · 可视化节点（type=ui）→ 打包成 .mcnode 再贴进去（就是原来那条「收藏到资产库」）；
    //      · 别的类型 → 明确提示"这个节点没有可收藏的媒体"，不静默什么都不做。
    ctx.commands.register({
      id: 'ui:node-save-to-assets',
      title: '收藏到资产库',
      areas: ['node'],
      group: '节点',
      order: 21,
      run: async (_c: unknown, payload?: { nodeId?: string }) => {
        const nodeId = payload?.nodeId
        if (!nodeId) return
        const doc = ctx.get<{
          getNode(id: string): { id: string; type?: string; data?: Record<string, unknown> } | undefined
        }>('doc')
        const node = doc.getNode(nodeId)
        if (!node) return
        if (isUiNode(node)) {
          await savePackToAssets(nodeId)
          return
        }
        const before = pendingUploads.value.length
        queueUploadsFromNodeIds([nodeId], (id) => doc.getNode(id))
        // 取了地址才叫"有得收藏"；没有就说明这个节点里没有媒体（文本节点等）——
        // 明确告诉用户，而不是像以前那样静默什么都不做（他以为按钮坏了）。
        if (pendingUploads.value.length === before) {
          const label = typeof node.data?.label === 'string' && node.data.label ? node.data.label : nodeId
          // showToast 在成品壳里是空实现（见 ui.ts），所以留一条 console.warn 供排查；
          // 真正的反馈是"弹窗没开" —— 但至少不再像以前那样**静默**到看不出原因。
          console.warn('[资产] 节点「' + label + '」没有可收藏的媒体（图片 / 视频 / 音频字段都为空）')
        }
      },
    })

    // ② 多选上控制栏「加入资产库」（借用多选插件暴露的注册函数，多选插件零改动）。
    ctx.selectionRegion?.attach({
      region: 'out:top',
      id: ASSET_UPLOAD_ID,
      order: 20,
      component: markRaw(SelectionSaveAssetsToolbar),
      needs: ['selection'],
    })

    // ③ 节点包：导出成文件 / 收藏进资产库。
    //
    //    与「加入资产库」同一族（都在节点右键、同一个 group），但做的是另一件事：
    //    它要把**这个节点 + 它依赖的后台脚本**打成一个包 —— 打包只能在后台做
    //    （脚本内容在服务器上）。用户 2026-10-13 口径：
    //      · 导出 = 拿到字节存成 .mcnode 文件；
    //      · 收藏 = **走现成的上传弹窗**（自己选保存位置、填名字、挑标签），不是静默入库。
    const packOf = async (nodeId: string) => {
      const base = await resolvePackBase()
      return buildPack({ base, canvasId: currentCanvasIdOf(ctx), nodeId })
    }

    ctx.commands.register({
      id: 'ui:node-export-pack',
      title: '导出节点包',
      areas: ['node'],
      group: '节点',
      order: 23,
      run: async (_c: unknown, payload?: { nodeId?: string }) => {
        const nodeId = payload?.nodeId
        if (!nodeId) return
        const doc = ctx.get<{ getNode(id: string): { data?: Record<string, unknown> } | undefined }>('doc')
        const label = typeof doc.getNode(nodeId)?.data?.label === 'string' ? (doc.getNode(nodeId)!.data!.label as string) : ''
        try {
          const pack = await packOf(nodeId)
          downloadBytes(pack.bytes, packFileName(pack.name || label || '节点包'))
        } catch (err) {
          console.warn('[ui] 导出节点包失败:', err)
        }
      },
    })

    /**
     * 把可视化节点打包成 .mcnode 并**贴进上传弹窗**（合并后由 ① 调用）。
     *
     * 用户口径（2026-10-14）两条，都在这里落地：
     *   · 「打开这个弹出框，类型可以自动选择这个节点」→ 预勾「节点」标签；
     *   · 「文件地址：默认选择根目录下的一个节点库，如果没有，则自动创建」→ 预选「节点库」文件夹。
     */
    async function savePackToAssets(nodeId: string): Promise<void> {
      try {
        const pack = await packOf(nodeId)
        // 走现成的上传弹窗：包是"本地选好的一个文件"，预填成它的名字
        const blob = bytesToBlob(pack.bytes)
        const file = new File([blob], packFileName(pack.name), { type: 'application/x-mini-canvas-node' })
        const ui = useUi()
        // 「节点库」：没有就现建一个（用户口径：默认存这儿）
        const folderId = await ensureNodeLibraryFolder(ui)
        queueUploads([{ name: file.name, file, tags: ['节点'], ...(folderId ? { folderId } : {}) }])
      } catch (err) {
        console.warn('[ui] 收藏节点包失败:', err)
      }
    }

    /**
     * ⑥ 资源库里的节点包 → 注册成右键菜单的**二级菜单**（用户 2026-10-13 点名要的）：
     *   「资源库 ▸ 节点包 ▸ <每个包一项>」，点一下就在右键处放出一个节点。
     *
     * 为什么用**动态注册**（而不是一条固定命令里塞子项）：
     * 右键菜单是按"命令声明 areas/group/title"现收的（见 context-menu 的说明），
     * 我们只要按包清单注册/注销命令，菜单那边一行都不用改 —— 斜杠写法自动成二级菜单。
     *
     * 为什么挂在**画布空白处**（pane）而不是节点上：
     * 这是"往画布加一个东西"，与"新建节点"同一族；挂在节点右键上语义不对
     * （用户右键一个节点时，多半想改这个节点，不是想再加一个）。
     */
    const registered = new Map<string, { dispose?: () => void }>() // 包 url → 注册句柄

    const syncPackCommands = (): void => {
      const packs = ui.assetItems.value.filter((a) => assetKindOf(a) === 'node-package')
      const seen = new Set<string>()
      for (const p of packs) {
        seen.add(p.url)
        if (registered.has(p.url)) continue
        const id = 'ui:import-pack:' + p.id
        const title = (p.name || '节点包').replace(/\.mcnode$/i, '')
        const handle = ctx.commands.register({
          id,
          // 分组写「资源库/节点包」——斜杠就是二级菜单（用户提的那套写法）
          title,
          areas: ['pane'],
          group: '资源库/节点包',
          // 同组内的先后：按名字排，稳定且可预期（不随资产的入库顺序乱动）
          order: 10,
          run: (_c: unknown, payload?: { flowPosition?: { x: number; y: number } }) => {
            void ui.importPackFromUrl(p.url, title, payload?.flowPosition)
          },
        })
        registered.set(p.url, handle)
      }
      // 库里删掉的包：把它的菜单项也摘掉（否则点到一条已经不存在的）
      for (const [url, handle] of [...registered]) {
        if (seen.has(url)) continue
        handle.dispose?.()
        registered.delete(url)
      }
    }

    // 资产一变就重建（收藏完、删完立刻反映到右键菜单）
    // ⚠️ 守一下 window：这个插件在**非浏览器环境**（单测、SSR、构建期预渲染）也会被 apply，
    //    裸用 window 会直接抛 —— 而装配期抛一下，整个界面就是白屏（2026-10-13 踩到）。
    if (typeof window !== 'undefined') window.addEventListener('mini-canvas:assets-changed', syncPackCommands)
    void ui.loadAssets().then(syncPackCommands)
  },
}

/** 当前画布 id（与 uiConfig.currentCanvasId 同一套判据：哈希路由 #/canvas/<id>） */
function currentCanvasIdOf(_ctx: unknown): string {
  if (typeof location === 'undefined') return 'default'
  const hash = location.hash || ''
  const m = /#\/canvas\/([^/?#]+)/.exec(hash)
  if (m && m[1]) return decodeURIComponent(m[1])
  const q = new URLSearchParams(location.search).get('canvas')
  return q || 'default'
}

/** 这个节点是不是**可视化节点**（type === 'ui'）—— 收藏时它走"打包"那条，不走"贴媒体" */
function isUiNode(node: { type?: string }): boolean {
  return node.type === 'ui'
}

/** 「节点库」文件夹的名字（用户口径 2026-10-14：「默认选择根目录下的一个节点库」） */
const NODE_LIBRARY_FOLDER = '节点库'

/**
 * 取「节点库」文件夹的 id；**没有就现建一个**（用户口径：默认存这儿，没有则自动创建）。
 *
 * 只在**根目录下**找（用户说的是"根目录下的一个节点库"）—— 抽屉里手建的
 * 「某个文件夹 ▸ 节点库」不算，免得把包存进用户没打算用的层级。
 * 建不出来（后台挂了 / 没权限）就返回 undefined，弹窗回落成"个人资产库"，
 * **不阻断收藏**（收藏本身才是用户要的）。
 */
async function ensureNodeLibraryFolder(
  ui: {
    assetFolders: { value: Array<{ id: string; name: string; parentId?: string }> }
    loadAssetFolders(): Promise<void>
    newAssetFolder(name: string, parentId?: string): Promise<string | undefined>
  },
): Promise<string | undefined> {
  try {
    if (!ui.assetFolders.value.length) await ui.loadAssetFolders()
    const hit = ui.assetFolders.value.find((f) => f.name === NODE_LIBRARY_FOLDER && !f.parentId)
    if (hit) return hit.id
    return await ui.newAssetFolder(NODE_LIBRARY_FOLDER)
  } catch (err) {
    console.warn('[ui] 取「' + NODE_LIBRARY_FOLDER + '」文件夹失败，收藏仍继续:', err)
    return undefined
  }
}
