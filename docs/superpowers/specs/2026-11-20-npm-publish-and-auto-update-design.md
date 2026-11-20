# NPM 发布与自动更新体系 设计文档

日期：2026-11-20
状态：待用户确认

## 1. 目标

把 plume-canvas 发布到 npm，用户 `npx plume-canvas` 一条命令启动：

- 后台包不含前端与插件（包体小，每个库只管自己）；
- 启动时自动从 npm 下载缺失的内置插件与前端界面；
- 启动时检查更新 + 每 30 分钟定时检查（只提示，不自动装）；
- 插件 package.json 声明 provides / dependencies，安装时自动解析依赖、卸载时反向拦截。

## 2. 包结构（scope：@plume-canvas）

| 包 | 内容 | 说明 |
|---|---|---|
| @plume-canvas/server | dist/ + builtin-manifest.json | npx 入口，不含 UI 和插件 |
| @plume-canvas/ui | dist/ 静态产物 | 前端界面，启动时装到数据目录 |
| @plume-canvas/plugin-* | dist/web.js、dist/server.js、package.json | 每个自带插件一个包 |

- 本轮只发自带插件（BUILTIN_PLUGINS 清单里的 24 个）+ ui + server。
- plugin-demo-kit（演示包）与非自带清单的插件本轮不发，发布脚本按清单过滤。
- 内置清单是 server 包内的 JSON 文件（dist/builtin-manifest.json），不做独立包。

## 3. 版本策略

- 内置插件：清单里写 latest，启动初始化按 latest 安装。
- 第三方插件：安装接口支持指定版本；依赖声明里可写版本范围，按范围选版。
- 后台自身：只查最新版提示（重启可更新），不做热更新。
- 全部更新检查：只提示（API + 前端红点），不自动安装，用户在插件管理页手动确认。

## 4. 启动初始化流程（新建 apps/server/src/updater/）

cli.ts serve 入口 → bootstrap（updater/bootstrap.ts，异步不阻塞起服务）：

1. ensurePlugins()：读 builtin-manifest → 逐个查本地 .plume/plugins/<dir>；本地缺或未登记 → 走 npmPlugins 的 doInstall（复用，不重写）；已装 → 跳过。
2. ensureUi()：查 .plume/ui/version.json → 缺/旧 → 下载 @plume-canvas/ui tarball，解包到 .plume/ui/<version>/ → 写 version.json。
3. scheduleChecks()：立即 checkAll() 一次 + setInterval 30 分钟。

- bootstrap 失败不拦启动：网络失败只 warn，服务照常起，下次启动再试。
- cli.ts 加 --offline 参数：跳过 bootstrap 全部联网步骤。
- resolveUiDist 候选列表加数据目录 .plume/ui/<version>（位置：仓库路径之后、随包 assets 之前）。

## 5. 更新检查抽象（updater/checker.ts）

UpdateChecker 接口：checkAll() 返回 UpdateReport。

- UpdateReport = { server?: { current, latest }; plugins: Array<{ pkg, local, latest, builtin }> }
- 数据源：.plume/plugins/.npm-installed.json（安装记录）+ builtin-manifest（latest 查询）。
- 复用 npmClient.packument，不新写网络层。
- 新增 GET /api/updates 路由：返回最近一次报告 + 支持手动触发。
- 定时器 30 分钟，跟着服务生命周期停。

## 6. 插件依赖声明

插件 package.json 的 plume 段新增：

- provides：服务名（裸名）与插槽名（slot: 前缀），声明本插件对外提供什么；
- dependencies：强依赖（其他插件的 provides 名），缺则拒绝安装；
- optionalDependencies：弱依赖，缺只警告不拦。

安装前：解析 dependencies → 对照本机已装（扫 .plume/plugins/*/package.json 的 provides）→ 缺的按 provides 在 npm 候选池找 → 递归安装（环路保护）→ 找不到则 400 报错。卸载前：反查已装插件谁的 dependencies 引用了它 → 有人依赖则拒绝并列出。一致性守卫测试：源码 export const inject + 插槽注册名 必须包含在 package.json provides 里，CI 每包跑。

## 7. server 瘦身

- apps/server/package.json：files 去掉 assets（保留 dist、providers，新增 builtin-manifest.json）。
- prepack 不再跑 bundle-assets.mjs（UI/插件不进包）。
- pluginRoots 的 packaged 兜底变为可选（assets 目录不存在时行为不变，返回 undefined）。
- dev 流程（launch-server.mjs / build:assets）不变：仓库内开发仍走 apps/web/dist 与 packages/plugins。

## 8. 发布流程

- 各包 package.json：去 private、version 起步 0.1.0、加 publishConfig.access=public、files 只留产物（dist 等）。
- token：.npmrc 写 //registry.npmjs.org/:_authToken=${NPM_TOKEN}，发布时环境变量注入。
- 发布脚本 scripts/publish-all.mjs：按顺序（插件 → ui → server）逐包 npm publish --access public，失败即停；--dry-run 先试跑。发布前自动跑各包 build + typecheck。

## 9. 验证

- 单元测试：updater 的清单解析/版本比对/依赖解析（vitest，apps/server）。
- npmPlugins 依赖解析用假 registry（现有 npmClient 测试注入模式）。
- bootstrap 集成：临时数据目录 + 假 registry，验证装插件/装 UI/写 version.json。
- 实际发布用 --dry-run 验证包内容（npm publish --dry-run 列出文件清单）。
- Chrome 实测：npx 启动 → 打开页面 → 插件管理页红点 → 手动更新流程。

## 10. 不做的事

- 不做后台热更新（重启生效）。
- 不做前端 UI 的自动热替换（提示重启）。
- 不改 kernel 运行时依赖机制（PENDING/missingDeps 已存在，只补安装期检查）。
- plugin-demo-kit 等非自带包不发布。
