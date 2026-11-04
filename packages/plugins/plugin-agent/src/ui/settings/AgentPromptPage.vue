<script setup lang="ts">
/**
 * AgentPromptPage —— 「Agent 提示词」：写给 Agent 的常驻指令。
 *
 * 落在 agent_state/AGENTS.md；SDK 建会话时把它灌进系统提示词模板的 {{AGENTS_MD}} 位置。
 * 只换 UI：控件全部来自 @mini-canvas/ui-kit-shadcn，读写仍走 agent 服务。
 */
import { computed, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { AlertTriangle, Check, Save } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import type { ContextPlaceholderView } from '../../api/agentApi.js'
import './settings.css'

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Textarea = useUiComponent('Textarea')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const agent = useAgent()
const s = agent.state

const draft = ref('')
const busy = ref(false)
const saved = ref(false)
const textarea = ref<ComponentPublicInstance | null>(null)
const search = ref('')

/** Textarea 是组件库组件；插入占位符要拿它内部真实的 textarea DOM */
function textareaElement(): HTMLTextAreaElement | null {
  const el = textarea.value?.$el
  return el instanceof HTMLTextAreaElement ? el : null
}

onMounted(async () => {
  await agent.refresh()
  draft.value = s.systemPrompt
})

const dirty = computed(() => draft.value !== s.systemPrompt)
const templateBroken = computed(() => !s.templateHealth.ok)

/** 占位符分两组：本服务提供的在前（用户多半要的是这些） */
const ownPlaceholders = computed<ContextPlaceholderView[]>(() =>
  (s.agentContext?.placeholders ?? []).filter((p) => p.source === 'mini-canvas'),
)
const harnessPlaceholders = computed<ContextPlaceholderView[]>(() =>
  (s.agentContext?.placeholders ?? []).filter((p) => p.source === 'harness'),
)

/** 过滤后的占位符（搜索框为空时显示全部） */
function filtered(list: ContextPlaceholderView[]): ContextPlaceholderView[] {
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((p) => p.token.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
}

/** 把记号插到光标处 */
function insertToken(token: string): void {
  const el = textareaElement()
  if (!el) {
    draft.value += token
    saved.value = false
    return
  }
  const start = el.selectionStart ?? draft.value.length
  const end = el.selectionEnd ?? start
  draft.value = draft.value.slice(0, start) + token + draft.value.slice(end)
  saved.value = false
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

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
</script>

<template>
  <div class="ap ap-agent-prompt">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <!-- 模板坏了时这一页改了也没用，必须先说清楚 -->
    <div v-if="templateBroken" class="ap-warnblock">
      <p class="ap-warnline">
        <AlertTriangle :size="13" />
        <span>系统提示词模板坏了：缺 <code>{{ s.templateHealth.missing.join('、') }}</code>，
          这会让这一页写的内容一个字都进不到模型。去「系统提示词模板」页点恢复。</span>
      </p>
    </div>

    <ShadcnSettingsSection
      title="Agent 提示词"
      :description="draft.length + ' 字 · 每次新会话都会带上它（放在系统提示词的 [developer_instructions] 块里）'"
    >
      <div class="pp-edit">
        <Textarea
          ref="textarea"
          v-model="draft"
          class="pp-textarea"
          aria-label="Agent 提示词"
          placeholder="例如：回答用中文，简短直接。动画布前先读一次画布现状…"
          @input="saved = false"
        />

        <details class="pp-ph">
          <summary>
            <span>可用占位符（点一下就插进正文）</span>
            <span class="ap-count">{{ ownPlaceholders.length + harnessPlaceholders.length }} 个</span>
          </summary>
          <div class="pp-ph-body">
            <p class="ap-hint">记号会在建会话时换成当时的值；端口换了、目录挪了，下一句就跟着变。</p>
            <Input v-model="search" class="pp-ph-search" aria-label="筛选占位符" placeholder="筛选占位符…" />
            <div class="pp-ph-group">
              <span class="pp-ph-title">这台后台（本站提供）</span>
              <div class="pp-chips">
                <Button
                  v-for="p in filtered(ownPlaceholders)"
                  :key="p.token"
                  variant="outline"
                  size="xs"
                  type="button"
                  class="pp-chip"
                  :title="p.description + (p.value ? '（当前：' + p.value + '）' : '')"
                  @click="insertToken(p.token)"
                ><code>{{ p.token }}</code></Button>
              </div>
            </div>
            <div class="pp-ph-group">
              <span class="pp-ph-title">运行时环境（SDK 提供）</span>
              <div class="pp-chips">
                <Button
                  v-for="p in filtered(harnessPlaceholders)"
                  :key="p.token"
                  variant="outline"
                  size="xs"
                  type="button"
                  class="pp-chip"
                  :title="p.description"
                  @click="insertToken(p.token)"
                ><code>{{ p.token }}</code></Button>
              </div>
            </div>
          </div>
        </details>

        <div class="pp-foot">
          <span v-if="saved" class="ap-hint pp-ok"><Check :size="12" /> 已保存</span>
          <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
          <span v-else class="ap-hint">下一轮新会话生效</span>
          <Button type="button" size="sm" :disabled="busy || !dirty" @click="save">
            <Save :size="13" aria-hidden="true" /> 保存
          </Button>
        </div>
      </div>
    </ShadcnSettingsSection>

    <!-- 谁还往提示词里加了东西：让用户看得见，而不是猜 -->
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
.pp-edit { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; }
.pp-textarea { height: 220px; min-height: 180px; overflow-y: auto; field-sizing: fixed; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.6; }
.pp-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pp-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }
.ap-warnblock { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--ui-warn, #b45309); border-radius: var(--radius-control, 8px); }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
.pp-ph { border: 1px solid var(--ui-line-soft, #eef0f4); border-radius: var(--radius-control, 8px); }
.pp-ph > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; font-size: 11px; color: var(--ui-ink-dim, #6b7280); cursor: pointer; list-style: none; }
.pp-ph > summary::-webkit-details-marker { display: none; }
.pp-ph-body { display: flex; flex-direction: column; gap: 8px; padding: 0 10px 10px; }
.pp-ph-search { height: 28px; font-size: 11px; }
.pp-ph-group { display: flex; flex-direction: column; gap: 5px; }
.pp-ph-title { font-size: 10px; letter-spacing: 0.02em; color: var(--ui-ink-dim, #6b7280); }
.pp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pp-chip { height: 22px; padding: 0 8px; font-family: var(--font-mono, ui-monospace, monospace); }
.pp-chip code { font-size: 10px; }
</style>
