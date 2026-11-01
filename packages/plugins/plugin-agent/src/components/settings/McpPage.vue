<script setup lang="ts">
// MCP 页：已配置列表 + 添加表单。控件全部来自 @mini-canvas/ui-kit-shadcn。
import { computed, onMounted, ref } from 'vue'
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mini-canvas/ui-kit-shadcn'
import { PlugZap, Plus, Trash2 } from 'lucide-vue-next'
import { useAgent } from '../../useAgent.js'
import type { McpProbeResult } from '../../agentService.js'
import { SettingsRow as ShadcnSettingsRow, SettingsSection as ShadcnSettingsSection } from '@mini-canvas/ui-kit-shadcn'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state

type Kind = 'stdio' | 'http' | 'sse'
/** MCP 传输类型（原生值 = 后台认的 kind）。 */
const KIND_CHOICES: Array<{ label: string; value: Kind }> = [
  { label: 'http', value: 'http' },
  { label: 'sse', value: 'sse' },
  { label: 'stdio', value: 'stdio' },
]
const busy = ref(false)
const form = ref({
  name: '',
  kind: 'http' as Kind,
  url: 'http://127.0.0.1:3000/mcp/$smart',
  command: 'node',
  args: '',
})
const isStdio = computed(() => form.value.kind === 'stdio')

/**
 * 「检查连接」的结果。
 *
 * SDK 的 MCP 是懒连接的，不主动探一次就只能靠「先发一句话」看提示；
 * 这个按钮让用户不必花一轮对话就能确认配置对不对。
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

    <ShadcnSettingsSection
      title="MCP 服务"
      :description="s.mcpServers.length + ' 个已配置'"
    >
      <template>
        <ShadcnSettingsRow
          v-for="m in s.mcpServers"
          :key="m.name"
          :label="m.name"
          :description="String(m.config.url || m.config.command || '')"
        >
          <Badge v-if="m.builtin" variant="secondary">自带</Badge>
          <Button
            v-else
            variant="destructive"
            size="icon-sm"
            type="button"
            :aria-label="'删除 MCP ' + m.name"
            @click="agent.removeMcp(m.name)"
          >
            <Trash2 :size="13" aria-hidden="true" />
          </Button>
        </ShadcnSettingsRow>
        <p v-if="!s.mcpServers.length" class="ap-empty">还没有配置 MCP 服务</p>
        <div class="ap-mcp-probe">
          <Button
            variant="outline"
            size="sm"
            type="button"
            :disabled="probing || !s.mcpServers.length"
            @click="checkConnection"
          >
            <PlugZap :size="13" aria-hidden="true" /> {{ probing ? '连接中…' : '检查连接' }}
          </Button>
        </div>

        <div v-if="probe" class="ap-probe">
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
                <Badge v-for="t in list" :key="t.fullName" variant="secondary" :title="t.description">{{ t.name }}</Badge>
              </div>
            </div>
            <p v-if="probe.ok && !probe.tools.length" class="ap-hint">连上了，但没发现任何工具。</p>
          </template>
        </div>
      </template>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="添加 MCP 服务">
      <form class="ap-form-stack ap-mcp-form" @submit.prevent="save">
        <ShadcnSettingsRow label="名称">
          <Input v-model="form.name" class="ap-input" aria-label="MCP 名称" placeholder="smart" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow label="类型">
          <Select v-model="form.kind">
            <SelectTrigger class="ap-select" size="sm" aria-label="MCP 传输类型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent class="settings-floating-layer" position="popper" side="bottom" :side-offset="4">
              <SelectItem v-for="c in KIND_CHOICES" :key="c.value" :value="c.value">{{ c.label }}</SelectItem>
            </SelectContent>
          </Select>
        </ShadcnSettingsRow>
        <ShadcnSettingsRow v-if="!isStdio" label="URL">
          <Input v-model="form.url" class="ap-input" aria-label="MCP URL" placeholder="http://127.0.0.1:3000/mcp/$smart" />
        </ShadcnSettingsRow>
        <template v-else>
          <ShadcnSettingsRow label="命令">
            <Input v-model="form.command" class="ap-input" aria-label="MCP 命令" />
          </ShadcnSettingsRow>
          <ShadcnSettingsRow label="参数">
            <Input v-model="form.args" class="ap-input" aria-label="MCP 参数" placeholder="用空格分隔" />
          </ShadcnSettingsRow>
        </template>
        <div class="ap-form-actions">
          <Button type="submit" size="sm" :disabled="busy || !form.name.trim()">
            <Plus :size="13" aria-hidden="true" /> 保存
          </Button>
        </div>
      </form>
    </ShadcnSettingsSection>
  </div>
</template>

<style scoped>
.ap-mcp-form { padding: 8px 0; }
.ap-mcp-probe { padding: 10px 0 4px; }
.ap-form-actions { display: flex; justify-content: flex-end; padding: 8px 0 10px; }
.ap-input { width: 100%; }
.ap-select { width: 160px; }
</style>
