/**
 * agentCommands —— 本插件的**命令 id**（唯一一份名字）。
 *
 * 为什么要单独一个文件（而不是把常量放 agentPlugin.ts）：命令的注册处（agentPlugin）
 * 与**按下它的地方**（节点顶栏的 AgentRefToolbar 组件）都要引用同一个 id ——
 * 放 agentPlugin.ts 会让两者互相 import 成环，而 ESM 循环里组件读到的常量
 * 可能还没求值（TDZ 报错）。抽出来之后两边都只依赖这份常量，改名字时一起变、不可能写岔。
 *
 * 与 refClickEvents.ts 同一套做法（"这条东西的名字 + 载荷只定义一份"）。
 */

/**
 * 「引用到 Agent」：把一个节点引用进 Agent 输入框。
 *
 * 两个入口共用这一条命令（效果逐字一致，实现只有一份）：
 * - 节点右键菜单（areas:['node'] 让 context-menu 插件自动把它收进菜单）；
 * - 节点上控制栏的按钮（AgentRefToolbar 按 id 执行它）。
 */
export const AGENT_REFERENCE_COMMAND_ID = 'agent:reference-node'
