import { defineConfig } from 'vitepress'

// ============================================================================
// 侧边栏（每个分类一棵树；同一棵树被该分类下所有 URL 前缀共享）。
// 规则：全部展开（collapsed: false）、名称 2~10 字、不换行。
// ============================================================================

const guideSidebar = [
  {
    text: '开始',
    collapsed: false,
    items: [
      { text: '这是什么', link: '/start/about' },
      { text: '本地环境', link: '/start/dev-setup' },
      { text: '★ 极简实战', link: '/start/quickstart-fullstack' },
    ],
  },
  {
    text: '核心概念',
    collapsed: false,
    items: [
      { text: '概念导览', link: '/intro/' },
      { text: '三层分工', link: '/intro/three-layers' },
      { text: '七个原语', link: '/intro/plugin-system' },
      { text: '注册场', link: '/intro/registries' },
      { text: '生命周期', link: '/intro/lifecycle' },
    ],
  },
  {
    text: '内核 kernel',
    collapsed: false,
    items: [
      { text: '内核总览', link: '/kernel/' },
      { text: '服务注入', link: '/kernel/services' },
      { text: '事件', link: '/kernel/events' },
      { text: '配置', link: '/kernel/config' },
      { text: '作用域', link: '/kernel/scope' },
      { text: 'Fiber', link: '/kernel/fiber' },
      { text: '依赖拓扑', link: '/kernel/topo' },
      { text: '能力层', link: '/kernel/capability-layer' },
      { text: '模型工具', link: '/kernel/model-tool' },
    ],
  },
  {
    text: '数据层 canvas-data',
    collapsed: false,
    items: [
      { text: '数据层总览', link: '/canvas-data/' },
      { text: '连接校验', link: '/canvas-data/connection' },
      { text: '节点类型', link: '/canvas-data/node-types' },
      { text: '存储适配', link: '/canvas-data/storage' },
    ],
  },
  {
    text: '渲染层 canvas-render',
    collapsed: false,
    items: [
      { text: '渲染层总览', link: '/canvas-render/' },
      { text: '创建宿主', link: '/canvas-render/create-host' },
      { text: '画布宿主', link: '/canvas-render/canvas-host' },
      { text: '渲染上下文', link: '/canvas-render/render-context' },
      { text: '设置与槽', link: '/canvas-render/settings-slot-host' },
      { text: 'VueFlow 桥', link: '/canvas-render/vueflow-bridge' },
      { text: 'Demo', link: '/canvas-render/demo' },
      { text: '交互状态', link: '/canvas-render/interaction-state' },
      { text: '层级 z-index', link: '/canvas-render/z-index' },
    ],
  },
  {
    text: '主题与配色',
    collapsed: false,
    items: [
      { text: '主题总览', link: '/theme/' },
      { text: '主题色板', link: '/theme/palette' },
    ],
  },
  {
    text: '后台 cloud-server',
    collapsed: false,
    items: [
      { text: '后台总览', link: '/cloud-server/' },
      { text: '快速上手', link: '/cloud-server/quickstart' },
      { text: '后台插件', link: '/cloud-server/server-plugins' },
      { text: 'routes 接口', link: '/cloud-server/capabilities-routes' },
      { text: 'store 存储', link: '/cloud-server/capabilities-store' },
      { text: 'jobs 定时', link: '/cloud-server/capabilities-jobs' },
      { text: 'mcp 工具', link: '/cloud-server/capabilities-mcp' },
      { text: 'agent 中间件', link: '/cloud-server/capabilities-agent' },
      { text: '热装热卸', link: '/cloud-server/hot-load' },
      { text: '内置服务', link: '/cloud-server/builtin-services' },
      { text: '桥接总览', link: '/cloud-server/bridge-overview' },
      { text: '样板精读', link: '/cloud-server/showcase-walkthrough' },
    ],
  },
]

const examplesSidebar = [
  {
    text: '示例',
    collapsed: false,
    items: [
      { text: '速查表', link: '/examples/recipe-map' },
      { text: '1 · 最小节点', link: '/examples/first-node' },
      { text: '2 · 叠加 UI', link: '/examples/ui-slot' },
      { text: '3 · 命令快捷键', link: '/examples/command-shortcut' },
      { text: '4 · 配置面板', link: '/examples/config-panel' },
      { text: '5 · 提供服务', link: '/examples/provide-service' },
      { text: '6 · 生成工具', link: '/examples/register-tool' },
      { text: '7 · 底栏动作', link: '/examples/bottom-bar' },
      { text: '8 · 浏览器事件', link: '/examples/file-drop' },
    ],
  },
]

const pluginsSidebar = [
  {
    text: '插件',
    collapsed: false,
    items: [
      { text: '插件总览', link: '/plugins/' },
      { text: '活快照', link: '/plugins/live' },
      { text: '默认主题', link: '/plugins/theme-default' },
      { text: '渲染宿主', link: '/plugins/canvas-render' },
      { text: 'Agent 插件', link: '/cloud-server/bridge-agent' },
      { text: 'Cloud 客户端', link: '/cloud-server/bridge-cloud-client' },
    ],
  },
]

const apiSidebar = [
  {
    text: 'API 参考',
    collapsed: false,
    items: [
      { text: 'API 总览', link: '/api/' },
      { text: '上下文 ctx', link: '/api/ctx' },
      { text: '注册场', link: '/api/registry' },
      { text: '自省 surface', link: '/core/self-inspect' },
    ],
  },
  {
    text: '前端服务',
    collapsed: false,
    items: [
      { text: 'doc', link: '/services/doc' },
      { text: 'save', link: '/services/save' },
      { text: 'selection', link: '/services/selection' },
      { text: 'command', link: '/services/command' },
      { text: 'slots', link: '/services/slots' },
      { text: 'settings', link: '/services/settings' },
      { text: 'resources', link: '/services/resources' },
      { text: 'nodeRegistry', link: '/services/node-registry' },
      { text: 'themeRegistry', link: '/services/theme-registry' },
      { text: 'nodeFactory', link: '/services/node-factory' },
      { text: 'settingsPersist', link: '/services/settings-persist' },
      { text: 'nodeLayout', link: '/services/node-layout' },
      { text: 'viewport', link: '/services/viewport' },
      { text: 'pluginManager', link: '/services/plugin-manager' },
      { text: 'tools', link: '/services/tools' },
      { text: '前端清单', link: '/core/' },
    ],
  },
  {
    text: '后端 cloud-server',
    collapsed: false,
    items: [
      { text: '后端总览', link: '/api/server' },
      { text: 'routes 接口', link: '/api/server-routes' },
      { text: 'store 存储', link: '/api/server-store' },
      { text: 'jobs 定时', link: '/api/server-jobs' },
      { text: 'mcp 工具', link: '/api/server-mcp' },
      { text: 'agent 中间件', link: '/api/server-agent' },
    ],
  },
]

// ============================================================================
export default defineConfig({
  lang: 'zh-CN',
  title: 'mini-canvas',
  description: 'mini-canvas 插件系统文档：入门 · 示例 · 插件 · API 参考',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    outline: { level: [2, 3], label: '本页目录' },
    // 右上角：四个平级分类，无下拉；每个分类的侧边栏是一棵完整树（全部展开）
    nav: [
      { text: '入门', link: '/start/', activeMatch: '/start/' },
      { text: '示例', link: '/examples/', activeMatch: '/examples/' },
      { text: '插件', link: '/plugins/', activeMatch: '/plugins/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
    ],
    // 同一棵树对象被多个前缀共享 → 分类内任何页面左侧都显示整棵树
    sidebar: {
      '/start/': guideSidebar,
      '/intro/': guideSidebar,
      '/kernel/': guideSidebar,
      '/canvas-data/': guideSidebar,
      '/canvas-render/': guideSidebar,
      '/theme/': guideSidebar,
      '/cloud-server/': guideSidebar,
      '/examples/': examplesSidebar,
      '/plugins/': pluginsSidebar,
      '/api/': apiSidebar,
      '/services/': apiSidebar,
      '/core/': apiSidebar,
    },
    search: { provider: 'local' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    outlineTitle: '本页目录',
    lastUpdatedText: '最后更新',
  },
})
