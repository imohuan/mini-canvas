<script setup lang="ts">
/**
 * PluginSettingsPanel —— 分组化配置的 schema 驱动 UI 面板。
 *
 * 读 ctx.settings（SettingsStore 同一实例）的已申报组与 schema，自动长控件(改控件=调 settings.set)；
 * 订阅变化刷新取值。宿主/demo 把 boot 后的 ctx.settings 传进来即可，插件不用手画表单。
 * 对齐 docs/goal/plugin-system-goal.md 2.4 / 目标 B2。
 *
 * 视觉说明：本面板是"可替换设置面板"的默认皮(settings-panel-slot-host-plan)。schema 驱动逻辑不动，
 * 样式做了分组卡片/字段行/toggle/滑块数值 的观感统一，替换面板只需声明 props.settings 即可换皮。
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
      <section class="ps-group">
        <header class="ps-group-title">{{ g }}</header>

        <div v-for="e in props.settings.groupOf(g)" :key="e.key" class="ps-field">
          <!-- color -->
          <template v-if="e.schema.type === 'color'">
            <label class="ps-label" :for="'ps-' + e.key">{{ e.schema.label ?? e.key }}</label>
            <div class="ps-row">
              <span class="ps-swatch">
                <input
                  :id="'ps-' + e.key"
                  type="color"
                  :value="String(valueOf(e))"
                  @input="set(e.key, ($event.target as HTMLInputElement).value)"
                />
              </span>
              <span class="ps-mon">{{ valueOf(e) }}</span>
            </div>
          </template>

          <!-- number（滑块 + 数值气泡） -->
          <template v-else-if="e.schema.type === 'number'">
            <div class="ps-label-row">
              <label class="ps-label" :for="'ps-' + e.key">{{ e.schema.label ?? e.key }}</label>
              <span class="ps-value-bubble">{{ valueOf(e) }}</span>
            </div>
            <input
              :id="'ps-' + e.key"
              class="ps-range"
              type="range"
              :min="e.schema.min ?? 0"
              :max="e.schema.max ?? 100"
              :step="1"
              :value="numberValue(valueOf(e), e.schema)"
              @input="set(e.key, Number(($event.target as HTMLInputElement).value))"
            />
          </template>

          <!-- boolean（现代 toggle 开关） -->
          <template v-else-if="e.schema.type === 'boolean'">
            <label class="ps-switch-row" :for="'ps-' + e.key">
              <span class="ps-label">{{ e.schema.label ?? e.key }}</span>
              <span class="ps-switch">
                <input
                  :id="'ps-' + e.key"
                  type="checkbox"
                  :checked="!!valueOf(e)"
                  @change="set(e.key, ($event.target as HTMLInputElement).checked)"
                />
                <span class="ps-slider"></span>
              </span>
            </label>
          </template>

          <!-- select -->
          <template v-else-if="e.schema.type === 'select'">
            <label class="ps-label" :for="'ps-' + e.key">{{ e.schema.label ?? e.key }}</label>
            <select :id="'ps-' + e.key" class="ps-select" :value="String(valueOf(e))" @change="set(e.key, ($event.target as HTMLSelectElement).value)">
              <option v-for="o in e.schema.options ?? []" :key="o.value" :value="o.value">{{ o.label ?? o.value }}</option>
            </select>
          </template>

          <!-- text -->
          <template v-else>
            <label class="ps-label" :for="'ps-' + e.key">{{ e.schema.label ?? e.key }}</label>
            <input :id="'ps-' + e.key" class="ps-text" type="text" :value="String(valueOf(e))" @input="set(e.key, ($event.target as HTMLInputElement).value)" />
          </template>
        </div>
      </section>
    </template>

    <div v-if="props.settings.groups().length === 0" class="ps-empty">
      <span class="ps-empty-ico">⚙</span>
      <p>还没有插件申报配置</p>
    </div>
  </div>
</template>

<style scoped>
.ps-panel {
  --ps-accent: #4f7cff;
  --ps-text: #1f2937;
  --ps-muted: #9aa3af;
  --ps-border: #e6e8eb;
  font-size: 12.5px;
  color: var(--ps-text);
  font-family: system-ui, "Microsoft YaHei", sans-serif;
}

/* —— 分组卡片 —— */
.ps-group {
  margin-bottom: 6px;
  padding: 10px 12px 4px;
  border: 1px solid var(--ps-border);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
}
.ps-group:last-child {
  margin-bottom: 0;
}
.ps-group-title {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ps-muted);
  text-transform: uppercase;
  margin-bottom: 6px;
}

/* —— 字段 —— */
.ps-field {
  padding: 6px 0;
  border-top: 1px dashed #f0f1f3;
}
.ps-field:first-of-type {
  border-top: none;
}
.ps-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 5px;
}
.ps-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ps-label-row .ps-label {
  margin-bottom: 0;
}
.ps-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* —— 颜色选择 —— */
.ps-swatch {
  position: relative;
  width: 30px;
  height: 22px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--ps-border);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}
.ps-swatch input[type='color'] {
  position: absolute;
  inset: -6px;
  width: 42px;
  height: 34px;
  border: none;
  padding: 0;
  cursor: pointer;
  background: transparent;
}

/* —— 数值滑块 —— */
.ps-value-bubble {
  font-size: 11px;
  font-weight: 600;
  color: var(--ps-accent);
  background: rgba(79, 124, 255, 0.1);
  padding: 1px 8px;
  border-radius: 999px;
}
.ps-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--ps-accent), #dbe3ff);
  outline: none;
  cursor: pointer;
}
.ps-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--ps-accent);
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.2);
  cursor: pointer;
}

/* —— boolean toggle —— */
.ps-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.ps-switch-row .ps-label {
  margin-bottom: 0;
}
.ps-switch {
  position: relative;
  width: 34px;
  height: 19px;
  flex-shrink: 0;
}
.ps-switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}
.ps-slider {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #d8dce2;
  transition: background 0.18s ease;
}
.ps-slider::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.25);
  transition: transform 0.18s ease;
}
.ps-switch input:checked + .ps-slider {
  background: var(--ps-accent);
}
.ps-switch input:checked + .ps-slider::before {
  transform: translateX(15px);
}

/* —— select / text —— */
.ps-select,
.ps-text {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--ps-border);
  border-radius: 7px;
  font-size: 12px;
  color: var(--ps-text);
  background: #fbfcfd;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.ps-select:focus,
.ps-text:focus {
  border-color: var(--ps-accent);
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.14);
  background: #fff;
}

/* —— 状态值文本 —— */
.ps-mon {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
}

/* —— 空态 —— */
.ps-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 10px;
  color: var(--ps-muted);
}
.ps-empty-ico {
  font-size: 20px;
  opacity: 0.6;
}
.ps-empty p {
  margin: 0;
  font-size: 12px;
}
</style>
