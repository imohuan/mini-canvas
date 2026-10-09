import { defineConfig } from 'vitepress'

/**
 * mini-canvas 文档站配置。
 *
 * 站点根目录就是本包（packages/docs），MD 文件直接放在这里当页面。
 * 几个文档专用组件由 .vitepress/theme 注册，MD 里可直接用，不用 import：
 *   · <PluginCapabilityTable/> —— 按插件声明列出功能（数据来自 plugins.data.ts）
 *   · <SurfaceReport/>         —— 活快照：读运行中画布的 ctx.surface()
 *   · <ComponentPreview/>      —— 在文档页面里直接跑一个真实 Vue 组件
 */
export default defineConfig({
  lang: 'zh-CN',
  title: 'mini-canvas',
  description: 'mini-canvas 插件系统文档：三根轴、七个原语、注册场，以及看得见的活快照',
  cleanUrls: true,
  lastUpdated: true,


  themeConfig: {
    outline: { level: [2, 3], label: '本页目录' },

    nav: [
      { text: '项目介绍', link: '/intro/' },
      { text: '核心 API', link: '/core/' },
      { text: '插件', link: '/plugins/' },
      { text: '活快照', link: '/plugins/live' },
    ],

    sidebar: {
      '/intro/': [
        {
          text: '项目介绍',
          items: [
            { text: '这个项目是什么', link: '/intro/' },
            { text: '三层是怎么分工的', link: '/intro/three-layers' },
            { text: '插件系统：七个原语', link: '/intro/plugin-system' },
            { text: '注册场：加功能不用加服务', link: '/intro/registries' },
            { text: '注册场演示（能动）', link: '/intro/registry-playground' },
            { text: '插件的生命周期', link: '/intro/lifecycle' },
          ],
        },
      ],
      '/core/': [
        {
          text: '核心 API',
          items: [
            { text: '总览', link: '/core/' },
            { text: '自省：看清装了什么', link: '/core/self-inspect' },
          ],
        },
      ],
      '/plugins/': [
        {
          text: '插件',
          items: [
            { text: '插件总览', link: '/plugins/' },
            { text: '活快照（这台画布）', link: '/plugins/live' },
            { text: '核心插件 · 默认主题', link: '/plugins/theme-default' },
            { text: '核心插件 · 渲染宿主', link: '/plugins/canvas-render' },
          ],
        },
      ],
    },

    search: { provider: 'local' },

    // 中文界面
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
