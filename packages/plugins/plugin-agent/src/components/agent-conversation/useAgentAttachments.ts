/**
 * 附件与媒体预览：待发送图片、看大图 / 看视频、粘贴图片。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { computed, ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { AgentServiceState } from '../../agent-service/types.js'

export function useAgentAttachments(s: AgentServiceState) {
/** 全屏媒体查看器也走主题目录（用户消息图片 / 待发送图片点开看大图） */
const MediaViewer = useUiComponent('mediaViewer')

const prompt = ref('')
/**
 * 待发送的图片（data URL）。
 *
 * 为什么用 data URL 而不是先传到服务器换个 id：Agent 的图片入口是 SDK 的
 * imageUrlMessage，它认 URL / data URL。用 data URL 就不必再开一条上传链路，
 * 图跟着这条消息走，回放时也照样画得出来（服务端会把它一起落进转录）。
 */
const attached = ref<string[]>([])
/**
 * 要不要显示消息流里的「过程提示」（`turn.notice`，多半是「已连接 MCP：…」）。
 *
 * 用户口径（2026-10-03）：**暂时隐藏，不要删除** —— 每次对话都会冒一条，
 * 而且说不清什么时候出现（SDK 懒连接），读起来很吵。
 * MCP 的真实状态改在 MCP 下拉里按需看（那里有「检测」）。
 * 数据没丢，想看回来把它改成 `true` 即可。
 */
const SHOW_PROCESS_NOTICE = false
const fileInput = ref<HTMLInputElement | null>(null)
/** 单次消息的图片上限：多了会撑爆一次请求，也超出大多数模型的接受量 */
const MAX_IMAGES = 4
/** 单张上限（base64 后约 1.37 倍，4MB 原图 ≈ 5.5MB 请求体） */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

function pickImages(): void {
  fileInput.value?.click()
}

async function onFilesPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // 先清空 input：否则同一张图连选两次不会触发 change
  input.value = ''
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    if (attached.value.length >= MAX_IMAGES) {
      s.error = '最多一次带 ' + MAX_IMAGES + ' 张图'
      break
    }
    if (f.size > MAX_IMAGE_BYTES) {
      s.error = '「' + f.name + '」太大了（单张上限 4MB）'
      continue
    }
    try {
      attached.value = [...attached.value, await readAsDataUrl(f)]
    } catch {
      s.error = '读不了「' + f.name + '」'
    }
  }
}
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

function removeAttachment(i: number): void {
  attached.value = attached.value.filter((_, idx) => idx !== i)
}

/**
 * 点缩略图看大图：整只交给主题注册的 MediaViewer（AxImageViewer 同款：
 * 滚轮缩放 / 拖拽 / 旋转 / 翻转 / 下载 / Esc 关闭），与底栏素材卡、
 * 生成历史、资产面板共用同一份实现 —— 不再自己画遮罩。
 */
const previewImage = ref<string | null>(null)
/**
 * 预览的是什么媒体（用户口径 2026-10-13）：read_file 现在也读视频 / 音频，
 * MediaViewer 靠 kind 决定挂图片舞台还是节点插件登记的真播放器 ——
 * 不带 kind 会把视频当图片打开（一片空白）。
 */
const previewKind = ref<'image' | 'video' | 'audio'>('image')
/**
 * 预览所在的**整组图片**（用户口径 2026-10-09：预览时用 ← / → 轮播，循环）。
 * MediaViewer 本来就支持（list + index + 键盘 ←→ 取模循环），此前各调用点只传了单张。
 * 传了 list 的才有轮播；单图（如目标只有一张参考图）不显示翻页按钮。
 */
const previewList = ref<string[] | null>(null)
function openPreview(url: string, list?: string[] | null): void {
  previewImage.value = url
  previewList.value = list && list.length > 1 ? list : null
  previewKind.value = 'image'
}
/** 工具卡里的画面：地址 + 媒体种类（视频 / 音频要 MediaViewer 挂对应播放器） */
function previewToolMedia(url: string, kind?: 'image' | 'video' | 'audio'): void {
  previewKind.value = kind ?? 'image'
  previewList.value = null
  previewImage.value = url
}
const previewItem = computed(() =>
  previewImage.value
    ? {
      name: previewKind.value === 'image' ? '图片预览' : previewKind.value === 'video' ? '视频预览' : '音频预览',
      kind: previewKind.value,
      url: previewImage.value,
      ...(previewList.value ? { list: previewList.value, index: Math.max(0, previewList.value.indexOf(previewImage.value)) } : {}),
    }
    : null,
)

/** 粘贴图片（截图直接 Ctrl+V）也收：比"先存盘再选文件"顺手得多 */
function onPaste(e: ClipboardEvent): void {
  const items = [...(e.clipboardData?.items ?? [])]
  const pics = items.filter((it) => it.type.startsWith('image/'))
  if (!pics.length) return
  e.preventDefault()
  for (const it of pics) {
    const f = it.getAsFile()
    if (f) void addFile(f)
  }
}

async function addFile(f: File): Promise<void> {
  if (attached.value.length >= MAX_IMAGES) {
    s.error = '最多一次带 ' + MAX_IMAGES + ' 张图'
    return
  }
  if (f.size > MAX_IMAGE_BYTES) {
    s.error = '图片太大了（单张上限 4MB）'
    return
  }
  try {
    attached.value = [...attached.value, await readAsDataUrl(f)]
  } catch {
    s.error = '读不了这张图'
  }
}

return {
  MediaViewer,
  prompt,
  attached,
  SHOW_PROCESS_NOTICE,
  fileInput,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  pickImages,
  onFilesPicked,
  readAsDataUrl,
  removeAttachment,
  previewImage,
  previewKind,
  previewList,
  openPreview,
  previewToolMedia,
  previewItem,
  onPaste,
  addFile,
}
}
