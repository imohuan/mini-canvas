<script setup lang="ts">
// MCP 页：上面是「已配置」列表（表头在上、内容在下），下面是添加表单（一行一个字段）。
// kind 三选一，选中后只显示该类型需要的字段 —— 这正是「不用 schema 自动渲染」的原因。
import { computed, onMounted, ref } from 'vue'
import { useAgent } from '../../useAgent.js'
import type { McpProbeResult } from '../../agentService.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state
const busy = ref(false)
const form = ref({
  name: '',
  kind: 'http' as 'stdio' | 'http' | 'sse',
  url: 'http://127.0.0.1:3000/mcp/$smart',
  command: 'node',
  args: '',
})
const isStdio = computed(() => form.value.kind === 'stdio')

/**
 * 「检查连接」的结果。
 *
 * 为什么要这个按钮：SDK 的 MCP 是**懒连接**的，不主动探一次就只能靠「先发一句话」
 * 看那句「已连接 MCP：…」的提示。用户想确认自己配得对不对，不该被迫先花一轮对话。
 */
const probing = ref(false)
const probe = ref<McpProbeResult | null>(null)

async function checkConnection(): Promise<void> {
  probing.value = true
  probe.value = null
  try {
    probe.value = await agent.probeMcp()
  } finally {
    probing.value = false
  }
}

/** 按服务分组展示工具（探测结果里 tools 是平铺的，带 server 字段） */
const toolsByServer = computed(() => {
  const map = new Map<string, McpProbeResult['tools']>()
  for (const t of probe.value?.tools ?? []) {
    const key = t.server || '（未知服务）'
    const list = map.get(key) ?? []
    list.push(t)
    map.set(key, list)
  }
  return [...map.entries()]
})

onMounted(() => void agent.refresh())

async function save(): Promise<void> {
  busy.value = true
  try {
    await agent.addMcp({
      name: form.value.name,
      kind: form.value.kind,
      ...(isStdio.value
        ? { command: form.value.command, args: form.value.args.split(/\s+/).filter(Boolean) }
        : { url: form.value.url }),
    })
    form.value.name = ''
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ap ap-mcp">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <section class="ap-block">
      <header class="ap-block-head">
        <h4>MCP 服务</h4>
        <span class="ap-quick">
          <span class="ap-count">{{ s.mcpServers.length }} 个</span>
          <button class="ap-mini" :disabled="probing || !s.mcpServers.length" @click="checkConnection">
            {{ probing ? '连接中…' : '检查连接' }}
          </button>
        </span>
      </header>
      <div class="ap-table ap-scroll">
        <div class="ap-tr is-head"><span>名称</span><span>地址 / 命令</span><span></span></div>
        <div v-for="m in s.mcpServers" :key="m.name" class="ap-tr">
          <span class="ap-td" :title="m.name">{{ m.name }}<span v-if="m.builtin" class="ap-tag"> 自带</span></span>
          <span class="ap-td ap-td-meta" :title="String(m.config.url || m.config.command || '')">
            {{ String(m.config.url || m.config.command || '') }}{{ m.invalid ? ' · 解析失败' : '' }}
          </span>
          <!-- 自带画布 MCP **不给删除按钮**（用户口径 2026-10-05）：它是随 Agent 内置的，
               删了 Agent 就查不了当前画布。后端也拦同名删除请求 —— 这里只是第一道提示。 -->
          <span class="ap-td-act">
            <button v-if="!m.builtin" class="ap-mini danger" @click="agent.removeMcp(m.name)">删除</button>
            <span v-else class="ap-hint">自带 · 不可删除</span>
          </span>
        </div>
        <p v-if="!s.mcpServers.length" class="ap-empty">还没有配置 MCP 服务</p>
      </div>

      <!-- 检查连接的结果：每个服务连没连上 + 真正拿到了哪些工具 -->
      <div v-if="probe" class="ap-block-body ap-probe">
        <p v-if="probe.error" class="ap-error">{{ probe.error }}</p>
        <template v-else>
          <p class="ap-hint">
            {{ probe.ok ? '连接成功' : '有服务连不上' }}：
            <span v-for="(sv, i) in probe.servers" :key="sv.name">
              {{ i ? '、' : '' }}{{ sv.name }}(<span :class="sv.status === 'completed' ? '' : 'is-bad'">{{ sv.tools }} 个工具</span><template
                v-if="sv.status !== 'completed'">· {{ sv.status }}<template v-if="sv.error"> {{ sv.error }}</template></template>)
            </span>
            <template v-if="!probe.servers.length">没有任何服务返回结果</template>
          </p>
          <p v-for="w in probe.warnings" :key="w" class="ap-hint is-bad">{{ w }}</p>

          <div v-for="[server, list] in toolsByServer" :key="server" class="ap-toolgroup">
            <strong class="ap-toolgroup-name">{{ server }}</strong>
            <div class="ap-tagpool">
              <span v-for="t in list" :key="t.fullName" class="ap-tagchip is-on" :title="t.description">{{ t.name }}</span>
            </div>
          </div>
          <p v-if="probe.ok && !probe.tools.length" class="ap-hint">连上了，但没发现任何工具。</p>
        </template>
      </div>
    </section>

    <section class="ap-block">
      <header class="ap-block-head"><h4>添加 MCP 服务</h4></header>
      <div class="ap-block-body">
        <form class="ap-fields" @submit.prevent="save">
          <label class="ap-field">名称<input v-model="form.name" placeholder="smart" /></label>
          <label class="ap-field">类型
            <select v-model="form.kind"><option value="http">http</option><option value="sse">sse</option><option value="stdio">stdio</option></select>
          </label>
          <label v-if="!isStdio" class="ap-field">URL<input v-model="form.url" placeholder="http://127.0.0.1:3000/mcp/$smart" /></label>
          <template v-else>
            <label class="ap-field">命令<input v-model="form.command" /></label>
            <label class="ap-field">参数<input v-model="form.args" placeholder="用空格分隔" /></label>
          </template>
          <button class="ap-submit" type="submit" :disabled="busy || !form.name.trim()">保存</button>
        </form>
      </div>
    </section>
  </div>
</template>
