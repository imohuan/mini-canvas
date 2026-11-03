<script lang="ts">
// 入口保留在原路径：调用方只认这里，真正的实现在 assets/tree/AssetTree.vue。
import AssetTree from './assets/tree/AssetTree.vue'

export default AssetTree
export type { AssetTreeRow, AssetTreeTarget } from './assets/tree/types'
</script>
