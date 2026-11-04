<script setup lang="ts">
/**
 * AgentSettingsPage —— 设置面板里 Agent 这一页的整页。
 *
 * 结构（用户口径：上面一排页签切换不同内容）：
 *   ① 一行页签（Provider / 技能 / MCP / 审批规则 / 系统提示词…）
 *   ② 下面只渲染当前选中的那一块
 *
 * 页签与页面壳子都用 @mini-canvas/ui-kit-shadcn 的 Tabs；业务页面各自负责内容，
 * 本文件只换 UI 层，不改任何数据与调用。
 */
import { onMounted, ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import './settings.css'
import ModelsPage from './ModelsPage.vue'
import SkillsPage from './SkillsPage.vue'
import McpPage from './McpPage.vue'
import RulesPage from './RulesPage.vue'
import PromptPage from './PromptPage.vue'
import TitleModelPage from './TitleModelPage.vue'
import AgentPromptPage from './AgentPromptPage.vue'
import TemplatePage from './TemplatePage.vue'

const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')

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
    <div class="asp-head">
      <Tabs v-model="tab">
        <TabsList variant="line" class="asp-tab-list" aria-label="Agent 设置分类">
          <TabsTrigger v-for="t in TABS" :key="t.key" :value="t.key" class="asp-tab">
            {{ t.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
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
.asp { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.asp-head { display: flex; align-items: center; gap: 10px; min-width: 0; padding-bottom: 2px; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.asp-tab-list { flex: 1; min-width: 0; height: auto; justify-content: flex-start; flex-wrap: wrap; gap: 2px; overflow-x: auto; padding: 0; }
.asp-tab { flex: none; height: 30px; padding: 0 10px; border-radius: var(--radius-control, 8px); font-size: 12px; font-weight: 600; }
.asp-err { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-danger, #ef4444); }
.asp-body { display: flex; flex-direction: column; min-width: 0; }
</style>
