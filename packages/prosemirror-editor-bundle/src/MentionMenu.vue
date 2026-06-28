<template>
  <div v-show="visible" ref="menuRef" class="mention-menu" :style="dynamicStyle">
    <div ref="contentRef" class="menu-content">
      <template v-for="category in categoryOrder" :key="category">
        <div v-if="groupedItems.has(category) && groupedItems.get(category)!.length > 0" class="menu-category">
          <div class="category-title">{{ category }}</div>
          <div
            v-for="item in groupedItems.get(category)!"
            :key="item.id"
            :ref="(el) => setItemRef(el as HTMLElement, item)"
            class="menu-item"
            :class="{
              active: getGlobalIndex(item) === activeIndex,
              hovered: getGlobalIndex(item) === hoveredIndex
            }"
            @mousedown.prevent="selectItem(item)"
            @mouseenter="hoveredIndex = getGlobalIndex(item)"
            @mouseleave="hoveredIndex = -1"
          >
            <slot
              name="item"
              :item="item"
              :category="category"
              :is-active="getGlobalIndex(item) === activeIndex"
              :is-hovered="getGlobalIndex(item) === hoveredIndex"
            >
              <component v-if="item.renderItem" :is="() => item.renderItem!(item)" />
              <template v-else>
              <span v-if="item.icon" class="item-icon" v-html="item.icon" />
              <span v-else class="item-icon-default">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                </svg>
              </span>
              <span class="text-sm">{{ item.name }}</span>
            </template>
            </slot>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted } from "vue";
import type { ResourceItem, MenuPosition } from "./types";
import { loadImageWithThumbnail } from "./utils";

const props = defineProps<{
  visible: boolean
  items: ResourceItem[]
  groupedItems: Map<string, ResourceItem[]>
  categoryOrder: string[]
  position: MenuPosition
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [item: ResourceItem]
}>()

const menuRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const hoveredIndex = ref(-1);

const dynamicStyle = computed(() => ({
  left: props.position.left,
  top: props.position.top,
  transformOrigin: props.position.origin || 'top left',
}))

const itemRefs = new Map<string, HTMLElement>()

function setItemRef(el: HTMLElement | null, item: ResourceItem) {
  if (el) {
    itemRefs.set(item.id, el)
    const img = el.querySelector('img')
    if (img && item.url) {
      loadImageWithThumbnail(img, item, true)
    }
  }
}

function getGlobalIndex(item: ResourceItem): number {
  let count = 0
  for (const cat of props.categoryOrder) {
    const catItems = props.groupedItems.get(cat)
    if (!catItems) continue
    const idx = catItems.indexOf(item)
    if (idx !== -1) return count + idx
    count += catItems.length
  }
  return -1
}

function selectItem(item: ResourceItem) {
  emit('select', item)
}

function scrollToActiveItem() {
  if (!contentRef.value) return

  let globalIdx = 0
  for (const cat of props.categoryOrder) {
    const catItems = props.groupedItems.get(cat)
    if (!catItems) continue
    for (const item of catItems) {
      if (globalIdx === props.activeIndex) {
        const el = itemRefs.get(item.id)
        if (el && contentRef.value) {
          const container = contentRef.value
          const containerHeight = container.clientHeight
          const elementTop = el.offsetTop
          const elementHeight = el.offsetHeight
          const scrollPosition = elementTop - (containerHeight / 2) + (elementHeight / 2)
          container.scrollTo({ top: scrollPosition, behavior: 'smooth' })
        }
        return
      }
      globalIdx++
    }
  }
}

// 监听激活索引变化，滚动到选中项
watch(() => props.activeIndex, () => {
  nextTick(() => {
    scrollToActiveItem()
  })
})

// 入场动画
onMounted(() => {
  if (menuRef.value && props.visible) {
    menuRef.value.style.opacity = '0';
    menuRef.value.style.transform = 'scale(0.95)';

    requestAnimationFrame(() => {
      if (menuRef.value) {
        menuRef.value.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
        menuRef.value.style.opacity = '1';
        menuRef.value.style.transform = 'scale(1)';
      }
    });
  }
});

// 监听可见性变化
watch(() => props.visible, (visible) => {
  if (visible) {
    nextTick(() => {
      if (menuRef.value) {
        menuRef.value.style.opacity = '0';
        menuRef.value.style.transform = props.position.side === 'bottom' 
          ? 'scale(0.95) translateY(-10px)' 
          : 'scale(0.95) translateY(10px)';
        
        requestAnimationFrame(() => {
          if (menuRef.value) {
            menuRef.value.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            menuRef.value.style.opacity = '1';
            menuRef.value.style.transform = 'scale(1) translateY(0)';
          }
        });
      }
      scrollToActiveItem();
    });
  }
});
</script>

<style scoped>
.menu-content {
  max-height: 280px;
  overflow-y: auto;
}

.menu-category {
  margin-bottom: 8px;
}

.menu-category:last-child {
  margin-bottom: 0;
}

.category-title {
  padding: 6px 10px 4px;
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.menu-item.hovered {
  background: rgba(0, 0, 0, 0.04);
}
</style>
