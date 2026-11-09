<script setup lang="ts">
/**
 * ProviderManagerPage —— 设置面板「集成 → 平台」页。
 *
 * 结构：
 *   ① 工具条：刷新 + 强制刷新 + 错误行
 *   ② 平台列表：一行一个 provider（名字 / 动作数 / 文件名 + 启停开关 + 配置 + 删除）
 *   ③ 编辑区（点「配置」展开）：账号清单，每个账号按声明的 config 动态渲染控件；
 *      多账号可增删，保存整体替换。secret 回显掩码，留空 = 不改。
 */
import { onMounted } from 'vue'
import { useCanvasContextOrRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { FeedbackService } from '@mini-canvas/canvas-render'
import type { NotifyContract } from '@mini-canvas/canvas-base'
import {
  createProviderManagerService,
  type ProviderRow,
} from '../../providerManagerService'

const { ctx } = useCanvasContextOrRender()
const notify = ctx.tryGet<NotifyContract>('notify')
// 删文件 / 卸载这类不可撤销动作一律走项目统一确认框（与插件页同一条通道）
const feedback = ctx.tryGet<FeedbackService>('feedback')
// 只交出确认那一件事（服务对象本身带着别的字段，形状越窄越不容易被误用）
const svc = createProviderManagerService(
  ctx,
  feedback ? { ask: (opts) => feedback.confirm(opts) } : undefined,
)
const s = svc.state

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Switch = useUiComponent('Switch')
const Badge = useUiComponent('Badge')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')
const Select = useUiComponent('Select')
const SelectContent = useUiComponent('SelectContent')
const SelectItem = useUiComponent('SelectItem')
const SelectTrigger = useUiComponent('SelectTrigger')
const SelectValue = useUiComponent('SelectValue')

onMounted(() => void svc.refresh())

function fail(msg: string | null): void {
  if (msg) notify?.error(msg)
}

function onToggle(row: ProviderRow): void {
  void svc.toggleEnabled(row).then(fail)
}
function onRemove(row: ProviderRow): void {
  void svc.remove(row).then(fail)
}
function onSave(): void {
  void svc.saveEdit().then(fail)
}
function onReload(): void {
  void svc.forceReload().then(fail)
}

/** 控件里把值写回某个账号 */
function setValue(ai: number, key: string, v: string | number | boolean): void {
  s.editingAccounts[ai]!.values[key] = v
}
/** number 输入框的 v-model（Input 给 string，转一下） */
function numOf(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}
</script>

<template>
  <div class="pmp">
    <div class="pmp-toolbar">
      <span class="pmp-hint">{{ s.rows.length }} 个平台</span>
      <span class="pmp-flex" />
      <Button variant="outline" size="sm" type="button" :disabled="s.loading" @click="() => void svc.refresh()">
        {{ s.loading ? '刷新中…' : '刷新' }}
      </Button>
      <Button variant="outline" size="sm" type="button" :disabled="s.loading" @click="onReload">强制刷新</Button>
    </div>
    <p v-if="s.error" class="pmp-error" role="alert">{{ s.error }}</p>

    <ShadcnSettingsSection title="平台（Provider）" description="启停立刻生效；配置按账号保存，多账号时底栏动作参数里可选账号。">
      <ShadcnSettingsRow
        v-for="row in s.rows"
        :key="row.file"
        :label="row.id"
        :description="(row.file || '内置平台，没有文件') + ' · ' + row.actions + ' 个动作' + (row.enabled ? '' : ' · 已停用')"
      >
        <span class="pmp-row-actions">
          <Badge v-if="!row.enabled" variant="outline">停用</Badge>
          <Badge v-else-if="row.accounts.length > 1" variant="secondary">{{ row.accounts.length }} 个账号</Badge>
          <Switch
            v-if="row.file"
            :model-value="row.enabled"
            :disabled="s.busyFile === row.file"
            :aria-label="'启用 ' + row.id"
            @update:model-value="() => onToggle(row)"
          />
          <template v-if="row.file">
            <Button variant="outline" size="xs" type="button" @click="svc.openEdit(row)">配置</Button>
            <Button variant="outline" size="xs" type="button" :disabled="s.busyFile === row.file" @click="onRemove(row)">删除</Button>
          </template>
          <Badge v-else variant="outline">内置</Badge>
        </span>
      </ShadcnSettingsRow>
      <p v-if="!s.rows.length && !s.loading" class="pmp-empty">还没有平台 —— 把 .js 放进数据根的 providers 目录即可</p>
    </ShadcnSettingsSection>

    <!-- 编辑区：按声明的 config 动态渲染；账号可增删 -->
    <ShadcnSettingsSection v-if="s.editingFile" title="编辑账号配置" :description="'文件：' + s.editingFile">
      <div v-for="(acc, ai) in s.editingAccounts" :key="ai" class="pmp-account">
        <div class="pmp-account-head">
          <span class="pmp-account-title">账号 {{ ai + 1 }}</span>
          <span class="pmp-flex" />
          <Button variant="outline" size="xs" type="button" :disabled="s.editingAccounts.length <= 1" @click="svc.removeAccount(ai)">删除账号</Button>
        </div>
        <ShadcnSettingsRow label="账号 ID" description="底栏动作参数里按这个名字选账号">
          <Input :model-value="acc.id" class="pmp-input" aria-label="账号 ID" @update:model-value="(v: string) => (acc.id = v)" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow label="显示名" description="可选；下拉里显示的名字">
          <Input :model-value="acc.name" class="pmp-input" aria-label="显示名" @update:model-value="(v: string) => (acc.name = v)" />
        </ShadcnSettingsRow>
        <template v-for="f in (s.rows.find((r) => r.file === s.editingFile)?.config ?? [])" :key="f.key">
          <ShadcnSettingsRow :label="f.label || f.key" :description="f.description" :stacked="f.type === 'text'">
            <Switch
              v-if="f.type === 'boolean'"
              :model-value="acc.values[f.key] === true"
              :aria-label="f.label || f.key"
              @update:model-value="(v: boolean) => setValue(ai, f.key, v)"
            />
            <Select
              v-else-if="f.type === 'select' && (f.options?.length ?? 0) > 0"
              :model-value="String(acc.values[f.key] ?? f.options![0]!.value)"
              @update:model-value="(v: string) => setValue(ai, f.key, v)"
            >
              <SelectTrigger class="pmp-select" size="sm" :aria-label="f.label || f.key"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" side="bottom" :side-offset="4">
                <SelectItem v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              v-else-if="f.type === 'number'"
              :model-value="numOf(acc.values[f.key])"
              type="number"
              class="pmp-input pmp-num"
              :aria-label="f.label || f.key"
              @update:model-value="(v: string) => setValue(ai, f.key, v === '' ? 0 : Number(v))"
            />
            <Input
              v-else-if="f.type === 'secret'"
              :model-value="String(acc.values[f.key] ?? '')"
              type="text"
              class="pmp-input"
              spellcheck="false"
              autocomplete="off"
              :placeholder="f.placeholder || (acc.values[f.key] ? '已配置（掩码回显）· 改就输入新值，留空 = 不变' : '粘贴密钥')"
              :aria-label="f.label || f.key"
              @update:model-value="(v: string) => setValue(ai, f.key, v)"
            />
            <textarea
              v-else-if="f.type === 'text'"
              class="pmp-textarea"
              :value="String(acc.values[f.key] ?? '')"
              :placeholder="f.placeholder"
              :aria-label="f.label || f.key"
              @change="(e: Event) => setValue(ai, f.key, (e.target as HTMLTextAreaElement).value)"
            />
            <Input
              v-else
              :model-value="String(acc.values[f.key] ?? '')"
              class="pmp-input"
              :placeholder="f.placeholder"
              :aria-label="f.label || f.key"
              @update:model-value="(v: string) => setValue(ai, f.key, v)"
            />
          </ShadcnSettingsRow>
        </template>
      </div>
      <div class="pmp-edit-actions">
        <Button variant="outline" size="sm" type="button" @click="() => { const row = s.rows.find((r) => r.file === s.editingFile); if (row) svc.addAccount(row) }">添加账号</Button>
        <span class="pmp-flex" />
        <Button variant="outline" size="sm" type="button" @click="svc.closeEdit">取消</Button>
        <Button size="sm" type="button" :disabled="s.busyFile === s.editingFile" @click="onSave">
          {{ s.busyFile === s.editingFile ? '保存中…' : '保存' }}
        </Button>
      </div>
    </ShadcnSettingsSection>

  </div>
</template>

<style scoped>
.pmp { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pmp-toolbar { display: flex; align-items: center; gap: 8px; }
.pmp-flex { flex: 1; }
.pmp-hint { font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.pmp-error { margin: 0; padding: 8px 10px; border: 1px solid var(--ui-danger, #ef4444); border-radius: 8px; font-size: 12px; color: var(--ui-danger, #ef4444); }
.pmp-empty { padding: 16px 12px; text-align: center; font-size: 12px; color: var(--ui-ink-dim, #6b7280); }
.pmp-row-actions { display: flex; align-items: center; gap: 8px; }
.pmp-account { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-top: 1px solid var(--ui-line-faint, #eef0f4); }
.pmp-account:first-of-type { border-top: 0; }
.pmp-account-head { display: flex; align-items: center; gap: 8px; }
.pmp-account-title { font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.pmp-input { width: 100%; max-width: 320px; }
.pmp-num { max-width: 140px; }
.pmp-select { width: 200px; }
.pmp-textarea { width: 100%; max-width: 320px; min-height: 64px; padding: 6px 8px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: transparent; color: var(--ui-ink, #18202b); font: inherit; }
.pmp-edit-actions { display: flex; align-items: center; gap: 8px; padding-top: 10px; }
</style>
