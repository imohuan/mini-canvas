<script setup lang="ts">
import type { ToolParamDef } from '@mini-canvas/kernel'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { AiActionConfig } from '../aiActions'

defineProps<{
  id: string
  currentId: string
  currentActionLabel: string
  running: boolean
  paramDefs: ToolParamDef[]
  values: Record<string, unknown>
  infoText: string
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
  actionOptions: Array<{ value: string; label: string }>
}>()

const emit = defineEmits<{
  actionPicked: [value: string | number]
  fieldChange: [key: string, value: string | number | boolean]
  aiClick: [action: AiActionConfig]
  run: []
}>()

const ToolParamGroup = useUiComponent('toolParamGroup')
const Button = useUiComponent('Button')
const Select = useUiComponent('Select')
const SelectContent = useUiComponent('SelectContent')
const SelectItem = useUiComponent('SelectItem')
const SelectTrigger = useUiComponent('SelectTrigger')
const SelectValue = useUiComponent('SelectValue')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

/**
 * 底栏模型下拉关闭时不要把焦点抢回触发器。
 *
 * 为什么（2026-11-04 实测事件顺序）：
 * 下拉开着时点旁边的「比例」按钮，真实顺序是
 *   click 比例按钮 → 比例面板打开 → **基础 Select 收尾把焦点还给自己的触发器**
 *   → 比例面板收到 focusin 在它外面 → 面板立刻自我关闭。
 * 表现就是「第一下只关了模型下拉，第二个面板没打开，得点第二下」。
 *
 * 处理：只有焦点还在下拉里（键盘 Esc / 选项回车）时才交还给触发器；
 * 用户已经点到别的控件上时，保持焦点不动。
 */
function keepFocusOnOutsideControl(event: Event): void {
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body) return
  if (active.closest('[data-slot="select-content"]')) return
  event.preventDefault()
}
</script>

<template>
  <div class="nb-bottom">
    <div class="nb-selects">
      <div class="nb-field nb-field--action">
        <Select :model-value="currentId" :disabled="running"
          @update:model-value="(v: string | number) => emit('actionPicked', v)">
          <SelectTrigger :id="'nb-action-' + id" size="sm" class="nb-action-select"
            title="选择动作 / 模型" aria-label="选择动作 / 模型">
            <SelectValue placeholder="选择动作">{{ currentActionLabel }}</SelectValue>
          </SelectTrigger>
          <!--
            底栏下拉不能锁页面：组件默认会写 `body { pointer-events: none }`（模态行为），
            底栏浮在画布上，一开下拉整个画布就点不动，看起来像盖了一层遮罩。
            这里只关掉这两项，点外关闭 / Esc / 选项选中都还在。
          -->
          <SelectContent position="popper" side="bottom" :side-offset="4" :body-lock="false"
            :disable-outside-pointer-events="false" class="nb-action-menu"
            @close-auto-focus="keepFocusOnOutsideControl">
            <SelectItem v-for="o in actionOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <span class="nb-divider" aria-hidden="true" />
      <div v-if="paramDefs.length > 0" class="nb-field nb-field--params">
        <ToolParamGroup
          :params="paramDefs"
          :values="values"
          :disabled="running"
          :id-prefix="'nb-group-' + id"
          @change="(key: string, v: string | number | boolean) => emit('fieldChange', key, v)"
        />
      </div>
    </div>
    <div class="nb-actions">
      <span v-if="infoText" class="nb-info">{{ infoText }}</span>
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
