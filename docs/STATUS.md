# mini-canvas 项目指挥入口（每次开工先读这里）

> **我是项目的"当前该干什么"入口。** 读法：先看下面【一、现在该做什么】，再按需查【二、验证命令】
> 【三、契约锚点】。历史记录在【四】之后，**只供追溯，不代表现状**。

## 一、现在该做什么（2026-09-17）

### 最近完成（2026-10-04，全仓扫描：同一类「启动/恢复先后顺序」bug 清查）

前面三个 bug（设置刷新回退、插件刷新掉、小地图宽高回退）是**同一类根因**：数据是先按本地后端恢复、
云端插件随后才把后端切过去，而"切过去之后没人重读"或"重读时被默认值盖掉"。按这条线索做了系统清查。

**已修（本轮）**：
- 小地图宽高：见下一条（capabilityLayer 用默认值盖掉已恢复的用户值）——**已修 + 验证**。

**扫描发现并已修**：
1. **快捷键重映射刷新不生效**（同 settingsPersist 一类）。plugin-shortcut-manager 的
   shortcutRemapEngine.restore() 只跑一次（插件装配时，读的是本地 shortcut 后端）；
   plugin-cloud-client 之后才把 shortcut 域切到云端，切完**没人重读** → 云端存的重映射键位进不来。
   **已修**：引擎新增 subscribe()（订阅 save.onAdapterChange('shortcut') 后重读并 re-apply），
   插件 apply 里经 ctx.effect 挂上（随卸载回收）。新增单测 1 条（先确认无修复时红）；
   plugin-shortcut-manager 30 全绿 + tsc 干净。（注：成品 UI 当前不装该插件，属"直连 cloud-server
   且装了它"的宿主才暴露；但根因同类，一并修掉。）

**扫描发现、尚未修（属别的会话在写的新插件，非本次主线）**：
2. **新插件 plugin-cursor-effect 让主题色守卫变红**（与本次主线无关，是别的会话正在加的新插件）。
   packages/ui 的 themeColorHygiene 扫到它写死的颜色（catalog.ts 的 color 字段、colorAssets.ts 的
   SVG 素材、CursorEffectOverlay.vue 的 canvas 绘制色）共 54 处。这些多是"用户可选的数据色 / 画进 canvas
   的像素色"，按规范加精确到行的 `主题色白名单: 原因` 豁免即可；但**该插件还在开发中**，
   豁免标记应由它的作者补（我避免替半成品定调）。

### 最近完成（2026-10-04，修「小地图宽高改了刷新就回退」）

**用户报的问题**：改小地图（plugin-mini-map）宽高，改完刷新，改动没生效（回退到默认 240×160）。

**根因**：运行期热装插件的 Config 声明会用 schema 默认值盖掉刚恢复的用户值。
启动顺序是「宿主先按本地后端恢复设置（快照里已有用户改过的 miniMapWidth）→ 再热装插件」；
而 mini-map 是云端清单**运行期热装**的，内核调 declareConfig 把它声明进 settings 时，
settings.define 本来已经命中快照取到了用户值，紧接着那行 settings.set(key, config[key])
（config 是 schema 校验后的默认值）又把它写了回去 —— 用户值当场丢失。
内联 config 时代（插件冷启动先声明、恢复在后）没这问题，改成运行期热装后才暴露。

**修法**：capabilityLayer.declareConfig 里，若该项在**保存快照**里已有值，就不要再 set config[key]
（define 已经取到用户值）；只有快照里没有的项才用装配 config 补齐初值。

**验证**：canvas-data 新增 declareConfigSavedValue.test.ts 2 条（先确认无修复时红：expected 240 to be 320）；
真机端到端（云服务 8877）：改宽高 320×220 → 刷新 → 仍是 320×220、小地图 DOM style 同步；
把修复关掉重跑则回退 240×160（决定性对照）。canvas-data 364 全绿 + typecheck 干净。

### 最近完成（2026-10-04，音频节点：拖动播放头改为「手停就停」的节流出声）

**用户报的问题**：拖波纹上那条播放头时，希望"拖动才出声"；实测按住不放、指针停住后
音频还在播，播放头/时间轴自己往前走，跟手指脱节。用户给的方案：
每次移动重置一个 **60ms 定时器**，到点就把播放暂停 —— 相当于对出声做节流。

**改法**（`plugin-node-audio/src/AudioContent.vue`）：
- 拖动（播放头 + 波纹下那条整体进度条，两者同一手势）期间，`onPointerMove` 每次调用
  `noteScrubActivity()`：若停手时被暂停过就先 `play()` 恢复出声，再重置 `SCRUB_IDLE_MS = 60ms`
  定时器 `armScrubIdleTimer()`；到点没再动 → `pauseScrub()` 暂停并把 `scrubPaused = true`。
- 连续拖动时 rAF/指针事件每帧都来，定时器不断被打断 → 一直出声；手一停约 60ms 静音。
  声音、播放头、时间轴同时停住，按住不放也不会自己往前溜。
- 松手仍按"拖之前是播是停"恢复（原有口径不变）；松手 / 卸载都 `cancelScrubIdle()` 清定时器。

**验证**：先写红（`audioSeekAndProgress` 补 3 条：节流常量与定时器、移动重置 + 恢复出声、
松手/卸载清理），再实现转绿；本包 **93/93**、typecheck 干净。
（`packages/ui` 里 `canvasToggles`(maxZoom)、`themeColorHygiene`(plugin-cursor-effect 写死颜色)
两条红是用户既有 WIP，输出与本包无关。）

### 最近完成（2026-10-04，修「装好的插件刷新后消失、配置跟着丢」）

**用户报的问题**："很多插件是后续安装的……刷新之后，这些已安装的插件甚至没有被加载，每次刷新都要重新安装，
关于这些插件的配置也就全部消失了。总结：配置不管用，刷新就无。"

**复现（决定性）**：把插件管理要读的「已装名单」在本地设成空、云端设成全量，再人为拖慢云插件脚本
（模拟真实网络），刷新后**一个外部插件都没装**（期望 16）。

**根因**：与「设置刷新回退」同源 —— 配置后端在运行期被换，读写两本账错位。
插件管理的**读**发生在启动早期（那时 config 域还指向浏览器本地），而**写**（用户点安装时）
发生在云插件把 config 域切到云端之后。于是"读本地旧名单、写云端新名单"对不上；
插件没装上，它们声明的配置项也就从未 define，设置面板里自然全没了。

**修法**：plugin-manager 服务订阅 save.onAdapterChange，config 域换后端后把安装名单与**新后端**对齐
（语义与配置持久化桥一致）：新后端有名单 → 以它为准（多的卸掉、少的补装）；新后端是空的（首次上云）→
把当前意图搬过去，别让云端的空把已装插件抹掉。

**验证**：同一个 6 秒延迟复现 —— 修前 **0 个插件**（bug 重现）、修后 **16 个插件**；
真机端到端（云服务 8877）：卸载多选 → 刷新 → 它仍「未装」、其余 15 个插件都在、改的 themeMode 也保住；
新增单测 1 条（先确认无修复时红）；plugin-cloud-client 117 全绿 + typecheck 干净。
注意：调试期发现本机另一个程序（loadout-desktop.exe）也占着 8865/8866，早先几次读数是打到它上面导致的假象 —— 换端口 8877 后一切自洽。

### 最近完成（2026-10-04，整页不可选中文本 + 右键菜单去掉透明度）

**用户报的问题**：
1. Package UI 整个页面要 select-none，界面文本不能被选中（截图里画布节点标题「image」能被拖蓝）；
2. 右键菜单插件有透明度，要删掉（截图：菜单卡片半透明，背后节点内容透进来）。

**根因与修法**：
- 问题 1：v2 成品壳丢了 v1 主机在 body 上 user-select: none 的兜底，全站没有整页禁选。
  在 packages/ui/src/app.css 重加 body { user-select: none }，并给输入面
  （textarea / input / [contenteditable="true"] / .ProseMirror）override 成 user-select: text，
  否则节点文本编辑、标题编辑、Agent/底栏输入框连字都选不了。
- 问题 2：plugin-context-menu 的 .ctx-menu 与 .conn-menu 用 var(--ui-glass)（约 0.86 不透明）
  + backdrop-filter: blur(20px)，菜单压节点上时内容直接透出。改成**不透光档**
  var(--ui-overlay-solid)（与节点控制栏同一档），并删掉 backdrop-filter（规范 §2.6：纯色底上写 blur 无效）。

**验证**：pnpm -C packages/ui test 新增 pageSelectNone.test.ts 2 条（先写红）、
pnpm -C packages/plugins/plugin-context-menu test 新增 menuOpaque.test.ts 4 条（先写红）；
插件已重新 build（UMD 含 ui-overlay-solid）；浏览器实测：body/节点标题 user-select=none、
textarea 为 text，右键菜单与连线菜单均为不透明底（暗色 rgb(33,33,33)）、backdrop-filter=none。
（packages/ui 里 canvasToggles 的 maxZoom 那条红是用户既有 WIP，与本次无关。）

### 最近完成（2026-10-04，修「设置保存后刷新被还原」+ 主题模式进 render 配置）
### 最近完成（2026-10-04，新增「光标特效」插件 plugin-cursor-effect）
### 追加（2026-10-04，光标特效：全页面生效 + 指针零延迟）
### 追加（2026-10-04，光标特效：下载真实素材 + 修「图标渲染成方块」）
### 追加（2026-10-04，光标特效：修「动画不播」+ 支持自定义上传/帧序列）
### 追加（2026-10-04，光标特效：自定义上传稳健化——大图缩放 + 失败不静默）
### 追加（2026-10-04，光标特效：修「选中自定义光标后完全空白」—— 根因是 localStorage 被禁用）
### 追加（2026-10-04，光标特效：修「自定义光标选中后画布上什么都不显示」—— 图片宽度被算成 0）
### 追加（2026-10-04，光标特效：帧序列可设帧率）

- **用户要求**：上传多帧时，希望能设置它的帧率。
- **做法**：帧率从「全局一个」改成「**每条帧序列各自一个**」——
  - CustomCursor.fps 已存在；渲染层改用 cust.fps 优先（不再被全局值覆盖）；
  - 设置页在选中某条**多帧**素材时，显示一个「帧率（这条 N 帧序列）」滑杆（2–30 帧/秒）；
    改它 → updateCustomCursor(id,{fps}) → 写回并广播 → 渲染层重读、**立即变速**；
  - 参数区里原来那个「帧序列帧率」改名为「**新上传帧率默认值**」，只决定新上传时的初值，避免两个「帧率」混淆。
- **验证**：单测 **33/33**（新增 customCursors.test.ts 6 条：内存兜底、改帧率只动该条且 id 不可被覆盖、删除、事件名稳定）；
  tsc/vue-tsc 干净；UMD 重打包 ~153KB；真机（用户实例 5289）——上传 3 张不同颜色小图成「f1（3 帧）」，
  选中后设置页出现「帧率（这条 3 帧序列）12 帧/秒」滑杆（AX 可见、值 12）。
- **注意（非本插件）**：验证时页面被一个无关的编译错误浮层挡住 ——
  packages/plugins/plugin-cloud-client/src/manager/components/settings/PluginManagerPage.vue:45 的模板字符串少了起始反引号，
  导致该文件解析失败。**不是本次改动**，未擅自修改。


- **根因（真机在用户实例 5289 上抓到）**：自定义光标用的是跟随层里的一个 `<img class="ce-frame">`。
  我在设置尺寸时的顺序是「先量/先设样式、后 display」，而那时 `<img>` 还是 `display:none`、
  处在 flex 居中容器里 —— 量出来宽度是 **0**；成品表现就是「图片在 DOM 里、`naturalWidth` 正常、
  但 `getBoundingClientRect().width === 0`，画布上什么都不显示」（探针实测 `w:0, h:30`）。
- **修法**：在 `paintFollower` 里改成**先写死尺寸、再显示** ——
  同时写 `img.width/height` 属性与 `style.width/height`（外加 `max-width:none`），然后才 `display:block`；
  帧序列切换只换 `src`，不再碰尺寸。实测 `w=30, h=30`、`naturalWidth=97`，你的上传图**已作为光标正常显示**。
- **验证（用户实例 5289，真机目视）**：设置→光标→自定义里选中已上传的图 → 关设置 → 移动鼠标，
  画布上出现该图作为光标（截图确认）；内置指针/动画/拖尾/点击特效不受影响。
- 顺带说明：`localStorage` 在这些内置浏览器标签里读不到（探针返回 undefined），但页面主环境可用 ——
  之前加的**内存兜底**保证了「即便读不到 localStorage，上传→选中→显示」整条链仍然通。
- 单测 27/27；`tsc`/`vue-tsc` 干净；UMD 重打包 ~152KB。


- **用户反馈**（附截图）：上传的图片**选中后光标完全空白**。
- **端到端复现**（这次跑了整链：上传 → 选中 → 看画布上的光标），查明**两个真 bug**：
  1. **本环境 localStorage 是 undefined（被禁用/沙箱化）** —— 自定义光标存在 localStorage，
     loadCustomCursors() 读到空、saveCustomCursors() 抛错被吞 → 上传看似成功、选中却没有任何素材 → **光标空白**。
  2. **选中自定义但没有素材时不回落** —— 渲染层把跟随层清空后留了个**空白**，既不是自定义光标、也不是默认箭头。
- **修法**：
  - customCursors.ts：加**内存兜底**（模块级缓存）+ 安全的 ls()（探测不可用返回 null，绝不抛）。
    写的时候**总是先写内存**，localStorage 只是持久化增强；不可用/配额满都照常能用，只带回一条 warning
    （「素材只在本次会话有效，刷新后会丢」）。设置页把 warning 显示成**提示**（不再是红错），环境不支持时提前告知。
  - CursorEffectOverlay：选中自定义但**一条素材都没有**时 → **回落默认箭头**，**绝不空白**。
    原先的 find(...) ?? customCursors[0] 在空数组时返回 undefined，就是空白源。
- **验证（真机、localStorage 被禁的 IAB 环境）**：
  上传点状 PNG → 列表出现条目（内存兜底生效、无报错）；选中它 → ce-frame 显示、naturalWidth=128、跟随层跟手；
  删光全部素材后仍选中自定义 → 跟随层**显示箭头**（isArrow=true、innerSvgLen=397），不再空白。
  单测 27/27；tsc/vue-tsc 干净；UMD 重打包 ~152KB。
- **我的疏漏**：前几轮只测了「上传成功」与「帧序列循环」，**没测「选中它当光标用」这一步**，所以漏了这个空白 bug。


**用户反馈**：上传的光标缩略图是**破图**（浏览器占位图标）。

**根因（两类）**：
1. **大图爆 localStorage 配额**：把原图（手机照片动辄几 MB）原样转 data URL 塞进 localStorage，
   超过 ~5MB 配额时 `setItem` 抛错，而当时**静默吞掉**了 —— 素材没存进去，界面却像"成功了"，重载后就成了破图。
2. **不可被 <img> 渲染的编码**：极少数格式浏览器画不出来，也表现为破图。

**修法**：
- `customCursors.ts` 新增 `normalizeUpload(file, maxEdge=160)`：**位图**先画进 canvas 缩放到 ≤160px 再重编码成 PNG（必然可渲染、且只剩几 KB）；
  **SVG 保留矢量原样**（不栅格化，保持清晰）；任何一步失败都回落原 data URL，绝不丢用户的东西。
- `saveCustomCursors` 改成**返回 { ok, error }**，配额满时给出「素材太大，浏览器存储放不下」的提示；
  `addCustomCursor` 写失败就**回滚**（不把存不下的素材留在内存里假装成功）。设置页把 error 显示成红字。
- 缩略图与跟随帧都加 `onerror` → 失败时**隐藏**（不显示浏览器破图图标）。

**验证**：单测 27/27；`tsc`/`vue-tsc` 干净；UMD 重打包 ~151KB。
真机：上传 1MB 的 1600×1200 PNG → 列表出现「big-photo」且缩略图**正常渲染**（归一化后仅几 KB）；
普通 SVG 单张/多帧上传也正常（前一轮已验证帧序列循环 3 帧）。



**用户反馈**：① 动态效果完全没反应、依然是静态；② 希望能**自己上传图片或 SVG**，并支持**帧序列**动画。

**问题①根因**：pulse / spin 的 idle 动画与「热点偏移」的内联 `transform` 写在**同一个元素**上——
内联 transform 把 CSS 动画的 transform 覆盖了，所以永远不动（脉冲点永远不动、旋转环永远不转）。
**修**：拆成两层各自管一个 transform ——
  外层 `ce-offset` 只写热点偏移（`translate(-hx*size, -hy*size)`），内层 `ce-inner` 留给 pulse/spin 动画；
  两者互不覆盖。实测：选「靶心」后 `ce-inner` 带 `pulse` 类、`animationName=ce-pulse-…`、且它的内联 style 为空。

**问题②新增能力**：
- `src/customCursors.ts`：自定义光标存**本机 localStorage**（`mc-cursor-effect:custom-cursors`）。
  为什么不用内核 settings：上传的 data URL 可达几百 KB，而 settings 会随 settingsPersist 同步到云端 KV，
  塞进去会把「配置」撑爆。settings 只存"当前用哪一个"这个**小 id**（`cursorFxCustomId`）+ 帧率（`cursorFxCustomFps`）。
- 渲染层 `CursorEffectOverlay`：自定义时用透明光标藏原生指针，绘图交给一个 `<img>`；
  `frames.length>1` 就按帧率 `setInterval` 循环换 `src`（**帧序列动画**）。监听 `mc-cursor-effect:custom-changed` 立即生效。
- 设置页新增「自定义」页签：上传**一张**图片/SVG = 静态光标；**多选几张** = 帧序列；可删除、可切换；显示「N帧」角标。
- Config 新增两项：`cursorFxCustomId`、`cursorFxCustomFps`；`cursorFxCursor` 的 select 增加「自定义上传」选项。

**验证**：单测 27/27；`tsc`/`vue-tsc` 干净；UMD 重打包 ~150KB；
真机——① 选「靶心」动画真的在动（animationName 有值、内联 transform 已清空）；② 上传 3 张 SVG → 面板出现「star（3 帧）」；
采样 1.2s 帧的 src 出现 **3 个不同值**（帧序列在循环播放）。



**用户反馈**：很多特效"没有真实效果"——落叶是小方块、选「帮助」光标显示成方块、粒子是代码画的不好看；
要求**去网上把真实素材下载进项目**。

**根因（方块）**：重写目录后 `catalog.ts` 引用了新素材键（`pointer-arrow` / `hand-point` / `text-i` …），
但 `icons.ts` 还是旧键名 → `svgIcon` 查不到返回空串 → 渲染成空/方块。修：用脚本从 Iconify 重新生成 `icons.ts`（50 个键）。

**真实素材（已下载进仓库，运行时不联网）**：
- `assets/icons/*.svg`（50 个，脚本同步进 `src/icons.ts`）：Lucide / Solar / Phosphor / MingCute / Tabler —— 单色线框，指针形状。
- `src/assets/color/*.svg`（31 个，同步进 `src/colorAssets.ts`）：**Noto Emoji（Apache-2.0）真彩色** —— 落叶/枫叶/樱花/向日葵/星星/闪光/爱心/雪花/彩纸/礼花/月亮/彩虹/音符/彗星/星球/蝴蝶/猫爪/猫脸/宝石/泡泡/气球/糖果/火焰/眩晕。
- `src/engine.ts` 的 `svgIcon(name,size,color)`：有彩色素材且未指定颜色 → 返回彩色原件；否则查单色表并把 currentColor 换成给定色。

**效果全部换成真实素材**：
- 指针分四类页签：**指针**（单色真鼠标形状，白填充+深色描边，任何底色都看得清）/ **彩色**（真实彩色素材当光标）/ **系统** / **图片**。
- 跟随拖尾：彩虹 / 仙女尘 / 星光 / 落叶（真叶子+枫叶+樱花）/ 爱心 / 雪花 / 音符 / 蝴蝶 / 气泡 / 月光 / 幽灵 / **猫爪队列**（真实猫爪素材串成队列）。
- 点击特效：烟花 / 星芒 / 彩纸 / 爱心 / **花瓣** / 雪爆 / 音符 / 涟漪 / 冲击波。
- canvas 精灵对彩色素材**不做染色**（保留自带颜色），对单色才用 `col` 着色。

**验证**：单测 27/27（含"每个清单项引用的素材键都真实存在"的防方块护栏 + 彩色素材完整性）；`tsc` 干净；
UMD 重打包 143KB（含全部素材）；真机复验——指针不再是方块（白箭头带描边）、拖尾与点击特效都是真实彩色星星，
设置页四个页签的缩略图全部为真实的矢量图标。



**用户反馈两条**：① 光标只在画布里生效，一开下拉/浮层就被盖住或裁掉；② 光标跟随有延迟（"拖尾才有动画，光标必须实时跟手"）。

**改法**：
1. **整块 Teleport 到 `document.body`**：覆盖层原来住在画布容器里（`.csurface-overlay` 带 overflow:hidden、z-index:20），
   搬到 body + `position:fixed; inset:0; z-index:2147483000`（顶层，压过设置面板/下拉的 100000）→ 光标覆盖整个页面、永远是鼠标本身。
   坐标随之改用 `clientX/clientY`（不再算容器矩形）；canvas 尺寸用 `window.innerWidth/Height` + resize 事件。
2. **原生光标藏在整个 document**：透明光标那条 CSS 从画布根挪到 `<html>`（`html.mc-cursor-hidden`）→ 画布/设置/下拉/弹窗里都换成自绘指针。
   拆成**三层各自管一个 transform**（外层位置 / hover 放大 / 点按回弹 / 内层热点偏移+idle 动画），互不覆盖。
3. **指针零延迟**：删掉原先的平滑插值，`pointermove` 里**直接**把跟随层 `transform` 设到鼠标坐标（事件驱动、即时跟手）；
   RAF 只负责推进拖尾与点击粒子的动画。实测跟随层 transform 精确等于鼠标坐标（300,300 / 800,600 逐点核过）。

**验证**：单测 26/26 保持全绿；`tsc` 干净、`vue-tsc` 无本插件报错；UMD 重打包 48KB；
真机——设置弹窗开着时光标与拖尾仍画在弹窗**之上**、跟随层 z-index=2147483000 且挂在 body 下、`html` 已加隐藏类。



**用户要求**：把画布鼠标从默认手掌换掉，加样式库 + 点击特效；先做可玩的 Demo，再做成带**自绘设置页**的插件装进 cloud client 插件系统。

**产物**：`packages/plugins/plugin-cursor-effect`（`installable: true`，清单会收录、默认装好）。

- **光标指针**（`catalog.ts` 的 CURSORS）：图标款会动（透明原生指针 + 跟随元素）/ 系统款（`cursor:pointer` 等）/ 图片款（`cursor:url(图片)`，静态）。
- **跟随特效** FOLLOWS：彩虹拖尾 / 仙女尘 / 星星 / 雪花 / 表情 / 气泡 / 幽灵 / 落叶 / 月光 / 蚂蚁队列 / 跟随圆点；**这才是"会动的光标"**。
- **点击特效** EFFECTS：烟花 / 星芒 / 涟漪 / 彩纸 / 爱心 / 冲击波 / 雪爆。
- **配置**：模块级 `Config`（10 项，全部 `group: '光标'` 的扁平分组）→ 设置面板独占一个一级页「光标」；页面自绘（`settingsNav` + `settingsGroup/光标` `mode:'replace'`），照 plugin-manager / plugin-agent 的做法。
- **分层**：纯逻辑在 `engine.ts`（粒子配方/帧推进/图标→SVG），渲染在 `CursorEffectOverlay.vue`（注册 `overlay` 槽），图标来自 Iconify 聚合的真实图标集（Lucide/Solar/Phosphor/MingCute/Remix）。

**踩到的三个真坑（都在真浏览器里实测定位）**：
1. **canvas 像素缓冲一直是 300×150**（容器 1280×720）——挂载那一刻量不到真实尺寸，粒子画在缓冲之外、完全看不见；跟随元素是 DOM 定位不看 canvas，所以它照常工作、把问题掩盖了。改由 **ResizeObserver 驱动尺寸**。
2. VueFlow 会在 pane 的 pointerdown 上 `stopPropagation` → 冒泡阶段收不到点击（**跟随正常但点击特效不出来**）。改成**捕获阶段**监听。
3. 卡顿三因：每粒子 `shadowBlur` 光晕、拖尾每帧全画布涂抹、连点粒子无上限。改：光晕换成**预渲染精灵** blit、粒子加**硬上限**、无内容跳过绘制。

**验证**：单测 26/26（engine 16 + catalog 10）全绿；`tsc` 干净、`vue-tsc` 只剩 canvas-render 既有 3 条（其它插件同样）；UMD 打包 48KB（只 external Vue + MiniCanvasRender）；真机跑通——插件管理默认装好、设置页 32 个选择块渲染、画布上指针跟随 + 彩虹拖尾 + 连续点击烟花都正常。

**Demo（并行产出，供挑样式）**：`C:/Users/Administrator/.codex/visualizations/2026/10/04/01a105c3-.../cursor-effects-demo.html`。



**用户报的问题**：
1. 把主题（亮/暗）也收进 config，作为 render 库的一项配置；
2. 改完设置 clouds-server 的 .mini-canvas/settings.json 确实在变，但**刷新页面又回到旧值**。

**根因（问题 2）**：启动时序错位。宿主的顺序是「先按**本地**存档 restore 画布与配置，再装外部插件」；
settingsPersist 桥的 restore() 跑在插件装载**之前**，读的是本地后端。而 plugin-cloud-client
是在 apply() 里才把 config 域切到云端的 —— 切完之后**没有任何人重读**，于是云端已保存的设置永远进不来，
页面显示的一直是本地那份（本地没存过 → 全部回落 schema.default）。

**修法**：
- SaveService 新增 onAdapterChange(cb)：useAdapter / useAdapterForAll 换后端时广播「哪个 type 换了」；
- settingsPersist 桥在 restore() 里订阅 onAdapterChange，只在 type === 'config' 时**重读新后端**：
  新后端有存档 → 以它为准注入 store；新后端还是空的（首次上云）→ 把当前值整份推上去，别把云端当空覆盖本地。
  这样「本地先恢复、云端后接管」这条启动路径闭环。

**问题 1 的做法**：新增 canvas-render/src/contracts/themeModeSettings.ts（与色板同一套语义）——
把「主题模式 light/dark」作为**渲染层配置**收进 settings 单一数据源（key=themeMode，分组「常规/外观」，
默认暗色），由 createMiniCanvasHost 声明 + installThemeMode 把值落到 html 的 dark class；
成品应用 ui.ts 的 state.theme 改成它的镜像（bindThemeMode 订阅），右上角调色板 toggleTheme() 改**写设置**，
于是切换既即时生效、又随 settingsPersist 一起持久化（刷新不再回退到暗色）。
注：这不违反「不要给单个插件发明 theme 配置项」（那是禁止按插件各切各的主题）；这是**全应用唯一**的开关，
见 docs/代码开发/主题与配色.md §3.3 的允许情形。

**验证**：canvas-data 362/362（新增 2 条：换后端重读 / 首次上云推本地，先写测试确认无修复时红）；
canvas-render 新增 themeModeSettings.test.ts 7 条 + createMiniCanvasHostPersist 补 1 条（跨 boot 恢复），
host 包 typecheck 干净（余下 2 条红是用户 WIP）；ui 新增 1 条（调色板写 settings），
余 1 条红是用户 WIP（maxZoom 默认改 3、测试仍期望 2）；kernel / plugin-cloud-client 全绿。

### 最近完成（2026-10-04，导出插件修三个问题：多选标记照进图 + 选中导出缺标题 + 标题发白）

**用户报的问题**（`plugin-canvas-export`，Ctrl+Shift+E 导出选中节点）：
1. 导出图左上角的圆形多选标记没被剔除；
2. 右上角图片没有标题 —— 标题条画在卡片上缘之外，被裁掉了。

**根因一（多选标记）**：导出用的 html-to-image `filter` 只认 `data-id` 成员判定和一份写死的调试类名；
`BaseNode` 的 `.v2-multi-radio`（以及端口球 `.moving-handle-anchor`、resize 拖柄 `.resize-handle`）
没有任何「别截我」的标记，于是被照进图。

**根因二（缺标题）**：`NodeLayoutService` 的节点矩形**只覆盖卡片本体**，不含标题；
标题条画在卡片上缘外 `titleOffset + 标题高` 处。`planExport` 的 selected 分支把范围算成
「选中节点包围盒 + padding」，上方没留任何空间 → 标题整条被裁。

**改法**：
- 新增通用剔除类 `mc-export-ignore`（`exportGeometry.EXPORT_IGNORE_CLASS`）：任何元素（含子树）
  挂上它，导出时整棵跳过。导出插件的 filter 认它；主题侧给多选圆点 / 端口锚点（MovingHandle 根）/
  resize 拖柄挂上。插件作者给自己的浮层加这一个类即可，导出插件不必知道主题内部类名。
- `planExport` 新增 `topPadding`：只在**上边**外扩一段「标题带」（`EXPORT_TITLE_BAND(20)` +
  主题 `titleOffset`），full / selected 两种模式都生效；缺省 0 = 与旧行为逐字一致。

**验证**：plugin-canvas-export 70/70（新增 8 条：expandRectTop、topPadding、ignore 类语义）、
plugin-theme-default 248/248（更新 resize 精确类断言 + 新增 4 条标记契约）、plugin-multi-select 152/152
全绿；export / theme 两包 typecheck 干净；`pnpm -C packages/plugins/plugin-canvas-export build` 通过
（UMD 产物已含 `mc-export-ignore` 与 `topPadding`）。
（注：ui 包的 `themeColorHygiene`（`packages/ui/_mm.ts`）与 `canvasToggles`（maxZoom）2 条红是
用户既有 WIP，与本次无关。）

**追加（同日，第三个问题：导出图标题发白看不清）**：用户报「这边你的文字颜色也需要进行一个修改」。
根因（截图取色实测）：节点标题色来自主题 token `--canvas-node-text-muted`，**跟应用主题走**；
应用在**暗色主题**时它是 `#919191`（浅灰），而导出插件**永远**按自己的设置画亮色底（默认 `#f8fafc`）
—— 浅灰标题落在亮底上几乎看不见。

改法（最小改动，不动主题默认）：导出是亮底，导出期间临时把标题色 token
（`--canvas-node-text-muted` / `--canvas-node-text-strong`）盖成深色（注入一条 `<style>`，
导出结束 finally 移除；画布期间被遮罩盖住，用户看不到换色）。
**验证**：plugin-canvas-export 70/70；typecheck 干净；UMD 重新构建（含 `canvas-export-text-style`）。

### 最近完成（2026-10-03晚，多选插件：概念统一 + 主题配色 + 修「多选后还能拖出连线」）

**用户报的问题**：
1. 多选后，框内节点的连接线依然能拖出来（已把 moving handle 隐藏了仍不行）。
2. 概念统一：拖拽时画出来的叫「绘制框」；选中后出现的（两条线）叫「多选框」。绘制框可设线型/线宽/填充；
   多选框两条线各自可设线型/线宽/圆角/填充；颜色都希望能「删掉 → 回落主题色」，且统一放到
   「常规/主题配色」与「常规/暗色主题配色」（原来多选框的外框颜色在「布局/多选」里，要挪走）。

**问题 2 的根因（浏览器实测）**：多选时端口按钮确实隐藏了（opacity:0，符合预期），
但端口的吸附接收区 .port-follow-zone 仍然 pointer-events:all、尺寸 87×176 ——
鼠标按住那块透明区域照样起手拖线（实测建出 1 条边）。根因是 shouldShowHandles 只控制按钮 opacity，
接收区从不吃这些压制条件。

**修法**：BaseNode 把几条硬压制（多选 / 抓手 / 低细节 / 拖节点中 / 拖线中 / 本节点是拖线源）抽成
handleBlocked，传给 MovingHandle 的 :blocked；MovingHandle 加 is-blocked 样式把
anchor / 接收区 / 按钮一起 pointer-events: none !important。实测多选下 zone PE=none、拖拽建边 0 条。

**问题 1 的做法**：
- 概念统一：配置键与文档改用「绘制框 boxSelect / 多选框外框 outer / 多选框内框 inner」三个词。
- 绘制框新增三项配置（线型 / 线宽 / 填充%；颜色走主题）。
- 颜色统一收进主题配色：themePalette 新增三个 token —— 绘制框颜色 / 多选框-外框颜色 /
  多选框-内框颜色（两格制：常规/主题配色 + 常规/暗色主题配色），并标 optional: true。
- 颜色支持删除：ColorField 加 clearable（选色器里多一个「清除（改用主题色）」按钮，值可写空串）；
  kernel 的 color 校验支持 optional（空串合法）；resolveThemeColorOverrides 见到空串登记为「清除」，
  installThemePalette 清掉内联变量 → 回落 CSS 默认（即主题色）。
- 多选插件自己的两个颜色配置项移出设置面板（键保留用于存自定义色，页面上不再出取色器 ——
  颜色统一在主题配色里调）；frameStrokeCss 颜色缺省时走传入的主题变量。

**验证**：真机实测 —— 多选拖拽建边 0 条、三个新 token 已登记在两个主题配色分组、
改色跟随 + 清除后内联变量被清掉回落主题默认。单测：multi-select 152、canvas-render 406、
kernel 212、theme-default 244 全绿；theme-default / multi-select typecheck 干净。
（注：canvasInteractionSettings 2 条红仍是用户 WIP —— selectNodesOnDrag / maxZoom 改值未同步测试。）

### 最近完成（2026-10-03，plugin-web2api-tools 改成可装卸）

**用户要求**：把 packages/plugins/plugin-web2api-tools 做成能安装/卸载的插件。

**做了什么**：
- 加 vite.config.ts（走共享表 ../vite-plugin-lib）+ build 脚本 → 打出 dist/plugin-web2api-tools.js（25.8 KB）。
- miniCanvas 标记 builtin: true → installable: true。
- 从 ui 的 APP_PLUGINS 冷启动清单移出（改由插件管理安装，默认已装）；清单 12 → 11。

**为什么它好装**：运行时依赖全是 import type（打包时擦除），零 Vue —— 干活靠 ctx.tryGet('nodeBar') 与 ctx.get('tools')。

**顺带回答用户的疑问（为什么不写进 inject）**：
- tools 是内核自带（Context.builtinService 里 if (name === 'tools') return this.builtinTools），依赖检查天然通过；
  写进 inject 只是表达意图（tool-image-generation 就写了），功能上等价。
- nodeBar 是插件服务（plugin-bottom-bar 提供）。刻意不写 inject：写了就会「底栏没到 → 整个插件卡 PENDING」。
  它改用 tryGet 探测 + 监听 ctx:plugin-installed 自愈（底栏晚到就补注册），所以谁先谁后都能用。
  这在改成异步逐个安装之后尤其关键 —— 装载顺序不由我们控制。

**验证（真机）**：装上且 state=active、不再是 builtin；底栏动作齐（图片 7 / 视频 9 / 音频 2 条）；
卸载后动作归零 7→0、重装后回来 0→7；零报错。清单：自带 8 + 可装卸 16 = 24。
单测：plugin-web2api-tools 51、ui 73（entrypoint / web2apiAssembly 均通过）；typecheck 干净。


### 最近完成（2026-10-03下午，插件管理页列出**全部**插件：自带只读、可装卸带按钮）

**用户要求**：`packages/plugins` 里还有一批插件没分离（图片/音频等节点、web2api 等）；
**即使自带的插件也要显示出来，但不显示安装/卸载按钮**。

**做了“显示”这一半**（拆包那一半待定，见下）：
- 插件 `package.json` 加 `miniCanvas.builtin: true` 标记自带件（theme-default / bottom-bar /
  node-text / node-image / node-video / node-audio / node-3d-preview / web2api-tools / agent）。
- `cloud-server` 的 `buildPluginCatalog` 收录两类：`installable`（可装卸）与 `builtin`（自带）。
  **自带件只需 package.json，不要求有 UMD 产物**（它由应用冷启动装配、不经清单加载）。
- 插件管理页分两段展示：「自带（随应用启动，不可装卸）」只读列表 + 「可装卸」带 安装/卸载/重装。
- 自带件在服务层也硬兜底：`install/uninstall/reinstall` 对 builtin 行直接 return（不给按钮之外再加一道）。

**结果**（真机实测）：清单 3 → **24** 条 = 自带 9 + 可装卸 15；
自带段 9 行 **0 个按钮**（徽章「自带」），可装卸段 15 行 **15 个都有按钮**（徽章「已安装」）。

**验证**：cloud-server 217、plugin-cloud-client 116、canvas-render 404、ui 73 全绿；两个包 typecheck 通过。
（注：`canvasInteractionSettings` / `themeColorHygiene` 的 2 条红是用户既有 WIP —— selectNodesOnDrag/maxZoom 改值
与 `packages/ui/_mm.ts` 的写死颜色，与本次无关，已核实。）

**待定（已问用户）**：是否继续把节点类（图片/文本/视频/音频/3D）与 web2api 也拆成可装卸。
风险点：冷启动会把默认画布的两个示例节点（text+image）直接种进 store，而节点类型由插件注册；
改成运行期安装后种子会早于类型注册 —— 需要一并改 seed 时序。


### 最近完成（2026-10-03，修 bug：外部安装插件后 Shift 框选失效）

**用户报告**：多选插件的 Shift 框选功能，在以「插件管理」方式安装后失效了。

**根因**（浏览器实测定位，非猜测）：`CanvasSurface` 的 VueFlow 挂在 `:key="nodeEpoch"` 上，
而**插件每装/卸一个就 bump nodeEpoch → 整棵 VueFlow 子树销毁重建 → pane 是个新 DOM 元素**。
但 `flow.pane` 只在 `onMounted` 捕获一次、之后再不更新 → 插件（多选的 BoxSelectLayer）把
pointerdown 监听绑在了**已脱离文档的旧 pane** 上 → Shift 框选永远收不到事件。
冷启动时插件在 VueFlow 挂载**之前**就注册好（只重挂一次），所以那条路看着正常 ——
一旦改成运行期逐个安装插件（每个触发一次重挂），问题才暴露。

**修法**：`CanvasSurface` 新增 `refreshFlowDom()`（重新捕获 pane/renderer/paneRect），
并 `watch(props.nodeEpoch)` 在重挂后（`flush: 'post'`）重新捕获 + 重新 `attachDom`，
把新 pane 灌进 `flow.pane`。

**佐证**：`multiselect-regression` 新增场景 H（Shift 拖框选本身 —— 此前所有断言都是先
`selection.set` 预置选中，这条真实手势路径从没被测过）。**把修复临时回退后 H1/H2/H3 精确变红**，
恢复后 38/38 全绿；canvas-render typecheck 干净。

**顺带**：此前 `packages/plugins` 里 12 个「布局 / 画布工具」插件（参考线 / 小地图 / 多选 / 分组…）
已改成可装卸（经插件管理从云服务清单安装），并各自补了 UMD 构建；共享打包配置收进
`packages/plugins/vite-plugin-lib.ts`（external/globals 唯一事实源）。清单从 3 → 15 个。


### 最近完成（2026-10-03，插件管理里的插件从 3 个扩到 15 个）

**用户反馈**：插件管理页里太少了 —— 插件目录里明明有很多（参考线、小地图这些布局类），
「除了一些必须自带的插件，其他都该做成这种（可装卸）方式」。

**做了什么**：把 12 个「布局 / 画布工具」类插件也改成可装卸（经插件管理从云服务清单安装，默认已装）：

| 插件 | 说明 |
| --- | --- |
| align-guide / align-arrange / auto-layout | 参考线 / 对齐排列 / 自动布局 |
| mini-map / node-find | 小地图 / 节点搜索 |
| edge-cutting / multi-select | 连线切割 / 多选 |
| group / context-menu / clipboard | 分组 / 右键菜单 / 复制粘贴 |
| canvas-export / file-drop | 导出图片 / 文件拖入 |

**怎么做的（三件）**：
1. **共享打包配置** `packages/plugins/vite-plugin-lib.ts`：external / globals / 产物名收成一处
   （此前几个打包过的插件各写一遍，极易漂移 → 插件「加载了却没装上」还不报错）。12 个插件补上
   `vite.config.ts` + `build` 脚本，打出 UMD。
2. **host 全局补齐**：ui 的 `sharedGlobals.ts` 补 `MiniCanvasKernel`（含 `VueFlow` /
   `ProseMirrorEditorBundle`），供 UMD 插件取依赖；守卫测试逐条核对两边一致。
3. **dev 期清单**：新增 `packages/ui/catalogPlugin.mjs`（vite 插件，仅 dev）——
   在 ui dev server 就地实现 `/plugin-catalog.json` + `/plugins/**`，判定口径与 cloud-server 一致。
   这样单开 `pnpm -C packages/ui dev` 也能用插件管理；生产形态仍由 cloud-server 提供同两条路由。

**结果**：清单 3 → **15**；冷启动装配 24 → 12（只剩画布骨架 + 节点类型 + Agent + 插件管理本身）。

**验证**：dev server 与真 cloud-server 两种形态都用真浏览器跑过 —— 15/15 默认装好、
`nodeBar/mini-map/group/multi-select/clipboard/file-drop` 服务全在、58 条命令、控制台零报错。
单测：ui 73、cloud-server 216、plugin-cloud-client 114、canvas-render 404、kernel 212、canvas-data 360 全绿。


## 一、现在该做什么（2026-09-17）

### 最近完成（2026-10-02，KV 收进单个 settings.json）

**用户要求**：别一个 type 一个目录、一个 key 一个文件。直接一个 settings.json，
里面按 type 分桶：`{ "config": {...}, "shortcut": {...} }`。

**改法（服务端 `cloud-server/src/store/kvStore.ts`）**：
- 落盘从 `kv/{type}/{key}.json` 改成**一个 `{dir}/settings.json`**，内容 `type → key → value`；
- 对外契约**没动**：HTTP 仍是 `/api/kv/:type/:key`、SSE 事件形状不变 ——
  客户端（含 CloudKvAdapter）一行没改，改的只是磁盘怎么放；
- **写必须整体串行**：以前一项一文件可以按 (type,key) 各排一条链；现在全落同一个文件，
  读-改-写必须串行，否则并发写会各读同一份旧内容、互相覆盖（丢配置）。新增并发写测试锁这条；
- 旧布局**自动迁移**（认两种历史形态：`kv/{type}/{key}.json` 与最早的 `kv/{type}%3A{key}.json`），
  只搬 config / shortcut（canvas / resource 早有各自目录），搬完把旧目录改名 `kv.migrated` 留作备份。

**顺带删掉的死代码**：`kvFileName` / `kvTypeDir`（只为"一项一文件"的文件名转义服务，已无用途）。

**实测（真服务）**：老数据自动迁移成功 ——
  `.mini-canvas/settings.json` = `{"config":{"plugin-manager:installed":[...],"settings":{"imageFitMaxWidth":321}}}`，
  旧 `kv/` 已改名 `kv.migrated`。
单测 cloud-server 190（新增并发写 2 条、迁移 5 条），其余包全绿；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，磁盘落盘布局改成人肉可读 + 命名更诚实）

**用户指出的问题（两条都成立）**：

**① KV 文件名丑得认不出内容**：老实现把 type 与 key 拼成一条文件名再整串转义 ——
   `config%3Asettings.json`（`%3A` 就是冒号）。用户原话："它不支持冒号，你用横线或者下划线来替代呀。
   你不能用这个东西啊"。
   **修**：改成 **type 当目录、key 当文件名** —— `kv/config/settings.json`。
   目录名天然不含冒号（四个 type 都是合法文件名），于是只有 key 需要转义；
   而真正带冒号的 key 只剩命名空间式的（`plugin-manager:installed`），转义面小到几乎看不见。
   新增 `kvTypeDir(dir, type)`；`kvFileName(key)` 参数从 `(type,key)` 收成 `(key)`。
   **老文件兼容读 + 自动搬迁**：读不到新路径时回退旧路径，读到就 rename 到新位置 ——
   否则用户已有的设置会因为换布局而凭空消失（实测：老 `config%3Asettings.json` 读得到值，
   并在同一次读里被搬成 `config/settings.json`）。

**② `CanvasAdapter` 名字怪**：它干的是"只发差异"（不整包覆盖，专治 AI 与用户并发写互相盖掉），
   名字却没说这件事。**修**：改名 `CanvasDiffAdapter`（文件同步改名 `canvasDiffAdapter.ts`），
   旁边算差异的 `graphDiff.ts` 与之成对。

**验证**：新增 3 条旧布局兼容读测试（老文件读得到并自动搬迁 / 新布局优先 / 两边都没有 → undefined）；
单测 cloud-server 188、cloud-client 114、canvas-data 360、canvas-render 404、ui 67、node-image 111、
node-video 105、file-drop 42、clipboard 22 全绿；真机验证老文件自动迁移；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，接口拆细 + 配置也上云）

**用户提出的两个问题（都成立，都已改）**：

**① 接口臃肿**：把「资源（二进制）」硬塞进 StorageAdapter（与文本的 get/set/remove 同一个 interface），
   导致两个资源适配器被迫实现三个只用来抛错的方法。用户原话："资源可以单独配置、单独实现一个 adapter，
   而不是每一个 adapter 里面都必须包含这些类 —— 这不就臃肿了吗"。
   **修**：拆成两个接口 —— StorageAdapter（key-value：配置/画布/快捷键）与
   ResourceAdapter（字节流：putResource / resolveResource / removeResource）。两者只共享 id / capability。
   两个资源适配器删掉抛错方法，各只剩自己那三个；ResourceStore 不再需要 as never 强转。
   save.adapters 用联合类型，useAdapterForAll 遇到资源适配器只铺 resource 那一格。

**② 配置没上云**：云插件原来只换 canvas / resource 两格，config / shortcut 留在浏览器 local ——
   换台机器设置与快捷键全丢。用户要求："云端的时候 config 和快捷键等配置也直接使用云端的设置"。
   **修**：新增 CloudKvAdapter（走 cloud-server 的 /api/kv/:type/:key，服务端本就支持这两类），
   装云插件时把 config / shortcut 两格也切过去。404 = 从未保存过 → undefined（与本地语义一致）。

**验证**：新增 5 条 CloudKvAdapter 测试（URL 正确 / 404→undefined / 删除幂等 / 两域互不干扰 / 5xx 抛错）；
单测 canvas-data 360、canvas-render 404、ui 67、cloud-server 185、cloud-client 89、node-image 111、
node-video 105、node-audio 90、file-drop 42、bottom-bar 85、kernel 212 全绿；
真机：云端改一个设置 → 服务器 kv 目录出现 config 文件且值正确；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，插件管理插件 + 本地中转后台）

**用户诉求**：做一个能**安装 / 卸载 / 重装**第三方插件的「插件管理」插件，它自己带一个**自定义设置页**
（插槽实现，照 plugin-agent）；第三方插件经「请求 JSON 清单拿 js 地址 → 加载那个 js」装载（同 cloud-server 的
`/plugin-manifest.json`）；后台放哪还没定，先做一个**本地临时中转后台**；`packages/ui` 里注释掉一部分插件，
改由插件管理安装，**默认全部设为已安装**。

**加载方式（用户选 A）**：宿主暴露全局 + 加载 UMD —— `ui` 把 `Vue / MiniCanvasCore / MiniCanvasRender /
MiniCanvasBase / VueFlow` 挂 `window`（`src/sharedGlobals.ts`），中转站直接发已有的 UMD 产物，
插件管理用 `<script>` 装载。改动最小、复用现有打包。

**交付两件**（原独立的 `plugin-relay` 包已删，功能并入 cloud-server）：
- `packages/cloud-server`（加两样）：`GET /plugin-catalog.json` 给「插件管理」的清单（只收录**声明了
  `miniCanvas.installable` 的 UMD 插件**，避免与冷启动装配的基础件撞名）；`GET /plugins/**` 发插件资源
  （js/css/图片/字体，子目录也支持）。与既有的 `/plugin-manifest.json`（ESM，给应用冷启动用）分工并存。
  实现见 `src/plugins/catalog.ts` + `static.ts`。
- 插件管理：设置面板「插件」页（`settingsNav` + `settingsGroup/插件` 两个槽）+ 服务
  （清单/已装状态/装·卸·重装）。首次无存档 → 默认全装；之后照存档（卸过的不自动回来）。装/卸走宿主新注入的
  `pluginManager` 服务（`createMiniCanvasHost` 多一行 `ctx.inject('pluginManager', manager)`）。默认清单地址
  是同源 `/plugin-catalog.json`。**它已并入 `packages/plugins/plugin-cloud-client/src/manager/`**
  （原独立包 `plugin-manager` 已删；仍是可独立装卸的插件，导入路径 `.@mini-canvas/plugin-cloud-client/manager`）。
- `packages/ui`：`main.ts` 先 `exposeSharedGlobals()` 再挂载；`assembly.ts` 注释掉 `node-image-compare /
tool-image-generation / tool-text-generation`（改由插件管理装），加 `pluginManagerPlugin`；清单 25 → 23。

**验证（单测 + 真服务 + 真浏览器）**：cloud-server 185、plugin-cloud-client 114、kernel 212、canvas-data 360、
canvas-render 404、ui 67 全绿；三个插件默认装上、卸载「图片对比节点」后节点类型消失、重装后回来、
刷新照存档、控制台 0 报错。见 `docs/superpowers/plans/2026-10-02-plugin-manager-and-relay.md`。

### 最近完成（2026-10-02，资源存储改造的 code review 复查 + 同类问题清查）

按 code-review 技能起两个并行子代理（Standards / Spec 双轴）复查本次改动，两个代理**独立**报出了同一批问题。
逐条验证后修掉 3 个真缺陷：

1. **视频截图往节点里写 base64**（最严重，两轴都报）：captureFrameNode 直接写 imageUrl: frame.dataUrl（无 resourceId），
   而保存时的清洗只删「blob:」与「带 resourceId 的 data:」—— 这张图会原样落进云端 canvas.json。
   修：截图走资源库（persistImage → put/resolve），与图片上传同一条路。
2. **AI 生成出图落盘时 persistImage 根本没注入**（Standards 轴报出）：createImageOpsWriteDeps 漏了这项，
   而 ImageRunDeps.persistImage 与 ImageOpsContext.persistImage **同名不同签名**（url:string vs blob:Blob），
   于是生成工具回的 dataURL 永远不进资源库 → 云端画布出现 base64。修：补上注入，并给两处签名写清区别。
3. **首次上云静默丢图**（Spec 轴报出）：pushLocal 整包直推本地节点，但资源 adapter 在装载时**已经**换成云端，
   本地 IndexedDB 的字节够不着 → 节点上的本地引用与 blob: 地址在云端两头落空。
   修：换 adapter **之前先抓住本地那个**，上云时用 migrateLocalResources 逐个取字节传云端、换 res。<哈希>。

另外清掉三处**误导性/死代码**：
- ResourceStore.register() 已无生产调用者，且旧实现会「偷偷 put 一次」导致**返回的 id 与实际落库引用不一致**
  （拿着 id 查不到东西、还留孤儿字节）—— 改为诚实的「只登记显式 url」，注释写明刷新即失效。
- 删除上一轮遗留的 embeddedResources 引用与过期注释（canvasAdapter 那段已不再上传，只收回引用）。
- API 手册 docs/代码开发/canvas-data/存储SaveService与Adapter.md 补上「两种形式（文本 / 资源）」与 adapterOf。

**验证**：新增回归测试 7 条（截图不写 base64 1 条、首次上云迁移 5 条、register 语义调整改 1 条）；
单测 canvas-data 360、canvas-render 404、ui 65、cloud-server 171、cloud-client 83、node-image 111、
node-video 105、node-audio 90、file-drop 42、clipboard 22 全绿；真机：上传 826KB 图 → 磁盘落文件 →
刷新后渲染 600px 宽、画布无 base64、控制台 0 报错；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，资源存储收进 StorageAdapter：一个开关管两种形式）

**用户的设计（也是本次落地）**：配置 StoreAdapter 的地方**统一决定数据存哪**，它管两种形式 ——
文本（JSON）与资源（二进制：图片/视频/音频）。本地装本地版、云端装云端版，一个开关。

**之前为什么不对**：文本那个开关做对了（`save.useAdapter('canvas', …)`），资源那个**写死在构造时**
（`new ResourceStore(urlBackend, createIndexedDbResourcePersistence())`），云端够不着它 → 资源永远进
浏览器 IndexedDB。于是本地落盘清掉 `blob:` 后，推给云端的节点里只剩一个**指向浏览器库的** `resourceId`，
服务器既没字节也没地址（复现实测：一次 `/resources` 上传请求都没发）。

**改法**：
- `StorageAdapter` 补上**资源形式的孔位**：`putResource(blob) → ref`（只回引用，**不回 URL**）、
  `resolveResource(ref) → url`（现算显示地址）、`removeResource(ref)`。
- `ResourceStore` 不再自己攥后端，改成**现取**：`new ResourceStore(() => save.adapterOf('resource'), …)`。
  于是 `save.useAdapter('resource', 云端资源适配器)` 一换，资源就跟画布走同一个开关。
- 本地版：新增 `IndexedDbResourceAdapter`（写入库、`resolve` 现建 **objectURL**）。
- 云端版：新增 `plugin-cloud-client` 的 `createCloudResourceAdapter`（POST 上传 → 回 `res:<哈希>`；
  `resolve` 拼服务器地址，不下载字节）。
- 上传/生成调用点（image / video / audio / file-drop / 生成面板）统一改成 `await resources.put(blob, {kind})`
  + `await resources.resolve(ref)`。
- **删除**上一轮那段「保存时扫描节点、按 resourceId 取字节重传」的补丁（`embeddedResources.ts`）——
  字节在上传那一下就已经存好了，保存路径不再做任何上传。

**两条不变量（用户强调）**：① 节点里**只存 ref（ID）**，绝不存 URL；② **URL 永远是现算的**
（本地每次刷新都是一个全新的临时 objectURL，旧的自然作废；云端由内容哈希拼出稳定地址）。

**验证（真服务 + 真浏览器）**：`pnpm build:assets` → `pnpm serve`（:8865）→ 点上传一张 1.65MB PNG：
| 检查点 | 结果 |
| --- | --- |
| 上传那一下 | `POST /api/canvases/default/resources?name=upload-test2.png` ✅ |
| 服务器磁盘 | 新增 `resources/f27d88fc2049cfb2.png`（1.65MB）✅ |
| 节点 | `imageUrl = res:f27d88fc2049cfb2.png`（只有引用）✅ |
| 画布 JSON | 无 base64 ✅ |
| 刷新后 | 图片渲染 800×600、控制台 0 报错 ✅ |
| 本地 IndexedDB | **未被写入**（云端模式不再碰本地库）✅ |

单测：canvas-data 360、canvas-render 404、ui 65、cloud-server 171、node-image 111、
cloud-client 78、node-video 105、node-audio 90、file-drop 42；云端 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，云端上传图片真的落盘了 + AI 建节点也用自增数字）

**用户报的问题**：云端环境下上传图片，刷新后图片不见了；本地 `canvases/default/resources/` 里没有对应文件。

**真根因（用真服务 + 浏览器自动化复现，拿到确凿证据）**：本地落盘时 `sanitizeTransientResourceUrls` 会清掉
`blob:` 地址（那是会话级地址），于是推给云端的那份节点里**只剩 `resourceId`** —— 而它指向浏览器的
IndexedDB，服务器读不到。上一轮的"保存时把 base64/blob 转文件"只覆盖了"字段里还有内嵌地址"，
**完全没覆盖"只剩 resourceId"这条真实路径**，所以一次上传请求都没发（实测 `资源相关请求：[]`）。

**改法（走资源自己的路径，不在字段层打补丁）**：保存前若节点带着 `resourceId` 而资源字段是空的，
就**按 id 从宿主资源库取出字节** → 上传成画布资源文件 → 换 `res:<hash>` 写回该节点类型对应的媒体字段
（image→imageUrl、video→videoUrl、audio→audioUrl…，按类型映射，不再一律塞 imageUrl）。
同一张图按 resourceId 缓存、只传一次。首次上云的整包推送走同一道处理。

**用户同时要求**：AI 建节点**不必自己指定 id** —— 交给服务端发号、在 `added` 里回传。
已改：cloud-server 的 `newNodeId` 从 `ai-随机` 改为**自增数字**（与网页端同一套规则，取现有最大 + 1、跳过已占用号）；
MCP 工具描述同步更正。

**验证（真服务 + 真浏览器，按用户给的启动方式）**：
`pnpm build:assets` → `pnpm serve`（:8865）→ Playwright 打开画布 → 选中图片节点 → 点上传 → 塞入 1.65MB 真 PNG：

| 检查点 | 结果 |
| --- | --- |
| 触发了资源上传 | `POST /api/canvases/default/resources?name=asset.png` ✅ |
| 磁盘落文件 | `canvases/default/resources/56f9baac44b0805e.png`（1.65MB）✅ |
| 磁盘 canvas.json | `"imageUrl":"res:56f9baac44b0805e.png"`，**无 base64** ✅ |
| 刷新后 | 地址展开为真 URL、`<img>` 渲染出 800×600 ✅ |
| 控制台 | 0 报错 ✅ |

新增失败测试 2 条（`canvasAdapter.test.ts` 的"只剩 resourceId 也要传上去""同一张图不重传"）先红后绿。
单测：cloud-server 171、cloud-server e2e 30 PASS / 0 FAIL、canvas-data 360、canvas-render 404、ui 65、
node-image 111、file-drop 42、clipboard 22、group 47 全绿。

### 最近完成（2026-10-01，节点与边的 id 统一成自增数字）

**用户诉求（原话）**：节点 id 用数字替代；每次添加节点 / 复制粘贴 / 拖资源进画布，新 id 自增；
连接线同理。插件各写各的 id 形态，画布里五花八门 —— 画布应提供「取当前最新 id」的方法，谁要 id 都向它要。

**根因**：内核**本来就有**自增数字（`NodeStore.createNodeId`），但只有「不指定 id 建节点」这条路会用到；
而插件偏偏都要**先拿到 id**（拿到才能连边、才能选中），于是各造各的：
`fd-时间戳-序号`（file-drop）、`原id-copy-时间戳-随机`（clipboard）、`group-时间戳-序号`（group）、
`temp-menu-时间戳`（context-menu）；边则是 `e-源-目标`（由端点派生）。

**改法**：把「取下一个可用 id」收进 `doc` 门面 —— `doc.nextNodeId()` / `doc.nextEdgeId()`，
**先拿号、再占号**（拿到就标记为已用，跳过已在存的号）。所有插件改向它要：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| file-drop 拖入/粘贴文件 | `fd-时间戳-序号` | `doc.nextNodeId()` |
| clipboard 复制粘贴 | `原id-copy-…` | `doc.nextNodeId()`（`remapSnapshot` 改为**必须**注入生成器，删掉会自造 id 的默认实现） |
| group 打组 | `group-时间戳-序号` | `doc.nextNodeId()`（删掉 `createGroupId`） |
| context-menu 临时菜单节点 | `temp-menu-时间戳` | `doc.nextNodeId()` |
| 边（内核 `EdgeStore`） | `e-源-目标`（端点派生） | 自增数字 + `nextId()` |
| 边（cloud-server MCP） | `e-{source}-{target}` | 自增数字（取现有最大 + 1） |

**连带的两处语义调整**（id 不再由端点派生，就必须显式做这两件事）：
1. **边去重改看「连接本身」**（端点 + 端口），不再靠「同端点算出同一个 id」—— 内核 `EdgeStore.addEdge`
   与 cloud-server `batchEdges` 都改成按端点键去重，否则同一条线连两次会画出两条重叠的边；
2. **回填后重建计数器**（`replaceAll` 后把计数器抬到存量最大值之后），刷新恢复的图里有 1/2/7 时，
   下一个必须是 8，不能撞已有节点。

**顺带清掉的死代码**（都是被取代后没人再用的）：`edgeStoreId`（canvas-data）、`edgeId`（canvas-render，
及其导出与两条测试）、`createGroupId`（group）、`defaultIdGenerator`（clipboard）。

**验证**：新增 `docService.test.ts` 的「统一 ID 分配」5 条（自增、跳过已占用号、节点与边各自独立计数、
replaceAll 后计数跟上、批量分配互不相同）+ `edgeStore` 的 `nextId` 与按端点去重用例。
单测：canvas-data 360、canvas-render 404、cloud-server 171、plugin-clipboard 22、plugin-group 47、
plugin-file-drop 42、plugin-context-menu 53、其他包全绿。**真浏览器实测**（`pnpm -C packages/ui dev`）：
常规建节点 → 复制粘贴得到 3/4/5/6 → 拖入文件 7 → 打组 8，边是 1/2，**全是自增数字**；云端 e2e 30 PASS / 0 FAIL。

### 最近完成（2026-10-01，图片资源改为「字节进库 + 引用」；云端不再存 base64）

**用户诉求（原话）**：本地保存图片改用 DB 数据库方式做资源缓存，不再转 base64；
远程也是 base64 不对，应以**文件**形式保存。

**根因（两处，方向一致）**：
1. **本地**：图片上传/裁剪/旋转/扩展把结果转成 dataURL 直接写进 `data.imageUrl`（base64 体积约 +33%，全塞 localStorage）；
2. **云端**：云服务端**本来就是**按内容哈希存文件（`canvases/<id>/resources/<hash>.ext` + `res:<hash>` 引用），
   但 `plugin-cloud-client` 保存前只把「服务器地址」收回 `res:`、**从不上传内嵌字节** —— 节点里的 base64 原样进了云端 `canvas.json`。

**改法**：
- **本地**：图片四条路径（上传 / 裁剪 / 旋转 / 扩展）+「加素材」统一改为
  `File/画布产物 → Blob → 资源库（浏览器为 IndexedDB）→ 节点只留 resourceId + 本会话地址`，与视频/音频同一条路。
  做法：`imageTransform` 的 `cropToDataUrl/rotateToDataUrl/paint` 换成 `cropToBlob/rotateToBlob/paintCanvasBlob`（`canvas.toBlob`）；
  `ImageOpsContext` 新增 `persistImage(blob) → { resourceId, url }`；落盘前的 `sanitizeTransientResourceUrls` 不再按大小删 dataURL（上一轮已改）。
- **云端**：`plugin-cloud-client` 新增 `embeddedResources.prepareNodesForSave` —— 保存前扫九个媒体字段，
  `data:`/`blob:` 取字节 → `POST /api/canvases/:id/resources` 传成资源文件 → 换 `res:<hash>`；同一张图按地址缓存、只传一次。
  **任一字段上传失败就整批不发**（绝不把 base64 落进云端）。「首次上云」的整包推送走同一道处理。
  删除死代码 `resourceUpload.ts`（还指着已废弃的 `/api/files`）。

**顺带修掉两个真 bug**（e2e 实测暴露，不是猜的）：
1. **换机器恢复时 `res:` 没展开** → 浏览器拿 `res:...` 当 URL 渲染，报 `ERR_UNKNOWN_URL_SCHEME`、图不显示。
   修：`CanvasAdapter.getRaw()`（恢复路径专用）读回时展开成当前画布的可请求地址（`get()` 一直有展开，恢复这条漏了）。
2. **云端偶发 500**：`/api/canvas/edges` 报 `EPERM: rename canvas.json` —— Windows 上两个写打同一个目标文件必然 EPERM
   （与 `kvStore` 记的是同一个坑）。修：`canvasStore` 补「同文件写串行」+ rename 对瞬时占用做退避重试，并加并发写回归测试。

**验证**：单测 `canvas-data` 354 / `plugin-node-image` 111 / `plugin-cloud-client` 81 / `cloud-server` 155 全绿；
真浏览器（本地）上传 2.1MB 图 → 节点存 `blob:` + `resourceId`、IndexedDB 有字节、存档无 base64、刷新后图片仍在，控制台 0 报错；
真服务端 + 真浏览器（`pnpm -C packages/cloud-server e2e`）**30 PASS / 0 FAIL**，含「云端画布 JSON 里没有 base64」
「节点存 `res:<hash>`」「resources/ 里是真文件」「换机器图仍能取回」「全程零报错 / 零 4xx」。

### 最近完成（2026-10-01，云端真身：存储改造 + 投递箱 + 任务历史 + 云端客户端插件）

**一句话**：把「生成」整条链从前端搬到 cloud-server —— 页面关了任务照跑，
不打开页面（只走 MCP）也能下单；前端只负责下单与看。**不做兼容，硬切。**

**后台（packages/cloud-server）**

- **存储改成「一个画布一个文件夹」**：`canvases/<id>/{canvas.json, view.json, history.json, resources/}`。
  `canvas.json` 装节点 + 边 + 画布信息；`view.json` 单独放（视图状态）。
  老 kv 的 `canvas:*` key 与 `/uploads/*` **直接下线**（不做兼容读）。
  资源引用改成画布内相对引用 `res:<hash>` —— 复制文件夹 = 复制画布，AI 也能直接读文件。
- **平台「投递箱」**：`providers/` 目录，丢一个 `.js` 就是一个平台（几秒内热重载，删掉即消失）。
  内置 web2api 用**同一套接口**写成第一个 provider。
  `GET /api/actions` 给前端清单（带 ifVersion）。
- **任务与历史**：`POST/GET /api/jobs`、`cancel`、`GET /api/history`（分页 + 汇总）。
  后台跑任务、把进度**写进节点**（走增量口，与网页端共用一把锁）、终态归档一笔历史。
- **MCP 生成三件套**：`generation.actions / create / status` —— 不开页面也能下单。

**插件（新包 packages/plugins/plugin-cloud-client，取代 plugin-cloud-save）**

一个包干四件事、共用一条 SSE：存档 + 实时跟随、拉后台清单**注册进底栏**、
下单/看进度/取消、读历史。**零 import 单文件产物**，经后台清单下发（就是"后台发插件"那条路）。

**前端（packages/ui）**：历史弹窗改读服务（不再写死假数据）；底栏加可选标记
`externalRunState`（云动作的进度由后台写，底栏不重复写）。

**验证**：cloud-server 154 / plugin-cloud-client 76 / plugin-bottom-bar 85 / ui 65 全绿；
真实服务端到端跑通（存储结构、provider 热重载 11→12、下单→节点 runState→历史、
MCP 全程下单、插件零引用产物动态装载）。计划见
`docs/superpowers/plans/2026-10-01-cloud-server-storage.md`，设计见
`docs/superpowers/specs/2026-10-01-cloud-client-design.md`。

### 最近完成（2026-10-01，修「上传图片后刷新就没了」）

**用户报的问题**：在画布上传图片，刷新后图片不见了。

**根因**：图片上传走的是「File → dataURL 写进 `data.imageUrl`」这条路
（`plugin-node-image/src/imageTransform.ts` 文件头写明：**dataURL 落盘、刷新照常显示，这是
「刷新不丢」的前提**；裁剪 / 旋转 / 扩展的产物同样是 dataURL）。而保存前的清洗函数
`sanitizeTransientResourceUrls`（`canvas-data/src/resourceService.ts`）把**超过 64KB 的
dataURL** 也当成临时地址删掉了 —— 上传链路并没有 `resourceId` 这类第二份拷贝可供恢复，
于是这张图**唯一的一份数据被永久销毁**，刷新自然就没了。裁剪/旋转/扩展的图一起丢。

**修法**：清洗只删「页面之外取不回来」的两种地址，且它们都有第二份拷贝兜底 ——
1. `blob:`（object URL 会话级失效，字节已按 `resourceId` 进持久化资源表）；
2. 带 `resourceId` 的 `data:`（字节同样已在资源表里，节点里这份是冗余副本）。
**不再按大小删内嵌 dataURL**：那是这张图唯一的一份。要瘦身请走「登记资源 → 写 resourceId」
那条路，把字节搬进持久化资源表，而不是在保存时销毁数据。

**验证**：新增失败测试（RED → GREEN）钉住这条 —— `canvasBasePlugin.test.ts` 走**真实落盘链路**
（提交回调 → save → 二次 boot 恢复），断言 200KB dataURL 落盘后仍在；`resourceService.test.ts`
补「带 resourceId 的 dataURL 才删 / 不带 resourceId 的必须留」。
真浏览器端到端复现（起 dev server，走 `image.upload` 命令 + `save.flush` + 真刷新）：
上传 2.1MB 随机噪点图（dataURL 2.89MB，远超 64KB）→ 刷新后 `data.imageUrl` 仍是 dataURL、
`<img>` 加载出 900×700、控制台 0 错误。
测试基线：canvas-data **354**、canvas-render 406、kernel 212、theme-default 241、
node-image 111、node-video 105、node-audio 90、file-drop 42、cloud-save 91、ui 65，全绿；
canvas-data / canvas-render / node-image typecheck 干净（ui 仍余 4 个既有报错文件，与本次无关）。

### 最近完成（2026-10-01，音频节点抽成独立插件 + 波形进度条）

**同日第二/三轮修正（用户截图反馈）**：

**同日第四轮修正（用户报 1 个警告 + 3 个 bug）**：

**同日第五轮修正（用户报"滑动失败 + 参考线只有中间一段"）**：

**同日第六轮修正（用户报"拖进度条又拉出来一条波纹"）**：

**同日第七轮修正（用户报"水波纹晃荡 + 后面全是平的"）**：

**同日第八轮（用户提三件事：拖拽静音 / 加整体进度条 / 拖到边缘波纹滚动）**：

**同日第九轮（用户两条修正）**：

**同日第十轮（用户纠正：边框是 hover 才出现，不是常驻）**：
- 第九轮做成了"平时有边框、hover 只换颜色"，理解反了。用户口径是
  **平时看不到边框，hover/拖动上去才出现**。
- 现在 `.aw-knob::after` 平时 `border: 1px solid transparent`（保留占位以免 hover 时线宽跳变，
  但视觉上**没有边框**），hover/拖动时才把 `border-color` 换成面板色（暗色下即白边）并把线体换主题色；
  全程没有 `box-shadow`。
- 实测：平时 `border: 1px solid rgba(0,0,0,0)`（不可见）→ hover `border: 1px solid rgb(38,38,38)`，
  两者 `boxShadow` 均为 `none`。测试 **89/89**、`ui` 65/65 全绿。
- **拖拽期间要出声，松手恢复"拖拽前"的状态**（第九轮推翻了第八轮的"拖拽静音"）：
  按下把手/进度条时**不暂停、不静音**（播放起来），靠不断改 `currentTime` 出声（"搓碟"手感）；
  松手时按**按下前的状态**恢复 —— 拖前在播就继续播，拖前暂停就回到暂停。
  实测：拖前 paused=true → 拖动中 paused=false 且 `playing` 按钮变"暂停" → 松手 paused=true；
  拖前在播 → 拖动中继续播 → 松手仍在播。
- **播放头线的 hover 高亮去掉阴影，改成边框**（用户要求）：`.aw-knob::after` 平时
  `border: 1px` 半透明前景色，hover/拖动时线体换主题色、边框换成面板色（白），全程无 `box-shadow`。
  实测 hover 时 `boxShadow: none`、`border: 1px rgb(38,38,38)`。
- 测试：本包 **89/89**、`ui` 65/65、bottom-bar 85/85、web2api 51/51 全绿；本包 typecheck 干净。
- **拖拽时不出声**（用户原话："拖拽的时候有声音的那种（站停的播放？）"）：按下把手或进度条时
  先 `pause()` + `muted = true`，并记下"原本是否在播"；松手时恢复静音开关，
  **只有原本在播**才继续播。实测：播放中 `muted=false` → 拖动中 `muted=true, paused=true` → 松手恢复播放。
- **波纹下面新增一条普通进度条**（`.aw-progress`：细轨 + 主题色填充 + 圆点把手，`role="slider"`）：
  它控制**整条音频**的进度，与波纹那条"窗口内位置"是两把不同的尺子。实测点 80% 处 → 定位到 1:12/1:30。
- **拖到一侧时波纹自动滚动**（用户要的"不然进度条只能控制部分区域"）：
  指针进入可视区左右 28px 边缘区时，用 rAF 逐帧把**窗口**往那一侧推
  （`EDGE_SCROLL_SECONDS_PER_FRAME = 0.12`），停了也继续滚；松手/卸载立刻取消。
  实测：按住把手停在右边缘 → 窗口位移 0 → -79px → -240px，整体进度 10% → 29%（到得了全片）。
- 顺带把"拖动中不补算峰值"的限制去掉（拖动中也要按需取新进入可视区的峰值，否则滚过去是空白）。
- 测试：本包 **87/87**（新增 `audioSeekAndProgress` 9 条）、`ui` 65/65、bottom-bar 85/85、web2api 51/51 全绿。
- **"像水波纹一样来回晃荡"**：竖条原本锚在**窗口左端**（`timeSec = start + i * perBar`），
  而 `start` 随播放连续变化 → 同一格每帧显示的采样点都在换，表现为波形原地抖动变形。
  改成**锚在绝对时间轴上**（`cell = firstCell + k`，`firstCell` 取整），
  格子不动、由 `translateX` 整体平移 —— 实测 t=20/22/24s 的平移量是 29.4px/2s 的**线性**关系，格子高度稳定不变。
- **"后面全是平的"（实时计算看着没生效）**：分块取峰值时对**每个小块各自做了一次归一化**，
  安静段被拉满、相对响度全丢。改成 `PeakCache` / `audioSource` 只返回**原始振幅（0..1）**，
  归一化留在最后一次性做。实测 45 秒音频的可见高度有 4 档不同值（90/75/15/10），跟随分段振幅。
- 顺带把两种数据源量纲统一：按需结果是 0..1、已存概览是 1..100 百分比 → 在组件里换算。
- 测试：本包 **78/78**、`ui` 65/65 全绿；`plugin-node-audio` 的 `tsc` 与 ui 的 `vue-tsc` 对本包均 0 报错
  （ui 仍余 4 个既有报错文件，与本次无关）。
- **根因**：波形被写成"两层叠放、上层按进度宽度裁切"，而上层是个**窄容器**，
  里面按百分比定位的竖条被横向压扁 → 看起来像第二条波纹。
- **改成用户口径**：**从头到尾只有一条波形**；进度只做一件事 ——
  把播放头**左边**那些竖条染成主题色（每根自己带 `is-played`，单层）。
- **滑动改成"轮播图模型"**：时间轴是一条长条，靠 `transform: translateX` 整体左移，
  可视区只是一扇窗（窗口不动、内容在动）。实测 t=15s 时 `translateX(-73.5px)`、t=35s 时 `-367.5px`。
- **每根竖条固定像素宽**（`--aw-bar-width`，默认 2px）：可视区能放多少根 = 容器宽度 ÷ 条距。
  实测 294px 容器 → 98 根、铺满 100%。
- **按需算峰值**（用户要点）：新增 `peakCache.ts`（按时间分块缓存 + 多分辨率聚合）与
  `audioSource.ts`（WAV 用 `Range` **只取可视区那几百毫秒字节**；压缩格式退回整段解码但峰值仍按区间算）。
  组件只请求"窗口那一段"的峰值，窗口平移时新进入的部分才算。
- **修掉一个真 bug**：节点常是"先建出来、音频随后写进去"，挂载那一刻波形子树还没渲染 →
  量不到宽度、也没挂上 `ResizeObserver` → 条数退化成保底值、波形只铺最左边一小撮。
  现在 `watch(waveRef)` 在元素出现时测量并挂观察器。
- 测试：本包 **78/78**、`ui` 65/65、bottom-bar 85/85、web2api 51/51 全绿；typecheck 干净。
- **根因是同类错误的两处**：整个滚动窗口的实现里，"波形宽度"与"位置"用了**两套坐标**。
  ① `pitch` 按**整条 100 桶**算宽度，可实际只画了视口内的 20 桶 → 波形只铺满左边 1/5（截图可见）；
  ② 已播色块宽度用"整条百分比"、播放头竖线用"视口内位置" → 两者不重合，且 SVG 里还留了一条
  固定高度的短线与把手叠加，才出现"只有中间一段高亮"。
- **修法：整个窗口换算收敛成一处**（新纯函数 `audioViewport`）——组件只问它要
  `{ start, visible, fraction }`，波形布局、已播宽度、竖线位置**三者共用这一个视口与这一个 fraction**，
  从结构上不可能再不一致。
- **波形改用 HTML 竖条**（原来是单条 SVG path）：宽度走百分比 `calc(100% / 视口桶数)`，
  与缩放/画布变换无关 —— SVG 在 `preserveAspectRatio="none"` 下要反算"视口=多少用户单位"，
  正是上面 ① 的温床。两层（灰底 + 已播）叠放，上层按 `width: fraction%` 裁切。
- **参考线改为贯穿整个波形高度**（原是 12px 的小圆球/短线）：hover/拖动时变主题色 + 柔光。
  实测：20 根竖条铺满整宽（末根右缘 = 容器右缘 845.8）、t=2s 分界/竖线都在左端、t=45.7s 同步移到 ~32%、
  拖时间文字移动节点（90,90 → 120,120）、拖参考线只 seek（节点不动，0 → 26.6s）、控制台 warn/error 仍为 0。
- **Vue 警告刷屏**（`Extraneous non-props attributes (class, data-slot-order, data-slot-id)`）：
  底栏三个浮层（NodeBottomBarOverlay / ReferenceSelectOverlay / MediaPreviewOverlay）的根节点是
  `Teleport`，插槽宿主 SlotHost 下发的 `class`/`data-slot-*` 没法被继承 → 每次渲染警告一次。
  三处各加 `defineOptions({ inheritAttrs: false })`（我们本来就不用那些属性）。实测控制台 warn/error **0 条**。
- **只有按钮与播放头拦画布手势**（用户原话："正常来说，只有这两个按钮，以及波纹上面的滑块在拖拽时才会
  拦截，其他元素都不会拦截节点的拖拽"）：`.aw-bar` 整条原本带 `nodrag nopan nowheel`，把时间/文件名
  一起拦了。现在把三个类**下移到每个 `<button>` 与播放头**上，控制条本体放行。实测拖"时间文字"
  节点位置 `120,120 → 161,147`。
- **滑动效果异常（回馈环）**：视口跟着播放位置走、而拖拽又是"指针 → 播放位置"，两者一起动就越拖越跑偏。
  新增"拖动中**冻结视口**"（`frozenWindow`）：按下把手时锁定当前视口，整段拖拽用同一把尺子，
  松手才重新居中。缩放窗口换算也改成按**实际视口**算（`seekRatio` / `headFraction`），
  而不是原来写死的"整条百分比 / 恒在中点 50%"（窗口被夹住时那是错的）。实测拖到 30% 就是 6/40 秒、
  拖到 70% 就是 14/40 秒，不再跑飞。
- **播放头从圆球改成竖线**（用户原话："中间有一个小圆球 我是希望你删掉他"）：`.aw-knob` 变成一条
  细竖线（11px 命中区 + 2px 视觉线），hover/拖动时换成主题色 + 一圈柔光。实测 hover 前
  `rgb(145,145,145)`、hover 后 `rgb(8,145,178)`。
- **hover 不再有灰底**（用户原话："会有一个灰色的背景，这是我不太喜欢的地方"）：删掉
  `.aw-wave:hover` 的 `background`，改成**只提亮波形本身** —— 未播的灰从 `--canvas-node-text-muted`
  提到 `--canvas-node-text`（不透明度 0.7→0.95），已播的主题色与 `--ui-panel` 混白提亮一档。
- **节点能拖了**（用户实测："拖拽节点变成了拖拽你的进度条"）：根因是波形整块带了 `nodrag`。
  现在**波形本体去掉 `nodrag`**（拖波形 = 拖节点），进度改由**播放头上的圆形把手**负责
  （把手自带 `nodrag nopan nowheel` + `role="slider"`，方向键可微调 1 秒）；点波形空白跳转仍可用
  （只拦 `click`，不拦 `pointerdown`）。
- **高度不再留空带**（用户实测："下面的区域是空白的"）：波形原本固定高度，卡片多出来的空间就空着。
  改为**弹性填满**（`flex: 1 1 auto`），SVG 跟着长高；配置项 `audioWaveHeight` 语义从"高度"改为
  **"最低高度"**（默认 46→28，下限 16），只在卡片被压得很矮时兜底。
- **长音频的滑动窗口**（用户要求："它是一个非常长的波纹…根据当前进度显示对应可视区域"）：
  新增纯函数 `audioWindow.ts`（`visibleBucketCount` / `windowStartBucket`，各带边界测试）+
  组件侧按窗口算 `viewBox` 与绘制区间。短音频整条显示；长音频只画可视那一段（最少 20 桶防"放大成粗条"），
  窗口把当前位置摆在正中，**播放时窗口平移 = 波纹在背景里滑动**（实测：40 秒音频 seek 到
  10/24/36 秒，可视区里的波形形状各不相同）。

**用户诉求**：web2api-tools 里顺带注册的 `audio` 节点抽成**独立节点插件**，UI 换成"音频纹波"
（波形当进度条：左侧主题色 = 已播、右侧灰 = 未播、可在波纹上拖拽 seek、播放时有动画）；
不显示字幕/歌词，只有一个音频；节点**不支持 resize**；波形数据在**第一次加载音频时算一次并存进节点**
（约 100 个数字），之后只读缓存。后续追加两点：右侧"更换音频"按钮改成**刷新**（重算波形与时长）；
**时长要随波形一起加载并存进节点**（实测时长没显示）。

**新包 `packages/plugins/plugin-node-audio`**（照 `plugin-node-video` 分层）：

| 文件 | 职责 |
|---|---|
| `waveform.ts` | 纯函数：桶化峰值（每桶取绝对最大值，负半周也算）、归一化到 1..100 整数（静音保底 1）、`isValidWaveform` 校验、`fallbackWaveform(seed)` 确定性回落（同名地址恒同形状，不用 Math.random） |
| `audioPlayback.ts` | 纯函数：`progressRatio` / `seekTime` / `ratioFromPointer` / `formatClock`（含 NaN 收敛） |
| `audioTransform.ts` | 浏览器端口：`fetch → decodeAudioData` 一次拿到**波形与时长**（多声道逐帧取最大；`finally` 里 `close()` 释放 AudioContext）、选文件、下载（node 下安全返回 null/false） |
| `audioOps.ts` | 载入一条路：`loadAudio`（换地址必重算）/ `uploadAudio` / `ensureAudioMeta`（**波形与时长缺哪个补哪个**，两者齐了零开销）/ `reanalyzeAudio`（刷新）/ `downloadAudioNode` |
| `nodeAudioPlugin.ts` | 注册 `audio` 类型（`size 320×120`、`resizable: false`、in: AudioContent）+ `AudioService` + 命令 `audio.upload` / `audio.download` / `audio.reanalyze` + Config（`audioWaveHeight` / `audioBarMinWidth`，组 `节点/音频节点`） |
| `AudioContent.vue` | 内容段：**单条 SVG path** 画 100 根竖条（一个元素 vs 一百个）→ `clipPath` 分两层上色（`--ui-accent` 已播 / `--canvas-node-text-muted` 未播）+ 播放头；指针按下/移动 = seek（`setPointerCapture`，`nodrag nopan nowheel`）；rAF 只在播放中跑；播放态 `.is-playing` 走 `aw-breathe` 呼吸动画（带 reduced-motion 降级）；空态给「上传音频」入口 |

**数据契约**（存进节点）：`data.audioUrl` / `audioName` / `audioDuration`（秒）/ `audioWaveform`（100 个 1..100 整数）。
波形是派生数据 → 走 `doc.updateNodeRuntime`（落盘、不进撤销栈）；地址/时长/文件名 → `doc.updateNode`（进历史）。

**web2api-tools 交还节点所有权**：删掉 `AudioContent.vue` 与 `AudioService` / `ctx.nodes.register`，
**只保留**音频生成动作与结果写入器（继续写 `data.audioUrl`）—— 于是没装 web2api 的宿主也能有音频节点。

**装配**：`packages/ui/src/assembly.ts` 加 `nodeAudioPlugin`（清单 23 → **24**）；`packages/ui/package.json` 加依赖。

**验证（实测）**：`plugin-node-audio` **50/50**、`plugin-web2api-tools` 51/51、`ui` **65/65**、
kernel 212 / canvas-data 353 / canvas-render 406 / canvas-base 6 / node-video 105 / node-image 111 /
node-text 31 / bottom-bar 85 / theme-default 241 / file-drop 42 全绿；新包 / web2api / ui 三个 typecheck 干净
（ui 的 `vue-tsc` 仅剩 4 个**既存**文件报错：CanvasHost.vue / SelectionFrame.vue / ModalsArea.vue / useFloating.ts，与本次无关）。
**浏览器实测**（dev :5411，CDP 驱动）：写入 dataURL 音频后波形与时长自动落库（`audioWaveform` 100 个、
`audioDuration` 正确）；拖拽波形到 75% → `currentTime 0.749`、clip 749.43、播放头同步；
点播放 → `.is-playing` 挂上、`aw-breathe` 动画生效、进度随播放推进、播完停在末尾；
只写 `audioUrl` 的节点（模拟 web2api 写入器）挂载后**时长与波形一起补齐**（实测 2 秒音频显示 `0:00 / 0:02`）；
底栏同时出现 web2api 的音频动作（豆包·语音合成），两插件协同正常。

### 最近完成（2026-10-01，底栏「参考」选择态 + 全屏预览 + 右侧按钮接通）

**同日修正（用户第二轮截图反馈）**：

- **「参考」改成两态开关**（用户实测「点击之后就无法取消」）：点一下进入、再点一下退出；
  顶栏「返回节点」= 聚焦回节点 + 结束参考（与 ✕ / Esc 三条路都能收）。根因是按钮高亮态没
  跟住会话状态 —— 现在直接读会话状态，点一下必切换（`toggleReference` 有单测锁两态）。
- **「风格」pass 掉**（用户要求）：「我们的风格一般都会直接写在提示词中或标签（后期在输入框里做成
  一个 tag）」。于是：顶行不再有「风格」pill；底栏不再有风格卡；**web2api 四个图片预设删掉
  `kind:'style'` 参数**（豆包 32 档 / ChatGPT 10 档预设整块删除），描述文案改成「比例可选；风格写在
  提示词里」。`presets.test.ts` 改成断言「任何图片预设都不再有 kind:style」。
- **下拉菜单换皮 + hover 描述动效**（用户要求照右键菜单）：`Select.vue` 的选项行改成
  「名称 + hover 描述」结构（名称绝对居中，悬停/聚焦时上移到 top:3px、描述从下方 translateY(6px)
  淡入），数值与 `ContextMenu.vue` 逐条对齐（0.3s ease-out）；`SelectOption` 加可选 `description`；
  底栏的**模型下拉**带上动作的 `description`，所以悬停能看到每个模型的一句话说明。

**同日第八次修正（用户第九轮截图）** —— 全局设置入口按用户最终要求重做：
- **展开/收起的动画卡顿修掉**（用户反馈「展开和缩回的时候，动画一点也不流畅…一卡一卡的」）：
  根因是用了 `grid-template-rows: 0fr↔1fr` —— 查下来**这个属性在各浏览器对 fr 区间的过渡支持不一**，
  Chromium 里既可能逐帧 reflow 掉帧、也可能干脆**不补间直接跳变**（那正是"卡"的来源）。
  改成**测量高度过渡**：Transition 的 `@enter/@leave` 把 `height` 显式从 0 ↔ `scrollHeight`
  写好、配 `transition: height .26s`，到位后 `height` 归 `auto`（内容变化不被钉死）。
  **浏览器实测逐帧采样**：展开 282→292→306→322→333→337→340→342→343→344→345→346 共 12 个中间值
  平滑补间（不再是跳变），收起同样逐帧回落。
- **末尾那个"跳一下"也修了**（用户二次反馈：「高度缩减为零之后……最后一个过渡很难受」，猜是分割线被隐藏）：
  根因不是分割线，是**父容器 `.nb-root` 的 flex `gap: 8px`** —— gap 属于父元素、不在本元素高度里，
  自定义 height 过渡到 0 时那 8px 还在，等 `v-if` 摘掉元素的瞬间 gap 才消失 → 末尾"啪"跳 8px
  （实测：346→…→282 停住、然后 282→274）。给 `.nb-global` 一个 `margin-top:-8px` 抵消 gap，
  间距改由元素**内部**承担（`.nb-global-inner` 的 margin-top 补齐），于是留白跟着 height 一起裁剪、
  一起动画。**逐帧实测**：收起 346→334→319→301→289→284→280→278→277→276→275→275→274，全程平滑无跳变。
- **图标换回「滑块」样式**（用户要求：「你这边的图标给我改过来，你前面几个版本的那个设置图标还可以」）：
  把底栏那枚齿轮（⚙ cog）换成**三条横线 + 滑块**的设置图标（`ICON_SETTINGS`，即"偏好/调节"那款）。
- **点它不再弹窗，改为在底栏下面追加一块**（用户要求：「它是在底部状态栏的下面一部分进行展示，
  而不是打开我的弹出框设置界面……类似在底部增加一块区域，并且带有一个动画效果（比如底部状态栏
  慢慢增高）。这块区域要有一条分割线来进行分割，并在里面显示当前的全局设置。这部分你可以直接
  使用占位文本」）：新增 `.nb-global` 区域，**追加在底行之后**（底栏最后一块），
  `border-top` 一条分割线，里面是「全局设置 + 占位说明」文本；展开用 `grid-template-rows 0fr↔1fr`
  让底栏平滑增高（与上一版「设置区」同一手法，但那是参数、这次是全局设置）。按钮高亮随开合。
  **浏览器实测**：点图标后底栏子元素变为 `pills → cards → editor → bottom → global`、
  分割线 1px、占位文本就位、底栏高度 274 → 346（增高动画）。
- 顺带**回退**上一版为「齿轮打开应用设置面板」加的 `settings:ui-open` 事件通道（用户不要弹窗，
  该通道已无用）：`packages/ui/src/composables/ui.ts` 的订阅与 openSettings、theme-default 的
  registerEventName、以及那条单测一并撤掉。

**同日第七次修正（用户第八轮截图）**：
- **底栏齿轮真的能开全局设置**（用户实测：「右侧你的这个设置按钮也给我搞没了，点击也没反应」）：
  新增内核事件 **`settings:ui-open`**（与既有的 `settings:ui-close` 对称），装配层
  `useUi.bindSettingsClose` 一并订阅它 → 置 `settingsOpen = true`。底栏那枚齿轮在插件里、
  够不到装配层状态，现在 `ctx.emit('settings:ui-open')` 就能弹出**同一个**全局设置面板
  （实测验到 偏好/设置 面板：节点/布局/边/常规/web2api/导出）；不再是什么都不做的假占位。
  新增 1 条整装测试锁这条通道（`settingsCloseChannel.test.ts`）。
- **比例下拉按内容宽**（用户实测：「你这个比例的下拉，文字就那么长，你给我把按钮搞那么大」）：
  参数下拉原来写死 `min-width:148px` + `width:100%`，把「16:9」撑成一条长按钮。
  改为按内容自适应（`width:auto`、`min-width:0`、`max-width:240px`）。
  **浏览器实测**：参数触发器宽度 148 → **81px**（正好包住「16:9 ⌄」），模型下拉仍 154px。
- **顺带修**：`packages/ui/src/App.vue` 的「正在跟随」横幅颜色净化测试一直红 —— 白名单标记
  与颜色行之间隔了两行，而测试只在**相邻上一行**认标记。把横幅收成整行、标记紧贴颜色行后转绿
  （`ui` 单测 64 → 65，含新增的 `settings:ui-open` 那条）。

**同日第六次修正（用户第七轮截图）** —— 上一轮把参数放错地方了，这次纠正：
- **参数回到"底行上的一个下拉"**（用户要求：「右侧的比例选择也是通过下拉的方式」）：
  上一轮把比例等参数放进了「设置区」追加面板——**那是错的**（见下条）。现在底行左侧是
  「模型下拉 │ 参数下拉（比例 16:9 ⌄）」，用回 `ToolParamGroup`（自带图标 + 下拉）。
- **左右分区纠正**（用户要求：「我说过你的设置放在右边，你把它放到左边去了」）：
  **左侧 = 插件/动作提供的东西**（模型 + 它声明的参数，都在底行上）；**右侧 = 全局设置**位
  （那枚齿轮，仍是**占位**、点了只提示）。上一轮把参数塞进「设置」区，等于让"设置"里出现了
  动作参数 —— 与「设置是全局、跟插件/动作无关」的分工冲突，已回退。
  于是上一轮新增的 `.nb-settings` 追加区 / AutoLink 开关 / 参数摘要 / 滑块图标全部删除
  （那批是建立在错误理解上的）。
- **模型下拉再放宽**：`dropdown-min-width` 240 → **300**（用户要求「模型选择框的下拉宽度可以再大一些」）。
  **浏览器实测**：底栏子元素又回到 `nb-pills → nb-cards → nb-editor → nb-bottom`（无追加设置区）；
  底行左 = `模型(154px) │ 16:9 下拉`、右 = `翻译 | ✨ | 齿轮占位 | 计数 | 发送`；模型浮层宽 300。

**同日第五次修正（用户第六轮截图）**：
- **下拉菜单重做 + 图标 + 标题**（用户强烈要求，附 3 张参考图「参考一下它的 UI 图标，然后再加这个标题」）：
  `SelectOption` 加可选 `icon`（opaque 句柄，与节点类型 icon 同写法）；`Select` 选项行渲染
  28×28 图标托（照仓库右键菜单 / 主题菜单的 look，有图标时行高 44px）；底栏模型下拉每行给出
  该动作服务类型的图标（优先取 `nodeRegistry` 里节点类型注册的 icon，取不到按类型名回落内置 SVG），
  于是「豆包 Seedream 4.5」这类**标题**左侧带图标、悬停还有描述。
- **配置分区修正**（用户要求）：**左侧 = 插件/动作自己的配置**（模型下拉 + 参数摘要 + 动作配置开关，
  参数在下方追加区摊开）；**右侧 = 全局设置**（跟插件/动作无关），目前只放一个**占位齿轮**
  —— 用户明确说「这边暂时使用一个占位就行，不需要你实现」。原来那个「高级参数」滑块从右侧挪到左侧、
  跟动作配置合并（一个入口，不再左右各一个开关）。
  **浏览器实测**：下拉 9 行全部带图标托（行高 44）、标题 + 悬停描述齐；底行左侧
  `模型 | 摘要 | 配置开关`、右侧 `翻译 | ✨ | 齿轮占位 | 计数 | 发送`。
- **下拉「点得开、点不关」修复**（用户实测：「你这里的下拉还不能点击切换显示隐藏」）：
  根因在 `Dropdown.vue` 的默认 click 触发器只做 `open()` 不做 toggle —— 没在内部按钮写
  `@click.stop` 自管切换的消费方（ToolParamGroup 的参数下拉）就点不关。改成 `toggle`；
  Select / ColorField 自己 `@click.stop` 的路径不受影响（事件到不了外层）。
  **浏览器实测**：底栏模型下拉、设置面板下拉、添加节点菜单 —— 三者都是「开→再点→关」。
- **参数搬到外面 + 设置区改成「底部追加、向下外扩、有动画」**（用户要求：「有些配置你可以直接放在
  底部栏目中，而不是直接嵌套在这个下拉内部」+「设置是在底部追加一块区域…向下外扩，而且有动画」）：
  新增 `.nb-settings` 设置区（默认展开），位置在**底行之后追加**（`nb-settings-wrap` 是底栏最后一个
  子元素），参数**直接摊开**（比例网格 / 下拉 / 开关各自成块），不再塞进 `ToolParamGroup` 的合并下拉；
  展开/收起走 `<Transition name="nb-set">` + `grid-template-rows 0fr↔1fr`（高度平滑长开）
  再叠一点上滑淡入。底行原来的参数下拉位置换成**只读摘要**（点它开合设置区）；右下角滑块图标同效。
  「智能引用 AutoLink」也从滑块图标里挪到设置区。
  **浏览器实测**：底栏子元素顺序 `nb-pills → nb-cards → nb-editor → nb-bottom → nb-settings-wrap`
  （设置区在底行**之后**、已 `settingsAfterBottom:true`），点摘要能收起再展开。
- **模型下拉浮层宽度**：去掉上次为「太窄」加的固定 240px 最小宽，恢复与按钮同宽（用户实测
  「你这里的 trigger 宽度被固定了大小？？」——长条目本就该撑开、短的与按钮齐）。
- **底栏右上角「展开」按钮接上**（用户要求「点击展开 UI（变成 dialog 的形式，展示这里的 UI）」）：
  原来是个死按钮。做法**不复制 DOM** —— 同一块 `.nb-root` 在展开时 `<Teleport to="body">` +
  外层 `.nb-shell.is-expanded`（fixed 铺满 + 遮罩 + 居中），内容/状态一份；收起时 Teleport 禁用、
  外壳 `display:contents`（完全透明，底栏还是原来那条浮层）。展开态宽度 min(760px,100%)、
  限高滚动、输入区放宽到 40vh；Esc / 点遮罩 / 再点按钮都能收；按钮图标换成「收起」箭头。
  **浏览器实测（Playwright 无头 Chromium，dev :5399）**：展开后 `aria-modal=true`、
  外壳 `display:flex` + 遮罩 `rgba(0,0,0,.6)`、面板 760×274 且水平垂直都居中、
  同一份 UI（输入框/素材卡/模型下拉都在）；Esc 后回到 `display:contents`。

**同日第四次修正（用户第四～五轮截图）**：
- **底栏素材卡模糊值**：用户指定改 `blur(1px)`（原 3px）。
- **底部 dock「移动 / 抓手」按钮的图标不跟着模式切**（用户实测，指出在 `packages/ui`）：
  按钮此前**恒定**画 `Hand`（抓手）图标，切到「移动」也还是抓手的样子。改成
  `<component :is="s.canvasMode === 'move' ? Move : Hand" />` —— 移动态显示 Move、抓手态显示 Hand。
  **浏览器实测（Playwright 无头 Chromium，dev :5399）**：点按钮→「抓手工具」后图标 class 变
  `lucide-hand`、再切回「移动」变回 `lucide-move`，来回都跟着模式走。
- **底栏素材卡：正方形 + cover + 图片本身模糊**（用户先指「素材卡」（第 414 行那块 div），
  纠正过一次——第一次我误做到全屏预览上，已回退）。用户原话：「这里是正方形 你的图片要使用
  cover 方式展示，然后给他一个模糊效果，但是你这里图片并没有模糊而是背景模糊（我要的是图片模糊）」。
  最终做法就是一张 `.nb-card-img`：`object-fit: cover` + `filter: blur(3px)` +
  `transform: scale(1.18)`（放大一点防 blur 啃出透明边）；不再分「模糊背景 + 清晰前景」两层。
  **浏览器实测（Playwright 无头 Chromium，dev :5399）**：卡片 48×48 正方形、
  `imgFit:cover`、`imgFilter:blur(3px)`、`imgTransform:matrix(1.18…)`，截图肉眼可见卡片是模糊的缩略图。

**同日第三次修正（用户第三轮截图）**：

- **下拉浮层太窄**（用户实测「至少得两百px」）：`Select` 新增 `dropdownMinWidth`（缺省 200px），
  只在 `dropdownWidth:'match'` 时生效 —— 底栏模型下拉的触发框只有 ~100px，match 会让浮层
  缩成一条窄缝、模型名全截断。底栏模型下拉显式设 `dropdown-min-width="240px"`。
- **「风格」再兜底**（用户要求「删掉」）：除删预设参数外，`NodeBottomBar` 的 `paramDefs` 现在
  **过滤掉任何 `kind:'style'` 字段**（与来源无关，防运行时清单再冒出风格参数）；
  `fieldSummary` 改读过滤后的 `paramDefs`（原先读原始 `fields`，会把风格的默认值漏进 🌟 摘要 ——
  这条是被新单测当场抓到的真 bug）。新增 1 条单测锁「带 kind:style 的动作，底栏摘要里不出现它」。

用户带三张截图要求：①「参考」要真的能选节点建立链接（现在功能没实现）；②「标记」暂不支持但要给出
不支持的样子；③底栏右侧那排按钮也没实现；④「风格」；⑤素材卡预览要**全屏**（原来缩在底栏里）。
另明确：截图里那张有问题的预览卡是 **LibTV 参考站**的（索引在左上、图底带模糊），别照抄它。

**参考选择态（新）** —— 判定全在 `referenceMode.ts`（零 DOM 纯函数，20 条单测）：

- **谁能当参考 = 读节点类型自己声明的端口能力**（源输出口的 `contentType` ∈ 目标输入口的
  `acceptsTypes`），不是底栏写死一张类型表 —— 加一个新节点类型不用动本插件。
  与内核「缺省即全收」同口径（目标没声明 acceptsTypes → 来者不拒；源没声明产出 → 不当参考）。
- 四种面孔：`owner`（自己，只描边）/ `selectable`（可点、悬停出「选择 XX」提示）/
  `connected`（已连，提示变「取消选择 XX」，再点解除）/ `blocked`（灰罩 + 半透明，不可点）。
- 点可选节点 = `doc.connectEdge({source, target})` 建立链接（它随即出现在底栏素材区）；
  点已连节点 = 摘掉那条边。宿主节点掉出选中集 → 选择态自动收（逐帧守，防「底栏换人了盖层还留着」）。
- 浮层 `ReferenceSelectOverlay.vue` 注册在既有 overlay 槽（与底栏宿主同槽、order 41），
  Teleport 到 body + 屏幕坐标 fixed（与 `NodeBottomBarOverlay` 同一手法，绕开节点层叠上下文）。
顶部蓝底操作框：提示 + 「返回节点」+ ✕；底部「按 ESC 退出」；Esc 可退。
**「返回节点」= 聚焦回节点**（用户实测反馈）：点击后先把视口中心移到该节点（缩放 <60% 时抬到 100%，
否则保留用户当前尺度），再退出选择态。**悬停提示改为跟随鼠标**（不再钉在节点右侧，与光标保持 14/18px
偏移 —— 用户实测反馈「提示要跟着鼠标走」）。

**全屏预览（改）** —— 用户要「全屏，是整个视图」：新 `MediaPreviewOverlay.vue` + `mediaPreview.ts`
（module 级会话状态），铺满整个视口看大图/全文；Esc / 点背景 / 右上 ✕ 三种关法。
素材卡序号角标仍是**左下**（没有被参考站那张卡带偏），缩略图**不加模糊底**。

**「标记」置灰** —— `disabled` + `opacity .38`（用户要求：给一个透明度效果表示不支持）。

**「风格」接通** —— 与「参考」同一条选择态通道，只是 purpose=`'style'`：选中的图写进本节点
`data.styleRef`（一张风格参考图，不建连线），底栏素材区最前面显示「风格」卡（可点开预览、可替换）。

**右侧按钮接通**：

- 「高级参数」：就地展开**全部参数控件**（比底行那个合并下拉更细，逐项可改）+ 「智能引用 AutoLink」
  开关（照参考图的高级设置项，写 `data.autoLink`）。
- 「翻译提示词」：`promptActions.ts`（纯函数，6 条单测）在提示词后追加/摘除一句「译成英文」指令，
  按钮两态高亮。**顺带修了一个真 bug**：程序化改文本时必须清掉 `promptDoc`，否则编辑器会优先用
  旧 JSON 还原、把追加的指令顶回去（实测：用户先打过字就完全点不动）。

**验证**：plugin-bottom-bar 单测 **76/76**（新增 referenceMode 20 / promptActions 6 / uiState 4）、
typecheck 过；回归 ui **64/64**、canvas-render **406/406**、theme-default **241/241**、
node-image **111/111** / node-text **31/31** / node-video **105/105**。
Chrome MCP 实测（dev :5388）：参考态盖层 4 种状态齐、点可选→连上（素材卡 0→1）、点已连→解除、
文本节点做宿主时图片节点为 `blocked`；全屏预览根 1400×836 = 整视口；翻译按钮空文案↔28 字两态来回、
开关可写 `data.autoLink`；无 console error。



### 最近完成（2026-09-30，节点尺寸改为单一来源 node.size）

用户问题：卡片尺寸为什么要存两份（`node.size` 与 `data.cardWidth/cardHeight`）？能不能合成一个？

结论：能。`node.size` 现在是**唯一正身**，`data.cardWidth/cardHeight` 降级为**数据层自动生成的镜像**
（卡片壳 BaseNode 只拿得到 VueFlow 摊平的 `props.data`，读不到 `node.size`，所以镜像必须由数据层统一补，
而不是让每个写尺寸的插件各写一份）。之前"要同时写两个数"的纪律散在五六个地方，谁漏一个就出现
"卡片变了、边端点还停在旧宽度"；现在写尺寸只剩一处成型。

- **数据层收口**（`canvas-data/nodeStore.ts`）：写 `size` → 自动刷镜像；只写 `data.cardWidth/cardHeight`（老插件 /
  后台 / MCP 的旧写法）→ 自动**提升为 `node.size`**；清 `size`（`size: undefined`）→ 镜像一并清掉。
  `replaceAll`（读档 / 云端合并 / 导入）对**存量老存档**做一次性迁移：只有 `data` 尺寸的节点补上 `size` 并刷镜像。
  新增导出 `nodeSizePatch(w,h)`（只给 `size` 的写回补丁）与 `nodeSizeOf(data)`（从 data 读回尺寸）。
- **生产端收敛**：resize（`useNodeCardSize`）、图片 / 视频 / 对比 / 分组 / 自动布局 / 拖入文件 / 视频换源
  全部改成只报 `size`；各自的 `CardSizePatch` 从三件套收成单字段 `size`。
- **不凭空造尺寸**：建节点（`addNode`/`addNodes` 未给 size）不写 `size`，缺席 = 用类型默认尺寸
  （布局回退链与卡片壳都认这条），只有真被写过尺寸的节点才有 `size`，避免给存量图强加一个尺寸。

**改尺寸的一等入口**（作者不必自己拼 patch）：
`ctx.nodes.setSize(id, w, h)`（薄糖，与下者同一实现）或 `ctx.get('doc').setNodeSize(id, w, h)` ——
内部走唯一写入口（进历史 + 调度落盘），自动刷 `data` 镜像；宽高非正有限数（0/负数/NaN）→ 返回 `false`
且不写。批量/进阶仍可用低层 `doc.updateNode(id, { size })` / `updateNodes`。

**节点语义写方法收口**（作者不写原始字段 `data.label`/`position`/`parentId`）：
`ctx.nodes.setLabel / move / setParent / remove / setSize`（薄糖），或 `doc.setNodeLabel / moveNode /
moveNodes / setNodeParent / setNodeSize`（真实现，走唯一写入口 + 历史 + 落盘）。`setNodeLabel` 会把
空串/空白归一成"无标题"（显示回类型名）。`doc.updateNode(id, { data })` 等原始字段口仍在（低层/批量/内部用），
只是不再是一等入口。

验证：`canvas-data` 342（新增 `nodeSizeSingleSource.test.ts` 12 条锁单一来源/迁移/清镜像/`nodeSizeOf` 边界）、
`canvas-render` 406、`ui` 64；图片 111 / 视频 105 / 对比 46 / 分组 48 / 自动布局 33 / 拖入 42 全绿；
typecheck 过（canvas-data / canvas-render 业务码 / node-image / node-video / node-image-compare / group /
auto-layout / file-drop / theme-default / mcp-server）。

### 最近完成（2026-09-27，插件上下文与包边界 T01–T09）

### 最近完成（2026-09-30，左下角「缩放选项」接上真实画布）

用户要求：左下角状态栏那个缩放百分比是**假的**，请把它接成"真正设置画布缩放值"。

实测确认原状：`state.zoom = 39` 是写死的纯 UI 数字，菜单动作只改这个数字 —— 从没接到 viewport 上
（表现：点「缩放至 100%」画布纹丝不动、读数永远是 39%，而真实视口其实是 160%）。

做法（唯一事实来源 = 真实视口）：

- `composables/ui.ts` 新增「缩放」段：`zoomInStep / zoomOutStep / zoomToPercent / zoomFit` 一律调
  `ctx.get('viewport')`（宿主恒在注入的视口服务）去改真画布；`syncZoomDisplay()` 把
  `getViewport().zoom` 镜像到状态栏读数。放大/缩小以**真实缩放**为基准 ±10%、钳 10%–800%；
  「适合屏幕」= `viewport.fitView()`（替代原先那个只改文字的假按钮）。
- **读数同步用常驻 rAF 比对，不订阅 move 事件**：实测 `zoomTo / fitView / 小地图拖拽 / 首屏 fitView`
  **都不发** VueFlow 的 move 事件（`RenderEvents.MoveEnd` 收不到），只订阅事件会让读数停在旧值。
  逐帧比一次整数、变了才写（同值不触发响应式）；node/SSR 无 rAF 时退化为只同步一次。
  与 `App.vue` 里给小地图逐帧定位的 rAF 同款做法。`App.vue` 卸载时 `unbindZoomSync()` 停掉循环。
- `StatusArea.vue`：三个动作改调 ui 入口；「缩放至 50% / 100%」的选中态按**真实缩放**高亮（±1% 容差）；
  末项文案由「缩放至 800%」改为**「缩放到最大」**（用户要求），并改为按设置 `maxZoom`（默认 2 = 200%，
  面板可调 1–8）走 —— 原先写死 800% 在默认上限 200% 下点了也到不了。

验证：`canvasToggles.test.ts` 扩到 10 条（新增 4 条：菜单真调 viewport.zoomTo/±10% 钳位/fitView/
读数取自真实 viewport；用假后端挂到真实 viewport 服务上，兑现 ui→ctx.get('viewport') 那条真实路径）；
浏览器实测 **11/11**（读数=真实值 160%、缩放至 100%→1.0、50%→0.5、放大→0.6、适合屏幕→1.676、
滚轮后读数跟随）；官方回归：画布 e2e 51/51、多选 33/33、主题色板 19/19；ui 单测 59/59
（其余 2 条失败与本次无关：`entrypoint` 的插件数 19 与 `themeColorHygiene` 的 2 处颜色，
均由工作区里**别的并行改动**（plugin-bottom-bar / assembly 增删插件）引入，非本次触碰）。

### 最近完成（2026-09-30，抓手工具下不显示端口球）

用户要求：切到**抓手工具**后，节点两侧的端口球（`MovingHandle`）不再显示。

理由与做法：端口的本职是「拖节点用的手柄」；抓手模式下拖动是平移画布、节点根本不会被拖走，
端口留着只会误导。抓手 = 设置 `nodesDraggable=false`（首轮已接通），故端口显示门直接读它：

- `plugin-theme-default/src/components/node/BaseNode.vue`：新增 `CANVAS_NODES_DRAGGABLE`
  （初值 `nodesDraggable ?? true`，`onChange` 窄更新），纳入 `shouldShowHandles` 的压制项。
  **唯一事实来源 = 设置 `nodesDraggable`**：底栏「移动/抓手」按钮与设置面板「节点可拖拽」
  改的都是它 → 三条路永远一致，不新增第二份开关。移动工具、以及未声明该键的旧宿主照常显示。
- 同时排掉一个误判来源（本轮查出，非本改动引入）：低细节阈值 `nodeLodLowDetailZoom` 默认 0.4，
  **低于它端口本就整体压掉**；而应用首屏 `fitView` 落在 39%，正好被压住 —— 表现为「刚进来就没端口」。
  若需要低缩放也保留端口，调低该阈值（或后续把端口从低细节压制里摘出来）即可。

验证：新增 SSR 测试 `baseNode/__tests__/handToolPortVisibility.test.ts`（3 条：移动/未声明→显示，
抓手→不显示；实测把门摘掉即红，证明真在测）；theme-default 单测 **233/233**、typecheck 过；
浏览器实测 6/6（含「同一页面热切抓手→圆球消失、切回移动→恢复」与「抓手仍能平移画布」）；
官方回归：画布 e2e 51/51、多选 33/33、主题色板 19/19；ui 单测 59/59。

### 最近完成（2026-09-30，画布工具按钮接通内核）

用户要求（带截图）：左下角那一排按钮（整理画布 / 小地图 / 隐藏节点连线 / 网格吸附）与
底栏「移动 / 抓手工具」当时**点了只有图标变化、画布毫无反应** —— 它们只改了 `useUi`
里的本地状态，没有任何一处写到内核（设置面板改同一件事却真的生效）。

做法：按钮改成和设置面板**走同一条通道**，自己不再存状态。

- 写设置（`ctx.get('settings').set`）：`edgeVisible`（隐藏节点连线）、`snapToGrid`（网格吸附）、
  `miniMapVisible`（小地图）、`nodesDraggable`（抓手 = 关掉拖节点，拖哪都平移画布）。
  真正干活的是订阅这些键的消费方：`CustomEdge` 读 edgeVisible、渲染宿主 CanvasHost 把
  snapToGrid/nodesDraggable 绑给 VueFlow、mini-map 插件订阅 miniMapVisible。
- 执行命令（`ctx.get('command').execute`）：整理画布 → `auto-layout:run`（与 Ctrl/Cmd+L 同一条命令，
  结果进历史栈、一并落盘）。顺带修掉按钮上过时的提示文案（原写 Alt+Shift+F，真实键是 Ctrl/Cmd+L）。
- `bindCanvasToggles()` 订阅设置变化，把按钮图标与底栏高亮同步过来 —— 面板改了、按钮立刻跟着变，
  不会出现"面板关了按钮还亮着"的假状态；`App.vue` 卸载时 `unbindCanvasToggles()` 退订。
- 验证：新增整装测试 `packages/ui/src/__tests__/canvasToggles.test.ts`（6 条，真实内核 + 真实插件，
  锁"按钮入口写的就是设置面板那个键"）；ui 单测 **59/59**；浏览器实测脚本 17/17
  （含真拖拽：移动态拖节点节点动、抓手态拖节点不动而视图平移、光标 grab）；
  官方 e2e **51/51**、多选回归 33/33、主题色板 19/19。

### 最近完成（2026-09-30，多选框改为跟随画布缩放）

用户要求（带截图）：多选时「节点边缘 → 选框边缘」的 padding **不要反缩放**，要跟随画布一起缩放。
实测（修前，同一节点同一多选集）：屏幕间距恒 16px、flow 间距 0.5x→32 / 2x→8 —— 就是反缩放。

- 三处去掉 `1/zoom`：`multiSelectConfig.scaleFramePaddings`（间距）改为恒等、`frameStrokeCss`
  调用方不再传 `1/zoom`（线宽/圆角）、`SelectionFrame.batchStyle` 的端口定位去掉 `scale(1/zoom)`
  （端口与节点端口同款 = flow 尺寸）。
- 语义：配置项「两框间距 / 小框外扩 / 线宽 / 圆角」现在是**画布(flow)单位**，与节点卡片边框同约定。
  缩小时 spacing/线宽一起变细；不再需要「间距与线宽同空间」那套补偿（两者现在同域）。
- 验证：multi-select 单测 148 全绿、typecheck 过；浏览器 e2e 多选回归 **33/33**（新增场景 G 四条：
  flow 间距恒 16/34/16/16、屏幕间距随缩放变、线宽不反缩放、无报错）、画布总回归 **51/51**。
  实测（修后，同一条测量）：flow 间距恒 16、屏幕间距 0.5x→8 / 1x→16 / 1.5x→24 / 2x→32。

执行计划：`docs/plans/2026-09-27-canvas-plugin-context-boundaries.md`（规格 `docs/goal/canvas-plugin-context-and-boundaries-spec.md`）。
九项已落地、每项独立提交并验证，T10 待负责人拍板。

- **T01** c50b108：主题/节点区域的注册事实源与 order 只有一份。`ctx.theme.add/remove` 过去只写
  或只删 `ThemeRegistry`，与 `registryOf("theme")` 读数不一致；`nodes.contribute` 在场里自行算 order
  且忽略显式 `opts.order`。现两处同源写入、同一 id/order/回收。
  （实测修正：原审查称"卸载后注册场留幽灵条目"**未复现** —— 插件作用域视图本就随 fiber 回收。）
- **T02** e129d76：`defineNode` 不再静默丢字段。它过去手抄透传清单，类型允许的
  `icon/resizable/frameless/transparent/segments/连接声明` 运行时被丢；改为原样转发 `NodeRegisterDef`，
  并去掉包内自引用。canvas-base 首次有 test 脚本。
- **T03** 2bbe6bc：`ctx.get/tryGet` 按服务名推导类型。集中声明 doc/selection/resources/save/command/
  nodeFactory/nodeRegistry/themeRegistry/settings/settingsPersist 与渲染层 nodeLayout/viewport；
  显式泛型与扩展服务名保持可用。**顺带修一处类型/运行期漂移**：`PluginScope` 声明了 `tryGet`，
  但插件作用域视图从未实现它（插件里调用会 `not a function`）。
- **T04** b88f4ad：有就绪状态的 Flow/DOM 能力面。旧 `ViewportService` 在后端未挂载时静默降级
  （默认坐标 / 原样回传 / no-op）；新增纯逻辑状态机 `detached→flow-ready→dom-ready→disposed`，
  未就绪即抛 `CanvasFlowNotReadyError`，经 `useCanvasRender().flow` 暴露；与旧 viewport 共用同一份后端。
- **T05** d56c4de：默认主题组件改用集中类型的服务（`ctx.get` 不再手写结构断言）；`DefaultBackground`
  不再直接 import VueFlow，改从 `useCanvasRender()` 取视口。BaseNode 内 `useVueFlow` 保留（红线核心节点件）。
- **T06** 70bbb59：多选端口/拖线件改从主题可替换目录取（`useUiComponent("movingHandle"/"connectionLine")`），
  生产代码不再依赖 `plugin-theme-default`（降为 devDependency，仅测试注入真实件）。
- **T07** 5cb5310：image/text/video 三个节点插件不再把主题包当共享组件库（清 dependencies 与构建 external）。
- **T08** 28d6e1d：钉住插件依赖方向（`packages/ui/src/__tests__/pluginDependencyDirection.test.ts`，
  扫 24 包 / 201 个生产源码文件；实测运行时依赖与值导入均为 0）。
- **T09** 1a13f41：`canvas-foundation` 拆包 **no-go**（`docs/plans/2026-09-27-canvas-foundation-go-no-go.md`）——
  四条准入只满足一条：反向依赖仍在（`graphDocument.ts → canvas/connection`）、无第二个真实消费者
  （cloud-server/mcp-server 刻意不 import canvas-data）、迁移会再次移动 doc/canvasBasePlugin。
- **T10** ⏳：端口几何默认值决策材料就绪（`docs/plans/2026-09-27-port-zone-default-decision-brief.md`，
  实测成品应用走主题值 10/0.55/0.8，非宿主回落 86/0.8/1）。**待负责人选定后**再开几何实现票。

**验证基线（2026-09-27 实测）**：kernel 212 / canvas-data 328 / canvas-render 396 / canvas-base 6 /
ui 42 / 24 个插件包合计 1350；UI e2e **40/40**、多选回归 22/22、主题色板 19/19、视觉回归 6/6。
已知遗留（非本轮引入）：plugin-auto-layout / clipboard / file-drop / multi-select / node-image /
node-text / theme-default 的 `typecheck` 在改动前就有报错（多为 .vue 类型导出与测试文件），本轮未新增。

### 追加（2026-09-27 第二轮，typecheck 全仓清零）

e6a36e5：把各插件包 typecheck 从 7 个失败清到 0（上面那条"已知遗留"不再成立）：

1. 基础服务直访类型：doc/selection/resources/save/command/nodeFactory/nodeRegistry/themeRegistry
   也声明到 Context（ctx.doc 等直访），并删掉 6 个插件里逐个 declare 的重复声明。注意 settings
   不在此列：ctx.settings 是能力段糖（define/set/…），与 ctx.get('settings') 的原始 SettingsStore
   形状不同，重复声明会接口冲突。
2. css shim：canvas-render 的 index.ts 顶部 import styles/ui-theme.css，消费包的 tsconfig include
   只覆盖自身 src，tsc 跟随依赖时报 TS2882。与 .vue shim 同一处理，各插件 env.d.ts 补一条即可。
3. .vue 具名类型导出只有 vue-tsc 认：theme-default 把 DropdownTrigger/SelectOption 挪进
   components/ui/types.ts，普通 tsc（multi-select/node-image/node-text 的 typecheck 随依赖解析到它）
   不再报 no-exported-member。
4. toolParamField 测试的组件桩改 defineComponent（消除 this 隐式 any）。

**验证基线（2026-09-27 第二轮实测）**：typecheck 全部通过（kernel / canvas-data / canvas-render /
canvas-base / ui / 24 个插件）；测试 kernel 212 / canvas-data 328 / canvas-render 396 /
canvas-base 6 / ui 42 / 插件 1350；e2e 40/40、多选 22/22、色板 19/19。

### 追加（2026-09-27 第三轮，T10 端口几何双源关闭）

4a62618：执行计划 T10 完成，方案 A：宿主回落 DEFAULT_HANDLE_VISUAL 对齐主题默认
10/0.55/0.8（原 86/0.8/1），核心节点契约 §9-1 记录的双源漂移关闭。选 A 的理由：86 从未成为
任何真实用户的观感（成品一直走主题值），B 会当场改变全部用户可见体验；不从主题派生宿主回落，
避免 canvas-render 反向依赖主题包。验证：装主题宿主 10/0.55/0.8 行为不变；theme demo
（未传 handleVisual，走宿主回落）端口区同为 110px，两场景一致；e2e 40/40、多选 22/22、
色板 19/19、视觉 6/6；canvas-render 396 / theme 202 / multi-select 145 全绿。用户已保存的
具体值不受影响（settingsPersist 存具体值）。决策全文见
docs/plans/2026-09-27-port-zone-default-decision-brief.md。

至此 docs/plans/2026-09-27-canvas-plugin-context-boundaries.md 的 T01 至 T10 全部完成。

### 追加（2026-09-28，全量 API 迁移 + 作者 SDK 类型收口 + 兼容面清理）

用户要求：**所有插件改成最新 API、不要任何兼容代码**，并核对执行计划 T01–T10。逐条落地：

1. **迁移残漏修复**（f036634 / 4739928）：0786bd4 的全插件迁移留下两处回归与两处漏改：
   - `VideoTopToolbar.vue` 上传回调的多行 `ctx.get<{...}>(` 只换了首行 → 破坏 SFC 语法（video 与
     packages/ui 的装配测试同时红）；改为 `ctx.tryGet('resources')`。
   - `alignGuideConfig.test.ts` 的 ctx 桩缺 `tryGet`（生产已改 `tryGet`）。
   - `BaseNode.vue` 仍在解构已删除的 `viewport` / `updateNodeVisualSize` → 统一改走 `flow` facade；
     同步 3 个 SSR 测试桩（补 `flow` 对象与 `tryGet`）。

2. **作者 SDK 类型收口**（c4b9d0f）：这是用户"插件只需一个 canvas-base 类型入口"诉求里此前
   **没做到位**的一环。服务名 → 类型的唯一事实源过去被拆在两层：数据服务声明在 canvas-data，
   渲染服务（`nodeLayout`/`viewport`）**只在 canvas-render declare**。于是只依赖 canvas-base 的
   纯逻辑插件（canvas-export / cloud-save / align-arrange…）拿不到这两个服务类型，只能手写
   `ViewportPort` / `NodeLayoutPort` 窄端口（类型对错靠人抄），或为两个名字 import 整个渲染包。
   做法：新增 `canvas-data/src/canvas/renderServiceContracts.ts`（`NodeLayoutContract` /
   `ViewportContract` + `ViewportState`/`FlowPoint`/`LayoutRect`，零 Vue/零 VueFlow/零实现细节），
   在 `serviceTypes.ts` 登记进 `Services` 与 `Context`；canvas-render 删重复 declare、改为
   `implements` 契约；canvas-base 重导出契约。全插件清理内置服务的显式泛型残留与由此多余的窄端口。
   插件自有服务（text/panorama3d/group/mini-map/…）仍保留显式泛型——这是新 API 允许的。

3. **兼容面清理**（5f571ae）：核对全仓后删除**零生产消费方**的旧兼容面：
   六个旧渲染注入令牌（`HOST_KEY`/`NODE_REGISTRY_KEY`/`NODE_WRITE_KEY`/`CANVAS_PARAMS_KEY`/
   `EDGE_VISUAL_KEY`/`EDGE_SELECTION_KEY`/`DEBUG_KEY`）、`contentBridge.ts` 整文件、
   `geometry.ts` 的 `SnapRatios`/`DEFAULT_SNAP_RATIOS`、CanvasHost 失效的 `minZoom`/`maxZoom` props、
   以及 `CAPABILITY_BAG_KEY` 的对外导出。

**验证基线（2026-09-28 实测）**：kernel 212 / canvas-data 328 / canvas-render 396 / canvas-base 6 /
ui 42 / 24 个插件包合计 **1350**；typecheck 全包 0 错（`ui` 仅剩迁移前既有的 17 条，本次未新增）；
浏览器：UI e2e **40/40**、多选回归 **22/22**、主题色板 **19/19**、视觉回归 **6/6**。

文档同步：`docs/代码开发/canvas-render/05-渲染上下文与content组件.md`（原"六注入令牌"篇重写为
"渲染上下文"，旧令牌枚举全部移除）、`01-包定位与整体架构.md`、`03-CanvasHost与CanvasSurface.md`、
`docs/plugin-dev/07-into-canvas.md`、`packages/plugins/README.md`。

### 最近完成（2026-09-25，主题配色「两格制」+ 全仓去硬编码色）

**用户问题**："一个连接线颜色我只能设一种 —— 设成灰色，暗色主题上就没法看"。

- **核心：可配置颜色改成「亮/暗两格」**（`canvas-render/src/contracts/themePalette.ts`）。
  每个颜色两个 Config 字段、写两个**不同名字**的内联变量
  （`--uic-<key>-light` / `-dark`），由 `ui-theme.css` 的 `:root` / `html.dark` 各挑一个 →
  **切主题仍是纯 CSS、零 JS**，消费方照旧只写一次 `var(--ui-accent, 兜底)`。
  只在**用户改过**的格写内联（等于默认值不写），否则会压掉主题插件在 CSS 里给的配色。
  色板 7 项：强调/强调悬停/危险/警示/连线/流光/参考线。
- **位置归位**：原先住在 `packages/ui/src/themeColorPlugin.ts`（成品应用插件）→ 上移进
  渲染层，由宿主 `createMiniCanvasHost` 直接声明（与「常规/画布」交互配置同层），
  **任一宿主都自带**。旧文件已删。
- **连线颜色真的跟着主题走**（用户举的例子）：`CustomEdge` 经新增的 `useThemeColor()`
  读色板（SVG 表现属性不认 `var()`，必须取具体值）。顺带发现并修掉一个旧 bug ——
  theme-default 原先声明单值 `edgeColor`（默认 `#1f2937`，暗色画布上对比度约 1.3:1
  ≈ 看不见）且**永远盖住**色板 → 已删除该单值配置。
- **JS 通道**：`useThemeColor(token)` 同时跟"改设置"与"切主题"；`watchThemeMode` 全仓
  **共用一个** MutationObserver（连线组件是每边一份，几百条边不能各挂一个）。
- **全仓去硬编码色**：把插件/渲染层/应用壳里写死的颜色换成主题 token（品牌色半透明档一律
  `color-mix` 现算）。净化守卫 `packages/ui/src/__tests__/themeColorHygiene.test.ts` 把违规数
  从 **325（38 个文件）** 压到 **0**，并把这条钉成测试（不再靠人工清单）。
  同目录新增 `stylesCompile.test.ts`：全仓 `.vue` 样式段必须能被 Vue SFC 编译器解析 ——
  堵住"守卫绿但应用打不开"（踩过一次：豁免标记在 CSS 里写成 `//`，PostCSS `Missed semicolon`）。
- 规范已更新：`docs/代码开发/主题与配色.md` §七 重写为两格制、§五 token 表、§八 验收清单。
- **验证**：28 个包全绿（kernel 212 / canvas-data 321 / canvas-render 390 / ui 39 /
  theme-default 202 / 插件合计 918）；官方 e2e **40/40**；浏览器实测脚本
  `packages/ui/e2e/theme-palette-check.mjs` **19/19**（含"改亮色格不影响暗色"与
  "真实连线元素取到对应主题的色"）。

### 最近修复（2026-09-25，多选拖动中缩放的跟手性）

- **拖动中缩放后内容不再跟手**（用户报："拖拽的时候缩放你的定位就出现了问题"）。
  浏览器实测（修前）：zoom=1 拖 100px 内容走 100px；缩到 2x 后再拖 100px 内容只走 60.5px
  （脱手）；缩回 1x 再拖内容走 156.6px（过冲）。根因：整组平移的位移公式是
  "(当前client − 起手client) ÷ 当前zoom" —— 中途缩放会把**已拖过的屏幕距离**按新 zoom
  重新换算，历史段被篡改。修复：改为**逐段累加**（每段屏幕增量 ÷ 该段时的 zoom），
  与 d3-zoom 拖画布手感一致；`dragStartClient` 收拢成 `lastClient`（上帧坐标）。
  修后实测三段 ratio 恒为 1.0，终点抓取点贴合鼠标。测试：新增
  `dragZoomFollow.test.ts`（4 条纯函数模型断言，含修前/修后公式对照）+ 更新
  `selectionFrameRender.test.ts` 源码断言（锁"逐段增量"实现、禁旧公式回潮）；
  multi-select 145 / group 45 单测全绿，官方 e2e 40/40，
  `multiselect-regression.mjs` 22/22（含上轮"拖动中缩放选框贴合"场景 E 仍通过）。

- **追加（2026-09-25 第二轮）· 抓节点拖拽中缩放，选框闪回拖拽前位置一帧**（用户报：
  "缩放和拖拽同时进行时，多选框会莫名出现在拖拽之前的位置，下一帧移动才恢复"）。
  与上一条同根因的另一条路径：**抓成员卡片拖**（VueFlow 原生多选拖拽，非框内空白拖）。
  该路径的框跟随用 nodeDragFrameAnchor（起手快照 + 位移），但缩放触发 refreshFrame 时
  走了"从 store 重算"分支（store 里还是拖动前位置）→ 框闪回；节点层已被 VueFlow 拉走，
  下一帧 NodeDrag 才把框拉回来。修复三件：① refreshFrame 增加"拖拽中"分支
  （interaction.isNodeDragging || nodeDragging 时保持当前位置、只按当前缩放重算间距）；
  ② NodeDrag 逐帧**快进快照**（并集快照 += 本帧位移，anchorStart 重置为本帧），
  缩放帧到达时快照已与节点同步；③ 起手快照改用 nodeUnionSnapshot（锚点读 payload
  位置，其余读 nodeLayout）。实测异常帧 41 → **0**（偏移簇只剩基准簇 + 亚像素抖动簇）。
  探针脚本已清理；验证：multi-select 145 全绿、回归脚本 22/22、官方 e2e 40/40。

### 包结构（现行，已定型）

`packages/canvas-core-v2` **已删除**（实现与测试分别迁入 kernel 与 canvas-data）。

```
@mini-canvas/kernel         纯插件框架（装载/依赖/事件/作用域回收/注册表 + tools），零画布概念、零 Vue
@mini-canvas/canvas-data    数据层 + 画布语义（nodeStore/edgeStore/graph/save/history/selection
                            + canvas/ 下节点/主题注册表、能力段、连接校验、菜单聚合、建节点、画布 Context）
@mini-canvas/canvas-render  渲染层（CanvasHost/CanvasSurface/令牌 + nodeLayout/viewport）
@mini-canvas/canvas-base    插件作者薄入口（重导出 kernel + canvas-data 类型 + define* 助手）
@mini-canvas/ui             成品应用出口（一行 CanvasHost 出画布；App.vue 装配 21 个插件）
packages/plugins/*          插件库（**24 个**）
packages/cloud-server       自托管云端（KV + 资源 + 静态托管 + MCP 控制画布）
packages/mcp-server         AI 工具链后端（MCP/SSE + 生成任务）
```

**依赖方向（已核对单向）**：`kernel ← canvas-data ← canvas-render ← plugins`。
kernel 不依赖任何 @mini-canvas 包；canvas-data 只依赖 kernel。

### 当前主线：注册场改造（执行中）

设计文档：`docs/design/core-layers-and-registry.md`（v2，已过一轮独立审核）。

解决的问题（用户原话）："功能全是堆砌上去……很多功能都需要其他的地方支持，这就又需要我提供新的 api 功能"。
两条根因：**位置是数出来的**（给节点加东西只有 5 个写死位置，加进度条要改 `BaseNode.vue`）、
**新功能只能靠加服务**（没有通用"放东西"机制，菜单就是这么来的）。

终态：三根轴（装载 / 服务 / 注册）+ 七个原语 + 一张服务归属表 **18 → 7**。

9 条决策已批准，步骤 1–3 已落地（见下）；继续执行步骤 4–9，每步独立提交、可单独回退。

⚠️ **端口默认值双源漂移**（契约金标准 §9）：宿主回落 `portZoneWidth=86` vs 主题插件 Config `10`，
差 8.6 倍。**动端口几何前必须先对齐这两处**（属行为变更，需单独拍板；步骤 1–3 未触碰）。

### 最近一轮已完成（2026-09-17）

- 架构分层调查 → `docs/tmp/architecture-layer-audit/report.md`（只读，未改代码）。
- 设计文档 v2 成稿并过一轮独立审核（两个子代理：设计审核 + 事实核验，29 条问题已修）。
- `AGENTS.md` 按现状重写（原内容指向已删除的 `packages/canvas-core-v2` 与丢失的契约文档）。
- **注册场改造步骤 1、2 已完成**（分支 `codex/registry-refactor`）：
  - 步骤 1：kernel 新增 `Registry<T>`（`registryOf` / `state` / `isDev`），+38 测试（125 → 163）。
  - 步骤 2：五个能力段（nodes/theme/commands/slots/settings）糖底改走注册场，行为零变化，
    canvas-data +6 条落点测试（275 → 281）。
  - 契约金标准 `docs/tmp/canvas-core-v2-survey/core-node-contract.md` 已重建（593 行，
    六件 66 条不变量 / 27 条易碎点）——AGENTS.md 的「待重建」标记即指它，已可解除。
  - 实测基线：kernel **163** / canvas-data **281** / canvas-render **322** / ui **26** 全绿。
  - 勘误记录：theme「同槽重复抛错」实为「同 occupant id 重复抛错」（不同 id 走 addOccupant 叠加）。

### 下一步（未开始）

**九个步骤已全部落地 + §十 验收清单全部达成 + 两轮严格审查修正 + UI 自动化验证通过**（2026-09-19）。
分支 `codex/registry-refactor`（2026-09-19 更新；提交数见 `git rev-list --count main..HEAD`）。

已完成的三件交付（目标定义的三条）：
1. **完整功能**：设计文档 §九 九个步骤全部落地（每步独立提交、可单独回退）。
2. **严格 code review**：两个独立子代理（Standards 轴 + Spec 轴）复查；
   3 条硬违规（H1/H2/H3）逐条核实后已修，5 条坏味道 + 1 条规格缺口已申报。
3. **UI 自动化测试**：`packages/ui/e2e/canvas-e2e.mjs`（真实 Chromium 跑 :5288），
   **36/36 通过**。跑法：先 `pnpm -C packages/ui dev`，再 `pnpm -C packages/ui e2e`。

另外，设计文档 §十 验收清单最后两条（**ui 组件目录场** = 决策 4、**能力包** = 决策 9）
已于 2026-09-19 落地，见下方「两条收尾已完成」。

**新增交付（2026-09-19）：自省 API `ctx.surface()`**（用户需求：列出注册的列表 + 它们支持的参数）

```ts
const s = ctx.surface();
s.services;   // [{ name, source, methods }] —— 按名可取的服务 + 谁注入的 + 方法清单
s.registries; // [{ kind, keys: [{ key, count }] }] —— 每个场有哪些键、几条
s.commands;   // id/title/keys/areas/group/icon + origin: field|service
s.tools;      // 生成工具声明式参数（key/label/type/options/default/min/max/step…）
s.modelTools; // 模型可调用工具（description/parameters JSON Schema/outputSchema）
```

要点：只读、零副作用、created/started 皆可调。`origin:'service'` 标出「走 command 服务直注册」
的命令（建节点/删除/撤销/重做 4 条不进注册场，只读场会漏报）；`methods` 用 descriptor 反射取
方法名、**不执行 getter**，属 best-effort 诊断字段。

**两条「扩展」项收尾已完成（2026-09-19）** —— 设计文档 §十 验收清单里**属本轮范围的两条**（都在
「扩展」段）已勾上；§十 其余条目（分层/可诊断/工具等）是**整套终态的**验收项，不在本轮范围内，
仍保持未勾，别误读成"全面验收通过"：

1. **ui 组件目录场**（决策 4，commit efa6e5c）：`canvas-render/src/contracts/uiCatalog.ts`
   （`uiComponent` / `useUiComponent` / `uiNames` / `UI_NAMES`）；theme-default 把
   button/dropdown/select/slider/toolParamField 登记进 `registryOf('ui')`（id='default'）。
  边界照决策 4：只收"希望被主题整体换掉"的设计系统件，插件内部小组件照旧 import。
   **并已接上真实消费者**（8eea382）：node-image / node-text / node-video 的按钮·下拉·参数控件
   全改走 `useUiComponent` 按名取，这些文件对 theme-default 的 import 清零；
   `useUiComponent` 由快照改成**响应式 Ref**（订阅 ui 场）—— 换主题当场生效，消费组件不必重挂。
   测试：uiCatalog 6 条（含"目录换成新组件后同一消费组件渲染出新组件"）+ node-image 136 /
   node-text 65 条改为**经目录取真件**渲染（而非 import）+ e2e 3 条（按键可枚举 / 叠层换主题 /
   换目录后节点控制栏按钮真的跟着换）。

2. **能力包**（决策 9，commit d6dffae）：`canvas-render/src/contracts/capabilities.ts`
   + `components/RegionEntryHost.vue` + `contracts/standardCapabilities.ts`（宿主标准四件
   node/zoom/selected/tools，id='host:standard'、order=100）。组件在 `ctx.nodes.attach` 里写
   `needs`；BaseNode 持有**每节点一份**的实例缓存（`createCapabilityCache`），
   十个区域渲染位经 `RegionEntryHost` 按各自 needs 取袋并 provide（`useCapabilities()` 取）——
   于是同一节点上的"按钮"与"它打开的面板"拿到的是**同一个**实例。
   决策 9 三件事全落地：① 任何插件可注册（叠层 order 小者赢，主题可整套换掉）；
   ② **每节点一份实例**、由消费它的组件回收（BaseNode 卸载时统一 dispose）；③ `needs` 缺项 dev 抛错（写明缺哪个、谁声明的）
   / prod undefined + warn。
   测试：capabilities 13 条（含"**每节点一份实例**：两条条目同 needs → 工厂只调 1 次且同对象"、
   热换重造、dispose 回收）+ SSR 端到端 6 条（attach→BaseNode→provide→组件 inject 整条链，
   含 dev 抛错、"两条目各带自己 needs 互不串"、"同 needs 两条目共享实例"）+ e2e 2 条。

   另有 61f3180 修掉两个"配了却没生效"的缺陷：**ctx.isDev 在真实宿主里恒为 false**
   （决策 9 的 dev 抛错分支因此是死代码）。原因是 vite 的 import.meta.env 替换只作用于应用包自身源码，
   canvas-render 作为 workspace 包读不到替换；改为由 packages/ui 的 App.vue 显式传 :dev。
  接通后暴露第二处：**RenderEvents 等事件名从未 registerEventName**（§7.4 要求），已全部补齐
  （canvas-render 的 RenderEvents 全量 + clipboard/edge-cutting/canvas-export/context-menu/theme-default）。
  e2e 新增 2 条锁死：**零条 "[EventBus:dev] 未声明的事件名" warn** + **dev 开关接通（isDev === true）**。

3. **自省 API 补两条轴**（2e3f199，回应用户"列出注册的列表 + 它们支持的参数"）：
   - `surface().registryEntries[].fields`：条目值的**顶层字段名**（如 node/type 的 `{type,label}`、
     区域条目的 `{component,needs,props}`）。两处收窄（只认朴素对象、识别组件形状即跳过、下划线键不算），
     否则这条轴只会输出 `__name`/`setup`/`render` 这类编译内部物。
   - `surface().events`：`registerEventName` 的登记表此前只进不出，现在可直接列出"有哪些事件可监听"。
   仍未闭合（如实申报）：capability 工厂签名/实例形状、ui 每个组件的 props、theme 槽当前赢家
   （可经 `ctx.get('themeRegistry').winner(...)` 取）、某 type 用了哪些区域词。

**遗留（已申报，非阻塞）**：
- `settingsPersist` 收回 save 内部、四个插件服务收回内部（都有既有测试直接断言，风险/收益不划算）；
- 剩余几个 kind 的场仍无生产读取端（5c 前过渡态；`ui` 与 `node/shell` 两条已补上读取端与订阅，见上）、
  §2.2 通配查找未实现；
- **端口默认值双源漂移**（契约金标准 §9，86 vs 10）—— 动端口几何前必须先对齐。

### 步骤 8 / 9 已完成（2026-09-18）

**步骤 8 · 收口 ui 出口**（8414b6a）
- 新增 `packages/ui/src/index.ts` —— package.json 的 main/types/exports 此前指向**不存在的文件**，
  现在真实存在。导出应用本体（`CanvasApp` / `mountCanvasApp`）与装配决定
  （`APP_PLUGINS` / 存储工厂 / 首屏种子）；有意不导出 `CanvasHost` / `SettingsHost`
  （想自己组装的人应直接依赖 canvas-render）。
- 新增 `packages/ui/src/assembly.ts` —— 21 项插件清单从 `App.vue` 抽离，换一套组合不用改 UI 组件。
- 新增 4 条入口链测试（`entrypoint.test.ts`）。ui 27 → 31。
- **块二（两个后端复用画布模型）经评估明确不做**，依据可复现（已落代码注释 + 本文件）：
  ① `npm pack` 实测 canvas-data 的 tarball 只有 src/*.ts 无 .d.ts，且 39 处 import kernel
  （kernel 同样 private），所以「发布 canvas-data」实为「先发布 kernel」，卡在范围外；
  ② 两边的画布不是同一种东西（canvasDoc 存语义类型 vs GraphModel 存渲染类型
  `type: custom` + `data.nodeType`；边 id 也不同源 `e-{s}-{t}` vs randomUUID）；
  ③ 存储形态本就不同（KV vs workspace/project-{id}/canvas.json）。
  将来真合并的顺序：先发布 kernel → 再发布 canvas-data → 然后抽共享内核。

**步骤 9 · 删区域词垫片**（f5433af）
- `NodeSegment` 收窄成 `NodeRegion`（十个区域词，单一来源 region.ts）—— 老词写进去
  就是 TS 报错。删掉 `SEGMENT_TO_REGION` 与四个垫片函数。
- 作者侧字段 `content` 一并改名 `in`（留着就是把垫片换个位置留下）。
- 运行时兜底：`assertRegion(value)` 挂在所有入口，非区域词当场抛错并列出合法词。
- 迁移：生产代码 14 处 → 3 处（仅 `RETIRED_SEGMENT_NAMES` 单一来源，只用于报错文案）。
- **`BaseNode.vue` 未动**（步骤 3 已是按区域词遍历，从不读老段名）；六个核心节点件 diff 全空。
- 新增 `nodeRegionTypeLock.test.ts` 用 `@ts-expect-error` 锁编译期（老词又变合法则指令报 unused）。
- canvas-data 306 → 312。

**全量实测基线（2026-09-19，第四轮审查后）**：kernel 212 / canvas-data 314 / canvas-render 359 / ui 31 /
24 个插件包全绿（合计 1303，theme-default 177）/ mcp-server 47 / cloud-server 109；
kernel、canvas-data、canvas-render、canvas-base 四个 typecheck 0 错；
`pnpm -C packages/ui build` 通过；UI e2e **36/36**。

### 步骤 5 / 6 / 7 已完成（2026-09-18）

**步骤 5 · 服务合并（5a/5b）+ menu 删除**（5 个提交 483e3fd…465d3e7）
- **5a**：新增 `canvas-data/src/docService.ts` —— `doc` 门面（门面 + 按名惰性解析，
  与 cordis 规范一致，服务热换后不会用到旧实例）。进 `doc` 的：读（getNodes/getNode/
  childNodesOf/types 只读投影/getEdges/getEdge）、写（createNode/addNodes/updateNode/
  updateNodes/updateNodeData/removeNodes/addEdge/connectEdge/removeEdges）、事务与撤销
  （transaction/undo/redo/canUndo/canRedo/undoDepth）、快照落盘（snapshot/replaceAll/
  onCommit/hasPendingCommit）、subscribe。**留内部**：registerType/orphanTypes 等（类型注册
  正式入口是 `ctx.nodes.register`，避免第二条注册路径）、prune/orphan 内部维护动作。
- **5b**：21 个插件包的 `inject` 改到 `doc`（老名保留）。剩下用老名的都是有意保留：
  `canvasBasePlugin`（门面数据来源，5c 才下线）、`docService`/`capabilityLayer` 内部解析、
  `CustomEdge.vue`（核心节点件红线禁改，其 edgeStore 写路径是契约 §4.3-15 记录的回退路径）、
  `plugin-history`（职责就是薄适配老名）、3 处迁移期兜底。
- **menu 删除**：删 `menuService.ts` + 导出 + `ctx.inject('menu')` + `CanvasHostHandle.menu`；
  `buildMenuItems` **复活为生产代码**；类型保留（5 个文件在用）。改的测试严格限决策 8
  例外清单（另加删 `menuService.test.ts`，6/8 条在 plugin-context-menu 有等价覆盖）。
- `image-meta` 探针已删（决策 4.3）。

**步骤 6 · 工具四缺口**（fe3f7bd）
- 新增 `kernel/modelTool.ts`：事件（`tools/registered|unregistered|result`，
  **同时 registerEventName** 解决 dev warn；挂点在场本身，因为同 id 顶替只有表知道）、
  `defineTool`（parameters→JSON Schema，复用 ToolParamDef、零依赖）、
  `callId`/`signal`（可关联可取消）、`output.schema`+`render`（产物规范化 + text/json 可持久化块）。
- 验收硬指标跑通：教程第 7 章的 tool-logger 观察者插件输出与教程逐字一致，已固化成测试。
- `ctx.tools`（画布生成工具目录）**原样未动**，两套工具不混。

**步骤 7 · 拆插件循环依赖**（d7a90b6）
- 路线乙：只断 theme-default → 节点插件（那条腿是纯死声明：全仓零 `ctx.text` 消费点）。
- 红绿双验证"只断一头足够"（环是闭合路径，零出边即不可穿越）。
- 复用件导出形态未变（契约 §10 约束）；新增 3 条断环守卫测试（做了红测）。

**实测基线（2026-09-18）**：kernel **196** / canvas-data **306** / canvas-render **333** /
ui **27** / 24 个插件包全绿 / mcp-server 47 / cloud-server 109。
既有测试除决策 8 例外清单外一条未删未改。

### 步骤 8 已完成（2026-09-18）

**块一 · 收口 packages/ui（必做，已完成）**

此前 packages/ui/package.json 的 main/types/exports 都指向 ./src/index.ts，而**该文件不存在**
（安装方 import 本包会直接模块找不到，仓库内却没有任何测试会红）。

1. 新增 packages/ui/src/index.ts（真入口）：导出 CanvasApp（= App.vue）、mountCanvasApp(root)
   （一行挂载），以及装配决定 APP_PLUGINS / createDefaultStorageAdapter / seedDefaultCanvas /
   SAMPLE_TEXT / SAMPLE_IMAGE_URL。有意**不**导出 CanvasHost / SettingsHost：想自己组装一套的人
   应当直接依赖 canvas-render，那是另一条路，不是本包的成品出口（见文件头注释）。
2. 21 个插件的装配清单移出 App.vue，落到 **packages/ui/src/assembly.ts**（APP_PLUGINS 数组 +
   存储工厂 + 首屏种子）。换一套插件组合只改这个文件，App.vue 一行不动。
3. App.vue 对外行为与外观**零变化**：两个示例字面量（SAMPLE_IMAGE_URL / SAMPLE_TEXT）逐字符
   核对与原文件一致（曾一度把换行转义误写成字面反斜杠，已用字符码核对修正）。
4. 新增 packages/ui/src/__tests__/entrypoint.test.ts（**新增，未改动任何既有测试**）钉住这条链：
   package.json 声明的路径真实存在、入口导出面稳定、清单自洽（21 项 / 无重名 / 形态可装载）、
   首屏种子未变。既有 27 条 ui 测试一条未删未改。

**块二 · 两个后端的画布模型复用（评估结论：本步不做，走路线乙）**

cloud-server/src/mcp/canvasDoc.ts 与 mcp-server/src/graph/GraphModel.ts 维持各一份，不合并。
结论与可复现依据写在两个文件头部注释里，摘录三条：

 1. **前提没满足，且卡在范围外**：canvas-data 要可发布先得能编译 .d.ts，而它有 39 处
    import/export 直接依赖 @mini-canvas/kernel，kernel 也是 private 且同样只发 src/ —— 发布等于先发布
    kernel，而 kernel 在本步禁止改动。探针（tsc 以 rootDir=./src + declaration 消费一个 src-only
    的包）实测报 error TS6059: File ... is not under rootDir。
2. **两边的「同一份画布」不是同一种东西**：canvasDoc 存语义类型（text/image…）；GraphModel 存
   渲染类型（语义类型被改写成 type=custom + data.nodeType，有测试钉死）。边 id 也不同源：
   edgeIdOf 生成 e-{source}-{target}（与数据层 edgeStoreId 逐字一致），GraphModel.createEdge 用
   randomUUID()。合并就得在数据层里加一个「用哪种形态」的开关。
3. **存储形态本就不同**：本包 KV（.mini-canvas/kv/*.json）vs mcp-server 的
   workspace/project-{id}/canvas.json。真正共用的只有 JSON 字段形状，已由 canvasDoc.test.ts
   逐字比对守住。

将来若要合并，正确顺序：先发布 kernel → 再发布 canvas-data → 然后才在两个后端间抽共享内核。

  的 `dragStartPositions` 类型与用法不一致（他人进行中的改动），与注册场改造无关。
  （步骤 8 复核：该红与本步无关 —— 改动前后错误清单逐条相同；另有
  `canvas-render/src/host/CanvasHost.vue:721` 一条同属 HEAD 既有红。
  ⚠️ **另有 1 条是本分支引入的**（步骤 5b，提交 5b07677）：`SelectionFrame.vue:122` 的
  `DocService as NodeStoreService` 类型断言 —— 见「严格审查修正」一节的 H1，本轮已修。）
- 未做：5c（删 four 老名，风险最高）、`settingsPersist` 收回 save 内部、
  `shortcut-remap`/`history-facade`/`mini-map`/`auto-save` 收回插件内部
  （这四个服务名都有既有测试直接断言，改动必然牵连例外清单之外的测试，风险/收益不划算）。

## 严格审查修正（2026-09-18）

九个步骤全部落地后，做了一轮严格 code review（两个独立子代理：Standards 轴 + Spec 轴）。
共提出 3 条硬违规 + 5 条坏味道 + 1 条规格缺口。**全部先经主 agent 亲自核实真代码**，处置如下。

### H1 · ui typecheck 红 + STATUS 失真 —— 已修

审查发现：`packages/ui typecheck` 报 12 条错误，其中 `SelectionFrame.vue:122` 的
`DocService as NodeStoreService` 类型断言**是步骤 5b（提交 5b07677）引入的** ——
doc 门面返回 DocService，插件里直接 as 成 NodeStoreService，类型上不重叠（TS2352）。
而本文档宣称"全绿才前进"却没有承认它。

**修正**：该行改为兼容两种装配路径的防御式取值（doc 门面缺省回退老名），消除非法断言；
本节如实记录。剩余 11 条为 HEAD 既有红（`dragStartClient` 等，他人进行中）+
`CanvasHost.vue:721` 一条，与前几轮记录一致。

### H2 · pluginManager 把 canUninstall 三态压扁成二值静默 —— 已修

审查发现：`assertUninstallable` 只对 `reason === "core"` 抛错，`not-found` / `not-started`
被静默吞掉 —— 调用方拿 false 分不清"没有"还是"没启动"，`canUninstall` 三态可诊断的意义
被 manager 层丢弃，且 not-started 时"先删 config 再发现卸不动"的副作用仍在。

**修正**：`assertUninstallable` 对一切 `!ok` 都抛带 reason 的错误；corePluginGuard 测试补断言。

### H3 · theme.register 防覆盖行为 —— 核实后部分推翻，行为保留并申报

审查指控：糖加了"同 occupant id 重复 register 抛错"，与 main 的"顶替"语义不同，
且 capabilities.test.ts 被改写以匹配新行为 —— 违反决策 8。

**主 agent 核实（逐行 diff）**：
1. main 上 `ctx.theme.register` 走 `placeTheme` → `addOccupant`（同 id 替换不抛错）——
   行为变化确实存在（同 id 重复 register 从顶替变抛错）。
2. **但** main 的 capabilities.test.ts 里**没有任何一条**测试覆盖"同 id 重复 register"
   （8 条 theme 断言全是不同 id 或单插件场景；本分支对该文件的 16 行改动全是步骤 9 的
   content→in 机械改名，0 条涉及 theme）—— 实现新行为不需要改任何既有测试，
   测试是"自然通过"，"改测试消解门槛"的指控不成立。
3. 该行为有产品语义依据：静默顶替让"两插件抢同一 slot 同一 id"变成后装者静默胜出，
   与决策 1"core 不可被同名覆盖"的防覆盖精神一致；与 §8.2 原文的差异只是抛错范围
   （原语义只拦 default id），step2 回报已勘误。

**处置**：行为保留（更防错），本节即显式申报。同时修掉审查发现的同源 bug：
原抛错条件 `reg && themeField && …` 在"场存在而 ThemeRegistry 缺席"时漏抛，已改为
两者任一存在即校验；并核实 `placeTheme` 与场条目 id 同源（`opts.id ?? pluginName`），
热卸回收路径一致。

### 规格缺口 P1 · 决策 9 能力包未实现 —— 挂账 + 申报

`registryOf("capability")` 无实现；`ctx.nodes.attach` 的 `needs`/`props` 收进条目但无
消费方（props 不透传给组件，needs 无解析机制）—— 案例 1"两组件共享同一 state 联动"
今天不可用，此前本文件只字未提。

**处置**：本轮补最小可用版本（props 透传给区域组件）；完整能力包（capability 场 +
useCapabilities + needs 缺项 dev 抛错）单独立项，本节即申报。

### 其余审查发现（判断题，挂账不改）

- **双写漂移**：五个糖"容器 + 场"双写，id/order 各算一份（slots.register 最复杂）。
  兼容场目前无生产读者，属 5c 前过渡态；5c 落地时删容器、消费方读场，双写自然消亡。
- **死表群**：node/type、node/shell、node/creator、theme、setting、command、slot 七个 kind
  只有写入端无生产读取端（除 node/region 与 tool）。同为 5c 前过渡态。
- **通配查找未实现**：§2.2 的"精确→通配→默认"三段查找未做（现只有精确键 +
  node/region 消费方手动双查）。现用法无损失；region.ts 已注释标注。
- **"ui" 目录场未建**：案例 4 是提案（设计文档自述），非九步骤之一；决策 4 悬空但无违反。
- **BaseNode 区域条目热装响应性**：已渲染节点上运行期 attach 不触发重渲染（无订阅链），
  无测试覆盖，挂账后续任务。
- **5c 未做**：四个老名下线被 CustomEdge 红线卡住（需先解禁或迁移其写路径），
  属设计文档自己的分段安排。

### 步骤 4 已完成（2026-09-18）

**A. 决策 1 的 `core: true` 标识（三处改动 + 两个新面）**

- `kernel/types.ts`：`PluginModule.core?: boolean` + `CanUninstallResult` 类型。
- `kernel/pluginClass.ts`：类形态分支透传 `static core`（原只拷 name/inject/Config/apply，会被丢掉）；
  对象形态原样返回（字段本就在）。
- `kernel/Context.ts`：`uninstallPlugin` 唯一权威守卫（core → 返回 `false`，**不 dispose fiber、
  不发 `ctx:plugin-uninstalled`、不触发 `retractUnsatisfiedActives`**）；`corePlugins` 表在
  plugin/installPlugin 归一时刻登记、装载失败与 stop 时清除；`inspectPlugins()` 每项带 `core?: boolean`；
  新增 `canUninstall(name)`（`ok:true` / `not-started` / `not-found` / `core` 四态，含插件作用域）。
  `stop()` / `stopAsync()` **不拦**（整体生命周期终结，不是动态卸载）。
- `canvas-render/pluginManager.ts` 四条路径各自处理被拦：`uninstall`（**先问再动**，不再先删 config；
  core 抛 `core plugin cannot be uninstalled`）、`reload(name)`、`reload(name,next)`（修掉"卸失败仍继续装
  → 重名抛错"的硬 bug）、`installOne` 同名覆盖。
- `createMiniCanvasHost` 的 `api.reloadPlugin` 同一条虫也一并修（HMR 走的就是它）。

**B. 步骤 4：`canvasBasePlugin` 收编 15 行装配**

- 新增 `canvas-data/src/canvas/canvasBasePlugin.ts`：`createCanvasBasePlugin(opts)` 返回
  `{ name, plugin, services }`；`apply(ctx)` 注入 12 件基础服务（save/nodeStore/edgeStore/resources/
  nodeRegistry/themeRegistry/selection/history/graph/command/menu/nodeFactory）+ 注册画布通用命令 +
  建配置持久化桥；`plugin.core = true`。
- `createMiniCanvasHost` 缩成"建 ctx → 装基础插件 → 装业务插件 → start"；`ctx.inject` 15 → **2**
  （只留 `nodeLayout`/`viewport`：真属渲染层、必须挂载时注入）。对外契约零变化，
  `canvas-base` 从 `api.listPlugins()` / `manager.list()` 隐去（对应用层是"环境"不是"清单项"）。

**测试**：kernel 163 → **177**（corePluginGuard 14）、canvas-data 295 → **303**（canvasBasePlugin 8）、
canvas-render 322 → **333**（canvasBaseHost 11，含"ctx.inject ≤ 2"源码断言与 manager 四路径）；
ui 26 / theme-default 170 全绿（既有测试一条未删未改）。

> 与文档不符处：设计文档说 `uninstallPlugin` 返回 `false` 与"插件不存在"同值，歧义"由下一步解决"——
> 本步按 §决策 1「返回值定案」实现为新增 `ctx.canUninstall(name)`，与原契约并存。

### 步骤 3 已完成（2026-09-17）

- `ctx.nodes.attach(type, req)` 一等 API（区域进键，落 `node/region` 场）。
- 老五段映射层（content→in / title→title / top-toolbar→out:top / bottom-toolbar→out:bottom /
  overlay→over:inset），读写两条路径同场、同 id 去重、基座优先。
- `BaseNode.vue` 改按区域遍历渲染，新增 out:left / out:right / on:top / on:bottom / over:outset
  五个渲染位（挂 LOD 门）；金标准 §1.4 的 22 条不变量逐条自查未破坏。
- 测试：canvas-data 281 → **295**（region 7 + attach 7）、theme-default 158 → **167**（十区域 SSR + LOD 9）；
  kernel 163 / canvas-render 322 / ui 26 全绿，既有测试一条未删未改。

## 二、验证命令（每次改完跑，测试是唯一裁判）

根目录**没有**统一 test 脚本，各包各自跑：

```bash
pnpm -C packages/kernel test           # 202（surface 自省后）
pnpm -C packages/canvas-data test      # 314（步骤 5c 后）
pnpm -C packages/canvas-render test    # 333（步骤 4 后）
pnpm -C packages/ui test               # 26（整装 / 设置覆盖 / 插件装配）
pnpm -C packages/plugins/<插件名> test   # 单个插件，如 plugin-theme-default（170）

pnpm -C packages/kernel typecheck           # tsc --noEmit
pnpm -C packages/canvas-data typecheck      # tsc --noEmit
pnpm -C packages/canvas-render typecheck    # tsc --noEmit
pnpm -C packages/ui typecheck               # vue-tsc

pnpm -C packages/ui dev                     # 起画布应用看画面（:5288）
```

UI 端到端自动化（需 dev server 在跑）：`node packages/ui/e2e/canvas-e2e.mjs` —— **36/36**（或 `pnpm -C packages/ui e2e`）。
控制台 warn 明细：`E2E_SHOW_WARNS=1 node packages/ui/e2e/canvas-e2e.mjs`（按去重分组打印）。
自省：`ctx.surface()` 一次列出服务 / 注册场 / 命令 / 工具及其参数（见设计文档「十一·补」）。

> 数字为 **2026-09-18 实测**；会随开发变动，以本文件"最近一轮"记录为准。
>
> ⚠️ `packages/ui typecheck` **在 main 与 HEAD 上都是红的**（2026-09-19 实测：main 12 条 / 分支 11 条；
> 全部落在 `plugin-multi-select/src/SelectionFrame.vue`（`dragStartPositions`/整组平移那批未完成的改动）
> 与 `canvas-render/src/host/CanvasHost.vue:721`），**与本轮改造无关**（把本轮改动 stash 掉同样红）。
> kernel / canvas-data / canvas-render / canvas-base 四个 typecheck 均 0 错。

## 三、关键契约锚点（动手前读对应文档，不许自己发明接口）

- 架构与分层设计（终态 + 迁移步骤 + 决策记录）：`docs/design/core-layers-and-registry.md`
- 插件作者教程（7 篇，照抄能跑）：`docs/plugin-dev/`
- 各包 API 手册（按现行三层包结构分层）：`docs/代码开发/00-总览与架构.md`（子目录 `kernel/`、`canvas-data/`、`canvas-render/`、`plugins/`）
- 节点交互区域与拖线规范：`docs/规则/节点区域与连接线拖拽规范.md`
- 插件系统目标与验收：`docs/goal/plugin-system-goal.md`
- 架构决策记录：`docs/adr/0001-canvas-core-v2-plugin-kernel.md`
- 核心节点件行为契约金标准（2026-09-17 重建）：`docs/tmp/canvas-core-v2-survey/core-node-contract.md`

**v1 老版（只读参考，不碰）**：`packages/canvas-core/`、根 `src/`。

## 四、铁律（每条都要守）

1. **测试是唯一裁判**（亲眼见 runner 全绿）；浏览器画面只是演示，能跑/能恢复必须有无头测试兜底。
2. **契约不自己发明**（只按上面锚点实现/消费；要改契约先改文档）。
3. **不碰 v1**：根 `src/` 与 `packages/canvas-core`。
4. **核心节点件禁止改坏**（`plugin-theme-default/src/components/` 下的 node/edge/background 组件）。
5. **不改测试**（除非本任务明确要求先改测试）。
6. 卡住就停下（同一改法失败 >2 次 → 用新信息重写该步 spec 或上报），不脑补不无限重试。
7. 每步绿了就原子 commit，suite 全绿才进下一步。
8. 高危模块（内核 / save / 连接 / 核心节点件）动前先确认测试网在且绿。
9. 架构决策 / 接口契约 / 依赖排序 / 集成验证 / 评审关卡留在主 agent，不下发给并行子代理。

---

# 五、历史记录（按时间倒序，只供追溯）

> 以下是逐轮开发记录，保留原貌便于追溯"当时为什么这么改"。**不代表当前状态**，
> 其中的路径（`packages/canvas-core-v2` 等）与测试数字都是当时的快照。

## 变更记录（2026-09-14 ~ 09-17）

**本轮变更（2026-09-14）：三层包结构定型 —— kernel / canvas-data / canvas-render**。
`packages/canvas-core-v2` 删除（实现与测试分别迁入 kernel 与 canvas-data）；
画布通用命令（建节点/删选中/撤销/重做）从独立插件包 `plugin-canvas-commands` **收进 `canvas-data`**
（`src/canvas/canvasCommands.ts` 的 `registerCanvasCommands`，宿主 boot 时默认注册，命令 id/keys 逐字不变）；
同时删除死代码包 `plugin-custom-handle`（全仓无人 import）。插件库 24 → 22 个。
当时验证基线：kernel 125 / canvas-data 257 / canvas-render 215 / ui 23，22 个插件包共 872 条。

**已知遗留（与本次无关）**：`plugin-theme-default` 的 `typecheck` 脚本用 raw `tsc` 处理 `.vue`，
报 `export type { X } from './X.vue'` 找不到导出（HEAD 里就存在）；其余 29 个包 typecheck 通过。

**本轮变更（2026-09-16）：画布交互配置收进「常规/画布」（对齐 v1 VueFlow 交互开关）**。
v2 渲染宿主此前只绑 minZoom/maxZoom（组件写死 0.2/2），其余 VueFlow 交互一律吃库默认值 ——
既不能配，且 5 处与 v1 行为不一致（edgesUpdatable/selectNodesOnDrag/zoomOnDoubleClick/
connectOnClick/onlyRenderVisibleElements）。本轮：
1. 新增 `canvas-render/src/contracts/canvasInteractionSettings.ts`（纯逻辑可单测）：18 项 schema
   （17 个开关 + 网格间距 X/Y）、默认值逐项对齐 v1 core、resolve/apply 纯函数（缺项/非法逐项回落默认）。
2. `createMiniCanvasHost` 在插件装载后、持久化桥 restore 前 `settings.define(常规/画布, …, 'canvas-render')`
   —— 宿主级声明不随插件热卸回收；用户已保存值命中快照作初值；设置面板自动长出这组配置，
   改动经 settingsPersist 跨刷新恢复。
3. `CanvasHost` boot 后把 settings 读成响应式 interactionSettings 并订阅 onChange 实时更新；
   `CanvasSurface` 全部绑到 `<VueFlow>`（nodesDraggable/nodesConnectable/elementsSelectable/edgesUpdatable/
   selectNodesOnDrag/snapToGrid/snapGrid/zoomOnScroll/zoomOnPinch/panOnScroll/panOnDrag/zoomOnDoubleClick/
   connectOnClick/onlyRenderVisibleElements/preventScrolling/minZoom/maxZoom）。行为对齐 v1：
   边可重连、拖节点不再顺手选中、双击不再缩放、点击不再连线、只渲染可见元素默认开。
   `CanvasHost` 的 minZoom/maxZoom props 兼容保留但不再生效（settings 单源）；ui demo 删除写死的传参。
4. 测试：canvas-render **241**（+16：schema/resolve/apply 12 条 + 宿主声明/持久化 2 条 + 原有全绿）、
   ui **23** 全绿、theme-default 118 / canvas-data 274 抽查全绿；canvas-render `tsc` 0 错、ui `vue-tsc` 0 错。

**修复（2026-09-16 同日）：auto-layout 的 minZoom/maxZoom 与宿主「常规/画布」撞 key 导致 boot 失败**。
settings 的 key 全局平面命名、define 重复 key 会抛错 —— auto-layout 的「聚焦最小/最大缩放」用了裸
minZoom/maxZoom，与宿主声明的画布缩放范围冲突（宿主先声明，插件装配即炸）。按本仓约定
（multi-select 的 multiSelectFrame*、align-arrange 的 alignArrange* 同例）改成 autoLayoutMinZoom /
autoLayoutMaxZoom，引擎内部字段名（AutoLayoutConfig.minZoom/maxZoom）不变。教训：新增设置 key
必须带语义前缀；裸通用词属于全局公共命名空间。

**修复（2026-09-16 同日二）：「常规/画布」改动不实时生效（用户实测反馈）**。
根因：CanvasHost 订阅回调里调用的 `applyCanvasInteractionChange` 是纯函数（返回新对象），
回调**丢弃了返回值**、没写回响应式 interactionSettings —— 链路断在最后一步，VueFlow 绑定永远拿旧值。
此前 12 条单测全测纯函数本身，恰好没盖住"回调把结果写回响应式对象"这一步（教训：接线层的
in-place 语义必须有测试锁，纯函数绿 ≠ 链路通）。修复：新增 `applyCanvasInteractionChangeInto`
（原地 Object.assign 写回、引用不变、无变化不触发、返回是否真改），回调改用它；+5 条测试
锁原地写回/无变化短路/不认识键短路/非法回落/snapGrid 元组联动。canvas-render **246** 全绿。

**调整（2026-09-16 同日三，用户指定）：「常规/画布」删除 2 项 + 描述去 v1 字样 + selectNodesOnDrag 说明修正**。
- 删除「点击连线」(connectOnClick)与「边可重连」(edgesUpdatable)：宿主没有重连落边链路、点击连线在
  v2 的连线校验语义下易误触，均不该作为可配项暴露（VueFlow 端回落库默认，行为与 v2 现状一致）。
  「常规/画布」18 → 16 项。
- 全部 description 改为直接介绍功能，不再出现"v1 默认关/开"字样。
- 「拖拽选中」(selectNodesOnDrag) 用户反馈开了没效果：VueFlow 1.48 该开关在节点按下时才生效
  （useDrag.startDrag 里 handleNodeClick），宿主渲染态节点每次 syncFromStore 都带 selected 投影 +
  内核 selection 单源（onNodeClick 走内核 clickNode），按下即拖的场景下两边时序使"顺手选中"被
  随后的投影覆盖/无从体现 —— 该项在 v2 架构下无实际效果，先保留声明（不删 key 防旧配置残留报错），
  后续如确认无用再随设置清理任务移除。
- **「拖拽选中」真修复（同日四）**：根因 = v2 选中单源在内核 Selection，VueFlow 内部
  select-on-drag 不回写内核 → 内部选中瞬间被渲染投影覆盖。修复：宿主 onNodeDragStart 显式调
新纯函数 `dragSelectNode(selection, id, {enabled, selectable})`（开关关/不可选中不动、
已在选中集保持整组、否则单选替换）把"顺手选中"写进内核。+4 条测试；canvas-render **250** 全绿。

**新增（2026-09-17，用户指定）：多选标记可配（大小 / 颜色 / 低缩放显示开关）**。
用户原话：「这个多选标识变小一些，并且支持改变颜色，在这个插件的 Config 中提供对应配置，
同时支持大小 size；并且支持一个开关 —— 当前在低缩放下不显示，我希望你支持一个开关支持显示」。
1. 新增纯逻辑模块 `plugin-theme-default/src/components/node/multiRadio.ts`：默认值（18px / #111827 /
   低缩放不显示）+ 三个配置键（`nodeMultiRadioSize` / `nodeMultiRadioColor` /
   `nodeMultiRadioShowInLowDetail`，带语义前缀防撞别的插件）+ `resolveMultiRadio`（逐项非法回落）+
   `applyMultiRadioChange`（不认识的键**原样返回同一引用**，不触发无谓重渲染）+
   `multiRadioStyle`（大小写在元素上、再乘 `1/max(zoom, titleScaleMinZoom)` 反缩放）。
2. `Config` 新增「节点/多选标记」一组三项（number 滑块 12–48 / color / boolean），设置面板自动长出，
   改动经 settings.onChange 窄更新到 `BaseNode` 的 `MULTI_RADIO` ref → 实时生效、不整图重建。
3. `BaseNode.vue`：标记的显隐改为 `showMultiRadio`（多选 && （非低细节 || 开了开关）），
   内联样式改走 `multiRadioStyle()`；CSS 里写死的 `width/height: 26px` 与 `transform-origin` 删除、
   颜色由 `currentColor` 承接（`.v2-multi-radio-icon` 改 `color: inherit`）→ 原来"变小一些"的诉求
   默认即生效（26 → 18px），颜色/大小/开关三项都在设置里可调。
4. 测试：multiRadio 纯函数 **15** 条 + Config 声明 **6** 条（对齐 multi-select 的 config 测法）+
   BaseNode 渲染 **7** 条（默认更小 / 配置驱动大小 / 配置驱动颜色 / 低缩放默认不显示 / 开开关后显示 /
   开关不改变"只在多选时出现" / 阈值同源），ui 设置覆盖度 +**1** 条（"节点/多选标记"出现在真实
   设置页面且可改可读）。theme-default **153** 全绿、ui **26** 全绿，canvas-render 251 /
   canvas-data 275 / multi-select 127 / node-text 65 / node-image 148 回归全通过；theme-default
   仅剩**既有**的 raw tsc 对 `.vue` 再导出报错（STATUS 早先已记录），本次新增文件无报错。
   说明：本次改动全部落在 `plugin-theme-default`（不改内核/渲染层），多选框几何与 multi-select 插件不受影响。

## 当前主线（2026-09-04，历史）：canvas-core-v2 重构 · 开发测试期最小闭环
目标：把旧画布(180 文件, `packages/canvas-core/src`)收敛成自研 Cordis 内核(`packages/canvas-core-v2`)，先做出"text + 最简 image 两节点、能拖能连能删、起 vite 看到、刷新不丢"的最小闭环。**红线：不碰 `src/`(老版宿主)，不把 M6 复杂件(image 裁剪/蒙版/25个交互插件/云)带进当前闭环。**

## 当前进度（哪个里程碑）
- ✅ M0：M1 内核(Scope/Context/topo) + tracer bullet 全链 demo —— 83 测试绿
- ✅ runbook 修订 + 核心节点件行为契约金标准已产出(见下方契约锚点)
- ✅ **M1(浏览器)最小闭环骨架**：vite + localStorageAdapter + image 插件 + NodeStore.removeNode + CanvasDemo
- ✅ **M2：NodeRenderer + 最小 BaseNode 壳 + node:{type}:* slot** —— core/registry(NodeRegistry 纯逻辑无 Vue) + nodeRenderer 解析 + components/BaseNode.vue
- ✅ **M3：命令/删除收敛** —— Selection/History/CommandRegistry/NodeFactory + command:delete/create-node/undo/redo + CanvasDemo 全走命令 + 最小右键菜单
- ✅ **M4：Save 层完整 + key 规范 + 生命周期 flush + 契约测试网** —— keys.ts + browserFlush(visibilitychange/pagehide) + saveContract.test
- ✅ **M5：连接内核（加固）** —— 原样吸收 v1 normalize/canonical/环检测/去重 + 声明式 inputs/accepts/limit；demo connect 走内核校验；connection.test(15 例) 锁死 v1 规则 —— 83 测试绿
- ▶️ **M1~M5 已全部达成**（runbook 主闭环完成）。M6(image 复杂件/Video/panorama/云等)= runbook 声明的**另开任务**，红线不并进当前闭环。
- ✅ **插件抽独立包(dsh 范式) 最小样板**：text/image 节点抽成 `packages/plugins/plugin-node-{text,image}` 独立 workspace 包，UI(content .vue)+逻辑一体、随包注册(`registerNodeType`)，宿主按 `bootCanvas({plugins})` 清单加载、零手 seed —— vite demo 可拖/连/删/编辑/刷新恢复，101 测试全绿。插件开发指南：`packages/plugins/README.md`。
- ✅ **M6 开篇：四个节点各自独立成包并复刻 v1 能力**（2026-09-12，用户指定开启 M6 的节点子项）：
  - `plugin-node-text`：加底部状态栏（字数/行数/复制/删除）；修掉编辑框拖拽坑（nodrag/nopan）、补外部写回同步（撤销/重做后画面跟着变）。
    （⚠️ 本轮还加了"顶部操作条（加粗/字号/颜色/对齐）"，**下一轮已被用户否决并删除**——对文本节点无语义，见下方工具层那条。）
  - `plugin-node-image`：补回 v1 的节点控制端——顶部操作条（上传 → dataURL 落 data、裁剪入口）+ 底部状态栏（文件名/宽×高/大小/裁剪中/失效）+ 裁剪覆盖层（可拖可缩放、几何为纯函数）+ 旋转/下载；裁剪**原地替换** imageUrl，裁剪态只存组件本地（不写 `data._overlay`，避免刷新复活）。
  - `plugin-node-3d-preview`（新包）：照 v1 PanoramaNode 复刻 three.js 球体全景预览，拖拽转视角 / 滚轮缩放 / 重置；视角数学与贴图来源判定抽成纯函数。
  - `plugin-node-image-compare`（新包）：连两张图用可拖拽分割线对比，最多 2 条输入、FIFO 挤最老，分割线位置落 data。
  - 宿主 `packages/ui` 装配清单已加入后两个新插件；新增整装测试 `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`（四类型注册/段齐全/可建可卸、无残留）。
  - 测试：四个包 + ui 整装共 **151 条**（text 36 / image 60 / 3d 25 / compare 25 / ui 5）全绿，内核 326 条与主题 74 条不受影响，四包 `tsc` + ui `vue-tsc` + 四包/宿主 `vite build` 全通过。
  - 其中含两条**渲染契约**测试（SSR 拿真实 HTML 断言）：`textToolbarsRender.test.ts` / `imageToolbarsRender.test.ts` —— 锁"上下状态栏确实渲染出来、只在选中时出现、纯图标按钮都有 title+aria-label"，避免只测内部 computed 而漏掉模板写错。
  - **仍未做**（属 M6 后续，别当成已完成）：扩展/蒙版/滤镜、Video 节点、AssetStore 资产落盘（当前上传走 dataURL）、云 authority。
    （"backend 生成模型与底部 prompt 栏"已在下一轮完成，见下方工具层那条。）
- ✅ **节点 AI 能力「工具层」+ 文本/图片节点按 V1 修正**（2026-09-12 第二轮，用户指定）：
  - **内核新增 `tools` 层**（`ctx.tools` / `ctx.get('tools')`，实现 `canvas-core-v2/src/services/toolRegistry.ts`，22 测试）：工具 = 拿画布上下文调**外部能力**（与 command=画布内部动作 分工）。声明式 `params` 让节点 UI **自动**长出控件；`produces`/`accepts` 让节点按需筛选；`invoke` 把"同步返回"与"提交后轮询"两种第三方形态**归一化**，异常/超时收敛成 `{ok:false,error}`。加新模型 = 装一个工具插件，**节点与内核零改动**。契约已写入 `docs/plan/canvas-core-v2-api.md` §3.2b。
  - **新包 `plugin-tool-image-generation`**（53 测试）：把第三方图片生成 API 包成工具（照 v1 的 5 个模型能力声明，id 原样保留）。同时导出 PluginModule（宿主一行装载）与纯工厂函数 `createImageGenerationTools` / `registerImageGenerationTools`（**可在别处注册复用**，host 收 ctx 或裸 ToolRegistry）。可注入 fetch、可配 baseUrl，**不做假图 mock**。
  - **图片节点底部改成「生成图片」控制栏**（照 v1 ImageBottomToolbar）：上游素材小卡片行（图片缩略图/文本卡片，可点开大图，末尾 + 加素材）+ **大输入框（用用户自己的 ProseMirrorEditor，支持 @ 引用素材）** + 模型与该模型声明的参数下拉 + 发送。面板**不认识任何模型名**，只 `ctx.tools.list({produces:'image'})` 取工具、按 `params` 自动渲染下拉。生成成功写回 `data.imageUrl`（一次写完，含尺寸、清旧图描述；可撤销可落盘），失败只显示不落盘。
  - **文本节点按 V1 修正**：删除顶部加粗/字号/颜色/对齐工具栏（对文本节点无语义）与相关样式命令/字段；内容区改回 V1 的**透明底、无边框、无 outline 就地编辑**（p-4 内边距、**回车换行不提交**、Esc 取消、blur 提交、双击进入编辑）；底部状态栏**水平居中**（原 left:0 左贴边）。
  - 测试：相关包共 **842 条**全绿（内核 348 / 渲染 187 / 主题 74 / text 16 / image 106 / 3d 25 / compare 25 / 工具 53 / ui 整装 8），六包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。整装测试新增"图片节点经 ctx.tools 发现能出图的工具""能按吃文本输入筛工具""运行期热插工具"三条，锁住工具链闭环。
- ✅ **控制栏贴边距离可配 + 图片节点尺寸跟随图片**（2026-09-12 第三轮，用户指定）：
  - **控制栏偏移进配置**（分组 `布局/控制栏`，key `toolbarTopOffset` / `toolbarBottomOffset`，默认 6、范围 0-40）：节点顶部操作栏、底部生成面板、文本底部状态栏原本各自写死 `calc(100% + 6px)`，现全部改由配置驱动。读取收口到 `canvas-render` 的 `useToolbarOffsets()` / `toolbarOffsetStyle()`（订阅设置变化**实时生效**、卸载退订、读不到/非法值回落 6px），避免三处各抄一遍漂移。放在 theme-default 而非各节点插件：settings key 全局一张表先声明者独占，且"浮层离卡片多远"属节点外壳几何，与既有 `titleOffset` 同类 —— 日后加视频节点白拿。
  - **图片节点宽高跟随图片**（照 v1 的 fitCardSize 规则）：`ratio = min(上限宽/图宽, 上限高/图高, 1)`，只缩小不放大，下限 120×80，量不到尺寸则保持原尺寸不猜。上限可配（`imageFitMaxWidth`/`imageFitMaxHeight`，分组 `布局/图片节点尺寸`，默认 420×300 = v1 的 MAX_PREVIEW_WIDTH/HEIGHT）。**四处写回在同一次 patch 内带尺寸**（上传 / 裁剪 / 旋转 / AI 生成出图），保证一次撤销退回原样而不是"退半步"；另在 ImageContent 加**幂等兜底**（挂载补缺失尺寸、imageUrl 变化时跟随），覆盖后台/MCP 直接写节点与旧数据。
  - 顺带补上主题变量 `--canvas-node-text-body`（文本节点正文色此前只能走硬编码回落值）。
  - 测试：相关包共 **892 条**全绿（内核 348 / 渲染 200 / 主题 74 / text 19 / image 140 / 3d 25 / compare 25 / 工具 53 / ui 整装 8）。新增测试锁：偏移解析与 CSS 拼接（含非法值/0 值/无关键不重渲染）、尺寸适配边界（大图缩小、小图不放大、比例、下限、非法返回 null）、四处写回各只产生一条撤销记录、兜底监听幂等。
  - 已知既有问题（非本轮引入，报错文件与 HEAD 逐字节一致）：`plugin-theme-default` 的 `tsc --noEmit` 会对 `components/ui/index.ts` 报两条 `.vue` 类型再导出错误 —— 该包 typecheck 用裸 tsc 跑不了 .vue 类型，需换 vue-tsc。
- ✅ **控制栏多选收起 + 文本节点生成控制栏 + 下拉统一组件**（2026-09-12 第四轮，用户指定）：
  - **多选时所有控制栏（上+下）都不显示**：根因是选中判定写成"我在选中集里" → 框选 N 个节点会并排浮出 N 份面板。新增共享判定 `canvas-render` 的 `useSoleNodeSelected()` / `isSoleSelected()`（语义 = **恰好选中一个节点且就是我**，对齐 v1 NodeToolbar 的 `getSelectedNodes.length === 1`），图片顶部操作条、图片生成面板、文本生成栏三个段组件全部改用它；两个包各自的 `useNodeSelected.ts` 删除（避免再有人用错判定）。
  - **文本节点底部改成与图片同款的生成控制栏**（`TextGeneratePanel.vue`，替换原 `TextBottomToolbar.vue`）：大输入框（用户的 ProseMirrorEditor，支持 @ 引用上游素材）+ 模型下拉 + **参数下拉**（思考程度这类就是工具 `params` 的一项，面板不认识它们）+ **模板下拉** + 发送；生成结果**直接写回 `data.text`**（一次写完，走 graph，可撤销可落盘），所以结果会出现在输入框里可继续编辑。字数/行数读数与复制、删除动作并入该栏。工具来源 = `ctx.tools.list({ produces: 'text' })`，**本包不认识任何模型名**。
  - **下拉统一用项目自己的组件，彻底去原生**：`plugin-theme-default` 导出 `Select` / `Dropdown` / `PrecisionSlider`（原本只在本包内部用），图片与文本面板的原生 `<select>` 全部换成 `Select`，视觉与设置界面同源；测试断言渲染结果里**不再出现 `<select` 标签**。
  - **内核工具层补两个声明位**：`ToolDef.templates`（预设提示词模板，工具作者声明、面板自动出"模板"下拉，加模板不用改节点）+ `resolveToolTemplates()`（含 `forTools` 共享模板收集与同 id 去重）；图片工具插件随即补上 v1 的 3 条模板（高清写实/留白极简/海报感）。
  - 测试：相关包共 **933 条**全绿（内核 354 / 渲染 206 / 主题 74 / text 45 / image 142 / 3d 25 / compare 25 / 工具 54 / ui 整装 8）；七包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。新增测试锁：多选时上下控制栏均不渲染、单选渲染、模板/参数下拉按声明长出来、无原生 select、文本写回是"一次写入"、失败不落盘。
- ✅ **控制栏布局数值全部进设置 + 设置页面覆盖度兜底**（2026-09-12 第五轮，用户指定）：
  - 用户反馈"这些配置应该也要写到我的设置页面中"。核对后：偏移项（`布局/控制栏` 的上/下控制栏偏移）、图片尺寸上限（`布局/图片节点尺寸`）、生成后台三项（`常规/图片生成`）**已在设置页**（已在浏览器实测确认）。
  - 但审计发现仍有几处**用户可见的布局数值写死在面板 CSS 里**，本轮一并做进 `布局/控制栏`：`panelImageWidth`（图片生成栏宽度，默认 650）、`panelTextWidth`（文本生成栏宽度，默认 520）、`panelEditorMinHeight` / `panelEditorMaxHeight`（生成栏输入框高度区间，默认 64–220）。读取收口到 `canvas-render` 的 `useGenPanelMetrics()`（与 `useToolbarOffsets` 同语义：订阅实时生效 / 卸载退订 / 非法值回落默认）。
  - 顺带修掉一个真 bug：图片生成面板原先用"固定负 margin"做水平居中，宽度改成可配后该偏移必然错位 —— 改为 `translateX(-50%)`，并把居中与反缩放 `scale` 合进同一个 `transform`（分写会互相覆盖）。面板背景同时改为与设置面板同材质的纯白（原为浅灰底）。
  - **新增设置页覆盖度测试** `packages/ui/src/__tests__/settingsCoverage.test.ts`：用真实内核 + 真实插件断言 `ctx.settings.groups()` 与关键键值，锁"这些配置确实会出现在设置页面里"，并约束一级分类只允许 `布局/常规/节点/边`、每个分组名都必须带二级段 —— 以后新增配置忘了写 group（界面上表现为"配置项凭空消失"）会被立刻拦住。
  - 测试：相关包共 **947 条**全绿（内核 354 / 渲染 215 / 主题 74 / text 45 / image 142 / 3d 25 / compare 25 / 工具 54 / ui 14）；五包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。
- ✅ **生成能力注册独立成插件 + 参数支持自定义组件渲染**（2026-09-12 第六轮，用户指定）：
  - 用户问"图片生成/文本生成要如何注册"，要求**注册放在单独的插件里**，参数要有名称/描述/**指定组件渲染/甚至自定义组件**。核对：图片侧早有独立注册插件（`plugin-tool-image-generation`），但**文本侧完全没有注册方** —— 文本节点面板一直显示"无可用工具"。本轮补齐。
  - **新增 `plugin-tool-text-generation`**（31 测试）：与图片侧完全同构，把文本生成后台包成工具（`produces:'text'`，结果走 `ToolResult.text`）。内置 3 个模型（思考程度/长度档位各有差异），带 4 条预设提示词模板；`POST /api/tasks` 提交 + `GET /api/tasks/:id` 轮询，进度由内核转发。同时导出 PluginModule（宿主一行装载）与纯工厂 `createTextGenerationTools` / `registerTextGenerationTools` / `registerFromBackend`（**可在别处注册**）。Config 用 `textGen` 前缀避免与图片侧撞 settings key，分组 `常规/文本生成`。**绝不做假文本 mock**。
  - **内核 ToolParamDef 扩展**：补 `description` / `min` / `max` / `step` / `placeholder` / `span`（布局权重）/**`component`（自定义渲染组件）**/ `componentProps`。`component` 是 opaque 句柄（内核不解析、不 import Vue），约定 props `param / modelValue / disabled`、事件 `update:modelValue` —— **内置控件不够用时工具作者自带组件即可，面板与内核都不用改**。
  - **新增通用参数渲染器 `ToolParamField`**（theme-default 的 UI 组件，随包导出，9 测试）：按声明渲染 select/string/number（有范围走滑块，否则数字输入）/boolean，**并优先使用 `param.component`**。图片与文本两个生成面板的参数区都改用它（删掉各自的参数下拉样板），于是"自定义组件"在两个节点上同时生效。
  - 顺带修一个真 bug：参数回写此前一律 `String()` 化，会把开关的 `true` 变成 `"true"` 发给后台、数值参数也会变成字符串。现按类型保持原值，并新增 `paramRaw()` 供渲染器取原值。
  - 测试：相关包共 **998 条**全绿（内核 354 / 渲染 215 / 主题 83 / text 45 / image 142 / 3d 25 / compare 25 / 图片工具 54 / 文本工具 31 / ui 17）；七包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。整装测试新增"两类生成工具并存且互不混入""参数声明字段齐全（label/description/options）"。
- ✅ **文本/3D 节点双态 + 图片对比宽度跟随**（2026-09-12 第七轮，用户指定）：
  - **文本节点两态**（用户原话："第一种是预览，只显示内容，超出隐藏就行，双击才进入编辑状态，提供滚动条，拦截画布的滚轮（缩放画布）"）：新增纯函数 `textViewMode.ts` 定判定（编辑态 > 缩略 > 首行截断 > 全文预览；预览态一律裁掉且**不**拦滚轮；编辑态给滚动条且把滚轮从画布手里抢过来）。编辑框除类名 `nowheel`（VueFlow 按 `closest('.nowheel')` 跳过 d3-zoom）外另加 `stopPropagation` 作双保险。新增按 nodeId 记名的会话态 `textEditSession.ts`（**不写 data** —— 写进去会落盘/进历史/被复制），顺带让"编辑态到底有没有滚动条、有没有拦滚轮"能被无头渲染直接断言（过去只能靠肉眼）。
  - **3D 预览节点两态**（用户原话："也是双击进入，进入之后可以转动视角，默认模式下是用来拖拽节点的"）：新增 `panoramaMode.ts` 把"哪种模式吃事件"收成一个开关 —— **预览模式（默认）3D 画面 `pointer-events:none`、不挂 nodrag/nopan/nowheel**，于是按住画面就是拖节点；**交互模式（双击进入）**才接管指针与滚轮（拖拽转视角 / 滚轮改视野角），Esc 或**点画布空白**退出（经内核 `RenderEvents.PaneClick`，对齐 v1 的 paneClick 收起 `_editing`）。模式会话 `panoramaSession.ts` 同样不写 data（v1 写 `data._editing`，得靠 `sanitizeForSave` 手动抠掉才不落盘 —— v2 没这层兜底，写进去必然刷新即卡在交互模式）。交互模式无论有没有图都显示"怎么退出"的提示（用户是被关进来的，不说明白会以为节点坏了）。
  - **图片对比节点宽度跟随第一条连线**（用户原话："他的宽度应该跟第一个连接线连接的图片的宽度一致"）：新增纯函数 `compareFit.ts` —— 只认**第一条连线**（两张图宽度不同就以先连的为准）、宽度取上游图片节点的**显示宽度** `data.cardWidth`（即用户实际看到的那个宽度，不是原始像素）、**拿不到就不猜**（保持原宽度，猜错比不跟随更糟）、**幂等**（算出来等于当前就一次都不写，否则监听自己触发自己转死循环 —— 与 imageFit 同一教训）。只跟宽度不动高度（高度留给用户拖）；`cardWidth` 与内核 `size` 同一次写回（只改一个会让相连边端点停在旧宽度）。
  - 测试：相关包共 **1051 条**全绿（内核 354 / 渲染 215 / 主题 83 / text 64 / image 142 / 3d 45 / compare 46 / 图片工具 54 / 文本工具 31 / ui 17）；text / 3d / compare / image 四包 `tsc` + ui `vue-tsc` + 三包与 ui `vite build` 全通过。本轮新增 7 个测试文件、60 条，其中三个是**渲染契约**（SSR 拿真 HTML 断言）：`textContentRender` 锁编辑态有没有 `nowheel` 与滚动条、`panoramaContentRender` 锁预览模式画面有没有真的 `pointer-events:none`（只看画面容器，不看模板注释）、`imageCompareWidthRender` 用记录型假 graph 锁"连上图之后确实写回宽度"。

## 现在立刻该做的一件事（2026-09-16 记录）

> 注：本节以下的每次"现在立刻该做的一件事"是当时的快照标题，逐轮累加后重复出现，已就地保留（见【五、历史记录】小节说明）。

### 本轮：拖线时压住其它连线的流光（用户指定，2026-09-16）
- 用户需求（原话）：「在拖拽连接线的情况下 其余连接线不要光斑动画效果（流光效果动画）」。
- **根因**：CustomEdge 的 `isHighlighted` 含「两端任一节点被选中」→ 多选批量连线时选中集覆盖一大片边，它们的流光全亮（用户截图：整片线都在流）。
- **改法**：新增纯函数 `flowAllowedDuringDrag({ isDraggingConnection, isTemporary })`（edgeFlow.ts）—— 拖线手势进行中只允许临时拖线本身流光，其余边（含因选中而高亮的）全部静止；没在拖线时行为不变。`CustomEdge.flowActive` 接上它，光斑渲染与逐帧动画自然一起停（每帧回调开头直接 return，零开销）。
- 注意：只压**流光动画**，不压其它视觉（选中环/线色不变）—— 需求只针对"拖线时全屏流动"的干扰。
- 验证：浏览器实测多选 3 源拖线中 —— 3 条临时线全部流光、画布既有边 0 条流光（修前全亮）；松手 3 条边正常落齐。edgeFlow 测试 18 条全绿（新增 2 条），theme-default 包其余测试不受影响。

### 上一轮：connectEdge 统一建线入口 + handle 匹配真 bug（用户指定，2026-09-16）
- 用户指出（原话）：「我觉得你这个逻辑依然存在 BUG。我的很多操作都会创建新的连接线，不管是多选批量创建还是拖拽到空白处创建节点的时候（自动创建连接线，这是右键菜单插件的逻辑）还有普通拖拽建立连接线，或者历史记录什么的。我认为你应该做一个添加连接线的函数，在这个地方解决 evictOnFull / capability 两个属性，还有验证连接线是否有效的地方，只有全部通过之后才创建」。

#### ① 真_bug：3d-preview 的"只接一条"完全失效（用户实测报的）
- **根因**：具名口容量统计写成 `e.targetHandle === effectivePort`，而声明里的 `port` 是 `'target'`、**真实拖拽建出的边 targetHandle 是 null**（edgeStore 不存默认 handle）→ `null === 'target'` 永远为假 → 容量统计恒为 0 → 永远不挤。
- **修法**：`validateConnection` 与 `pickOverflowEvict` 两处统一改为 `e.targetHandle ?? 'target' === effectivePort` —— 具名声明的 target 口与"默认 target 口"是**同一个口**，无 handle 的边必须算进去。补 2 条测试锁死（含多具名口场景：无 handle 边只算进它真正落到的那个口）。

#### ② connectEdge —— 全路径统一建线入口（按用户要求的架构）
- **背景**：画布里建线至少有 5 条路径（普通拖线 / 右键菜单拖到空白自动建节点 / 生成面板加素材 / 多选批量连线 / 云端合并与粘贴），以前每条路径各自决定"要不要校验、满了怎么办"，这是容量 bug 反复出没的土壤。
- **改法**：`graph.connectEdge(input)` 一个函数管完：**校验 → 满额挤出 → 落边**，返回结构化结果 `{ edgeId, status: ok|rejected|duplicate, reason?, evictedEdgeId? }`（空串丢原因的老问题一并解决）。`addEdge` 保留为薄包装（老调用方零改动），事务句柄同样暴露 `tx.connectEdge`。
- **迁移**：普通拖线（CanvasHost.commitEdge，删掉自查 + 手写幂等）、右键菜单真边、生成面板加素材（删掉自算挤出与 `oldestIncomingToEvict` import）、多选批量连线、云端合并、剪贴板粘贴 —— **全部走 connectEdge，没有旁路**。唯一例外仍是 `data.transient` 临时脚手架边（跳过校验/挤出）。
- `imageOps` 的 `inputCapacity` / `evictEdgeId` 参数一并删除（接口瘦了，插件作者不用再理解这些）。

#### 验证
- 浏览器实测（真实拖拽）：**3d-preview 拖第二条线 → 第一条被挤掉**，始终只有一条（修前两条并存，用户截图报的正是这个）。
- 全量回归：canvas-data **274**（新增 7 条：connectEdge 五条 + handle 匹配两条）/ canvas-render 227 / node-image 148（含改 2 条旧语义断言）/ node-text 65 / image-compare 46 / 3d-preview 71 / context-menu 51 / clipboard 23 / cloud-save 90 / theme-default 118 / multi-select 126 / ui 23 全绿；7 个包 tsc 干净。

### 上一轮：连接容量的正确语义 + 加边守门人（用户指定，2026-09-16）
- 用户纠正（原话）：「你一直在强调图片的 capacity 是1，但是我这里图片输入端口分明是可以添加多条连接线的」「最初提出这个 capacity 是因为我有一个 图片diff 节点…只有它只能连接2条连接线，其他的节点都没有限制」「这里默认就是挤，当前没有任何一个节点为拒」「你这里添加连接线的时候 绝对不能绕过这个规则检验」。
- **用户是对的，V2 迁移时把容量语义弄窄了。** 查 V1（packages/canvas-core/src/nodes/*）：image/text 只声明 acceptsInputs（**只限类型、不限条数**），全靠 image-compare 自己手写「超了挤最老」。V2 给所有节点都加了 capacity:1，行为随之变窄。

#### ① 容量的三条语义（改前 / 改后）
- **改前**：capacity 未声明 = 当 1 用（只接一条）；满额一律 limit-reached 拒。→ 图片/文本节点接不了第二个上游；而「挤老边」因为 `if (capacity < 2) return null` 这道门槛**从未生效过**。
- **改后**：
  - **不声明 capacity = 不限条数**（image / text 现在都不声明，回归 V1 语义）；
  - 声明了且满额 → **默认挤老边**（evictOnFull 缺省 true），落边时先删最老一条再加新的，同一条历史记录；
  - 只有显式 evictOnFull:false 才满额直接拒（当前**没有任何节点**用这个，与用户要求一致）。
- capacity 现在只有两处声明：3d-preview = 1（换图）、image-compare = 2（保留最老两条）。
- image-compare 顺带从「上限 2 + 1 个缓冲位 = 3」改回**如实的 2** —— 那个缓冲位是「内核不会挤」时代的 workaround，现在不需要了。

#### ② 挤出决策收口成唯一实现
- 新增内核纯函数 pickOverflowEvict()（canvas-data/canvas/connection.ts），与 validateConnection 的容量段**同源**。
- 以前这条决策散在三处：CanvasHost.evictOldestIncoming（还带着 capacity < 2 的死门槛）、plugin-node-image 的 imageOps 自己算一遍、image-compare 又用「缓冲位 + 边变化订阅」绕过一遍。**判定分散 = 行为漂移**，这正是「同一条边拖线能连、批量连却被拒」的根因。现在只有一份。

#### ③ 加边守门人：任何入口都不能绕过校验
- **漏洞**：graph.addEdge 是「图唯一写入口」，但**完全没有校验** —— 插件 / 云端合并 / 测试脚本都能把自连、成环、重复、类型不符的边直接塞进图。我上一轮就是误用这个后门「验证」图片能连多条，得出的是假结论。
- **改法**：graphDocument.addEdge 落闸（addEdgeGuarded）—— 规则不过就不落边（返回空串）。挤出也一并在这里做，同事务原子。
- **例外**：data.transient 的临时脚手架边不校验（拖线途中的占位边端点可能还没进 store），也不参与挤出。
- 新增 5 条测试锁死：自连 / 重复 / 成环 / 类型不符全部拦下；transient 边正常放行。**浏览器实测**同样四类非法边全部被拦（返回空串、一条没落）。
- 顺带把 registerNodeType 里**手抄的 inputs 字段列表**换成复用 PortDef —— 正因为抄了一份，新增 evictOnFull 时插件写了会被类型误拦。

#### 验证
- 浏览器实测（真实拖拽）：两个图片源拖到同一图片目标 → **两条都连上**（修前第二条被拒）。
- 浏览器实测：image-compare 连第 3 条 → 自动挤掉最老一条（保留最新两条）。
- 全量回归：canvas-data **267** / canvas-render 227 / node-image 148 / node-text 65 / image-compare 46 / 3d-preview 71 / context-menu 51 / clipboard 23 / cloud-save 90 / theme-default 118 / group 21 / multi-select 126 / ui 23 全绿；五个包 tsc 干净。
- 更新了 7 条断言旧语义的测试（canvas-data 连接内核 5 条 + context-menu 1 条 + image-compare / 3d-preview 各 1 条）：它们锁的正是被改掉的旧行为，按新规则重写而非删除。

### 上一轮：批量连线的"部分支持"语义（用户指定，2026-09-16）
- 用户原话：「多个节点 可以拖是拖拽一条连接线 你的目标节点应该如何判断是否可以链接？比如只要部分连接线支持就可以链接（链接的时候也只允许支持的连接线进行连接）不能一股脑的直接建立连接线」。
- **先查清了"一股脑"到底发生在哪**（三个场景浏览器实测）：落边本身**一直是逐条校验**的（类型不符、容量已满、类型级部分支持三种都只落了合法的那几条），所以"全建进去"并不存在。真正的三处问题在别处：

#### ① 容量不在批内累计 —— 这是真正会"多建一条"的漏洞
- 内核 `validateConnection` 判容量看的是"目标输入口**现有**入边数"。批量落边时每条边各自查一次图，**兄弟边互相看不见**：目标口 capacity=1 时，3 个合法源会各自都判合法、3 条一起落进只装得下 1 条的口。
- 改法：新增纯函数 `planBatchApply(specs, { isDuplicate, canConnect })`，其中 `canConnect(spec, **alreadyPlanned**)` 第二个入参就是"这一批里已经决定要建的边"。组件的 `validateBatchEdge` 把已计划的边并进"现有边"一起喂给内核校验。顺序即优先级（先到先得），与单条拖线"先连上的占住口"一致。
- 实测：两个合法文本源拖到容量 1 的文本目标 → 只落第一条（修前会落两条）。

#### ② 目标可连性被"某个源不合法"整体判死
- 原来用 `resolveFeedback` 按**单个源**跑，某一个源不合法就把整个目标画成"不可连"——哪怕别的源明明连得上。
- 改法：几何命中与合法性**解耦**。resolveFeedback 只负责回答"aim 到哪个节点"（validate 恒返回空串），合法性改用整批结论：`plan.build.length > 0` 即"至少有一条能连"→ 目标亮"可连"；一条都连不上才按非法处理，并把真实原因（如"类型不匹配"）透到气泡。
- 注意"已存在"**不算非法**：那条边本来就在，按可连显示。

#### ③ 预览与落边是两套独立判断（迟早漂移）
- 改法：预览与落边**共用同一份** `batchPlan`（computed），做不到"所见非所得"。
- 临时线新增 `willConnect` 位：连不上的那条加 `is-rejected` 压暗（opacity 0.28 + grayscale），用户在**松手前**就看得见"这一拖只有几条会成"。不用虚线是因为线型来自用户可配的主题，再叠一层 dash 会与配置打架。
- 实测：text 源 + image 源一起拖到 text 目标 → 一条线正常、一条压暗到 0.28、目标显示可连；松手只建 `text→text` 那条（`image→text` 被内核以 type-not-accepted 拒）。

#### 顺手抓到并修掉一个我自己引入的严重 bug
- `onBatchUp` 里先执行了 `batchSide.value = null`，之后才读 `batchPlan.value` —— 而 batchPlan 是依赖 batchSide 的 computed，于是**恒为 null，一条边都建不出来**（表现为"预览两条线都对、松手什么都没有"）。改为**先取计划、再清状态**，并在注释里标明顺序不可调换。

#### 测试与回归
- multi-select **126 条**（新增 10 条：`planBatchApply` 六条 —— 含"容量 1、两个源各自合法只落第一条"这条回归；`markGuideLines` 四条 —— source/target 两侧对号入座、duplicate 也算会连上、不改动其它字段）。
- 回归全绿：canvas-render 227 / canvas-data 258 / theme-default 118 / ui 23；`vue-tsc` 对本轮改动文件零报错。

### 上一轮：多选框"缩放后 padding"bug + 父子级方案取舍（用户指定，2026-09-16）
- 用户反馈（原话）：「你的这个多选框缩放之后的 padding 存在 BUG 你这里框选的话 你认为是做成一个节点 给框选的节点设置 父子级？？还是目前这种让框选直接跟随画布的缩放，那个好一些？？」

#### ① 缩放后 padding 的 bug：间距与线宽不在同一个空间
- **实测数据**（间距配 24 / 外框线宽 4 / 内框线宽 2；"重叠"= 两条线各半宽之和 > 屏幕上间距）：

  | zoom | 屏幕上间距 | 外框线宽 | 结果 |
  |---|---|---|---|
  | 2 | 48px | 2px | 正常 |
  | 1 | 24px | 4px | 正常 |
  | 0.5 | 12px | 8px | 临界 |
  | 0.3 | 7.2px | 13px | 重叠 2.3px |
  | 0.2 | 4.8px | 20px | **重叠 10.2px** |
- **根因**：两框**线宽**按 1/zoom 反缩放（屏幕恒定粗细），而 **padding 是 flow 常量**（屏幕上 = 配置 × zoom）。缩得越小线越粗、间距越窄，两条线最终糊成一条。
- **改法**：新增纯函数 `scaleFramePaddings(pads, zoom)`，把间距也除以 zoom —— 让"间距"与"线宽"用**同一套空间约定**：配置值恒等于"你在屏幕上量到的值"。zoom 非法/≤0 回落 1（绝不产生 Infinity 把几何算炸）。
- **同时补上另一半**：`refreshFrame` 的 watch 依赖里加了 `viewport.zoom`。少了这一项，缩放画布后间距会**停在旧缩放算出来的值**上，与线宽对不上 —— 单改 scaleFramePaddings 是不够的。
- **实测结果**：修后屏幕上间距在 2 / 1 / 0.5 / 0.3 / 0.2 五档缩放里**恒定 24px**，再无重叠（修前 0.2 时重叠 10px）。

#### ② 父子级 vs 跟随画布缩放：建议继续用现在这套
- **结论：不改成父子级。** 理由是项目里已经有真正的父子级分组（`plugin-group`，走 `parentId` + `toRelativePosition`），两者职责重叠，硬把框选也做成父子级会直接打架。
- 跟随缩放这套（浮层 + 自己贴 viewport 变换）的**实际优势**：① 不写数据、不进历史，框选不该污染文档；② 不参与图结构，不会影响连接校验/导出/后端；③ 跨顶层节点本来就是常态，而父子级要求所有节点归到同一个父下，语义反而拧巴；④ 已是当前架构，改造成本为零。
- **父子级唯一真正占优的地方**：节点很多、缩放很小时，浮层要按虚拟化只画可视区（`visibleRect` / `visibleNodes`）—— 这一条是性能问题，不是正确性问题，等真出现几千节点再说。
- **要让观感与线宽同空间**这件事，父子级并不自动解决（它解决的是"拖动时要不要重算"），仍要像本轮这样把间距按 zoom 换算。所以换方案并不能省掉这个 bug 的修法。
- 唯一与本方案有关的小麻烦：拖动中用"快照 + 位移"跟手（不能每帧重算并集），这是已解决的历史坑（见 dragFollow 的注释与回归测试）。

#### 测试
- multi-select **116 条**（新增 6 条：`scaleFramePaddings` 的 zoom=1 原样 / zoom=0.5 翻倍 / 非法值回落 / zoom=0.2 间距不被线宽吃掉；渲染契约两项 —— 间距随缩放换算、缩小时两框不糊在一起）。
- `vue-tsc` 对本轮改动的文件零报错。

### 上一轮：批量连线的"端口直接用 MovingHandle / 3D 反馈 / 多源"三问（用户指定，2026-09-16）
- 用户反馈（原话）：「你的多选框左右的 2 个 movinghandler 效果不对，有没有办法直接使用 MovingHandle.vue？有没有办法直接讲他导出，然后在我的这个多选插件中导入他 并且使用？？其次就是拖拽到目标节点上的时候没有那种 3d 动效 之前你的这个判断写在了什么地方？？ canvas-render 还是 plugin-theme-default 判断连接线是否可以链接，这里之前判断的是只有单个连接线，现在可能需要让他支持多个？？」
- **三个问题各自的根因都定位到了（实测 + 读代码得出，不是猜的）**：

#### ① 端口"效果不对"：不是没复用 MovingHandle，而是拿 !important 去改它的定位
- 现状：多选框上**本来就是**主题的 MovingHandle（preview 模式，上一轮已导出并导入）。但外面套了个 **0×0 定位点**，再用 !important 把 top/transform 压回 0，去绕开组件自带的 top:50% !important。
- **改法**：删掉那两条 !important 覆盖，改成**顺着组件的契约走** —— 给定位盒一个**真实高度**（= 跟随区高），它自己的 top:50% + translateY(-50%) 就自然落在盒子垂直中点上、跟随区上下各露一半，与节点端口同一套几何。以后改跟随区高度也不用再动定位代码。
- 顺带修了跟随区高度的算法：原先写成 (portZoneHeightRatio ?? 0.8) * 100（把一个 0~1 的**比例**硬乘 100 当 px），跟节点那边"节点高 × ratio"完全不是一回事。现在基准 = **选中集里最高的那个节点的高度** × ratio，并留 72px 下限。实测跟随区从 22.5×60 变成 **45×120**，与节点端口逐字一致。
- 还修了"端口拖不动"：圆球永远画在跟随区**里面**、跟随区 z-index 更高，所以按下命中的是跟随区、圆球收不到 mousedown（preview 模式下没有 VueFlow Handle 那层兜底）。改为**两条入口都接**（connect-start + 定位盒的 mousedown），函数内做幂等判重，不会装两套监听。

#### ② 拖到目标上没有 3D 动效：喂给反馈几何的矩形**字段名写错了**
- **判断写在哪里**：连接**规则本身**在 packages/canvas-data/src/canvas/connection.ts（validateConnection：自连 / 成环 / 重复 / 类型 acceptsTypes / 容量 capacity），**不在** plugin-theme-default —— plugin-theme-default 只管"长什么样"（CustomEdge / MovingHandle / BaseNode）。
- **真因**：nodeLayout 给的是 { x, y, w, h }，而渲染层 resolveFeedback 要的是 { x, y, width, height }。少了这一步转换 → width/height 恒为 undefined → 吸附带 / body 命中全算成 NaN → hover 永远 null → hoverNode 永远写不进去 → BaseNode 的 3D 条件（showConnectFeedback → isConnectionValidTarget）永假。
- **改法**：新增纯函数 toNodeRects(rects)（nodeLayout 形 → NodeRect 形）并在组件里走它；同时把命中用的吸附带配置从写死的 DEFAULT_SNAP_ZONE_CONFIG 换成渲染上下文里的 snapZone（宽 42 / 高占比 0.8），与"从节点端口拖线"**同一份配置**（原先宽 undefined → 吸附带塌成 0 宽，永远吸不到端口）。
- **浏览器实测**：拖到干净目标 → 卡片 .v2-card.is-connecting-hover + transform: perspective(800px) rotateX(...) rotateY(...) scale(1.018)（3D 回来了）；拖到已有入边的节点 → is-connection-invalid + 气泡"已存在同一条连线"；松手落边 68-77 成功（69-77 因目标容量 1 被内核正确拒绝）。

#### ③ "之前判断的是只有单个连接线，现在需要支持多个"
- **改法**：ActiveConnection 增加可选 sourceNodeIds?: string[]（**缺省 = 单源语义，逐字不变**），并新增渲染层共用判定 isConnectionSource(active, nodeId)（单源比 sourceNodeId、多源查集合）。BaseNode 的 isCurrentConnectingNode 改为走它 —— 这是"我算不算拖线源"的唯一维护点，散在各处必然漏掉多源那一路。
- 多选插件起手时把**整个选中集**写进 sourceNodeIds。**实测**：拖线中两个源节点的左右端口都变 is-disabled（修前只有第一个）。

#### 测试与回归
- multi-select **110 条**（新增 6 条：toNodeRects 三项 —— 含"拿真实 resolveFeedback 断言转换后能命中 / 不转换则永远命中不了"的对照；端口定位不得再用 !important；跟随区高度算法两项）；canvas-render **227 条**（新增 4 条 isConnectionSource 单源 / 多源 / 空数组回落）。
- 全量回归：canvas-data 258 / theme-default 118 / ui 23 全绿；canvas-render tsc 干净。
- 浏览器实测：整组拖动、端口跟随鼠标（球随鼠标 943→958）、Shift 加选、批量落边均正常。
- **已知既有问题（非本轮引入，未修）**：plugin-multi-select / plugin-theme-default 的 typecheck 脚本用**裸 tsc**，处理不了 .vue，于是 SelectionFrame.vue 的 script setup 里**类型错误不会被 CI 拦住**（本轮 ① 的猜数错误就是这么漏进来的）。本次改用 vue-tsc 复核：这两个包我的改动无报错，剩余报错来自 prosemirror-editor-bundle 与三个既有测试文件。

### 上一轮：批量连线补齐"N 条线 + 目标反馈"（用户指定，2026-09-15）
- 用户反馈（原话）：「我要的连接线是 从多选中每一个节点 对饮端口创建一条连接线到鼠标位置 / 你没有get到这一点而且当前 他移动到目标节点上的时候 没有任何效果？？ 比如这里的3d 动效，什么模糊（失败检测什么的）你这里都没有实现」。
- **确认了两处缺失**：① 上一轮只画了**一条**线（从多选框边缘出发），不是"每个选中节点各一条"；② 完全没写渲染层的连接反馈状态，所以目标节点上没有 3D 倾斜 / 模糊 / 气泡。

#### ① N 条临时线（每个选中节点各一条）
- 新增纯函数 `buildBatchGuideLines(side, selectedIds, rects, cursor, snap?)`：每个选中节点**从他自己的外侧端口锚点**连到鼠标（或吸附点）。右侧拖出从各节点右缘中点出、左侧反之；吸附时所有线都指向目标端口锚点。拿不到矩形的节点跳过（不瞎猜位置）。
- 组件里把单条 `guideLine` 换成 `guideLines` 数组，模板 v-for 渲染，每条都用主题 `ConnectionLine`（内部委托 `CustomEdge`）→ **与正式边同款**。
- 浏览器实测：拖动中 `.conn-line-shell` 数量 = 2（选中 2 个节点各一条），截图可见两条线汇聚到鼠标。

#### ② 目标节点连接反馈（3D / 模糊 / 气泡）
- **根因（对宿主连接机制读完后确认）**：目标节点的 3D 倾斜、非法模糊、气泡都由渲染层的 `connectionState` 驱动（`isConnecting`/`activeConnection`/`hoverNode`/`suppressHandles`），BaseNode 只消费它。我上一轮完全没写这些状态，所以拖到目标上"什么效果都没有"。
- **改法**：批量连线开始/结束时写同一份 `connectionState`（开始：`activeConnection` + `suppressHandles`；结束：全部清空）——**与宿主 `beginConnection`/`endConnection` 同语义**；每帧拖动用渲染层现成的 **`resolveFeedback` 纯函数**（吸附带/body 几何命中 + 内核 `validateConnection` 校验 + `reasonText` 文案）算出 hover 并写 `hoverNode`。这样目标节点的反馈与"从节点端口拖线"**同一套逻辑、同一套观感**，不是我另做一份。
- **两个实测踩出来的坑**：
  1. **`isConnecting` 是 computed（派生自 `activeConnection`），不能直接赋值** —— 直接写无效且不报错，反馈静默失效。只能写 `activeConnection`。
  2. **flow 坐标换算必须用渲染层官方的 `screenToFlow`** —— 手写公式（`(client - pane - vp) / zoom`）实测算出错误 flow 坐标导致 hover 永远 null；官方换算后坐标正确、命中正常。
- **浏览器实测**：拖到 67（image 类型）上 → 卡片出现 `is-connecting-hover`（3D 倾斜 + 蓝色高亮），截图可见；松手落边 `68->67`（`69->67` 因容量 1 被 `limit-reached` 正确拒绝）。

#### 测试与回归
- multi-select **104 条**（新增 5 条：`buildBatchGuideLines` 的方向/吸附终点/跳过无矩形/空选集），`tsc` 干净。
- 全量回归：canvas-render 223 / canvas-data 258 / theme-default 118 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：拖未选中节点时框乱动 + 多选框端口拖不动（用户指定，2026-09-15）
- 用户反馈（原话）：「1, 我拖拽未选中的节点的时候你的这个选框也在移动 2. 你的多选框 的 movinghandler 无法进行拖拽 建议你可以观察一下 vender/vueflow的源码？使用codegraph」。
- **按建议读了 `vendor/vueflow` 源码**（`packages/core/src/components/Handle/Handle.vue` + `composables/useHandle.ts`、`useVueFlow.ts`）：
  - `Handle` 的按下走 `@mousedown="onPointerDown"` → `useHandle.handlePointerDown`，且**必须能 `findNode(nodeId)`**（`if (!fromHandleInternal) return`）—— 即真实连接点必须挂在某个节点上；这印证了"多选框上的端口不能用真 `Handle`、只能用 `MovingHandle` 的 `preview` 模式自己 emit"是正确路线。
  - 也确认了 d3-zoom 的平移挂在 `.vue-flow__viewport` 的 `mousedown`（前几轮已实测过），与本次两个 bug 无关但一起复核了。

#### ① 拖未选中的节点时选框跟着动
- **复现（量化）**：多选 68+69，按住**未选中**的节点 70 拖 6 帧 → 框逐帧 `368→382→396→410→424→438`（与 70 完全同步），节点位移 140、选中集没变。
- **根因**：`RenderEvents.NodeDragStart` 里我**无条件**记下"拖动锚点"，于是拖任何节点框都会跟随。框代表的是**选中集**的包围盒，没被拖的成员不在选中集里就不该理它。
- **改法**：抽出纯函数 `shouldFrameFollowDrag(draggedNodeId, selectedIds)`（= 被拖节点在选中集里才跟随），在 `NodeDragStart` 用它判定；不在选集内就把锚点置空、整段拖动都不跟随。
- **浏览器决定性验证**：把未选中的 70 移到不重叠处后拖它 → 拖动中框**恒定不动**（327→327），70 正常移动（829→899），拖后框 Δ0 / 节点 Δ200 / 选中集不变；探针确认走的是 `skip` 分支。

#### ② 多选框上的端口无法拖拽
- **根因**：`onPaneCaptureDown`（挂在 `.csurface` 捕获阶段、判断"框内空白 = 整组平移"）**把端口上的按下也接管了** —— 端口球就画在多选框边缘**内侧**，几何判定把它算成"框内空白"，于是这次按下被抢走、`MovingHandle(preview)` 的 `connectStart` 收不到事件。
- **改法**：抽出纯函数 `isHitOwnBatchPort({batchSlot, movingHandle})`，在接管判定里排除"命中本插件端口/端口槽"的落点，让给端口自己处理。
- **浏览器验证**：多选后按下右侧端口球 → **引导线立刻出现**（修复前完全没有反应）；端到端拖到目标节点上成功落边 `68->70`。
- 顺带说明：这轮排查中我发现过一次"按点落在 69 却以为在按 70"的假象（两节点屏幕重叠）—— 用元素命中反查所属节点后确认判定一直是对的，避免了一次误修。

#### 测试与回归
- multi-select **99 条**（新增 5 条：`shouldFrameFollowDrag` 的"选中成员跟随 / 未选中不跟随 / 空选集"三条 + `isHitOwnBatchPort` 的两条），`tsc` 干净。
- 全量回归：theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：批量连线端口改用主题 MovingHandle + 临时线用 CustomEdge（用户指定，2026-09-15）
- 用户反馈（原话）：「你这里的UI 样式和效果 都存在问题 / 我要的是 和 当前 MovingHanlde 一样的效果， 拖拽的时候也是使用 ConnectionLine / CustomEdge 这个组件 / 你的这个给我整笑了」。
- **我上一轮做错的地方**：批量连线端口我自己手画了一个白底圆片按钮（`border-radius` + 内联 SVG 加号），拖拽时画的是一条 `stroke-dasharray` 的虚线。用户要的是**和节点端口、和正式边完全一致**的观感 —— 我这是另造了一套，必然漂移。
- **改法一：端口复用 `MovingHandle`（preview 模式）**。它本来就内置了 `preview` 语义 —— 渲染成 `span` 而非 VueFlow 的 `<Handle>`（不注册真实连接点）、并 emit `connectStart`，正是为"挂在自己浮层上的临时端口"准备的。现在多选框左右两侧各挂一个，`rest-offset`/`cursor-gap`/`button-size`/`zone-*` 全部取自同一份 `handleParams`，所以**外观、半圆跟随区、圆球跟随动画、180ms 归位淡出、显隐规则全部与节点端口同源**。
- **改法二：拖拽临时线复用 `ConnectionLine`**。该组件内部把渲染**完全委托**给 `CustomEdge`，所以拖出来的临时线与落成的正式边**长得一模一样**（导轨/流光/箭头/配置/动画）。并按它的注释要求把 `sourcePosition/targetPosition` 正确设为 right/left（硬编码方向会把贝塞尔控制点翻到内侧、曲线往反方向弯）。
- **为此把两个渲染件从 theme-default 导出**（`MovingHandle` / `ConnectionLine` / `CustomEdge`），并把 `@mini-canvas/plugin-theme-default` 加进多选插件的依赖 —— 否则就是"各自手绘一套"的老路。
- **两个实测踩出来的坑**：
  1. **MovingHandle 的锚点 CSS 有 `top:50% !important`**，直接给它内联 top 会被覆盖（实测端口渲染到 y=-1182，跑到画布外）。解法：外面套一个**零尺寸定位点** `selection-frame-batch-slot`，由它决定锚点落在大框左/右缘的垂直中点。
  2. **引导线起点不能读端口球的位置** —— 球会跟着鼠标跑（它就是跟随区），读它会得到抖动/错位的端点。改为读**定位点**的位置（稳定不动）。
- **测试**：本包 **94 条**（新增 1 条渲染契约：端口确实是主题的 `moving-handle-anchor` + `is-preview` + `port-follow-zone`，左右各一个 → 锁"复用同一组件、不各画一套"）；`tsc` 干净。
- **浏览器实测**：多选后左右两侧各出现一个与节点端口同款的白色圆球（带 + 号）；按住圆球拖出 → 临时线由 `ConnectionLine`/`CustomEdge` 渲染（DOM 实测 `conn-line-shell` + 13 个 path，与正式边同款）；松手落在节点上 → 按类型/容量规则落边（实测新增 `68->70`；`69->70` 因目标输入口容量为 1 被内核 `limit-reached` 正确拒绝）。
- **副作用说明**：为让 vite 解析新依赖，重启了 5288 的开发服务器（新依赖需要重新预构建）；源文件未受影响。

### 上一轮：多选时禁止对齐吸附（用户指定，2026-09-15）
- 用户反馈（原话）：「这里多选的时候 应该禁止 我的对齐节点（对齐插件 - 拖拽的时候那个参考线）」。另问：「你的这个多选框是如何实现的？？ 使用的是父节点还是其他的方式？」
- **架构答复（多选框不是父节点）**：`SelectionFrame` 是**独立浮层组件**，注册进 `overlay` 槽，与 VueFlow 的节点层是**兄弟关系**（不是父子）。它自己贴一层与 VueFlow viewport **完全相同的 transform**（`translate(x,y) scale(zoom)`）把框定位在 flow 坐标系；几何取自 `nodeLayout` 的矩形并集；整组拖动由它自己算（逐帧视觉写 + 松手经 graph 落盘）。好处：不碰 VueFlow 内部结构、不依赖节点父子关系，普通节点与 group 子节点一视同仁。
- **根因**：对齐插件的吸附实现是 `updateNodeVisual(被抓住的那个节点, 吸附后位置)` —— 它只动**一个**节点。多选整组拖动时，这一下会把组里被抓住的那一个单独吸到对齐位、其余成员留在位移后的位置，**整组的相对位置被弄乱**。实测：参考线出现 1 条、且整组位移被吸住（预期 140 只走了 130）。
- **改法**：新增纯函数 `shouldAlignOnDrag(selectedCount)` —— 选中 <= 1 才对齐，多选一律让位。`AlignGuideOverlay` 在每帧拖动里读当前选中数，多选时**不吸附也不画线**（用 `hideGuides()` 只清参考线、保留 `primaryId`，因为拖动还没结束、主节点不能丢）。
- **单一职责**：判定放在对齐插件自己的引擎里（"要不要对齐"是它的事），多选插件不反向依赖它，两插件仍互不认识。
- 测试：本包 **28 条**（新增 2 条：单选/未选中参与对齐、多选不参与），`tsc` 干净。
- **浏览器实测（含对照，证明没把单选对齐弄坏）**：单选拖动 → 参考线最大 **1 条**（`align-guide-hline`，对齐仍生效）；多选拖动 → 参考线最大 **0 条**（已禁止）。验证时打开的对齐开关已按用户原状态恢复为**关闭**。
- 全量回归：multi-select 81 / theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：第二次拖框清空选中 + 拖节点时框漂移（用户指定，2026-09-15）
- 用户反馈（原话）：「第一次拖拽多选框（空白区域）可以进行拖拽，拖拽之后 选框没有消失 / 但是第二次不管我是拖拽节点还是 多选框 他的多选中黄台都会消失 / 图2 是第二个问题，拖拽里面节点的时候 你的多选框位置错误， 你看看你拖拽结束之后 是如何设置 多选框位置的， 拖拽结束之后的多选框位置是正确的」。

#### ① 第二次拖拽后选中被清空
- **复现**：第一次拖框 → 选中保住（正常）；**第二次**拖框（或拖节点）→ 松手后选中变空。
- **根因（探针实测的守卫状态）**：两次拖拽的事件链对比 —— 第一次 `click → swallowed:true`（守卫生效）；第二次 `pointerdown 时 armed:true`。
  即：`groupDragArmed`（上一轮为"抵消紧随的 mousedown"加的标记）**从未被消费**（因为我们在 `pointerdown` 上做了 `preventDefault`，浏览器就不再补发 `mousedown`），于是第二次按下时它还是 true → 处理函数走进"抵消 mousedown"分支直接 return：**既没开始新的拖动、标记又被清掉**，最后补发的 click 穿过去把选中清空。
- **改法**：把"这次 mousedown 要不要抵消"改由 `isDragging`（真的在拖）判断，**不再用这个易失灵的标记**：
  - `isDragging === true && e.type === 'mousedown'` → 抵消（d3-zoom 的入口）；
  - `e.type === 'pointerdown'`（新手势开始）→ 作废上一次遗留的吞 click 标记。
  删掉 `groupDragArmed` 这个中间状态（它同时兼任两个语义，是这次 bug 的来源）。
- 浏览器实测：**连做三次拖框，选中每次都保住**（`["68","69"]` ×3）；随后再点真正空白 → `[]`（清空回归正常）。

#### ② 拖动节点时框位置漂移（松手才跳回正确位置）
- **复现（量化）**：拖节点 68 时逐帧测"框相对选中节点并集的外扩量"，从 `(-7, -9)` 一路漂到 `(-7, -21)`，**松手后又跳回** `(-7, -9)`。
- **根因**：上一轮我把拖动跟随实现成"每帧用**实时位置 + 其余节点的 store 位置**重算并集"。但 VueFlow 原生拖动**只在松手时落盘**，所以拖动中途 store 里被拖节点的位置还是旧的 —— 于是并集把"新位置"和"旧位置"混在一起，框越算越偏。用户观察到的"松手后才正确"正是因为这个：松手落盘后 store 变新，重算就对了。
- **改法**：与整组拖动**统一成同一种算法** —— 用"框快照 + 位移量"移动框（`followFrame`）。拖动时记下框快照与"抓着的那个节点的起始位置"，每帧只算该节点的位移量再平移框。这样框与节点走同一个 delta，相对偏移天然恒定，不需要读 store、也不受落盘时机影响。
  - 只认"抓着的主节点"的帧：多选拖动时 VueFlow 会给每个成员各发一帧，用同一节点算位移才严格同步。
- 浏览器实测：拖动中逐帧外扩量**恒定 `(-17, -23.5)`**（修前漂到 -21），松手后一致，选中同时保住。

#### 测试与回归
- multi-select **81 条**（新增 4 条：连续三次手势各自吞掉自己的 click / 漏掉"新按下作废"会让标记失效这个坑本身 / 逐帧位移量推进偏移恒定 / **对照**"重算并集会漂移"的修前错误形态）。
- 全量回归：theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过；multi-select `tsc` 干净。

### 上一轮：拖动后选中被清空 + 单选圈改自绘 SVG（用户指定，2026-09-15）
- 用户反馈（原话）：「当前选框可以拖拽了，但是拖拽之后我的 选中状态也会被情空 / 还有你的多选UI 效果 节点内部左上角的那个单选样式 请使用自定义svg 把，你的这个ui效果很难评 直接使用svg替代把」。

#### ① 拖动结束后选中被清空（复现 + 根因 + 修法）
- **复现**：选中 68/69 → 在框内按住拖动 → 松手 → 选中变空（拖动**期间**选中还在，只有松手那一下被清）。
- **根因（事件探针实测的事件序列）**：`pointerdown@window → pointerup@window → pointerup@pane → click@window → click@pane` —— 松手后浏览器**补发了一个 `click`**，VueFlow 的 pane click 语义是"点空白 = 清空选中"，于是刚拖完的选中被这一下清掉。
- 这与我早先修的"Shift 框选后选中被清空"是**同一个病**，当时已经写了状态机 `boxSelectGuard.ts`（`BoxSelectClickGuard`）。本轮直接**复用它**：整组拖动结束时 `markGestureDone(true)` → 紧随的那次空白 click 在**实例根捕获阶段**被吞掉；并在每次新的 `pointerdown` 时 `reset()` 作废未消费的标记（松手点若落在节点上、浏览器不补发 click，标记不能留到下一次误吞真实点击）。
- 浏览器实测：拖动前 `["68","69"]` → 拖动后 `["68","69"]`（**保住**），节点 Δ133；随后**再点一次真正空白** → `[]`（清空回归正常，守卫没有误吞正常点击）。

#### ② 单选圈改为自绘 SVG（用户要求）
- 原实现是 CSS 画的圆（`border-radius` + 边框 + 中心伪元素），用户认为效果不佳。改为**内联 SVG**：`viewBox 0 0 20 20`，两个 `<circle>` —— 外圈（白底 + 2px 主题色描边）+ 中心实心点（选中态）。
- 好处：矢量、任意缩放下都清晰；颜色统一走 `currentColor` / `var(--canvas-node-border-selected)`，**跟随主题**而不是写死色值。
- 尺寸：容器 26×26、距卡片左上各 8px，仍按 `1/max(zoom, titleScaleMinZoom)` 反缩放（屏幕上大小恒定）。纯指示不接事件（`aria-hidden` + `pointer-events:none`），点击行为仍归卡片（Shift+点节点 = 取消该节点选中）。

#### 测试与回归
- theme-default **118 条**（新增 1 条：标记确实是 `<svg>` + 两个 `<circle>` + 有 `viewBox`，锁"用自绘 SVG 而非 CSS 画圆"）；multi-select **77 条**、`tsc` 干净。
- 全量回归：canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过。
- 三项行为最终浏览器实测：①框内拖动 → 选中保住、节点 Δ133、画布 Δ0；②拖动后再点空白 → 正常清空；③框内滚轮 → zoom 0.450→0.682（穿透缩放照旧）。

### 上一轮：多选框三处交互修正（用户指定，2026-09-15）
- 用户反馈（原话）：「你这里的选框 有问题，我只说了 鼠标滚轮可以透传，鼠标左键平移节点你给我弄错了 / 拖拽这个多选框是平移这个多选框和选中的这些节点 / 还有就是多选之后 在节点的左上角（内容区域）添加一个单选框的这个圆形单选UI（用来区分当前节点是否选中）需要写入到 baseNode 中（default-theme 插件中）/ 其次就是我拖拽节点的时候 你的多选框没有实时生效，移动节点之后当我鼠标松开的时候它才触发这里的多选框位置重置」。

#### ① 左键拖框 = 平移框 + 选中节点（修正上一轮做错的地方）
- **上一轮的错误**：为让节点可点，我把框内部设成事件穿透，于是左键落在框内空白被 VueFlow 当成"拖空白 = 平移画布"。实测确认：节点 Δ0、画布 Δ75。
- **这一轮的做法**：框**整体**不接事件（节点完整可点），改在**画布层按几何判断**该不该接管 —— 落点在框内、且不在任何节点上 → 这次手势归"整组平移"；落在节点上则原样放过（节点选中/拖动照旧）。
- **三个坑（全部实测定位，非猜）**：
  1. **监听必须挂在 `.vue-flow` 的祖先（实例根 `.csurface`）的捕获阶段**：d3-zoom 的平移挂在 **`.vue-flow__viewport` 的 `mousedown`** 上（深度调试实测查到的），拦 pane 拦不住；
  2. **`pointerdown` 与 `mousedown` 是两个独立事件，必须都拦**：前者是 VueFlow 的入口、后者才是 d3-zoom 的入口。只拦前者 → 画布仍被拖走（实测节点在动、画布也在平移）；用 `groupDragArmed` 标记把同一物理动作的第二个事件一并拦掉；
  3. **`preventDefault` 会抑制该 pointer 的兼容鼠标事件**：一旦在 `pointerdown` 上 preventDefault（抑制原生拖拽/选中文字），后续 `mousemove` 就不再来 —— 拖动必须用 **`pointermove`/`pointerup`** 驱动（踩过：监听 mousemove 导致拖动全程收不到事件）。
- 浏览器实测：框与节点**逐帧同步**平移（框 525→589 / 节点 541→605），两个节点各移 178，**画布 Δ0**；最终回归：节点 Δ160、画布 Δ0。

#### ② 节点左上角的多选圆形单选标记（写入 BaseNode）
- 在 theme-default 的 **BaseNode** 内容区左上角加 `v2-multi-radio`：白底圆环 + 中心实心点，**只在多选（选中 >=2）时出现**（单选时卡片已有选中环，再叠一个圆点反而多余）。
- **纯指示、不接事件**（`pointer-events:none` + `aria-hidden`）：点击行为仍归卡片本身，这样 Shift+点节点 = 从选中集里去掉它，逻辑不被装饰层挡掉。
- 圆圈按 `1/max(zoom, titleScaleMinZoom)` **反缩放**，与标题同一套语义：屏幕上大小恒定，缩到 0.2x 时不会小成一个点。

#### ③ 拖动节点时框实时跟随（原先只在松手后跳一下）
- **根因**：VueFlow 原生拖动**逐帧只改渲染层**（`updateNode` 内部状态），位置要**松手才落盘**；而框只订阅了 `nodeStore`，所以整个拖动过程中框定在原地、松手那一瞬才"跳"过去（正是用户截图看到的现象）。
- **改法**：订阅渲染层逐帧广播的 `RenderEvents.NodeDragStart/NodeDrag/NodeDragEnd`（宿主已有这套事件），按"拖动中的实时位置 + 其余选中节点的 store 位置"重算并集。
- 关键细节：**不能只记一个节点的位置** —— 多选拖动时 VueFlow 会给每个被拖成员各发一帧，必须把它们的实时位置都存下来（`liveNodePos` Map），否则框会按"一个动了、其它还在原地"的并集抖动。
- 浏览器实测：拖动节点时逐帧 `[框 left, 节点 left]` = 589/605 → 607/623 → 625/641 → 643/659 → 661/677，**差值恒定 15px**（框与节点完全同步，不再松手才跳）。

#### 测试与回归
- multi-select **77 条**（更新 2 条：原"四条拖动把手"的断言改成"框整体不接事件且没有把手元素"，与新设计一致）；theme-default **117 条**（新增 4 条：多选出现圆点 / 单选不出现 / 未选中不出现 / 圆点是纯指示不接事件）。
- 全量回归：canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过；multi-select `tsc` 干净。
- 说明：验证期间发现 **5288 的开发服务器已停止**（端口无监听），已重新拉起（`packages/ui` 的 `pnpm dev`）以便继续端到端验证。

### 上一轮：多选四项体验问题（用户指定，2026-09-15）
- 用户反馈（原话）：「1. 多选的时候 可以设置是否显示标题（config配置开关 这里的padding计算看是否需要更新）2. 使用shift框选的时候禁止出现节点的上下控制栏（NodeToolbar）3. 使用浏览器检查，你可以发现多选的时候他们的z-index 存在问题，我希望的是节点在最上面 因为这样我就可以加减选了，（当前我多选之后无法操作节点，不能做到单独取消某个选择）4. 在多选区域这个位置让他支持 鼠标滚轮穿透（也就是这里的 缩放画布）」。

#### ③ 节点在框之上、可加减选（最关键的一项）
- **根因不是框的 z-index，而是整个 overlay 层压在节点之上**：CDP 实测节点 `.vue-flow__node` 是 `z-index:1000`，而框所在的 `.csurface-overlay` 是 `z-index:20` —— 但节点在 `.vue-flow__viewport`(z:4) 这个**堆叠上下文**内部，它的 1000 只在里面生效；overlay 是 viewport 的**兄弟**且 z=20 > 4，于是**整个浮层盖在整棵 VueFlow 之上**。再叠加框的容器是"铺满、`pointer-events:auto`"的矩形，结果就是节点中心 `elementFromPoint` 命中 `selection-frame-outer` —— 点不到节点，自然没法单独取消某个选中。
- **改法（浮层内部让出事件，不动框架层级）**：大框拆成两层 —— `selection-frame-outer` 只做**视觉**（`pointer-events:none`），另加 `selection-frame-grips` 沿大框边框铺**四条薄把手**（`pointer-events:auto`）承接整组拖动。框内部彻底留空 → 事件落到节点上。
- 为何不改 overlay 的 z-index：节点有**动态选中环**（::after box-shadow）与浮动端口，一旦把节点抬到浮层之上，这些会被盖住，代价更大；而在浮层内部让出事件既解决问题又不碰既有层级契约。
- 浏览器实测：节点中心命中回到节点内容（`preview`）；**Shift+点节点可单独取消选中**（`["68","69"]` → 点 68 → `["69"]`）；框内空白命中 `vue-flow__pane`（穿透到画布）；四条把手到位。

#### ④ 多选区域滚轮穿透缩放
- **根因**：VueFlow 的 wheel 监听挂在它的 canvas 容器上，而框在 `.csurface-overlay`（另一个分支、且铺满）—— 滚轮事件到不了画布，`preventDefault` 也没人做。
- **改法**：浮层上加 `wheel` 监听（`passive:false`），把事件**转发**给 `.vue-flow__viewport` 元素。为何是转发而不是自己算 zoom：VueFlow 的缩放中心要按鼠标在画布内的位置算，自己调 zoomTo 会变成"以画布中心缩放"，手感不对；转发一个真实 wheel 给它，缩放中心/增量/动画与直接在空白处滚完全一致。
- 浏览器实测：框内空白 -300 → zoom 0.300→0.455、+300 → 0.455→0.300；**左/上/右三条拖动把手上**滚轮同样生效（0.12→0.209→0.364→0.209），且缩放中心跟随鼠标（x/y 同步变化）。

#### ② 框选期间不出现上下控制栏（NodeToolbar）
- **改法**：框选手势开始时把渲染层已有的 `interaction.selecting` 置位（`beginSelecting`，对齐老版 `canvasStore.isBoxSelecting`），BaseNode 据此把上/下插槽整层不渲染；松手或组件卸载时复位（`endSelecting`，含 detach 兜底，防止热卸把位卡在 true）。
- 浏览器实测：单选 image 节点时插槽容器在（`上插槽:在/0`、`下插槽:在/1`）→ 框选中两个都**从 DOM 移除** → 松开后恢复。
- 顺带：多选（>=2）时同样收起（面板语义本就是"恰好选中一个"），与既有压制条件合并到同一个 `hideToolbars`。

#### ① 多选时是否显示标题（config 开关）
- **改法**：新增配置 `multiSelectHideTitles`（「多选时隐藏节点标题」，默认关）。BaseNode 按"开着 + 处于多选"两条同时成立才隐藏标题条。开关放在 multi-select 插件（它才是"多选"这件事的语义归属，把多选框的配置集中在一处；settings key 是全局平面命名，theme-default 按名字读）。
- **关于用户提到的 padding**：默认关掉隐藏时，`两框间距（上）` 的语义与数值都不变，**不需要联动改**；只有用户**主动开启**隐藏后才可能想调小它，故在 description 里写明"关掉隐藏后若想让大框仍兜住标题，把两框间距（上）适当调大"，不引入隐式的自动改值（自动改会覆盖用户设定）。
- 另外补了 `multiSelectFrameEnabled` 总开关（默认开）：关掉即不画两个框，多选本身照常可用。
- 浏览器实测：开关打开后单选 70 → 标题显示；多选 70+67 → **标题隐藏**；回到单选 → 恢复显示。

#### 测试与回归
- multi-select **78 条**（新增 7 条：总开关不画框、框选中不画框、面板指针穿透（外观层不接事件 + 把手恰好四条 + 把手只铺边框的尺寸）、两个开关的 schema 与脏值回落）；theme-default **113 条**（新增 6 条：框选中插槽整层不渲染、多选插槽不渲染、单选照常渲染、hideTitles 多选隐藏/单选不隐藏/默认不隐藏）。
- 全量回归：canvas-render 223 / canvas-data 257 / ui 23 / node-text 64 / node-image 147 / align-guide 26 全部通过；multi-select `tsc` 干净。

#### ⚠️ 并行改动的处理说明
- 本轮工作期间**同一工作区存在另一个进程在改代码**（`plugin-node-image/ImageTopToolbar.vue`、`plugin-theme-default/components/ui/*`、`canvas-render/nodeLayoutSettings.ts` 等并非本轮改动的文件也在变，并新增了 `NodeToolbarButton.vue`、`baseNodeSlotsRender.test.ts` 等文件；期间出现过一次 HMR 编译错误与一次写文件被占用）。
- 我的改动与之**没有冲突**：对方把 BaseNode 的上下控制栏从"单个段组件"重构成"可叠多个 occupant 的上/下插槽（`topSlots`/`bottomSlots` → `.v2-slot--top/--bottom`）"，而我加的 `hideToolbars` / `showTitle` 两个压制条件被**完整保留并接进了新的插槽模板**（两处 `v-if` 都带 `!hideToolbars`）。验证时已按**重构成后的新类名**重新取证。

### 上一轮：小框（内框）也能设圆角与 padding（用户指定，2026-09-15）
- 用户反馈（原话）：「框选之后 你这里内部的这个最小 rect 框 我也希望可以设置圆角 和 padding」。
- **圆角本来就能设**：上一轮已把「内框圆角」的默认值改成 0（直角），配置项一直在设置里。本轮再确认了它能改（设 14 → 屏幕上 28px，按 1/zoom 反缩放），并补了测试锁住"不是写死直角"。
- **新增「小框外扩」（本轮的主要工作）**：以前只有"两框间距"一个 padding，它管的是大框离小框多远，**小框自己没有任何可调的外扩**（永远紧贴节点并集）。现补三项 —— `小框左右外扩` / `小框上方外扩` / `小框下方外扩`（key `multiSelectFrameInnerPadding{X,Top,Bottom}`），默认全 0。
- **几何改成逐层往外算**：`节点并集 → 内框(+小框外扩) → 外框(+两框间距)`。原先 `ComputeSelectionFrameGeometry(rects, padding)` 只有一层，现在签名扩成 `(rects, gap, innerPadding)`；两个 padding 的默认值各自独立（小框 0/0/0、间距 16/34/16），故**默认观感与之前逐像素一致**。三条几何不变量用测试钉死：小框 = 并集 + 小框外扩、大框 = 小框 + 间距、大框永远包住小框（不管小框扩多大都不交叉）。
- **顺带把设置项名字说清楚**：原先那三项 label 叫「群组框左右/上方/下方内缩」，容易跟新的"小框外扩"混起来（都带"内缩/外扩"字样却管不同东西）。改名为 `两框间距（左右/上/下）`，description 同步重写为"大框（外）与小框（内）之间留多少"，与新三项形成"大框↔小框 间距 / 小框↔节点 外扩"的清晰对照。
- **配置 → 几何的转换收口成 `framePaddingsOf(cfg)`**：把一份外观配置拆成 `{ inner, gap }` 两组 padding，组件不再手抄六个字段（抄错一个就静默错位）。
- 测试：本包 **71 条**全绿（新增 10 条：几何 4 条锁逐层语义与大框包小框、配置 4 条锁三项默认 0 与 `framePaddingsOf` 拆解、渲染契约 2 条锁"配了值内框真的变胖且大框跟着外推"与"不配时仍严格等于节点并集"），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响。
- **浏览器实测**（真 dev server）：默认态小框相对并集四边均为 0、两框间距 16/34/16；设 12/24/8 后小框四边精确外扩 12/24/8 而两框间距仍是 16/34/16（说明间距是相对小框算的）；内框圆角设 14 → 计算样式 28px（= 14/0.5 反缩放）；设置面板「布局 → 多选」列出「两框间距（左右/上/下）」+「小框左右/上方/下方外扩」+「内框圆角」；验证后把配置恢复为默认（持久化里只剩显式写入的 0 值，与默认一致）。

### 上一轮：内框去掉圆角（用户指定，2026-09-15）
- 用户反馈（原话）：「你的内部框有一个 圆弧，我不希望有这个 圆角效果」。
- **现象确认**：默认配置下内框圆角是 12px（按 1/zoom 反缩放后屏幕上 17.14px），四个角明显是圆的 —— 选中框要"紧贴选中节点的并集"，而节点并集是个正矩形，圆角会让四条边在角上提前弯掉、看起来没贴住。外框的圆角（6px 虚线大框）保留不动。
- **改法**：`DEFAULT_MULTI_SELECT_FRAME.inner.radius` 12 → **0**（直角）。该配置项本身保留（`内框圆角` 仍可在设置里调，想回圆角就调大），只改默认值 —— 不是把圆角写死成 0。
- 测试：本包 **61 条**全绿（新增 3 条：配置默认为 0、默认渲染出的内框 `border-radius:0px` 且外框仍是 6px、圆角设 10 时能出 10px 证明没写死），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响。
- **浏览器实测**：内框计算样式 `border-radius: 0px`、外框仍 `8.57143px`（= 6/0.7 反缩放）；放大到内框左上角目视四个角均为直角；设置面板「布局 → 多选」显示「内框圆角 = 0」。

### 上一轮：多选群组框「拖动时框位置错误」（用户指定，2026-09-15）
- 用户反馈（原话）：「拖拽的时候 选框位置错误」。
- **根因（浏览器实测量化定位）**：拖动整组节点时节点跟手是准的，但**框越跑越快**。埋点逐帧测量：鼠标拖 20/40/60/80/100px，框跑了 **20/60/120/200/300px**，漂移量 0/20/60/120/200 —— 正是三角数，说明每帧都拿"当前框位置"当基准又加了一次"从按下算起的累计位移"，位移被重复计入，第 n 帧偏差 = n 倍位移。
- **这是上一轮的自身回归**：清理冗余字段（innerOffset）时顺手把 `dragOuterBounds`（按下瞬间的框快照）删掉了，导致拖动跟随从"快照 + 位移"的绝对定位退化成"当前值 + 累计位移"的累加。修法即恢复快照语义。
- **抽成纯逻辑 `dragFollow.ts`**：`followFrame(按下时快照, 累计位移) → 两框新位置`。为什么值得单列 —— 这条几何最容易在清理重构时被顺手改错（本 bug 就是），抽出来才能直接断言"多帧推进后位移**恰好**等于累计位移"，并顺手把这个坑本身写进测试（同一文件里对比"误把当前值当快照 = 200px"与"正确 = 80px"两种写法）。
- 测试：本包 **58 条**全绿（新增 `dragFollow` 6 条），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 全部不受影响。
- **浏览器实测**（真鼠标手势，逐帧测量）：修复后拖 20/40/60/80/100px 框与节点**逐帧零漂移**；斜向/反向/纯横/纯纵四种方向拖动**以及松手落盘后**漂移均为 0.0px；zoom = 0.4 / 1.0 / 1.8 三档下同样零漂移（位移按 zoom 换算正确）；框内拖动、拖动中截图目视两框均紧贴节点。

### 上一轮：多选插件的框选失效与群组框双框错位（用户指定，2026-09-14）
- 用户报的两个缺陷（原话）：
  ① 「shift + 左键 在画布中框选的时候 框选完成之后并没有真实的框选，也就是操作完成之后没有任何选中状况，只有通过 Ctrl 一个一个加选才有效」；
  ② 「框选之后你的UI 存在异常，2个框竟然有重合」，并给出两框的定义 —— 「小框 就是根据选中节点计算的最小 rect 框（不包含标题）；大框 是根据一个固定的padding 进行的（这个请写在插件的config配置中）；你的小框和大框颜色和样式（比如使用实现还是虚线， 线框宽度，颜色等）写在config 配置中」。
- **缺陷①根因（浏览器实测定位，非猜）**：框选期间插件确实把命中节点写进了内核 selection（CDP 埋点可见逐帧写入 空→68→62,64,68 … 一路累加），但**松手后浏览器还会补一个 click 事件**，宿主的 onPaneClick 语义是「点空白 = 清空选中」（selectionInteractions.clickPane），于是刚框出的选中被这一下 click 全清掉 —— 用户看到的等价于「框选不生效」。Ctrl 逐个点选不走 pane click，所以看起来只有它有效。修法对齐老版 MultiSelectPlugin：框选真的发生（超过 4px 阈值）就给下一次 pane click 打「要吞掉」的标记，落点在画布空白时于捕获阶段 stopPropagation。两个坑一并堵上：**标记必须在新的 pointerdown 作废**（松手点落在节点上时 VueFlow 不派发 pane click，标记会留着误吞用户下一次真实点击）；**没拖动不算框选**（否则 Shift 点空白清空选中会失效）。判定抽成纯逻辑 boxSelectGuard.ts 的 BoxSelectClickGuard（零 DOM 可单测）。
- **缺陷②根因**：内框的 width/height 被写成了**外框**的尺寸（只有 left/top 用了 padding）。外框 = 并集 + padding、内框位置 = padding、内框大小却 = 外框 —— 于是内框被推到右下且比外框还大，两框交叉错位。新几何一次算清：multiSelectEngine.computeSelectionFrameGeometry 返回 { outer, inner, innerOffset }，其中 **内框尺寸恒等于节点并集**（不掺 padding）、只由 padding 决定它落在何处。另把内框从「外框的子元素」改成**兄弟节点** —— 嵌在里面时外框线宽配成 0 会把内框一起带走（新加的渲染契约测试当场抓到这条连坐）。
- **外观与间距全部进 Config**（用户要求）：新增 multiSelectConfig.ts，分组 `布局/多选` 共 **13 项** —— 左右/上/下三个内缩，以及内外两框各自的**颜色 / 线型（实线·虚线·点线）/ 线宽 / 圆角 / 填充%**。key 一律加 multiSelectFrame 前缀（settings key 是全局平面命名、先声明者独占，裸 color/paddingX 会被静默丢弃）。线宽与圆角按 1/zoom 反向缩放，与 cardFrame.ts 同约定 —— 配置值的含义恒为「你屏幕上看到的粗细」。改动经 settings.onChange 实时生效，无需重载画布。
- **默认值与 v1 逐项对齐**：三向内缩取 v1 的 `selectionFramePaddingX/Top/Bottom` = **16 / 34 / 16**（最初按 v2 旧代码写成 36，核对 `canvas-core/src/composables/useCanvasStore.ts:49-51` 后改回 34）。两框式样（外框灰虚线 + 内框浅蓝实线）也与 v1 SelectionFrame.vue 同名同值。
- **两条几何语义经 v1 逐行核对**（用户说「请参考 V1 版本」，故不只看表现）：v1 SelectionFrame 的 `canvasBounds` = 并集 + padding（= 大框）、`innerBoundsStyle` 的 width/height = **并集原样**（= 小框，`left/top` 才用 padding）。本实现与之一致 —— 缺陷②正是当初把内框尺寸写成了大框尺寸而偏离了 v1 这条规则。
- **顺带修正**：外框同时是整组拖动的把手，故它**永远渲染**（线宽配 0 时看不见但仍能按住拖动），不再随「线宽 > 0」条件消失。
- 测试：本包 **52 条**全绿（引擎 15 + 几何 6 + 守卫 7 + 配置 16 + 渲染契约 8），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响，ui vue-tsc 干净。本包此前无 vitest.config.ts（跑不了 .vue），本轮补上并与主题/text 包同款（@vitejs/plugin-vue + @vue/server-renderer），使「模板有没有把几何与配置真的贴到元素上」可被 SSR 真 HTML 断言 —— 这正是缺陷②的形态（几何算对、模板接错字段照样错位）。
- **浏览器实测**（内置浏览器 + 真 dev server，真鼠标手势）：Shift 框选空白起→空白止 **选中保住**（6 个节点，clear 调用从调用栈 trace 里消失）；框选后**再点一次空白仍能清空**（回归）；松手落在节点上 / 反向拖 / 只框一个节点三种路径均正确，且单个节点不画框；外框 500×101 而内框 494×91（并集原样、精确贴合）；改设置后外框 虚线·灰 → 点线·红、内框 实线·蓝 → 虚线·绿、内缩 16→40 全部即时生效；外框内拖动整组三节点位移一致且可撤销；设置面板「布局 → 多选」目视 13 项齐全。

### 上一轮：对齐辅助线补上「总开关」配置（用户指定，2026-09-13）
- 用户反馈：「你的对齐辅助线还缺少一个 config 配置，比如当前是否开启这个功能。只有在我开启这个功能的时候，你的插件才生效。需要将这种效果设置到 config 中进行配置」。
- **新增 `plugin-align-guide/src/alignGuideConfig.ts`**：导出模块级 `Config` schema，只有一个布尔项 `alignGuideEnabled`（默认开、label「启用对齐辅助线」、分组 `布局/对齐辅助线`），与老版 AlignGuidePlugin 的 panel 设置项同名同义。分组沿用项目既有四个一级分类（`布局/常规/节点/边`），不新立无主分类。
- **key 用 `alignGuideEnabled` 而非裸 `enabled`**：settings 的 key 是**全局平面命名**、先声明者独占 —— 裸 `enabled` 已被 `plugin-edge-cutting` 占用，撞名会被内核静默跳过、开关形同虚设（真实内核测试把这一点锁住了）。
- **关闭 = 浮层不装配**：插件本体只有「把 `AlignGuideOverlay.vue` 注册进 overlay 槽」这一件事，而浮层组件就是全部实现（订阅拖拽 → 算吸附 → 写 `updateNodeVisual` → 画参考线）。故关闭时**连槽都不注册**：不吸附、不画线、不订阅拖拽事件；打开即现装（组件重新挂载并重订阅），实时生效、不必重载画布。
- 装卸接线抽成纯逻辑 `alignGuideToggle.ts` 的 `bindAlignGuideToggle(ctx, attach)`：装配时按当前开关决定挂不挂，订阅 `settings.onChange` 跟着开关变；`apply` 里交给 `ctx.effect`，随插件 fiber 一起回收（热卸/重载不留残线、不误触别的插件配置）。
- 测试：本包 **26 条**全绿（引擎 13 + 配置 7 + 装卸 6），`tsc` 与 `vue-tsc` 干净；`packages/ui` 新增整装测试（真实插件模块装载 → overlay 槽里有没有它、关掉后实时摘除、装配即关则不出现、关着卸载不报错），ui **23 条**全绿、`vue-tsc` 干净；内核 361 条不受影响。原有 13 条引擎测试一条未改。
- 目验入口：`cd packages/ui && pnpm dev` → 顶部「⚙ 设置」→ 左导航「布局」→「对齐辅助线」→ 关掉后再拖节点，应既不吸附也不出参考线；重新打开即恢复。

### 上一轮记录
- ✅ **3D 预览：快捷键 + 全屏 + 去遮挡**（2026-09-12 第八轮，用户指定）：
  - **删掉常驻&quot;提醒&quot;与右上角重置按钮**（用户原话：&quot;这个提醒可以删除，这样会遮挡视线&quot;、&quot;删除你的右上角的 重置按钮&quot;）：`panoramaMode` 不再产出 `hint` / `showReset`（这两个字段连同样式一并删除），画面上除 3D 画面本身不再叠任何东西 —— 操作全部改走快捷键。
  - **全屏（f 切换）**：新增 `fullscreen` 会话态 + `Teleport` 全屏层（`z-index:100000`、纯黑无装饰）。实现方式是把 three 的 canvas **搬**进全屏层、退出再搬回节点内（不是重建渲染器：WebGL 上下文与贴图都在同一个 renderer 上，重建既慢又容易漏 dispose）。搬迁时同步 `ResizeObserver` 目标与相机宽高比 —— 这两个不跟着换，全屏就会按节点尺寸渲染一张铺不满的画面。
  - **节点快捷键 f（全屏切换）/ r（重置视角）**：全屏与重置都不再依赖按钮。r 的视角状态在组件内部，命令与组件互不认识，故经 `panoramaSession` 的&quot;重置请求计数器&quot;通信（命令 +1、组件 watch 到就去拉回相机；用计数器而非布尔，连按两次也各触发一次）。
  - **本轮的核心：快捷键优先级**（用户原话：&quot;注意这里画布也可能注册了 f，你需要有一个优先级，选中节点之后支持这些快捷键&quot;）。f/r 早已被自动布局插件占用（f=聚焦选中、r=适应视图），故给内核指令分发补两条规则：**① `when` 不满足 = 让位**（交给同键的其它命令，而不是&quot;命中即吃掉、execute 时被 when 拦成空操作&quot;——后者会把全局快捷键永久挤没）；**② `order` 小的赢**（order 相同才回落到注册先后，既有分发顺序不变）。宿主 `CanvasHost` 分发时把内核 ctx 作为执行上下文传入，`when` 才真正参与判定。节点侧用纯函数 `resolveCommandTarget` 界定&quot;什么时候归节点&quot;：**恰好选中一个、且它就是 3D 预览**才接管；没选/选的是别的类型/选了多个一律让位（多选时该操作哪一个不明确，不猜）。
  - **Esc 一次只退一层**（对齐 v1 PanoramaNode 的金标准：全屏时 Esc 只退全屏、人仍留在&quot;能转视角&quot;状态）：全屏 → 退回节点内仍可转视角 → 再按一次才回到&quot;按住就能拖节点&quot;。判定抽成纯函数 `resolveEscapeAction` —— 起因是发现最初写成 `if (fullscreen) exitInteract()` 两个分支做同一件事，等于一次跳到底，浏览器实测抓到后改掉。
  - 测试：相关包共 **1084 条**全绿（内核 361 / 渲染 215 / 主题 83 / text 64 / image 142 / 3d 71 / compare 46 / 图片工具 54 / 文本工具 31 / ui 17）；core-v2 / render / 3d 三包 `tsc` + ui `vue-tsc` + 3d `vite build` 全通过。本轮新增 4 个测试文件、26 条：内核 `commandDispatchPriority`（when 让位 + order 优先）、3d 的 `node3dCommands`（目标判定）、`node3dShortcuts`（真内核 + 真分发的整链优先级）、以及扩展后的 `panoramaMode`/`panoramaSession`/`panoramaContentRender`（全屏、Esc 分层、画面上不再有按钮提示）。
  - **浏览器实测**（内置浏览器 + 本地 dev server，用真键盘事件，不只跑测试）：f 进全屏（全屏层 canvas 实测 1280×720 铺满）、拖拽转视角后 r 回到初始朝向、Esc 逐层退出（fullscreen→interactive→preview）、以及优先级两种情形 —— 没选中时执行的是 `auto-layout:focus-selected`、选中 3D 节点时执行的是 `3d-preview:fullscreen`。

### （2026-09-13 第九轮）图片节点显示修复：铺满不留空隙 + 卡片尺寸跟上

- ✅ 用户指定：
  - 用户报的缺陷（原话）：&quot;你的图片节点显示有些问题，横屏图片 宽度大了几像素，竖屏高度大了几像素&quot;。用内置浏览器实测复现并量到确切数字：横屏图卡片外框 420×236 而图片只画到 416×234（左右各留 2px）、竖屏图卡片 169×300 而图片只画到 167×296.9（上下各留约 1.6px）。
  - **根因一：填充方式**。卡片是 `border-box` 且带 1px 边框，边框先从声明尺寸里扣掉，于是**内容区**比&quot;按图片比例算出的卡片尺寸&quot;矮胖了一点（差 2px）；`object-fit: contain` 在比例不吻合的框里必然在某一侧留白，所以&quot;节点比图片大几像素&quot;用 contain 消不掉。改为平时**铺满**（`cover`，与老版 ImageNode 的 `object-cover` 一致）。
  - **但裁剪时必须切回 contain**：裁剪覆盖层的遮罩与裁剪框都按 object-contain 几何计算（ImageCropper 的 `computeFit`），它底下就是这张图片；此时若仍铺满，遮罩会盖错、裁剪框指向错误的像素区域，裁出来不是用户框选的那块。故加 `is-fill-cover` / `is-fill-contain` 两态，随裁剪开关切换。
  - **根因二（顺手查出的真缺陷，更隐蔽）**：靠&quot;挂载时兜底补算尺寸&quot;的节点（后台/MCP 直接写节点、旧存档）**尺寸算出来了、卡片却不跟随** —— 内置浏览器实测 **8/8 稳定复现**：内核 data 与宿主渲染态都已是 420×236，但已挂载的节点组件收到的 `props.data` 仍是旧快照（只有 imageUrl/imageWidth/imageHeight、没有 cardWidth），卡片停在类型默认 320×240，16:9 的图被硬塞进 4:3 卡片。对照实验确认这是**挂载窗口内写入丢失**：挂载前写生效、挂载后写生效，只有正好落在这次挂载窗口内的写入会丢。修法：`onMounted` 的补算推迟到 `nextTick`，让写入落在挂载完成之后。
  - **浏览器实测**（内置浏览器 + 真 dev server）：横屏 420×236（比例 1.78 ≈ 图片 1.778）、竖屏 169×300（0.563 = 0.563）、正方形 300×300，全部&quot;卡片尺寸 = data 尺寸&quot;且图片铺满无空隙；8 个不同比例节点复测 7/7 正常跟随（第 8 个是 400×1200 的极细长图，宽度被设计下限 120px 抬起，属既有规则非缺陷）；裁剪模式切回 contain 且遮罩对齐、退出后恢复铺满。
  - 测试：相关包共 **1011 条**全绿（内核 361 / 渲染 215 / 主题 83 / text 64 / image 148 / 3d 71 / compare 46 / ui 23）；image / render / core-v2 / 3d 四包 `tsc` + ui `vue-tsc` + image 与 ui `vite build` 全通过。本轮新增 `imageContentRender`（SSR 真 HTML 锁&quot;平时铺满 / 裁剪时完整可见&quot;两态）。

### （2026-09-13 第十轮）图片节点去边框 + 清掉死配置 + 节点注册字段收成单一来源

- ✅ 用户指定：
  - 用户追问（原话）："我不明白 为什么图片插件会有边框?? 什么地方需要他？"。查明：边框**不是图片插件的**，它来自**共享外壳**（theme-default 的 BaseNode `.v2-card`，`borderWidth: 1px/zoom` + `border-style: solid`），本意是让卡片从画布背景上浮起来 + 承载选中态/非法连接的边框高亮 —— 所有节点类型共用，v1 也是同一个壳（`custom-node-card` 同样带 1px 边框），所以这 1px 是从 v1 继承来的，不是本轮重构引入。
  - **图片节点去掉边框**：图片是**内容铺满整张卡**的类型，那圈边框对它没有分层价值、只会变成内容边缘多余的一圈缝（用户一路在追的"图片边上还有一像素边距"就是它）。新增**类型级能力 `frameless`**（与 resizable/icon 同层，由类型自己声明，不让外壳猜节点类型），图片类型声明 `frameless: true`。**选中环不受影响**：环是 `.v2-card::after` 的 box-shadow，与边框互相独立 —— 这条是删边框最容易漏的回归，已单独写进契约测试。浏览器实测：图片节点边框 `0px`、3D 预览与图片对比仍 `1px`，图片四边间隙全部为 0（彻底贴边），选中环照常显示。
  - **删掉 6 个死配置**：`cornerRadius` / `showShadow` / `borderWidth` / `borderColor` / `blurOnLoad` / `lazyLoad` 在图片插件里声明过但**全仓无人读取** —— 设置界面里能看到、改了却毫无反应（比没有更糟：让设置面板显得可信，实际在骗人）。已整体删除，浏览器实测这 6 个 key 均读不到了。真要支持"图片可调边框/圆角"时再加，那时一次性把实现与测试一起补上。
  - **顺手修掉一个结构性隐患（本轮最重要的发现）**：给类型加字段时发现**同一份字段清单散落三处** —— `registerNodeType.ts` 的 `NodeTypeDef`、`capabilities.ts` 的 `NodeRegisterDef`、`types.ts` 里内联的 `register(def: {...})`。插件实际走 `ctx.nodes.register`（第二条路），而漏改 `types.ts` 那份会导致**类型检查报错、或字段被静默丢掉**。这次就真实踩到：`capabilities.ts` 的透传清单漏了 `frameless`，**单测全绿、浏览器里边框照旧**（测试覆盖了 `registerNodeType` 那条路，插件用的却是另一条）。已把 `types.ts` 的内联定义收成引用 `NodeRegisterDef`（单一来源），并在 `capabilities.test` 加"类型级能力逐字段透传"的测试钉住这条缝。
  - 测试：相关包共 **1106 条**全绿（内核 363 / 渲染 215 / 主题 91 / text 64 / image 148 / 3d 71 / compare 46 / 图片工具 54 / 文本工具 31 / ui 23）；core-v2 / render / theme / image / text / 3d / compare 七包 `tsc` + ui `vue-tsc` 全通过。本轮新增 2 个测试文件 + 2 条用例：`cardFrame`（边框/圆角/选中环的取值规则，含"删边框别把选中环删没了"）、`capabilities.test` 的透传契约、`registerNodeType.test` 的 frameless 透传。

## 早期里程碑（2026-09-13 及以前，历史）

### 四个节点双态 / 尺寸行为 / 3D 快捷键 / 图片去边框（用户第七~十轮）
已落地，测试与类型检查全绿。当时目验入口 `cd packages/ui && pnpm dev`。
当时目验重点：① 文本节点默认无滚动条、双击进编辑后内容长了能滚且滚轮不缩放画布；② 3D 预览默认按住画面能拖节点、双击后能转视角、选中后 f 全屏 / r 重置 / Esc 逐层退出，画面上不再有提醒与重置按钮；③ 连一张图后图片对比节点宽度跟随该图。

### 更早：M0~M6 里程碑
见下方"当前进度（哪个里程碑）"一节（该节为 2026-09-04~09-12 的历史记录）。

---
*本文件由主 agent 维护：开工前更新【一、现在该做什么】，其余各节按需追补。*
### 步骤 5c 完成（2026-09-18，88cf307）

- 四个老服务名 `nodeStore` / `edgeStore` / `graph` / `history` 已下线（`ctx.get` 取不到）；
- 数据服务统一为 `ctx.get('doc')` 门面（直接持有四个底层实例，不再按名解析）；
- `CustomEdge.vue` 剪切回落路径改走 `doc.removeEdges`（优先路径 `command:delete-edge` 不变）；
- 全仓 `rg "ctx.inject('(nodeStore|edgeStore|graph|history)')"` → **0 处**；
- 基础服务现状实测：save / doc / resources / nodeRegistry / themeRegistry / selection /
  command / nodeFactory / nodeLayout / viewport / settingsPersist = **11 个**
  （§4.2 六个"表型服务"的退场属后续清理；slots/settings 为能力层内置）
 
---

## 追加（2026-09-28，节点底栏注册化 + 进度覆盖层）

分支 `codex/node-bottom-bar-registry`（基于 49c165b，含设置面板外壳重构）。

**新包**：`packages/plugins/plugin-bottom-bar` + `packages/plugins/plugin-mock-task-backend`。
设计稿与执行计划见 `docs/superpowers/specs/2026-09-28-node-bottom-bar-design.md` 与
`docs/superpowers/plans/2026-09-28-node-bottom-bar-registry.md`（子代理审核 4 轮）。

**做了什么**：

1. `doc.updateNodeRuntime`（canvas-data）：写节点运行期状态 —— 落盘但**不进撤销栈**（进度帧用）。
2. `plugin-bottom-bar`：读服务 `nodeBar` + 执行服务 `nodeTask` + 注册糖 `registerBarAction` /
   `registerBarApplier` / `publishToolActions`（落场用调用方 ctx，条目归注册方，卸载自动摘除）。
3. 默认底栏 `NodeBottomBar`（themeRegistry 槽 `bottomBar`，order 最小者赢 = 整体可换皮）+
   覆盖层 `NodeTaskOverlay`（`over:inset`，running 时显示进度/取消）。
4. 三个节点插件删掉自己的 `out:bottom` 基座段（不设兼容）：生成动作经 `publishToolActions` 发布
   （参数/模板照工具声明长出来），旋转/下载/复制/删除为 `apply:'self'` 即时动作；结果写入器复用
   `writeGeneratedImage` 等既有写回规矩。
5. mock 后台插件：同步动作（1.2s）+ 异步动作（10 帧进度，带 taskId/resume）。

**验证基线（2026-09-28 实测）**：kernel 212 / canvas-data 332 / canvas-render 405 / canvas-base 6 /
ui 44 / plugin-bottom-bar 17 / node-text 31 / node-image 111 / node-video 105 / mock-task-backend 3，
全部通过；typecheck 全部通过；UI e2e 45 原有用例 + 5 条新断言 = **50/50**（底栏装配、覆盖层、
runState 落盘、刷新不悬挂）。

**注意**：mock 动作经 image 写入器写 `data.imageUrl` —— 点了它当前图会被换成 mock 产物（预期行为）。

## 追加（2026-09-29，底栏修「点不进去」+ 复刻 LibTV 版式）

分支 `codex/node-bottom-bar-registry`。计划与实测见
`docs/plans/2026-09-29-bottom-bar-libtv-parity.md`（子代理 plan_reviewer 审核，四点修正已并入）。

**用户报的问题**：底栏输入框点不进去、打不了字；素材卡要点击才显示；底栏 UI 与参考图不一致。

**根因（Chrome MCP 实测）**：底栏原挂在节点 `out:bottom`（`.v2-slot--bottom`）。
`.vue-flow__node` 带 transform（VueFlow 定位用）**必然创建层叠上下文** ——
节点内任何 z-index 都出不去；而应用外壳的底部工具栏 `.shell-dock`（`CanvasShell.vue`，
`position:fixed; z-index:30`）是画布的**兄弟**，于是压在底栏输入区上、把点击整段截走。
（实测：重叠段打字进不去，非重叠段正常。）

**做法（比计划更小）**：不改 `canvas-render`、不新开层 —— 只把底栏 DOM 挪出节点层叠上下文：
新增 `NodeBottomBarOverlay` 注册进**既有 overlay 槽**，内容 **Teleport 到 body** 并按屏幕坐标 fixed 定位
（与本插件 @ 菜单同一手法）。这样一次性绕开三个坑：`.csurface-overlay` 的 z:20 层叠上下文、
`overflow:hidden` 裁剪、与 z-index 分层表的契约冲突。
栏内内容仍是 `themeRegistry.winner('bottomBar')`（整体可换皮，不变）。

**顺带**：顶行补「标记 / 风格」两枚 pill（对齐参考图三枚）；加载材质由 92% 实底改 62% + 呼吸动画
（用户要的「不要黑底卡片、整块进入加载态」）；mock 两条动作参数统一成同一套。

**过程中真发现的坑**：浮层实例在不同节点间复用时只换 `id` prop，而 `NodeBottomBar` 只在 setup
读一次节点类型 → 选中图片节点却按文本节点渲染、整栏空白。修法：`BottomBarHost` 加 `:key="selectedId"`。
SSR 单测（每例新实例）照不出这条，只有真浏览器「先缩放再选中」的序列能复现。

**验证**：`plugin-bottom-bar` 32/32、`plugin-theme-default` 213/213、`canvas-render` 405/405、
`ui` 44/44、`mock-task-backend` 3/3、`node-text` 31/31、`node-image` 111/111；
UI e2e **50/50**；三个 typecheck 全过。
浏览器实测：输入区与底部工具栏重叠处点击命中 `ProseMirror` 且打字成功；素材卡常显带 1/2 角标；
点卡片出预览；`@` 菜单贴光标；拖动节点底栏跟随；加载中拖拽节点仍可移动。

**注意**：`packages/ui/e2e/canvas-e2e.mjs` 的 `BASE` 现支持 `CANVAS_PORT` 环境变量
（`vite.config` 是 `strictPort:false`，多个 worktree 同起时 5288 归属不定，写死会打到别人的代码上）。
