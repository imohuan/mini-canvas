<script setup lang="ts">
/**
 * AgentPromptPage —— 「Agent 提示词」：你写给这个 Agent 的**常驻指令**。
 *
 * 用户口径（2026-10-14）：「它这里有一个 Agent 提示词，还有一个系统提示词，两者是分开的。
 * 在我的项目中，Agent 提示词是插入在系统提示词内部的」——对，就是这一份。
 *
 * ## 它落在哪、怎么进模型
 *
 * 磁盘上是 `agent_state/AGENTS.md`；SDK 组装系统提示词时，把它灌到模板里 `{{AGENTS_MD}}`
 * 那个位置（默认模板把它包在 `[developer_instructions]` 块里）。
 *
 * 所以「Agent 提示词」和「系统提示词模板」是**两层**：
 *   · 这份 = 内容（换一台机器、换个模型，它都跟着你）；
 *   · 模板 = 容器的形状（决定这份内容放在第几段、周围还有什么）。
 *
 * ## 为什么以前改这里没反应（用这一页之前踩过的坑）
 *
 * 1. 模板坏了（`{{AGENTS_MD}}` 丢了）→ 你写什么都进不去。体检结果在这个页面上方直接告诉你；
 * 2. 选着模式提示词时，旧实现会把 AGENTS.md **整份换掉** → 你写的东西被顶掉。已修成
 *    「你的原文在前、模式提示词附在后面」，两者都进模型（见 config.ts 的 withSystemPrompt）。
 */
import { computed, onMounted, ref } from 'vue'
import { Check, AlertTriangle } from 'lucide-vue-next'
import { useAgent } from '../../useAgent.js'
import type { ContextPlaceholderView } from '../../agentApi.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state

const draft = ref('')
const busy = ref(false)
const saved = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)

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

/** 把记号插到光标处（与提示词页同一套手感） */
function insertToken(token: string): void {
  const el = textarea.value
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

    <!-- 模板坏了的时候，这一页改了也没用 —— 必须先说清楚，否则用户白改半天 -->
    <section v-if="templateBroken" class="ap-block ap-warnblock">
      <div class="ap-block-body ap-warnbody">
        <p class="ap-warnline">
          <AlertTriangle :size="13" />
          <span>系统提示词模板坏了：缺 <code>{{ s.templateHealth.missing.join('、') }}</code>，
            这会让这一页写的内容一个字都进不到模型。去「系统提示词模板」页点恢复。</span>
        </p>
      </div>
    </section>

    <section class="ap-block">
      <header class="ap-block-head">
        <h4>Agent 提示词</h4>
        <span class="ap-count">{{ draft.length }} 字</span>
      </header>
      <div class="ap-block-body pp-edit">
        <p class="ap-hint">
          这个 Agent 的常驻指令。每次新会话都会带上它（放在系统提示词的
          <code>[developer_instructions]</code> 块里）—— 换模型、换画布都不变。
        </p>
        <textarea ref="textarea" v-model="draft" class="pp-textarea" rows="14"
          aria-label="Agent 提示词"
          placeholder="例如：回答用中文，简短直接。动画布前先读一次画布现状…"
          @input="saved = false"></textarea>

        <details class="pp-ph">
          <summary>
            <span>可用占位符（点一下就插进正文）</span>
            <span class="ap-count">{{ ownPlaceholders.length + harnessPlaceholders.length }} 个</span>
          </summary>
          <div class="pp-ph-body">
            <p class="ap-hint">
              记号会在建会话时换成当时的值；端口换了、目录挪了，下一句就跟着变。
            </p>
            <div class="pp-ph-group">
              <span class="pp-ph-title">这台后台（本站提供）</span>
              <div class="pp-chips">
                <button v-for="p in ownPlaceholders" :key="p.token" class="ap-tagchip pp-chip"
                  :title="p.description + (p.value ? '（当前：' + p.value + '）' : '')"
                  @click="insertToken(p.token)">
                  <code>{{ p.token }}</code>
                </button>
              </div>
            </div>
            <div class="pp-ph-group">
              <span class="pp-ph-title">运行时环境（SDK 提供）</span>
              <div class="pp-chips">
                <button v-for="p in harnessPlaceholders" :key="p.token" class="ap-tagchip pp-chip"
                  :title="p.description" @click="insertToken(p.token)">
                  <code>{{ p.token }}</code>
                </button>
              </div>
            </div>
          </div>
        </details>

        <div class="pp-foot">
          <span v-if="saved" class="ap-hint pp-ok"><Check :size="12" /> 已保存</span>
          <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
          <span v-else class="ap-hint">下一轮新会话生效</span>
          <button class="ap-submit" :disabled="busy || !dirty" @click="save">保存</button>
        </div>
      </div>
    </section>

    <!-- 谁还往提示词里加了东西：让用户看得见，而不是猜 -->
    <section v-if="s.promptSections.length" class="ap-block">
      <header class="ap-block-head">
        <h4>还会自动附加的内容</h4>
        <span class="ap-count">{{ s.promptSections.length }} 段</span>
      </header>
      <div class="ap-table">
        <div v-for="sec in s.promptSections" :key="sec.id" class="ap-tr ps-row">
          <span class="ap-td">{{ sec.title }}</span>
          <span class="ap-td ap-td-meta">{{ sec.source }}</span>
          <span class="ap-td ap-td-meta">{{ sec.text.length }} 字</span>
        </div>
      </div>
      <div class="ap-block-body">
        <p class="ap-hint">
          这些由后台按当前状态自动生成（地址、目录、引用标记说明），不需要你重复写。
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pp-edit { display: flex; flex-direction: column; gap: 8px; }
.ps-row { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; }
</style>
