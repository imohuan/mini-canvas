# 风格库

> `@plume-canvas/plugin-style-library` - v0.1.2

本地风格素材库：读一个资源目录（图片/视频 + 索引），前后台成对，带亮暗主题的风格广场 UI.

## 功能说明

plugin-style-library —— 前端半：把「本地素材库」（风格库 + 特效库）做成画布里的一个插件。
## 分层（数据与组件 UI 分开，组件可替换）
```
src/index.ts            插件入口：注册 UI 目录 + 槽 + 两个服务 + 命令（不 import 具体 UI 语义）
src/data/*              数据层（types / api / store）—— 取数 / 分页 / 筛选 / 设置读写
src/components/*        默认 UI（可替换）—— 广场 / 卡片 / 详情 / 两个外壳
src/server.ts           后台半（打成 dist/server.js，由 cloud-server 跑，两个库共用一套逻辑）
```
## 两套库、一套 UI、一套数据层
用户口径：**风格库与特效库的数据结构、UI 都通用，只是目录不同、点击效果不同**。
所以：
- **数据层**：`createLibraryService(kind, …)` 一套逻辑，建两个实例 →
  注入成两个服务名 `style-library`（风格）/ `effect-library`（特效）。
- **后台**：两个路由前缀 `/api/style-library` / `/api/effect-library`，同一套处理逻辑。
- **UI**：广场/卡片**同一件**（按名取）；外壳分两件（标题与点击行为不同）——
  风格外壳点卡片开详情；特效外壳点卡片开全屏预览（没有详情页）。
## 可替换性（本插件的设计要点）
所有 UI 件都注册进内核的 **ui 目录**（`registryOf('ui')`），消费方**按名取**：
| 名字 | 默认件 | 换法 |
| --- | --- | --- |
| `styleLibraryOverlay`  | 风格库外壳 | 另注册同名件、order 更小 |
| `effectLibraryOverlay` | 特效库外壳 | 同上 |
| `styleLibraryGallery`  | 广场（两库共用） | 同上 |
| `styleLibraryCard`     | 一张卡（两库共用） | 同上 |
| `styleLibraryDetail`   | 详情浮层（只风格库用） | 同上 |
| `effectLibraryViewer`  | 特效全屏预览兜底壳 | 同上 |
数据一律经服务（`ctx.get('style-library')` / `ctx.get('effect-library')`）拿，UI 只管画。
## 怎么打开
命令 `style-library:open` / `effect-library:open`；服务也有 `open()/close()/toggle()`。
/

## 注册项

### 提供的服务 (ctx.inject / provide)

- `style-library`
- `effect-library`

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `app.projects.tabs`

## 安装

```bash
npm i @plume-canvas/plugin-style-library
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
