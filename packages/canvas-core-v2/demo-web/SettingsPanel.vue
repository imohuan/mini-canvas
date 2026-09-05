<script setup lang="ts">
// SettingsPanel —— demo 宿主调试配置面板（对齐主项目 DynamicSettingsPanel 外观/交互）。
// 右上角折叠(tune/close)浮层；分 group 渲染字段；支持 boolean(switch)/select/color/slider。
// 改动实时写入传入的响应式 config 根对象(CanvasDemo 持有并注入 EDGE_VISUAL_KEY / CANVAS_PARAMS_KEY)。
import { ref } from 'vue'

/** config 根对象（CanvasDemo 传入，含 edge/handle 命名空间） */
const props = defineProps<{ model: Record<string, any> }>()

const collapsed = ref(true)

interface FieldDef {
  id: string
  title: string
  desc?: string
  section: string // model 上的命名空间，如 'edge' | 'handle'
  prop: string // 该命名空间内的属性
  type: 'boolean' | 'select' | 'color' | 'slider'
  options?: Array<{ title: string; value: string | number }>
  min?: number
  max?: number
  step?: number
  /** slider 前的比例系数：slider 整数步进，显示时除以 scale */
  scale?: number
}
interface GroupDef {
  name: string
  fields: FieldDef[]
}

// 字段声明（对齐 v1 PanelSettingDefinition 的 type/options/min/max/step 语义）。
// 连线外观的实时调试已改由 PluginSettingsPanel 走 ctx.settings（theme-default 插件申报，见 demo 装配）；
// 本面板保留"浮动端口"这一非插件配置项的宿主级调试。
const groups: GroupDef[] = [
  {
    name: '连接点',
    fields: [
      { id: 'handle.radius', title: '区域半径', section: 'handle', prop: 'handleRadius', type: 'slider', min: 40, max: 140, step: 1 },
      { id: 'handle.rest', title: '归位偏移', section: 'handle', prop: 'handleRestOffset', type: 'slider', min: 16, max: 80, step: 1 },
      { id: 'handle.gap', title: '鼠标错开', section: 'handle', prop: 'handleCursorGap', type: 'slider', min: 6, max: 60, step: 1 },
      { id: 'handle.button', title: '圆球尺寸', section: 'handle', prop: 'handleButtonSize', type: 'slider', min: 22, max: 52, step: 1 },
    ],
  },
]

// 折叠图标（对齐主项目 material tune/close）
const TuneIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" stroke-linecap="round"/></svg>`
const CloseIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>`

function read(f: FieldDef): unknown {
  return props.model[f.section]?.[f.prop]
}
function write(f: FieldDef, v: unknown): void {
  const sec = props.model[f.section]
  if (sec) sec[f.prop] = v
}
/** slider 输入条当前值 = 实际值 × scale（input 以整数步进工作） */
function sliderValue(f: FieldDef): number {
  const v = Number(read(f))
  const scale = f.scale || 1
  return Math.round((v * scale) * 100) / 100
}
/** 展示给用户看的是实际存储值（model 已存真实值；scale 只用于 slider 的整数化位置） */
function displayValue(f: FieldDef): string {
  const v = Number(read(f))
  return String(Number.isInteger(v) ? v : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''))
}
function sliderInput(f: FieldDef, e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value)
  const scale = f.scale || 1
  const v = raw / scale
  // step 0.5(线宽) 需保留：用已除 scale 的 step
  const step = f.step ?? 1
  write(f, Math.round(v / step) * step)
}
</script>

<template>
  <div class="ax-panel" :class="{ collapsed }">
    <div class="ax-panel-hd">
      <button class="ax-toggle" title="调试配置" @click="collapsed = !collapsed" v-html="collapsed ? TuneIcon : CloseIcon"></button>
    </div>

    <Transition name="panel-expand">
      <div v-if="!collapsed" class="ax-panel-bd">
        <template v-for="g in groups" :key="g.name">
          <div class="ax-panel-group">
            <div class="ax-panel-group-title">{{ g.name }}</div>

            <div v-for="f in g.fields" :key="f.id" class="ax-setting-field">
              <!-- boolean: switch 行 -->
              <div v-if="f.type === 'boolean'" class="ax-switch-row">
                <span class="ax-switch-label">{{ f.title }}</span>
                <button
                  class="ax-switch"
                  :class="{ on: !!read(f) }"
                  role="switch"
                  :aria-checked="!!read(f)"
                  @click="write(f, !read(f))"
                ><span class="ax-switch-knob"></span></button>
              </div>

              <!-- select -->
              <template v-else-if="f.type === 'select'">
                <label class="ax-field-title">{{ f.title }}</label>
                <select class="ax-select" :value="String(read(f))" @change="write(f, ($event.target as HTMLSelectElement).value)">
                  <option v-for="o in f.options" :key="String(o.value)" :value="String(o.value)">{{ o.title }}</option>
                </select>
              </template>

              <!-- color -->
              <template v-else-if="f.type === 'color'">
                <label class="ax-field-title">{{ f.title }}</label>
                <div class="ax-color-wrap">
                  <input class="ax-color-input" type="color" :value="String(read(f))" @input="write(f, ($event.target as HTMLInputElement).value)" />
                  <span class="ax-color-value">{{ read(f) }}</span>
                </div>
              </template>

              <!-- slider -->
              <template v-else-if="f.type === 'slider'">
                <div class="ax-slider-row">
                  <label class="ax-field-title">{{ f.title }}</label>
                  <span class="ax-slider-val">{{ displayValue(f) }}</span>
                </div>
                <input class="ax-slider" type="range"
                  :min="(f.min ?? 0) * (f.scale || 1)"
                  :max="(f.max ?? 100) * (f.scale || 1)"
                  :step="(f.step ?? 1) * (f.scale || 1)"
                  :value="sliderValue(f)"
                  @input="sliderInput(f, $event)"
                />
              </template>
            </div>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ax-panel {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 16px;
  width: 280px;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: system-ui, "Microsoft YaHei", sans-serif;
  transition: width 0.25s ease;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
}
.ax-panel.collapsed {
  width: 44px;
  border-radius: 50%;
}
.ax-panel-hd {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
  transition: padding 0.2s ease, border-color 0.2s ease;
}
.ax-panel.collapsed .ax-panel-hd {
  justify-content: center;
  padding: 6px;
  border-bottom-color: transparent;
}
.ax-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
}
.ax-toggle:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111827;
}
.ax-panel-bd {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  scrollbar-width: thin;
}
.ax-panel-group {
  margin-bottom: 14px;
}
.ax-panel-group:last-child {
  margin-bottom: 0;
}
.ax-panel-group-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #9ca3af;
  text-transform: uppercase;
  padding: 2px 0;
  margin-bottom: 2px;
}
.ax-setting-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0;
}
.ax-field-title {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  line-height: 16px;
}
.ax-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
}
.ax-switch-label {
  font-size: 12px;
  color: #374151;
  flex: 1;
}
.ax-switch {
  position: relative;
  width: 32px;
  height: 18px;
  border: none;
  border-radius: 9999px;
  background: #d1d5db;
  cursor: pointer;
  padding: 0;
  transition: background 160ms ease;
  flex-shrink: 0;
}
.ax-switch.on {
  background: #3b82f6;
}
.ax-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: left 160ms ease;
}
.ax-switch.on .ax-switch-knob {
  left: 16px;
}
.ax-select {
  width: 100%;
  padding: 5px 8px;
  font-size: 12px;
  color: #374151;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
}
.ax-select:focus {
  border-color: #3b82f6;
}
.ax-color-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ax-color-input {
  width: 28px;
  height: 24px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
  padding: 2px;
  background: transparent;
}
.ax-color-value {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #2563eb;
}
.ax-slider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ax-slider-val {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #2563eb;
}
.ax-slider {
  width: 100%;
  accent-color: #3b82f6;
}

.panel-expand-enter-active,
.panel-expand-leave-active {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  overflow: hidden;
}
.panel-expand-enter-from,
.panel-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
