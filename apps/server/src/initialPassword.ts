/**
 * 部署侧首次初始化：用环境变量预置登录密码。
 *
 * 为什么需要它：POST /api/auth/setup 只接受容器内回环请求（防「公网任何人抢先
 * 把密码设成自己的」，见 routes/auth.ts 与 static.ts 的 isLoopbackRequest）。
 * 但云平台（Railway / Render / VPS）部署时，部署者根本不在容器里 ——
 * 于是首次设置密码变成「装 CLI + 配 SSH + 进容器敲命令」，门槛过高。
 *
 * 环境变量只有**能进部署平台控制台的人**（即部署者本人）能设置，与「进容器」
 * 是同一信任级别；公网请求者碰不到它。所以用它替代 SSH 进容器是安全的。
 *
 * 边界：
 * - 只在**还没配置过密码**时生效（不覆盖现有密码，重启/改密码后不再受影响）；
 * - 仍走 authAccount.setup 的同一套校验（最短 5 位、加盐哈希落盘、明文不落盘）；
 * - 环境变量名固定 PLUME_INITIAL_PASSWORD。
 */
import { createAuthAccount, MIN_AUTH_TOKEN_LENGTH } from './authAccount.js'

export type InitialPasswordResult = 'applied' | 'exists' | 'skipped' | 'too-short'

/**
 * 若 <dataDir>/auth.json 还不存在、且给了非空密码，就完成一次首次设置。
 *
 * 调用时机：CLI 启动阶段（runBootstrap 之后、createCloudServer 之前），
 * 这样 createCloudServer 读到的 auth.json 已经是「已配置」状态。
 */
export async function applyInitialPassword(opts: {
  dataDir: string
  password: string | undefined
}): Promise<InitialPasswordResult> {
  const raw = (opts.password ?? '').trim()
  if (!raw) return 'skipped'

  /*
   * 太短就**不设置**并如实返回：静默截断/静默忽略都会让部署者以为「变量生效了」，
   * 打开页面还是设置面板，反而更难查。CLI 会把这条结果打印成一句警告。
   */
  if (raw.length < MIN_AUTH_TOKEN_LENGTH) return 'too-short'

  const account = await createAuthAccount({ dataDir: opts.dataDir })
  const result = await account.setup(raw)
  if (result === 'ok') return 'applied'
  if (result === 'exists') return 'exists'
  return 'too-short'
}
