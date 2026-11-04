<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import AppDialog from '../../AppDialog.vue'
import { useDirectorSettings } from './useDirectorSettings'

const Button = useUiComponent('Button')
const ScrollArea = useUiComponent('ScrollArea')
const Input = useUiComponent('Input')
const NumberField = useUiComponent('NumberField')
const NumberFieldContent = useUiComponent('NumberFieldContent')
const NumberFieldDecrement = useUiComponent('NumberFieldDecrement')
const NumberFieldIncrement = useUiComponent('NumberFieldIncrement')
const NumberFieldInput = useUiComponent('NumberFieldInput')
const Select = useUiComponent('Select')
const SelectContent = useUiComponent('SelectContent')
const SelectItem = useUiComponent('SelectItem')
const SelectTrigger = useUiComponent('SelectTrigger')
const SelectValue = useUiComponent('SelectValue')
const Switch = useUiComponent('Switch')

const { ui, s, agent, SUBMIT_KEY_MODE_OPTIONS, sendKeyLabel, agentBudgetOnChange } = useDirectorSettings()
</script>

<template>
  <!-- TV Director 全局设置：独立全局弹窗（不在 Agent 面板内） -->
  <AppDialog :model-value="s.directorOpen" width="600px" height="532px" radius="12px"
    @update:model-value="!$event && (s.directorOpen = false)">
    <div class="flex items-center justify-between px-4 pb-2.5 pt-4">
      <div><span class="block text-[9px] font-extrabold tracking-[0.12em] text-ink-dim">TV DIRECTOR</span><strong
          class="text-[15px]">全局设置</strong></div>
      <Button variant="ghost" size="icon" aria-label="关闭全局设置" @click="s.directorOpen = false">
        <X :size="15" />
      </Button>
    </div>
    <ScrollArea class="min-h-0 flex-1">
    <div class="px-4 pb-2">
      <div class="mb-4 rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">协作模式</strong>
            <p class="text-xs text-ink-dim">自动生成图片/视频/音频/剧本</p><small class="block text-[11px] text-ink-mute">开启后，TV
              Director 可直接消耗积分，提交生成任务，无需逐次确认</small><em
              class="block text-[10px] not-italic text-ink-dim">新建会话默认生效，当前会话请前往输入框底部切换</em>
          </div>
          <Switch
            :model-value="s.director.collab"
            aria-label="协作模式"
            @update:model-value="s.director.collab = $event"
          />
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">后台对话</strong>
            <p class="text-xs text-ink-dim">开启后，对话在后台继续跑：离开或关闭浏览器也会进行，刷新后重新进入该对话能继续之前的对话流</p>
          </div>
          <Switch
            :model-value="agent.state.runMode === 'background'"
            aria-label="后台对话"
            @update:model-value="agent.setRunMode($event ? 'background' : 'followTab')"
          />
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">发送中显示队列</strong>
            <p class="text-xs text-ink-dim">开启后，排队消息在真实发送期间仍显示「发送中」状态；关闭则发送后立即从列表消失</p>
          </div>
          <Switch
            :model-value="agent.state.queueShowSending"
            aria-label="发送中显示队列"
            @update:model-value="agent.setQueueShowSending($event)"
          />
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">目标设置</strong>
            <p class="text-xs text-ink-dim">点 + 选目标时用这里的默认预算；之后可以点目标标签单独改</p>
          </div>
          <NumberField
            :model-value="agent.state.goalBudget"
            :min="0"
            :step="1000"
            class="w-28 flex-none"
            aria-label="目标默认预算"
            @update:model-value="agentBudgetOnChange"
          >
            <NumberFieldContent>
              <NumberFieldDecrement aria-label="减少目标预算" />
              <NumberFieldInput placeholder="0 = 不限" />
              <NumberFieldIncrement aria-label="增加目标预算" />
            </NumberFieldContent>
          </NumberField>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">发送键</strong>
            <p class="text-xs text-ink-dim">选哪一种回车发送消息；@ 下拉打开时回车始终用于选择菜单项</p>
          </div>
          <Select
            :model-value="agent.state.submitKeyMode"
            @update:model-value="agent.setSubmitKeyMode($event as typeof agent.state.submitKeyMode)"
          >
            <SelectTrigger size="sm" class="w-[150px]" aria-label="发送键">
              <SelectValue>{{ sendKeyLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent class="settings-floating-layer" position="popper" side="bottom" :side-offset="4">
              <SelectItem v-for="m in SUBMIT_KEY_MODE_OPTIONS" :key="m.value" :value="m.value">
                {{ m.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div v-if="s.director.budget" class="flex items-center justify-between gap-3 border-t border-line pt-2">
          <span class="text-xs text-ink-dim">提醒阈值设置</span>
          <Input v-model.number="s.director.budgetLimit" type="number" min="100" step="100"
            class="h-8 w-28 text-xs" aria-label="提醒阈值设置" />
        </div>
      </div>
      <div class="rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">浏览器通知</strong>
            <p class="text-xs text-ink-dim">TV Director 回复完成后，会在系统通知提醒</p>
          </div>
          <Switch
            :model-value="agent.state.notify.browser"
            aria-label="浏览器通知"
            @update:model-value="agent.setNotify({ browser: $event })"
          />
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">通知声音</strong>
            <p class="text-xs text-ink-dim">开启后，收到通知时播放提示音</p>
          </div>
          <Switch
            :model-value="agent.state.notify.sound"
            aria-label="通知声音"
            @update:model-value="agent.setNotify({ sound: $event })"
          />
        </div>
      </div>
    </div>
    </ScrollArea>
    <div class="flex flex-none justify-end border-t border-line p-3">
      <Button variant="outline" size="sm" type="button" @click="s.directorOpen = false; ui.showToast('设置已保存')">完成</Button>
    </div>
  </AppDialog>
</template>
