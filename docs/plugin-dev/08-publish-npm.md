# 第 8 篇：把插件发布到 NPM（前后台成对 + 让别人一键安装）

> 前 7 篇教你写插件。这一篇教你把它发出去：打成包 → 传到 NPM → 别人
> 在「插件管理 → NPM 市场」里搜到它、点一下安装，前端半立刻活、后台半重启生效。
> 照抄能跑，全部命令都在下面。

## 你要做成什么样（一句话）

一个 npm 包，只发打包产物（不带依赖树、不带源码），元数据写在 package.json
的 miniCanvas 段里。别人装的时候，cloud-server 从 NPM 拉包、解出产物、落到正确位置。

    @mini-canvas/plugin-你的名字/
    ├── package.json     ← files 只含 dist；miniCanvas 段写清入口
    └── dist/
        ├── web.js       ← 前端半（UMD，css 内联；靠全局 Vue/MiniCanvasRender… 取依赖）
        └── server.js    ← 后台半（esbuild 单文件；没有后台功能就别放这个文件）

为什么只发产物：NPM 正常装包会拉一堆 devDependencies、装完还要 build，慢且臃肿。
这里反过来——你发布时就打好包，别人只拿到几个文件。装一个插件 = 下几十 KB。

## 第 1 步：package.json 的 miniCanvas 段（最关键）

    {
      "name": "@imohuan/plugin-showcase",
      "version": "1.0.0",
      "type": "module",
      "files": ["dist"],
      "miniCanvas": {
        "installable": true,
        "title": "插件展示",
        "description": "一句话说清这插件干什么",
        "pluginName": "showcase",
        "web":    { "entry": "dist/plugin-showcase.js", "globalName": "MiniCanvasPluginShowcase" },
        "server": { "entry": "dist/server.js" }
      }
    }

逐字段说清：

| 字段 | 作用 | 注意 |
|---|---|---|
| installable: true | 允许经「插件管理」安装 | 不写 true，cloud-server 会拒装（"不是插件包"） |
| title / description | 管理页显示的名字与说明 | 中文即可 |
| pluginName | 插件的运行时名字（export const name 的值） | 与代码里保持一致 |
| web.entry | 前端半产物路径 | 必须是 UMD（有 MiniCanvasPluginXxx 全局） |
| web.globalName | UMD 全局名 | 加载器按它取插件对象，写错 = 装不上 |
| server.entry | 后台半产物路径 | 没有后台半就整个 server 字段省掉 |
| files: ["dist"] | 只发 dist 目录 | 不写会把源码/测试一起发出去 |

miniCanvas 段为什么能放 package.json 里：NPM registry 的查询接口会原样返回
整个 package.json，cloud-server 取到包就拿到了全部元数据，不用再维护第二份清单。

## 第 2 步：打两个产物

前端半（UMD，复用本仓库的 pluginLibBuild）：

    // vite.config.ts
    import { defineConfig } from 'vite'
    import vue from '@vitejs/plugin-vue'
    import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
    import { pluginLibBuild } from '../vite-plugin-lib'

    export default defineConfig({
      plugins: [vue(), cssInjectedByJs()],
      build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginShowcase' }),
    })

后台半（单文件，零运行时依赖）：

    // scripts/build-server.mjs
    import { build } from 'esbuild'
    import path from 'node:path'
    import { fileURLToPath } from 'node:url'

    const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    await build({
      entryPoints: [path.join(PKG, 'src/server.ts')],
      outfile: path.join(PKG, 'dist/server.js'),
      bundle: true, format: 'esm', platform: 'node', target: 'node20',
      external: ['hono'],   // 宿主一定有 hono；打进来会双实例
    })

一条命令把两个都跑出来（scripts.build = "vite build && node scripts/build-server.mjs"）。

## 第 3 步：发布前自检

    pnpm build              # 产物最新
    npm pack --dry-run      # 看清到底发哪些文件

npm pack --dry-run 应该只列出 package.json + dist 里的产物。若看到源码、
.map、node_modules 混进来，检查 files 字段与 vite 的 sourcemap 开关
（发布包建议 sourcemap: false）。

## 第 4 步：发布

    npm publish --access public --registry=https://registry.npmjs.org/

scope 包（@xxx/yyy）必须带 --access public，否则默认私有、别人装不到。

2FA 提示：如果你的 npm 账号开了两步验证，npm publish 会要求一个 6 位验证码
（在你手机 / 认证器 App 上）。在你自己的终端里跑这条命令，按提示输码即可。

发完验证一下：

    npm view @imohuan/plugin-showcase version

## 第 5 步：让别人安装（闭环的后半段）

插件发布后，使用者在画布「设置 → 插件 → NPM 市场」里：

1. 在搜索框输入关键词（如 showcase）→ 搜到你的包；
2. 点「安装」——若这个包带后台半，会弹一次服务端权限确认（必选，防误装）；
3. 前端半刷新即可见（面板/按钮出现）；后台半重启 cloud-server 后生效；
4. 你发了新版本后，对方在同一处点「更新」即可升级。

服务端要连得上 NPM，用这几条路由（cloud-server 内置的 npm-plugins 插件提供）：

| 路由 | 作用 |
|---|---|
| GET /api/npm-plugins/search?q=… | 搜包（只回 installable 且在 scope 白名单里的） |
| POST /api/npm-plugins/install | 安装（body 需 { package, confirm: true }） |
| POST /api/npm-plugins/update | 按 latest 升级 |
| POST /api/npm-plugins/uninstall | 卸载（前后半一起清） |
| GET /api/npm-plugins/installed | 列已从 NPM 装的包及版本 |

### 安全约束（别绕过）

- 只能装 scope 白名单里的包，默认 @mini-canvas/。要装别的 scope 得在服务端配置里放开。
- confirm: true 必填：装一个后台半 = 让别人的代码以服务端权限在你机器上跑，必须显式确认。
- 完整性校验：安装时服务端自己算 sha256 存进来源记录，以后可审计。

## 完整最小清单（照抄）

    my-plugin/
    ├── package.json              ← 上面第 1 步那份
    ├── vite.config.ts            ← 第 2 步前端半
    ├── scripts/build-server.mjs  ← 第 2 步后台半
    ├── src/
    │   ├── index.ts              ← 前端半入口（export name / apply）
    │   └── server.ts             ← 后台半入口（export name / apply）
    └── dist/                     ← build 产物（.gitignore 掉）

想直接抄一个能跑的完整例子：本仓库的 packages/plugins/plugin-showcase/
就是按这套结构做的（前端面板 + 20 条后台 API + 两个构建脚本），可以整个复制改名当模板。

## 常见问题

装完管理页里没有？ 前端半的 dist/ 里得有能被加载的 .js，且有 MiniCanvasPluginXxx
全局。用 npm pack --dry-run 确认产物发出去了。

后台半装上了但不生效？ 后台插件是重启生效（落盘与执行分离的安全设计）——
重启 cloud-server。管理页的「后台」状态灯会显示当前状态。

globalName 写错会怎样？ 前端半装载直接失败、报"取不到全局"。改 package.json
的 web.globalName 与 vite 的 pluginLibBuild({ name })，两者必须一字不差。

能只发后台半、或只发前端半吗？ 能。只有前端就省掉 server 段；只有后台就把
前端入口留空、但仍需一个占位的 miniCanvas.installable: true。
