<script setup lang="ts">
// AssetUploadDialog —— 上传资产弹窗（照最新参考图）：
// 左：虚线上传区，「+」格常驻第一位，已选文件小卡排后面（带 上传中/失败重试 状态）；
// 右：资产名称（多文件时显示 n/50 计数）+ 保存位置（必填）+ 设置标签（照图 1：标题行 + 每行对勾，点行即选，无确定按钮）；
// 右下：取消 / 保存。保存动作由宿主完成。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Plus as PlusIcon, X as XIcon, FileImage as FileIcon, Film as VideoIcon, Music as AudioIcon,
  CircleAlert as AlertIcon, Check as CheckIcon, RefreshCw as RetryIcon,
} from 'lucide-vue-next'
import AxDropdown from './AxDropdown.vue'

const props = defineProps<{
  folders: { id: string; name: string; depth: number }[]
  tagOptions: string[]
  /**
   * 预填的图（**从画布贴进来的**：节点右键 / 多选「加入资产库」）——不是本地 File，
   * 而是"画布上已经在显示、地址浏览器取得到"的图。它们与本地选的图并排显示、一起保存。
   */
  /** 预填项：画布图给 url，本地文件给 file（节点包「收藏到资产库」走 file 那条） */
  prefill?: { url?: string; name: string; file?: File }[]
  /**
   * 打开时预选的**保存位置**（空 = 个人资产库）。可选：
   * 左侧抽屉 / 画布贴图入口不传 → 默认个人资产库（原行为不变）；
   * 「资产管理」弹窗传当前所在层 —— 与它的「新建文件夹」同一落点口径。
   */
  initialFolderId?: string
  /**
   * 打开时**预勾的标签**（默认空 = 用户自己选）。可选：
   * 节点包「收藏到资产库」会预勾「节点」—— 用户口径 2026-10-14：
   * 「如果是节点收藏资源库的话，打开这个弹出框，你这边的类型可以自动选择这个节点」。
   */
  initialTags?: string[]
}>()
const emit = defineEmits<{
  close: []
  /**
   * `name` 只在**单文件**时给（多文件共用一个名字会互相覆盖，用户只会想让每个文件保留原名）。
   * 宿主拿到它就按这个名字落库；没有就沿用文件名。
   */
  save: [payload: { files: File[]; folderId?: string; tags: string[]; urls: { url: string; name: string }[]; name?: string }]
}>()

// ui-style-guide §3.1：Esc 必须能关（挂 document，随组件回收）
function onEscKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onEscKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onEscKey))

type PickState = 'pending' | 'uploading' | 'done' | 'failed'
/**
 * 一项待保存：本地文件（file）或画布上的媒体（url）——两者互斥，展示与保存一视同仁。
 *
 * `kind` 是**缩略图该用什么画**的依据（用户 2026-10-14 报的「UI 显示错误」根因）：
 * 早先不管什么类型都拿 `<img>` 去显示 —— 视频放进去就是一张裂图（.mp4 不是图片）。
 */
interface PickItem { file?: File; url?: string; state: PickState; preview?: string; name: string; kind: 'image' | 'video' | 'audio' | 'other' }
/** 与后端对齐（cloud-server/uploads.ts DEFAULT_MAX_UPLOAD_BYTES = 50MB；环境变量可调，前端按缺省值约束） */
const MAX_MB = 50
const MAX_FILES = 50

const fileInput = ref<HTMLInputElement | null>(null)
const items = ref<PickItem[]>([])
// 预填项（画布贴进来的图 / 刚打好的节点包）直接进 items：与本地选的文件同一套缩略图/删除/计数
for (const p of props.prefill ?? []) {
  items.value.push(
    p.file
      ? { file: p.file, state: 'pending', name: p.name, kind: kindOf(p.file) }
      : // 画布上的媒体：类型**按地址扩展名**认（它有真实后缀），不是按来源猜
        { url: p.url, state: 'pending', preview: p.url, name: p.name, kind: kindOfName(p.name) },
  )
}
const assetName = ref('')
// 预填项只有**一项**时，把它的名字**填进名称框**（而不是只当占位符）。
//
// 用户 2026-10-14 看截图时提的「UI 显示错误」：名称框里显示的是灰色占位符（视频 1.mp4），
// 看着像"名字没带上"；而保存时名字取的是这个框的值 —— 空着就回落成占位符文本。
// 直接填进去，用户一眼看到会存成什么名，也能立刻改。
if (props.prefill?.length === 1 && props.prefill[0]?.name) assetName.value = props.prefill[0].name
const targetFolderId = ref<string>(props.initialFolderId ?? '')
const tagsOpen = ref(false)
const pickedTags = ref<string[]>([...(props.initialTags ?? [])])

const targetLabel = computed(
  () => props.folders.find((f) => f.id === targetFolderId.value)?.name ?? '个人资产库',
)
const folderRows = computed(() =>
  props.folders.map((f) => ({ ...f, pad: 'padding-left:' + (8 + f.depth * 14) + 'px' })),
)
/** 名称计数（多文件）：已填字符数 / 50，照图 2 的 29/50 */
const nameCount = computed(() => assetName.value.length + '/' + MAX_FILES)
const pendingCount = computed(() => items.value.filter((i) => i.state === 'pending').length)

function kindOf(f: File): 'image' | 'video' | 'audio' | 'other' {
  if (f.type.startsWith('image/')) return 'image'
  if (f.type.startsWith('video/')) return 'video'
  if (f.type.startsWith('audio/')) return 'audio'
  return 'other'
}

/**
 * 按**文件名后缀**认类型（画布上的媒体走这条 —— 预览项只有 url + 名字，没有 File 的 MIME）。
 *
 * 为什么不看 url 里的 query：画布资源地址常带 `?v=时间戳`（见节点产物那条约定），
 * 而这里判类型只该看**扩展名**（用户 2026-10-14 那条口径：别按字段名/来源猜）。
 */
function kindOfName(name: string): 'image' | 'video' | 'audio' | 'other' {
  const ext = (name.split('?')[0].split('#')[0].split('.').pop() ?? '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio'
  return 'other'
}
const kindIcon = (k: string) => (k === 'video' ? VideoIcon : k === 'audio' ? AudioIcon : FileIcon)
/**
 * 换一个名字（保留字节与 MIME）：上传弹窗的「资产名称」改的是**登记名**，不是文件内容。
 *
 * 为什么不用 new File(...) 直接造：部分环境（老 Safari / 单测替身）的 File 构造器不完整，
 * 这里已经拿到同一个 Blob，只需要把 name 换成新的。
 */
function renameFile(file: File, name: string): File {
  if (file.name === name) return file
  try {
    return new File([file], name, { type: file.type, lastModified: file.lastModified })
  } catch {
    // 造不出来就退回原名（宁可名字不变，也不要上传失败）
    return file
  }
}
function chooseFiles(): void {
  fileInput.value?.click()
}
function onPick(e: Event): void {
  const input = e.target as HTMLInputElement
  for (const f of Array.from(input.files ?? [])) {
    if (items.value.length >= MAX_FILES) break
    if (f.size > MAX_MB * 1024 * 1024) {
      console.warn('[上传资产] 超过 ' + MAX_MB + 'MB 已忽略: ' + f.name)
      continue
    }
    const kind = kindOf(f)
    const item: PickItem = { file: f, state: 'pending', name: f.name, kind }
    // objectURL 只给**能画出来的**类型（图片）。视频/音频不给 —— 那不是 <img> 能显示的，
    // 给了反而是裂图（用户 2026-10-14 报的「UI 显示错误」）。
    if (kind === 'image') item.preview = URL.createObjectURL(f)
    items.value.push(item)
  }
  input.value = ''
}
function removeItem(i: number): void {
  const [gone] = items.value.splice(i, 1)
  // 只回收本地文件的 objectURL；画布图（http/同源地址）是现成地址，不能 revoke
  if (gone?.file && gone.preview) URL.revokeObjectURL(gone.preview)
}
function retryItem(i: number): void {
  if (items.value[i]) items.value[i].state = 'pending'
}
function toggleTag(t: string): void {
  const i = pickedTags.value.indexOf(t)
  if (i >= 0) pickedTags.value.splice(i, 1)
  else pickedTags.value.push(t)
}
function save(): void {
  const ok = items.value.filter((i) => i.state !== 'failed')
  const files = ok.map((i) => i.file).filter((f): f is File => Boolean(f))
  const urls = ok.filter((i) => i.url).map((i) => ({ url: i.url as string, name: i.name }))
  if (!files.length && !urls.length) return
  /**
   * 名称只在「恰好一个待保存项」时生效。
   *
   * 用户口径（上传弹窗的字段名就叫「资产名称」）：填了就该用填的。
   * 多文件时输入框里那份名字没法均分给 N 个文件 —— 强行套用会把它们改成同一个名字
   * （列表里分不清、同名又互相干扰按名对标签的逻辑），所以这时不传、各自保留原名。
   */
  const total = files.length + urls.length
  const typed = assetName.value.trim()
  const singleName = total === 1 && typed ? typed : undefined
  if (singleName && files.length === 1) files[0] = renameFile(files[0], singleName)
  if (singleName && urls.length === 1) urls[0] = { ...urls[0], name: singleName }
  emit('save', {
    files,
    folderId: targetFolderId.value || undefined,
    tags: [...pickedTags.value],
    urls,
    ...(singleName ? { name: singleName } : {}),
  })
  for (const i of items.value) if (i.file && i.preview) URL.revokeObjectURL(i.preview)
  items.value = []
  pickedTags.value = []
  targetFolderId.value = ''
  assetName.value = ''
}
</script>

<template>
  <Teleport to="body">
  <div class="fixed inset-0 z-[100000] flex items-center justify-center">
    <div class="absolute inset-0 bg-veil" aria-hidden="true" @click="emit('close')"></div>
    <div
      class="relative flex w-[min(760px,calc(100vw-48px))] flex-col rounded-2xl border border-line bg-panel text-ink shadow-[0_8px_40px_rgba(0,0,0,0.45)]"
      role="dialog" aria-modal="true" aria-label="上传资产"
    >
      <div class="flex h-12 flex-none items-center justify-between border-b border-line px-4">
        <span class="text-sm font-medium">上传资产</span>
        <button class="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" aria-label="关闭" @click="emit('close')"><XIcon :size="16" /></button>
      </div>

      <div class="flex gap-5 p-4">
        <!-- 左：上传区（+ 常驻第一位 + 文件小卡） -->
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="flex flex-wrap content-start gap-2 overflow-y-auto rounded-xl border border-dashed border-line bg-veil/40 p-3" style="height: 352px">
            <button class="grid size-[104px] flex-none place-items-center rounded-xl border border-dashed border-line text-ink-dim transition-colors hover:bg-hover" aria-label="选择文件" @click="chooseFiles">
              <PlusIcon :size="24" />
            </button>
            <!-- 隐藏的文件选择器：点「+」触发它（上一版重写时漏了这个 input，「+」就成了死按钮） -->
            <input
              ref="fileInput"
              type="file"
              multiple
              class="hidden"
              aria-hidden="true"
              accept="image/jpeg,image/png,video/mp4,audio/mpeg"
              @change="onPick"
            />
            <div v-for="(it, i) in items" :key="it.name + i" class="group/p relative flex w-[104px] flex-none flex-col rounded-xl border border-line bg-veil/60 p-1.5">
              <div class="relative h-[72px] w-full overflow-hidden rounded-lg bg-thumb">
                <!--
                  缩略图按**真实类型**画（用户 2026-10-14 报的「UI 显示错误」）：
                  早先一律用 <img>，视频塞进去就是一张裂图。现在 —— 图片用 img、
                  视频用 video（首帧当缩略图，不自动播放）、音频/其它用类型图标。
                -->
                <img v-if="it.kind === 'image' && it.preview" :src="it.preview" alt="" class="h-full w-full object-cover" />
                <video v-else-if="it.kind === 'video' && it.preview" :src="it.preview" class="h-full w-full object-cover" preload="metadata" muted playsinline />
                <span v-else class="grid h-full w-full place-items-center text-ink-mute"><component :is="kindIcon(it.kind)" :size="20" /></span>
                <!-- 状态角标：上传失败 → 图标+重试；pending 无角标 -->
                <span v-if="it.state === 'failed'" class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-veil/80 text-[10px] text-danger">
                  <span class="flex items-center gap-0.5"><AlertIcon :size="11" /> 上传失败</span>
                  <button class="flex h-5 items-center gap-0.5 rounded-md bg-hover-strong px-1.5 text-ink" :aria-label="'重试 ' + it.name" @click.stop="retryItem(i)"><RetryIcon :size="10" /> 重试</button>
                </span>
              </div>
              <span class="mt-1 w-full truncate text-center text-[11px] text-ink">{{ it.name }}</span>
              <button class="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-panel text-ink-dim opacity-0 shadow transition-opacity group-hover/p:opacity-100" :aria-label="'移除 ' + it.name" @click="removeItem(i)"><XIcon :size="11" /></button>
            </div>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-ink-dim">
            支持的文件格式：<span class="inline-flex items-center gap-0.5"><FileIcon :size="11" /> jpg/jpeg/png</span>
            <span class="ml-2 inline-flex items-center gap-0.5"><VideoIcon :size="11" /> mp4</span>
            <span class="ml-2 inline-flex items-center gap-0.5"><AudioIcon :size="11" /> mp3</span><br />
            单个文件大小不超过 {{ MAX_MB }}MB
          </p>
        </div>

        <!-- 右：名称 + 位置 + 标签 -->
        <div class="flex w-[250px] flex-none flex-col gap-4">
          <div>
            <p class="mb-1.5 flex items-center justify-between text-[12px] text-ink">
              <span>资产名称<span class="ml-0.5 text-danger">*</span></span>
              <span v-if="items.length > 1" class="text-[11px] text-ink-dim">{{ nameCount }}</span>
            </p>
            <input
              v-model="assetName"
              class="h-9 w-full rounded-lg border border-line bg-chip px-3 text-[13px] text-ink placeholder:text-ink-dim focus:outline-none"
              :placeholder="items[0]?.name ?? ''"
              aria-label="资产名称"
            />
          </div>
          <div>
            <p class="mb-1.5 text-[12px] text-ink">保存位置<span class="ml-0.5 text-danger">*</span></p>
            <AxDropdown placement="bottom" align="start" match-width menu-width="250px">
              <template #trigger>
                <button class="flex h-9 w-full items-center justify-between rounded-lg border border-line bg-chip px-3 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="选择保存位置">
                  <span class="truncate">{{ targetLabel }}</span>
                  <span class="text-ink-dim">▾</span>
                </button>
              </template>
              <template #default="{ close }">
                <div class="ax-menu">
                  <div class="ax-menu-item" role="menuitem" :class="{ 'is-active': !targetFolderId }" @click="targetFolderId = ''; close()">个人资产库</div>
                  <div
                    v-for="f in folderRows" :key="f.id"
                    class="ax-menu-item" role="menuitem"
                    :class="{ 'is-active': targetFolderId === f.id }"
                    :style="f.pad"
                    @click="targetFolderId = f.id; close()"
                  >{{ f.name }}</div>
                </div>
              </template>
            </AxDropdown>
          </div>
          <div>
            <p class="mb-1.5 text-[12px] text-ink">设置标签</p>
            <AxDropdown v-model="tagsOpen" placement="bottom" align="start" match-width menu-width="250px" menu-max-height="320px">
              <template #trigger>
                <button class="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-chip px-3 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="选择标签">
                  <span class="truncate text-ink-dim">{{ pickedTags.length ? pickedTags.join('、') : '请选择标签' }}</span>
                  <span class="flex-none text-ink-dim">▾</span>
                </button>
              </template>
              <!-- 照图 1：标题行「标签 + 新建」 + 每行右侧对勾；点行即选，外点关闭 -->
              <template #default>
                <div role="listbox" aria-label="标签清单">
                  <div class="flex items-center justify-between px-2 py-1.5 text-[12px] text-ink-dim">
                    <span>标签</span>
                    <button class="grid size-5 place-items-center rounded-md transition-colors hover:bg-hover hover:text-ink" aria-label="新建标签" @click.stop><PlusIcon :size="12" /></button>
                  </div>
                  <button
                    v-for="t in tagOptions" :key="t"
                    class="flex h-9 w-full items-center justify-between rounded-lg px-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                    role="option" :aria-selected="pickedTags.includes(t)"
                    @click="toggleTag(t)"
                  >
                    <span>{{ t }}</span>
                    <CheckIcon v-if="pickedTags.includes(t)" :size="14" class="text-ink" />
                  </button>
                </div>
              </template>
            </AxDropdown>
          </div>
        </div>
      </div>

      <div class="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button class="h-8 rounded-lg border border-line px-3.5 text-[13px] text-ink transition-colors hover:bg-hover" @click="emit('close')">取消</button>
        <button
          class="h-8 rounded-lg px-4 text-[13px] font-medium transition-colors"
          :class="pendingCount ? 'bg-brand text-white hover:bg-brand/85' : 'cursor-not-allowed bg-chip text-ink-mute'"
          :disabled="!pendingCount" @click="save"
        >保存</button>
      </div>
    </div>
  </div>
  </Teleport>
</template>
