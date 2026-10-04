/**
 * chat-auto 模式的提示词前缀 —— 把媒体参数拼成一段指令。
 *
 * 为什么需要：走 UI 自动化的平台（豆包 / dola 的 chat-auto）**不支持单独的参数**，
 * 比例、时长这类只能写成一句话加在提示词前面。所以我们把它们拼成前缀。
 *
 * 纯函数、零依赖 —— 与前端那份同源（plugin-web2api-tools 的 chatAutoPrompt）。
 */

export interface ChatAutoOptions {
  mode: 'image' | 'video'
  /** 平台侧模型名（如 Seedream 4.5）；不给就不写模型这句 */
  model?: unknown
  ratio?: unknown
  durationSec?: unknown
  style?: unknown
}

export function buildChatAutoPrompt(opts: ChatAutoOptions, prompt: string): string {
  const parts: string[] = []
  if (opts.mode === 'video') {
    parts.push('/video')
    if (typeof opts.model === 'string' && opts.model) parts.push(opts.model)
    if (opts.ratio !== undefined && opts.ratio !== '') parts.push(String(opts.ratio))
    if (opts.durationSec !== undefined && opts.durationSec !== '') parts.push(String(opts.durationSec) + 's')
  } else {
    parts.push('/image')
    if (typeof opts.model === 'string' && opts.model) parts.push(opts.model)
    if (opts.ratio !== undefined && opts.ratio !== '') parts.push(String(opts.ratio))
    if (opts.style !== undefined && opts.style !== '') parts.push(String(opts.style))
  }
  const head = parts.join(' ')
  return prompt ? head + '\n' + prompt : head
}
