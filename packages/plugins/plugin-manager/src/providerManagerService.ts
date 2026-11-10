/**
 * providerManagerService —— 「平台」页的数据与动作。
 *
 * 契约（与后台 `/api/providers` 同形）：
 *   - 平台：id / 名字 / 介绍 / 图标 / 启停 / 动作数
 *   - 配置：字段声明 `config`，`accountFields` 说明哪些按账号存，`shared` 是平台通用值
 *   - 账号：id / 名字 / 默认 / 每号的值
 *   - 默认模型：按「生成类型」存（`photo` 那类不是平台属性）
 *
 * 用户口径 2026-11-10：
 * 1. 通用与账号级是**同一张清单**，靠每项一个开关切换；
 * 2. 账号可展开做全量配置，并标出与通用值的差异；
 * 3. 刷新按钮不需要 —— 后台改完会广播 `providers-version`，这里订阅即可；
 * 4. 多账号只出现在下拉的二级菜单里，模型本身仍是一行。
 */
import { reactive } from 'vue'
import { withAdminToken, type Context } from '@mini-canvas/canvas-base'

/** 一个配置字段（与后台 ProviderConfigField 同形） */
export interface ProviderField {
  key: string
  label?: string
  description?: string
  type: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'secret'
  default?: string | number | boolean
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  min?: number
  max?: number
  step?: number
}

export interface ProviderAccountRow {
  id: string
  name?: string
  default?: boolean
  values: Record<string, string | number | boolean>
}

export interface ProviderRow {
  id: string
  file: string
  builtin?: boolean
  title?: string
  description?: string
  icon?: string
  enabled: boolean
  actions: number
  config: ProviderField[]
  accountFields?: string[]
  shared?: Record<string, string | number | boolean>
  accounts: ProviderAccountRow[]
  /** 这个平台的模型明细 */
  models?: Array<{ id: string; title: string; nodeTypes: string[]; group?: string }>
  /** 这个平台服务哪些类型（后台给了就按它分；没给时按模型自己的 nodeTypes 判） */
  nodeTypes?: string[]
}

/** 一个账号的草稿（编辑中的副本，保存前不动真身） */
export interface AccountDraft {
  id: string
  name: string
  isDefault: boolean
  values: Record<string, string | number | boolean>
}

export interface ProviderManagerState {
  loading: boolean
  error: string
  rows: ProviderRow[]
  /** 当前正在编辑的平台 id（null = 列表视图） */
  editingId: string | null
  /** 编辑中：平台通用值 */
  shared: Record<string, string | number | boolean>
  /** 编辑中：哪些字段按账号存 */
  accountFields: string[]
  /** 编辑中：账号草稿 */
  accounts: AccountDraft[]
  busy: boolean
  /** 哪些账号卡片是展开的（`pid:index`） */
  expanded: string[]
  /** 正在「编辑全局属性」的账号（`pid:index`） */
  editingSharedOf: string | null
}

/** 确认框（只用那一个方法；命名避开裸 confirm，见 noNativeDialogs 守卫） */
export interface ConfirmLike {
  ask(opts: { title: string; description?: string; confirmText?: string; cancelText?: string }): Promise<boolean>
}

export interface SettingsLike {
  get(key: string): unknown
  onChange?(fn: (key: string, value: unknown) => void): { dispose(): void }
}

export function createProviderManagerService(ctx: Context, feedback?: ConfirmLike) {
  const settings = ctx.tryGet<SettingsLike>('settings')

  function baseOf(): string {
    const raw = settings?.get('cloudClientBaseUrl')
    if (typeof raw === 'string' && /^https?:\/\/[^/\s]+/i.test(raw.trim())) return raw.trim().replace(/\/+$/, '')
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
    editingId: null,
    shared: {},
    accountFields: [],
    accounts: [],
    busy: false,
    expanded: [],
    editingSharedOf: null,
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

  function rowOf(id: string): ProviderRow | undefined {
    return state.rows.find((r) => r.id === id)
  }

  /** 平台的名字：provider 没写时回落 id */
  function titleOf(row: ProviderRow): string {
    return row.title && row.title.trim() !== '' ? row.title : row.id
  }

  function isAccountField(key: string): boolean {
    return state.accountFields.includes(key)
  }

  function openEdit(row: ProviderRow): void {
    if (!row.file) return
    state.editingId = row.id
    state.shared = { ...(row.shared ?? {}) }
    // 给每个字段补一个默认（未存过时用声明里的 default）
    for (const f of row.config) {
      if (state.shared[f.key] === undefined && f.default !== undefined) state.shared[f.key] = f.default
    }
    state.accountFields = [...(row.accountFields ?? [])]
    state.accounts = row.accounts.map((a) => ({
      id: a.id,
      name: a.name ?? '',
      isDefault: a.default === true,
      values: { ...a.values },
    }))
    if (state.accounts.length === 0) {
      state.accounts = [{ id: 'main', name: '默认', isDefault: true, values: {} }]
    }
    if (!state.accounts.some((a) => a.isDefault)) state.accounts[0]!.isDefault = true
    state.expanded = []
    state.editingSharedOf = null
  }

  function closeEdit(): void {
    state.editingId = null
    state.shared = {}
    state.accountFields = []
    state.accounts = []
    state.expanded = []
    state.editingSharedOf = null
  }

  /**
   * 切换某个字段是不是「账号级」。
   *
   * 转成账号级时，把当前通用值搬到第一个账号作为初始值（用户口径：
   * 「指定后把该配置单独提炼到账号里作为第一项」），其余账号留空 = 继承通用值。
   * 转回通用时，取第一个账号的值作为通用值。
   */
  function toggleAccountField(key: string): void {
    if (isAccountField(key)) {
      const first = state.accounts[0]
      state.shared[key] = first?.values[key] ?? state.shared[key] ?? ''
      state.accountFields = state.accountFields.filter((k) => k !== key)
      for (const a of state.accounts) delete a.values[key]
      return
    }
    state.accountFields = [...state.accountFields, key]
    const base = state.shared[key] ?? ''
    state.accounts.forEach((a, i) => {
      if (i === 0) a.values[key] = a.values[key] ?? base
    })
  }

  function addAccount(): void {
    const n = state.accounts.length
    const values: Record<string, string | number | boolean> = {}
    // 只为账号级字段建空位（用户口径：通用属性不重复）
    for (const key of state.accountFields) values[key] = ''
    state.accounts.push({ id: 'account-' + (n + 1), name: '账号 ' + (n + 1), isDefault: false, values })
  }

  function removeAccount(index: number): void {
    if (state.accounts.length <= 1) return
    const wasDefault = state.accounts[index]?.isDefault === true
    state.accounts.splice(index, 1)
    if (wasDefault && state.accounts[0]) state.accounts[0].isDefault = true
    state.expanded = state.expanded.filter((k) => k !== `${state.editingId}:${index}`)
  }

  function setDefaultAccount(index: number): void {
    state.accounts.forEach((a, i) => (a.isDefault = i === index))
  }

  function toggleExpanded(index: number): void {
    const key = `${state.editingId}:${index}`
    state.expanded = state.expanded.includes(key)
      ? state.expanded.filter((k) => k !== key)
      : [...state.expanded, key]
  }

  function isExpanded(index: number): boolean {
    return state.expanded.includes(`${state.editingId}:${index}`)
  }

  function toggleEditShared(index: number): void {
    const key = `${state.editingId}:${index}`
    state.editingSharedOf = state.editingSharedOf === key ? null : key
    if (state.editingSharedOf === key) toggleExpandedOpen(index)
  }

  function toggleExpandedOpen(index: number): void {
    if (!isExpanded(index)) state.expanded = [...state.expanded, `${state.editingId}:${index}`]
  }

  function isEditingShared(index: number): boolean {
    return state.editingSharedOf === `${state.editingId}:${index}`
  }

  async function saveEdit(): Promise<string | null> {
    const row = state.editingId ? rowOf(state.editingId) : undefined
    if (!row) return null
    const seen = new Set<string>()
    for (const a of state.accounts) {
      const id = a.id.trim()
      if (!id) return '每个账号都要填账号 ID'
      if (seen.has(id)) return '账号 ID 不能重复：' + id
      seen.add(id)
    }
    if (state.accounts.length === 0) return '至少保留一个账号'

    state.busy = true
    try {
      const res = await call('/api/providers/' + encodeURIComponent(row.file) + '/values', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platformId: row.id,
          shared: state.shared,
          accountFields: state.accountFields,
          accounts: state.accounts.map((a) => ({
            id: a.id.trim(),
            ...(a.name.trim() ? { name: a.name.trim() } : {}),
            ...(a.isDefault ? { default: true } : {}),
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
      state.busy = false
    }
  }

  async function toggleEnabled(row: ProviderRow): Promise<string | null> {
    state.busy = true
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
      state.busy = false
    }
  }

  async function remove(row: ProviderRow): Promise<string | null> {
    const ok = await feedback?.ask({
      title: '删除平台「' + titleOf(row) + '」？',
      description: '会删除文件 ' + row.file + '，它的模型会立刻从底栏消失。\n删除后重启也不会自动装回来。',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (ok === false) return null
    state.busy = true
    try {
      const res = await call('/api/providers/' + encodeURIComponent(row.file), { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? '删除失败 ' + res.status)
      }
      if (state.editingId === row.id) closeEdit()
      await refresh()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    } finally {
      state.busy = false
    }
  }

  // 服务地址改了 → 立刻按新地址重拉（与 cloud-client 同一条 onChange 通道）
  const offSettings = settings?.onChange?.(() => void refresh())
  ctx.effect(() => () => offSettings?.dispose())

  return {
    state,
    refresh,
    titleOf,
    openEdit,
    closeEdit,
    isAccountField,
    toggleAccountField,
    addAccount,
    removeAccount,
    setDefaultAccount,
    isExpanded,
    toggleExpanded,
    isEditingShared,
    toggleEditShared,
    saveEdit,
    toggleEnabled,
    remove: removeRow,
  }

  function removeRow(row: ProviderRow): Promise<string | null> {
    return remove(row)
  }
}
