<script setup lang="ts">
/**
 * PluginSettingsPanel —— 分组化配置的 schema 驱动 UI 面板。
 *
 * 读 ctx.settings（SettingsStore 同一实例）的已申报组与 schema，自动长控件(改控件=调 settings.set)；
 * 订阅变化刷新取值。宿主/demo 把 boot 后的 ctx.settings 传进来即可，插件不用手画表单。
 * 对齐 docs/goal/plugin-system-goal.md 2.4 / 目标 B2。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SettingSchema } from './settingsPanelTypes'
import type { SettingsPanelSource } from './settingsPanelTypes'
import type { SettingEntry } from '@mini-canvas/canvas-core-v2'
import { createCoalescer } from '../utils/coalesce'

/** 面板消费的最小 settings 接口（与内核 SettingsStore / ctx.settings 能力对齐） */
export type { SettingsPanelSource } from './settingsPanelTypes'

const props = defineProps<{ settings: SettingsPanelSource }>()

// 变更后整体刷新取值（store 非 reactive，用版本号驱动）
const tick = ref(0)
let unsub: { dispose(): void } | undefined

onBeforeUnmount(() => unsub?.dispose())

// 订阅由父级在挂载前决定：这里用 onMounted 订阅，避免 SSR/时序问题
onMounted(() => {
  unsub = props.settings.onChange(() => void (tick.value += 1))
})

// 高频控件(颜色/滑块)的连续拖动 → 合帧成一帧一次 set(目标 B2 性能约束③)；文本/下拉一次即提交无需合帧
const coalescer = createCoalescer((pairs) => {
  for (const [key, v] of pairs) props.settings.set(key, v as string | number | boolean)
})
onBeforeUnmount(() => coalescer.dispose())

function set(key: string, v: string | number | boolean): void {
  // 连续高频(同一帧多次)只取最后一次；settings.set 在帧尾统一执行并只 notify 一次
  coalescer.push(key, v)
}
function valueOf(e: SettingEntry): string | number | boolean {
  return e.value
}
function isColorType(s: SettingSchema): boolean {
  return s.type === 'color'
}
function numberValue(v: string | number | boolean, s: SettingSchema): number {
  return Number(v) ?? Number(s.default)
}
</script>

<template>
  <div class="ps-panel">
    <template v-for="g in props.settings.groups()" :key="g">
      <div class="ps-group">
        <div class="ps-group-title">{{ g }}</div>
        <div v-for="e in props.settings.groupOf(g)" :key="e.key" class="ps-field">
          <!-- color -->
          <template v-if="e.schema.type === 'color'">
            <label class="ps-label">{{ e.schema.label ?? e.key }}</label>
            <div class="ps-row">
              <input type="color" :value="String(valueOf(e))" @input="set(e.key, ($event.target as HTMLInputElement).value)" />
              <span class="ps-mon">{{ valueOf(e) }}</span>
            </div>
          </template>

          <!-- number -->
          <template v-else-if="e.schema.type === 'number'">
            <label class="ps-label">{{ e.schema.label ?? e.key }}</label>
            <input
              type="range"
              :min="e.schema.min ?? 0"
              :max="e.schema.max ?? 100"
              :step="1"
              :value="numberValue(valueOf(e), e.schema)"
              @input="set(e.key, Number(($event.target as HTMLInputElement).value))"
            />
          </template>

          <!-- boolean -->
          <template v-else-if="e.schema.type === 'boolean'">
            <div class="ps-row">
              <span class="ps-label">{{ e.schema.label ?? e.key }}</span>
              <input type="checkbox" :checked="!!valueOf(e)" @change="set(e.key, ($event.target as HTMLInputElement).checked)" />
            </div>
          </template>

          <!-- select -->
          <template v-else-if="e.schema.type === 'select'">
            <label class="ps-label">{{ e.schema.label ?? e.key }}</label>
            <select class="ps-select" :value="String(valueOf(e))" @change="set(e.key, ($event.target as HTMLSelectElement).value)">
              <option v-for="o in e.schema.options ?? []" :key="o.value" :value="o.value">{{ o.label ?? o.value }}</option>
            </select>
          </template>

          <!-- text -->
          <template v-else>
            <label class="ps-label">{{ e.schema.label ?? e.key }}</label>
            <input class="ps-text" type="text" :value="String(valueOf(e))" @input="set(e.key, ($event.target as HTMLInputElement).value)" />
          </template>
        </div>
      </div>
    </template>
    <div v-if="props.settings.groups().length === 0" class="ps-empty">还没有插件申报配置</div>
  </div>
</template>

<style scoped>
.ps-panel { font-size: 12px; color: #374151; font-family: system-ui, "Microsoft YaHei", sans-serif; }
.ps-group { margin-bottom: 12px; }
.ps-group-title { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: #9ca3af; text-transform: uppercase; margin-bottom: 4px; }
.ps-field { display: flex; flex-direction: column; gap: 4px; padding: 5px 0; }
.ps-label { font-size: 12px; font-weight: 500; }
.ps-row { display: flex; align-items: center; gap: 8px; }
.ps-mon { font-family: ui-monospace, monospace; font-size: 11px; color: #2563eb; }
.ps-select, .ps-text { padding: 4px 6px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; }
.ps-empty { color: #9ca3af; padding: 8px 0; }
</style>
