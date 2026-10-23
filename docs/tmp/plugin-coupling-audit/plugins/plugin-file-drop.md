# plugin-file-drop

## 一句话

把图片、视频、音频、文本拖进画布或粘贴成节点。它通过 `clipboard/paste` 注册场仲裁、按节点类型存在性降级，方向正确；主要粘连是全局 drag/drop、浏览器媒体元素和资源服务的手写窄接口。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-file-drop` | 插件名 `file-drop` |
| 身份 | builtin |
| 源码 / 测试 | 4 个生产源文件 / 3 个测试文件（全包 7 个文件） |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | `Service`、`Context`、`PluginModule` | 是 | `src/fileDropPlugin.ts:24` |
| canvas-data | `DocService`、`SelectionService`、`ResourceService`、`ClipboardPaste*`、`CLIPBOARD_PASTE_KIND/KEY`、`hasCanvasClipboardMarker` | 是 | `src/fileDropPlugin.ts:25-32` |
| 其他插件 | 无 | — | — |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` / `selection` | `inject` 硬依赖 | 硬 | `src/fileDropPlugin.ts:73,193-198` |
| `viewport` | 屏幕坐标 → flow 坐标 | 可选（缺则回落 200,200） | `src/fileDropPlugin.ts:199-230,306` |
| `resources` | 媒体字节落库并解析显示地址 | 可选（缺则 objectURL 兜底） | `src/fileDropPlugin.ts:242-259` |
| `clipboard/paste` 注册场 | 粘贴仲裁，媒体 20 / 文本 30 | 契约 | `src/fileDropPlugin.ts:409-429,476-482`；场定义 `packages/canvas-data/src/canvas/clipboardActions.ts:45-48` |
| 节点类型 `image/video/audio/text` | `doc.types.has` 判存在性 | 运行时数据契约（非 import） | `src/fileDropPlugin.ts:203-212` |
| 画布剪贴板标记 | 让位给 `clipboard` 插件 | 契约 | `src/fileDropPlugin.ts:414,420`；`packages/canvas-data/src/canvas/clipboardActions.ts:57-75` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `window dragover/drop` | 拖入文件 | 中：全局监听；有 `ctx.effect` 清理 | `src/fileDropPlugin.ts:449-474` |
| `window pointermove` | 记录粘贴锚点 | 低：只在编辑区外、且落在 `.vue-flow` 时记录 | `src/fileDropPlugin.ts:436-447` |
| `.vue-flow` | 限定拖入范围/锚点 | 中：VueFlow 实现细节 | `src/fileDropPlugin.ts:441-443` |
| `input/textarea/select/contenteditable` | 编辑区不拦截 | 低：通用可编辑判定 | `src/fileDropPlugin.ts:75-79` |
| `Image` / `video` / `URL.createObjectURL` | 读尺寸/元数据 | 中：objectURL 需 revoke；无资源库时该地址仅当前会话有效 | `src/fileDropPlugin.ts:89-180` |
| `FileReader` | 老环境读文本/读文件 | 低：优先 `blob.text()` | `src/fileDropPlugin.ts:89-97` |

## 内部职责与风险

1. **节点类型缺失能降级**：没有 `image/video/audio/text` 节点插件时，对应文件跳过并 warn，不会建出孤儿节点。
2. **粘贴仲裁方向正确**：插件不自绑 `paste`，由 `CanvasHost` 统一读事件并按 order 派发；`file-drop` 只声明处理器。
3. **资源服务是手写窄接口**：`storeAndResolve` 自己写 `put/resolve` 形状，而不是用 `ResourceService` 类型；注释解释是为了“老宿主/测试替身只有 put”，但这也让接口漂移无法在编译期发现。
4. **objectURL 兜底可能是永久坏数据**：没有 `resources` 时，节点里写 `blob:` 地址；该地址跨标签页/刷新失效，属于设计上接受的降级，但用户可见后果需要提示。
5. **文件类型判定与节点插件重复**：字段名（`imageUrl/videoUrl/audioUrl/text`）与节点插件各写一份，靠约定对齐。
6. **失败只 warn 不提示用户**：单个文件处理失败写 `console.warn`，界面上无反馈；批量拖入时用户不知道哪几个没成功。

## 单独装卸判断

- 不装：拖入/粘贴建节点消失；画布内复制粘贴仍由 `clipboard` 插件负责。
- 只装 file-drop、不装对应节点：该类型跳过，不报错。
- 卸载：window 监听、粘贴处理器随作用域回收；已建节点的 `blob:` 地址不会自动修复。

## 建议改法

1. **最小改动**：把 `ResourceService` 作为首选类型，保留窄接口仅作测试注入；至少加一条类型守卫测试，字段改名时编译失败。
2. **用户反馈**：批量导入失败时汇总一条可见提示，不再只写控制台。
3. **契约收口**：把节点媒体字段表提到 canvas-data 的公开常量，file-drop 与节点插件共用。
4. **测试补边界**：补“资源服务只有 put 没有 resolve”“没有任何节点类型时拖入不报错”“画布剪贴板标记存在时 file-drop 让位”三条装配测试。

## 待验证

- 没有 `resources` 时写出的 `blob:` 地址是否会在自动保存后进入长期存档；若会，应改为拒绝建节点或明确提示。
- `window pointermove` 在大量节点页面的开销；当前每次移动都做 `closest('.vue-flow')` 判定。
- `File.text()` 不可用的老浏览器是否仍在支持范围；若不在，可删掉 FileReader 回落。

