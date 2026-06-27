<template>
  <div 
    v-show="visible" 
    ref="menuRef"
    class="mention-menu" 
    :style="dynamicStyle"
  >
    <div ref="contentRef" class="menu-content">
      <!-- 变量分类 -->
      <div v-if="variables.length > 0" class="menu-category">
        <div class="category-title">变量</div>
        <div
          v-for="(item, index) in variables"
          :key="item.id"
          :ref="(el) => setMenuItemRef(el as HTMLElement, 'variable', index)"
          class="menu-item variable-item"
          :class="{ active: index === activeIndex && menuType === 'variable' }"
          @mousedown.prevent="selectItem(item, 'variable')"
        >
          <span class="variable-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 3C6.34 3 5 4.34 5 6v2c0 1.1-.9 2-2 2v2c1.1 0 2 .9 2 2v2c0 1.66 1.34 3 3 3h1v-2H8c-.55 0-1-.45-1-1v-2c0-1.3-.84-2.4-2-2.82.16-.42 1-1.52 2-2.82V6c0-.55.45-1 1-1h1V3H8zm8 0h-1v2h1c.55 0 1 .45 1 1v2c1.16 1.3 1.84 2.4 2 2.82-1.16.42-2 1.52-2 2.82v2c0 .55-.45 1-1 1h-1v2h1c1.66 0 3-1.34 3-3v-2c0-1.1.9-2 2-2v-2c-1.1 0-2-.9-2-2V6c0-1.66-1.34-3-3-3z"/>
            </svg>
          </span>
          <span class="text-sm">{{ item.name }}</span>
        </div>
      </div>

      <!-- 资源分类 -->
      <div v-if="resources.length > 0" class="menu-category">
        <div class="category-title">资源</div>
        <div
          v-for="(item, index) in resources"
          :key="item.id"
          :ref="(el) => setMenuItemRef(el as HTMLElement, 'resource', index)"
          class="menu-item"
          :class="{ active: index === activeIndex && menuType === 'resource' }"
          @mousedown.prevent="selectItem(item, 'resource')"
        >
          <img
            :ref="(el) => setItemRef(el as HTMLImageElement, item)"
            class="w-6 h-6 rounded object-cover"
            draggable="false"
          />
          <span class="text-sm">{{ item.name }}</span>
        </div>
      </div>

      <!-- 无匹配结果 -->
      <div v-if="variables.length === 0 && resources.length === 0" class="empty-message">
        无匹配结果
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUpdated, watch, nextTick, computed, onMounted } from "vue";
import type { ResourceItem, VariableItem, MenuPosition } from "./types";
import { loadImageWithThumbnail } from "./utils";

const props = defineProps<{
  visible: boolean;
  resources: ResourceItem[];
  variables: VariableItem[];
  menuType: "resource" | "variable";
  position: MenuPosition;
  activeIndex: number;
}>();

const emit = defineEmits<{
  select: [item: ResourceItem | VariableItem, type: "resource" | "variable"];
  hover: [index: number, type: "resource" | "variable"];
}>();

const menuRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);

// 计算动态样式
const dynamicStyle = computed(() => ({
  left: props.position.left,
  top: props.position.top,
  transformOrigin: props.position.origin || 'top left',
}))

// 存储菜单项元素的引用
const menuItemRefs = new Map<string, HTMLElement>();

function setMenuItemRef(el: HTMLElement | null, type: "resource" | "variable", index: number) {
  if (el) {
    menuItemRefs.set(`${type}-${index}`, el);
  }
}

// 滚动到选中的元素，使其居中显示
function scrollToActiveItem() {
  if (!contentRef.value) return;
  
  const key = `${props.menuType}-${props.activeIndex}`;
  const activeElement = menuItemRefs.get(key);
  
  if (activeElement) {
    const container = contentRef.value;
    const containerHeight = container.clientHeight;
    const elementTop = activeElement.offsetTop;
    const elementHeight = activeElement.offsetHeight;
    
    // 计算使元素居中的滚动位置
    const scrollPosition = elementTop - (containerHeight / 2) + (elementHeight / 2);
    
    container.scrollTo({
      top: scrollPosition,
      behavior: 'smooth'
    });
  }
}

// 选择项目
function selectItem(item: ResourceItem | VariableItem, type: "resource" | "variable") {
  emit('select', item, type);
}

// 存储每个图片元素的取消加载函数
const cleanupMap = new Map<HTMLImageElement, () => void>();
const itemImgRefs = new Map<string, HTMLImageElement>();

function setItemRef(el: HTMLImageElement | null, item: ResourceItem) {
  if (el) {
    itemImgRefs.set(item.id, el);
    // 清理之前的加载
    const oldCleanup = cleanupMap.get(el);
    if (oldCleanup) oldCleanup();
    
    // 开始新的加载
    const cleanup = loadImageWithThumbnail(el, item, true);
    cleanupMap.set(el, cleanup);
  }
}

// 资源列表更新时重新加载图片
onUpdated(() => {
  props.resources.forEach((item) => {
    const img = itemImgRefs.get(item.id);
    if (img) {
      // 清理之前的加载
      const oldCleanup = cleanupMap.get(img);
      if (oldCleanup) oldCleanup();
      
      // 重新加载
      const cleanup = loadImageWithThumbnail(img, item, true);
      cleanupMap.set(img, cleanup);
    }
  });
});

// 入场动画
onMounted(() => {
  if (menuRef.value && props.visible) {
    // 初始状态
    menuRef.value.style.opacity = '0';
    menuRef.value.style.transform = 'scale(0.95)';
    
    // 触发动画
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
      // 重置并触发入场动画
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

// 监听激活索引和类型变化，滚动到选中项
watch([() => props.activeIndex, () => props.menuType], () => {
  nextTick(() => {
    scrollToActiveItem();
  });
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

.empty-message {
  padding: 12px;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}
</style>
