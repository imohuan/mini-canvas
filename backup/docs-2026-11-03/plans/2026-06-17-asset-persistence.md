# 图片/视频节点资源持久化 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 解决图片/视频节点使用 `URL.createObjectURL()` 导致刷新后资源丢失的问题。localStorage 模式下存 IndexedDB，File System 模式下存本地文件夹。

**Architecture:** 在 StoragePlugin 内建 AssetManager，根据当前 mode 自动选择 IndexedDBAssetStore 或 FileSystemAssetStore。节点 JSON 中只存 `assetId`，运行时通过 `assetManager.getObjectURL()` 恢复 blob URL。

**Tech Stack:** IndexedDB API, File System Access API, Vue 3 + TypeScript

---

## 数据流设计

```
用户拖入/选择文件
  → FileDrop/ImageTopToolbar 拿到 File 对象
  → assetManager.saveAsset(file) → 返回 assetId
  → assetManager.getObjectURL(assetId) → 返回 blob: URL
  → node.data = { assetId, imageUrl: blobURL, imageName, imageType, ... }
  → AutoSave 触发 storage.saveCanvas() → sanitizeForSave 保留 assetId，不保留 blob URL

页面刷新后
  → StoragePlugin.tryRestore() → loadCanvas()
  → 遍历 nodes，发现 node.data.assetId
  → assetManager.getObjectURL(assetId) → 设置 node.data.imageUrl
  → 渲染正常
```

---

### Task 1: 创建 AssetStore 接口

**Files:**
- Create: `src/canvas/core/plugins/storage/adapters/AssetStore.ts`

**Step 1: 定义 AssetStore 接口和 AssetRecord 类型**

```typescript
export interface AssetRecord {
  assetId: string
  fileName: string
  mimeType: string
  size: number
  blob?: Blob  // runtime only，不序列化
  createdAt: number
}

export interface AssetStore {
  /** 保存一个二进制文件，返回 assetId */
  save(blob: Blob, fileName?: string, mimeType?: string): Promise<string>
  /** 根据 assetId 获取 Blob */
  get(assetId: string): Promise<Blob | null>
  /** 删除一个资产 */
  delete(assetId: string): Promise<void>
  /** 列出所有资产元数据 */
  list(): Promise<AssetRecord[]>
  /** 检查资产是否存在 */
  has(assetId: string): Promise<boolean>
  /** 清空所有资产 */
  clear(): Promise<void>
}
```

---

### Task 2: 实现 IndexedDBAssetStore

**Files:**
- Create: `src/canvas/core/plugins/storage/adapters/IndexedDBAssetStore.ts`

**Step 1: IndexedDB 初始化**

DB name: `canvas-ai-assets`, store name: `assets`, keyPath: `assetId`

```typescript
import type { AssetStore, AssetRecord } from './AssetStore'

export class IndexedDBAssetStore implements AssetStore {
  private db: IDBDatabase | null = null
  private readonly dbName = 'canvas-ai-assets'
  private readonly storeName = 'assets'

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.storeName, { keyPath: 'assetId' })
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve(this.db)
      }
      req.onerror = () => reject(req.error)
    })
  }

  async save(blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
    const db = await this.openDB()
    const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const record: AssetRecord = {
      assetId,
      fileName: fileName || 'untitled',
      mimeType: mimeType || blob.type || 'application/octet-stream',
      size: blob.size,
      blob,
      createdAt: Date.now(),
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)
      store.put(record)
      tx.oncomplete = () => resolve(assetId)
      tx.onerror = () => reject(tx.error)
    })
  }

  async get(assetId: string): Promise<Blob | null> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly')
      const store = tx.objectStore(this.storeName)
      const req = store.get(assetId)
      req.onsuccess = () => {
        const record = req.result as AssetRecord | undefined
        resolve(record?.blob ?? null)
      }
      req.onerror = () => reject(req.error)
    })
  }

  async delete(assetId: string): Promise<void> { ... }
  async list(): Promise<AssetRecord[]> { ... }
  async has(assetId: string): Promise<boolean> { ... }
  async clear(): Promise<void> { ... }
}
```

---

### Task 3: 实现 FileSystemAssetStore

**Files:**
- Create: `src/canvas/core/plugins/storage/adapters/FileSystemAssetStore.ts`

**Step 1: 基于 FileSystemDirectoryHandle 的文件资产存储**

依赖 FileSystemAdapter 已有的目录句柄。每个项目在 `project-{id}/assets/` 下存文件。

```typescript
import type { AssetStore, AssetRecord } from './AssetStore'

export class FileSystemAssetStore implements AssetStore {
  constructor(
    private rootHandle: FileSystemDirectoryHandle,
    private projectId: string,
  ) {}

  private async getAssetsDir(): Promise<FileSystemDirectoryHandle> {
    const projectDir = await this.rootHandle.getDirectoryHandle(
      `project-${this.projectId}`, { create: true }
    )
    return projectDir.getDirectoryHandle('assets', { create: true })
  }

  async save(blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
    const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const ext = mimeType ? mimeTypeToExt(mimeType) : '.bin'
    const safeName = fileName ? fileName : `${assetId}${ext}`
    const dir = await this.getAssetsDir()
    const fileHandle = await dir.getFileHandle(safeName, { create: true })
    const writable = await (fileHandle as any).createWritable()
    await writable.write(blob)
    await writable.close()
    return assetId
  }

  async get(assetId: string): Promise<Blob | null> { ... }
  async delete(assetId: string): Promise<void> { ... }
  async list(): Promise<AssetRecord[]> { ... }
  async has(assetId: string): Promise<boolean> { ... }
  async clear(): Promise<void> { ... }
}
```

**Step 2: name → assetId 映射文件**

因为文件名和 assetId 不是同一回事（文件名可能有冲突），需要一个 `_manifest.json` 记录映射。

---

### Task 4: 实现 AssetManager

**Files:**
- Create: `src/canvas/core/plugins/storage/adapters/AssetManager.ts`

**Step 1: 封装 store 选择逻辑 + object URL 管理**

```typescript
export class AssetManager {
  private store: AssetStore | null = null
  private objectURLs = new Map<string, string>()  // assetId → blob URL
  private urlTimestamps = new Map<string, number>()  // assetId → timestamp

  setStore(store: AssetStore | null) { this.store = store }
  getStore(): AssetStore | null { return this.store }

  async saveAsset(blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
    if (!this.store) throw new Error('AssetManager: no store configured')
    return this.store.save(blob, fileName, mimeType)
  }

  async getObjectURL(assetId: string): Promise<string | null> {
    // 有缓存直接返回
    if (this.objectURLs.has(assetId)) {
      this.urlTimestamps.set(assetId, Date.now())
      return this.objectURLs.get(assetId)!
    }
    if (!this.store) return null
    const blob = await this.store.get(assetId)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    this.objectURLs.set(assetId, url)
    this.urlTimestamps.set(assetId, Date.now())
    return url
  }

  async getBlob(assetId: string): Promise<Blob | null> {
    if (!this.store) return null
    return this.store.get(assetId)
  }

  revokeURL(assetId: string) {
    const url = this.objectURLs.get(assetId)
    if (url) { URL.revokeObjectURL(url); this.objectURLs.delete(assetId) }
  }

  revokeAllURLs() {
    for (const url of this.objectURLs.values()) URL.revokeObjectURL(url)
    this.objectURLs.clear()
    this.urlTimestamps.clear()
  }
}
```

---

### Task 5: StoragePlugin 集成 AssetManager

**Files:**
- Modify: `src/canvas/core/plugins/storage/StoragePlugin.ts`
- Modify: `src/canvas/core/plugins/storage/index.ts`

**Step 1: 在 install() 中创建 AssetManager，根据模式切换 store**

```typescript
// 在 install() 函数内部
const assetManager = new AssetManager()

// localStorage 模式
connectionMode = 'localStorage'
assetManager.setStore(new IndexedDBAssetStore())

// filesystem 模式
connectionMode = 'filesystem'
assetManager.setStore(new FileSystemAssetStore(handle, currentProjectId))
```

**Step 2: 修改 sanitizeForSave**

保留 `assetId`，不再删除 `imageUrl` 中 blob URL（改为保存前统一清理运行时字段）：

```typescript
function sanitizeForSave(nodes: any[], edges: any[]): CanvasData {
  const cleaned = JSON.parse(JSON.stringify({ nodes, edges }))
  for (const n of cleaned.nodes) {
    // 不删 assetId，删运行时 blob URL（imageUrl/videoUrl/thumbUrl）
    if (n.data) {
      delete n.data.imageUrl   // 运行时 blob URL，不持久化
      delete n.data.videoUrl
      delete n.data.thumbUrl
      delete n.data._cropRect  // 裁剪暂存态
    }
  }
  // ... 原有过滤 temp 节点
  return cleaned
}
```

**Step 3: 修改 loadCanvas — 恢复 object URL**

```typescript
async function loadCanvas(projectId: string): Promise<CanvasData> {
  // ... 从 localStorage 加载
  const restored = cached || { nodes: [], edges: [] }
  // 为每个有 assetId 的节点恢复 object URL
  for (const node of restored.nodes) {
    if (node.data?.assetId) {
      node.data.imageUrl = await assetManager.getObjectURL(node.data.assetId)
    }
  }
  return restored
}
```

**Step 4: 暴露 AssetManager 到 StorageAPI**

```typescript
export interface StorageAPI {
  // ... 现有属性
  readonly assets: AssetManager
}

// 在 api 对象中
assets: assetManager,
```

**Step 5: 项目切换时清理旧 URL**

```typescript
switchProject(id: string) {
  assetManager.revokeAllURLs()
  // switch 逻辑
  // 新 project 的 asset store 也要切（FS 模式下 store 绑定了 projectId）
  if (fsAdapter && connectionMode === 'filesystem') {
    assetManager.setStore(new FileSystemAssetStore(fsAdapter.handle, id))
  }
}
```

---

### Task 6: FileDropPlugin 接入 AssetManager

**Files:**
- Modify: `src/canvas/core/plugins/file-drop/FileDropPlugin.ts`

**Step 1: 通过 context.getPlugin('storage') 获取 AssetManager**

```typescript
function getAssetManager(): AssetManager | null {
  const storagePlugin = context.getPlugin('storage') as any
  const api = storagePlugin?.api
  return api?.assets ?? null
}
```

**Step 2: 修改文件处理 — 图片和视频走 assetManager.saveAsset()**

当前逻辑（image 类型）：
```typescript
const url = URL.createObjectURL(file)  // blob URL
node.data.imageUrl = url
```

新逻辑：
```typescript
const am = getAssetManager()
if (am) {
  const assetId = await am.saveAsset(file, file.name, file.type)
  const url = await am.getObjectURL(assetId)
  // 不能 await am.getObjectURL，此时 blob 还在内存中——saveAsset 内部会存
  // 实际上直接调 saveAsset + getObjectURL 即可
  node.data.assetId = assetId
  node.data.imageUrl = url
}
```

**Step 3: AssetRecord 不需要存 blob 字段**

这一点很重要——`saveAsset` 在 IndexedDBAssetStore 中把 blob 存进 IndexedDB 了（put 时包含 blob），但 `AssetRecord.blob` 是运行时字段。从 DB 读回来时 blob 字段会被 IndexedDB 自动设置。或者更简单的做法：`AssetRecord` 去掉 `blob` 字段，store 内部直接用 `blob` 参数存。

实际上，IndexedDB 存对象时，值中的 `Blob` 会被正确序列化。但 `AssetRecord` 定义为 TypeScript interface，`blob` 字段标记为可选。序列化到 JSON 时跳过 blob 字段即可（`sanitizeForSave` 已经管不到 AssetRecord，AssetRecord 只用于 asset store 内部）。

---

### Task 7: ImageTopToolbar uploadImage 接入 AssetManager

**Files:**
- Modify: `src/canvas/core/components/nodes/image/ImageTopToolbar.vue`

**Step 1: uploadImage 改为通过 storage API 保存**

```typescript
import { useVueFlow } from '@vue-flow/core'
import { inject } from 'vue'

// 需要从父组件注入 storage api，或者通过 event bus
// 方案：使用 inject('canvasStorageApi') 注入
```

**Step 2: 实际改动**

当前：
```typescript
const imageUrl = URL.createObjectURL(file)
```

改为：
```typescript
const storage = inject('canvasStorageApi') as any
const assetManager = storage?.assets
let imageUrl = URL.createObjectURL(file)  // 先设临时 URL 用于预览
let assetId: string | undefined

if (assetManager) {
  assetId = await assetManager.saveAsset(file, file.name, file.type)
  // saveAsset 完成后，getObjectURL 返回新的 URL（基于 IndexedDB 重建的 blob）
  // 但原 file 对象还在内存，直接用它的 blob URL 也可以
}

updateNode(props.id, {
  data: {
    ...(node?.data ?? {}),
    assetId,     // ← 持久化标识
    imageUrl,    // ← 运行时 blob URL
    imageName: file.name,
    // ...
  },
})
```

---

### Task 8: 提供 canvasStorageApi inject key 给子组件

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

**Step 1: 定义并提供 inject key**

```typescript
// Canvas.vue 顶部
import type { InjectionKey } from 'vue'
import type { StorageAPI } from './plugins/storage/StoragePlugin'

export const storageApiKey: InjectionKey<StorageAPI> = Symbol('canvasStorageApi')
```

**Step 2: 在组件 setup 中 provide**

```typescript
// 在 onMounted 中，插件安装后
const storageApi = manager.getPluginAPI<StorageAPI>('storage')
if (storageApi) {
  provide(storageApiKey, storageApi)
}
```

---

### Task 9: 验证 — 端到端测试

**Step 1: 手动验证流程**

1. 打开应用，拖入一张图片 → 看到图片节点渲染正常
2. 刷新页面 → 图片节点仍然显示图片（从 IndexedDB 恢复）
3. 连接文件夹 → 拖入图片 → 刷新 → 图片仍在
4. 切换到文件夹 → 检查 `project-default/assets/` 下有图片文件

**Step 2: 切项目验证**

1. 创建两个项目
2. 分别在两个项目中拖入不同图片
3. 切换项目 → 各自图片正确加载
4. 删除项目 → 对应资产清理

---

### Task 10: 清理 sanitizeForSave 逻辑

**Files:**
- Modify: `src/canvas/core/plugins/storage/StoragePlugin.ts`

当前 sanitizeForSave 有很多硬编码的类型过滤。应该统一为：

```typescript
function sanitizeForSave(nodes: any[], edges: any[]): CanvasData {
  const cleaned = JSON.parse(JSON.stringify({ nodes, edges }))
  
  for (const n of cleaned.nodes) {
    if (!n.data) continue
    // 清理运行时字段（不持久化的 blob URL）
    const runtimeFields = ['imageUrl', 'videoUrl', 'thumbUrl', '_cropRect', '_cropMode']
    for (const key of runtimeFields) delete n.data[key]
    
    // 清理 values 中的 _url
    if (n.data.values) {
      for (const v of Object.values(n.data.values) as any[]) {
        if (v && typeof v === 'object') delete v._url
      }
    }
    
    // 过滤无效节点类型
    const validTypes = ['image-input', 'video-generation']
    if (!validTypes.includes(n.type)) n.type = 'image-input'
  }
  
  // 过滤 temp 节点/边
  cleaned.nodes = cleaned.nodes.filter((n: any) => !(n.id?.startsWith('temp-')))
  cleaned.edges = cleaned.edges.filter(
    (e: any) => !(e.id?.startsWith('temp-') || e.data?.isTemp)
  )
  
  return cleaned
}
```

---

### Task 11: 更新类型导出

**Files:**
- Modify: `src/canvas/core/plugins/storage/index.ts`

```typescript
export { StoragePlugin } from './StoragePlugin'
export type { StorageOptions, StorageAPI, StorageStatus, ProjectMeta } from './StoragePlugin'
export type { AssetStore, AssetRecord } from './adapters/AssetStore'
export { AssetManager } from './adapters/AssetManager'
```
