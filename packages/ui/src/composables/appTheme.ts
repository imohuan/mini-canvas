/**
 * appTheme —— 成品应用**两个页面共用**的主题入口（首页项目页 + 画布工作台）。
 *
 * 解决的问题（用户原话）："这两个页面的亮色主题和暗色主题，以及主题颜色都不一样"、
 * "你的主页根本没有使用到我画布中的主题颜色"。
 *
 * 根因不是配色算法有两套，而是**读写的键有两套**：
 *   - 画布页（CanvasHost）读的是 `config/settings` —— 一个大对象，`themeMode` 与
 *     `accentColor*` 等配色都装在里面，由渲染层的 settingsPersist 桥读写；
 *   - 首页却自己发明了 `config/themeMode` 这个**独立键**（见 ProjectsPage 的 loadTheme）。
 * 于是同一个用户在两个页面上看到两套值，首页也从来拿不到用户改过的配色。
 *
 * 本模块把"主题读哪份、写哪份"收成一处，并**复用画布页那套已经写好的纯函数**
 * （`applyThemeMode` / `installThemePalette`，都来自 canvas-render）：
 *   - 主题模式：写 `<html class="dark">`；
 *   - 配色：把"用户改过的那几格"写成 `<html>` 内联 CSS 变量（与画布页同一套两格制）。
 * 两页因此**不可能再漂移**：算法一处、键一处。
 *
 * 依赖方向：本模块在 packages/ui（成品应用层），只 import canvas-render 的公开导出，
 * 不碰任何具体插件、也不改画布/内核。
 */
import {
  applyThemeMode,
  installThemePalette,
  THEME_MODE_KEY,
  type ThemeMode,
} from '@mini-canvas/canvas-render'

// 主题模式设置项的 key 直接用渲染层的真源（THEME_MODE_KEY），不在这里另写一份常量 ——
// 两处各写一份正是本模块要消灭的那类漂移。
export { THEME_MODE_KEY }

/** 配置持久化在 KV 里的**裸 key**（SaveService 落盘用 `config:` 前缀，见 canvas-data/storage/keys） */
export const SETTINGS_KV_KEY = 'settings'
/** 云端 KV 的路径：与画布页 settingsPersist 桥读写的是**同一条** */
export const SETTINGS_KV_PATH = '/api/kv/config/' + SETTINGS_KV_KEY
/** 浏览器本地 Backend 的存储 key（LocalStorageAdapter 存的就是这个带前缀的物理 key） */
export const SETTINGS_STORAGE_KEY = 'config:' + SETTINGS_KV_KEY

/**
 * 旧的「两套配置」里首页自己发明的那条路径。
 *
 * 保留这个名字只为一件事：把老版本写下的残留值**读回来迁移**并清掉，之后全仓不再有人用它。
 * 源码守卫测试（appTheme.test.ts）会扫描并拦住它重新出现在别处。
 */
export const LEGACY_THEME_MODE_KV_PATH = '/api/kv/config/themeMode'

/** 一份设置快照：key → 值（与画布页 settingsPersist 存的形状一致） */
export type AppSettings = Record<string, unknown>

/** 读到设置的地方（诊断用） */
export type AppSettingsSource = 'cloud' | 'local' | 'none'

export interface LoadedAppSettings {
  values: AppSettings
  source: AppSettingsSource
}

/** 从云端的 config/settings 读一份（未保存过 → undefined，与云端 404 语义对齐） */
async function fetchCloudSettings(): Promise<AppSettings | undefined> {
  const res = await fetch(SETTINGS_KV_PATH, { headers: { accept: 'application/json' } })
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error('读取设置失败 ' + res.status)
  const body = (await res.json()) as { value?: AppSettings }
  return body.value && typeof body.value === 'object' ? body.value : undefined
}

/** 从浏览器本地读一份（与画布页本地后端同一个 localStorage key） */
function readLocalSettings(): AppSettings | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as AppSettings) : undefined
  } catch {
    return undefined
  }
}

/**
 * 读当前应用设置：**云端优先，退回本地**。
 *
 * 顺序为什么是云端优先：用户连了后台时配置的真身在云端（画布页的 settingsPersist 桥也这么认），
 * 以本地为准会让换台机器的用户看到旧值。后台连不上时用本地那份，保证离线也能开首页。
 * 任何失败都不抛错 —— 首页不该因为后台没起就白屏。
 */
export async function loadAppSettings(): Promise<LoadedAppSettings> {
  let cloud: AppSettings | undefined
  try {
    cloud = await fetchCloudSettings()
  } catch {
    cloud = undefined
  }
  if (cloud) return { values: cloud, source: 'cloud' }
  const local = readLocalSettings()
  if (local) return { values: local, source: 'local' }
  return { values: {}, source: 'none' }
}

/** 把设置套到页面上；返回 dispose（解除主题订阅 + 清掉配色内联覆盖） */
export function applyAppTheme(values: AppSettings, root?: HTMLElement): () => void {
  const el = root ?? (typeof document === 'undefined' ? undefined : (document.documentElement as HTMLElement))
  if (!el) return () => {}
  // 主题模式：复用渲染层那一件（无 DOM/无取值器时安全地空转）
  applyThemeMode(values[THEME_MODE_KEY] === 'light' ? 'light' : 'dark', el)
  // 配色：拿一个只读这份快照的取值器喂给画布页同一套落值逻辑。
  // 只写"用户改过的格"，没改过的格保持不写 —— CSS 侧的默认值与主题插件才有控制权。
  //
  // onChange 给空订阅：首页是**静态快照**（读完就不再变），不像画布页那样有一个活的 SettingsStore。
  // installThemePalette 需要它来订阅后续改动；这里没有后续改动，给一个 no-op 即可（dispose 会连带清掉内联覆盖）。
  return installThemePalette({ get: (key) => values[key], onChange: () => ({ dispose() {} }) }, el)
}

/** 目标设置落点：能写云端就写云端（画布页读的就是它），云端不可达时退回本地 */
async function putSettings(merged: AppSettings): Promise<void> {
  try {
    const res = await fetch(SETTINGS_KV_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: merged }),
    })
    if (res.ok) return
    throw new Error('写入设置失败 ' + res.status)
  } catch {
    // 后台没连（或写入失败）→ 退回本地，保证首页切了主题下次打开还记得
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged))
      } catch {
        /* 配额不足等：主题切换本身已在内存里生效，这里静默即可 */
      }
    }
  }
}

/**
 * 切换主题模式：读-改-写同一份 `config/settings`。
 *
 * 为什么必须"读回来再合"而不是直接写一个 `{ themeMode }`：settings 是一个大对象，
 * 直接覆盖会把画布页的配色、交互开关（snapToGrid 等）整份抹掉。
 */
export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  const { values } = await loadAppSettings()
  await putSettings({ ...values, [THEME_MODE_KEY]: mode })
}

/**
 * 清掉旧的独立 `config/themeMode` 键。
 *
 * 老版本首页往那儿写过值，留着会让"两套配置"的假象继续存在（后台还摆着一个没人读的键）。
 * **只删这一个键** —— 两页共用的真源是 `config/settings`，绝不能顺手删它。
 * 后台没连时安静收场：这是一次性的清理，不该影响首页打开。
 */
export async function clearLegacyThemeModeKey(): Promise<void> {
  try {
    await fetch(LEGACY_THEME_MODE_KV_PATH, { method: 'DELETE' })
  } catch {
    /* 后台没连 / 已删过：忽略 */
  }
}

/** 服务端 KV 变更广播的事件形状（cloud-server /api/kv/events） */
interface KvChangeEventLike {
  type: string
  key: string
}

/**
 * 订阅云端配置变更：别的页面/别的标签改了 `config/settings`，这里重新读一份并回调。
 *
 * 为什么需要：首页只在挂载时读一次配置 —— 用户开着两个标签页，在画布页改了强调色，
 * 另一个标签的首页会一直显示旧颜色，直到手动刷新。接上后台的 KV 变更广播
 * （cloud-server 的 `/api/kv/events`，SSE）后闭环：谁改了都立刻同步。
 *
 * 无 EventSource（node 测试/极端环境）或后台没连 → 返回 no-op dispose，不抛错。
 */
export function watchCloudSettings(onChange: (values: AppSettings) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const es = new EventSource('/api/kv/events')
  let closed = false
  es.onmessage = (e: MessageEvent<string>): void => {
    if (closed) return
    try {
      const event = JSON.parse(e.data) as KvChangeEventLike
      // 只认「配置总表」这一条：别的 key（插件清单等）变了与主题无关
      if (event.type !== 'config' || event.key !== SETTINGS_KV_KEY) return
      void loadAppSettings().then((r) => {
        if (!closed && r.source === 'cloud') onChange(r.values)
      })
    } catch {
      /* 坏数据/断线：安静收场，下次广播再试 */
    }
  }
  return () => {
    closed = true
    es.close()
  }
}
