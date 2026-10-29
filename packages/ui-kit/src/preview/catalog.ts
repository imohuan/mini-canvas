/** 预览页的组件目录。文档文件名与 id 一一对应：docs/<id>.md。 */
export interface CatalogItem {
  id: string
  name: string
  label: string
  description: string
}

export interface CatalogGroup {
  id: string
  title: string
  items: CatalogItem[]
}

export const CATALOG: CatalogGroup[] = [
  {
    id: 'foundation',
    title: '基础与配置',
    items: [
      { id: 'provider', name: 'UiKitProvider', label: '全局参数', description: '尺寸、密度、主题色' },
      { id: 'button', name: 'Button', label: '按钮', description: '触发一个动作' },
      { id: 'button-group', name: 'ButtonGroup', label: '按钮组', description: '并排或贴合的按钮' },
    ],
  },
  {
    id: 'form',
    title: '表单',
    items: [
      { id: 'input', name: 'Input', label: '输入框', description: '输入一行文字' },
      { id: 'number', name: 'NumberInput', label: '数字输入', description: '范围、步进、精度' },
      { id: 'slider', name: 'Slider', label: '滑块', description: '拖动选择一个数' },
      { id: 'switch', name: 'Switch', label: '开关', description: '打开或关闭一个设置' },
      { id: 'select', name: 'Select', label: '选择器', description: '从列表里选一项' },
    ],
  },
  {
    id: 'navigation',
    title: '导航与浮层',
    items: [
      { id: 'tabs', name: 'Tabs', label: '选项卡', description: '平级内容切换' },
      { id: 'dropdown', name: 'Dropdown', label: '下拉容器', description: '触发器 + 任意浮层' },
      { id: 'popover', name: 'Popover', label: '气泡卡片', description: '带标题的内容浮层' },
      { id: 'tooltip', name: 'Tooltip', label: '文字提示', description: '悬停说明' },
      { id: 'context-menu', name: 'ContextMenu', label: '右键菜单', description: '分组、子菜单、快捷键' },
    ],
  },
  {
    id: 'feedback',
    title: '反馈',
    items: [
      { id: 'dialog', name: 'Dialog', label: '对话框', description: '承载表单和长内容' },
      { id: 'confirm', name: 'Confirm', label: '确认框', description: '危险操作前问一句' },
      { id: 'notify', name: 'Notify', label: '通知', description: '右上角可关闭消息' },
      { id: 'messages', name: 'Messages', label: '轻提示', description: '顶部短暂反馈' },
    ],
  },
  {
    id: 'layout',
    title: '布局',
    items: [
      { id: 'split-pane', name: 'SplitPane', label: '分割面板', description: '拖动两栏的大小' },
    ],
  },
]

export const CATALOG_TOTAL = CATALOG.reduce((sum, group) => sum + group.items.length, 0)

export function findCatalogItem(id: string): CatalogItem | undefined {
  for (const group of CATALOG) {
    const found = group.items.find((item) => item.id === id)
    if (found) return found
  }
  return undefined
}
