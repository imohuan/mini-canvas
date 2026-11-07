/**
 * commandEncoding —— 让 Agent 跑的每条命令都用 UTF-8 说话。
 *
 * 为什么需要这一层（2026-11-07 实测定因）：
 * SDK（penguin-core 0.2.13）起命令子进程时是
 * `spawn(shell, args, { stdio: 'pipe', windowsHide: true })` + `stdout.setEncoding('utf8')`。
 * Windows 上 `windowsHide: true` 会让控制台继承系统代码页（中文机器上是 936/GBK），
 * 于是 PowerShell 说 GBK、SDK 按 UTF-8 读，中文全变成 `�`。
 * 复现：同一条 `echo "测试"`，加 windowsHide 是 GBK，不加才是 UTF-8。
 *
 * 修法只用 SDK 自己的接缝（createAgent 的 controlEnv / confineSpawn）：
 * 1. PowerShell：在命令行前面加一段「把输入/输出编码都切成 UTF-8」的语句，
 *    并用 `& { ... }` 包住用户命令 —— 这样 `param()` 开头的脚本、多行脚本、退出码都不受影响；
 * 2. cmd：包一层 `chcp 65001`（cmd 自己不吃 Console.OutputEncoding）；
 * 3. 环境变量：PYTHONUTF8 / PYTHONIOENCODING，让 Python 子进程也按 UTF-8 输出。
 *
 * 不进 node_modules：SDK 一升级就被覆盖，而且测试也没法盯住它。
 * 子 Agent（run_subagent）继承同一组 getter，所以重装 / 多开的 Agent 都一样生效。
 */

/** PowerShell 前缀：输出、输入（input_command 往 stdin 写中文）都切成 UTF-8。 */
export const POWERSHELL_UTF8_PREFIX =
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
  '$OutputEncoding=[Text.Encoding]::UTF8; ' +
  '[Console]::InputEncoding=[Text.Encoding]::UTF8; ' +
  "$env:PYTHONUTF8='1'; $env:PYTHONIOENCODING='utf-8'; "

/** cmd 前缀：把本进程代码页切到 65001；`>nul` 免得这行提示混进命令输出。 */
export const CMD_UTF8_PREFIX = 'chcp 65001>nul & '

/** 给 Python 子进程的兜底：就算它不走 PowerShell（例如 bash 里直接跑），也按 UTF-8 输出。 */
export const PYTHON_UTF8_ENV: Record<string, string> = {
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
}

/** 从可执行文件路径认出 shell 名（`C:\...\pwsh.exe` → `pwsh`）。 */
export function shellNameOf(command: string): string {
  const base = command.replace(/\\/g, '/').split('/').pop() ?? ''
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

/**
 * 把一条 shell 命令包成"UTF-8 版"。
 *
 * 只认三种情况，其它 shell（bash / sh / zsh …）原样返回：它们本来就按 UTF-8 说话。
 * 命令本身已经手工切过编码时原样返回（幂等，避免前缀叠两层）。
 */
export function withUtf8Command(shellName: string, cmd: string): string {
  if (shellName === 'pwsh' || shellName === 'powershell') {
    if (cmd.includes('[Console]::OutputEncoding=[Text.Encoding]::UTF8')) return cmd
    // & { } 而不是直接拼：直接拼会把 param() 变成第二条语句，脚本直接报错。
    return POWERSHELL_UTF8_PREFIX + '& {\n' + cmd + '\n}'
  }
  if (shellName === 'cmd') {
    if (/^\s*chcp\s+65001/i.test(cmd)) return cmd
    return CMD_UTF8_PREFIX + cmd
  }
  return cmd
}

/**
 * 造一个 SDK confineSpawn 用的改写器：收到 SDK 即将 spawn 的 argv
 * （`[shell, ...shellArgs, cmd]`），只改最后那一段命令，不碰 shell 与参数。
 *
 * 为什么不换 shell：换 shell 会改掉模型的命令语法（bash vs PowerShell），
 * 提示词里的 `Shell:` 行也会跟着变；而这里只修编码，行为面最小。
 */
export function utf8SpawnConfiner(): (argv: readonly string[]) => readonly string[] {
  return (argv) => {
    if (argv.length === 0) return argv
    const last = argv.length - 1
    const cmd = argv[last]
    if (typeof cmd !== 'string') return argv
    const next = withUtf8Command(shellNameOf(argv[0] ?? ''), cmd)
    if (next === cmd) return argv
    return [...argv.slice(0, last), next]
  }
}
