import type { AssetManager } from '../plugins/storage/adapters/AssetManager'

export class AssetRuntimeService {
  readonly assetManager: AssetManager
  constructor(assetManager: AssetManager) { this.assetManager = assetManager}

  async restoreNodeAssetUrls(nodes: any[]): Promise<any[]> {
    const restored: any[] = []
    for (const node of nodes) {
      const data = node.data as any
      if (!data?.assetId) {
        restored.push(node)
        continue
      }
      const url = await this.assetManager.getObjectURL(data.assetId)
      if (!url) {
        restored.push(node)
        continue
      }
      const key = data.nodeType === 'video' ? 'videoUrl' : 'imageUrl'
      restored.push({ ...node, data: { ...data, [key]: url } })
    }
    return restored
  }

  releaseProjectUrls(): void {
    this.assetManager.revokeAllURLs()
  }
}