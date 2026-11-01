# 参考标签改为「按名称 + 绑定节点」实施计划

> 用户口径（2026-10-28，多轮确认后的最终规则）：
>
> 1. 标签身份 = **目标节点 id**；标签显示 = **节点名称**（画布内名称唯一）。类型不写进名字。
> 2. 添加与替换统一为「绑定」：空卡拖入节点 = 添加；有内容的卡拖入节点 = 替换。
>    替换后正文标签的名称自动换成新节点的名称（标签跟着节点走，不追序号）。
> 3. 类型图标：**默认统一资源图标**（手打的待绑定标签 / 空卡不区分类型）；
>    绑定后（拖入 / 连线 / 标记按名匹配成功）换成节点真实类型图标与缩略图。
> 4. 卡片序号角标**保留**，只作为当前顺序的观察，不参与任何判定。
> 5. 拖拽悬停卡片时显示该卡的**名称条**（空卡显示名称 + 待添加），松手前能确认对象。
> 6. 失效引用（绑定的节点已断线/被删）→ 标签显示失效样式，**禁止发送**。旧格式
>    `ref-slot:<kind>:<N>` 不迁移，按失效处理，用户重新标记一次。
> 7. 「标记」按钮：把正文 `@名称` 按已连线素材名称匹配 → 绑定标签；
>    匹配不上 → 生成待绑定标签（统一图标）。支持含空格的完整名称优先匹配。
> 8. 上传/粘贴建的素材节点，名称取文件名（画布内查重加后缀），不再用「图片 N」默认名。

## 任务拆分

- [ ] Task 1 计划落盘（本文件）
- [ ] Task 2 编辑器侧：标签 id 改 `ref-node:<id>` / `ref-name:<名>`；统一图标 + 失效样式；
      `replaceResource` 支持换绑（id 可变）；去掉按名重编号；旧格式不再迁移
- [ ] Task 3 bottom-bar 数据侧：slotKinds 增 `any`；refSlots 换成按 id 解析；
      refTiles 新合并规则（卡片=连线、空卡=待绑定、失效卡）；panelSource 去编号、
      tagSpec 动态按名扫描；上传节点名 = 文件名查重
- [ ] Task 4 NodeBottomBar 接线：卡片名称条 + 拖拽悬停名称、绑定/替换/上传链路、
      失效禁发提示、旧 refSlot/refGap 机制下线
- [ ] Task 5 测试与验证：两侧单测全绿、plugin-agent 回归（共用 schema）、
      canvas-render / ui typecheck、ui build
- [ ] Task 6 docs/STATUS.md 追记

## 验证命令

```bash
pnpm -C packages/prosemirror-editor-bundle test
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-agent test
pnpm -C packages/plugins/plugin-file-drop test
pnpm -C packages/ui typecheck
pnpm -C packages/ui build
```
