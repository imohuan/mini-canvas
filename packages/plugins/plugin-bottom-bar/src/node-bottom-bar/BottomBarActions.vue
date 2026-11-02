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
</script>

<template>
  <div class="nb-bottom">
    <div class="nb-selects">
      <div class="nb-field nb-field--action">
        <Select :model-value="currentId" :disabled="running" @update:model-value="(v: string | number) => emit('actionPicked', v)">
          <SelectTrigger :id="'nb-action-' + id" size="sm" class="nb-action-select"
            title="选择动作 / 模型" aria-label="选择动作 / 模型">
            <SelectValue placeholder="选择动作">{{ currentActionLabel }}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" side="bottom" :side-offset="4" class="nb-action-menu">
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
