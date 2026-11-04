<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import AppDialog from '../../AppDialog.vue'
import { formatBytes, formatDurationLong, formatExactTime, ratioLabel } from './historyCardText'
import type { HistoryDetailItem } from './useHistoryPreview'

defineProps<{
  item: HistoryDetailItem | null
}>()

const emit = defineEmits<{ close: [] }>()

const Button = useUiComponent('Button')
</script>

<template>
  <!-- 生成详情：一条历史的完整参数（提示词 / 参数 / 参考素材 / 产物信息）。
       用户口径 2026-10-27：卡片上要有入口，能复盘"当时到底用了什么"。 -->
  <AppDialog :model-value="!!item" width="640px" height="auto" max-height="80vh" radius="16px"
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
            <p v-if="item.prompt" class="hist-detail-prompt">{{ item.prompt }}</p>
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
              <div v-for="(r, i) in item.resources" :key="i" class="hist-detail-ref">
                <span class="hist-detail-ref-kind">{{ r.kind }}</span>
                <img v-if="r.url && r.kind !== 'video' && r.kind !== 'audio'" :src="r.url" alt="" loading="lazy" />
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
.hist-detail-ref { display: flex; flex-direction: column; gap: 4px; width: 104px; padding: 6px; border-radius: 8px; border: 1px solid var(--ui-line, rgb(128 128 128 / .2)); background: var(--ui-veil, rgb(127 127 127 / .06)); }
.hist-detail-ref img { width: 100%; height: 68px; object-fit: cover; border-radius: 6px; display: block; }
.hist-detail-ref-kind { font-size: 10px; color: var(--ui-ink-mute, #888); text-transform: uppercase; }
.hist-detail-ref-value { font-size: 11px; line-height: 1.4; color: var(--ui-ink, inherit); max-height: 68px; overflow: auto; }
.hist-detail-ref-url { font-size: 10px; line-height: 1.35; color: var(--ui-ink-mute, #888); word-break: break-all; max-height: 68px; overflow: auto; }
</style>
