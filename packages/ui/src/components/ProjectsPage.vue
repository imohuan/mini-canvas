<script setup lang="ts">
/**
 * ProjectsPage —— 项目列表页（对标 LibTV `/project`，按用户要求**去掉红框区域**）。
 *
 * 去掉的：右上「积分/开通会员/头像」、左栏「Agent / 3D-BOX / 插件与扩展 / 社区 / 版本更新记录」。
 * 留下的：左栏（logo + 新建项目 + 首页/项目/资产）+ 主区（返回/全部项目/搜索/回收站/新建文件夹
 * + 项目卡片网格 + 「没有更多了」）。
 *
 * 数据全部来自 cloud-server（`/api/projects`），不写死；点项目 → 打开它的画布（没有就先建一张）。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Search, Trash2, FolderPlus, House, Folder, Image as ImageIcon, ChevronLeft, Sun, Moon } from 'lucide-vue-next'
import { listProjects, createProject, deleteProject, listCanvases, createCanvas, listAssets, type ProjectSummary, type AssetSummary } from '../composables/projectsApi'

const router = useRouter()
const projects = ref<ProjectSummary[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
/** 左栏页签：首页 / 项目 / 资产（同一页里切换主区内容） */
const nav = ref<'home' | 'projects' | 'assets'>('projects')
const assets = ref<AssetSummary[]>([])
/** 主题：亮 / 暗（写回 KV 的 config/themeMode，与画布工作台同一个键） */
const theme = ref<'dark' | 'light'>('dark')

function applyTheme(v: 'dark' | 'light'): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', v === 'dark')
  document.documentElement.dataset.canvasTheme = v
}
async function loadTheme(): Promise<void> {
  try {
    const res = await fetch('/api/kv/config/themeMode')
    if (res.ok) {
      const body = (await res.json()) as { value?: unknown }
      if (body.value === 'dark' || body.value === 'light') theme.value = body.value
    }
  } catch {
    /* 没连后台 → 保持默认暗色 */
  }
  applyTheme(theme.value)
}
function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme(theme.value)
  void fetch('/api/kv/config/themeMode', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: theme.value }),
  }).catch(() => undefined)
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
  void loadTheme()
  void refresh()
})

/** 切左栏页签：进「资产」时拉一次资产清单 */
function switchNav(tab: 'home' | 'projects' | 'assets'): void {
  nav.value = tab
  if (tab === 'assets') void loadAssets()
}
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
  const name = window.prompt('新项目名字', '未命名项目')
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
  if (!window.confirm('删除项目「' + p.name + '」及其全部画布？')) return
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

<template>
  <div class="flex h-screen bg-canvas-bg text-ink">
    <!-- 左栏 -->
    <aside class="flex w-[200px] flex-none flex-col gap-2 border-r border-line px-3 py-4">
      <div class="flex items-center gap-2 px-2 pb-2 text-[15px] font-bold tracking-wide">
        <span class="grid size-6 place-items-center rounded-md bg-brand text-[13px] font-black text-white">M</span>
        MiniCanvas
      </div>
      <button class="flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-[13px] font-semibold text-white transition-colors hover:bg-brand/85" @click="newProject">
        <Plus :size="15" /> 新建项目
      </button>
      <nav class="mt-1 flex flex-col gap-0.5">
        <button class="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] transition-colors hover:bg-hover" :class="nav === 'home' ? 'bg-hover-strong font-semibold text-ink' : 'text-ink/90'" @click="switchNav('home')">
          <House :size="15" /> 首页
        </button>
        <button class="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] transition-colors hover:bg-hover" :class="nav === 'projects' ? 'bg-hover-strong font-semibold text-ink' : 'text-ink/90'" @click="switchNav('projects')">
          <Folder :size="15" /> 项目
        </button>
        <button class="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] transition-colors hover:bg-hover" :class="nav === 'assets' ? 'bg-hover-strong font-semibold text-ink' : 'text-ink/90'" @click="switchNav('assets')">
          <ImageIcon :size="15" /> 资产
        </button>
      </nav>
    </aside>

    <!-- 主区 -->
    <main class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 flex-none items-center gap-3 px-6">
        <button class="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-ink-dim transition-colors hover:bg-hover" @click="router.back()">
          <ChevronLeft :size="15" /> 返回
        </button>
        <span class="h-4 w-px bg-line"></span>
        <strong class="text-[15px]">{{ nav === 'assets' ? '全部资产' : nav === 'home' ? '首页' : '全部项目' }}</strong>
        <div class="ml-auto flex items-center gap-2">
          <label class="flex h-9 w-[240px] items-center gap-2 rounded-lg border border-line bg-veil px-3">
            <Search :size="15" class="flex-none text-ink-dim" />
            <input v-model="query" class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-dim focus:outline-none" placeholder="搜索项目" aria-label="搜索项目" />
          </label>
          <button class="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] text-ink transition-colors hover:bg-hover">
            <Trash2 :size="14" /> 回收站
          </button>
          <button class="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] text-ink transition-colors hover:bg-hover" @click="newProject">
            <FolderPlus :size="14" /> 新建文件夹
          </button>
          <button class="grid size-9 place-items-center rounded-lg border border-line text-ink transition-colors hover:bg-hover" aria-label="主题切换" @click="toggleTheme">
            <Sun v-if="theme === 'dark'" :size="15" />
            <Moon v-else :size="15" />
          </button>
        </div>
      </header>

      <p v-if="error" class="mx-6 mb-2 rounded-lg border border-[color:var(--ui-danger,#ef4444)] px-3 py-2 text-[12px] text-[color:var(--ui-danger,#ef4444)]" role="alert">{{ error }}</p>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <!-- 资产页签：生成产物 + 自己上传，统一列表 -->
        <div v-if="nav === 'assets'" class="grid grid-cols-5 gap-4">
          <div v-for="a in assets" :key="a.id" class="flex flex-col gap-2">
            <div class="relative h-[150px] overflow-hidden rounded-xl border border-line bg-thumb-soft">
              <img v-if="a.kind === 'image'" :src="a.url" alt="" class="h-full w-full object-cover" />
              <span v-else class="grid h-full place-items-center text-ink-mute"><ImageIcon :size="26" :stroke-width="1" /></span>
            </div>
            <span class="truncate text-[13px] text-ink">{{ a.name }}</span>
            <span class="text-[11px] text-ink-dim">{{ a.source === 'upload' ? '手动上传' : '生成' }} · {{ dateOf(a.createdAt) }}</span>
          </div>
          <p v-if="assets.length === 0" class="col-span-5 py-16 text-center text-[13px] text-ink/50">还没有资产。生成或上传之后会出现在这里。</p>
        </div>

        <!-- 首页页签：直接给「全部项目」入口（与项目页一致，先不做额外内容） -->
        <div v-else-if="nav === 'home'" class="grid place-items-center py-24 text-center text-[13px] text-ink/60">
          <p>欢迎使用 MiniCanvas。选「项目」开始创作，或「资产」查看生成与上传的素材。</p>
        </div>

        <!-- 项目页签 -->
        <div v-else class="grid grid-cols-5 gap-4">
          <!-- 开始创作 -->
          <button class="flex flex-col gap-2 text-left" @click="newProject">
            <span class="grid h-[150px] place-items-center rounded-xl border border-line bg-panel text-ink-dim transition-colors hover:bg-hover">
              <Plus :size="26" />
            </span>
            <span class="text-[13px] text-ink">创建新的视频项目</span>
          </button>

          <!-- 项目卡片 -->
          <div v-for="p in projects.filter((x) => !query || x.name.includes(query))" :key="p.id" class="group relative flex flex-col gap-2">
            <button class="absolute inset-0 z-10 rounded-xl" :aria-label="'打开项目 ' + p.name" @click="openProject(p)"></button>
            <div class="grid h-[150px] place-items-center overflow-hidden rounded-xl border border-line bg-gradient-to-br from-panel-active to-panel-soft text-ink-mute">
              <Folder :size="30" :stroke-width="1" />
            </div>
            <span class="truncate text-[13px] text-ink">{{ p.name }}</span>
            <span class="text-[11px] text-ink-dim">{{ dateOf(p.createdAt) }}</span>
            <button
              v-if="p.id !== 'default'"
              class="absolute right-1 top-1 z-20 grid size-6 place-items-center rounded-lg bg-panel/90 text-ink-dim opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover:opacity-100"
              :aria-label="'删除项目 ' + p.name" @click.stop="removeProject(p)">
              <Trash2 :size="13" />
            </button>
          </div>
        </div>

        <p v-if="nav === 'projects' && loading" class="py-16 text-center text-[13px] text-ink/50">正在读取项目…</p>
        <p v-else-if="nav === 'projects' && projects.length === 0" class="py-16 text-center text-[13px] text-ink/50">还没有项目，点「新建项目」开始。</p>
        <p v-else-if="nav === 'projects'" class="py-10 text-center text-[12px] text-ink-dim">没有更多了</p>
      </div>
    </main>
  </div>
</template>
