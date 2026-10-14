<script setup lang="ts">
/**
 * TemplatePage —— 「系统提示词模板」：SDK 组装系统提示词用的那份**容器**。
 *
 * 用户口径（2026-10-14）：「你这边系统提示词根本就没有生效，你修改的并不是真实的系统提示词」——
 * 这条批评成立：从前设置里那个「系统提示词」页签改的是**模式提示词清单**（存 KV），
 * 而真正的模板住在 `agent_state/system_config.yaml` 的 `system_prompt`，界面上根本没有入口。
 * 这一页就是补上那个入口。
 *
 * ## 两层的关系（这一页最该讲清的事）
 *
 *   {{AGENTS_MD}}  ← 「Agent 提示词」那一页写的内容，灌进这个洞
 *   {{CWD}} …      ← 运行时的值，建会话那一刻替换
 *
 * 所以这一页**不是**用来写「你要 AI 干什么」的 —— 那是 Agent 提示词那一页。
 * 这一页是模板：洞里填什么、洞口周围包着什么话。
 *
 * ## 一条硬口径
 *
 * 「恢复出厂模板」会把这段换回 SDK 原版（带 PenguinHarness 自己的角色设定 Role / Success criteria…），
 * AI 的性格会明显变化。所以它**只在用户点的时候做**，不自动。
 */
import { computed, onMounted, ref } from 'vue'
import { Check, AlertTriangle, Wrench } from 'lucide-vue-next'
import { useAgent } from '../../useAgent.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state

const busy = ref(false)
const restoring = ref(false)
const restored = ref(false)

onMounted(async () => {
  await agent.refresh()
})

const broken = computed(() => !s.templateHealth.ok)
/** 模板本体（只读展示；编辑走 YAML 或恢复按钮 —— 见页面里的说明） */
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

    <section class="ap-block" :class="{ 'ap-warnblock': broken }">
      <header class="ap-block-head">
        <h4>系统提示词模板</h4>
        <span class="ap-quick">
          <span class="ap-count">{{ template.length }} 字</span>
          <span v-if="!broken" class="ap-hint pp-ok"><Check :size="12" /> 正常</span>
        </span>
      </header>
      <div class="ap-block-body pp-edit">
        <p class="ap-hint">
          这是**容器**：里面 <code v-pre>{{AGENTS_MD}}</code> 那个洞，
          填的是「Agent 提示词」页写的内容；<code v-pre>{{CWD}}</code> 这类记号在建会话时换成真实值。
        </p>

        <div v-if="broken" class="ap-warnbody">
          <p class="ap-warnline">
            <AlertTriangle :size="13" />
            <span>缺 <code>{{ s.templateHealth.missing.join('、') }}</code>：
              「Agent 提示词」写什么都进不去模型。</span>
          </p>
          <button class="ap-submit ap-restore" :disabled="restoring" @click="restore">
            <Wrench :size="12" /> {{ restoring ? '恢复中…' : '恢复出厂模板' }}
          </button>
        </div>
        <p v-else-if="restored" class="ap-hint pp-ok"><Check :size="12" /> 已恢复出厂模板</p>

        <textarea class="pp-textarea pp-mono" rows="16" readonly :value="template"
          aria-label="系统提示词模板（只读）"></textarea>
        <p class="ap-hint">
          改模板本身请编辑 <code>system_config.yaml</code>（路径见下）；这个框只读，
          免得误删 <code v-pre>{{AGENTS_MD}}</code> 让整条链路静默失效。
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pp-edit { display: flex; flex-direction: column; gap: 8px; }
.pp-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }
.ap-warnblock { border-color: var(--ui-warn, #b45309); }
.ap-warnbody { display: flex; flex-direction: column; gap: 6px; }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
.ap-restore { display: inline-flex; align-items: center; justify-content: center; gap: 5px; align-self: flex-start; padding: 0 12px; }
.pp-textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel-soft, #fafbfc); color: var(--ui-ink, #18202b); font-size: 11px; line-height: 1.6; resize: vertical; outline: none; }
.pp-mono { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
