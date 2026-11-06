<script setup lang="ts">
/**
 * ProjectsPage —— 项目列表页（对标 LibTV `/project`，按用户要求**去掉红框区域**）。
 *
 * 去掉的：右上「积分/开通会员/头像」、左栏「Agent / 3D-BOX / 插件与扩展 / 社区 / 版本更新记录」。
 * 留下的：左栏（logo + 新建项目 + 首页/项目/资产）+ 主区（返回/全部项目/搜索/回收站/新建文件夹
 * + 项目卡片网格 + 「没有更多了」）。
 *
 * 数据全部来自 cloud-server（`/api/projects`），不写死；点项目 → 打开它的画布（没有就先建一张）。
 *
 * 通知宿主由 Root 统一挂载（全应用一只），本页不再重复挂。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Search, Trash2, FolderPlus, House, Folder, Image as ImageIcon, ChevronLeft, Sun, Moon } from 'lucide-vue-next'
import { useUiComponentOutside } from '../composables/ui'
import { useCanvasContextOrRender, type FeedbackService } from '@mini-canvas/canvas-render'
import { listProjects, createProject, deleteProject, listCanvases, createCanvas, listAssets, type ProjectSummary, type AssetSummary } from '../composables/projectsApi'
import { applyAppTheme, clearLegacyThemeModeKey, loadAppSettings, saveThemeMode, watchCloudSettings } from '../composables/appTheme'
import ProjectsTabsNav from './projects/ProjectsTabsNav.vue'
import ProjectsTabsPanel from './projects/ProjectsTabsPanel.vue'
import { activeProjectsTab, useProjectsTabs } from './projects/useProjectsPanels'

const router = useRouter()
// 项目页在画布路由之外：当前仍走宿主单例取件，树内/树外都能拿到同一个组件。
// 根级 Provider 已经把它包进应用上下文；项目页自己的插槽接线放在后续步骤。
const Button = useUiComponentOutside('Button')
/** 顶栏的输入框也从同一份 ui 目录取，避免项目页首帧出现两套按钮/输入样式。 */
const Input = useUiComponentOutside('Input')
/** 统一确认 / 输入框：项目页不再使用浏览器原生 prompt / confirm。 */
const { ctx } = useCanvasContextOrRender()
const feedback = ctx.get<FeedbackService>('feedback')
const projects = ref<ProjectSummary[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
/** 左栏页签：首页 / 项目 / 资产（同一页里切换主区内容） */
const nav = ref<'home' | 'projects' | 'assets'>('projects')
/** 左栏插件页签（app.projects.tabs）：选中时主区整块换成插件页面。 */
const pluginTabs = useProjectsTabs()
const pluginTabId = ref('')
const activePluginTab = activeProjectsTab(pluginTabs, pluginTabId)
const assets = ref<AssetSummary[]>([])
/**
 * 主题：亮 / 暗。
 *
 * 真源是 `config/settings` —— 与画布工作台**同一份**（不是另一个独立的 themeMode 键）。
 * 读值与落值都走 appTheme（复用画布页那套 applyThemeMode / installThemePalette），
 * 所以首页也会用上用户改过的配色，两页不再各显各的。
 */
const theme = ref<'dark' | 'light'>('dark')
/** 配色落值的 dispose（解除订阅 + 清内联覆盖）；切页/卸载时收回 */
let disposeTheme: (() => void) | undefined
/** 云端配置变更订阅（别的标签/画布页改了配置，这里立刻跟上）的 dispose */
let disposeSettingsWatch: (() => void) | undefined

/** 把当前这份设置套到页面上（主题模式 + 配色，一处生效） */
function applyTheme(values: Record<string, unknown>): void {
  disposeTheme?.()
  disposeTheme = applyAppTheme(values)
}
async function loadTheme(): Promise<void> {
  // 与画布工作台读同一份设置（云端优先、退回本地）：主题模式 + 用户改过的配色都在里面
  const { values } = await loadAppSettings()
  if (values.themeMode === 'light' || values.themeMode === 'dark') theme.value = values.themeMode
  applyTheme(values)
}
async function toggleTheme(): Promise<void> {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  // 读-改-写同一份 config/settings（不冲掉画布页的配色），再按新值刷新页面主题
  await saveThemeMode(theme.value)
  applyTheme((await loadAppSettings()).values)
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    projects.value = await listProjects()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  // 一次性清掉老版本留下的独立 themeMode 键（两套配置的残骸；只删那一个，不碰共用的 settings）
  void clearLegacyThemeModeKey()
  void loadTheme()
  void refresh()
  // 跨标签页实时同步：画布页（或另一个首页标签）改了配置 → 立刻重读并重套主题。
  // 没有这一步的话，先打开的标签会一直显示旧颜色，直到手动刷新（用户实测报过）。
  disposeSettingsWatch = watchCloudSettings((values) => {
    if (values.themeMode === 'light' || values.themeMode === 'dark') theme.value = values.themeMode
    applyTheme(values)
  })
})
onBeforeUnmount(() => {
  // 撤掉配色落值（解除订阅 + 清掉 <html> 上的内联覆盖），避免切页后残留
  disposeTheme?.()
  disposeTheme = undefined
  disposeSettingsWatch?.()
  disposeSettingsWatch = undefined
})

/** 切左栏页签：进「资产」时拉一次资产清单 */
function switchNav(tab: 'home' | 'projects' | 'assets'): void {
  // 从插件页切回内置页：清掉插件选中态，主区才会回到项目 / 资产。
  pluginTabId.value = ''
  nav.value = tab
  if (tab === 'assets') void loadAssets()
}

/** 选中插件页签：左栏高亮换人，主区整页切换。 */
function selectPluginTab(id: string): void {
  pluginTabId.value = id
}

/**
 * 返回。
 *
 * 项目页本身就是 #/（应用首页），刚打开时 router.back() 没有可退的历史，
 * 点下去毫无反应（用户 2026-11-06 实测）。这里按「当前在哪」决定退到哪：
 * - 在插件页签里 → 回到项目列表；
 * - 在资产 / 首页 → 回到项目列表；
 * - 已经在项目列表 → 有历史才退历史（比如从画布返回），否则不再动。
 */
function goBack(): void {
  if (activePluginTab.value || nav.value !== 'projects') {
    switchNav('projects')
    return
  }
  if (window.history.length > 1) router.back()
}

/** 标题：插件页用插件自己的标题，内置页用原来的规则。 */
const pageTitle = computed(() =>
  activePluginTab.value
    ? activePluginTab.value.meta.title
    : nav.value === 'assets'
      ? '全部资产'
      : nav.value === 'home'
        ? '首页'
        : '全部项目',
)
async function loadAssets(): Promise<void> {
  try {
    assets.value = await listAssets()
  } catch {
    assets.value = []
  }
}

/** 打开一个项目：有画布 → 打开第一张；没有 → 先建一张「画布 1」再打开 */
async function openProject(p: ProjectSummary): Promise<void> {
  try {
    let list = await listCanvases(p.id)
    if (list.length === 0) list = [await createCanvas(p.id, '画布 1')]
    void router.push('/canvas/' + list[0].id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

/** 新建项目（「开始创作」与左栏「新建项目」同一动作） */
async function newProject(): Promise<void> {
  if (!feedback) return
  const name = await feedback.prompt({
    title: '新建项目',
    label: '项目名字',
    defaultValue: '未命名项目',
    confirmText: '创建',
    validate: (value) => (value.trim() ? '' : '项目名字不能为空'),
  })
  if (name === null) return
  try {
    const p = await createProject(name.trim() || '未命名项目')
    await openProject(p)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function removeProject(p: ProjectSummary): Promise<void> {
  if (p.id === 'default') return
  if (!feedback) return
  const ok = await feedback.confirm({
    title: '删除项目',
    description: '删除「' + p.name + '」及其全部画布？\n\n这个操作不能撤销。',
    confirmText: '删除',
    cancelText: '取消',
    tone: 'destructive',
  })
  if (!ok) return
  try {
    await deleteProject(p.id)
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function dateOf(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
</script>

<style scoped>
/*
 * 项目 / 资产卡片网格：按**可用宽度**自动排，不再写死 grid-cols-5。
 *
 * 旧问题（用户 2026-11-06 截图）：窗口一窄，5 列固定宽度把卡片压成竖条，
 * 名字和日期被挤到换行。这里用 auto-fill + minmax：
 *   - 每个格子最窄 200px（卡片本身仍可再窄一点，因为 min(200px, 100%) 兜底）；
 *   - 容器很窄时自动退到 1～2 列，而不是继续硬塞 5 列；
 *   - 卡片宽度有上限 300px：项目少的时候不会被拉成一整块巨幅卡片
 *     （1920 宽屏下只有 4 个项目时，铺满整行会变成四个大方块，很难看）。
 *     超过上限就留白，和 Lightroom / Figma 的文件页一致。
 *   - 容器只剩不足 200px 时用 100%，绝不横向溢出。
 * 卡片缩略图用 aspect-ratio 定比例，宽度变化时高度跟着走，不会被压扁。
 */
.project-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 300px));
  justify-content: start;
  align-items: start;
}
/* 空态文案不参与网格列宽计算（否则会挤出一列空位） */
.project-grid-empty { grid-column: 1 / -1; }

/* 缩略图统一比例：不同宽度下视觉节奏一致 */
.project-thumb { aspect-ratio: 16 / 10; }

/*
 * 卡片外壳 & 点击层：文字区不许有任何背景。
 *
 * 旧实现用 shadcn Button 的 ghost 变体铺满整卡，ghost 自带
 * hover:bg-muted 和 dark:hover:bg-muted/50；类名覆盖不掉 dark:hover 那条，
 * 所以悬停时名字/日期下面会浮出一块灰底（用户 2026-11-06 截图指出）。
 *
 * 现在卡片用原生 button / div，点击层是纯透明元素：
 * hover 只动缩略图里的图案，文字区始终跟页面底色一致。
 */
.project-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.project-hit {
  border: 0;
  appearance: none;
  -webkit-appearance: none;
}
.project-hit:hover,
.project-hit:active { background: transparent; }

/* 名字 / 日期：永远是页面底色，不加任何 hover 背景、不位移。 */
.project-name,
.project-date {
  display: block;
  padding: 0 2px;
  background: transparent;
}
.project-name { line-height: 1.45; }
.project-date { line-height: 1.4; }

/*
 * hover = 图案放大（用户 2026-11-06 选定的方案）。
 *
 * 只放大缩略图里的图案，卡片本身不位移、不抬高：
 *   - 图案 scale(1.3)，用较长缓动，像镜头轻轻推近；
 *   - 背后铺一层很淡的主题色光，避免"图放大了但背景还是死的"；
 *   - 名字、日期完全不动，保证列表扫读时不会跟着抖。
 */
.project-thumb-zoom { position: relative; }
.project-thumb-zoom::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: radial-gradient(100% 100% at 50% 30%, var(--ui-accent-soft, rgb(8 145 178 / 0.12)), transparent 72%);
  opacity: 0;
  transition: opacity 0.22s ease;
  pointer-events: none;
}
.project-thumb-zoom > svg,
.project-thumb-zoom > img {
  position: relative;
  z-index: 1;
  transition: transform 0.32s cubic-bezier(0.2, 0.7, 0.3, 1), color 0.18s ease;
}
.project-thumb-zoom:hover::after,
.group:hover .project-thumb-zoom::after,
.group\/asset:hover .project-thumb-zoom::after {
  opacity: 1;
}
.project-thumb-zoom:hover > svg,
.group:hover .project-thumb-zoom > svg,
.project-thumb-zoom:hover > img,
.group\/asset:hover .project-thumb-zoom > img {
  transform: scale(1.3);
}
.project-thumb-zoom:hover > svg,
.group:hover .project-thumb-zoom > svg {
  color: var(--ui-accent, #0891b2);
}
@media (prefers-reduced-motion: reduce) {
  .project-thumb-zoom > svg,
  .project-thumb-zoom > img,
  .project-thumb-zoom::after { transition: none !important; }
}

/* 窄屏：侧栏收成图标栏，标题栏换行，搜索框占满一行 */
@media (max-width: 860px) {
  .projects-side { width: 60px; padding-left: 8px; padding-right: 8px; align-items: center; }
  .projects-brand { padding-left: 0; padding-right: 0; }
  .projects-brand-name,
  .projects-label { display: none; }
  .projects-nav { width: 36px; justify-content: center; padding: 0; }
  .projects-new { width: 36px; padding: 0; }
  .projects-head { padding-left: 12px; padding-right: 12px; }
  .projects-head-title { margin-right: auto; }
  .projects-actions { width: 100%; margin-left: 0; }
  .projects-search { width: auto; flex: 1 1 180px; min-width: 0; }
  .projects-scroll { padding-left: 12px; padding-right: 12px; }
}
/* 极窄：卡片最小宽度收到 160px，保证一屏至少能看见一整张卡 */
@media (max-width: 520px) {
  .project-grid { grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr)); gap: 12px; justify-content: stretch; }
  .project-thumb { aspect-ratio: 4 / 3; }
}
</style>

<template>
  <div class="projects-page flex h-screen bg-canvas-bg text-ink">
    <!-- 左栏 -->
    <aside class="projects-side flex w-[200px] flex-none flex-col gap-2 border-r border-line px-3 py-4">
      <div class="projects-brand flex items-center gap-2 px-2 pb-2 text-[15px] font-bold tracking-wide">
        <span class="grid size-6 place-items-center rounded-md bg-brand text-[13px] font-black text-white">M</span>
        <span class="projects-brand-name">MiniCanvas</span>
      </div>
      <Button size="sm" class="projects-new h-9 w-full gap-2 rounded-lg text-[13px] font-semibold" @click="newProject">
        <Plus :size="15" class="flex-none" /> <span class="projects-label">新建项目</span>
      </Button>
      <nav class="mt-1 flex flex-col gap-0.5">
        <Button variant="ghost" size="sm" class="projects-nav h-9 w-full justify-start gap-2 rounded-lg text-[13px] font-normal" :class="nav === 'home' ? 'bg-hover-strong font-semibold text-ink' : 'text-ink/90'" @click="switchNav('home')">
          <House :size="15" class="flex-none" /> <span class="projects-label">首页</span>
        </Button>
        <Button variant="ghost" size="sm" class="projects-nav h-9 w-full justify-start gap-2 rounded-lg text-[13px] font-normal" :class="nav === 'projects' ? 'bg-hover-strong font-semibold text-ink' : 'text-ink/90'" @click="switchNav('projects')">
          <Folder :size="15" class="flex-none" /> <span class="projects-label">项目</span>
        </Button>
        <Button variant="ghost" size="sm" class="projects-nav h-9 w-full justify-start gap-2 rounded-lg text-[13px] font-normal" :class="nav === 'assets' ? 'bg-hover-strong font-semibold text-ink' : 'text-ink/90'" @click="switchNav('assets')">
          <ImageIcon :size="15" class="flex-none" /> <span class="projects-label">资产</span>
        </Button>
      </nav>
      <ProjectsTabsNav :tabs="pluginTabs" :active-id="pluginTabId" @select="selectPluginTab" />
    </aside>

    <!-- 主区 -->
    <main class="flex min-w-0 flex-1 flex-col">
      <header class="projects-head flex min-h-14 flex-none flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2">
        <Button variant="ghost" size="xs" class="justify-start gap-1 rounded-lg px-2 text-[13px] font-normal text-ink-dim" @click="goBack">
          <ChevronLeft :size="15" class="flex-none" /> <span class="projects-label">返回</span>
        </Button>
        <span class="h-4 w-px bg-line"></span>
        <strong class="projects-head-title text-[15px]">{{ pageTitle }}</strong>
        <div v-if="!activePluginTab" class="projects-actions ml-auto flex flex-wrap items-center gap-2">
          <label class="projects-search flex h-9 w-[240px] items-center gap-2 rounded-lg border border-line bg-veil px-3">
            <Search :size="15" class="flex-none text-ink-dim" />
            <Input v-model="query" class="h-full flex-1 border-0 bg-transparent px-0 focus-visible:ring-0" placeholder="搜索项目" aria-label="搜索项目" />
          </label>
          <Button variant="outline" size="sm" class="h-9 gap-1.5 rounded-lg text-[13px] font-normal text-ink">
            <Trash2 :size="14" class="flex-none" /> 回收站
          </Button>
          <Button variant="outline" size="sm" class="h-9 gap-1.5 rounded-lg text-[13px] font-normal text-ink" @click="newProject">
            <FolderPlus :size="14" class="flex-none" /> 新建文件夹
          </Button>
          <Button variant="outline" size="icon" class="rounded-lg text-ink" aria-label="主题切换" @click="toggleTheme">
            <Sun v-if="theme === 'dark'" :size="15" />
            <Moon v-else :size="15" />
          </Button>
        </div>
      </header>

      <p v-if="error" class="mx-6 mb-2 rounded-lg border border-[color:var(--ui-danger,#ef4444)] px-3 py-2 text-[12px] text-[color:var(--ui-danger,#ef4444)]" role="alert">{{ error }}</p>

      <!-- 插件整页：与内置页平级切换，不叠在项目卡片下面 -->
      <ProjectsTabsPanel v-if="activePluginTab" :tab="activePluginTab" />

      <div v-else class="projects-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <!-- 资产页签：生成产物 + 自己上传，统一列表 -->
        <div v-if="nav === 'assets'" class="project-grid">
          <div v-for="a in assets" :key="a.id" class="group/asset flex flex-col gap-2">
            <div class="project-thumb project-thumb-zoom relative overflow-hidden rounded-xl border border-line bg-thumb-soft">
              <img v-if="a.kind === 'image'" :src="a.url" alt="" class="h-full w-full object-cover" />
              <span v-else class="grid h-full place-items-center text-ink-mute"><ImageIcon :size="26" :stroke-width="1" /></span>
            </div>
            <span class="truncate text-[13px] text-ink">{{ a.name }}</span>
            <span class="text-[11px] text-ink-dim">{{ a.source === 'upload' ? '手动上传' : '生成' }} · {{ dateOf(a.createdAt) }}</span>
          </div>
          <p v-if="assets.length === 0" class="project-grid-empty py-16 text-center text-[13px] text-ink/50">还没有资产。生成或上传之后会出现在这里。</p>
        </div>

        <!-- 首页页签：欢迎语 -->
        <div v-else-if="nav === 'home'" class="py-12">
          <p class="text-center text-[13px] text-ink/60">欢迎使用 MiniCanvas。选「项目」开始创作，或「资产」查看生成与上传的素材。</p>
        </div>

        <!-- 项目页签 -->
        <div v-else class="project-grid">
          <!-- 开始创作 -->
          <button type="button" class="project-card group" aria-label="创建新的视频项目" @click="newProject">
            <span class="project-thumb project-thumb-zoom grid place-items-center rounded-xl border border-dashed border-line bg-panel text-ink-dim transition-colors hover:border-brand/40">
              <Plus :size="26" />
            </span>
            <span class="project-name text-[13px] text-ink">创建新的视频项目</span>
          </button>

          <!-- 项目卡片 -->
          <div v-for="p in projects.filter((x) => !query || x.name.includes(query))" :key="p.id" class="project-card group relative">
            <!--
              整卡点击层：必须是**透明**的原生按钮。

              原来用 shadcn Button（ghost）铺满整张卡，ghost 自带
              hover:bg-muted / dark:hover:bg-muted/50；即使再写 hover:bg-transparent，
              Tailwind 里 dark:hover 的那条后编译、会盖掉它 ——
              结果鼠标一上去，名字和日期那片文字区就浮出一块灰底
              （用户 2026-11-06 截图指出：「我不希望文字这部分有什么背景」）。
            -->
            <button
              type="button"
              class="project-hit absolute inset-0 z-10 cursor-pointer rounded-xl bg-transparent p-0"
              :aria-label="'打开项目 ' + p.name"
              @click="openProject(p)"
            ></button>
            <div class="project-thumb project-thumb-zoom grid place-items-center overflow-hidden rounded-xl border border-line bg-gradient-to-br from-panel-active to-panel-soft text-ink-mute transition-[border-color] group-hover:border-line-soft">
              <Folder :size="30" :stroke-width="1" />
            </div>
            <span class="project-name truncate text-[13px] text-ink">{{ p.name }}</span>
            <span class="project-date text-[11px] text-ink-dim">{{ dateOf(p.createdAt) }}</span>
            <Button
              v-if="p.id !== 'default'"
              variant="ghost" size="icon-xs"
              class="absolute right-2 top-2 z-20 rounded-lg bg-panel/90 text-ink-dim opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink"
              :aria-label="'删除项目 ' + p.name" @click.stop="removeProject(p)">
              <Trash2 :size="13" />
            </Button>
          </div>
        </div>

        <p v-if="nav === 'projects' && loading" class="py-16 text-center text-[13px] text-ink/50">正在读取项目…</p>
        <p v-else-if="nav === 'projects' && projects.length === 0" class="py-16 text-center text-[13px] text-ink/50">还没有项目，点「新建项目」开始。</p>
        <p v-else-if="nav === 'projects'" class="py-10 text-center text-[12px] text-ink-dim">没有更多了</p>

      </div>
    </main>
  </div>
</template>
