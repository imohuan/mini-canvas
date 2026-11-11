<script setup lang="ts">
/**
 * AgentPromptPage —— 「Agent 提示词」：写给 Agent 的常驻指令。
 *
 * 落在 agent_state/AGENTS.md；SDK 建会话时把它灌进系统提示词模板的 {{AGENTS_MD}} 位置。
 * 变量面板与模式提示词、系统提示词模板共用 PromptEditor / PromptVariables。
 */
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Check, RotateCcw, Save } from 'lucide-vue-next'
import { useCanvasContextOrRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { FeedbackService } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import PromptEditor from './components/PromptEditor.vue'
import './settings.css'

const Button = useUiComponent('Button')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const agent = useAgent()
const s = agent.state
const feedback = useCanvasContextOrRender().ctx.tryGet<FeedbackService>('feedback')

const draft = ref('')
const busy = ref(false)
const saved = ref(false)

onMounted(async () => {
  await agent.refresh()
  draft.value = s.systemPrompt
})

const dirty = computed(() => draft.value !== s.systemPrompt)
const templateBroken = computed(() => !s.templateHealth.ok)

async function save(): Promise<void> {
  busy.value = true
  try {
    await agent.saveSystemPrompt(draft.value)
    saved.value = true
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

/**
 * 恢复这个渠道的出厂提示词：把系统提示词（AGENTS.md）写回空。
 *
 * 「空」就是出厂状态：没有额外常驻指令；模板、模式提示词、插件附加小节都不受影响。
 * 只改**本地草稿**，点保存才落盘 —— 用户还能反悔。
 */
async function restoreDefault(): Promise<void> {
  const ok = await feedback?.confirm({
    title: '恢复 Agent 提示词的默认内容？',
    description: '会把常驻指令清空（出厂状态就是没有额外指令）。现在的修改会丢掉，点保存后才写回。',
    confirmText: '恢复默认',
    cancelText: '取消',
  })
  if (!ok) return
  draft.value = ''
  saved.value = false
}
</script>

<template>
  <div class="ap ap-agent-prompt">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <div v-if="templateBroken" class="ap-warnblock">
      <p class="ap-warnline">
        <AlertTriangle :size="13" />
        <span>系统提示词模板坏了：缺 <code>{{ s.templateHealth.missing.join('、') }}</code>，
          这会让这一页写的内容一个字都进不到模型。去「系统提示词」页点恢复。</span>
      </p>
    </div>

    <div class="ap-prompt-form">
      <div class="ap-field">
        <div class="ap-field-head">
          <span class="ap-field-label">常驻指令</span>
          <span class="ap-count">{{ draft.length }} 字</span>
        </div>
        <PromptEditor
          v-model="draft"
          label="Agent 提示词"
          placeholder="例如：回答用中文，简短直接。动画布之前先读一次画布现状…"
          :height="260"
          @update:model-value="saved = false"
        />
      </div>

      <!-- 保存跟着内容走：提示词很长时不用滚到底才找到保存 -->
      <div class="ap-detail-foot is-sticky">
        <span v-if="saved" class="ap-hint ap-ok"><Check :size="12" /> 已保存</span>
        <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
        <span v-else class="ap-hint">每次新会话都会带上它（放在系统提示词的 [developer_instructions] 块里）</span>
        <span class="ap-detail-actions">
          <Button variant="outline" size="sm" type="button" aria-label="恢复 Agent 提示词的默认内容" @click="restoreDefault">
            <RotateCcw :size="13" aria-hidden="true" /> 恢复默认
          </Button>
          <Button type="button" size="sm" :disabled="busy || !dirty" @click="save">
          <Save :size="13" aria-hidden="true" /> 保存
          </Button>
        </span>
      </div>
    </div>

    <ShadcnSettingsSection
      v-if="s.promptSections.length"
      title="还会自动附加的内容"
      :description="s.promptSections.length + ' 段 · 由后台按当前状态生成，不需要你重复写'"
    >
      <ShadcnSettingsRow
        v-for="sec in s.promptSections"
        :key="sec.id"
        :label="sec.title"
        :description="sec.source + ' · ' + sec.text.length + ' 字'"
      />
    </ShadcnSettingsSection>
  </div>
</template>

<style scoped>
.ap-prompt-form { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
.ap-field { display: flex; flex-direction: column; gap: 6px; }
.ap-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-field-label { font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-count { font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.ap-detail-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ap-detail-actions { display: inline-flex; align-items: center; gap: 8px; }
.ap-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }
.ap-warnblock { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--ui-warn, #b45309); border-radius: var(--radius-control, 8px); }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
