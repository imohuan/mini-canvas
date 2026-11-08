/**
 * toolFailure —— 工具输出里的失败信息（纯函数，零 Vue，可单测）。
 *
 * 为什么要单独解析：AI Elements 的 Terminal / Stack Trace 都靠「退出码 / 错误消息」
 * 决定标题与状态。把这一步放在纯函数里，界面只负责按官方结构画。
 */

export interface ToolFailure {
  failed: boolean
  /** 一行错误摘要（给标题用） */
  message?: string
  /** 堆栈帧（以 at / File " 开头的行）；没有就是空数组 */
  frames: string[]
}

/** 这些字样出现在第一行 = 命令 / 工具失败的常见形态 */
/** 常见失败前缀；TypeError / RangeError 这类「XxxError:」也要认 */
const FAIL_RE = /^(error|fatal|exception|traceback|eperm|enoent|eacces|epipe|command failed|failed|错误|失败)\b|^[A-Za-z]*Error\s*:/i

function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
}

/** 从输出里抠出「退出码非 0」/「is_error」这类信号 */
function detect(text: string): { failed: boolean; message?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { failed: false }

  // JSON 形态（画布 MCP 工具都是 toText({...})）
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>
      const isError = data.is_error === true || data.isError === true || data.ok === false || data.success === false
      const err = data.error ?? data.message ?? data.error_message
      const errText = typeof err === 'string' ? err.trim() : ''
      if (isError || (errText && data.ok === false)) {
        const code = data.exitCode ?? data.exit_code ?? data.code
        const msg = errText || (typeof code === 'number' && code !== 0 ? '退出码 ' + code : '工具执行失败')
        return { failed: true, message: msg.split('\n')[0] }
      }
      return { failed: false }
    } catch {
      // 不是 JSON：继续按文本判
    }
  }

  // 「xxx exited with code 1」（Terminal 文档里的标题来源）
  const exit = /exited with code (\d+)/i.exec(trimmed)
  if (exit && exit[1] !== '0') return { failed: true, message: '退出码 ' + exit[1] }

  const line = firstLine(trimmed)
  if (FAIL_RE.test(line)) return { failed: true, message: line }

  return { failed: false }
}

/**
 * 解析工具输出。
 *
 * 帧只收 at ... / File "..." 这种真正的调用栈行：普通输出里的缩进行不往
 * Stack Trace 里塞，否则错误面板会变成一坨日志。
 */
export function parseToolFailure(output: string | undefined): ToolFailure {
  if (!output) return { failed: false, frames: [] }
  const result = detect(output)
  if (!result.failed) return { failed: false, frames: [] }
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  const frames = lines.filter((l) => /^at\s/.test(l) || /^File ".*", line \d+/.test(l))
  return { failed: true, message: result.message, frames }
}

/** 终端类工具（命令执行）—— 用 Terminal 结构展示 */
export function isTerminalTool(name: string): boolean {
  const bare = String(name || '').replace(/^mcp__[A-Za-z0-9_-]+__/, '')
  return bare === 'exec_command' || bare === 'input_command' || bare === 'shell' || bare === 'run_command'
}

/** 从工具入参里取命令（Terminal 标题要写「Ran <命令>」） */
export function commandOf(argsText: string | undefined): string {
  if (!argsText) return ''
  try {
    const a = JSON.parse(argsText) as Record<string, unknown>
    const cmd = a.cmd ?? a.command ?? a.input
    return typeof cmd === 'string' ? cmd.replace(/\s+/g, ' ').trim() : ''
  } catch {
    return ''
  }
}
