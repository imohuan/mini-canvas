import { Schema } from "prosemirror-model";
import { schema as baseSchema } from "prosemirror-schema-basic";
import type { ResourceItem } from "../types";
import { getThumbnailUrlFromAssetUrl } from "../utils";
import { REF_NAME_PREFIX, REF_NODE_PREFIX, buildRefChipItem, itemRegistry, renderRefChip } from "./chipRegistry";
import { activeTagSpec } from "./tagSpec";

// Schema 定义
export const mySchema: Schema = new Schema({
  nodes: baseSchema.spec.nodes.append({
    resource: {
      attrs: {
        id: {},
        name: {},
        category: { default: 'resource' },
        url: { default: '' },
        thumbnail_url: { default: '' },
        value: { default: '' },
        // 引用标记（技能 / MCP / 节点）：纯文本导出时还原成 `@[kind:name](value)`。
        // 只有这三类引用带它；图片/视频素材标签留空，仍旧导出 `@名字`。
        refKind: { default: '' },
        refValue: { default: '' },
        // 资产引用专用（见 referenceMarkup.ts）：
        //   refExt      扩展名（png / mp4 / mp3…）—— 点标签预览时靠它决定用哪个预览器；
        //   refFolderId 资产库文件夹 id —— 点文件夹标签时靠它定位到资产管理的那一层。
        // 必须存成节点属性：导出（getPlainText / 复制）要原样写回标记，靠 itemRegistry 会丢
        // （回填出来的最小 item 没有这两个字段）。
        refExt: { default: '' },
        refFolderId: { default: '' },
        /**
         * 参考标签的类型（用户 2026-10-28）：绑定节点后存节点真实类型，
         * 冷启动（注册表空）也能按它画对图标；空串 = 待绑定，画统一资源图标。
         */
        chipKind: { default: '' },
        /**
         * 标签显示序号（用户 2026-11-08：「1 · 名字」里那个数字）。
         *
         * 为什么落进文档：正文标签是 atom 节点，ProseMirror 只在**节点真的变了**时
         * 才重建 DOM。序号若只存在运行时注册表，拖拽换序后属性一个字没变，
         * 页面就停在旧号上（实测）。存成属性后 chipIndex 变了 → 节点变了 → 标签重画。
         */
        chipIndex: { default: 0 },
      },
      group: "inline",
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: (node) => {
        let item = itemRegistry.get(node.attrs.id)
        /**
         * 冷启动（刷新页面 / 重开底栏）时，注册表里只有 `registerSlotItemsFromDoc`
         * 造出来的**最小条目**（没有 url）。若直接拿它渲染，标签会画成「待输入」虚线
         * —— 用户看到的「刷新后标签退回原样」就是这个（2026-10-28 报）。
         *
         * 富文本节点自己存了 url（落盘的 doc JSON 里有），先用它补齐注册表再渲染：
         * 视觉一次就对，不依赖底栏之后的异步刷新。
         */
        const urlFromAttrs = String(node.attrs.url ?? '')
        if (item && urlFromAttrs && !item.url) {
          item = { ...item, url: urlFromAttrs }
          itemRegistry.set(node.attrs.id, item)
        }
        if (item?.renderEditor) {
          const result = item.renderEditor(item)
          if (result instanceof HTMLElement) {
            result.classList.add("resource-node")
            /**
             * 「可编辑」标记在这里**统一补一次**（用户 2026-10-29）。
             *
             * 为什么不能只在 renderRefChip 里加：标签的 DOM 有好几条渲染路径
             * （renderRefChip / buildSlotItem 等），各自拼自己的 class。
             * 只改其中一条，另一条渲染出来的标签就没有铅笔图标、hover 也不换图 ——
             * 真机表现就是「有的标签能点图标、有的点不动」。
             * 放在这个收口上，任何 renderEditor 产出的 DOM 都一致。
             */
            if (item.onIconClick || item.onReplaceClick) {
              result.classList.add('resource-chip--editable')
            }
            result.setAttribute("data-id", node.attrs.id)
            result.setAttribute("data-url", node.attrs.url || "")
            result.setAttribute("data-name", node.attrs.name || "")
            result.setAttribute("data-category", node.attrs.category || "")
            result.setAttribute("data-ref-kind", node.attrs.refKind || "")
            result.setAttribute("data-ref-value", node.attrs.refValue || "")
            result.setAttribute("data-ref-ext", node.attrs.refExt || "")
            result.setAttribute("data-ref-folder", node.attrs.refFolderId || "")
            if (Number(node.attrs.chipIndex) > 0) {
              result.setAttribute('data-chip-index', String(node.attrs.chipIndex))
            }
            return result
          }
          return result  // DOMOutputSpec 数组，直接透传
        }
        // 默认渲染
        const { id, name, url, thumbnail_url, category } = node.attrs
        /**
         * 外部注册的 tagSpec 优先兜底渲染（用户 2026-10-27：标签实现交给插件）。
         * 放在内置 ref-slot 分支之前：插件可能用自己的 id 规则（@角色1 之类），
         * 内置规则认不出来，但只要它给了 render 就能画对。
         */
        const spec = activeTagSpec
        if (spec?.render) {
          const item = itemRegistry.get(String(id ?? ''))
          if (item) {
            const rendered = spec.render(item)
            if (rendered instanceof HTMLElement) {
              rendered.classList.add('resource-node')
              rendered.setAttribute('data-id', String(id ?? ''))
              rendered.setAttribute('data-name', String(name ?? ''))
              rendered.setAttribute('data-category', category || '素材')
              return rendered
            }
            return rendered
          }
        }
        /**
         * 参考标签兜底渲染（用户 2026-10-28 定案：认节点 / 认名称，不认序号）。
         *
         * 冷启动时注册表可能是空的，但标签身份自己就够画：
         *   - `ref-node:<id>` → 已绑定，名字来自节点属性（name 已随文档存着）；
         *   - `ref-name:<名>` → 待绑定，统一资源图标；
         *   - `ref-slot:<kind>:<N>` → 老格式，**不兼容**，按失效画（用户拍板）。
         *
         * 没有这一支就会落到下面默认分支（`@名字` + 下划线），和卡片并排成两套 UI。
         */
        const chipId = String(id ?? '')
        const chipKindAttr = String(node.attrs.chipKind ?? '')
        const isRefChip =
          chipId.startsWith(REF_NODE_PREFIX) ||
          chipId.startsWith(REF_NAME_PREFIX) ||
          chipId.startsWith('ref-slot:')
        if (isRefChip) {
          const legacy = chipId.startsWith('ref-slot:')
          /**
           * 注册表里已有的条目 = 调用方刚登记过的最新外观与交互（onIconClick / onReplaceClick / hoverPreview）。
           * 用它当底，再用文档属性补 url/value —— 绝不能反过来让兜底条目覆盖注册表：
           * 那会把交互回调全丢掉（真机踩过：标签左侧图标点不动、hover 不换编辑图标）。
           */
          const registered = itemRegistry.get(chipId)
          const fallback = legacy
            ? buildRefChipItem({ id: chipId, name: String(name ?? id), invalid: true })
            : buildRefChipItem({
                id: chipId,
                name: String(name ?? id),
                ...(chipKindAttr === 'image' || chipKindAttr === 'video' || chipKindAttr === 'audio' || chipKindAttr === 'text'
                  ? { bound: { kind: chipKindAttr } }
                  : {}),
              })
          const withData: ResourceItem = {
            ...fallback,
            ...(registered ?? {}),
            // 名字以文档为准（文档是用户看得见的那份），其余外观/交互以注册表为准
            name: registered?.name || fallback.name,
            // 序号以文档为准（冷启动注册表还没登记时也能画出正确的号）
            ...(Number(node.attrs.chipIndex) > 0 ? { chipIndex: Number(node.attrs.chipIndex) } : {}),
            ...(url ? { url: String(url) } : {}),
            ...(node.attrs.value ? { value: String(node.attrs.value) } : {}),
          }
          if (id) itemRegistry.set(chipId, withData)
          const rendered = renderRefChip(withData)
          rendered.setAttribute('data-category', category || '素材')
          return rendered
        }
        if (url) {
          const thumbUrl = thumbnail_url || getThumbnailUrlFromAssetUrl(url)
          return [
            "span",
            { class: "resource-node", "data-id": id, "data-url": url, "data-name": name, "data-category": category },
            ["img", { src: thumbUrl || url, draggable: "false", class: "object-cover" }],
            ["span", { class: "label" }, name],
          ]
        }
        return [
          "span",
          { class: "resource-node resource-node-text", "data-id": id, "data-name": name, "data-value": node.attrs.value, "data-category": category },
          ["span", { class: "label" }, `@${name}`],
        ]
      },
      parseDOM: [{
        tag: "span.resource-node",
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            id: el.getAttribute("data-id") || "",
            name: el.getAttribute("data-name") || "",
            category: el.getAttribute("data-category") || "resource",
            url: el.getAttribute("data-url") || "",
            thumbnail_url: getThumbnailUrlFromAssetUrl(el.getAttribute("data-url") || ""),
            value: el.getAttribute("data-value") || "",
            chipKind: el.getAttribute("data-kind") || "",
            chipIndex: Number(el.getAttribute("data-chip-index") || 0) || 0,
          }
        },
      }],
    },
  }),
});
