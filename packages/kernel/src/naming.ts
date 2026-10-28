/**
 * naming —— 全仓统一 id 规范（单一事实源，纯逻辑零 Vue）。
 *
 * 为什么要有这一层：命令、事件、槽条目、插件运行时名此前三套分隔符混用
 * （audio.upload / ui/context / plugin-manager-page），看 id 分不清谁是谁的。
 *
 * 规则（2026-10-28 用户确认）：
 * - 插件名：小写短横线，不带 plugin- 前缀 —— agent、node-image、theme-default
 *   例外：`plugin-manager` 保留（它是既有服务名 + 云端安装名单的存储 key，
 *   改名会让已保存的安装名单失效；只此一处例外）。
 * - 命令/事件：插件名:动作 —— agent:open、node-image:upload
 * - 槽内条目：owner/name —— agent/host、host/agent（宿主固定 owner = host）
 * - 槽名：点号分层 —— shell.dock、settings.group
 *
 * 校验只做"不合法要喊出来"，不做自动改写：id 是外部契约，静默改名更难排查。
 */

/** 通用段：小写字母/数字/短横线 */
const SEG = /^[a-z0-9][a-z0-9-]*$/
/** 动作段：允许点号分子动作（如 node-image:crop.confirm） */
const ACTION = /^[a-z0-9][a-z0-9.-]*$/
/** 槽内条目名：允许中文等非 ASCII（设置分组名就是中文），只禁空白与斜杠 */
const ITEM_NAME = /^[^\s/]+$/u

/** 既有例外：服务名/存储 key 已绑定，不改 */
export const PLUGIN_NAME_WHITELIST = ['plugin-manager'] as const

/** 插件运行时名是否合规（小写短横线，无 plugin- 前缀；plugin-manager 例外） */
export function isPluginName(name: string): boolean {
  if (name === 'plugin-manager') return true
  return SEG.test(name) && !name.startsWith('plugin-')
}

/** 命令 / 事件名是否合规（插件名:动作） */
export function isQualifiedId(id: string): boolean {
  const parts = id.split(':')
  if (parts.length !== 2) return false
  const [owner, action] = parts as [string, string]
  if (!isPluginName(owner)) return false
  return ACTION.test(action)
}

/** 槽内条目 id 是否合规（owner/name，owner 为插件名或 host） */
export function isSlotItemId(id: string): boolean {
  const parts = id.split('/')
  if (parts.length !== 2) return false
  const [owner, name] = parts as [string, string]
  if (!isPluginName(owner) && owner !== 'host') return false
  return ITEM_NAME.test(name) && name !== 'host'
}

/** 槽名是否合规（点号分层，不含斜杠/空白） */
export function isSlotName(name: string): boolean {
  if (!name || name.includes('/') || /\s/.test(name)) return false
  return /^[a-z0-9][a-z0-9.-]*$/.test(name)
}

/** 从槽内条目 id 取 owner（诊断/校验用）；不合规返回 undefined */
export function ownerOfSlotItem(id: string): string | undefined {
  return isSlotItemId(id) ? id.split('/')[0] : undefined
}

/**
 * 开发期断言：不合规就 warn 一次（生产静默，不打断现有插件）。
 * @param seen 调用方持有的一份去重集合（避免热重载刷屏）
 */
export function warnIfBadId(
  kind: 'plugin' | 'command' | 'event' | 'slot-item' | 'slot',
  id: string,
  seen?: Set<string>,
): boolean {
  const ok =
    kind === 'plugin' ? isPluginName(id)
      : kind === 'slot-item' ? isSlotItemId(id)
        : kind === 'slot' ? isSlotName(id)
          : isQualifiedId(id)
  if (ok) return true
  const key = kind + ':' + id
  if (seen?.has(key)) return false
  seen?.add(key)
  if (typeof console !== 'undefined') {
    const rule =
      kind === 'plugin' ? '小写短横线、不带 plugin- 前缀（如 node-image）'
        : kind === 'slot-item' ? 'owner/name（如 agent/host；宿主为 host/xxx）'
          : kind === 'slot' ? '点号分层（如 shell.dock）'
            : '插件名:动作（如 node-image:upload）'
    console.warn('[naming] ' + kind + ' id 不合规："' + id + '"，应为 ' + rule)
  }
  return false
}
