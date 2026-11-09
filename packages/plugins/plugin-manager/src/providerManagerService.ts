/**
 * providerManagerService —— 「平台」页的数据与动作（provider 管理）。
 *
 * 与 pluginManagerService 同款骨架：reactive 状态 + fetch 动作。
 * 数据来自 cloud-server 的 /api/providers（providerAdmin 路由）；
 * 服务地址沿用「连接」设置里的 cloudClientBaseUrl（空 = 同源），运行期跟随变化。
 */
import { reactive } from 'vue'
import { withAdminToken, type Context } from '@mini-canvas/canvas-base'
/** GET /api/providers 的一行（与 cloud-server 契约同形；就地声明避免跨插件依赖） */
export interface ProviderRow {
  id: string
  file: string
  enabled: boolean
  actions: number
  config: Array<{
    key: string
    label?: string
    description?: string
    type: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'secret'
    default?: string | number | boolean
    options?: Array<{ label: string; value: string }>
    placeholder?: string
  }>
  accounts: Array<{ id: string; name?: string; values: Record<string, string | number | boolean> }>
}

export interface ProviderAccountDraft {
  id: string
  name: string
  values: Record<string, string | number | boolean>
}

export interface ProviderManagerState {
  loading: boolean
  error: string
  rows: ProviderRow[]
  /** 正在编辑账号的 provider 文件（null = 没有打开编辑区） */
  editingFile: string | null
  editingAccounts: ProviderAccountDraft[]
  busyFile: string | null
}

/** 窄接口的 settings（与本插件真实用到的部分同形） */
export interface SettingsLike {
  get(key: string): unknown
  onChange?(fn: (key: string, value: unknown) => void): { dispose(): void }
}

export function createProviderManagerService(ctx: Context) {
  const settings = ctx.tryGet<SettingsLike>('settings')

  function baseOf(): string {
    const raw = settings?.get('cloudClientBaseUrl')
    if (typeof raw === 'string' && /^https?:\/\/[^/\s]+/i.test(raw.trim())) {
      return raw.trim().replace(/\/+$/, '')
    }
    return ''
  }

  async function call(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)
    for (const [k, v] of Object.entries(withAdminToken())) headers.set(k, v)
    return fetch(baseOf() + path, { ...init, headers })
  }

  const state = reactive<ProviderManagerState>({
    loading: false,
    error: '',
    rows: [],
    editingFile: null,
    editingAccounts: [],
    busyFile: null,
  })

  async function refresh(): Promise<void> {
    state.loading = true
    state.error = ''
    try {
      const res = await call('/api/providers')
      if (!res.ok) throw new Error('拉平台清单失败 ' + res.status)
      const body = (await res.json()) as { providers?: ProviderRow[] }
      state.rows = Array.isArray(body.providers) ? body.providers : []
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
    } finally {
      state.loading = false
    }
  }

  function secretMaskOf(v: unknown): string {
    const s = String(v ?? '')
    if (!s) return ''
    return s.length <= 8 ? s.slice(0, 1) + '…' + s.slice(-1) : s.slice(0, 4) + '…' + s.slice(-4)
  }

  function openEdit(row: ProviderRow): void {
    state.editingFile = row.file
    state.editingAccounts = row.accounts.map((a) => ({
      id: a.id,
      name: a.name ?? '',
      // secret 已被后台掩码：回显掩码，保存时原样回传 = 不改（后台识别掩码保持原值）
      values: { ...a.values },
    }))
    if (state.editingAccounts.length === 0) {
      // 没配过：按声明给一份默认账号
      const values: Record<string, string | number | boolean> = {}
      for (const f of row.config) {
        if (f.default !== undefined) values[f.key] = f.default
        else if (f.type === 'boolean') values[f.key] = false
        else if (f.type === 'number') values[f.key] = 0
        else values[f.key] = ''
      }
      state.editingAccounts = [{ id: 'main', name: '默认', values }]
    }
  }

  function closeEdit(): void {
    state.editingFile = null
    state.editingAccounts = []
  }

  function addAccount(row: ProviderRow): void {
    const values: Record<string, string | number | boolean> = {}
    for (const f of row.config) {
      if (f.default !== undefined) values[f.key] = f.default
      else if (f.type === 'boolean') values[f.key] = false
      else if (f.type === 'number') values[f.key] = 0
      else values[f.key] = ''
    }
    state.editingAccounts.push({ id: 'account-' + (state.editingAccounts.length + 1), name: '', values })
  }

  function removeAccount(index: number): void {
    state.editingAccounts.splice(index, 1)
  }

  async function saveEdit(): Promise<string | null> {
    const file = state.editingFile
    if (!file) return null
    state.busyFile = file
    try {
      const res = await call('/api/providers/' + encodeURIComponent(file) + '/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accounts: state.editingAccounts.map((a) => ({
            id: a.id.trim() || 'account-' + Math.random().toString(36).slice(2, 6),
            ...(a.name.trim() ? { name: a.name.trim() } : {}),
            values: a.values,
          })),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? '保存失败 ' + res.status)
      }
      closeEdit()
      await refresh()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    } finally {
      state.busyFile = null
    }
  }

  async function toggleEnabled(row: ProviderRow): Promise<string | null> {
    state.busyFile = row.file
    try {
      const res = await call('/api/providers/' + encodeURIComponent(row.file) + (row.enabled ? '/disable' : '/enable'), {
        method: 'POST',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? '切换失败 ' + res.status)
      }
      await refresh()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    } finally {
      state.busyFile = null
    }
  }

  async function remove(row: ProviderRow): Promise<string | null> {
    state.busyFile = row.file
    try {
      const res = await call('/api/providers/' + encodeURIComponent(row.file), { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? '删除失败 ' + res.status)
      }
      await refresh()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    } finally {
      state.busyFile = null
    }
  }

  async function forceReload(): Promise<string | null> {
    state.loading = true
    try {
      const res = await call('/api/providers/reload', { method: 'POST' })
      if (!res.ok) throw new Error('强制刷新失败 ' + res.status)
      await refresh()
      return null
    } catch (err) {
      state.loading = false
      return err instanceof Error ? err.message : String(err)
    }
  }

  // 服务地址改了 → 立刻按新地址重拉（与 cloud-client 同一条 onChange 通道）
  const offSettings = settings?.onChange?.((_key, _value) => void refresh())
  ctx.effect(() => () => offSettings?.dispose())

  return {
    state,
    refresh,
    openEdit,
    closeEdit,
    addAccount,
    removeAccount,
    saveEdit,
    toggleEnabled,
    remove: removeRow,
    forceReload,
    secretMaskOf,
  }

  function removeRow(row: ProviderRow): Promise<string | null> {
    return remove(row)
  }
}
