# edgeGeometry 从内核迁到 plugin-theme-default

## 结论背景（架构评审）
edgeGeometry.ts 是"自定义边渲染"的实现细节，唯一使用方是渲染边插件
`plugin-theme-default/src/CustomEdge.vue`（其注释就写"几何逻辑抽到 ./edgeGeometry.ts"）。
不应留内核 canvas-core-v2，应随边插件走。services/ 留内核不迁（引擎器官，非可拔插件）。

## 步骤
1. `git mv` edgeGeometry.ts → plugin-theme-default/src/edgeGeometry.ts
2. 契约测试随之搬迁（保"几何不可改坏"守护）：
   - 移 edgeGeometry.test.ts → plugin-theme-default/src/__tests__/edgeGeometry.test.ts
   - 改 test 里 import 相对路径
   - 给 plugin-theme-default 补 vitest 跑纯逻辑单测（该包现无测试配置）
3. CustomEdge.vue: import 源 `@mini-canvas/canvas-core-v2/contracts/edgeGeometry` → `./edgeGeometry`
4. canvas-core-v2: 删 src/contracts/edgeGeometry 全部 + index.ts 的 re-export（contracts 目录随之清空移除）
5. canvas-render index.ts 顶部注释改掉"留在内核"的说法
6. 每个原子步 git commit
7. 验证：跑 theme-default 新测试 + typecheck

## 坑
- 别改几何逻辑（测试锚定行为逐字节一致）
- 别动 services/（本次只迁边几何）
- CustomEdge.vue 里的 `Position` 类型本地化后，CustomEdgeExtraProps.geometry 的 EdgeAppearance 也要本地 import
