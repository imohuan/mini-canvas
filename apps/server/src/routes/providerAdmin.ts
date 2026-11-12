/**
 * provider 管理路由 —— 设置面板「平台」页的数据源。
 *
 * 契约：
 *   GET    /api/providers                → 全部 provider（声明 + 启停 + 账号掩码值）
 *   POST   /api/providers/reload         → 强制重扫目录
 *   POST   /api/providers/:file/disable  → 停用（装载跳过该文件；文件不动）
 *   POST   /api/providers/:file/enable   → 恢复启用
 *   DELETE /api/providers/:file          → 删文件 + 记 deletedFiles（重启不再铺回）
 *   PUT    /api/providers/:file/config   → 保存账号清单（整体替换；值注入 __mcProviderConfig）
 *
 * :file 是**文件名**（不是 provider id）：装载 import 之前只有文件名已知，
 * 「注入配置」发生在执行前 —— 启停 / 删 / 配置全按文件名定位。
 *
 * 写接口走管理令牌白名单（ADMIN_WRITE_PREFIXES 里的 /api/providers/）+ 成对审计（withAudit）。
 * GET 不要令牌（与 /api/actions 同级：读不构成攻击面）。
 */
import { Hono } from 'hono'
import type { ProviderRegistry } from '../providers/registry.js'
import type { ProviderConfigField } from '../providers/types.js'
import {
  accountsForPlatform,
  fieldOfKey,
  isSafeFileName,
  platformOfKey,
  splitArrayKey,
  type ProviderAccount,
  type ProviderConfigFile,
} from '../providers/configStore.js'

/** 宿主注入的 providerAdmin 服务（server.ts 建好那一份） */
export interface ProviderAdminService {
  reload(): Promise<{ count: number; version: number }>
  fileOf(id: string): string | undefined
  setDisabled(file: string, disabled: boolean): Promise<void>
  /** 删除文件；文件本来就不存在（内置平台）返回 false */
  deleteFile(file: string): Promise<boolean>
  saveAccounts(file: string, accounts: ProviderAccount[]): Promise<void>
  /**
   * 保存「点分隔 key」配置（新结构）。
   *
   * accounts 里的 `values` 是已经解析好的每账号值；`accountFields` 说明哪些字段是账号级，
   * 其余字段取第一个账号（或 shared）的值写成平台通用 key。
   */
  saveKeyConfig?(
    platformId: string,
    payload: { shared: Record<string, string | number | boolean>; accounts: ProviderAccount[]; accountFields: string[] },
  ): Promise<void>
  /** 生成类型 → 默认模型（全局） */
  saveDefaults?(defaults: Record<string, string>): Promise<void>
  readConfig(): Promise<ProviderConfigFile>
  dir: string
}

/** secret 只写不回读：下发掩码（首4 + … + 末4），没存过给空串 */
function maskOf(v: unknown): string {
  const s = String(v ?? '')
  if (!s) return ''
  if (s.length <= 8) return s.slice(0, 1) + '…' + s.slice(-1)
  return s.slice(0, 4) + '…' + s.slice(-4)
}

/** 下发出去的那串掩码被原样送回来 = 用户没改，保留服务端原值（否则一次保存就把密钥写成 "sk-Z…RQFG"） */
function sameMask(value: unknown, incoming: unknown): boolean {
  const v = String(value ?? '')
  return v !== '' && String(incoming ?? '') === maskOf(v)
}

/** 平台提供哪些节点类型（从它的动作声明里并集出来；没声明 nodeTypes 的动作按“都适用”忽略） */
function nodeTypesOfActions(actions: Array<{ nodeTypes?: string[] }>): string[] {
  const out = new Set<string>()
  for (const a of actions) {
    for (const t of a.nodeTypes ?? []) out.add(t)
  }
  return [...out]
}

/** 给前端的一行 provider（声明 + 当前状态 + 掩码后的值） */
export interface ProviderRow {
  id: string
  file: string
  /** 内置平台（没有文件）：界面上不给删、不给配 */
  builtin?: boolean
  /** 平台自己的名字 / 介绍 / 图标（provider 没写时留空，前端回落） */
  title?: string
  description?: string
  icon?: string
  enabled: boolean
  actions: number
  /** 这个平台提供哪些节点类型（image / video / audio / text）；界面按它统计「生成类型」 */
  nodeTypes?: string[]
  /** 这个平台的模型明细（模型页按类型列出来，设置默认模型用） */
  models?: Array<{ id: string; title: string; nodeTypes: string[]; group?: string }>
  config: ProviderConfigField[]
  /**
   * 哪些字段是「账号级」：key 列表。
   *
   * 判定依据：该字段在配置里出现过 `.[n]` 下标，或者账号清单里存过不同的值。
   * 前端据此把开关拨到「账号级」，并把值摊到每个账号。
   */
  accountFields?: string[]
  /** 这个平台配置里每个字段的「平台通用值」（已按 secret 掩码） */
  shared?: Record<string, string | number | boolean>
  /** 每个账号：id / name / 值（secret 已按位掩掉） */
  accounts: Array<{ id: string; name?: string; default?: boolean; values: Record<string, string | number | boolean> }>
}

export function providerAdminRoutes(registry: ProviderRegistry, admin: ProviderAdminService): Hono {
  const app = new Hono()

  /** 账号级字段：配置里出现过 `.[n]` 的字段名 */
  function accountFieldsOf(pid: string, config: Record<string, string | number | boolean>): string[] {
    const out = new Set<string>()
    for (const key of Object.keys(config)) {
      if (platformOfKey(key) !== pid) continue
      if (splitArrayKey(key).index === undefined) continue
      out.add(fieldOfKey(key))
    }
    return [...out]
  }

  app.get('/api/providers', async (c) => {
    const cfg = await admin.readConfig()
    const keyConfig = cfg.config ?? {}
    const platformMeta = cfg.platforms ?? {}
    /** 值下发前先按字段类型掩掉 secret */
    const maskValues = (
      values: Record<string, string | number | boolean>,
      fields: ProviderConfigField[],
    ): Record<string, string | number | boolean> =>
      Object.fromEntries(
        fields.map((f) => [f.key, f.type === 'secret' ? maskOf(values[f.key]) : (values[f.key] ?? '')]),
      )
    // 已装载的 provider：从 registry 拿（enabled 状态天然成立）+ 文件名由 fileOf 反查。
    // 停用的文件不在 registry 里 —— 补一行「已停用」占位（声明拿不到：没 import），前端显示文件名。
    const rows: ProviderRow[] = registry.listProviders().map((p) => {
      const file = admin.fileOf(p.id) ?? ''
      const fields = p.config ?? []
      const accountFields = accountFieldsOf(p.id, keyConfig)
      const perAccount = accountsForPlatform(keyConfig, platformMeta[p.id], p.id)
      /** 平台通用值：只取非账号级字段（账号级字段的通用值也保留，作为「未填时用」的默认值） */
      const shared = maskValues(
        Object.fromEntries(
          fields.map((f) => {
            const key = p.id + '.' + f.key
            return [f.key, keyConfig[key] ?? '']
          }),
        ),
        fields,
      )
      return {
        id: p.id,
        file,
        ...(nodeTypesOfActions(p.actions).length > 0 ? { nodeTypes: nodeTypesOfActions(p.actions) } : {}),
        models: p.actions.map((a) => ({
          id: a.id,
          title: a.title,
          nodeTypes: a.nodeTypes ?? [],
          ...(a.group ? { group: a.group } : {}),
        })),
        ...(file === '' ? { builtin: true } : {}),
        ...(p.title ? { title: p.title } : {}),
        ...(p.description ? { description: p.description } : {}),
        ...(p.icon ? { icon: p.icon } : {}),
        enabled: true,
        actions: p.actions.length,
        config: fields,
        accountFields,
        shared,
        accounts: perAccount.map((a) => ({
          id: a.id,
          ...(a.name ? { name: a.name } : {}),
          ...(a.default ? { default: true } : {}),
          values: maskValues(a.values, fields),
        })),
      }
    })
    // 停用文件：registry 里没有 —— 给占位行（配置表单拿不到声明，前端按「已停用」渲染）。
    const knownFiles = new Set(rows.map((r) => r.file))
    for (const file of cfg.disabledFiles) {
      if (!isSafeFileName(file) || knownFiles.has(file)) continue
      // 停用的文件已经装载不到声明，只能拿配置里的账号清单；按文件名猜 platformId（历史约定一致）
      const pid = file.replace(/\.js$/, '')
      const keyConfig = cfg.config ?? {}
      const platformMeta = cfg.platforms ?? {}
      const accounts = accountsForPlatform(keyConfig, platformMeta[pid], pid)
      const snap = platformMeta[pid]
      rows.push({
        id: pid,
        file,
        ...(snap?.title ? { title: snap.title } : {}),
        ...(snap?.description ? { description: snap.description } : {}),
        ...(snap?.icon ? { icon: snap.icon } : {}),
        enabled: false,
        actions: 0,
        config: [],
        accountFields: accountFieldsOf(pid, keyConfig),
        shared: Object.fromEntries(
          Object.entries(keyConfig)
            .filter(([k]) => platformOfKey(k) === pid && splitArrayKey(k).index === undefined)
            .map(([k, v]) => [fieldOfKey(k), String(v)]),
        ),
        accounts: accounts.map((a) => ({
          id: a.id,
          ...(a.name ? { name: a.name } : {}),
          ...(a.default ? { default: true } : {}),
          values: { ...a.values },
        })),
      })
    }
    rows.sort((a, b) => a.id.localeCompare(b.id))
    return c.json({ ok: true, providers: rows, defaults: cfg.defaults ?? {} })
  })

  app.post('/api/providers/reload', async (c) => {
    const r = await admin.reload()
    return c.json({ ok: true, ...r })
  })

  /**
   * 生成类型 → 默认模型（全局，不分平台）。
   *
   * PUT body: { defaults: { 图片: 'web2api:xxx', 视频: '' } }
   */
  app.put('/api/providers/model-defaults', async (c) => {
    if (!admin.saveDefaults) return c.json({ ok: false, error: '当前宿主不支持默认模型' }, 501)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const raw = (body as { defaults?: unknown }).defaults
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return c.json({ ok: false, error: 'defaults 必须是对象' }, 400)
    }
    const defaults: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') defaults[k] = v
    }
    await admin.saveDefaults(defaults)
    return c.json({ ok: true })
  })

  /** 文件名参数守卫（所有 :file 路由共用） */
  function safeFile(raw: string): string | undefined {
    const decoded = decodeURIComponent(raw)
    return isSafeFileName(decoded) ? decoded : undefined
  }

  app.post('/api/providers/:file/disable', async (c) => {
    const file = safeFile(c.req.param('file'))
    if (!file) return c.json({ ok: false, error: '非法文件名' }, 400)
    await admin.setDisabled(file, true)
    return c.json({ ok: true })
  })

  app.post('/api/providers/:file/enable', async (c) => {
    const file = safeFile(c.req.param('file'))
    if (!file) return c.json({ ok: false, error: '非法文件名' }, 400)
    await admin.setDisabled(file, false)
    return c.json({ ok: true })
  })

  app.delete('/api/providers/:file', async (c) => {
    const file = safeFile(c.req.param('file'))
    if (!file) return c.json({ ok: false, error: '非法文件名' }, 400)
    const removed = await admin.deleteFile(file)
    // 内置平台没有文件：明确报错，别让界面以为删掉了
    if (!removed) return c.json({ ok: false, error: '这个平台是内置的，没有文件可删' }, 404)
    return c.json({ ok: true })
  })

  app.put('/api/providers/:file/config', async (c) => {
    const file = safeFile(c.req.param('file'))
    if (!file) return c.json({ ok: false, error: '非法文件名' }, 400)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const accounts = (body as { accounts?: unknown }).accounts
    if (!Array.isArray(accounts)) return c.json({ ok: false, error: 'accounts 必须是数组' }, 400)
    // 老值：按账号 id 查，用来把「回传的掩码」还原成真实密钥
    const cfg = await admin.readConfig()
    const prevById = new Map((cfg.files[file]?.accounts ?? []).map((a) => [a.id, a.values]))
    const cleaned: ProviderAccount[] = []
    for (const a of accounts) {
      if (!a || typeof a !== 'object') continue
      const id = String((a as { id?: unknown }).id ?? '').trim()
      if (!id) continue
      const values: Record<string, string | number | boolean> = {}
      const raw = (a as { values?: unknown }).values
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const prev = prevById.get(id) ?? {}
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
          values[k] = sameMask(prev[k], v) ? prev[k]! : v
        }
      }
      cleaned.push({
        id,
        ...(typeof (a as { name?: unknown }).name === 'string'
          ? { name: (a as { name: string }).name }
          : {}),
        values,
      })
    }
    await admin.saveAccounts(file, cleaned)
    return c.json({ ok: true })
  })

  /**
   * 保存「平台配置 + 账号」到点分隔 key 结构。
   *
   * PUT body:
   *   {
   *     shared:        { baseUrl: 'https://…' },        // 平台通用值（账号级字段这里也可以有默认值）
   *     accountFields: ['apiKey'],                      // 哪些字段按账号存
   *     accounts:      [{ id, name, default?, values: { apiKey: 'sk-…' } }],
   *   }
   *
   * 落盘形状（用户口径 2026-11-10）：
   *   config:    { 'pid.baseUrl': '…', 'pid.apiKey.[0]': 'sk-…' }
   *   platforms: { pid: { accounts: [{id, name, default}] } }
   */
  app.put('/api/providers/:file/values', async (c) => {
    const file = safeFile(c.req.param('file'))
    if (!file) return c.json({ ok: false, error: '非法文件名' }, 400)
    if (!admin.saveKeyConfig) return c.json({ ok: false, error: '当前宿主不支持新配置结构' }, 501)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const b = body as { shared?: unknown; accountFields?: unknown; accounts?: unknown }
    if (!Array.isArray(b.accounts)) return c.json({ ok: false, error: 'accounts 必须是数组' }, 400)

    const pid = String((body as { platformId?: unknown }).platformId ?? file.replace(/\.js$/, ''))
    const cfg = await admin.readConfig()
    // 老值用来还原掩码：点分隔结构与旧结构都可能存过真值
    const prev = new Map<string, Record<string, string | number | boolean>>()
    const keyConfig = cfg.config ?? {}
    for (const [k, v] of Object.entries(keyConfig)) {
      if (platformOfKey(k) !== pid) continue
      const idx = splitArrayKey(k).index ?? 0
      const id = (cfg.platforms?.[pid]?.accounts ?? [])[idx]?.id ?? 'main'
      const bucket = prev.get(id) ?? {}
      bucket[fieldOfKey(k)] = v
      prev.set(id, bucket)
    }

    /**
     * 平台通用值：**掩码必须还原成真值再落盘**。
     *
     * 界面回传的是掩码（`sk-Z…RQFG`）。之前只有账号级字段走了 sameMask 还原，
     * 通用值直接落盘 → 真 key 被覆盖成掩码 → 请求头带省略号直接抛错，
     * 用户看到的就是「任务失败」但没有任何原因（2026-11-10 实测）。
     */
    const sharedOld: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(keyConfig)) {
      if (platformOfKey(k) !== pid) continue
      if (splitArrayKey(k).index !== undefined) continue
      sharedOld[fieldOfKey(k)] = v
    }
    const shared: Record<string, string | number | boolean> = {}
    if (b.shared && typeof b.shared === 'object' && !Array.isArray(b.shared)) {
      for (const [k, v] of Object.entries(b.shared as Record<string, unknown>)) {
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
        shared[k] = sameMask(sharedOld[k], v) ? sharedOld[k]! : v
      }
    }

    const accounts: ProviderAccount[] = []
    for (const a of b.accounts) {
      if (!a || typeof a !== 'object') continue
      const id = String((a as { id?: unknown }).id ?? '').trim()
      if (!id) continue
      const values: Record<string, string | number | boolean> = {}
      const raw = (a as { values?: unknown }).values
      const old = prev.get(id) ?? {}
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
          // 掩码原样回传 = 没改，保留服务端原值
          values[k] = sameMask(old[k], v) ? old[k]! : v
        }
      }
      accounts.push({
        id,
        ...(typeof (a as { name?: unknown }).name === 'string' && (a as { name: string }).name !== ''
          ? { name: (a as { name: string }).name }
          : {}),
        ...((a as { default?: unknown }).default === true ? { default: true } : {}),
        values,
      })
    }

    const accountFields = Array.isArray(b.accountFields)
      ? b.accountFields.filter((x): x is string => typeof x === 'string')
      : []

    await admin.saveKeyConfig(pid, { shared, accounts, accountFields })
    return c.json({ ok: true })
  })

  return app
}
