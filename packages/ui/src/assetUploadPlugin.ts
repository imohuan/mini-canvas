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
import { queueUploadsFromNodeIds } from './composables/assetUploadBus'

export const name = 'ui-asset-upload'

/** 本插件在本场里的 id（诊断用） */
export const ASSET_UPLOAD_ID = name

interface CtxLike {
  commands: { register(req: Record<string, unknown>): unknown }
  selectionRegion?: { attach(req: Record<string, unknown>): unknown }
  get<T>(key: string): T
}

export const uiAssetUploadPlugin: PluginModule = {
  name,
  apply(scope) {
    // 内核 PluginScope 的 commands.register 收 CommandDef；本插件只用得到这四件事，
    // 收窄成 CtxLike 便于阅读（运行时同一对象）。
    const ctx = scope as unknown as CtxLike
    // ① 节点右键「加入资产库」：把该节点的图贴进上传弹窗。
    //    run 拿得到 command 的 payload（context-menu 会把 nodeId 塞进去 —— 见其 onSelect）。
    ctx.commands.register({
      id: 'ui:node-save-to-assets',
      title: '加入资产库',
      areas: ['node'],
      group: '节点',
      order: 21,
      run: (_c: unknown, payload?: { nodeId?: string }) => {
        const nodeId = payload?.nodeId
        if (!nodeId) return
        const doc = ctx.get<{ getNode(id: string): { id: string; data?: Record<string, unknown> } | undefined }>('doc')
        queueUploadsFromNodeIds([nodeId], (id) => doc.getNode(id))
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
  },
}
