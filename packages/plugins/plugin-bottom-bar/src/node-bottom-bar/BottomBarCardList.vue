<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'
import { VueDraggable } from 'vue-draggable-plus'
import { formatVideoDuration, videoOverLimit, type RefTile } from '../refTiles'

defineProps<{
  refTiles: RefTile[]
  loadingTiles: Record<string, boolean>
  brokenTiles: Record<string, boolean>
  dragging: boolean
  ctrlDragging: boolean
  slotsDropHot: boolean
  cardImageOf: (tile: { url?: string; kind?: string | null }) => string
  cardTooltip: (tile: RefTile) => string
  slotErrorOf: (tile: { key: string }) => string
}>()

const emit = defineEmits<{
  dragEnd: [payload: Event]
  reorder: [next?: Array<{ key?: string }>]
  dragStart: []
  clickCapture: [ev: MouseEvent]
  keydown: [ev: KeyboardEvent]
  previewEnter: [tile: RefTile, rect: DOMRect]
  previewLeave: []
  cardClick: [tile: RefTile]
  cardDblClick: [tile: RefTile]
  slotDragOver: [ev: DragEvent]
  slotDragLeave: [ev: DragEvent]
  slotDrop: [ev: DragEvent]
  clearBroken: [key: string]
  markBroken: [key: string]
  audioPlay: [tile: RefTile]
  atPointerDown: [tile: RefTile]
  atClick: [tile: RefTile]
  removePointerDown: [tile: RefTile]
}>()

const Button = useUiComponent('Button')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')
</script>

<template>
  <VueDraggable
    v-if="refTiles.length > 0"
    class="nb-cards"
    :class="{ 'is-drop-hot': slotsDropHot }"
    :model-value="refTiles"
    :animation="180"
    ghost-class="nb-card--ghost"
    chosen-class="nb-card--chosen"
    drag-class="nb-card--drag"
    :force-fallback="true"
    filter=".nb-remove"
    :prevent-on-filter="false"
    @end="(payload: Event) => emit('dragEnd', payload)"
    @update:model-value="(next: RefTile[]) => emit('reorder', next.map((t) => ({ key: t.key })))"
    @start="emit('dragStart')"
    @click.capture="(ev: MouseEvent) => emit('clickCapture', ev)"
    @keydown="(ev: KeyboardEvent) => emit('keydown', ev)"
  >
    <div
      v-for="tile in refTiles"
      :key="tile.key"
      :data-tile-key="tile.key"
      :data-tile-name="tile.label"
      tabindex="0"
      class="nb-card"
      :class="{ 'is-pending': tile.pending, 'is-invalid': tile.invalid }"
      :style="tile.pending ? 'cursor: pointer' : ''"
      :aria-label="cardTooltip(tile)"
      @pointerenter="(ev: PointerEvent) => emit('previewEnter', tile, (ev.currentTarget as HTMLElement).getBoundingClientRect())"
      @pointerleave="emit('previewLeave')"
      @click.stop="tile.pending ? emit('cardClick', tile) : undefined"
      @dblclick.stop.prevent="emit('cardDblClick', tile)"
      @dragover.stop.prevent="emit('slotDragOver', $event)"
      @dragleave.stop="emit('slotDragLeave', $event)"
      @drop.stop.prevent="emit('slotDrop', $event)"
    >
      <TooltipProvider :delay-duration="220" :disabled="dragging || ctrlDragging">
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="nb-card-clip">
              <img
                v-if="cardImageOf(tile) && !tile.pending"
                class="nb-card-img"
                :src="cardImageOf(tile)"
                :alt="tile.label"
                draggable="false"
                :data-broken="brokenTiles[tile.key] ? '1' : undefined"
                @load="emit('clearBroken', tile.key)"
                @error="emit('markBroken', tile.key)"
              />
              <span
                v-if="!tile.pending && tile.kind === 'video' && !loadingTiles[tile.key]"
                class="nb-card-play"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>
              </span>
              <span
                v-if="!tile.pending && cardImageOf(tile) && loadingTiles[tile.key]"
                class="nb-card-media-state"
                :class="{ 'is-broken': brokenTiles[tile.key] }"
                aria-hidden="true"
              >
                <span class="nb-card-media-spinner" v-if="!brokenTiles[tile.key]" />
                <span v-else class="nb-card-media-lost">!</span>
              </span>
              <span v-else-if="tile.pending" class="nb-card-pending">
                <span class="nb-card-placeholder" data-kind="resource" aria-hidden="true" />
                <span class="nb-card-plus" aria-hidden="true">+</span>
              </span>
              <span
                v-else-if="tile.kind === 'audio' || tile.kind === 'text' || tile.kind === 'video'"
                class="nb-card-fallback"
                :data-kind="tile.kind"
                aria-hidden="true"
              />
              <span
                v-if="!tile.pending && tile.kind === 'video' && formatVideoDuration(tile.duration)"
                class="nb-card-duration"
                :class="{ 'is-over': videoOverLimit(tile.duration) }"
                aria-hidden="true"
              >{{ formatVideoDuration(tile.duration) }}</span>
              <span class="nb-card-index">{{ tile.index }}</span>
            </span>
            <span v-if="!tile.pending && !tile.invalid" class="nb-card-actions" aria-hidden="false">
              <Button variant="ghost" size="icon-sm"
                v-if="tile.kind === 'audio'"
                class="nb-card-act nb-card-play-act"
                type="button"
                :aria-label="'播放音频 ' + tile.label"
                @pointerdown.stop
                @click.stop="emit('audioPlay', tile)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>
              </Button>
              <Button variant="ghost" size="icon-sm"
                class="nb-card-act nb-card-at"
                type="button"
                :aria-label="'插入标签 @' + tile.label"
                @pointerdown.stop="emit('atPointerDown', tile)"
                @click.stop="emit('atClick', tile)"
              >@</Button>
            </span>
            <span v-if="slotErrorOf(tile)" class="nb-slot-error">{{ slotErrorOf(tile) }}</span>
            <Button variant="ghost" size="icon-sm"
              v-if="!tile.pending"
              class="nb-card-hit"
              type="button"
              :aria-label="'聚焦节点 ' + tile.label + '（双击）'"
            />
            <Button variant="ghost" size="icon-sm"
              v-if="!tile.pending"
              class="nb-remove"
              type="button"
              :aria-label="'移除素材 ' + tile.label + '（断开连线）'"
              title="移除素材（断开连线）"
              @pointerdown.stop.prevent="emit('removePointerDown', tile)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{{ cardTooltip(tile) }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </VueDraggable>
</template>
