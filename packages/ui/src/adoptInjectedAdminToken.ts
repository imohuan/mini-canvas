/**
 * 托管版后台会把管理令牌注进页面（`window.__MC_ADMIN_TOKEN__`）。
 *
 * 为什么在这里接：令牌是全站写入口的凭证，插件（cloud-client / 节点宿主代发 /
 * 插件管理）都从 localStorage 的同一个键读它。在挂载**之前**写进去，
 * 任何插件第一次发请求就已经带上了 —— 用户不必先去「设置 → 插件」抄一遍。
 *
 * 只有本机访问才注（服务端判 Host，见 cloud-server 的 uiRoutes）；远程访问时
 * 这个变量不存在，行为与以前一致。写完立刻删掉，避免留在全局被页面脚本读到。
 *
 * 手填优先：本地已有、且不是上一轮注入写进去的值时，不覆盖 —— 用户可能同时在用
 * 另一套后台（换端口 / 换目录）并手填过那套的令牌，静默替换会让另一套后台的
 * 写请求 403，而且用户看不出为什么。
 *
 * `mc_admin_token_injected` 记着上一轮注入写的是什么：本地与它一致 → 用户没改过，
 * 本轮注入的新值覆盖（后台轮换令牌也能跟上）；本地是别的值 → 手填过，不碰。
 */
export function adoptInjectedAdminToken(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const holder = window as unknown as { __MC_ADMIN_TOKEN__?: unknown }
  try {
    const injected = holder.__MC_ADMIN_TOKEN__
    const existing = storage.getItem('mc_admin_token')
    if (typeof injected === 'string' && injected.trim()) {
      const previousInjection = storage.getItem('mc_admin_token_injected')
      const handFilled = existing !== null && existing !== previousInjection
      if (!handFilled) {
        storage.setItem('mc_admin_token', injected.trim())
        storage.setItem('mc_admin_token_injected', injected.trim())
      }
    }
  } catch {
    /* 存储被禁：照常启动，写请求会 403（提示里会说去哪填） */
  }
  try {
    delete holder.__MC_ADMIN_TOKEN__
  } catch {
    /* 冻结核：删不掉也不影响功能 */
  }
}
