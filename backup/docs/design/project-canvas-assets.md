# 项目 / 画布 / 资产 —— 三层组织（2026-10-05）

> 用户口径：一个**项目**里有多张**画布**；项目在后台是一个文件夹，画布是它里面嵌套的文件夹
> （「工作区命名」= 这个文件夹的名字）；**资产**（生成产物 + 自己上传的资源）单独一个目录存放。
> 前端要一个项目列表页（对标 LibTV `/project`，去掉用户标记的红框区域）+ `vue-router` 切进画布。

## 一、存储布局（cloud-server，`<root>/.mini-canvas/`）

```
canvases/                       ← 画布本体（**路径保持不变**，避免动 297 条既有测试与已有数据）
  default/                        canvas.json · view.json · history.json · resources/
  <canvasId>/…                    新画的画布也落这里（扁平）；归属哪个项目记在索引里
  index.json                    ← **新增**：画布索引 [{ id, name, projectId, createdAt }]
projects.json                   ← **新增**：项目注册表 { projects: [{ id, name, createdAt }] }
assets/                         ← **新增**：资产目录（用户要的「单独一个文件夹」）
  index.json                      [{ id, name, kind, url, size?, createdAt, source }]
  files/<hash><ext>               自己上传的资产字节（生成产物按引用登记，不复制字节）
```

为什么画布路径**不动**：`CanvasStore / CanvasResourceStore / HistoryStore / CanvasDocument /
TaskManager / agent` 全部按 `canvases/<id>/` 定位（`store/canvasPaths.ts` 是唯一出口）。
把画布挪进 `projects/<pid>/canvases/<cid>/` 要改这一整条链 + 迁移已有数据 + 重写大量测试，
收益却只是「磁盘层级好看一点」——**风险远大于收益**。
因此「项目 → 画布」在磁盘上表现为**索引关系**（`index.json` 里带 projectId），
语义上等价于文件夹嵌套；将来若真要物理嵌套，只需改 `canvasPaths.ts` + 一次迁移。

## 二、HTTP 契约（新增，全部挂在 builtin 插件下）

```
GET    /api/projects                    → { ok, projects: [{id,name,createdAt,canvasCount}] }
POST   /api/projects           {name}   → { ok, project }
PATCH  /api/projects/:id       {name}   → { ok, project }
DELETE /api/projects/:id                → { ok }   （连同它的画布一起删；default 项目不可删）
GET    /api/projects/:id/canvases       → { ok, canvases: [{id,name,projectId,createdAt}] }
POST   /api/projects/:id/canvases {name}→ { ok, canvas }  （建目录 + 记索引）
PATCH  /api/canvases/:id/meta  {name}   → { ok }  （重命名画布）
POST   /api/canvases/:id/duplicate       → { ok, canvas }  （复制画布）
DELETE /api/canvases/:id                → { ok }  （删画布文件夹）
GET    /api/assets                      → { ok, assets: [...] }
POST   /api/assets        ?name=  (bytes)→ { ok, asset }   （上传 = source:'upload'，字节落 assets/files/）
GET    /api/assets/files/:name          → 字节
DELETE /api/assets/:id                  → { ok }
```

`/api/canvases`（既有）保持不变，`/api/canvases/:id` 等照旧。

## 三、资产从哪来（两条来源，用户口径）

1. **深层生成产物**：`TaskManager.finish` 成功归档历史后，把产物地址登进资产目录
   （`source:'generated'`，`url` 指向既有的 `/api/canvases/<id>/resources/<hash>` —— **按引用登记，不复制字节**，
   否则同一份产物存两遍）。
2. **自己上传**：`POST /api/assets` 直接存字节到 `assets/files/`（`source:'upload'`）。

## 四、前端（packages/ui）

- 引入 `vue-router`：`/` → 项目页；`/canvas/:canvasId` → 现有画布工作台。
- 项目页复刻 LibTV `/project`：左栏（logo / 新建项目 / 首页 / 项目 / 资产）+ 项目卡片网格
  （封面 + 名字 + 日期 + 「开始创作」）。**去掉用户红框**：右上积分/会员/头像、左栏
  `Agent`/`3D-BOX`/`插件与扩展`/`社区`/`版本更新记录`。
- 进项目 → 打开它的画布；画布工作台的「画布」下拉列出**当前项目的**画布，可新建/切换。
- 数据全部来自 cloud-server（`/api/projects`、`/api/projects/:id/canvases`），不写死。

## 五、验收

- `pnpm -C packages/cloud-server test` 全绿（新增 projectStore / assetStore / 路由单测，先红后绿）。
- `pnpm -C packages/ui test` + `typecheck` 全绿；`pnpm -C packages/ui build` 通过。
- Chrome 实测：项目页列出真实项目 → 点进 → 画布工作台；新建项目/画布、切画布、资产页正常。
