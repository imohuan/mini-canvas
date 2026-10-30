<script setup lang="ts">
/**
 * Dropdown 的专属试玩组件。
 *
 * 预览区：可拖动的触发器。拖拽时浮层跟着走，用来直观看方向、翻转和箭头。
 * 配置区：用 Teleport 渲染到预览页右栏；默认值、字段、预设仍读 playground.ts。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import Button from '../button/Button.vue'
import Input from '../input/Input.vue'
import NumberInput from '../number/NumberInput.vue'
import Slider from '../slider/Slider.vue'
import Switch from '../switch/Switch.vue'
import Tabs from '../tabs/Tabs.vue'
import Dropdown from './Dropdown.vue'
import { dropdownPlayground } from './playground'
import { readNumber } from '../../preview/playground'
import type { PlaygroundField, PlaygroundValue } from '../../preview/playground'
import type { DropdownAnchor, DropdownLayout, DropdownTrigger } from './types'
import type { TabItem } from '../tabs/types'
import './dropdown-playground.css'

type DemoState = Record<string, PlaygroundValue>

const props = withDefaults(defineProps<{
  /** 配置面板的 Teleport 目标；没有目标时退化成行内说明 */
  configTarget?: string | null
}>(), {
  configTarget: null,
})

const config = dropdownPlayground
const fields = config.fields
const presets = config.presets ?? []
const state = reactive<DemoState>({ ...config.defaults })

/* ---- 演示区 ---- */
const open = ref(false)
const picked = ref('')
const stage = ref<HTMLElement | null>(null)
/** 预览区全屏（Fullscreen API）；全屏时下拉面板要 Teleport 进预览区，否则看不见。 */
const fullscreen = ref(false)
const dropdownHost = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
let grab = { x: 0, y: 0, ox: 0, oy: 0 }

const items = computed(() => {
  const count = Math.min(Math.max(readNumber(state, 'itemCount', 6), 1), 30)
  return Array.from({ length: count }, (_, index) => ({
    id: 'item-' + (index + 1),
    label: index === 0 ? '重命名' : index === 1 ? '复制' : '菜单项 ' + (index + 1),
    disabled: index === 2 && count > 4,
  }))
})

const triggerLabel = computed(() => {
  if (state.disabled === true) return '已禁用'
  if (state.trigger === 'always') return '常显菜单'
  if (state.trigger === 'hover') return '悬停打开'
  if (state.trigger === 'contextmenu') return '右键打开'
  return '打开菜单'
})

/** 常显模式强制 open 为 true；其他模式跟随用户点击。 */
const openValue = computed({
  get: () => state.trigger === 'always' ? true : open.value,
  set: (value) => {
    open.value = value
  },
})

watch(open, (value) => {
  // 常显时无论谁把 open 改成 false（外点、Esc、slot close），都立刻拉回 true。
  if (state.trigger === 'always' && value === false) open.value = true
})

const dropdownProps = computed(() => ({
  trigger: (state.trigger === 'hover' || state.trigger === 'contextmenu' || state.trigger === 'always' ? state.trigger : 'click') as DropdownTrigger,
  placement: (typeof state.placement === 'string' ? state.placement : 'bottom-start') as DropdownAnchor,
  align: (state.align === 'start' || state.align === 'center' || state.align === 'end' ? state.align : 'auto') as 'auto' | 'start' | 'center' | 'end',
  offset: numberValue('offset') ?? 6,
  matchWidth: state.matchWidth === true,
  arrow: state.arrow === true,
  bare: state.bare === true,
  disabled: state.disabled === true,
  layout: (state.layout === 'inner-scroll' ? 'inner-scroll' : 'overlay-scroll') as DropdownLayout,
  menuWidth: typeof state.menuWidth === 'string' ? state.menuWidth : '',
  menuHeight: typeof state.menuHeight === 'string' ? state.menuHeight : '',
  menuMinWidth: typeof state.menuMinWidth === 'string' ? state.menuMinWidth : '',
  menuMaxWidth: typeof state.menuMaxWidth === 'string' ? state.menuMaxWidth : '',
  menuMaxHeight: typeof state.menuMaxHeight === 'string' ? state.menuMaxHeight : '',
}))

const dragStyle = computed(() => ({
  transform: 'translate3d(' + offsetX.value + 'px, ' + offsetY.value + 'px, 0)',
}))

/** 拖动范围按预览区实际尺寸算，缩窄侧栏也不会把触发器拖丢。 */
function clampToStage(x: number, y: number): { x: number; y: number } {
  const box = stage.value?.getBoundingClientRect()
  const size = trigger.value?.getBoundingClientRect()
  if (!box || !size) return { x, y }
  const maxX = Math.max(0, (box.width - size.width) / 2 - 10)
  const maxY = Math.max(0, (box.height - size.height) / 2 - 10)
  return { x: Math.min(Math.max(x, -maxX), maxX), y: Math.min(Math.max(y, -maxY), maxY) }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  grab = { x: event.clientX, y: event.clientY, ox: offsetX.value, oy: offsetY.value }
  dragging.value = true
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const dx = event.clientX - grab.x
  const dy = event.clientY - grab.y
  if (Math.hypot(dx, dy) < 4) return
  // 只有真的拖起来才捕获指针。按下就捕获会把随后的 click 重定向到容器，
  // 按钮自己的 click 收不到，下拉永远打不开（浏览器实测出来的坑）。
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  const next = clampToStage(grab.ox + dx, grab.oy + dy)
  offsetX.value = next.x
  offsetY.value = next.y
}

function onPointerUp(): void {
  dragging.value = false
}

/** 拖动结束后浏览器仍会派发 click；这时不能把下拉打开/关掉。 */
function recenter(): void {
  offsetX.value = 0
  offsetY.value = 0
  open.value = false
}

/** 进入 / 退出预览区全屏。退出后面板 Teleport 目标回到 body。 */
async function toggleFullscreen(): Promise<void> {
  const host = stage.value
  if (!host) return
  if (!fullscreen.value) {
    await host.requestFullscreen?.()
  } else {
    await document.exitFullscreen?.()
  }
}

watch(fullscreen, (on) => {
  // 全屏元素是 stage 本身；面板挂进 stage 的直接子层，跟随缩放。
  dropdownHost.value = on ? stage.value : null
})

// 用户按 Esc 退出全屏时，浏览器不会通知 Vue；监听事件同步状态。
function onFullscreenChange(): void {
  fullscreen.value = document.fullscreenElement === stage.value
}

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

function resetAll(): void {
  Object.assign(state, config.defaults)
  picked.value = ''
  recenter()
}

function applyPreset(patch: Record<string, PlaygroundValue>): void {
  Object.assign(state, config.defaults, patch)
  open.value = false
}

function pick(label: string): void {
  picked.value = label
  open.value = false
}

/* ---- 通用字段控件 ---- */
function setValue(key: string, value: PlaygroundValue): void {
  ;(state as Record<string, PlaygroundValue>)[key] = value
}

function numberValue(key: string): number | null {
  const value = state[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toNumber(value: number | null): number {
  return typeof value === 'number' ? value : 0
}

function segmentItems(field: Extract<PlaygroundField, { kind: 'segment' }>): TabItem[] {
  return field.options.map((option) => ({ value: option.value, label: option.label }))
}

function rangeLabel(field: Extract<PlaygroundField, { kind: 'range' }>): string {
  const raw = state[field.key]
  const value = typeof raw === 'number' ? raw : field.min
  if (field.unit === '%') return Math.round(value * 100) + '%'
  return value + (field.unit ?? '')
}

/** 按 group 把字段切成小段，配置面板更好扫。 */
const groupedFields = computed(() => {
  const groups: Array<{ name: string; fields: PlaygroundField[] }> = []
  for (const field of fields) {
    const name = field.group ?? '其他'
    const last = groups[groups.length - 1]
    if (last?.name === name) last.fields.push(field)
    else groups.push({ name, fields: [field] })
  }
  return groups
})
</script>

<template>
  <div class="dd-demo">
    <div ref="stage" class="dd-stage">
      <div class="dd-grid" aria-hidden="true"></div>
      <div class="dd-center-dot" aria-hidden="true"></div>

      <div
        ref="trigger"
        class="dd-anchor"
        :class="{ 'is-dragging': dragging }"
        :style="dragStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <Dropdown
          :model-value="openValue"
          :append-to="dropdownHost ?? 'body'"
          @update:model-value="openValue = $event"
          v-bind="dropdownProps"
        >
          <template #trigger="{ open: isOpen }">
            <Button variant="secondary" :aria-expanded="isOpen" class="dd-trigger" data-demo-trigger>
              <span class="dd-trigger__grip" aria-hidden="true">⠿</span>
              {{ triggerLabel }}
            </Button>
          </template>
          <template #default="{ close }">
            <div class="dd-menu">
              <div class="dd-menu__head">
                <span>{{ picked ? '已选：' + picked : '试试点下面的条目' }}</span>
                <span class="dd-menu__count">{{ items.length }} 项</span>
              </div>
              <button
                v-for="item in items"
                :key="item.id"
                type="button"
                :disabled="item.disabled"
                @click="pick(item.label)"
              >
                <span>{{ item.label }}</span>
                <kbd v-if="state.showShortcut === true" aria-hidden="true">↵</kbd>
              </button>
              <button type="button" class="dd-menu__close" @click="close()">关闭菜单</button>
            </div>
          </template>
        </Dropdown>
      </div>

      <div class="dd-hud">
        <span>{{ dragging ? '拖动中，浮层跟着走' : '按住按钮拖动试试' }}</span>
        <div class="dd-hud__actions">
          <button type="button" @click="recenter">回到中心</button>
          <button type="button" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏' }}</button>
        </div>
      </div>
    </div>

    <Teleport v-if="configTarget" :to="configTarget">
      <div class="dd-panel">
        <div class="dd-panel__head">
          <div>
            <span class="dd-panel__eyebrow">组件配置</span>
            <h2>调一调看看</h2>
          </div>
          <Button variant="ghost" size="sm" @click="resetAll">恢复默认</Button>
        </div>

        <section v-for="group in groupedFields" :key="group.name" class="dd-group">
          <h3 class="dd-group__title">{{ group.name }}</h3>

          <template v-for="field in group.fields" :key="field.key">
            <div v-if="field.kind === 'text'" class="dd-field">
              <label :for="'dd-field-' + field.key">{{ field.label }}</label>
              <Input
                :id="'dd-field-' + field.key"
                :model-value="String(state[field.key] ?? '')"
                :placeholder="field.placeholder"
                :maxlength="field.maxlength"
                :aria-label="field.label"
                @update:model-value="setValue(field.key, $event)"
              />
              <p v-if="field.hint" class="dd-hint">{{ field.hint }}</p>
            </div>

            <div v-else-if="field.kind === 'number'" class="dd-field">
              <label :for="'dd-field-' + field.key">{{ field.label }}</label>
              <NumberInput
                :id="'dd-field-' + field.key"
                :model-value="numberValue(field.key)"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                :suffix="field.suffix"
                :aria-label="field.label"
                @update:model-value="setValue(field.key, toNumber($event))"
              />
              <p v-if="field.hint" class="dd-hint">{{ field.hint }}</p>
            </div>

            <fieldset v-else-if="field.kind === 'segment'" class="dd-fieldset">
              <legend>{{ field.label }}</legend>
              <Tabs
                :model-value="String(state[field.key] ?? '')"
                :items="segmentItems(field)"
                :aria-label="field.label"
                block
                @update:model-value="setValue(field.key, $event)"
              />
              <p v-if="field.hint" class="dd-hint">{{ field.hint }}</p>
            </fieldset>

            <div v-else-if="field.kind === 'toggle'" class="dd-field">
              <Switch
                :model-value="state[field.key] === true"
                :label="field.label"
                @update:model-value="setValue(field.key, $event)"
              />
              <p v-if="field.hint" class="dd-hint">{{ field.hint }}</p>
            </div>

            <div v-else-if="field.kind === 'range'" class="dd-field">
              <span class="dd-field__label">{{ field.label }} <b>{{ rangeLabel(field) }}</b></span>
              <Slider
                :model-value="numberValue(field.key) ?? field.min"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                :show-value="false"
                :aria-label="field.label"
                @update:model-value="setValue(field.key, toNumber($event))"
              />
            </div>
          </template>

        </section>

        <div class="dd-presets">
          <div class="dd-presets__head">
            <span class="dd-panel__eyebrow">常用组合</span>
            <span>点一下套用</span>
          </div>
          <button v-for="preset in presets" :key="preset.id" type="button" class="dd-preset" @click="applyPreset(preset.patch)">
            <span class="dd-preset__dot" aria-hidden="true"></span>
            <span class="dd-preset__copy">
              <strong>{{ preset.name }}</strong>
              <small>{{ preset.description }}</small>
            </span>
            <span class="dd-preset__add" aria-hidden="true">+</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
