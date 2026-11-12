/**
 * 托管版后台会把管理令牌注进页面（`window.__PLUME_ADMIN_TOKEN__`）。
 *
 * 2026-11-12 起，登录改由 cloud-client 负责：用户设置自己的令牌，后台发 HttpOnly
 * 会话 cookie。页面里注入的这份**只给老后台兜底**（旧版没有 /api/auth/*），
 * 并且只暂存在 sessionStorage（关掉标签页就没了），不再往 localStorage 写长期明文。
 *
 * 只有本机访问才注（服务端判 TCP 对端 + Host + 无转发头，见 cloud-server 的 uiRoutes）；
 * 远程访问时这个变量不存在。读完立刻删掉，避免留在全局被页面脚本读到。
 */
export function adoptInjectedAdminToken(): void {
  const holder = window as unknown as { __PLUME_ADMIN_TOKEN__?: unknown }
  try {
    const injected = holder.__PLUME_ADMIN_TOKEN__
    if (typeof injected === 'string' && injected.trim()) {
      /*
       * 2026-11-12：不再往 localStorage 写明文令牌。
       *
       * 登录改由 cloud-client 设置自定义令牌、后台发 HttpOnly 会话 cookie；
       * 页面里注入的这份只作为**老后台的兼容通道**（旧版本没有 /api/auth/*），
       * 由 downshift 到请求头时使用。所以这里只把注入值暂存到 sessionStorage
       * （生命周期短、不跨标签页持久），绝不留成长期明文。
       */
      try {
        sessionStorage.setItem('plume_admin_token_legacy', injected.trim())
      } catch {
        /* 存储被禁：跳过；老后台的写请求会 403，提示去登录 */
      }
    }
  } catch {
    /* 存储被禁：照常启动，写请求会 403（提示里会说去哪填） */
  }
  try {
    delete holder.__PLUME_ADMIN_TOKEN__
  } catch {
    /* 冻结核：删不掉也不影响功能 */
  }
}
