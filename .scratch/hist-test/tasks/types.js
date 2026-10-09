"use strict";
/**
 * 任务（Job）与历史记录的形状。
 *
 * 一句话分工：
 * - **Job** 是"这件事在跑"，活在内存里（服务重启后由节点上的 runState 兜底）；
 * - **HistoryEntry** 是"这件事跑完了"，落在画布文件夹里（账本，只增不减）。
 *
 * 唯一事实来源：进度与终态都写到**节点自己的 runState** 上。
 * 前端读的就是它 —— 所以"关掉页面任务照跑、回来一看进度还在"是天然成立的。
 */
Object.defineProperty(exports, "__esModule", { value: true });
