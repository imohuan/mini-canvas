<script setup lang="ts">
// 左侧抽屉：头部（复用 ProjectCluster）+ 画布/资产 tab + 列表/宫格双模式树 + 底部收起条 + 拖宽手柄。
// 图标用 LibIcon（照 LibTV 官网 SVG 原样复刻），交互行为照目标实测。
import { ref, computed, isRef, nextTick } from 'vue'
import { Folder as FolderIcon, Video as VideoIcon, Type as TypeIcon, Image as ImageIcon } from 'lucide-vue-next'
import folderImg from '../../assets/folder.png'
import { AnimatePresence, motion } from 'motion-v'
import AxDropdown from '../AxDropdown.vue'
import AxMenu from '../AxMenu.vue'
import AxMenuItem from '../AxMenuItem.vue'
import AxScrollArea from '../AxScrollArea.vue'
import LibIcon from '../LibIcon.vue'
import ProjectCluster from '../ProjectCluster.vue'
import { useUi, type TreeNode } from '../../composables/ui'

const ui = useUi()
const s = ui.state
/** 展示模式：list（树行）/ grid（宫格卡片），照目标「展示设置」下拉 */
const viewMode = ref<'list' | 'grid'>('grid')
const menuOpen = ref(false)
/** 搜索框 DOM 引用：进入搜索态后自动聚焦 */
const searchInput = ref<HTMLInputElement | null>(null)
async function openSearch(): Promise<void> {
  s.searchOpen = true
  await nextTick()
  searchInput.value?.focus()
}
function closeSearch(): void {
  s.searchOpen = false
  s.searchQuery = ''
}

const lucideOf = (icon: string) =>
  icon === 'video' ? VideoIcon : icon === 'text' ? TypeIcon : icon === 'group' ? FolderIcon : ImageIcon

function expandAll(): void {
  const walk = (list: TreeNode[]): void => { for (const n of list) { if (n.children) { ui.collapsed[n.id] = false; walk(n.children) } } }
  walk(ui.tree)
  ui.showToast('已展开全部分组')
}
function collapseAll(): void {
  const walk = (list: TreeNode[]): void => { for (const n of list) { if (n.children) { ui.collapsed[n.id] = true; walk(n.children) } } }
  walk(ui.tree)
  ui.showToast('已收起全部分组')
}
/** 搜索过滤后的树：computed 必须放在顶层，模板才会自动解包 .value（ui.filteredTree 嵌在普通对象里不会解包） */
const visibleTree = computed<TreeNode[]>(() => {
  const t = ui.filteredTree
  return isRef(t) ? t.value : t
})
</script>

<template>
  <AnimatePresence>
    <motion.aside
      v-if="s.drawer === 'left'"
      class="left-drawer fixed bottom-0 left-0 top-0 z-[70] flex flex-col bg-panel-soft backdrop-blur-xl"
      :style="{ width: s.drawerWidth + 'px' }"
      aria-label="资产管理"
      :initial="{ x: -s.drawerWidth, opacity: 0 }"
      :animate="{ x: 0, opacity: 1 }"
      :exit="{ x: -s.drawerWidth, opacity: 0 }"
      :transition="{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }"
      @pointerdown.stop
    >
      <!-- 头部：与左上角同一个 ProjectCluster（同一时刻只显示一个） -->
      <div class="flex h-12 flex-none items-center gap-0.5 p-2">
        <ProjectCluster
          :canvas="s.currentCanvas"
          :canvas-list="s.canvasList"
          :menu-open="s.canvasMenuOpen"
          @update:menu-open="s.canvasMenuOpen = $event"
          @new-canvas="s.canvasList.push('画布 ' + (s.canvasList.length + 1)); ui.showToast('已新建画布')"
          @pick-canvas="s.currentCanvas = $event"
          @more-canvas="ui.showToast($event + ' 更多操作')"
          @open-menu="ui.showToast('项目菜单')"
          @rename="ui.showToast('已重命名项目')"
        />
      </div>
      <!-- 标签栏 -->
      <div class="flex h-[50px] flex-none items-center gap-1 border-y border-line px-2" role="tablist">
        <button
          v-for="t in (['canvas', 'assets'] as const)" :key="t"
          class="h-7 rounded-[10px] px-3 text-[13px] transition-colors"
          :class="s.leftTab === t ? 'bg-hover-strong text-ink' : 'text-ink/90 hover:bg-hover'"
          role="tab" :aria-selected="s.leftTab === t"
          @click="s.leftTab = t"
        >{{ t === 'canvas' ? '画布' : '资产' }}</button>
      </div>

      <!-- ===== 画布 tab 工具行：普通态 ⇄ 搜索态（点放大镜展开输入框，筛选/关闭在右侧） ===== -->
      <div v-if="s.leftTab === 'canvas'" class="flex h-12 flex-none items-center gap-1 p-2">
        <!-- 搜索态：输入框从放大镜位置向右展开，原工具按钮让位 -->
        <AnimatePresence>
          <motion.div
            v-if="s.searchOpen"
            class="flex h-9 w-full items-center gap-1"
            :initial="{ width: 36, opacity: 0 }"
            :animate="{ width: '100%', opacity: 1 }"
            :exit="{ width: 36, opacity: 0 }"
            :transition="{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }"
          >
            <div class="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] bg-chip px-2.5">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" class="flex-none text-ink-dim" aria-hidden="true"><path d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5" fill="currentColor" fill-rule="evenodd" /></svg>
              <input
                ref="searchInput"
                :value="s.searchQuery"
                class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-dim focus:outline-none"
                placeholder="搜索节点"
                aria-label="搜索节点"
                @input="s.searchQuery = ($event.target as HTMLInputElement).value"
                @keydown.esc="closeSearch()"
              />
            </div>
            <AxDropdown v-model="s.filterTypeOpen" placement="bottom-start">
              <template #trigger><button class="grid size-8 flex-none place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="筛选：全部"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button></template>
              <template #default="{ close }"><AxMenu><AxMenuItem v-for="t in ['全部','图片','视频','文本','分组']" :key="t" @click="s.filterType = t; close()">{{ t }}</AxMenuItem></AxMenu></template>
            </AxDropdown>
            <button class="grid size-8 flex-none place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="关闭搜索" @click="closeSearch()">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
            </button>
          </motion.div>
        </AnimatePresence>

        <!-- 普通态 -->
        <template v-if="!s.searchOpen">
          <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="搜索节点" @click="openSearch">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path :d="'M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5'" fill="currentColor" fill-rule="evenodd" /></svg>
          </button>
          <AxDropdown v-model="s.filterTypeOpen" placement="bottom-start">
            <template #trigger><button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="筛选：全部"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button></template>
            <template #default="{ close }"><AxMenu><AxMenuItem v-for="t in ['全部','图片','视频','文本','分组']" :key="t" @click="s.filterType = t; close()">{{ t }}</AxMenuItem></AxMenu></template>
          </AxDropdown>
          <AxDropdown v-model="s.filterRatingOpen" placement="bottom-start">
            <template #trigger><button class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="所有评级"><span>{{ s.filterRating }}</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.2.12a.4.4 0 0 1 .56 0l.43.42a.4.4 0 0 1 0 .57L4.15 4.15a.7.7 0 0 1-1 0L.13 1.1a.4.4 0 0 1 0-.57L.54.12a.4.4 0 0 1 .57 0l2.54 2.54z" fill="currentColor" transform="translate(2.5 5.8)" /></svg></button></template>
            <template #default="{ close }"><AxMenu><AxMenuItem v-for="r in ['所有评级','已通过','待审核','已拒绝']" :key="r" @click="s.filterRating = r; close()">{{ r }}</AxMenuItem></AxMenu></template>
          </AxDropdown>
          <span class="flex-1"></span>
          <!-- 展示设置：列表/宫格/展开/收起（照图 2，带勾选态） -->
          <AxDropdown v-model="menuOpen" placement="bottom-end" :offset="4" menu-width="180px">
            <template #trigger>
              <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="展示设置" :aria-expanded="menuOpen"><LibIcon name="display-grid" :size="16" /></button>
            </template>
            <template #default="{ close }">
              <AxMenu>
                <AxMenuItem :active="viewMode === 'list'" @click="viewMode = 'list'; close()"><LibIcon name="list-view" :size="16" /> 列表展示 <svg v-if="viewMode === 'list'" class="ml-auto" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.8 4.2a.7.7 0 0 1 0 1L6.6 12.4a.7.7 0 0 1-1 0L2.2 9a.7.7 0 0 1 1-1l2.9 2.9 6.7-6.7a.7.7 0 0 1 1 0z" fill="currentColor" /></svg></AxMenuItem>
                <AxMenuItem :active="viewMode === 'grid'" @click="viewMode = 'grid'; close()"><LibIcon name="display-grid" :size="16" /> 宫格展示 <svg v-if="viewMode === 'grid'" class="ml-auto" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.8 4.2a.7.7 0 0 1 0 1L6.6 12.4a.7.7 0 0 1-1 0L2.2 9a.7.7 0 0 1 1-1l2.9 2.9 6.7-6.7a.7.7 0 0 1 1 0z" fill="currentColor" /></svg></AxMenuItem>
                <div class="my-1 h-px bg-line"></div>
                <AxMenuItem @click="expandAll(); close()"><LibIcon name="expand-groups" :size="16" /> 展开全部分组</AxMenuItem>
                <AxMenuItem @click="collapseAll(); close()"><LibIcon name="collapse-groups" :size="16" /> 收起全部分组</AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
        </template>
      </div>

      <!-- ===== 资产 tab 工具行 ===== -->
      <div v-else class="flex h-12 flex-none items-center gap-1 p-2">
        <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="搜索" @click="ui.showToast('搜索资产')"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5" fill="currentColor" fill-rule="evenodd" /></svg></button>
        <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="批量操作" @click="ui.showToast('批量操作')"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" /><rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" /><path d="M5.5 11.5v3a2 2 0 0 0 2 2h1M14.5 8.5v-3a2 2 0 0 0-2-2h-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg></button>
        <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="筛选" @click="ui.showToast('筛选资产')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button>
        <span class="flex-1"></span>
        <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" aria-label="创建" @click="ui.showToast('创建资产')"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.7a.7.7 0 0 1 .7.7v3.9h3.9a.7.7 0 0 1 0 1.4H8.7v3.9a.7.7 0 0 1-1.4 0V8.7H3.4a.7.7 0 0 1 0-1.4h3.9V3.4a.7.7 0 0 1 .7-.7z" fill="currentColor" /></svg></button>
        <button class="h-8 rounded-lg bg-chip px-2.5 text-[13px] text-ink transition-colors hover:bg-hover-strong" aria-label="资产管理" @click="ui.showToast('资产管理')">资产管理</button>
      </div>

      <!-- ===== 资产 tab 空态（目标页同为空）===== -->
      <div v-if="s.leftTab === 'assets'" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 p-4">
        <div class="grid size-16 place-items-center rounded-2xl bg-veil text-ink-mute"><FolderIcon :size="30" /></div>
        <p class="max-w-[220px] mb-1 text-center text-xs leading-relaxed text-ink-mute">还没有资产，先创建一个默认分类，或直接上传素材。</p>
        <button class="flex h-8 min-w-[176px] items-center justify-center gap-1.5 rounded-lg border border-line bg-veil text-xs text-ink transition-colors hover:bg-hover" aria-label="创建默认资产分类" @click="ui.showToast('已创建默认资产分类')"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h2.9c.4 0 .8.2 1.1.5l.9 1h5.1A1.5 1.5 0 0 1 14.5 5.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5zM8 6v4M6 8h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg> 创建默认资产分类</button>
        <button class="flex h-8 min-w-[176px] items-center justify-center gap-1.5 rounded-lg border border-line bg-veil text-xs text-ink transition-colors hover:bg-hover" aria-label="上传资产" @click="ui.showToast('上传资产')"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10.5V3M5 5.5 8 2.5l3 3M3 10.5v1A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg> 上传资产</button>
      </div>

      <!-- ===== 画布 tab 主体：列表 / 宫格 双模式（照图 1）===== -->
      <AxScrollArea v-else class="min-h-0 flex-1" direction="y" body-class="px-2 pb-2">
        <template v-for="node in visibleTree" :key="node.id">
          <!-- 分组行（两种模式同款：44 高，箭头 + 文件夹图 + 名字；点整行展开/折叠） -->
          <div v-if="node.children" class="group/grow relative flex h-11 w-full items-center gap-0.5 rounded-[10px] py-1 pr-1 transition-colors hover:bg-hover" style="padding-left: 0">
            <button class="grid size-6 flex-none place-items-center rounded-lg text-ink/85" :aria-label="(ui.collapsed[node.id] ? '展开 ' : '折叠 ') + node.name" :aria-expanded="!ui.collapsed[node.id]" @click="ui.collapsed[node.id] = !ui.collapsed[node.id]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" :class="ui.collapsed[node.id] ? '-rotate-90' : ''" class="transition-transform" aria-hidden="true"><path d="M6.2.12a.4.4 0 0 1 .56 0l.43.42a.4.4 0 0 1 0 .57L4.15 4.15a.7.7 0 0 1-1 0L.13 1.1a.4.4 0 0 1 0-.57L.54.12a.4.4 0 0 1 .57 0l2.54 2.54z" fill="currentColor" transform="translate(3.4 5.8)" /></svg>
            </button>
            <button class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left" :aria-label="(ui.collapsed[node.id] ? '展开 ' : '折叠 ') + node.name" :aria-expanded="!ui.collapsed[node.id]" @click="ui.collapsed[node.id] = !ui.collapsed[node.id]">
              <img :src="folderImg" alt="" class="h-[30px] w-[33px] flex-none object-contain" draggable="false" />
              <span class="min-w-0 flex-1 truncate pr-0.5 text-sm leading-[22px]">{{ node.name }}</span>
            </button>
            <span class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/grow:opacity-100 group-hover/grow:opacity-100">
              <AxDropdown placement="bottom-end" :offset="4">
                <template #trigger><button class="grid size-6 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" aria-label="更多操作"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="13" cy="8" r="1.4" fill="currentColor" /></svg></button></template>
                <template #default="{ close }">
                  <AxMenu>
                    <AxMenuItem @click="ui.renameNode(node.id, node.name); close()"><PencilIcon /> 重命名</AxMenuItem>
                    <AxMenuItem danger @click="close(); ui.showToast('已删除 ' + node.name)"><TrashIcon /> 删除</AxMenuItem>
                  </AxMenu>
                </template>
              </AxDropdown>
              <button class="grid size-6 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" :aria-label="'定位到分组 ' + node.name" @click="ui.showToast('定位到分组 ' + node.name)"><LibIcon name="locate" :size="14" /></button>
            </span>
          </div>

          <!-- 分组内容 -->
          <template v-if="node.children && !ui.collapsed[node.id]">
            <!-- 列表模式：缩进行 -->
            <template v-if="viewMode === 'list'">
              <div v-for="child in node.children" :key="child.id" class="group/row relative flex h-11 w-full items-center gap-0.5 rounded-[10px] py-1 pr-1 transition-colors hover:bg-hover" style="padding-left: 24px">
                <span class="size-6 flex-none" aria-hidden="true"></span>
                <button class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left" :aria-label="'定位到节点 ' + child.name" @click="ui.showToast('定位到 ' + child.name)">
                  <span class="grid size-9 flex-none place-items-center rounded-lg bg-thumb text-ink-mute"><component :is="lucideOf(child.icon)" :size="16" /></span>
                  <span class="min-w-0 flex-1 truncate text-sm leading-[22px]">{{ child.name }}</span>
                </button>
                <span class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                  <AxDropdown placement="bottom-end" :offset="4">
                    <template #trigger><button class="grid size-6 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" :aria-label="'更多操作 ' + child.name"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="13" cy="8" r="1.4" fill="currentColor" /></svg></button></template>
                    <template #default="{ close }">
                      <AxMenu>
                        <AxMenuItem @click="ui.renameNode(child.id, child.name); close()"><PencilIcon /> 重命名</AxMenuItem>
                        <AxMenuItem @click="close(); ui.showToast('已复制 ' + child.name)"><CopyIcon /> 复制</AxMenuItem>
                        <AxMenuItem @click="close(); ui.showToast('已添加到 Agent')"><WandIcon /> 添加到 Agent</AxMenuItem>
                        <AxMenuItem danger @click="close(); ui.showToast('已删除 ' + child.name)"><TrashIcon /> 删除</AxMenuItem>
                      </AxMenu>
                    </template>
                  </AxDropdown>
                  <button class="grid size-6 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" :aria-label="'定位到节点 ' + child.name" @click="ui.showToast('定位到 ' + child.name)"><LibIcon name="locate" :size="14" /></button>
                </span>
              </div>
            </template>

            <!-- 宫格模式：3 列卡片（照图 1：卡片 120 宽 圆角16 缩略图方形圆角12 名字 13px 在下方） -->
            <div v-else class="grid grid-cols-3 gap-0.5 pt-0.5" style="padding-left: 24px">
              <div v-for="child in node.children" :key="child.id" class="group/cell relative flex min-w-0 flex-col gap-2 rounded-[16px] p-1 pb-3 transition-colors hover:bg-hover-soft">
                <button class="absolute inset-0 z-10 rounded-[16px]" :aria-label="'定位到节点 ' + child.name" @click="ui.showToast('定位到 ' + child.name)"></button>
                <div class="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-thumb-soft transition-opacity">
                  <span class="absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl text-ink-mute">
                    <span class="flex w-[26%] shrink-0 items-center justify-center"><component :is="lucideOf(child.icon)" :size="29" :stroke-width="1" /></span>
                  </span>
                </div>
                <span class="truncate px-0.5 text-[13px] leading-none text-ink">{{ child.name }}</span>
                <span class="absolute right-1 top-1 z-20 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100">
                  <AxDropdown placement="bottom-end" :offset="4">
                    <template #trigger><button class="grid size-6 place-items-center rounded-lg bg-panel/90 text-ink-dim transition-colors hover:bg-hover hover:text-ink" :aria-label="'更多操作 ' + child.name"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="13" cy="8" r="1.4" fill="currentColor" /></svg></button></template>
                    <template #default="{ close }">
                      <AxMenu>
                        <AxMenuItem @click="ui.renameNode(child.id, child.name); close()"><PencilIcon /> 重命名</AxMenuItem>
                        <AxMenuItem @click="close(); ui.showToast('已复制 ' + child.name)"><CopyIcon /> 复制</AxMenuItem>
                        <AxMenuItem @click="close(); ui.showToast('已添加到 Agent')"><WandIcon /> 添加到 Agent</AxMenuItem>
                        <AxMenuItem danger @click="close(); ui.showToast('已删除 ' + child.name)"><TrashIcon /> 删除</AxMenuItem>
                      </AxMenu>
                    </template>
                  </AxDropdown>
                  <button class="grid size-6 place-items-center rounded-lg bg-panel/90 text-ink-dim transition-colors hover:bg-hover hover:text-ink" :aria-label="'定位到节点 ' + child.name" @click="ui.showToast('定位到 ' + child.name)"><LibIcon name="locate" :size="14" /></button>
                </span>
              </div>
            </div>
          </template>

          <!-- 顶级叶子节点 -->
          <template v-if="!node.children">
            <div v-if="viewMode === 'list'" class="group/row relative flex h-11 w-full items-center gap-0.5 rounded-[10px] py-1 pr-1 transition-colors hover:bg-hover" style="padding-left: 0">
              <span class="size-6 flex-none" aria-hidden="true"></span>
              <button class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left" :aria-label="'定位到节点 ' + node.name" @click="ui.showToast('定位到 ' + node.name)">
                <span class="grid size-9 flex-none place-items-center rounded-lg bg-thumb text-ink-mute"><component :is="lucideOf(node.icon)" :size="16" /></span>
                <span class="min-w-0 flex-1 truncate text-sm leading-[22px]">{{ node.name }}</span>
              </button>
              <span class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                <button class="grid size-6 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" :aria-label="'定位到节点 ' + node.name" @click="ui.showToast('定位到 ' + node.name)"><LibIcon name="locate" :size="14" /></button>
              </span>
            </div>
            <div v-else class="inline-block w-1/3">
              <div class="group/cell relative m-0.5 flex min-w-0 flex-col gap-2 rounded-[16px] p-1 pb-3 transition-colors hover:bg-hover-soft">
                <button class="absolute inset-0 z-10 rounded-[16px]" :aria-label="'定位到节点 ' + node.name" @click="ui.showToast('定位到 ' + node.name)"></button>
                <div class="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-thumb-soft">
                  <span class="absolute inset-0 flex items-center justify-center rounded-xl text-ink-mute"><span class="flex w-[26%] items-center justify-center"><component :is="lucideOf(node.icon)" :size="29" :stroke-width="1" /></span></span>
                </div>
                <span class="truncate px-0.5 text-[13px] leading-none text-ink">{{ node.name }}</span>
              </div>
            </div>
          </template>
        </template>
      </AxScrollArea>

      <!-- 底部状态条 -->
      <div class="flex h-[53px] flex-none items-center justify-between border-t border-line px-3 pb-3 pt-2">
        <button class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover" :aria-label="s.leftCollapsed ? '展开节点侧栏' : '收起节点侧栏'" @click="ui.toggleLeftCollapsed()"><ArrowLeftToLineIcon /></button>
        <span class="text-xs text-ink-dim">共 {{ ui.treeTotal }} 节点</span>
      </div>
      <div class="absolute -right-1 bottom-0 top-0 z-[2] w-3 cursor-col-resize touch-none hover:bg-gradient-to-r hover:from-transparent hover:to-white/[0.14]" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" @pointerdown.prevent="ui.startDrawerResize($event)"></div>
    </motion.aside>
  </AnimatePresence>
</template>

<script lang="ts">
// 小图标（菜单行内）：直接内联函数式组件，避免多余文件
import { h, defineComponent } from 'vue'
const mk = (d: string) => defineComponent({ render: () => h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [h('path', { d, stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })]) })
export const PencilIcon = mk('M11.3 2.5a1.6 1.6 0 0 1 2.3 2.3L5 13.4l-3 .8.8-3zM12.5 3.6l-1-1')
export const TrashIcon = mk('M2.5 4h11M6.5 4V2.8c0-.4.4-.8.8-.8h1.4c.4 0 .8.4.8.8V4M4 4l.6 8.6c0 .8.6 1.4 1.4 1.4h4c.8 0 1.4-.6 1.4-1.4L12 4M6.5 7v4M9.5 7v4')
export const CopyIcon = mk('M5.5 5.5V3.4c0-.5.4-.9.9-.9h6.2c.5 0 .9.4.9.9v6.2c0 .5-.4.9-.9.9h-2.1M3.4 5.5h6.2c.5 0 .9.4.9.9v6.2c0 .5-.4.9-.9.9H3.4a.9.9 0 0 1-.9-.9V6.4c0-.5.4-.9.9-.9z')
export const WandIcon = mk('M9.5 2.5v2M9.5 9.5v2M2.5 9.5h2M6.5 6.5 3 3M13.5 13.5 9.8 9.8M13 3l-8.5 8.5a1 1 0 0 0 1.4 1.4L14.4 4.4A1 1 0 0 0 13 3z')
export const ArrowLeftToLineIcon = defineComponent({ render: () => h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [h('path', { d: 'M13.5 2.5v11M11 8H3.5M6.5 5 3.2 8l3.3 3', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })]) })
</script>
