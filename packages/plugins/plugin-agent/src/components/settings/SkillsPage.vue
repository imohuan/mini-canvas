<script setup lang="ts">
/**
 * SkillsPage —— 技能页：已安装 / 可导入 / 按目录导入。
 *
 * 只换 UI 层：控件全部来自 @mini-canvas/ui-kit-shadcn，数据与调用仍走 agent 服务。
 * 行结构 = 左侧名称与说明、右侧动作（ShadcnSettingsRow 在同一张卡片里带分割线）。
 */
import { onMounted, ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { Trash2, Upload } from 'lucide-vue-next'
import { useAgent } from '../../useAgent.js'
import '../../components/settings/settings.css'

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const agent = useAgent()
const s = agent.state
const dir = ref('')
const busy = ref(false)

onMounted(async () => {
  await agent.refresh()
  await agent.loadSkillCandidates()
})

async function importDir(): Promise<void> {
  const value = dir.value.trim()
  if (!value) return
  busy.value = true
  try {
    await agent.importSkill(value)
    dir.value = ''
    await agent.loadSkillCandidates()
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ap ap-skills">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <ShadcnSettingsSection title="已安装的技能">
      <ShadcnSettingsRow
        v-for="k in s.skills"
        :key="k.name"
        :label="k.name"
        :description="k.description || '（无描述）'"
      >
        <Button variant="destructive" size="sm" type="button" :aria-label="'卸载 ' + k.name" @click="agent.removeSkill(k.name)">
          <Trash2 :size="13" aria-hidden="true" /> 卸载
        </Button>
      </ShadcnSettingsRow>
      <p v-if="!s.skills.length" class="ap-empty">还没有安装技能</p>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="可导入的技能" description="扫描技能来源目录得到的候选">
      <ShadcnSettingsRow
        v-for="c in s.skillCandidates"
        :key="c.dir"
        :label="c.name"
        :description="c.description || '（无描述）'"
      >
        <span v-if="c.installed" class="ap-tag">已安装</span>
        <Button v-else variant="outline" size="sm" type="button" :aria-label="'导入 ' + c.name" @click="agent.importSkill(c.dir)">
          导入
        </Button>
      </ShadcnSettingsRow>
      <p v-if="!s.skillCandidates.length" class="ap-empty">来源目录里没有可用技能</p>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="按目录导入">
      <form class="ap-form-stack ap-skill-form" @submit.prevent="importDir">
        <Input
          v-model="dir"
          aria-label="技能目录"
          placeholder="C:/Users/Administrator/.agents/skills/code-review"
        />
        <div class="ap-form-actions">
          <Button type="submit" size="sm" :disabled="busy || !dir.trim()">
            <Upload :size="13" aria-hidden="true" /> {{ busy ? '导入中…' : '导入' }}
          </Button>
          <span class="ap-hint">填技能目录在来源目录下的绝对路径</span>
        </div>
      </form>
    </ShadcnSettingsSection>
  </div>
</template>

<style scoped>
.ap-skill-form { padding: 10px 0; }
.ap-form-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>
