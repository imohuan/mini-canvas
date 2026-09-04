# Cloud 图片保存/刷新丢图 侦察结论

日期：2026-09-04 · 环境：/cloud（BackendSyncPlugin）· 画布 canvas-2026-09-01

## 一、用户报告
"画布保存时无法保存图片？刷新之后图片资源就没有了。"

## 二、实测确认（Chrome /cloud）
canvas-2026-09-01 三个 image 节点：后端只存了元数据（assetId + imageName/imageType/imageSize/imageWidth/imageHeight），**imageUrl 为空**，页面上一个 `<img>` 都没渲染（只显示文件名和尺寸占位）。

但浏览器 IndexedDB（`canvas-ai-assets`）里那两个 assetId 的**字节都在**（257KB / 236KB）——图片没真丢，是没被"取出来显示"。

## 三、根因
图片的真实字节存在**前端浏览器 IndexedDB**（keyed by 内容哈希 assetId），后端只存 assetId 这个"引用键"。
- 本地根页 `/` 装了 StoragePlugin，加载时会 `assetId → getObjectURL(IndexedDB) → imageUrl` 恢复显示。
- `/cloud` 没装 StoragePlugin，BackendSyncPlugin 从后端 load 到节点（带 assetId、无 imageUrl）后，**从不做这一步恢复** → 图片一直是空白，刷新也一样。

即：图片本身在，是 /cloud 少了一步"用 assetId 从 IndexedDB 把图片取出来设成 imageUrl"。

## 四、两条修复路线（需用户拍板）

**路线 A（小改、只修同浏览器刷新）：**
在 /cloud 的 BackendSyncPlugin 加载节点后，像 StoragePlugin 那样对每个有 assetId 的节点做 `getObjectURL → imageUrl`。改动小，但图片仍只在本机本浏览器（IndexedDB 是浏览器私有的，换浏览器/清数据/别的机器仍会"丢"）。

**路线 B（彻底、符合"后台权威"）：**
/cloud 加图时把图片字节真传到后台 `/api/upload`，节点存 `/api/files/...` 的 URL。这样图片存服务器，任何浏览器/机器都能显示，刷新永不丢。改动比 A 大，但才是"资源真没丢"的根本解。

## 五、"保存资源的专门函数"核查结论（用 codegraph 查证）

用户提示"有个保存资源的专门函数"。核查结果：**有，就是前端的 `AssetManager.saveAsset(blob, fileName, mime) → assetId`**（`packages/canvas-core/src/plugins/storage/adapters/AssetManager.ts`）：
- 按内容算 **SHA-256** 得 assetId，**已存在直接返回不重复存**（正是用户说的"hash 唯一，同图不存两份"）。
- 图片上传/拖拽/粘贴/裁剪/扩展/蒙版全走它（ImageNodePlugin.handleImageUpload / handleImageAddSource / saveTransformedAsset、FileDropPlugin 等）。
- **但字节存进浏览器 IndexedDB**（IndexedDBAssetStore），不落后端 → 这就是"刷新丢图/换浏览器丢"的根源。

后端目前没有与之对等的"按画布分目录 + hash 去重 + 返回持久 URL"的函数：
- `NodeStorage.saveUpload` + `/api/upload` → 存**全局** uploads/{时间戳}-{名}，无 hash 去重、无按画布分目录。
- `semanticNodes` 预览走 `/api/proxy-media` + `sourcePath`（本地绝对路径代理），不是上传落盘。
- 其它（useUpstreamResources 收集上游参考图、web2apiRunner 转发生成、BackendRest.batchNodes 等）都不是资源落盘函数。

⇒ 用户想要的"保存资源函数"= 后端版的 `saveAsset`：接口相似（hash 去重、传 blob 返回 id），但 id 解析成服务器上能跨会话访问的 URL，且按画布分文件夹存。

## 六、附带澄清（与上轮同步方案联动）
图片节点保存时本来就删 imageUrl（runtime 字段），所以"定时全量推送 data 里的 imageUrl 到后台"是**没用的**（blob URL 换会话就失效）。正确模型是：后台持久化 assetId + 元数据，前端按 assetId 从存储恢复图片；data.options 这类纯配置才适合定时全量推。
