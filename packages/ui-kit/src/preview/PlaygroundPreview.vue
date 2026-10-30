<script setup lang="ts">
/**
 * 预览区渲染器：按组件 id 渲染对应的「真实组件」示例。
 *
 * 每个分支只负责把 state 映射成 props；可调项由 playgrounds/<id>.ts 声明。
 * 这样加组件时页面不用改，只补一支渲染 + 一份配置。
 */
import { computed, ref } from 'vue'
import {
  Button, ButtonGroup, Confirm, ContextMenu, Dialog, Dropdown, Input,
  MessagesHost, NotifyHost, NumberInput, Popover, Select, Slider, SplitPane,
  Switch, Tabs, Tooltip, UiKitProvider, message, notify,
} from '../index'
import type { ContextMenuItem, SelectOption, TabItem, UiKitTone } from '../index'
import { readBool, readNumber, readSize, readText } from './playground'

/** 把面板里的色调字符串收成 UiKitTone，未知值回落到 fallback。 */
function readTone(value: string, fallback: UiKitTone): UiKitTone {
  const allowed: UiKitTone[] = ['neutral', 'primary', 'success', 'warning', 'danger', 'info']
  return allowed.includes(value as UiKitTone) ? (value as UiKitTone) : fallback
}

const props = defineProps<{
  /** 当前组件 id */
  id: string
  /** 右侧面板当前参数 */
  state: Record<string, unknown>
}>()

/** 统一把 unknown 记录收敛成类型安全的读取器。 */
const state = computed(() => props.state as Record<string, import('./playground').PlaygroundValue>)

/* ---- 交互用的临时状态 ---- */
const inputValue = ref('搜索画布')
const numberValue = ref(6)
const sliderValue = ref(40)
const switchValue = ref(true)
const tabValue = ref('preview')
const selectValue = ref<string | number | null>('image')
const dropdownOpen = ref(false)
const popoverOpen = ref(false)
const dialogOpen = ref(false)
const confirmOpen = ref(false)
const splitText = computed(() => readText(state.value, 'leftLabel') || '左边内容')

/* ---- 选项数据 ---- */
const selectOptions = computed<SelectOption[]>(() => {
  const grouped = readBool(state.value, 'grouped')
  return [
    { value: 'image', label: '图片', description: 'PNG / JPG', group: grouped ? '媒体' : undefined },
    { value: 'video', label: '视频', description: 'MP4 / WEBM', group: grouped ? '媒体' : undefined },
    { value: 'audio', label: '音频', description: 'MP3 / WAV', group: grouped ? '媒体' : undefined },
    { value: 'canvas', label: '画布', description: '空白画布', group: grouped ? '其他' : undefined },
    { value: 'archive', label: '压缩包', description: 'ZIP', group: grouped ? '其他' : undefined },
  ]
})

const tabItems = computed<TabItem[]>(() => {
  const items: TabItem[] = [
    { value: 'preview', label: '预览' },
    { value: 'code', label: '代码' },
    { value: 'docs', label: '文档' },
  ]
  if (readBool(state.value, 'showBadge')) items[1] = { value: 'code', label: '代码', badge: 3 }
  if (readBool(state.value, 'showDisabled')) items.push({ value: 'settings', label: '设置', disabled: true })
  return items
})

const menuItems = computed(() => {
  const count = Math.min(Math.max(readNumber(state.value, 'itemCount', 6), 1), 14)
  const items: ContextMenuItem[] = []
  for (let i = 1; i <= count; i += 1) items.push({ id: 'op-' + i, label: i === 1 ? '操作一' : i === 2 ? '操作二' : '长列表 ' + (i - 2) })
  return items
})

const contextItems = computed<ContextMenuItem[]>(() => {
  const s = state.value
  const icon = (name: string): string | undefined => readBool(s, 'showIcons') ? name : undefined
  const shortcut = (key: string): string | undefined => readBool(s, 'showShortcut') ? key : undefined
  const items: ContextMenuItem[] = [
    { id: 'open', label: '打开', icon: icon('↗'), shortcut: shortcut('Enter'), group: 'main' },
    { id: 'rename', label: '重命名', icon: icon('✎'), shortcut: shortcut('F2'), group: 'main' },
  ]
  if (readBool(s, 'showSubmenu')) {
    items.push({ id: 'theme', label: '主题', icon: icon('🎨'), group: 'main', children: [
      { id: 'theme-dark', label: '深色' },
      { id: 'theme-light', label: '浅色' },
    ] })
  }
  items.push({ id: 'copy', label: '复制', icon: icon('⧉'), shortcut: shortcut('Ctrl+C'), group: 'edit' })
  if (readBool(s, 'showDisabled')) items.push({ id: 'paste', label: '粘贴', icon: icon('⎘'), shortcut: shortcut('Ctrl+V'), group: 'edit', disabled: true })
  if (readBool(s, 'showDanger')) items.push({ id: 'delete', label: '删除', icon: icon('🗑'), shortcut: shortcut('Del'), group: 'danger', danger: true })
  return items
})

const contextMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

function openContextMenu(event: MouseEvent): void {
  contextMenuRef.value?.showAt(event.clientX, event.clientY)
}

function fireNotify(): void {
  const duration = readBool(state.value, 'sticky') ? 0 : readNumber(state.value, 'duration', 3600)
  notify({
    title: readText(state.value, 'title') || '通知',
    description: readText(state.value, 'description') || undefined,
    tone: readTone(readText(state.value, 'tone'), 'success'),
    duration,
    action: readBool(state.value, 'withAction')
      ? { label: readText(state.value, 'actionLabel') || '撤销', onClick: () => undefined }
      : undefined,
  })
}

function fireMessage(): void {
  message({
    text: readText(state.value, 'text') || '提示',
    tone: readTone(readText(state.value, 'tone'), 'neutral'),
    duration: readNumber(state.value, 'duration', 2400),
  })
}
</script>

<template>
  <div class="pg" :class="{ 'is-stretch': id === 'input' || id === 'select' || id === 'tabs' || id === 'slider' || id === 'split-pane' }">
    <!-- Button -->
    <template v-if="id === 'button'">
      <Button
        :variant="(readText(state, 'variant') || 'primary') as 'primary' | 'secondary' | 'ghost' | 'danger'"
        :size="readSize(state)"
        :block="readBool(state, 'block')"
        :round="readBool(state, 'round')"
        :disabled="readBool(state, 'disabled')"
        :loading="readBool(state, 'loading')"
        :aria-label="readBool(state, 'iconOnly') ? readText(state, 'label') || '按钮' : undefined"
      >
        <template v-if="readBool(state, 'showIcon') || readBool(state, 'iconOnly')" #icon>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
          </svg>
        </template>
        <template v-if="!readBool(state, 'iconOnly')">{{ readText(state, 'label') || '按钮' }}</template>
      </Button>
    </template>

    <!-- ButtonGroup -->
    <template v-else-if="id === 'button-group'">
      <ButtonGroup
        :orientation="(readText(state, 'orientation') || 'horizontal') as 'horizontal' | 'vertical'"
        :size="readSize(state)"
        :attached="readBool(state, 'attached')"
        :block="readBool(state, 'block')"
        aria-label="示例按钮组"
      >
        <Button variant="secondary">复制</Button>
        <Button variant="ghost">剪切</Button>
        <Button variant="ghost">粘贴</Button>
      </ButtonGroup>
    </template>

    <!-- Input -->
    <template v-else-if="id === 'input'">
      <div class="pg-field">
        <Input
          v-model="inputValue"
          :size="readSize(state)"
          :type="(readText(state, 'type') || 'text') as 'text' | 'password' | 'email' | 'search' | 'url' | 'tel'"
          :placeholder="readText(state, 'placeholder')"
          :clearable="readBool(state, 'clearable')"
          :disabled="readBool(state, 'disabled')"
          :readonly="readBool(state, 'readonly')"
          :invalid="readBool(state, 'invalid')"
          :error="readText(state, 'error')"
          :hint="readText(state, 'hint')"
          aria-label="示例输入框"
        />
      </div>
    </template>

    <!-- NumberInput -->
    <template v-else-if="id === 'number'">
      <NumberInput
        v-model="numberValue"
        :size="readSize(state)"
        :min="readNumber(state, 'min', 0)"
        :max="readNumber(state, 'max', 100)"
        :step="readNumber(state, 'step', 1)"
        :precision="readNumber(state, 'precision', 0)"
        :suffix="readText(state, 'suffix')"
        :controls="readBool(state, 'controls')"
        :disabled="readBool(state, 'disabled')"
        :readonly="readBool(state, 'readonly')"
        :invalid="readBool(state, 'invalid')"
      />
    </template>

    <!-- Slider -->
    <template v-else-if="id === 'slider'">
      <div class="pg-field">
        <Slider
          v-model="sliderValue"
          :size="readSize(state)"
          :min="readNumber(state, 'min', 0)"
          :max="readNumber(state, 'max', 100)"
          :step="readNumber(state, 'step', 1)"
          :show-value="readBool(state, 'showValue')"
          :disabled="readBool(state, 'disabled')"
          :format="(v: number) => v + readText(state, 'suffix')"
          aria-label="示例滑块"
        />
      </div>
    </template>

    <!-- Switch -->
    <template v-else-if="id === 'switch'">
      <div class="pg-stack">
        <Switch
          v-model="switchValue"
          :size="readSize(state)"
          :label="readText(state, 'label')"
          :description="readText(state, 'description')"
          :disabled="readBool(state, 'disabled')"
          :loading="readBool(state, 'loading')"
        />
      </div>
    </template>

    <!-- Tabs -->
    <template v-else-if="id === 'tabs'">
      <div class="pg-field">
        <Tabs
          v-model="tabValue"
          :items="tabItems"
          :size="readSize(state)"
          :block="readBool(state, 'block')"
          aria-label="示例选项卡"
        />
      </div>
    </template>

    <!-- Select -->
    <template v-else-if="id === 'select'">
      <div class="pg-field">
        <Select
          v-model="selectValue"
          :options="selectOptions"
          :size="readSize(state)"
          :searchable="readBool(state, 'searchable')"
          :clearable="readBool(state, 'clearable')"
          :disabled="readBool(state, 'disabled')"
          :invalid="readBool(state, 'invalid')"
          :error="readText(state, 'error')"
          aria-label="示例选择器"
        />
      </div>
    </template>

    <!-- Dropdown -->
    <template v-else-if="id === 'dropdown'">
      <Dropdown
        v-model="dropdownOpen"
        :trigger="(readText(state, 'trigger') || 'click') as 'click' | 'hover' | 'contextmenu'"
        :placement="(readText(state, 'placement') || 'bottom-start') as 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start'"
        :offset="readNumber(state, 'offset', 6)"
        :match-width="readBool(state, 'matchWidth')"
        :menu-min-width="readText(state, 'menuMinWidth') || '220px'"
        :menu-max-height="readText(state, 'menuMaxHeight') || '220px'"
        :disabled="readBool(state, 'disabled')"
      >
        <template #trigger="{ open }">
          <Button variant="secondary" :aria-expanded="open">打开菜单</Button>
        </template>
        <template #default="{ close }">
          <div class="pg-menu">
            <button v-for="item in menuItems" :key="item.id" type="button" @click="close()">{{ item.label }}</button>
          </div>
        </template>
      </Dropdown>
    </template>

    <!-- Popover -->
    <template v-else-if="id === 'popover'">
      <Popover
        v-model="popoverOpen"
        :title="readText(state, 'title')"
        :description="readText(state, 'description')"
        :placement="(readText(state, 'placement') || 'bottom-start') as 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start'"
        :offset="readNumber(state, 'offset', 8)"
        :width="readText(state, 'width') || '340px'"
        :close-on-outside="readBool(state, 'closeOnOutside')"
        :close-on-escape="readBool(state, 'closeOnEscape')"
        :disabled="readBool(state, 'disabled')"
      >
        <template #trigger="{ toggle }">
          <Button variant="secondary" @click="toggle()">打开 Popover</Button>
        </template>
        <template #default>
          <div class="pg-stack">
            <Input placeholder="新名称" aria-label="新名称" />
            <p class="pg-hint">点外部、Esc 或右上角 × 都能关闭。</p>
          </div>
        </template>
      </Popover>
    </template>

    <!-- Tooltip -->
    <template v-else-if="id === 'tooltip'">
      <Tooltip
        :content="readText(state, 'content')"
        :placement="(readText(state, 'placement') || 'top') as 'top' | 'right' | 'bottom' | 'left'"
        :delay="readNumber(state, 'delay', 180)"
        :max-width="readText(state, 'maxWidth') || '280px'"
        :focusable="readBool(state, 'focusable')"
        :disabled="readBool(state, 'disabled')"
      >
        <Button variant="secondary">{{ readText(state, 'buttonLabel') || '悬停我' }}</Button>
      </Tooltip>
    </template>

    <!-- ContextMenu -->
    <template v-else-if="id === 'context-menu'">
      <div class="pg-ctx" @contextmenu.prevent="openContextMenu">
        {{ readText(state, 'hint') || '在这块区域点右键' }}
      </div>
      <ContextMenu ref="contextMenuRef" :items="contextItems" @select="() => undefined" />
    </template>

    <!-- Dialog -->
    <template v-else-if="id === 'dialog'">
      <Button variant="primary" @click="dialogOpen = true">打开对话框</Button>
      <Dialog
        v-model="dialogOpen"
        :title="readText(state, 'title')"
        :description="readText(state, 'description')"
        :width="readText(state, 'width') || '480px'"
        :show-close="readBool(state, 'showClose')"
        :close-on-overlay="readBool(state, 'closeOnOverlay')"
        :close-on-escape="readBool(state, 'closeOnEscape')"
        :lock-scroll="readBool(state, 'lockScroll')"
      >
        <div class="pg-stack">
          <Input placeholder="画布名称" aria-label="画布名称" />
          <Input placeholder="备注" aria-label="备注" />
          <template v-if="readBool(state, 'longContent')">
            <p v-for="i in 12" :key="i" class="pg-hint">
              长内容示例第 {{ i }} 段：对话框内部滚动，遮罩会锁定背景滚动。窄屏时面板自动贴近屏幕边缘，仍保留安全边距。
            </p>
          </template>
        </div>
        <template #footer="{ close }">
          <Button variant="ghost" @click="close()">取消</Button>
          <Button variant="primary" @click="close()">保存</Button>
        </template>
      </Dialog>
    </template>

    <!-- Confirm -->
    <template v-else-if="id === 'confirm'">
      <Button variant="danger" @click="confirmOpen = true">删除画布</Button>
      <Confirm
        v-model="confirmOpen"
        :title="readText(state, 'title')"
        :description="readText(state, 'description')"
        :confirm-text="readText(state, 'confirmText')"
        :cancel-text="readText(state, 'cancelText')"
        :danger="readBool(state, 'danger')"
        :loading="readBool(state, 'loading')"
      >
        <p v-if="readText(state, 'body')" class="pg-hint">{{ readText(state, 'body') }}</p>
      </Confirm>
    </template>

    <!-- Notify -->
    <template v-else-if="id === 'notify'">
      <NotifyHost />
      <Button variant="secondary" @click="fireNotify">发一条通知</Button>
    </template>

    <!-- Messages -->
    <template v-else-if="id === 'messages'">
      <MessagesHost />
      <Button variant="secondary" @click="fireMessage">显示轻提示</Button>
    </template>

    <!-- SplitPane -->
    <template v-else-if="id === 'split-pane'">
      <div class="pg-split-frame">
        <SplitPane
          :direction="(readText(state, 'direction') || 'horizontal') as 'horizontal' | 'vertical'"
          :initial="readNumber(state, 'initial', 0.5)"
          :min-left="readNumber(state, 'minLeft', 120)"
          :min-right="readNumber(state, 'minRight', 120)"
          :snap="readNumber(state, 'snap', 48)"
        >
          <template #left><div class="pg-split-pane">{{ splitText }}</div></template>
          <template #right><div class="pg-split-pane">{{ readText(state, 'rightLabel') || '右边内容' }}</div></template>
        </SplitPane>
      </div>
    </template>

    <!-- Provider -->
    <template v-else-if="id === 'provider'">
      <UiKitProvider
        :size="readSize(state)"
        :density="(readText(state, 'density') || 'comfortable') as 'compact' | 'comfortable' | 'spacious'"
        :radius="readNumber(state, 'radius', 10)"
        :dark="readBool(state, 'dark')"
        :accent="readText(state, 'accent') || '#22b8d8'"
        class="pg-provider-surface"
      >
        <div class="pg-row">
          <Button variant="primary">主要</Button>
          <Button variant="secondary">次要</Button>
          <Button variant="ghost">轻量</Button>
          <Input placeholder="输入框" aria-label="示例输入框" />
        </div>
      </UiKitProvider>
    </template>

    <!-- 兜底：没有预览分支时明确说出来 -->
    <p v-else class="pg-fallback">这个组件的预览还没接上，可以直接在下方文档里试。</p>
  </div>
</template>

<style scoped>
.pg {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 100%;
}

.pg.is-stretch {
  flex-direction: column;
  /*
   * 只让外层吃满预览区，里面的输入框/滑块本身保持固定宽度并居中。
   * 用 stretch 会把 min(380px,100%) 的容器顶到左边，看起来像左对齐。
   */
  align-items: center;
}

.pg-field {
  width: min(380px, 100%);
}

.pg-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pg-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.pg-hint {
  margin: 0;
  color: var(--mck-ink-muted, #6b7280);
  font-size: 12px;
  line-height: 1.7;
}

.pg-menu {
  display: flex;
  flex-direction: column;
  min-width: 160px;
}

.pg-menu button {
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.pg-menu button:hover {
  background: var(--mck-hover, rgb(0 0 0 / 0.06));
}

.pg-ctx {
  display: grid;
  width: min(420px, 100%);
  min-height: 120px;
  place-items: center;
  border: 1px dashed var(--mck-line);
  border-radius: 10px;
  color: var(--mck-ink-muted, #6b7280);
  font-size: 12px;
}

.pg-split-frame {
  width: min(560px, 100%);
  height: 220px;
  overflow: hidden;
  border: 1px solid var(--mck-line);
  border-radius: 10px;
}

.pg-split-pane {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--mck-ink-muted, #6b7280);
  font-size: 12px;
}

.pg-provider-surface {
  width: min(520px, 100%);
  padding: 18px;
  border-radius: 12px;
  background: var(--mck-panel, #fff);
}

.pg-fallback {
  margin: 0;
  color: var(--mck-ink-muted, #6b7280);
  font-size: 12px;
}
</style>
