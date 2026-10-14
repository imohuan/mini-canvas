<script setup lang="ts">
/**
 * AgentSettingsPage —— 设置面板里 Agent 这一页的**整页**。
 *
 * 结构（用户口径：上面一排页签切换不同内容）：
 *   ① 一行页签（Provider / 技能 / MCP / 审批规则 / 系统提示词）
 *   ② 下面只渲染当前选中的那一块
 *
 * 为什么页签是**自己画**的，而不是用设置面板的 settingsTab 插槽：
 * 那个插槽是面板的**页签标签**，要的是小按钮；把整页注册进去会把它撑到 600px 高，
 * 内容区被压成 22px（实测），整页都看不见。所以只注册内容槽，页签自己做。
 */
import { onMounted, ref } from 'vue'
import { useAgent } from '../../useAgent.js'
import '../../components/settings/settings.css'
import ModelsPage from './ModelsPage.vue'
import SkillsPage from './SkillsPage.vue'
import McpPage from './McpPage.vue'
import RulesPage from './RulesPage.vue'
import PromptPage from './PromptPage.vue'
import TitleModelPage from './TitleModelPage.vue'
import AgentPromptPage from './AgentPromptPage.vue'
import TemplatePage from './TemplatePage.vue'

const agent = useAgent()
const s = agent.state

type TabKey = 'models' | 'skills' | 'mcp' | 'rules' | 'agentPrompt' | 'prompt' | 'template' | 'title'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'models', label: 'Provider' },
  { key: 'skills', label: '技能' },
  { key: 'mcp', label: 'MCP' },
  { key: 'rules', label: '审批规则' },
  // 三层的名字必须分清楚（用户口径 2026-10-14：从前只有「系统提示词」一个名字，
  // 而它改的其实是模式清单 —— 名字指错了地方，比没有界面更坏）。
  { key: 'agentPrompt', label: 'Agent 提示词' },
  { key: 'prompt', label: '模式提示词' },
  { key: 'template', label: '系统提示词模板' },
  { key: 'title', label: '会话标题模型' },
]
const tab = ref<TabKey>('models')

onMounted(() => void agent.refresh())
</script>

<template>
  <div class="asp">
    <div class="asp-tabs" role="tablist" aria-label="Agent 设置分类">
      <button v-for="t in TABS" :key="t.key" class="asp-tab" role="tab"
        :class="{ 'is-active': tab === t.key }" :aria-selected="tab === t.key"
        @click="tab = t.key">{{ t.label }}</button>
      <span class="asp-spacer"></span>
      <span v-if="s.error" class="asp-err" :title="s.error">{{ s.error }}</span>
    </div>

    <div class="asp-body">
      <ModelsPage v-if="tab === 'models'" />
      <SkillsPage v-else-if="tab === 'skills'" />
      <McpPage v-else-if="tab === 'mcp'" />
      <RulesPage v-else-if="tab === 'rules'" />
      <AgentPromptPage v-else-if="tab === 'agentPrompt'" />
      <PromptPage v-else-if="tab === 'prompt'" />
      <TemplatePage v-else-if="tab === 'template'" />
      <TitleModelPage v-else />
    </div>
  </div>
</template>

<style scoped>
/* 整页：上面一行页签 + 下面的内容区；内容区自己滚动，页面本身不撑高外层。 */
.asp { display: flex; flex-direction: column; gap: 12px; }
.asp-tabs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding-bottom: 8px; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.asp-tab { height: 28px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--ui-ink-dim, #6b7280); font-size: 12px; cursor: pointer; transition: background 0.16s ease, color 0.16s ease; }
.asp-tab:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); color: var(--ui-ink, #18202b); }
.asp-tab.is-active { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); font-weight: 600; }
.asp-spacer { flex: 1; min-width: 8px; }
.asp-err { max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-danger, #ef4444); }
.asp-body { display: flex; flex-direction: column; }
</style>
