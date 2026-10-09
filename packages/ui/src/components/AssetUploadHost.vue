<script setup lang="ts">
/**
 * AssetUploadHost —— 接住「加入资产库」贴进来的图，并挂**左侧同一个上传弹窗**。
 *
 * 用户口径（2026-10-07）：「点击之后功能和左侧侧边栏点击一样，上传资产把图片贴入进去」——
 * 所以不是"静默传完就完事"，而是**把图预填进上传弹窗**（能改名 / 选文件夹 / 打标签），
 * 用户确认后才落库；与左侧「+ → 上传资产」同一个组件、同一条 API。
 *
 * 图从 assetUploadBus 来（节点右键 / 多选上控制栏两条入口都写那里）；
 * 保存时本地文件走 uploadAssetsTo、画布图走 uploadAssetsFromUrls。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AssetUploadDialog from './AssetUploadDialog.vue'
import { useUi } from '../composables/ui'
import { drainUploads, onUploadRequested, type PendingUpload } from '../composables/assetUploadBus'

const ui = useUi()
/** 打开中的弹窗内容：null = 关闭 */
const prefill = ref<PendingUpload[] | null>(null)

/** 有人请求传图（节点右键 / 多选按钮）→ 取图并开弹窗 */
function open(): void {
  const items = drainUploads()
  if (!items.length) return
  // 「保存位置 / 设置标签」的数据在这里现拉：
  // 资产文件夹清单原先只在**打开左侧「资产」tab**时才拉（见 ui.ts），
  // 而这两个入口在抽屉关着时也能用 —— 不拉就出现"下拉里只有个人资产库、后台的文件夹全不见"
  // （用户报的「没有打开左侧侧边栏时，下拉菜单里的列表数据是错误的」）。
  void ui.loadAssetFolders()
  void ui.loadAssets()
  prefill.value = items
}

onMounted(() => onUploadRequested(open))
onBeforeUnmount(() => onUploadRequested(null))

/**
 * 保存：本地文件直传；画布图先 fetch 字节再直传（与侧边栏「上传资产」同一条 API）。
 * 两条都带目标文件夹，保存后按名字补标签（与 LeftDrawer.onUploadSave 同一口径）。
 */
async function onSave(p: { files: File[]; folderId?: string; tags: string[]; urls: { url: string; name: string }[] }): Promise<void> {
  prefill.value = null
  const names = new Set<string>()
  for (const f of p.files) names.add(f.name)
  for (const u of p.urls) names.add(u.name)
  if (p.files.length) await ui.uploadAssetsTo(p.files, p.folderId)
  if (p.urls.length) await ui.uploadAssetsFromUrls(p.urls, p.folderId)
  if (p.tags.length && names.size) {
    await ui.loadAssets()
    // 刚传的这几条：按名字对回清单（同一批重名也能覆盖到）
    for (const a of ui.assetItems.value) if (names.has(a.name)) await ui.tagsForAsset(a.id, p.tags)
  }
}
</script>

<template>
  <AssetUploadDialog
    v-if="prefill"
    :folders="ui.flatFoldersForUpload.value"
    :tag-options="ui.assetTagOptions.value"
    :prefill="prefill"
    @close="prefill = null"
    @save="onSave"
  />
</template>
