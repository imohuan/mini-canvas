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
import { useCanvasContextOrRender, useUiComponent } from '@plume-canvas/canvas-render'
import type { FeedbackService } from '@plume-canvas/canvas-render'
import type { NotifyContract } from '@plume-canvas/plugin-sdk'
import { createProviderManagerService, type ProviderRow } from '../../providerManagerService'
import ProviderIcon from './ProviderIcon.vue'

/*
 * 模型图标判定（与底栏模型下拉逐条对齐，用户口径 2026-11-20）。
 *
 * 为什么写在组件里而不是单独开一个文件：这个工作区里同时跑着多台 vite dev，
 * 「新增一个源文件 + 别的文件 import 它」在热重载期间会被解析成找不到模块
 * （用户 2026-11-20 启动服务直接报 Failed to resolve import "../../modelIcon"）。
 * 逻辑放进本文件后，改完只触发一次组件热替换，任何 dev 服务器都不会再踩到。
 *
 * 优先级照抄 plugin-bottom-bar/src/node-bottom-bar/actionIcon.ts：
 * 1. `icon` 是 SVG / Base64 → 直接用；
 * 2. `icon` 是名字 → 交给 Agent 的图标服务模糊查；
 * 3. 没给 icon → 按模型标题猜平台；
 * 4. 平台自己的 icon 兜底；
 * 5. 都认不出 → 按节点类型给通用图形。
 */
interface ModelIcon {
  tone: string
  svg: string
}

/** Agent 的 modelIcons 服务（没装 Agent 时为 undefined） */
interface ModelIconServiceLike {
  svgOfName(name: string): string
  platformOfName(name: string): string
  platformOfIconHint?(hint: string): string
  svgOfIconHint?(hint: string): string
}

/** 本地通用兜底图形（认不出平台时用；颜色由 data-tone 决定） */
function fallbackModelIcon(nodeType?: string): ModelIcon {
  const body: Record<string, string> = {
    image:
      '<rect x="3" y="4.5" width="18" height="15" rx="2.6"/><circle cx="8.6" cy="9.6" r="1.6"/>'
      + '<path d="m21 15.4-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 19.4"/>',
    video:
      '<rect x="3" y="5.4" width="13" height="13.2" rx="2.4"/><path d="m16 9.6 5-2.8v10.4l-5-2.8z"/>',
    audio: '<path d="M3 10v4M7 6.6v10.8M11 3.6v16.8M15 7.4v9.2M19 10v4"/>',
    text: '<path d="M4 7V4h16v3M12 4v16M8 20h8"/>',
  }
  const key = nodeType && body[nodeType] ? nodeType : 'text'
  return {
    tone: key,
    svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body[key] + '</svg>',
  }
}

/**
 * provider 自带图标：SVG 字符串，或 `data:image/…;base64,…`。
 * 这段字符串会走 v-html，来源是 providers 目录里的文件，只放行两种确定安全的形态。
 */
function customModelIcon(raw: unknown): ModelIcon | undefined {
  if (typeof raw !== 'string') return undefined
  let s = raw.trim()
  if (!s) return undefined

  const svgAt = s.search(/<svg[\s>]/i)
  if (svgAt > 0) s = s.slice(svgAt)

  if (/^<svg[\s>]/i.test(s)) {
    if (/<script|<foreignObject|javascript:|\son[a-z]+\s*=/i.test(s)) return undefined
    if (!/viewBox\s*=|width\s*=/i.test(s)) return undefined
    return { tone: 'custom', svg: s }
  }

  const m = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i.exec(s)
  if (!m) return undefined
  const mime = 'image/' + m[1]!.toLowerCase()
  return {
    tone: 'custom',
    svg: '<img src="data:' + mime + ';base64,' + m[2]!.replace(/\s+/g, '') + '" alt="" draggable="false">',
  }
}

/** 解析一个模型的图标（入参与底栏的 resolveActionIcon 一致） */
function resolveModelIcon(
  title: string,
  service: ModelIconServiceLike | undefined,
  nodeType: string | undefined,
  providerIcon: unknown,
): ModelIcon {
  // 1. 按标题猜平台（设置页拿不到动作自己的 icon，从这一步开始）
  if (service) {
    const platform = service.platformOfName(title)
    if (platform !== 'custom') return { tone: platform, svg: service.svgOfName(title) }
  }

  // 2. 平台自己的图标兜底
  const fromProvider = customModelIcon(providerIcon)
  if (fromProvider) return fromProvider

  // 3. 本地通用图形（绝不空白）
  return fallbackModelIcon(nodeType)
}

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

/** 平台图标服务（与底栏模型下拉同一把尺子） */
const iconService = computed(() => ctx.tryGet<ModelIconServiceLike>('modelIcons'))

const modelRows = computed(() =>
  (editingRow.value?.models ?? []).map((m) => ({
    ...m,
    icon: resolveModelIcon(m.title, iconService.value, m.nodeTypes?.[0], editingRow.value?.icon),
    /**
     * 设置页只显示模型自己的描述，不加平台前缀（用户口径 2026-11-20）。
     * 平台前缀是底栏下拉的事；两处表现形式不同是有意的。
     */
    desc: m.description ?? '',
  })),
)
const enabledModelCount = computed(() => modelRows.value.filter((m) => svc.isModelEnabled(m.id)).length)

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

      <!-- 模型：这个平台导出的全部模型，关掉的不会出现在底栏下拉里 -->
      <section class="pmp-section">
        <header class="pmp-section-head">
          <h4>模型</h4>
          <span>关掉的模型不会出现在底栏的模型下拉里；随时可以再打开</span>
          <span class="pmp-flex" />
          <span class="pmp-hint">{{ enabledModelCount }} / {{ modelRows.length }} 个已开启</span>
        </header>

        <p v-if="!modelRows.length" class="pmp-empty">这个平台还没有导出模型</p>
        <div v-else class="pmp-model-list">
          <!--
            设置页只显示**模型标题 + 描述**（用户口径 2026-11-20 第二次修正）。
            这里不加平台前缀、也不出悬停气泡：描述直接把话说完，最多 4 行内换行显示。
            底栏下拉才需要「平台前缀 + 单行省略 + 气泡」，两处表现本来就该不同。
          -->
          <div
            v-for="m in modelRows"
            :key="m.id"
            class="pmp-model-row"
            :class="{ 'is-off': !svc.isModelEnabled(m.id) }"
          >
            <!-- 图标托与底栏下拉完全同款：白底 + 1px 内描边，35×35，里面 22×22 的图形 -->
            <span class="pmp-model-brand" :data-tone="m.icon.tone" :title="m.title" aria-hidden="true" v-html="m.icon.svg" />
            <div class="pmp-model-main">
              <div class="pmp-model-title">
                <span class="pmp-model-name">{{ m.title }}</span>
              </div>
              <div v-if="m.desc" class="pmp-model-desc">{{ m.desc }}</div>
            </div>
            <Switch
              :model-value="svc.isModelEnabled(m.id)"
              :aria-label="m.title + '：是否在底栏显示'"
              @update:model-value="() => svc.toggleModel(m.id)"
            />
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

/*
 * 账号行不再自成一格「卡片」：它与「配置项」同属一张分区卡片，
 * 只靠分隔线区分。以前这里是灰底 + 10px 圆角的独立块，嵌在 12px 圆角的分区里，
 * 看起来像卡里又套了一张卡（用户 2026-11-20 截图）。
 */
.pmp-account { margin-top: 0; border: 0; border-radius: 0; background: transparent; }
.pmp-account + .pmp-account { border-top: 1px solid var(--ui-line, #e2e5ea); }
.pmp-account-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.pmp-account-head:hover { background: var(--ui-hover-soft); }
.pmp-account-toggle { display: flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; cursor: pointer; }
.pmp-caret { flex-shrink: 0; width: 15px; height: 15px; color: var(--ui-ink-dim); transition: transform .14s ease; }
.pmp-caret.is-open { transform: rotate(90deg); }
.pmp-account-no { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; background: var(--ui-panel); font-size: 10px; font-weight: 700; color: var(--ui-ink-dim); box-shadow: inset 0 0 0 1px var(--ui-line, #e2e5ea); }
.pmp-account-name { min-width: 120px; max-width: 150px; }
.pmp-account-id { font-size: 10.5px; color: var(--ui-ink-mute); }
/*
 * 展开区与外层账号卡片同一块底：以前这里另起一块浅灰 + 圆角，看起来像「卡里又套了一张卡」，
 * 与账号卡片的圆角打架（用户 2026-11-20 截图）。现在只留一条分隔线，左右内缩与外层一致。
 */
.pmp-account-body { padding: 8px 12px 10px 34px; border-top: 1px solid var(--ui-line, #e2e5ea); }
.pmp-account-note { margin: 0 0 6px; font-size: 10.5px; color: var(--ui-ink-mute); }
.pmp-account-field { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.pmp-account-field-label { width: 84px; flex-shrink: 0; text-align: right; font-size: 11px; color: var(--ui-ink-dim); }
.pmp-shared-value { font-size: 11.5px; color: var(--ui-ink); }
.pmp-shared-note { font-size: 9.5px; color: var(--ui-accent, #0891b2); }

/*
 * 模型列表：与左侧底栏「生成模型」下拉**同一套信息层次**（用户口径 2026-11-20）。
 * 取值照抄 plugin-agent 的 ChoicePicker：35px 图标托（圆角 9、白底、1px 内描边、图形 22px）、
 * 主标题 12.5px/600、副标题 10.5px 灰色、行内 10px 间距。
 * 不再画每行之间的横线 —— 下拉里也没有，靠间距分行。
 */
.pmp-model-list { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; }
.pmp-model-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; }
.pmp-model-row:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.pmp-model-brand {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  flex: none;
  border-radius: 9px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #374151);
  box-shadow: inset 0 0 0 1px var(--ui-line-soft, rgba(0, 0, 0, 0.05));
}
.pmp-model-brand :deep(svg) { width: 22px; height: 22px; display: block; }
/* provider 自带图标走 <img>：给同一档尺寸，否则 1×1 会缩成 0、大图撑破图标托 */
.pmp-model-brand :deep(img) { width: 22px; height: 22px; display: block; object-fit: contain; border-radius: 6px; }
/* 认不出平台时的通用线稿：沿用底栏那套家族色 */
/*
 * 品牌色是平台标识（Seedream / Kling / Runway 各不相同），不是界面语义色：
 * 跟着主题换会失去辨识度，白底上也才认得出来。逐行豁免，别整块放行。
 */
/* 主题色白名单: 品牌标识色（seedream） */
.pmp-model-brand[data-tone='seedream'] { color: #1e37fc; }
/* 主题色白名单: 品牌标识色（seedance） */
.pmp-model-brand[data-tone='seedance'] { color: #7c3aed; }
/* 主题色白名单: 品牌标识色（doubao） */
.pmp-model-brand[data-tone='doubao'] { color: #1e37fc; }
/* 主题色白名单: 品牌标识色（dola） */
.pmp-model-brand[data-tone='dola'] { color: #0ea5e9; }
/* 主题色白名单: 品牌标识色（volcengine） */
.pmp-model-brand[data-tone='volcengine'] { color: #166534; }
/* 主题色白名单: 品牌标识色（kling） */
.pmp-model-brand[data-tone='kling'] { color: #f97316; }
/* 主题色白名单: 品牌标识色（sora） */
.pmp-model-brand[data-tone='sora'] { color: #0f766e; }
/* 主题色白名单: 品牌标识色（veo） */
.pmp-model-brand[data-tone='veo'] { color: #2563eb; }
/* 主题色白名单: 品牌标识色（runway） */
.pmp-model-brand[data-tone='runway'] { color: #111827; }
/* 主题色白名单: 品牌标识色（pika） */
.pmp-model-brand[data-tone='pika'] { color: #e11d48; }
/* 主题色白名单: 品牌标识色（hailuo） */
.pmp-model-brand[data-tone='hailuo'] { color: #0891b2; }
/* 主题色白名单: 品牌标识色（qwen） */
.pmp-model-brand[data-tone='qwen'] { color: #7c3aed; }
/* 主题色白名单: 品牌标识色（midjourney） */
.pmp-model-brand[data-tone='midjourney'] { color: #334155; }
/* 主题色白名单: 节点类型兜底色（image） */
.pmp-model-brand[data-tone='image'] { color: #2563eb; }
/* 主题色白名单: 节点类型兜底色（video） */
.pmp-model-brand[data-tone='video'] { color: #7c3aed; }
/* 主题色白名单: 节点类型兜底色（audio） */
.pmp-model-brand[data-tone='audio'] { color: #059669; }
.pmp-model-brand[data-tone='text'] { color: var(--ui-ink-dim, #6b7280); }
.pmp-model-main { flex: 1; min-width: 0; }
.pmp-model-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pmp-model-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; line-height: 1.4; color: var(--ui-ink); }
/*
 * 设置页的描述（用户口径 2026-11-20）：直接显示完整内容，最多 4 行。
 * 与底栏下拉不同 —— 那边是「平台前缀 + 单行省略 + 气泡」，这边把话说完就够，
 * 超出 4 行才截断，不挂气泡。
 */
.pmp-model-desc {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  white-space: normal;
  word-break: break-word;
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--ui-ink-mute, #9ca3af);
}
/* 关掉的模型整行变暗，但仍然可以点开关打开 */
.pmp-model-row.is-off .pmp-model-name { opacity: .55; }
.pmp-model-row.is-off .pmp-model-desc { opacity: .55; }
.pmp-model-row.is-off .pmp-model-brand { opacity: .55; }

.pmp-edit-actions { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
</style>
