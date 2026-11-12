<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import AppDialog from '../../AppDialog.vue'
import { formatBytes, formatDurationLong, formatExactTime, ratioLabel } from './historyCardText'
import { historyMediaKind, historyMediaLabel, type HistoryMediaKind } from './historyDetailMedia'
import type { HistoryDetailItem } from './useHistoryPreview'

const props = defineProps<{
  item: HistoryDetailItem | null
}>()

const emit = defineEmits<{
  close: []
  preview: [{ url: string; kind: HistoryMediaKind; name?: string }]
}>()

const Button = useUiComponent('Button')
/**
 * 详情里的媒体预览用与生成历史卡片同一套注册件：
 * 音频走 audioPreview（波形 + 时间 + 大小），视频走 videoPreview（带控件），
 * 图片直接用 img。树外取件由 canvas-render 的 outside 入口处理。
 */
const AudioPreview = useUiComponent('audioPreview')
const VideoPreview = useUiComponent('videoPreview')

/** 参考素材 → 带类型的视图模型（模板里不再重复判断 kind） */
const refs = computed(() => {
  return (props.item?.resources ?? []).map((r) => {
    const kind = historyMediaKind(r)
    return { ...r, kind, label: historyMediaLabel(kind) }
  })
})

/** 产物（历史条目的 urls）同样按类型预览；没有地址就退回只显示信息 */
const productUrl = computed(() => props.item?.urls?.[0] ?? '')
const productKind = computed<HistoryMediaKind>(() => historyMediaKind({
  kind: props.item?.kind,
  url: productUrl.value,
  value: props.item?.text,
}))
const productLabel = computed(() => historyMediaLabel(productKind.value))

/** 文本参考/产物：详情里直接展开全文；过长的先收起来，点“展开”看全 */
const textExpanded = ref(false)

/** 点图片/视频/音频预览：打开同款全屏 MediaViewer（历史弹窗里已有的那只） */
function openPreview(url: string | undefined, kind: HistoryMediaKind, name?: string): void {
  if (!url) return
  emit('preview', { url, kind, ...(name ? { name } : {}) })
}

/** 标签只记资源 id：名称去 resources 里找（两处靠 id 对照） */
function resourceNameOf(id: string): string {
  const hit = props.item?.resources?.find((r) => r.id === id)
  return hit?.name || id
}
</script>

<template>
  <!-- 生成详情：一条历史的完整参数（提示词 / 参数 / 参考素材 / 产物信息）。
       用户口径 2026-10-27：卡片上要有入口，能复盘"当时到底用了什么"。 -->
  <AppDialog :model-value="!!item" width="640px" height="auto" max-height="80vh" radius="16px"
    title="生成详情" description="查看这条记录的提示词、参数与产物信息。"
    @update:model-value="!$event && emit('close')">
    <div v-if="item" class="hist-detail">
      <header class="hist-detail-head">
        <div class="min-w-0">
          <strong class="hist-detail-title">{{ item.title }}</strong>
          <span class="hist-detail-sub">{{ item.kind }} · {{ item.time }}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭生成详情" @click="emit('close')">
          <X :size="15" />
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div class="hist-detail-body">
          <!-- 产物信息：图片给宽高比，视频/音频额外给时长，所有类型都给文件大小 -->
          <section class="hist-detail-sec">
            <h4 class="hist-detail-h">产物</h4>
            <!-- 产物预览：与生成历史卡片同一套媒体件（图片 / 视频播放器 / 音频波形） -->
            <div v-if="productUrl" class="hist-detail-product">
              <button
                v-if="productKind === 'image'"
                type="button"
                class="hist-detail-media-button hist-detail-media-button--image"
                :aria-label="'预览产物：' + item.title"
                @click="openPreview(productUrl, 'image', item.title)"
              >
                <img :src="productUrl" alt="" loading="lazy" />
              </button>
              <div v-else-if="productKind === 'video'" class="hist-detail-video">
                <component v-if="VideoPreview" :is="VideoPreview" :url="productUrl" :name="item.title" />
                <video v-else :src="productUrl" controls playsinline />
              </div>
              <div v-else-if="productKind === 'audio'" class="hist-detail-audio">
                <component v-if="AudioPreview" :is="AudioPreview" :url="productUrl" :name="item.title" compact />
                <audio v-else :src="productUrl" controls />
              </div>
              <p v-else-if="productKind === 'text'" class="hist-detail-prompt hist-detail-text">
                {{ item.text || '（空）' }}
              </p>
              <span class="hist-detail-product-label">{{ productLabel }}</span>
            </div>
            <dl class="hist-detail-kv">
              <template v-if="item.media?.width && item.media?.height">
                <dt>宽高</dt>
                <dd>{{ item.media.width }}×{{ item.media.height }}
                  <span class="hist-detail-dim">（{{ ratioLabel(item.media.width, item.media.height) }}）</span>
                </dd>
              </template>
              <template v-if="item.media?.durationMs">
                <dt>时长</dt><dd>{{ formatDurationLong(item.media.durationMs) }}</dd>
              </template>
              <template v-if="item.media?.bytes">
                <dt>文件大小</dt><dd>{{ formatBytes(item.media.bytes) }}</dd>
              </template>
              <template v-if="item.finishedAt">
                <dt>完成时间</dt><dd>{{ formatExactTime(item.finishedAt) }}</dd>
              </template>
              <template v-if="item.error">
                <dt>失败原因</dt><dd class="hist-detail-danger">{{ item.error }}</dd>
              </template>
            </dl>
          </section>

          <section class="hist-detail-sec">
            <h4 class="hist-detail-h">提示词</h4>
            <p v-if="item.prompts?.length" class="hist-detail-prompt">
              <template v-for="(seg, i) in item.prompts" :key="i">
                <span v-if="seg.type === 'tag'" class="hist-detail-tag">@{{ resourceNameOf(seg.value) }}</span>
                <span v-else>{{ seg.value }}</span>
              </template>
            </p>
            <p v-else class="hist-detail-empty">这条记录没有保存提示词（早期记录没有这一项）</p>
          </section>

          <section v-if="item.values && Object.keys(item.values).length" class="hist-detail-sec">
            <h4 class="hist-detail-h">生成参数</h4>
            <dl class="hist-detail-kv">
              <template v-for="(v, k) in item.values" :key="k">
                <dt>{{ k }}</dt><dd>{{ String(v) }}</dd>
              </template>
            </dl>
          </section>

          <section class="hist-detail-sec">
            <h4 class="hist-detail-h">参考素材</h4>
            <div v-if="item.resources?.length" class="hist-detail-refs">
              <div
                v-for="(r, i) in refs"
                :key="i"
                class="hist-detail-ref"
                :class="'hist-detail-ref--' + r.kind"
              >
                <span class="hist-detail-ref-kind">{{ r.label }}</span>
                <span v-if="r.name" class="hist-detail-ref-name">{{ r.name }}</span>
                <button
                  v-if="r.kind === 'image' && r.url"
                  type="button"
                  class="hist-detail-media-button hist-detail-media-button--image"
                  :aria-label="'预览参考图片：' + (r.name || r.label)"
                  @click="openPreview(r.url, 'image', r.name)"
                >
                  <img :src="r.url" alt="" loading="lazy" />
                </button>
                <div v-else-if="r.kind === 'video' && r.url" class="hist-detail-ref-video">
                  <component v-if="VideoPreview" :is="VideoPreview" :url="r.url" :name="r.name" />
                  <video v-else :src="r.url" controls playsinline />
                </div>
                <div v-else-if="r.kind === 'audio' && r.url" class="hist-detail-ref-audio">
                  <component v-if="AudioPreview" :is="AudioPreview" :url="r.url" :name="r.name" compact />
                  <audio v-else :src="r.url" controls />
                </div>
                <p v-else-if="r.kind === 'text'" class="hist-detail-ref-text">{{ r.value }}</p>
                <span v-else-if="r.url" class="hist-detail-ref-url">{{ r.url }}</span>
                <span v-else class="hist-detail-ref-value">{{ r.value }}</span>
              </div>
            </div>
            <p v-else class="hist-detail-empty">这条记录没有参考素材（早期记录没有这一项）</p>
          </section>
        </div>
      </div>
    </div>
  </AppDialog>
</template>

<style scoped>
/* 详情弹窗：与历史面板同一套中性灰阶；只有失败原因用语义红 */
.hist-detail { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.hist-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 12px 8px 16px; }
.hist-detail-title { display: block; font-size: 15px; font-weight: 700; color: var(--ui-ink, inherit); }
.hist-detail-sub { display: block; margin-top: 2px; font-size: 11px; color: var(--ui-ink-mute, #888); }
.hist-detail-body { display: flex; flex-direction: column; gap: 14px; padding-top: 4px; }
.hist-detail-sec { display: flex; flex-direction: column; gap: 6px; }
.hist-detail-h { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--ui-ink-mute, #888); }
.hist-detail-kv { display: grid; grid-template-columns: 68px 1fr; gap: 4px 10px; margin: 0; font-size: 12px; }
.hist-detail-kv dt { color: var(--ui-ink-mute, #888); }
.hist-detail-kv dd { margin: 0; color: var(--ui-ink, inherit); word-break: break-word; }
.hist-detail-dim { color: var(--ui-ink-mute, #888); }
.hist-detail-danger { color: var(--ui-danger, #ef4444); }
.hist-detail-prompt { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--ui-veil, rgb(127 127 127 / .08)); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--ui-ink, inherit); }
.hist-detail-empty { margin: 0; font-size: 12px; color: var(--ui-ink-mute, #888); }
.hist-detail-refs { display: flex; flex-wrap: wrap; gap: 8px; }
.hist-detail-ref { display: flex; flex-direction: column; gap: 4px; width: 180px; min-width: 0; padding: 6px; border-radius: 8px; border: 1px solid var(--ui-line, rgb(128 128 128 / .2)); background: var(--ui-veil, rgb(127 127 127 / .06)); }
.hist-detail-ref--audio, .hist-detail-ref--video, .hist-detail-ref--text { width: 260px; }
.hist-detail-ref img { width: 100%; height: 96px; object-fit: cover; border-radius: 6px; display: block; }
.hist-detail-media-button { display: block; width: 100%; padding: 0; border: 0; background: transparent; border-radius: 6px; overflow: hidden; cursor: zoom-in; text-align: left; }
.hist-detail-media-button:focus-visible { outline: 2px solid var(--ui-accent, #0891b2); outline-offset: 2px; }
.hist-detail-media-button--image { position: relative; }
.hist-detail-media-button--image img { transition: transform .18s ease; }
.hist-detail-media-button--image:hover img { transform: scale(1.02); }
.hist-detail-product { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.hist-detail-product-label { font-size: 10px; color: var(--ui-ink-mute, #888); }
.hist-detail-video { width: 100%; max-width: 360px; border-radius: 10px; overflow: hidden; background: var(--ui-veil, rgb(127 127 127 / .12)); }
.hist-detail-video :deep(video), .hist-detail-ref-video :deep(video) { display: block; width: 100%; height: auto; }
.hist-detail-audio { width: 100%; min-height: 88px; border-radius: 10px; overflow: hidden; background: var(--ui-panel, #fff); }
.hist-detail-ref-video { width: 100%; border-radius: 8px; overflow: hidden; background: var(--ui-veil, rgb(127 127 127 / .12)); }
.hist-detail-ref-audio { width: 100%; min-height: 88px; border-radius: 8px; overflow: hidden; background: var(--ui-panel, #fff); }
.hist-detail-text { max-height: 180px; overflow: auto; white-space: pre-wrap; }
.hist-detail-ref-text { margin: 0; max-height: 120px; overflow: auto; font-size: 11px; line-height: 1.5; color: var(--ui-ink, inherit); word-break: break-word; white-space: pre-wrap; }
.hist-detail-ref-kind { font-size: 10px; color: var(--ui-ink-mute, #888); text-transform: uppercase; }
.hist-detail-ref-name { font-size: 11px; font-weight: 600; color: var(--ui-ink, inherit); word-break: break-word; }
.hist-detail-tag { color: var(--ui-accent, #0891b2); }
.hist-detail-ref-value { font-size: 11px; line-height: 1.4; color: var(--ui-ink, inherit); max-height: 68px; overflow: auto; }
.hist-detail-ref-url { font-size: 10px; line-height: 1.35; color: var(--ui-ink-mute, #888); word-break: break-all; max-height: 68px; overflow: auto; }
</style>
