import { defineConfig } from 'vitepress'

/**
 * mini-canvas 文档站配置。
 *
 * 站点根目录就是本包（packages/docs），MD 文件直接放在这里当页面。
 * 两个核心能力由 .vitepress/theme 提供，MD 里可直接使用，不用 import：
 *   · <PluginCapabilityTable/> —— 自动列出插件注册了哪些功能（数据来自 plugins.data.ts）
 *   · <ComponentPreview/>      —— 在文档页面里直接跑一个真实 Vue 组件
 */
export default defineConfig({
  lang: 'zh-CN',
  title: 'mini-canvas',
  description: 'mini-canvas 文档：插件功能展示 + 组件在线预览',
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    outline: { level: [2, 3], label: '本页目录' },

    nav: [
      { text: '指南', link: '/guide/' },
      { text: '插件功能', link: '/plugins/' },
      { text: '组件预览', link: '/preview/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '总览', link: '/guide/' },
            { text: '怎么写文档', link: '/guide/writing-docs' },
            { text: '怎么预览组件', link: '/guide/component-preview' },
          ],
        },
      ],
      '/plugins/': [
        {
          text: '插件功能',
          items: [
            { text: '全部插件', link: '/plugins/' },
            { text: '运行时能力', link: '/plugins/runtime-capabilities' },
          ],
        },
      ],
      '/preview/': [
        {
          text: '组件预览',
          items: [{ text: '预览台', link: '/preview/' }],
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
