# plugin-showcase

## 一句话

前后台成对的演示插件：前端把设置页导航、整页面板和演示注册场塞进画布，后台演示 routes/store/jobs/mcp/agent。它自己承认“导航 id 必须等于 Config 分组名”，这是一条容易断的暗契约。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `mini-canvas-plugin-showcase` |
| 身份 | NPM 安装（`miniCanvas` 的 installable 被注释） |
| 源码文件 | 10（含测试；生产 8） |
| 测试文件 | 2：`apiBase.test.ts`、`testLogic.test.ts` |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | 类型 | 是 | `src/index.ts:10` |
| canvas-render | `useCanvasRender` | 是 | `src/components/ShowcasePage.vue:12` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `settingsNav` 槽 | 左导航项 | 契约 | `src/index.ts:39-44` |
| `settingsGroup/插件展示` 槽 | 整页 `mode:'replace'` | 契约，但键名与 Config 分组绑定 | `src/index.ts:45-52` |
| `showcase-demo` 服务 | 面板取注册场句柄 | 自有服务 | `src/index.ts:55-60` |
| `settings` | `resolveApiBase` 读 `cloudClientBaseUrl` | 可选 | `src/apiBase.ts:22-34` |
| `cloud-client` / `cloud-save` | 地址回落 | 可选 | `src/apiBase.ts:29-33` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `fetch` | 面板测试台调用后台 | 未注入，单测需全局替身 | `ShowcasePage.vue:66-83` |
| `/api/showcase/*` | 后台端点 | 前端从 `/endpoints` 动态取，但 meta 仍写死 | `ShowcasePage.vue:66-67` |
| `settingsGroup/<一级导航>` | 设置页挂载点 | 导航 id、Config 分组、槽键三处必须同步 | `src/index.ts:24-27,39-52` |
| 默认绝对端口 | 地址解析 | 同 style-library，键名漂移即静默回落 | `src/apiBase.ts:22-33` |

## 内部职责与风险

1. **“占位 Config 分组”是架构味道**：只为了让设置面板出现一级导航而声明一个无实际意义的配置项；说明设置导航的注册机制还要求“导航 id = Config 分组”。
2. **前后台共用插件名是隐式契约**：后台 `server.ts` 的 `PLUGIN_NAME = 'showcase'`、前端 `name = 'showcase'` 分别维护，重命名容易只改一半。
3. **演示注册场是真实能力，不是玩具**：`registryOf('showcase/demo-item')` 的条目归本插件作用域，卸载即清，能直接作为未来注册场的参考实现。
4. **`API_BASE` 导出了空串**：实际请求走 `resolveApiBase`，这个导出容易误导消费者以为可以改基址。

## 单独装卸判断

- 只装前端：面板可打开，后台请求失败，错误提示已做成人话。
- 只装后台：`/api/showcase/*` 可用，设置页没有入口。
- 卸载：槽、服务、注册场条目随插件回收。

## 建议改法

1. 把设置页一级导航改成独立注册场（例如 `settings/nav`），不再要求“同名 Config 分组”；Config 占位项可删。
2. 前后台插件名/版本从同一份生成物或共享常量读取，至少补一条跨半一致性测试。
3. 把后台地址解析提成公共契约，与 style-library 共用一份实现。
4. 删除或重命名 `API_BASE`，只保留一个入口，避免两个地址来源。

## 待验证

- 设置导航槽在主题换皮后是否仍按 `Config` 分组名字段工作；当前只核了默认主题路径。
- NPM 安装形态下 `installable` 注释是否会让本地开发清单与发布清单不一致；需要看发布脚本。

