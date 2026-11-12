<script lang="ts">
/**
 * SlotAnchor —— 内置 UI 在 SlotComposer 里的锚点。
 *
 * **它自己不渲染任何东西**：只把 id / order / before / after 交给父级 SlotComposer，
 * 由父级在最终顺序里展开它的默认插槽。这样内容不会被"提前渲染"，
 * 锚点不会额外包一层 DOM，底栏按钮仍然是 flex 的直接子项。
 *
 * 单独使用（不套 SlotComposer）时什么也不显示 —— 锚点必须在 SlotComposer 内使用。
 *
 * id 规范：owner/name，例如 host/agent、host/add。
 */
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'SlotAnchor',
  inheritAttrs: false,
  props: {
    id: { type: String, required: true },
    order: { type: Number, default: undefined },
    before: { type: String, default: undefined },
    after: { type: String, default: undefined },
  },
  setup() {
    // 标记组件：SlotComposer 读它的 props，再自己展开默认插槽
    return () => null
  },
})
</script>
