<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * 运行时能力面板：读后台下发的接口，显示插件**真正注册了哪些能力**
 * （槽位 / 路由 / 存储 / 定时 / MCP / Agent …）。
 *
 * 静态声明在 package.json 里，运行期注册只有后台知道 —— 所以这一块走接口。
 * 接口还没就绪时**不报错**，只显示一句提示，页面照样能看。
 *
 * 接口形状（约定，可与后台对齐后调整）：
 *   GET <base><endpoint> →
 *   { groups: [{ id, label, description, items: [{ plugin, name, detail }] }] }
 */
const props = withDefaults(
  defineProps<{
    /** 接口基址；默认空串 = 与文档站同源（由反代把 /api 转给 cloud-server） */
    base?: string
    /** 接口路径 */
    endpoint?: string
  }>(),
  { base: '', endpoint: '/api/plugins/capabilities' },
)

interface CapItem {
  plugin: string
  name: string
  detail?: string
}
interface CapGroup {
  id: string
  label: string
  description?: string
  items: CapItem[]
}

const state = ref<'loading' | 'ok' | 'empty' | 'error'>('loading')
const groups = ref<CapGroup[]>([])
const error = ref('')

onMounted(async () => {
  const url = props.base + props.endpoint
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const json = (await res.json()) as { groups?: CapGroup[] }
    groups.value = json.groups ?? []
    state.value = groups.value.length ? 'ok' : 'empty'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    state.value = 'error'
  }
})
</script>

<template>
  <div v-if="state === 'loading'" class="mc-empty">正在读取运行时能力…</div>

  <div v-else-if="state === 'error'" class="mc-empty">
    后台接口未就绪：<span class="mc-code">{{ base + endpoint }}</span>（{{ error }}）<br />
    运行时能力会在接口接通后自动出现在这里；静态声明见上方插件列表。
  </div>

  <div v-else-if="state === 'empty'" class="mc-empty">接口通了，但还没有插件注册能力。</div>

  <div v-else>
    <section v-for="g in groups" :key="g.id" class="mc-cap-group">
      <h3>{{ g.label }}</h3>
      <p v-if="g.description" class="mc-cap-desc">{{ g.description }}</p>
      <ul>
        <li v-for="(it, i) in g.items" :key="g.id + i">
          <span class="mc-code">{{ it.plugin }}</span> · {{ it.name }}
          <span v-if="it.detail" class="mc-cap-detail">{{ it.detail }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.mc-cap-group {
  margin: 18px 0;
}
.mc-cap-group h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.mc-cap-desc {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.mc-cap-group ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
.mc-cap-detail {
  color: var(--vp-c-text-2);
  margin-left: 6px;
}
</style>
