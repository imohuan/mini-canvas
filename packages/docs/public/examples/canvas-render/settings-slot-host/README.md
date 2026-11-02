# plugin-panel-demo

跟着 [SettingsHost / SlotHost](/canvas-render/settings-slot-host) 那篇写的示例插件：一个插件同时用三处槽位 ——

| 文件 | 挂的槽 | 作用 |
| --- | --- | --- |
| `src/DemoOverlay.vue` | `overlay` | 画布右上角的缩放角标 |
| `src/index.ts` | `ctx.settingsMenu` | 声明「个人 → 我的演示」菜单项与二级小节 |
| `src/DemoSettingsPage.vue` | `settingsGroup/我的演示` | 该设置页的正文（读写 `demoText`） |

装配后打开设置面板，应能在左导航看到「我的演示」，点进去能改 `demoText`；卸载插件后角标与设置页同时消失。
