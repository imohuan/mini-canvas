<script setup lang="ts">
/**
 * McpPage —— MCP 服务：列表 → 二级「添加」页。
 *
 * 用户口径（2026-11-11）：
 *   1. 添加放在二级菜单里，和「添加渠道」一样，不要在列表下面堆一张长表单；
 *   2. 列表空了要有明确的空状态；
 *   3. 自带（内置）的 MCP 只读：不能改、不能删，界面上要说清楚。
 *
 * 注意：列表行**必须直接渲染**，不能套一层 `<template>` —— 浏览器把它当隐形节点，
 * 整行会量到 0 高，看起来就是「有计数、没内容」（2026-11-11 截图实测）。
 */
import { computed, onMounted, ref } from 'vue'
import { PlugZap, Plus, Trash2 } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import type { McpProbeResult } from '../../service/agentService.js'
import SettingsDetailHeader from './components/SettingsDetailHeader.vue'
import './settings.css'

const Badge = useUiComponent('Badge')
const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Select = useUiComponent('Select')
const SelectContent = useUiComponent('SelectContent')
const SelectItem = useUiComponent('SelectItem')
const SelectTrigger = useUiComponent('SelectTrigger')
const SelectValue = useUiComponent('SelectValue')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const agent = useAgent()
const s = agent.state

type Kind = 'stdio' | 'http' | 'sse'
const KIND_CHOICES: Array<{ label: string; value: Kind }> = [
  { label: 'http', value: 'http' },
  { label: 'sse', value: 'sse' },
  { label: 'stdio', value: 'stdio' },
]
const busy = ref(false)
/** false = 列表；true = 添加（二级页） */
const adding = ref(false)
const form = ref({
  name: '',
  kind: 'http' as Kind,
  url: '',
  command: 'node',
  args: '',
})
const isStdio = computed(() => form.value.kind === 'stdio')

const probing = ref(false)
const probe = ref<McpProbeResult | null>(null)

onMounted(() => void agent.refresh())

async function checkConnection(): Promise<void> {
  probing.value = true
  probe.value = null
  try {
    probe.value = await agent.probeMcp()
  } finally {
    probing.value = false
  }
}

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

function openAdd(): void {
  form.value = { name: '', kind: 'http', url: '', command: 'node', args: '' }
  adding.value = true
  s.error = ''
}

function backToList(): void {
  adding.value = false
  s.error = ''
}

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
    // 加完回列表：刚加的服务就在第一屏，不用在表单旁边找结果。
    adding.value = false
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

    <!-- ==================== 列表态 ==================== -->
    <div v-if="!adding" class="ap-mcp-list">
      <div class="ap-list-head">
        <span class="ap-hint">{{ s.mcpServers.length }} 个已配置 · 自带服务只读</span>
        <Button size="sm" type="button" @click="openAdd">
          <Plus :size="13" aria-hidden="true" /> 添加 MCP
        </Button>
      </div>

      <ul class="ap-list">
        <li v-for="m in s.mcpServers" :key="m.name" class="ap-list-row">
          <div class="ap-list-main">
            <div class="ap-list-title">
              <span class="ap-list-name">{{ m.name }}</span>
              <Badge v-if="m.builtin" variant="secondary">自带</Badge>
              <Badge v-else variant="outline">{{ m.permission ?? 'auto' }}</Badge>
              <Badge v-if="m.invalid" variant="outline">配置有误</Badge>
            </div>
            <div class="ap-list-desc">{{ String(m.config.url || m.config.command || '') || '（没有地址）' }}</div>
            <div v-if="m.invalid" class="ap-list-err">{{ m.invalid }}</div>
            <div v-else-if="m.builtin" class="ap-list-meta">随智能助手内置：不能修改，也不能删除</div>
          </div>
          <Button
            v-if="!m.builtin"
            variant="destructive"
            size="sm"
            type="button"
            :disabled="busy"
            :aria-label="'删除 MCP ' + m.name"
            @click="agent.removeMcp(m.name)"
          >
            <Trash2 :size="13" aria-hidden="true" /> 删除
          </Button>
          <span v-else class="ap-readonly">只读</span>
        </li>
      </ul>

      <div v-if="!s.mcpServers.length" class="ap-empty ap-empty-card">
        <PlugZap :size="20" aria-hidden="true" />
        <strong>还没有 MCP 服务</strong>
        <span>点右上「添加 MCP」，填地址或命令就能接上外部工具。</span>
      </div>

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
    </div>

    <!-- ==================== 添加态（二级页） ==================== -->
    <div v-else class="ap-mcp-add">
      <SettingsDetailHeader
        back-label="返回 MCP 列表"
        title="添加 MCP 服务"
        description="填完后回到列表查看；自带服务不会被这里改动。"
        @back="backToList"
      />

      <form class="ap-form-stack ap-mcp-form" @submit.prevent="save">
        <ShadcnSettingsRow label="名称" description="只作标签，字母、数字、下划线和短横线">
          <Input v-model="form.name" class="ap-input" aria-label="MCP 名称" placeholder="给这个服务起个名字" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow label="类型" description="http / sse 用地址；stdio 启动本地命令">
          <Select v-model="form.kind">
            <SelectTrigger class="ap-select" size="sm" aria-label="MCP 传输类型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent class="settings-floating-layer" position="popper" side="bottom" :side-offset="4">
              <SelectItem v-for="c in KIND_CHOICES" :key="c.value" :value="c.value">{{ c.label }}</SelectItem>
            </SelectContent>
          </Select>
        </ShadcnSettingsRow>
        <ShadcnSettingsRow v-if="!isStdio" label="URL" description="MCP 端点的完整地址">
          <Input v-model="form.url" class="ap-input" aria-label="MCP URL" placeholder="https://{服务地址}/mcp" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow v-else label="命令" description="启动这个 MCP 服务的命令">
          <Input v-model="form.command" class="ap-input" aria-label="MCP 命令" placeholder="例如：npx" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow v-if="isStdio" label="参数" description="用空格分隔">
          <Input v-model="form.args" class="ap-input" aria-label="MCP 参数" placeholder="用空格分隔" />
        </ShadcnSettingsRow>

        <div class="ap-form-actions is-sticky">
          <!-- 操作条固定在底部：窄窗口 / 长说明时不用滚到底才找到添加 -->
          <Button variant="outline" size="sm" type="button" @click="backToList">取消</Button>
          <Button type="submit" size="sm" :disabled="busy || !form.name.trim()">
            <Plus :size="13" aria-hidden="true" /> {{ busy ? '保存中…' : '添加' }}
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ap-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ap-list-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 10px; }
.ap-list-row:hover { background: var(--ui-hover, #f4f6f9); }
.ap-list-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ap-list-title { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.ap-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-list-desc, .ap-list-meta, .ap-list-err { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.ap-list-meta { font-size: 10.5px; color: var(--ui-ink-mute, #8c95a3); }
.ap-list-err { color: var(--ui-danger, #ef4444); }
.ap-readonly { flex: none; font-size: 11px; color: var(--ui-ink-mute, #8c95a3); }
.ap-empty-card { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 24px 12px; border: 1px dashed var(--ui-line, #e2e5ea); border-radius: 10px; }
.ap-empty-card strong { font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-empty-card span { font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.ap-mcp-probe { padding: 10px 0 4px; }
.ap-mcp-form { padding: 4px 0; }
.ap-form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; }
.ap-input { width: 100%; }
.ap-select { width: 160px; }
</style>
