/**
 * ProviderRegistry —— 平台提供方的登记与查找。
 *
 * 三件事：
 * 1. 合出「全部动作」（喂给前端的菜单就是这个并集 —— 后台加平台，前端自动多一项）；
 * 2. 按 actionId 反查它属于哪个 provider（任务执行与取消都靠它路由）；
 * 3. 内容版本号（前端据此判断"要不要重拉菜单"，不必每次全量比对）。
 *
 * 纯逻辑、零 IO：目录扫描在 load.ts，这里只管装好之后怎么用。
 */
import type { ActionDef, Provider } from './types.js'

export class ProviderRegistry {
  /** providerId → provider */
  private readonly providers = new Map<string, Provider>()
  /** actionId → providerId（路由用） */
  private readonly actionOwner = new Map<string, string>()
  private version = 0

  /** 装一批 provider（重复 id 覆盖旧的） */
  load(providers: Provider[]): void {
    for (const p of providers) this.add(p)
  }

  add(provider: Provider): void {
    this.providers.set(provider.id, provider)
    for (const action of provider.actions) this.actionOwner.set(action.id, provider.id)
    this.version += 1
  }

  /** 清空重装（provider 目录变了时用：先清再装，避免删掉的 provider 还留着动作） */
  replaceAll(providers: Provider[]): void {
    this.providers.clear()
    this.actionOwner.clear()
    this.load(providers)
  }

  /** 全部动作（按 order 升序；没给 order 的排最后） */
  listActions(): ActionDef[] {
    const all: ActionDef[] = []
    for (const p of this.providers.values()) all.push(...p.actions)
    return all.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
  }

  /** 按动作 id 找动作（找不到 undefined） */
  getAction(actionId: string): ActionDef | undefined {
    const owner = this.actionOwner.get(actionId)
    if (!owner) return undefined
    return this.providers.get(owner)?.actions.find((a) => a.id === actionId)
  }

  /** 某个动作归哪个 provider（任务路由 / 取消 / 续查都用它） */
  providerOf(actionId: string): Provider | undefined {
    const owner = this.actionOwner.get(actionId)
    return owner ? this.providers.get(owner) : undefined
  }

  listProviders(): Provider[] {
    return [...this.providers.values()]
  }

  /** 内容版本号：每次装载 +1（前端据此判断要不要重拉菜单，省掉全量比对） */
  get contentVersion(): number {
    return this.version
  }
}
