/**
 * depsResolver —— 安装期依赖解析（发布体系 Task 3）。
 *
 * 输入：目标包名 + 本机 provides 映射 + npmClient（search/packument）。
 * 输出：DepPlan —— 递归解析后的安装顺序（提供者先于消费者）、缺依赖清单、环标记。
 *
 * 设计要点：
 * - 递归 DFS + visited 集合：A→B→A 不死循环，cycle=true 让调用方决定（拒绝或警告）。
 * - 本机已满足的依赖不再去找 npm（localProvides 映射 provides名 → 已装插件目录名）。
 * - optionalDependencies 缺了只进 optionalMissing，不拦安装。
 */

export interface NpmClientLike {
  packument(name: string): Promise<{
    name: string
    "dist-tags": { latest?: string }
    versions: Record<string, { version: string; tarball: string; plume?: Record<string, unknown> }>
    time: Record<string, string>
  }>
  search(q: string, size?: number): Promise<Array<{ name: string; description: string; version: string; date: string; links: object }>>
}

export interface DepPlan {
  /** 按序安装的包（提供者先于消费者；最后一个是目标自身） */
  installOrder: Array<{ pkg: string; version?: string }>
  /** 强依赖里找不到提供者的服务名 */
  missing: string[]
  /** 弱依赖里找不到提供者的服务名（不拦安装） */
  optionalMissing: string[]
  /** 检出依赖环 */
  cycle: boolean
}

/** 本机已装映射：provides 服务名 → 插件包名 */
export type LocalProvides = Map<string, string>

/** 从 packument 的 plume 段提取元数据 */
function metaOf(pk: { "dist-tags": { latest?: string }; versions: Record<string, { plume?: Record<string, unknown> }> }, version?: string) {
  const v = version ?? pk["dist-tags"].latest
  if (!v) return {}
  const plume = (pk.versions[v]?.plume ?? {}) as {
    provides?: string[]
    dependencies?: string[]
    optionalDependencies?: string[]
  }
  return plume
}

export async function resolveDeps(
  targetPkg: string,
  localProvides: LocalProvides,
  client: NpmClientLike,
): Promise<DepPlan> {
  const plan: DepPlan = { installOrder: [], missing: [], optionalMissing: [], cycle: false }
  const visited = new Set<string>()
  /** 已排进 installOrder 的（防同包重复排） */
  const ordered = new Set<string>()

  /** 在 npm 候选里找提供某个服务名的包（优先本机） */
  async function findProvider(svc: string): Promise<string | undefined> {
    const local = localProvides.get(svc)
    if (local) return local
    try {
      // 搜索词就是服务名：provides 声明了它的包会命中（search 按 npm 语义模糊匹配）
      const hits = await client.search(svc, 20)
      // 逐个查 packument 确认它真的 provides 这个名字（搜索可能误命中）
      for (const h of hits) {
        try {
          const pk = await client.packument(h.name)
          const meta = metaOf(pk)
          if ((meta.provides ?? []).includes(svc)) return h.name
        } catch { /* 候选坏了换下一个 */ }
      }
    } catch { /* 搜索失败 = 找不到 */ }
    return undefined
  }

  /** 递归解析一个包的依赖；返回是否遇到环 */
  async function visit(pkgName: string, chain: Set<string>): Promise<boolean> {
    if (ordered.has(pkgName)) return false
    if (chain.has(pkgName)) {
      plan.cycle = true
      return true
    }
    if (visited.has(pkgName)) return false
    visited.add(pkgName)
    chain.add(pkgName)

    let meta: { provides?: string[]; dependencies?: string[]; optionalDependencies?: string[] } = {}
    let version: string | undefined
    try {
      const pk = await client.packument(pkgName)
      version = pk["dist-tags"].latest
      meta = metaOf(pk, version)
    } catch {
      // 目标包本身查不到：调用方（doInstall）有自己的 404 处理，这里直接返回
      chain.delete(pkgName)
      return false
    }

    // 先解析强依赖（提供者排前面）
    for (const dep of meta.dependencies ?? []) {
      if (localProvides.has(dep)) continue
      const provider = await findProvider(dep)
      if (!provider) {
        plan.missing.push(dep)
        continue
      }
      await visit(provider, chain)
    }
    // 弱依赖：缺了只记不拦
    for (const dep of meta.optionalDependencies ?? []) {
      if (localProvides.has(dep)) continue
      const provider = await findProvider(dep)
      if (!provider) plan.optionalMissing.push(dep)
    }

    chain.delete(pkgName)
    if (!ordered.has(pkgName)) {
      ordered.add(pkgName)
      plan.installOrder.push({ pkg: pkgName, version })
    }
    return plan.cycle
  }

  await visit(targetPkg, new Set())
  // missing 里的名字去重
  plan.missing = [...new Set(plan.missing)]
  plan.optionalMissing = [...new Set(plan.optionalMissing)]
  return plan
}
