/**
 * 读取 useAgentConversation 及其拆分出来的 composable 源码。
 *
 * 这些测试是源码契约守卫，不执行组件。只改「从哪里读」：
 * 拆分前只有 useAgentConversation.ts，拆分后同一段代码可能在同目录的
 * useAgent*.ts 里。按固定顺序拼接，保证断言看到的仍是完整的控制器源码。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONVERSATION_DIR = path.resolve(HERE, '../components/agent-conversation')
const FILES = [
  'useAgentConversation.ts',
  'useAgentAttachments.ts',
  'useAgentEarlierTurns.ts',
  'useAgentEditing.ts',
  'useAgentMcpPanel.ts',
  'useAgentMenus.ts',
  'useAgentMessageEditing.ts',
  'useAgentMessageViews.ts',
  'useAgentNotify.ts',
  'useAgentResources.ts',
  'editorTypes.ts',
]

export function readAgentConversationSource(): string {
  return FILES.map((name) => readFileSync(path.join(CONVERSATION_DIR, name), 'utf8')).join('\n')
}

