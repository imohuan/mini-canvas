"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CANVAS_ID = void 0;
exports.isSafeCanvasId = isSafeCanvasId;
exports.canvasesRoot = canvasesRoot;
exports.canvasDir = canvasDir;
exports.canvasFilePath = canvasFilePath;
exports.canvasResourcesDir = canvasResourcesDir;
exports.isSafeEntityId = isSafeEntityId;
exports.projectsFile = projectsFile;
exports.canvasIndexFile = canvasIndexFile;
exports.assetsDir = assetsDir;
exports.assetsIndexFile = assetsIndexFile;
exports.assetsFilesDir = assetsFilesDir;
exports.isSafeAssetName = isSafeAssetName;
/**
 * 画布路径推导与安全校验（纯函数，零依赖）。
 *
 * 布局：`<root>/canvases/<canvasId>/` 下放
 *   canvas.json（画布本体） · view.json（视图状态） · history.json（任务记录） · resources/（资源）
 *
 * 为什么要单独一层：路径拼接散在各处时，一处漏了 `..` 就是目录穿越。
 * 这里把「拼路径」与「查安全」绑在一起 —— 拿到路径就说明 id 已经过校验。
 */
const node_path_1 = __importDefault(require("node:path"));
/** 默认画布 id（前端界面当前只有一张画布） */
exports.DEFAULT_CANVAS_ID = 'default';
/**
 * 画布 id 白名单：字母 / 数字 / 下划线 / 连字符，1-64 位。
 *
 * 点号**不在**表内，所以 `.` 与 `..` 天然被拒；斜杠也不在，所以拼不出子目录。
 * 与其在黑名单里追着 `..` 跑，不如只放行确定安全的那几个字符。
 */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function isSafeCanvasId(id) {
    return CANVAS_ID_RE.test(id);
}
function assertSafe(id) {
    if (!isSafeCanvasId(id))
        throw new Error('[canvasPaths] 非法画布 id: ' + id);
}
/** 全部画布的父目录（列目录用；不涉及具体 id） */
function canvasesRoot(root) {
    return node_path_1.default.join(root, 'canvases');
}
/** 某个画布的目录 */
function canvasDir(root, id) {
    assertSafe(id);
    return node_path_1.default.join(canvasesRoot(root), id);
}
/**
 * 三个数据文件的路径。
 * `which` 是闭合词表（不是任意文件名）—— 调用方传不进来自外部的字符串，杜绝任意路径写入。
 */
function canvasFilePath(root, id, which) {
    const file = which === 'canvas' ? 'canvas.json' : which === 'view' ? 'view.json' : 'history.json';
    return node_path_1.default.join(canvasDir(root, id), file);
}
/** 某个画布的资源目录 */
function canvasResourcesDir(root, id) {
    return node_path_1.default.join(canvasDir(root, id), 'resources');
}
// ==================== 项目 / 资产（2026-10-05 新增）====================
//
// 「项目 → 画布」在磁盘上表现为**索引关系**（画布文件夹路径不变，见 docs/design/project-canvas-assets.md）：
//   canvases/index.json  画布索引（带 projectId）
//   projects.json        项目注册表
// 资源（生成产物 + 自己上传）单独一个目录：
//   assets/index.json    资产登记
//   assets/files/<hash>  自己上传的字节
/** 项目 / 资产 id 白名单：与画布 id 同口径（字母数字下划线连字符，1-64 位） */
const ENTITY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function isSafeEntityId(id) {
    return ENTITY_ID_RE.test(id);
}
/** 项目注册表文件 */
function projectsFile(root) {
    return node_path_1.default.join(root, 'projects.json');
}
/** 画布索引文件（画布 id → 名字 / 所属项目 / 创建时间） */
function canvasIndexFile(root) {
    return node_path_1.default.join(canvasesRoot(root), 'index.json');
}
/** 资产目录 */
function assetsDir(root) {
    return node_path_1.default.join(root, 'assets');
}
/** 资产登记文件 */
function assetsIndexFile(root) {
    return node_path_1.default.join(assetsDir(root), 'index.json');
}
/** 自己上传的资产字节目录 */
function assetsFilesDir(root) {
    return node_path_1.default.join(assetsDir(root), 'files');
}
/** 资产文件名白名单：与画布资源同名（16 位十六进制 + 可选扩展名） */
function isSafeAssetName(name) {
    return /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i.test(name);
}
