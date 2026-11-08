/**
 * toolMeta —— 工具调用的**人话标题**与审批文案（纯函数，零 Vue，可单测）。
 *
 * 用户口径（2026-11-07）：工具行先给「这次在干什么」，具体命令 / 文件名放在后面；
 * 没有标题的工具（不认识的 MCP 工具）退回工具名，也要能正常显示。
 */
import { toolBrief } from './toolViews.js'

/** SDK / 内置工具名 → 人话动作。认不出时返回空串（调用方退回原始工具名）。 */
const ACTIONS: Record<string, string> = {
  exec_command: '执行命令',
  input_command: '执行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '编辑文件',
  list_dir: '浏览目录',
  list_files: '浏览目录',
  search_files: '搜索文件',
  web_search: '搜索网页',
  search: '搜索',
  fetch: '抓取网页',
  browser: '浏览网页',
  canvas_overview: '查看画布概览',
  canvas_get: '查看节点',
  canvas_list_canvases: '列出画布',
  canvas_add_media: '加入媒体',
  canvas_batch_nodes: '批量改节点',
  canvas_batch_edges: '批量改连线',
  resource_list: '列出资源',
  resource_upload: '上传资源',
  generation_create: '提交生成任务',
  generation_status: '查询生成任务',
  generation_actions: '查看生成动作',
}

/** 工具名去掉 MCP 前缀 */
export function bareToolName(name: string): string {
  return String(name || '').replace(/^mcp__[A-Za-z0-9_-]+__/, '')
}

/** 人话动作；认不出就返回空串 */
export function toolAction(name: string): string {
  return ACTIONS[bareToolName(name)] ?? ''
}

/**
 * 入参里的 `description`（工具作者写给「这次要干什么」的一句话）。
 *
 * 用户口径（2026-11-07）：这一句要显示在工具行标题上，不该埋在输入 JSON 里。
 * 只认非空字符串；读不到就返回空串（调用方再退回命令 / 文件名）。
 */
export function toolDescription(argsText: string | undefined): string {
  if (!argsText) return ''
  try {
    const a = JSON.parse(argsText) as Record<string, unknown>
    const d = a.description ?? a.prompt
    return typeof d === 'string' ? d.replace(/\s+/g, ' ').trim() : ''
  } catch {
    return ''
  }
}

/** 工具行标题：有人话动作就用它，没有就退回工具名（绝不拿输出当标题） */
export function toolTitleText(name: string): string {
  return toolAction(name) || bareToolName(name) || '工具调用'
}

/**
 * 工具行的**一句话标题**：动作 + 执行内容（照 AI Elements Tool 的「Ran git status」写法）。
 *
 * 为什么要合成一句（用户口径 2026-11-07）：把长命令放进 TraceDescription 时，
 * 它自带 shrink-0（本意是给「5s」这种短元数据），会把标题挤成「执…」，自己又横向溢出。
 * 合成进 Title 后，长度由 Title 的 truncate 统一管住。
 */
export function toolLineTitle(name: string, argsText: string | undefined): string {
  const action = toolTitleText(name)
  // 先看 description（人话），没有再退回命令 / 文件名
  const brief = toolDescription(argsText) || toolBrief(name, argsText)
  return brief ? action + ' ' + brief : action
}

/**
 * 命令执行行的标题：**不带动作前缀**（用户口径 2026-11-07）。
 *
 * 为什么：这一行的图标本身就是终端（>_），再写「执行命令」是重复信息。
 * 有 description 就用它（「执行 echo 输出颜色文字测试」），没有就用命令 / 文件名，
 * 两者都没有才退回动作名（否则这一行会空掉）。
 */
export function terminalLineTitle(name: string, argsText: string | undefined): string {
  const brief = toolDescription(argsText) || toolBrief(name, argsText)
  return brief || toolTitleText(name)
}

/**
 * 审批标题：能读出命令 / 文件名就说「运行 … / 读取 …」，
 * 读不出来就退回工具的人话名字 —— 不展示一坨 JSON。
 */
export function approvalTitle(name: string, argsText: string | undefined): string {
  const bare = bareToolName(name)
  const brief = toolBrief(name, argsText)
  if (bare === 'exec_command' || bare === 'input_command') {
    return brief ? '运行 ' + brief + '？' : '运行一条命令？'
  }
  if (bare === 'read_file' || bare === 'write_file' || bare === 'edit_file') {
    return brief ? (bare === 'read_file' ? '读取 ' : bare === 'write_file' ? '写入 ' : '修改 ') + brief + '？' : '操作一个文件？'
  }
  const action = toolAction(bare)
  return action ? action + '？' : '允许调用 ' + (bare || name || '工具') + '？'
}

/** 审批说明：一句人话，告诉用户点允许之后会发生什么 */
export function approvalDescription(name: string, argsText: string | undefined): string {
  const bare = bareToolName(name)
  const brief = toolBrief(name, argsText)
  if (bare === 'exec_command' || bare === 'input_command') {
    return brief ? '这条命令会在当前项目里执行。' : '会在当前项目里执行一条命令。'
  }
  if (bare === 'read_file') return '会读取这个文件的内容。'
  if (bare === 'write_file') return '会把内容写入这个文件。'
  if (bare === 'edit_file') return '会修改这个文件的内容。'
  return '这个工具会执行一次操作，完成后会在对话里留下结果。'
}
