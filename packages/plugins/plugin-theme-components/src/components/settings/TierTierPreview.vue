<script setup lang="ts">
/**
 * TierTierPreview —— 图片 / 视频缩略图分档的可视化预览。
 *
 * 只读真实字段（不另存一份），把三档的阈值与目标尺寸画成同一张阶梯图；
 * 设置改动后随 settings.onChange 重新取值。字段控件仍由 SettingsSchemaField 画，
 * 这里只补“这三档是什么关系”的可视化。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SettingsPanelSource } from '@plume-canvas/canvas-render'
import { tierPreviewRows, tierSectionSpec } from './tierSection'

const props = defineProps<{
  group: string
  settings: SettingsPanelSource
  sectionId: string
}>()

const tick = ref(0)
let off: { dispose(): void } | undefined

onMounted(() => {
  off = props.settings.onChange(() => void (tick.value += 1))
})
onBeforeUnmount(() => off?.dispose())

const spec = computed(() => tierSectionSpec(props.sectionId))
const rows = computed(() => {
  void tick.value
  const item = spec.value
  if (!item) return []
  const values = new Map(
    props.settings.groupOf(props.group).map((field) => [field.key, field.value]),
  )
  return tierPreviewRows(item.prefix, (key) => values.get(key))
})
</script>

<template>
  <div v-if="spec" class="tier-preview" :data-tier-section="sectionId">
    <div class="tier-preview__head">
      <span class="tier-preview__title">{{ spec.title }}怎么切</span>
      <span class="tier-preview__hint">画布缩小 → 自动换到更省的一档</span>
    </div>
    <div class="tier-preview__track">
      <div
        v-for="row in rows"
        :key="row.tier"
        class="tier-preview__step"
        :class="'is-' + row.tone"
      >
        <span class="tier-preview__badge">{{ row.tier }}</span>
        <span class="tier-preview__label">{{ row.label }}</span>
        <span class="tier-preview__zoom">
          {{ row.zoom === null ? '任意缩放' : '缩放 < ' + Math.round(row.zoom * 100) + '%' }}
        </span>
      </div>
    </div>
    <p class="tier-preview__desc">{{ spec.description }}</p>
  </div>
</template>

<style scoped>
.tier-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0 14px;
}

.tier-preview__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.tier-preview__title {
  font-size: 12px;
  font-weight: 700;
  color: var(--ui-ink, #18202b);
}

.tier-preview__hint,
.tier-preview__desc {
  font-size: 11px;
  line-height: 1.55;
  color: var(--ui-ink-dim, #6b7280);
}

.tier-preview__desc {
  margin: 0;
}

.tier-preview__track {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.tier-preview__step {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel, #fff);
}

.tier-preview__badge {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.035));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 10px;
  font-weight: 700;
}

.tier-preview__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-ink, #18202b);
}

.tier-preview__zoom {
  font-size: 10px;
  color: var(--ui-ink-mute, #8c95a3);
  font-variant-numeric: tabular-nums;
}

.tier-preview__step.is-small {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 5%, var(--ui-panel, #fff));
}

.tier-preview__step.is-small .tier-preview__badge {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 14%, transparent);
  color: var(--ui-accent-hover, #0e7490);
}

@media (max-width: 560px) {
  .tier-preview__track {
    grid-template-columns: 1fr;
  }
}
</style>
