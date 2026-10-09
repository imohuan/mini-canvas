"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStore = exports.DEFAULT_PAGE_SIZE = exports.DEFAULT_HISTORY_LIMIT = void 0;
/**
 * HistoryStore —— 生成历史（画布文件夹里的 history.json）。
 *
 * 存法：`<画布>/history.json`，值是 `HistoryEntry[]`。
 * 为什么单独一个文件：它是**账本**（按时间只增不减），与画布本体互不干扰 ——
 * 每次生成记一笔，不必重写整份节点边。
 *
 * 为什么连"提醒订阅者"也在这里做：实时通道（SSE）靠的是**写事件**，
 * 而 history.json 不经过 KvStore，写它不会产生事件。所以归档后要额外惊动一次
 * （写一个信号键）—— 否则后台记了账，前端永远收不到通知。
 */
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const canvasPaths_js_1 = require("../store/canvasPaths.js");
/** 历史条数上限：超出丢最旧的（生成要花钱，量不会大；但账本不能无限长） */
exports.DEFAULT_HISTORY_LIMIT = 500;
/** 默认分页大小 */
exports.DEFAULT_PAGE_SIZE = 20;
class HistoryStore {
    root;
    limit;
    listeners = new Set();
    constructor(root, limit = exports.DEFAULT_HISTORY_LIMIT) {
        this.root = root;
        this.limit = limit;
    }
    /** 订阅「有新的历史」（后端把它接到 SSE 的信号键上） */
    onChange(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    notify() {
        for (const l of this.listeners) {
            try {
                l();
            }
            catch {
                /* 订阅者自己的问题，不该把归档带崩 */
            }
        }
    }
    /** 读某画布的全部历史（最新的在前） */
    async readAll(canvasId) {
        const raw = await readJson((0, canvasPaths_js_1.canvasFilePath)(this.root, canvasId, 'history'));
        if (!Array.isArray(raw))
            return [];
        return raw;
    }
    /**
     * 归档一笔。
     *
     * 最新在前（新的一笔插到头部），超出上限丢尾部（最旧的）。
     */
    async append(canvasId, entry) {
        const all = await this.readAll(canvasId);
        const next = [entry, ...all];
        if (next.length > this.limit)
            next.length = this.limit;
        await atomicWriteJson((0, canvasPaths_js_1.canvasFilePath)(this.root, canvasId, 'history'), next);
        this.notify();
    }
    /**
     * 查询：筛选 + 排序 + 分页 + 汇总。
     *
     * 汇总（一共生成过多少 / 按类型分）**不受分页影响** —— 前端那几个计数徽章要的是总量。
     */
    async query(q = {}) {
        const page = Math.max(1, Math.floor(q.page ?? 1));
        const pageSize = Math.max(1, Math.floor(q.pageSize ?? exports.DEFAULT_PAGE_SIZE));
        const order = q.order === 'asc' ? 'asc' : 'desc';
        const source = q.canvasId ? await this.readAll(q.canvasId) : await this.readAllCanvases();
        // readAll 已是"最新在前"，这里只需在 asc 时反过来
        const ordered = order === 'desc' ? source : [...source].reverse();
        const filtered = ordered.filter((e) => {
            if (q.status && e.status !== q.status)
                return false;
            // 'all' 与省略等价（前端那个下拉的"所有评级"）
            if (q.rating && q.rating !== 'all' && e.rating !== q.rating)
                return false;
            return true;
        });
        // 类型筛选单独一层：items/total 跟着它走，但**计数徽章不跟着走** ——
        // 用户点开「图片」页签时，「视频/音频」页签的计数要照常显示全量分布
        //（否则切页签后数字全变成 0 或只剩本类，看起来像坏了一样）。
        const kindFiltered = q.kind ? filtered.filter((e) => e.kind === q.kind) : filtered;
        const byKind = {};
        for (const e of filtered)
            byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
        const start = (page - 1) * pageSize;
        return {
            items: kindFiltered.slice(start, start + pageSize),
            total: kindFiltered.length,
            page,
            pageSize,
            // 汇总的 total 跟随类型筛选（页签下划线旁的数字），byKind 永远给全量分布
            summary: { total: kindFiltered.length, byKind },
        };
    }
    /** 跨全部画布读（"全部画布"那个筛选） */
    async readAllCanvases() {
        const { promises: fsp } = await Promise.resolve().then(() => __importStar(require('node:fs')));
        const root = node_path_1.default.join(this.root, 'canvases');
        let ids;
        try {
            ids = (await fsp.readdir(root)).filter((n) => /^[A-Za-z0-9_-]{1,64}$/.test(n));
        }
        catch {
            return [];
        }
        const out = [];
        for (const id of ids)
            out.push(...(await this.readAll(id)));
        // 跨画布时按时间重排（各画布内部有序，合起来要再排一次）
        return out.sort((a, b) => b.finishedAt - a.finishedAt);
    }
}
exports.HistoryStore = HistoryStore;
/** 读 JSON；不存在或坏掉都按"没有历史"处理（与 kvStore 同口径：坏内容要出声） */
async function readJson(file) {
    try {
        return JSON.parse(await node_fs_1.promises.readFile(file, 'utf8'));
    }
    catch (err) {
        if (isNotFound(err))
            return undefined;
        if (err instanceof SyntaxError) {
            console.warn('[history] ' + file + ' 不是合法 JSON，按空历史处理');
            return undefined;
        }
        throw err;
    }
}
/** 原子写（先临时再 rename） */
async function atomicWriteJson(file, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await node_fs_1.promises.writeFile(tmp, JSON.stringify(value), 'utf8');
    await node_fs_1.promises.rename(tmp, file);
}
function isNotFound(err) {
    return typeof err === 'object' && err !== null && err.code === 'ENOENT';
}
