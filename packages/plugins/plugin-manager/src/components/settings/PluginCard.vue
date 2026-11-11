<script setup lang="ts">
/**
 * PluginCard —— 插件管理页的一张卡片。
 *
 * 页面负责拼数据与动作，这里只画。整卡点击只在 card.primaryAction 存在时生效；
 * 卡片底部的真实按钮始终可单独操作（卸载这类动作不会被整卡点击误触）。
 */
import { computed } from 'vue'
import { useUiComponent } from '@plume-canvas/canvas-render'
import { Download, Loader2, Lock, Plus, RotateCcw, Trash2 } from 'lucide-vue-next'
import type {
  PluginCardTone,
  PluginManagerCardView,
  PluginServerTone,
} from './pluginCardTypes'

const props = defineProps<{ card: PluginManagerCardView }>()
const emit = defineEmits<{ (e: 'action', key: string): void }>()

const Badge = useUiComponent('Badge')
const Button = useUiComponent('Button')
const Card = useUiComponent('Card')
const CardAction = useUiComponent('CardAction')
const CardContent = useUiComponent('CardContent')
const CardDescription = useUiComponent('CardDescription')
const CardFooter = useUiComponent('CardFooter')
const CardHeader = useUiComponent('CardHeader')
const CardTitle = useUiComponent('CardTitle')

const clickable = computed(() => Boolean(props.card.primaryAction) && props.card.busy !== true)

/** 图标位：取名字的首字，中文、英文都行 */
const initial = computed(() => {
  const name = props.card.title.trim().replace(/^[@#\s]+/, '')
  return (name[0] || '?').toUpperCase()
})

function badgeVariant(tone: PluginCardTone): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (tone === 'err') return 'destructive'
  if (tone === 'off') return 'outline'
  return 'secondary'
}

function serverVariant(tone: PluginServerTone): 'secondary' | 'destructive' | 'outline' {
  if (tone === 'err') return 'destructive'
  if (tone === 'on') return 'secondary'
  return 'outline'
}

function iconOf(key: string) {
  if (key === 'install') return Plus
  if (key === 'reinstall') return RotateCcw
  if (key === 'uninstall') return Trash2
  return Download
}

function onCardClick(): void {
  if (!clickable.value || !props.card.primaryAction) return
  emit('action', props.card.primaryAction)
}

function onAction(key: string): void {
  if (props.card.busy) return
  emit('action', key)
}
</script>

<template>
  <Card
    size="sm"
    class="pm-card"
    :class="[
      'pm-card--' + card.tone,
      { 'is-clickable': clickable, 'is-busy': card.busy },
    ]"
    :data-plugin-id="card.id"
    :data-plugin-status="card.status"
    :aria-busy="card.busy ? 'true' : undefined"
    :title="clickable ? card.clickHint : undefined"
    :style="{ borderRadius: 'var(--radius-open, 12px)' }"
    @click="onCardClick"
  >
    <CardHeader class="pm-card-head">
      <div class="pm-card-identity">
        <div class="pm-card-icon" aria-hidden="true">{{ initial }}</div>
        <div class="pm-card-heading">
          <CardTitle class="pm-card-title">{{ card.title }}</CardTitle>
          <p v-if="card.meta" class="pm-card-meta">{{ card.meta }}</p>
        </div>
      </div>
      <CardAction class="pm-card-state">
        <Loader2 v-if="card.busy" class="pm-spin" :size="13" aria-hidden="true" />
        <Badge
          :variant="badgeVariant(card.tone)"
          class="pm-badge"
          :class="'pm-badge--' + card.tone"
        >
          {{ card.status }}
        </Badge>
      </CardAction>
    </CardHeader>

    <CardContent class="pm-card-content">
      <CardDescription class="pm-card-desc">{{ card.description }}</CardDescription>

      <div v-if="card.server" class="pm-card-badges">
        <Badge
          :variant="serverVariant(card.server.tone)"
          class="pm-badge pm-badge--server"
          :class="'is-' + card.server.tone"
        >
          {{ card.server.text }}
        </Badge>
      </div>

      <p v-if="card.error" class="pm-card-msg is-error" role="alert">{{ card.error }}</p>
      <p v-else-if="card.warning" class="pm-card-msg is-warn">{{ card.warning }}</p>
      <p v-if="card.note" class="pm-card-msg">{{ card.note }}</p>
    </CardContent>

    <CardFooter class="pm-card-foot">
      <span v-if="card.footerNote" class="pm-card-note">
        <Lock v-if="card.builtin" :size="12" aria-hidden="true" />
        {{ card.footerNote }}
      </span>
      <div v-if="card.actions.length" class="pm-card-actions">
        <Button
          v-for="action in card.actions"
          :key="action.key"
          :variant="action.variant || 'outline'"
          size="sm"
          type="button"
          class="pm-card-action"
          :disabled="action.disabled || card.busy"
          :title="action.title"
          :aria-label="action.ariaLabel || action.label + '：' + card.title"
          :data-action="action.key"
          @click.stop="onAction(action.key)"
        >
          <component :is="iconOf(action.key)" :size="13" aria-hidden="true" />
          {{ action.label }}
        </Button>
      </div>
    </CardFooter>
  </Card>
</template>

<style scoped>
.pm-card {
  position: relative;
  height: 100%;
  min-width: 0;
  padding-top: 14px;
  padding-bottom: 10px;
  gap: 8px;
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}

.pm-card.is-clickable { cursor: pointer; }
.pm-card.is-clickable:hover {
  transform: translateY(-1px);
  box-shadow: var(--ui-shadow-md, 0 10px 24px rgb(0 0 0 / 0.09));
}
.pm-card.is-busy { cursor: progress; }

/* 已安装：顶部一条青线 + 青调描边 */
.pm-card--on::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: var(--ui-accent, #0891b2);
  opacity: 0.75;
}
.pm-card--on {
  box-shadow: inset 0 0 0 1px var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}

/* 未安装：虚线框，一眼看出还没装 */
.pm-card--off { outline: 1px dashed var(--ui-line, #e2e5ea); outline-offset: -1px; }

/* 内置：灰底、不跟着悬停 */
.pm-card--builtin { background: var(--ui-panel-soft, rgb(0 0 0 / 0.02)); }

/* 异常：红色；待依赖 / 含后台提醒：琥珀色 */
.pm-card--err { outline: 1px solid var(--ui-danger, #ef4444); outline-offset: -1px; }
.pm-card--warn { outline: 1px solid var(--ui-warn, #b45309); outline-offset: -1px; }

.pm-card-head {
  gap: 9px;
  padding: 0 14px;
}

.pm-card-identity {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 9px;
}

.pm-card-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-control, 8px);
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font-size: 13px;
  font-weight: 700;
}

.pm-card--off .pm-card-icon,
.pm-card--builtin .pm-card-icon {
  background: var(--ui-veil, rgb(0 0 0 / 0.05));
  color: var(--ui-ink-dim, #6b7280);
}

.pm-card--err .pm-card-icon {
  background: var(--ui-danger-soft, rgb(239 68 68 / 0.1));
  color: var(--ui-danger, #ef4444);
}

.pm-card-heading { flex: 1; min-width: 0; }

.pm-card-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ui-ink, #18202b);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-card-meta {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ui-ink-mute, #8c95a3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-card-state {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding-top: 1px;
}

.pm-badge {
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-badge, 6px);
  font-size: 10px;
  font-weight: 700;
}

.pm-badge--on {
  border-color: transparent !important;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)) !important;
  color: var(--ui-accent-hover, #0e7490) !important;
}

.pm-badge--off {
  border-color: var(--ui-line, #e2e5ea) !important;
  color: var(--ui-ink-dim, #6b7280) !important;
  background: transparent !important;
}

.pm-badge--warn {
  border-color: transparent !important;
  background: var(--ui-warn-soft, rgb(245 158 11 / 0.16)) !important;
  color: var(--ui-warn, #b45309) !important;
}

.pm-badge--builtin {
  border-color: transparent !important;
  background: var(--ui-veil, rgb(0 0 0 / 0.06)) !important;
  color: var(--ui-ink-dim, #6b7280) !important;
}

.pm-card-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 7px;
  padding: 0 14px;
}

.pm-card-desc {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ui-ink-dim, #6b7280);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.pm-card-badges { display: flex; flex-wrap: wrap; gap: 4px; }

.pm-badge--server.is-on {
  color: var(--ui-accent-hover, #0e7490) !important;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.1)) !important;
}

.pm-badge--server.is-warn {
  color: var(--ui-warn, #b45309) !important;
  background: var(--ui-warn-soft, rgb(245 158 11 / 0.14)) !important;
}

.pm-card-msg {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--ui-ink-dim, #6b7280);
}

.pm-card-msg.is-error { color: var(--ui-danger, #ef4444); }
.pm-card-msg.is-warn { color: var(--ui-warn, #b45309); }

.pm-card-foot {
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding: 0 14px;
}

.pm-card-note {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ui-ink-mute, #8c95a3);
}

.pm-card-actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.pm-card-action { font-size: 11px; }
.pm-card-action:deep(svg) { width: 12px; height: 12px; }

.pm-spin { animation: pm-spin 0.9s linear infinite; }
@keyframes pm-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .pm-card,
  .pm-spin {
    animation: none;
    transition: none;
  }
}
</style>
