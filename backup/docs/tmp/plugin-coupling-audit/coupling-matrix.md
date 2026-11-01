# 插件耦合总表

> 共 36 个插件目录。评分只看“为了做对需要知道多少别人的内部约定”，不是代码质量总分。成品壳的 4 个接缝文件另见 `plugins/ui-host-adapters.md`。

## 怎么读

- **L3 硬耦合**：源码直接 import 另一个插件的实现，或写死对方的节点类型/字段/类名，换实现会静默坏。
- **L2 契约耦合**：按服务名、注册场、命令 id、设置键协作；有公开入口就算正常，没有公开类型/回收约定就要收口。
- **L1 宿主粘连**：依赖 VueFlow DOM、`window`/`document`、固定 HTTP 路径、固定存储键。
- **风险**：高 = 已有明确坏点或单装会断；中 = 能跑但契约靠字符串；低 = 主要是职责大小问题。

## 总表

| 插件 | 身份 | 源码/测试 | 风险 | 最该先处理的一件事 | 详情 |
|---|---|---:|---|---|---|
| plugin-theme-default | builtin | 40/29 | 中 | UI 目录名、`.v2-card`、设置面板三件事都在一个包里，先收口名字与面板边界 | [详情](plugins/plugin-theme-default.md) |
| plugin-bottom-bar | builtin | 21/14 | **高** | 动作注册糖被节点包直接 import；先搬到公开契约包 | [详情](plugins/plugin-bottom-bar.md) |
| plugin-node-text | builtin | 10/6 | **高** | 直接 import 底栏注册糖；`ctx.doc` 与 `ctx.get('doc')` 混用 | [详情](plugins/plugin-node-text.md) |
| plugin-node-image | builtin | 21/12 | **高** | 直接 import 底栏；`ImageGeneratePanel.vue` 是已迁移死文件 | [详情](plugins/plugin-node-image.md) |
| plugin-node-video | builtin | 22/8 | **高** | 截图写死 `image` 类型与图片字段；有两套媒体预览总线 | [详情](plugins/plugin-node-video.md) |
| plugin-node-audio | builtin | 14/10 | 中 | 本身干净；播放器偏大，`ui` 目录名缺契约测试 | [详情](plugins/plugin-node-audio.md) |
| plugin-node-3d-preview | builtin | 9/8 | 中 | 贴图依赖图片节点 `data.imageUrl`；上游取图逻辑重复 | [详情](plugins/plugin-node-3d-preview.md) |
| plugin-node-image-compare | installable | 6/5 | 中 | 服务面与图片字段契约需核对 | [详情](plugins/plugin-node-image-compare.md) |
| plugin-node-ui | builtin | 36/27 | **高** | 前后台同包、后台生命周期独立；还声明了未使用的底栏依赖 | [详情](plugins/plugin-node-ui.md) |
| plugin-agent | builtin | 38/38 | 中 | 设置页导航/正文靠同名 id；与 cloud-client 各有一套后台地址与画布 id 解析 | [详情](plugins/plugin-agent.md) |
| plugin-cloud-client | installable | 19/13 | 中 | 固定 API/SSE 路径；`cloudClientBaseUrl` 被多个插件私有读取 | [详情](plugins/plugin-cloud-client.md) |
| plugin-context-menu | builtin | 11/6 | 中 | 连线菜单被做成真节点；手动挂 body 的浮层需主题验证 | [详情](plugins/plugin-context-menu.md) |
| plugin-file-drop | builtin | 4/3 | 中 | 资源库形状与节点字段靠窄接口/字符串约定 | [详情](plugins/plugin-file-drop.md) |
| plugin-edge-cutting | builtin | 7/3 | 中 | 8 个全局捕获监听 + 直接读 `.vue-flow`/边 DOM | [详情](plugins/plugin-edge-cutting.md) |
| plugin-manager | builtin | 9/4 | **高** | 宿主安装句柄未类型化；UMD 全局扫描与两套插件清单 | [详情](plugins/plugin-manager.md) |
| plugin-hot-reload | 内部件 | 3/1 | 中 | `window.MiniCanvasHotReload` 与 `MiniCanvasPlugin.reload` 全局契约 | [详情](plugins/plugin-hot-reload.md) |
| plugin-hot-reload-demo | installable | 3/1 | 低 | 职责单一；补热重载整链测试 | [详情](plugins/plugin-hot-reload-demo.md) |
| plugin-cursor-effect | installable | 11/3 | 中 | document 捕获监听与全局光标 CSS 的恢复 | [详情](plugins/plugin-cursor-effect.md) |
| plugin-align-arrange | installable | 5/3 | 低 | 设置分组与 auto-layout 共用；Ctrl+方向键可能吞键 | [详情](plugins/plugin-align-arrange.md) |
| plugin-align-guide | installable | 7/3 | 低 | 与多选共享选中数语义；DOM 选择器需收口 | [详情](plugins/plugin-align-guide.md) |
| plugin-auto-layout | installable | 9/6 | 中 | 直接认识 `group` 类型与层级；需共享 group 契约 | [详情](plugins/plugin-auto-layout.md) |
| plugin-auto-save | 环境选装 | 3/2 | 低 | flush 失败会丢脏位；interval 写死 | [详情](plugins/plugin-auto-save.md) |
| plugin-canvas-export | installable | 4/2 | 中 | 依赖渲染 DOM 导出，需核对选择器契约 | [详情](plugins/plugin-canvas-export.md) |
| plugin-clipboard | builtin | 4/2 | 中 | 与 file-drop 的粘贴 order 是魔法数字，注释已漂移 | [详情](plugins/plugin-clipboard.md) |
| plugin-group | builtin | 7/4 | 中 | 本地复制拖拽事件名；group 类型/命令 id 被多处写死 | [详情](plugins/plugin-group.md) |
| plugin-history | 环境选装 | 2/1 | 低 | 与宿主撤销命令职责重叠，建议合并/删除 | [详情](plugins/plugin-history.md) |
| plugin-mini-map | installable | 6/2 | 低 | 视口/DOM 读取服务化 | [详情](plugins/plugin-mini-map.md) |
| plugin-multi-select | builtin | 14/9 | **高** | 直接读主题端口类名与 VueFlow DOM；SelectionFrame 职责过载 | [详情](plugins/plugin-multi-select.md) |
| plugin-node-find | installable | 5/1 | 低 | 命令与搜索面板；核对节点标题字段 | [详情](plugins/plugin-node-find.md) |
| plugin-shortcut-manager | 内部件 | 10/4 | 中 | 命令表/设置键的全局命名；两套快捷键引擎 | [详情](plugins/plugin-shortcut-manager.md) |
| plugin-showcase | NPM 安装 | 8/2 | 中 | 设置导航 id 与 Config 分组绑死；地址解析重复 | [详情](plugins/plugin-showcase.md) |
| plugin-style-library | installable | 12/2 | 中 | 前后端路由各写一份；`cloudClientBaseUrl` 暗契约 | [详情](plugins/plugin-style-library.md) |
| plugin-theme-gallery | installable | 4/1 | 中 | 把默认主题变成硬依赖；嵌套 CanvasHost 的隔离未验证 | [详情](plugins/plugin-theme-gallery.md) |
| plugin-tool-image-generation | installable | 4/2 | 中 | 与文本工具重复 HTTP 适配；默认端口写死 | [详情](plugins/plugin-tool-image-generation.md) |
| plugin-tool-text-generation | installable | 5/1 | 中 | 与图片工具重复适配；生命周期测试偏少 | [详情](plugins/plugin-tool-text-generation.md) |
| plugin-web2api-tools | installable | 9/4 | **高** | 手写底栏窄接口；动作字段全靠约定；MCP 会话未见到回收 | [详情](plugins/plugin-web2api-tools.md) |

## 最高优先级

1. **底栏契约**：`plugin-bottom-bar`、`plugin-node-text`、`plugin-node-image`、`plugin-node-video`、`plugin-web2api-tools` 这一组是唯一明确的“插件间源码依赖”。先把注册糖/类型搬到公开契约，节点包降为“可选协作”。
2. **共享数据字段**：视频截图写 `image` 节点、3D 读 `imageUrl`、文件拖入写媒体字段、底栏收集上游素材，四处都在猜字段。先补共享的节点媒体描述与上游素材纯函数。
3. **宿主扩展点**：`selectionRegion`、UI 目录名、`.v2-card`/`.moving-handle-anchor`/`.vue-flow` 选择器、`MiniCanvas.reloadPlugin`，目前都是字符串协议。先集中成公开常量/服务，再谈拆包。
4. **安装/卸载生命周期**：`node-ui` 的后台半、`plugin-manager` 的 UMD 脚本不可卸载、`hot-reload` 的全局单例，是“前端卸了，后台还在”的主要来源。

