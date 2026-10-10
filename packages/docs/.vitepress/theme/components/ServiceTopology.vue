<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/**
 * 服务分布：把「谁提供了服务、谁一个都不提供」用真数据摊开。
 *
 * 为什么单独做这一块：最常见的误解是「每个插件都注册了一个自己的服务」。
 * 实际上服务是少数派 —— 大多数插件只用**注册场**；有服务的里面有 9 个是 canvas-base
 * 这一件基础插件提供的（doc/save/selection…），真正的"业务插件各一个服务"只是 17 个。
 *
 * 数据读自快照文件（与「活快照」同源），所以数字是真的、可随仓库更新。
 */
const props = withDefaults(defineProps<{ url?: string }>(), {
  url: '/surface-snapshot.json',
})

interface ServiceSurface {
  name: string
  source: string
  methods?: string[]
}
interface PluginStatus {
  name: string
  state: string
  core?: boolean
}
interface Snap {
  services?: ServiceSurface[]
  plugins?: PluginStatus[]
  capturedAt?: string
}

const status = ref<'loading' | 'ok' | 'error'>('loading')
const err = ref('')
const snap = ref<Snap>({})

onMounted(async () => {
  try {
    const res = await fetch(props.url, { cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    snap.value = await res.json()
    status.value = 'ok'
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
  }
})

/** 按"谁提供的"归拢服务 */
const byProvider = computed(() => {
  const m = new Map<string, string[]>()
  for (const s of snap.value.services ?? []) {
    const arr = m.get(s.source) ?? []
    arr.push(s.name)
    m.set(s.source, arr)
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
})

/** 提供方分类：内置 / 宿主 / 基础插件 / 业务插件 */
function kindOf(source: string): string {
  if (source === '<builtin>') return '内核内置'
  if (source === '<host>') return '宿主注入'
  if (source === 'canvas-base') return '基础插件'
  return '业务插件'
}

/** 一个服务都不提供的插件 */
const noService = computed(() => {
  const providers = new Set((snap.value.services ?? []).map((s) => s.source))
  return (snap.value.plugins ?? []).map((p) => p.name).filter((n) => !providers.has(n))
})

const stats = computed(() => {
  const plugins = snap.value.plugins ?? []
  const services = snap.value.services ?? []
  const providers = new Set(services.map((s) => s.source))
  const pluginProviders = [...providers].filter((p) => !p.startsWith('<'))
  return {
    plugins: plugins.length,
    services: services.length,
    pluginProviders: pluginProviders.length,
    noService: plugins.filter((p) => !providers.has(p.name)).length,
  }
})
</script>

<template>
  <div class="mc-live">
    <div v-if="status === 'loading'" class="mc-empty">正在读取快照…</div>
    <div v-else-if="status === 'error'" class="mc-empty">
      读不到快照（{{ err }}）。需要 public/surface-snapshot.json 随站点发布。
    </div>

    <template v-else>
      <div class="mc-stat-row">
        <div class="mc-stat"><b>{{ stats.plugins }}</b><span>插件</span></div>
        <div class="mc-stat"><b>{{ stats.services }}</b><span>服务</span></div>
        <div class="mc-stat mc-stat--hi"><b>{{ stats.pluginProviders }}</b><span>提供服务的插件</span></div>
        <div class="mc-stat mc-stat--hi"><b>{{ stats.noService }}</b><span>不提供服务的插件</span></div>
      </div>

      <p class="mc-note">
        看最下面两格：<b>{{ stats.plugins }} 个插件里，只有 {{ stats.pluginProviders }} 个提供了服务</b>，
        另外 <b>{{ stats.noService }} 个一个服务都不提供</b>（它们只用注册场）。
        所以「每个插件都注册一个自己的服务」是个误解 —— 服务是少数派。
      </p>

      <table class="mc-table">
        <thead><tr><th>提供方</th><th>是什么</th><th>服务</th></tr></thead>
        <tbody>
          <tr v-for="[src, names] in byProvider" :key="src">
            <td class="mc-code">{{ src }}</td>
            <td>{{ kindOf(src) }}</td>
            <td class="mc-dim">{{ names.join(', ') }}</td>
          </tr>
        </tbody>
      </table>

      <h4>一个服务都不提供的插件（{{ noService.length }} 个）</h4>
      <div class="mc-chipbox">
        <span v-for="n in noService" :key="n" class="mc-badge">{{ n }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mc-stat--hi {
  border-color: var(--vp-c-brand-1);
}
.mc-stat--hi b {
  color: var(--vp-c-brand-1);
}
.mc-note {
  border-left: 3px solid var(--vp-c-brand-1);
  padding: 6px 0 6px 12px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
}
</style>
