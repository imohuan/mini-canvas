<script setup lang="ts">
/**
 * TemplatePage —— 系统提示词：SDK 组装提示词用的容器（system_config.yaml 的 system_prompt）。
 *
 * 用户口径（2026-11-11）：三种提示词用**同一个**「正文框 + 变量」组件，交互也一致：
 * 变量点一下插到光标处；模板同样可编辑、可保存。
 *
 * 模板里 **必须保留 {{AGENTS_MD}}** —— 少了它，Agent 提示词 / 模式提示词一个字都进不去；
 * 这种情况保存会被后台拒绝并说明原因。
 *
 * 恢复出厂常驻在底部：用户口径 2026-11-11「提示词进入编辑要有恢复默认，不然容易被改坏」。
 * 模板坏了时顶部的提示块也会指到同一个按钮。
 */
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Check, RotateCcw, Save } from 'lucide-vue-next'
import { useCanvasContextOrRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { FeedbackService } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import PromptEditor from './components/PromptEditor.vue'
import './settings.css'

const Button = useUiComponent('Button')

const agent = useAgent()
const s = agent.state
const feedback = useCanvasContextOrRender().ctx.tryGet<FeedbackService>('feedback')

const draft = ref('')
const busy = ref(false)
const saved = ref(false)
const restoring = ref(false)

onMounted(async () => {
  await agent.refresh()
  draft.value = s.templateText
})

const broken = computed(() => !s.templateHealth.ok)
const dirty = computed(() => draft.value !== s.templateText)
/** 编辑中把 {{AGENTS_MD}} 删了：保存前就提示，不等后台拒绝 */
const missingAgentsMd = computed(() => !draft.value.includes('{{AGENTS_MD}}'))

async function save(): Promise<void> {
  busy.value = true
  s.error = ''
  try {
    await agent.saveTemplate(draft.value)
    draft.value = s.templateText
    saved.value = true
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function restore(): Promise<void> {
  const ok = await feedback?.confirm({
    title: '恢复系统提示词的出厂模板？',
    description: '会用出厂模板覆盖当前正文（{{AGENTS_MD}} 仍然保留）。自己改过的内容会丢掉。',
    confirmText: '恢复默认',
    cancelText: '取消',
    tone: 'destructive',
  })
  if (!ok) return
  restoring.value = true
  try {
    await agent.restoreTemplate()
    draft.value = s.templateText
    saved.value = false
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div class="ap ap-template">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <div class="ap-template-form">
      <p class="ap-hint">
        这是容器：<code v-pre>{{AGENTS_MD}}</code> 由「Agent 提示词」和「模式提示词」填进去；
        <code v-pre>{{CWD}}</code> 这类记号在建会话时换成真实值。模板里也必须留着
        <code v-pre>{{AGENTS_MD}}</code>。
      </p>

      <div v-if="broken" class="ap-warnbody">
        <p class="ap-warnline">
          <AlertTriangle :size="13" />
          <span>缺 <code>{{ s.templateHealth.missing.join('、') }}</code>：「Agent 提示词」写什么都进不去模型。</span>
        </p>
      </div>

      <div class="ap-field">
        <div class="ap-field-head">
          <span class="ap-field-label">模板正文</span>
          <span class="ap-count">{{ draft.length }} 字</span>
        </div>
        <PromptEditor
          v-model="draft"
          label="系统提示词模板"
          scope="template"
          :height="320"
          @update:model-value="saved = false"
        />
      </div>

      <p v-if="missingAgentsMd" class="ap-warnline">
        <AlertTriangle :size="13" />
        <span>模板里没有 <code v-pre>{{AGENTS_MD}}</code>：这样保存会被拒绝，因为 Agent 提示词和模式提示词都进不去。</span>
      </p>

      <div class="ap-detail-foot is-sticky">
        <span v-if="saved" class="ap-hint ap-ok"><Check :size="12" /> 已保存</span>
        <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
        <span v-else class="ap-hint">模板在 system_config.yaml；下次新会话生效</span>
        <span class="ap-detail-actions">
          <Button variant="outline" size="sm" type="button" :disabled="restoring" @click="restore">
            <RotateCcw :size="13" aria-hidden="true" /> {{ restoring ? '恢复中…' : '恢复默认' }}
          </Button>
          <Button type="button" size="sm" :disabled="busy || !dirty || missingAgentsMd" @click="save">
            <Save :size="13" aria-hidden="true" /> 保存
          </Button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ap-template-form { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
.ap-field { display: flex; flex-direction: column; gap: 6px; }
.ap-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-field-label { font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-count { font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.ap-detail-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ap-detail-actions { display: inline-flex; align-items: center; gap: 8px; }
.ap-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }
.ap-warnbody { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
