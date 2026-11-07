<script setup lang="ts">
import { computed } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { AiActionConfig } from '../aiActions'
import type { ModelIcon } from './modelIcons'
import { ICON_AT } from './icons'

const props = defineProps<{
  id: string
  currentId: string
  currentActionLabel: string
  running: boolean
  paramDefs: ToolParamDef[]
  values: Record<string, unknown>
  aiButtons: Array<AiActionConfig & { icon: string }>
  aiRunningId: string | null
  aiError: string
  showEditor: boolean
  charCount: number
  charLimit: number
  invalidHint: string
  canRun: boolean
  submitted: boolean
  currentActionTitle: string
  iconWarn: string
  iconSend: string
  actionOptions: Array<{ value: string; label: string; model: ModelIcon }>
  /** 参数区交给 provider 的 HTML 面板时，不再画默认的参数摘要按钮 */
  hideParams?: boolean
  /** 当前动作的模型图标（触发器左侧），没有动作时为 null */
  currentModelIcon: ModelIcon | null
  /** 是否用 Agent 的模型选择器代替动作下拉（文本节点） */
  hasModelPicker?: boolean
}>()

const emit = defineEmits<{
  actionPicked: [value: string | number]
  fieldChange: [key: string, value: string | number | boolean]
  aiClick: [action: AiActionConfig]
  /** 最左侧「@」按钮：在光标处插入一个 @（会直接打开编辑器的 @ 下拉） */
  insertAt: []
  run: []
}>()

const ToolParamGroup = useUiComponent('toolParamGroup')
const Button = useUiComponent('Button')
/**
 * 模型下拉改用 DropdownMenu（用户 2026-11-06 指定）。
 *
 * 为什么不再用 Select：底栏浮在画布上，为了「点画布不被遮住」关掉了 body-lock 与
 * outside-pointer-events；而 reka 的 Select 在触发器上再点一下不会切回关闭，
 * 点空白也不走它自己的 outside 关闭链 —— 用户实测「展开后点 trigger 收不回去、
 * 点空白也不消失」。DropdownMenu 的触发器点击本身就是「开/关切换」，点外关闭也是
 * 菜单自己的标准行为，正是这里需要的交互。
 */
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

/** 当前模型名（触发器文字；没选到动作时给一句提示） */
const triggerLabel = computed(() => props.currentActionLabel || '选择模型')

function pickAction(value: string): void {
  if (value === props.currentId) return
  emit('actionPicked', value)
}
</script>

<template>
  <div class="nb-bottom">
    <!--
      最左侧的 @ 按钮（用户 2026-11-06 图 2）。
      只做一件事：往输入框光标处塞一个 @ 字符，@ 菜单由编辑器自己弹出。
    -->
    <Button variant="ghost" size="icon-xs"
      class="nb-icon-btn nb-at-btn"
      type="button"
      data-testid="bar-insert-at"
      title="插入 @ 引用素材"
      aria-label="插入 @ 引用素材"
      :disabled="!showEditor"
      @click.stop="emit('insertAt')"
    >
      <span aria-hidden="true" v-html="ICON_AT" />
    </Button>
    <div class="nb-selects">
      <div class="nb-field nb-field--action">
        <!-- 文本节点：模型来自 Agent 配置（用户 2026-11-07）；面板主体复用 Agent 的 ModelPicker -->
        <slot name="model-picker" />
        <!--
          模型下拉 = DropdownMenu（用户 2026-11-06 指定）：
          触发器点击即开/关切换，点画布空白由菜单自己的 outside 关闭处理。
        -->
        <DropdownMenu v-if="!hasModelPicker">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm"
              :id="'nb-action-' + id"
              class="nb-action-select nb-model-trigger"
              type="button"
              :disabled="running"
              title="选择动作 / 模型"
              aria-label="选择动作 / 模型"
            >
              <span v-if="currentModelIcon" class="nb-model-badge" :data-tone="currentModelIcon.tone"
                aria-hidden="true" v-html="currentModelIcon.svg" />
              <span class="nb-model-trigger-label">{{ triggerLabel }}</span>
              <svg class="nb-model-trigger-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" class="nb-action-menu nb-model-menu">
            <DropdownMenuItem
              v-for="o in actionOptions"
              :key="o.value"
              class="nb-model-item"
              :data-state="o.value === currentId ? 'checked' : undefined"
              @select="pickAction(String(o.value))"
            >
              <span class="nb-model-badge" :data-tone="o.model.tone" aria-hidden="true" v-html="o.model.svg" />
              <span class="nb-model-item-label">{{ o.label }}</span>
              <svg v-if="o.value === currentId" class="nb-model-item-check" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span class="nb-divider" aria-hidden="true" />
      <div v-if="paramDefs.length > 0 && !hideParams" class="nb-field nb-field--params">
        <ToolParamGroup
          :params="paramDefs"
          :values="values"
          :disabled="running"
          :id-prefix="'nb-group-' + id"
          @change="(key: string, v: string | number | boolean) => emit('fieldChange', key, v)"
        />
      </div>
      <!-- 参数区之后的扩展位（预设提示词等按钮挂这里，见 BottomBarPresets） -->
      <slot name="presets" />
    </div>
    <div class="nb-actions">
      <Button variant="ghost" size="icon-sm"
        v-for="ai in aiButtons"
        :key="ai.id"
        class="nb-icon-btn"
        :class="{ 'is-running': aiRunningId === ai.id }"
        type="button"
        :disabled="!showEditor || aiRunningId !== null"
        :title="ai.description || ai.name"
        :aria-label="ai.name"
        @click.stop="emit('aiClick', ai)"
      >
        <span v-if="aiRunningId === ai.id" class="nb-ai-spinner" aria-hidden="true" />
        <span v-else aria-hidden="true" v-html="ai.icon" />
      </Button>
      <span v-if="aiError" class="nb-ai-error" role="alert" :title="aiError">{{ aiError }}</span>
      <span class="nb-count" :title="'最多 ' + charLimit + ' 字'">{{ charCount }}/{{ charLimit }}</span>
      <div class="nb-warn">
        <TooltipProvider v-if="invalidHint" :delay-duration="120">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="nb-gap-hint" role="button" tabindex="0"><span aria-hidden="true" v-html="iconWarn" /></span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{{ invalidHint }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Button variant="ghost" size="icon-sm"
        class="nb-run"
        :class="{ 'is-running': running }"
        type="button"
        :disabled="!canRun || submitted"
        :aria-disabled="!canRun || submitted"
        :title="currentActionTitle || '执行'"
        @click.stop="emit('run')"
      >
        <span v-if="running" class="nb-spinner" aria-hidden="true" />
        <span v-else class="nb-send-icon" aria-hidden="true" v-html="iconSend" />
      </Button>
    </div>
  </div>
</template>
