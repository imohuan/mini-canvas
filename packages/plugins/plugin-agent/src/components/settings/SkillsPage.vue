<script setup lang="ts">
// 技能页：上面是「已安装」列表（表头在上、内容在下），下面是「可导入」列表（扫来源目录）。
import { onMounted, ref } from 'vue'
import { useAgent } from '../../useAgent.js'
import '../../components/settings/settings.css'

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

    <section class="ap-block">
      <header class="ap-block-head"><h4>已安装</h4><span class="ap-count">{{ s.skills.length }} 个</span></header>
      <div class="ap-table ap-scroll">
        <div class="ap-tr is-head"><span>名称</span><span>说明</span><span></span></div>
        <div v-for="k in s.skills" :key="k.name" class="ap-tr">
          <span class="ap-td" :title="k.name">{{ k.name }}</span>
          <span class="ap-td ap-td-meta" :title="k.description">{{ k.description || '（无描述）' }}</span>
          <span class="ap-td-act"><button class="ap-mini danger" @click="agent.removeSkill(k.name)">卸载</button></span>
        </div>
        <p v-if="!s.skills.length" class="ap-empty">还没有安装技能</p>
      </div>
    </section>

    <section class="ap-block">
      <header class="ap-block-head">
        <h4>可导入</h4>
        <span class="ap-count">{{ s.skillCandidates.length }} 个（扫描来源目录）</span>
      </header>
      <div class="ap-table ap-scroll">
        <div class="ap-tr is-head"><span>名称</span><span>说明</span><span></span></div>
        <div v-for="c in s.skillCandidates" :key="c.dir" class="ap-tr">
          <span class="ap-td" :title="c.name">{{ c.name }}</span>
          <span class="ap-td ap-td-meta" :title="c.description">{{ c.description || '（无描述）' }}</span>
          <span class="ap-td-act">
            <span v-if="c.installed" class="ap-tag">已安装</span>
            <button v-else class="ap-mini" @click="agent.importSkill(c.dir)">导入</button>
          </span>
        </div>
        <p v-if="!s.skillCandidates.length" class="ap-empty">来源目录里没有可用技能</p>
      </div>
    </section>

    <section class="ap-block">
      <header class="ap-block-head"><h4>按目录导入</h4></header>
      <div class="ap-block-body">
        <form class="ap-fields" @submit.prevent="importDir">
          <label class="ap-field">技能目录（来源目录下的绝对路径）
            <input v-model="dir" placeholder="C:/Users/Administrator/.agents/skills/code-review" />
          </label>
          <button class="ap-submit" type="submit" :disabled="busy || !dir.trim()">导入</button>
        </form>
      </div>
    </section>
  </div>
</template>
