<script setup lang="ts">
/**
 * TemplatePage —— 系统提示词模板：SDK 组装系统提示词用的容器。
 *
 * 模板本体只读（改 YAML 或恢复出厂），避免误删 {{AGENTS_MD}} 让整条链路静默失效。
 * 只换 UI：控件全部来自 @mini-canvas/ui-kit-shadcn。
 */
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Check, Wrench } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import './settings.css'

const Button = useUiComponent('Button')
const Textarea = useUiComponent('Textarea')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const agent = useAgent()
const s = agent.state

const restoring = ref(false)
const restored = ref(false)

onMounted(async () => {
  await agent.refresh()
})

const broken = computed(() => !s.templateHealth.ok)
/** 模板本体（只读展示；编辑走 YAML 或恢复按钮） */
const template = computed(() => s.templateText)

async function restore(): Promise<void> {
  restoring.value = true
  try {
    await agent.restoreTemplate()
    restored.value = true
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

    <ShadcnSettingsSection
      title="系统提示词模板"
      :description="template.length + ' 字 · 里面 {{AGENTS_MD}} 那个洞，填的是「Agent 提示词」页写的内容'"
    >
      <div class="pp-edit">
        <p class="ap-hint">
          这是容器：<code v-pre>{{AGENTS_MD}}</code> 由「Agent 提示词」填；<code v-pre>{{CWD}}</code> 这类记号在建会话时换成真实值。
        </p>

        <div v-if="broken" class="ap-warnbody">
          <p class="ap-warnline">
            <AlertTriangle :size="13" />
            <span>缺 <code>{{ s.templateHealth.missing.join('、') }}</code>：「Agent 提示词」写什么都进不去模型。</span>
          </p>
          <Button variant="outline" size="sm" type="button" :disabled="restoring" @click="restore">
            <Wrench :size="13" aria-hidden="true" /> {{ restoring ? '恢复中…' : '恢复出厂模板' }}
          </Button>
        </div>
        <p v-else-if="restored" class="ap-hint pp-ok"><Check :size="12" /> 已恢复出厂模板</p>

        <Textarea
          :model-value="template"
          readonly
          class="pp-textarea pp-mono"
          aria-label="系统提示词模板（只读）"
        />
        <p class="ap-hint">改模板本身请编辑 <code>system_config.yaml</code>（路径见下）；这个框只读，免得误删占位符。</p>
      </div>
    </ShadcnSettingsSection>
  </div>
</template>

<style scoped>
.pp-edit { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; }
.pp-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }
.ap-warnbody { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
.pp-textarea { height: 320px; min-height: 260px; overflow-y: auto; field-sizing: fixed; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; line-height: 1.6; }
</style>
