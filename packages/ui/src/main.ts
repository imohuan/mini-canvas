import { createApp } from "vue";
import "./app.css";

// ===== 性能探针（2026-10-15 卡死排查后留档：lt=长任务数 ms=总毫秒 wall=运行秒）=====
// longtask 观察器 + 每 5 秒把最近任务统计写 localStorage（主线程卡死前的数据已落，
// 同源任意标签页可读；下一个打开的页面把上一轮统计写进 document.title（PERF 前缀），
// 供 CDP 不可用时取证。attribution 带容器名，尽量指认来源组件。
(function () {
  try {
    const last = localStorage.getItem('mc-perf-probe-last');
    if (last) document.title = 'PERF ' + last;
  } catch { /* 忽略 */ }
})();
(function perfProbe() {
  try {
    const KEY = 'mc-perf-probe';
    const state = { tasks: [] as Array<{ t: number; d: number; who: string }>, win0: performance.now() };
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const anyE = e as unknown as { attribution?: Array<{ containerName?: string; containerSrc?: string }> };
        const a = anyE.attribution?.[0];
        state.tasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration), who: a?.containerName || a?.containerSrc || '?' });
      }
      if (state.tasks.length > 400) state.tasks = state.tasks.slice(-200);
    });
    po.observe({ entryTypes: ['longtask'] });
    (window as unknown as Record<string, unknown>).__readPerfProbe = () => {
      const now = performance.now();
      const total = state.tasks.reduce((s2, t) => s2 + t.d, 0);
      const byWho: Record<string, { count: number; ms: number }> = {};
      for (const t of state.tasks) {
        const k = byWho[t.who] ?? (byWho[t.who] = { count: 0, ms: 0 });
        k.count++; k.ms += t.d;
      }
      const top = Object.entries(byWho).sort((x, y) => y[1].ms - x[1].ms).slice(0, 8);
      return JSON.stringify({ wallSec: Math.round(now / 1000), longTasks: state.tasks.length, longMs: Math.round(total), top });
    };
    setInterval(() => {
      try {
        const now = performance.now();
        const total = state.tasks.reduce((s2, t) => s2 + t.d, 0);
        const snapshot = 'lt=' + state.tasks.length + ' ms=' + Math.round(total) + ' wall=' + Math.round(now / 1000) + 's';
        localStorage.setItem(KEY, snapshot);
        localStorage.setItem('mc-perf-probe-last', snapshot);
      } catch { /* 忽略 */ }
    }, 5000);
  } catch { /* 探针失败不影响应用 */ }
})();
// ===== 探针结束 =====
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import Root from "./Root.vue";
import { exposeSharedGlobals } from "./sharedGlobals";
import { exposePluginReloader } from "./pluginReload";
import { exposeSharedKvEvents } from "./composables/kvEvents";
import { router } from "./router";

// 先挂共享运行时全局（Vue / MiniCanvasCore / …），再挂载应用 ——
// 外部 UMD 插件（经「插件管理」安装）靠这些全局取依赖，必须在它们加载前就位。
exposeSharedGlobals();

// 共享 KV 实时通道：全应用（含外部插件 bundle）只开**一条** /api/kv/events。
// 不挂这个，首页/画布/插件各自 new EventSource，几条长连接就把浏览器对单个域名的
// 并发额度（6 条）占满，普通请求全部排队 —— 用户看到的是"网页卡住"。
exposeSharedKvEvents();

// 开发便利：把"重装插件"挂成 window 函数（改完插件产物后一句 window.MiniCanvasPlugin.reload('style-library') 生效）。
// 函数内部调用时才去取 window.MiniCanvasUI，所以这里宿主还没起也没关系。
//
// 想"自动监听、产物一变就重装"：去 设置 → 热重载 里登记链接（见 @mini-canvas/plugin-hot-reload）——
// 那边支持**多条、跨源**的链接，比在这里写死一条同源地址更通用。
exposePluginReloader();

createApp(Root).use(router).mount("#app");

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") {
    debugger;
  }
});

