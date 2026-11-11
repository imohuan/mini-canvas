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
/** 哪些服务的结果被展开（默认折起来，和列表行一一对应） */
const expanded = ref<Set<string>>(new Set())
/** 添加页的「检测」：不保存也先连一次 */
const draftProbing = ref(false)
const draftProbe = ref<McpProbeResult | null>(null)

onMounted(() => void agent.refresh())

async function checkConnection(): Promise<void> {
  probing.value = true
  probe.value = null
  expanded.value = new Set()
  try {
    probe.value = await agent.probeMcp()
    // 连不上的默认展开：用户点检测就是为了看问题；连上的也展开第一个，省一次点击
    const failed = probe.value.servers.filter((sv) => sv.status !== 'completed')
    const open = (failed.length ? failed : probe.value.servers.slice(0, 1)).map((sv) => sv.name)
    expanded.value = new Set(open)
  } finally {
    probing.value = false
  }
}

/** 某个服务这次检测的结果（列表行里就地显示；没有就不显示） */
function serverResult(name: string): McpProbeResult['servers'][number] | undefined {
  return probe.value?.servers.find((sv) => sv.name === name)
}

/** 某个服务拿到的工具 */
function toolsOf(name: string): McpProbeResult['tools'] {
  return (probe.value?.tools ?? []).filter((t) => t.server === name)
}

function toggleExpanded(name: string): void {
  const next = new Set(expanded.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expanded.value = next
}

function openAdd(): void {
  form.value = { name: '', kind: 'http', url: '', command: 'node', args: '' }
  adding.value = true
  s.error = ''
  draftProbe.value = null
}

function backToList(): void {
  adding.value = false
  s.error = ''
}

/** 检测当前填的这份配置（还没保存）；填错时当场看到原因 */
async function checkDraft(): Promise<void> {
  draftProbing.value = true
  draftProbe.value = null
  s.error = ''
  try {
    draftProbe.value = await agent.probeMcpDraft({
      name: form.value.name.trim() || 'draft',
      kind: form.value.kind,
      ...(isStdio.value
        ? { command: form.value.command, args: form.value.args.split(/\s+/).filter(Boolean) }
        : { url: form.value.url }),
    })
  } finally {
    draftProbing.value = false
  }
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
        <li v-for="m in s.mcpServers" :key="m.name" class="ap-list-item">
          <div class="ap-list-row">
            <div class="ap-list-main">
              <div class="ap-list-title">
                <span class="ap-list-name">{{ m.name }}</span>
                <Badge v-if="m.builtin" variant="secondary">自带</Badge>
                <Badge v-else variant="outline">{{ m.permission ?? 'auto' }}</Badge>
                <Badge v-if="m.invalid" variant="outline">配置有误</Badge>
                <!-- 检测结果就地挂在服务名后面：一眼看出哪个通了、哪个没通 -->
                <span
                  v-if="serverResult(m.name)"
                  class="ap-server-state"
                  :class="serverResult(m.name)!.status === 'completed' ? 'is-ok' : 'is-bad'"
                >
                  {{ serverResult(m.name)!.status === 'completed' ? '通 · ' + serverResult(m.name)!.tools + ' 个工具' : '没通' }}
                </span>
              </div>
              <div class="ap-list-desc">{{ String(m.config.url || m.config.command || '') || '（没有地址）' }}</div>
              <div v-if="m.invalid" class="ap-list-err">{{ m.invalid }}</div>
              <div v-else-if="m.builtin" class="ap-list-meta">随智能助手内置：不能修改，也不能删除</div>
            </div>
            <Button
              v-if="serverResult(m.name)"
              variant="ghost"
              size="xs"
              type="button"
              :aria-expanded="expanded.has(m.name)"
              :aria-label="'查看 ' + m.name + ' 的检测结果'"
              @click="toggleExpanded(m.name)"
            >
              {{ expanded.has(m.name) ? '收起' : '详情' }}
            </Button>
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
          </div>

          <!-- 折叠详情：结果跟在这一行下面，不再堆到页面最底部 -->
          <div v-if="serverResult(m.name) && expanded.has(m.name)" class="ap-server-detail">
            <p v-if="serverResult(m.name)!.error" class="ap-list-err">{{ serverResult(m.name)!.error }}</p>
            <p v-if="toolsOf(m.name).length" class="ap-hint">
              {{ toolsOf(m.name).length }} 个工具 · {{ serverResult(m.name)!.transport || '连接' }} · {{ serverResult(m.name)!.durationMs }}ms
            </p>
            <div v-if="toolsOf(m.name).length" class="ap-tagpool">
              <Badge v-for="t in toolsOf(m.name)" :key="t.fullName" variant="secondary" :title="t.description">{{ t.name }}</Badge>
            </div>
            <p v-else-if="serverResult(m.name)!.status === 'completed'" class="ap-hint">连上了，但没发现任何工具。</p>
          </div>
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

      <!-- 整体失败 / 警告：结果本身已落到各自的服务行下，这里只说不能归到某一行的东西 -->
      <div v-if="probe && (probe.error || probe.warnings.length)" class="ap-probe">
        <p v-if="probe.error" class="ap-error">{{ probe.error }}</p>
        <p v-for="w in probe.warnings" :key="w" class="ap-hint is-bad">{{ w }}</p>
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
          <Input v-model="form.name" class="ap-input" aria-label="MCP 名称" placeholder="给这个服务起个名字" @input="draftProbe = null" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow label="类型" description="http / sse 用地址；stdio 启动本地命令">
            <Select v-model="form.kind" @update:model-value="draftProbe = null">
            <SelectTrigger class="ap-select" size="sm" aria-label="MCP 传输类型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent class="settings-floating-layer" position="popper" side="bottom" :side-offset="4">
              <SelectItem v-for="c in KIND_CHOICES" :key="c.value" :value="c.value">{{ c.label }}</SelectItem>
            </SelectContent>
          </Select>
        </ShadcnSettingsRow>
        <ShadcnSettingsRow v-if="!isStdio" label="URL" description="MCP 端点的完整地址">
          <Input v-model="form.url" class="ap-input" aria-label="MCP URL" placeholder="https://{服务地址}/mcp" @input="draftProbe = null" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow v-else label="命令" description="启动这个 MCP 服务的命令">
          <Input v-model="form.command" class="ap-input" aria-label="MCP 命令" placeholder="例如：npx" @input="draftProbe = null" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow v-if="isStdio" label="参数" description="用空格分隔">
          <Input v-model="form.args" class="ap-input" aria-label="MCP 参数" placeholder="用空格分隔" @input="draftProbe = null" />
        </ShadcnSettingsRow>

        <!-- 检测放在表单正下方：添加时就能确认这份配置连不连得上 -->
        <div class="ap-draft-probe">
            <Button variant="outline" size="sm" type="button" :disabled="draftProbing" @click="checkDraft">
            <PlugZap :size="13" aria-hidden="true" /> {{ draftProbing ? '检测中…' : '检测配置' }}
          </Button>
          <span class="ap-hint">用表单里现在填的值连一次，不会保存</span>
        </div>
        <div v-if="draftProbe" class="ap-probe-result" :class="{ 'is-ok': draftProbe.ok }">
          <p v-if="draftProbe.error" class="ap-error">{{ draftProbe.error }}</p>
          <template v-else>
            <p class="ap-probe-title">
              <span class="ap-probe-state" :class="draftProbe.ok ? 'is-ok' : 'is-bad'">{{ draftProbe.ok ? '连接成功' : '连接失败' }}</span>
              <span class="ap-probe-desc">{{ draftProbe.servers.length }} 个服务 · {{ draftProbe.tools.length }} 个工具</span>
            </p>
            <p v-for="sv in draftProbe.servers" :key="sv.name" class="ap-probe-desc" :class="{ 'is-bad-text': sv.status !== 'completed' }">
              {{ sv.name }} · {{ sv.status }} · {{ sv.tools }} 个工具<template v-if="sv.error"> · {{ sv.error }}</template>
            </p>
            <div v-if="draftProbe.tools.length" class="ap-tagpool">
              <Badge v-for="t in draftProbe.tools" :key="t.fullName" variant="secondary" :title="t.description">{{ t.name }}</Badge>
            </div>
            <p v-for="w in draftProbe.warnings" :key="w" class="ap-hint is-bad">{{ w }}</p>
          </template>
        </div>

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
.ap-list-item { border-radius: 10px; }
.ap-list-item:hover { background: var(--ui-hover, #f4f6f9); }
.ap-list-item .ap-list-row:hover { background: transparent; }
/* 检测状态：成功绿、失败红（与模型卡片同一套固定状态色，暗色下提亮一档） */
.ap-mcp {
  --ap-state-ok: #16a34a;
  --ap-state-bad: #dc2626;
}
html.dark .ap-mcp {
  --ap-state-ok: #4ade80;
  --ap-state-bad: #f87171;
}
.ap-server-state { flex: none; font-size: 10px; font-weight: 600; }
.ap-server-state.is-ok { color: var(--ap-state-ok); }
.ap-server-state.is-bad { color: var(--ap-state-bad); }
/* 折叠详情贴着这一行，左边缩进与文字列对齐 */
.ap-server-detail { display: flex; flex-direction: column; gap: 6px; margin: 0 8px 8px 8px; padding: 8px 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; }
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
.ap-draft-probe { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; }
.ap-probe-result { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; }
/* 信息卡片：默认灰框，成功绿框、失败红框（状态色固定，不跟主题强调色） */
.ap-probe-result.is-ok { border-color: var(--ap-state-ok); }
.ap-probe-result:not(.is-ok) { border-color: var(--ap-state-bad); }
.ap-probe-title { display: flex; align-items: center; gap: 6px; margin: 0; }
.ap-probe-state { font-size: 12px; font-weight: 600; }
.ap-probe-state.is-ok { color: var(--ap-state-ok); }
.ap-probe-state.is-bad { color: var(--ap-state-bad); }
.ap-probe-desc { margin: 0; font-size: 11px; line-height: 1.5; color: var(--ui-ink-dim, #6b7280); }
.ap-probe-desc.is-bad-text { color: var(--ap-state-bad); }
.ap-form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; }
.ap-input { width: 100%; }
.ap-select { width: 160px; }
</style>
