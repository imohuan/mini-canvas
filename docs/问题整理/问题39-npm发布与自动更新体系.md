# 问题 39 · npm 发布与自动更新体系（2026-11-20）

## 背景

项目要发布到 npm，用户 `npx plume-canvas` 一条命令启动。要求：每个库只管自己（server 包不含 UI 和插件）、
启动时自动装缺失的内置插件与 UI、定时检查更新（只提示不自动装）、插件安装支持依赖解析与卸载反向拦截。

## 方案（设计文档 docs/superpowers/specs/2026-11-20-npm-publish-and-auto-update-design.md）

- 包结构：`@plume-canvas/server`（npx 入口 + builtin-manifest.json）+ `@plume-canvas/web`（静态产物）
  + 24 个自带插件各一包（BUILTIN_PLUGINS 清单）。
- 内置清单是 server 包内 JSON（包根 builtin-manifest.json，gen-builtin-manifest.mjs 生成），键是 npm 包名，值 latest。
- 启动初始化 apps/server/src/updater/bootstrap.ts：异步不拦启动；插件缺了从 registry 装（复用 npmClient 全套）；
  UI 下载解包到 .plume/ui/<版本>/ 并写 version.json。--offline 跳过。
- 更新检查 apps/server/src/updater/checker.ts：compareVersions（预发布段拆点分段、NaN 段按 0）；
  GET /api/updates 读报告 + POST /api/updates/refresh 手动重算；启动立即算一次 + 30 分钟定时（stop() 清理）。
- 依赖解析 apps/server/src/updater/depsResolver.ts：插件 package.json plume 段 provides/dependencies/optionalDependencies；
  装前递归解析（DFS 防环），缺强依赖 400 拒装；卸前反查依赖者，有人依赖 409 拒卸。
- server 瘦身：package.json files 去 assets（发布包 289 KB，原全打包几十 MB）；UI 解析路径加 .plume/ui/<版本>。
- 发布：scripts/prep-publish.mjs（去 private、0.1.0、publishConfig、files）+ scripts/publish-all.mjs
  （插件→ui→server 顺序，失败即停，--dry-run 试跑；插件/ui 的 main/exports 发布时临时切 dist、finally 恢复）。

## 关键决策

- 更新全部只提示不自动装（用户口径 2026-11-20）。
- 内置清单放 server 包内，不做独立 npm 包（改清单=重发 server 一版，简单够用）。
- 自带插件版本写 latest（都是自己维护、永远跟最新）；第三方插件安装支持指定版本。
- monorepo 内部插件 package.json 保持源码形态（exports 指 src），dist 形态只在发布时临时切换。
  教训：曾把 main/exports 直接改成 dist 导致 23 个 web 测试套件挂（插件 dist 没构建），已回退。

## 独立复核修正（reviewer 子代理）

第一轮发现 5 个应修项，全部修复：

1. manifest 三处错位（写到 dist 但读包根、键是目录名当包名用）——发布后开箱即坏。
2. 更新报告 builtin 标记键不匹配恒 false。
3. 前端回退永不触发（空报告也是 truthy）+ 30 分钟定时没实现。
4. compareVersions 预发布判等的根因：空 suffix 的 join 后 split 得 [''] 一个空段（1.0.0-beta 判等 1.0.0）。
5. bootstrap 已装判断不比版本，清单驱动升级失效。
第二轮两个尾巴：stop() 清定时器、启动立即算一次报告。
未修记录在案：#6 首次 npx 启动 UI 未就绪时无提示（需重启生效）；#7 跨请求并发安装同一依赖的竞态窗口。

## 验证

- apps/server 全量 158 文件 1069 测试全绿；typecheck 干净。
- plugin-manager 60 测试全绿；apps/web 除 themeColorHygiene（既有失败，ProviderManagerPage 写死颜色，先前 commit 遗留）外全绿。
- npm publish --dry-run：24 插件 + ui + server 全通过，server 包 288.8 kB / 10 文件。
 - **真实发布已完成（2026-11-21）**：npmjs 创建 org plume-canvas（免费 public）；26 个包全部发布（24 插件 0.1.2~0.1.3 + ui@0.1.0 + cloud-server@0.1.0）；发布形态 main/exports 指 dist、删除 @plume-canvas/* 内部依赖、workspace:* 转 *；npm install @plume-canvas/plugin-clipboard@0.1.2 干净目录验证通过。
 - 踩坑记录：① @scope 发包必须先建 org；② registry CDN 同步延迟 2~5 分钟（npm view 落后导致撞版本）；③ workspace:* 不能出现在发布依赖（EUNSUPPORTEDPROTOCOL）；④ 内部依赖 @plume-canvas/* 必须删除（引擎包未发布 404）；⑤ npm publish --prefix 读错 package.json（EPRIVATE），必须 cwd；⑥ npm 缓存致 install 看不到新版本，cache clean --force 解决。
 - 工具沉淀：scripts/swap-dev-to-pub.cjs（发布形态切换/恢复）、scripts/sync-npm-versions.cjs（本地版本与 npm 同步）。
 - 工具沉淀：scripts/swap-dev-to-pub.cjs（发布形态切换/恢复）、scripts/sync-npm-versions.cjs（本地版本号与 npm 同步）。

 ## 真实数据端到端验证（2026-11-21 第二轮）

 - 发现并修复两个真实缺陷：
   1. **bootstrap 产物回退缺失**：线上早期发布的包 entry 写 dist/web.js 但实际文件是 dist/<包名>.js，24 个内置插件全部装不上 → bootstrap 加 resolveArtifact 回退（entry 不存在时找 dist 下唯一 .js），测试覆盖；
   2. **catalog 自带 id 不认 NPM 副本**：builtinInstallIds/builtin 标记按裸目录名匹配，NPM 副本目录名是 plume-canvas__<dir> → 前端首启一个插件都装不上（界面空白）→ catalog 与 pluginRoots 双向修复（bareDirOf），测试覆盖。
 - 真实流程验证（不用假 registry）：
   1. 干净数据目录 + 真实 npm 启动 → 24 个内置插件全部从 npm 装上（boot-probe2.log installed:24 failed:0）；
   2. UI 正常启动，界面出现「插件」入口，插件管理页显示 24/31 已装、自带 24 个；
   3. 发布插件新版本（clipboard 0.1.3→0.1.4→0.1.5）→ 服务端更新报告正确显示有更新；
   4. UI 插件管理页显示「有更新 → v0.1.5」红点提示；
   5. 点击「更新」→ 真实从 npm 下载安装 → 磁盘版本升级到 0.1.5、来源记录同步（截图留证）；
   6. server 更新提醒（0.1.0→0.1.1）在 /api/updates 正确报告。
 - 所有 31 个 npm 包现在都带 README（34 个插件脚本生成 + 4 个核心包手写）。
