<script setup lang="ts">
/**
 * ProviderManagerPage —— 设置「集成 → 平台」页。
 *
 * 结构（用户 2026-11-10 定的设计稿）：
 *   [平台] 标签：平台列表 → 点「配置」进入该平台的配置页
 *              配置页 = 一张配置清单（每项一个「账号级」开关）+ 账号列表（可展开做全量配置）
 *   [模型] 标签：左边生成类型（按实际 provider 统计，没有的不显示），右边该类型的模型表，可设默认
 *
 * 没有「刷新」按钮：后台改完会广播 providers-version，这里订阅后自动重拉。
 */
import { computed, onMounted } from 'vue'
import { useCanvasContextOrRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { FeedbackService } from '@mini-canvas/canvas-render'
import type { NotifyContract } from '@mini-canvas/canvas-base'
import { createProviderManagerService, type ProviderRow } from '../../providerManagerService'
import ProviderIcon from './ProviderIcon.vue'

const { ctx } = useCanvasContextOrRender()
const notify = ctx.tryGet<NotifyContract>('notify')
const feedback = ctx.tryGet<FeedbackService>('feedback')
const svc = createProviderManagerService(ctx, feedback ? { ask: (opts) => feedback.confirm(opts) } : undefined)
const s = svc.state

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Switch = useUiComponent('Switch')
const Badge = useUiComponent('Badge')

onMounted(() => void svc.refresh())

// 后台广播了 providers-version → 重拉（会话里可能改过启停/配置）
const cloud = ctx.tryGet<{ onActionsChanged?: unknown }>('cloudClient')
void cloud

function fail(msg: string | null): void {
  if (msg) notify?.error(msg)
}

const editingRow = computed<ProviderRow | undefined>(() =>
  s.editingId ? s.rows.find((r) => r.id === s.editingId) : undefined,
)

function onSave(): void {
  void svc.saveEdit().then(fail)
}
</script>

<template>
  <div class="pmp">
    <p v-if="s.error" class="pmp-error" role="alert">{{ s.error }}</p>

    <!-- ==================== 平台列表 ==================== -->
    <template v-if="!editingRow">
      <div class="pmp-hint-row">
        <span class="pmp-hint">{{ s.rows.length }} 个平台</span>
        <span class="pmp-flex" />
        <span class="pmp-hint">改动立刻生效，不用刷新</span>
      </div>

      <ul class="pmp-list">
        <li v-for="row in s.rows" :key="row.id" class="pmp-row">
          <ProviderIcon :icon="row.icon" :title="svc.titleOf(row)" :size="34" />
          <div class="pmp-row-main">
            <div class="pmp-row-title">
              <span class="pmp-name" :class="{ 'is-off': !row.enabled }">{{ svc.titleOf(row) }}</span>
              <Badge v-if="row.accounts.length > 1" variant="secondary">{{ row.accounts.length }} 个账号</Badge>
              <Badge v-if="row.builtin" variant="outline">内置</Badge>
              <Badge v-if="!row.enabled" variant="outline">已停用</Badge>
            </div>
            <div class="pmp-row-desc">{{ row.description || row.id }}</div>
            <div class="pmp-row-meta">
              {{ row.file || '内置平台，没有文件' }} · {{ row.actions }} 个动作
              <span v-if="!row.enabled"> · 已停用</span>
            </div>
          </div>
          <div class="pmp-row-actions">
            <template v-if="row.builtin">
              <span class="pmp-readonly">只读</span>
            </template>
            <template v-else>
              <Switch
                :model-value="row.enabled"
                :disabled="s.busy"
                :aria-label="'启用 ' + svc.titleOf(row)"
                @update:model-value="() => void svc.toggleEnabled(row).then(fail)"
              />
              <Button variant="outline" size="xs" type="button" @click="svc.openEdit(row)">配置</Button>
              <Button variant="outline" size="xs" type="button" :disabled="s.busy" @click="() => void svc.remove(row).then(fail)">删除</Button>
            </template>
          </div>
        </li>
      </ul>
      <p v-if="!s.rows.length && !s.loading" class="pmp-empty">还没有平台 —— 把 .js 放进数据根的 providers 目录即可</p>
    </template>

    <!-- ==================== 平台配置 ==================== -->
    <template v-if="editingRow">
      <div class="pmp-edit-head">
        <Button variant="ghost" size="xs" type="button" @click="svc.closeEdit()">← 返回平台列表</Button>
      </div>
      <div class="pmp-platform-head">
        <ProviderIcon :icon="editingRow.icon" :title="svc.titleOf(editingRow)" :size="44" />
        <div class="pmp-row-main">
          <div class="pmp-platform-title">{{ svc.titleOf(editingRow) }}</div>
          <div class="pmp-row-desc">{{ editingRow.description || editingRow.id }}</div>
        </div>
      </div>

      <!-- 配置清单 -->
      <section class="pmp-section">
        <header class="pmp-section-head">
          <h4>配置项</h4>
          <span>默认是平台通用；打开右边「账号级」开关，这一项才在每个账号里各存一份（通用值仍可改）</span>
        </header>
        <div class="pmp-field" v-for="f in editingRow.config" :key="f.key">
          <div class="pmp-field-main">
            <div class="pmp-field-title">
              <span>{{ f.label || f.key }}</span>
              <Badge v-if="svc.isAccountField(f.key)" variant="secondary">账号级</Badge>
              <Badge v-else variant="outline">平台通用</Badge>
            </div>
            <div class="pmp-field-desc">{{ f.description }}</div>
          </div>
          <div class="pmp-field-control">
            <Input
              :model-value="String(s.shared[f.key] ?? '')"
              :type="f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'"
              class="pmp-input"
              :placeholder="f.placeholder || f.description"
              :aria-label="(f.label || f.key) + '（平台通用值）'"
              @update:model-value="(v: string) => (s.shared[f.key] = v)"
            />
            <label class="pmp-switch-label">
              <span>账号级</span>
              <Switch
                :model-value="svc.isAccountField(f.key)"
                :aria-label="(f.label || f.key) + '：是否按账号分别配置'"
                @update:model-value="() => svc.toggleAccountField(f.key)"
              />
            </label>
          </div>
        </div>
      </section>

      <!-- 账号 -->
      <section class="pmp-section">
        <header class="pmp-section-head">
          <h4>账号</h4>
          <span>展开可看这个号的全部配置；标「默认」的就是不选号时用的</span>
          <span class="pmp-flex" />
          <Button variant="outline" size="xs" type="button" @click="svc.addAccount()">+ 添加账号</Button>
        </header>

        <div v-for="(acc, ai) in s.accounts" :key="ai" class="pmp-account">
          <div class="pmp-account-head">
            <button type="button" class="pmp-account-toggle" :aria-expanded="svc.isExpanded(ai)" @click="svc.toggleExpanded(ai)">
              <svg class="pmp-caret" :class="{ 'is-open': svc.isExpanded(ai) }" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
              <span class="pmp-account-no">{{ ai + 1 }}</span>
            </button>
            <Input
              :model-value="acc.name"
              class="pmp-input pmp-account-name"
              aria-label="账号名称"
              @update:model-value="(v: string) => (acc.name = v)"
            />
            <span class="pmp-account-id">id: {{ acc.id }}</span>
            <Badge v-if="acc.isDefault" variant="secondary">默认</Badge>
            <Button v-else variant="outline" size="xs" type="button" @click="svc.setDefaultAccount(ai)">设为默认</Button>
            <span class="pmp-flex" />
            <Button variant="outline" size="xs" type="button" @click="svc.toggleEditShared(ai)">
              {{ svc.isEditingShared(ai) ? '完成' : '编辑全局属性' }}
            </Button>
            <Button variant="outline" size="xs" type="button" :disabled="s.accounts.length <= 1" @click="svc.removeAccount(ai)">删除</Button>
          </div>

          <div v-if="svc.isExpanded(ai)" class="pmp-account-body">
            <p class="pmp-account-note">
              {{ svc.isEditingShared(ai)
                ? '正在编辑：标「平台通用」的项改的是所有账号共用的值；标「已覆盖」的项只影响这个账号。'
                : '点右上「编辑全局属性」可以直接改平台通用值；账号级项在这里单独填。' }}
            </p>
            <div v-for="f in editingRow.config" :key="f.key" class="pmp-account-field">
              <span class="pmp-account-field-label">{{ f.label || f.key }}</span>

              <template v-if="svc.isAccountField(f.key)">
                <Input
                  :model-value="String(acc.values[f.key] ?? '')"
                  class="pmp-input"
                  placeholder="留空 = 用平台通用值"
                  :aria-label="(f.label || f.key) + '（账号 ' + (ai + 1) + '）'"
                  @update:model-value="(v: string) => (acc.values[f.key] = v)"
                />
                <Badge v-if="acc.values[f.key] !== undefined && acc.values[f.key] !== ''" variant="secondary">已覆盖</Badge>
                <Badge v-else variant="outline">继承平台值</Badge>
              </template>

              <template v-else-if="svc.isEditingShared(ai)">
                <Input
                  :model-value="String(s.shared[f.key] ?? '')"
                  class="pmp-input"
                  :aria-label="(f.label || f.key) + '（平台通用值）'"
                  @update:model-value="(v: string) => (s.shared[f.key] = v)"
                />
                <span class="pmp-shared-note">改的是平台通用值</span>
              </template>

              <template v-else>
                <span class="pmp-shared-value">{{ s.shared[f.key] === '' || s.shared[f.key] === undefined ? '（未设置）' : s.shared[f.key] }}</span>
                <Badge variant="outline">平台通用</Badge>
              </template>
            </div>
          </div>
        </div>
      </section>

      <div class="pmp-edit-actions">
        <span class="pmp-flex" />
        <Button variant="outline" size="sm" type="button" @click="svc.closeEdit()">取消</Button>
        <Button size="sm" type="button" :disabled="s.busy" @click="onSave">{{ s.busy ? '保存中…' : '保存' }}</Button>
      </div>
    </template>

  </div>
</template>

<style scoped>
/*
 * 控件尺寸统一（用户 2026-11-10：「输入框这么大，按钮这么小，全局统一一下」）。
 * 项目 Input 默认 h-9（36px）、Button 默认 h-9；但设置页里之前混用了 size="xs"（24px），
 * 于是同一行里输入框 36、按钮 24，看着像两套东西。这里把设置页的 Button 统一到 32px，
 * 输入框也压到 32px，行高才对齐。
 */
.pmp :deep([data-slot='button']) { height: 32px; }
.pmp :deep([data-slot='button'][data-size='xs']) { height: 28px; padding-inline: 8px; }
.pmp :deep([data-slot='input']) { height: 32px; padding-block: 4px; }
.pmp { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pmp-hint-row { display: flex; align-items: center; gap: 8px; }
.pmp-flex { flex: 1; }
.pmp-hint { font-size: 10px; color: var(--ui-ink-dim); }
.pmp-error { margin: 0; padding: 8px 10px; border: 1px solid var(--ui-danger, #ef4444); border-radius: 8px; font-size: 12px; color: var(--ui-danger, #ef4444); }
.pmp-empty { padding: 16px 12px; text-align: center; font-size: 12px; color: var(--ui-ink-mute, #8c95a3); }

.pmp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.pmp-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 10px; }
.pmp-row:hover { background: var(--ui-hover); }
.pmp-row-main { min-width: 0; flex: 1; }
.pmp-row-title { display: flex; align-items: center; gap: 6px; }
.pmp-name { font-size: 13px; font-weight: 600; color: var(--ui-ink); }
.pmp-name.is-off { opacity: .6; }
.pmp-row-desc { font-size: 11px; color: var(--ui-ink-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmp-row-meta { font-size: 10.5px; color: var(--ui-ink-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmp-row-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.pmp-readonly { font-size: 11px; color: var(--ui-ink-mute); }

.pmp-edit-head { display: flex; }
.pmp-platform-head { display: flex; align-items: flex-start; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--ui-line, #e2e5ea); }
.pmp-platform-title { font-size: 14px; font-weight: 700; color: var(--ui-ink); }

.pmp-section { border: 1px solid var(--ui-line, #e2e5ea); border-radius: 12px; }
.pmp-section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--ui-line, #e2e5ea); }
.pmp-section-head h4 { margin: 0; font-size: 12px; font-weight: 700; color: var(--ui-ink); }
.pmp-section-head span { font-size: 10.5px; color: var(--ui-ink-mute); }
.pmp-field { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border-top: 1px solid var(--ui-line, #e2e5ea); }
.pmp-field:first-of-type { border-top: 0; }
.pmp-field-main { min-width: 130px; flex: 1; }
.pmp-field-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; font-weight: 500; color: var(--ui-ink); }
.pmp-field-title > span:first-child { white-space: nowrap; }
.pmp-field-desc { margin-top: 2px; font-size: 10.5px; color: var(--ui-ink-mute); }
/* 右侧控件不给收缩：以前允许收缩，窄窗时「账号级」三个字被挤成一列（用户 2026-11-10 截图） */
.pmp-field-control { display: flex; align-items: center; gap: 10px; flex-shrink: 0; min-width: 0; }
.pmp-switch-label { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap; font-size: 10.5px; color: var(--ui-ink-dim); }
.pmp-switch-label > span { white-space: nowrap; }
.pmp-input { width: 100%; max-width: 320px; }
.pmp-field-control .pmp-input { width: 220px; max-width: 220px; flex-shrink: 0; }
.pmp-account-name { max-width: 150px; }

.pmp-account { margin-top: 8px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 10px; background: var(--ui-hover-soft); }
.pmp-account-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
.pmp-account-toggle { display: flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; cursor: pointer; }
.pmp-caret { flex-shrink: 0; width: 15px; height: 15px; color: var(--ui-ink-dim); transition: transform .14s ease; }
.pmp-caret.is-open { transform: rotate(90deg); }
.pmp-account-no { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; background: var(--ui-panel); font-size: 10px; font-weight: 700; color: var(--ui-ink-dim); box-shadow: inset 0 0 0 1px var(--ui-line, #e2e5ea); }
.pmp-account-name { min-width: 120px; max-width: 150px; }
.pmp-account-id { font-size: 10.5px; color: var(--ui-ink-mute); }
.pmp-account-body { padding: 8px 10px 10px; border-top: 1px solid var(--ui-line, #e2e5ea); }
.pmp-account-note { margin: 0 0 6px; font-size: 10.5px; color: var(--ui-ink-mute); }
.pmp-account-field { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.pmp-account-field-label { width: 84px; flex-shrink: 0; text-align: right; font-size: 11px; color: var(--ui-ink-dim); }
.pmp-shared-value { font-size: 11.5px; color: var(--ui-ink); }
.pmp-shared-note { font-size: 9.5px; color: var(--ui-accent, #0891b2); }

.pmp-edit-actions { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
</style>
