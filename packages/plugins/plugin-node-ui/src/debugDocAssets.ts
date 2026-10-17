/**
 * debugDocAssets —— 调试窗口 sdk.js 的正文模板（纯字符串，零逻辑）。
 * 为什么单独一个文件：这是「JS 里嵌 JS」的字符串，塞主文件会把引号转义搅成粥。
 * CONTEXT_URL 占位符 __CONTEXT_URL__ 由调用方替换。
 */
export const SDK_JS_TEMPLATE = [
"/* 由 mini-canvas 自动生成 —— 调试窗口的 CanvasUI 桥。 */",
"(function(){",
"  var CONTEXT_URL = \"__CONTEXT_URL__\";",
"  var lastRaw = null;",
"  var changeFns = [];",
"  function collect(){ return { upstream: window.__CANVAS_UPSTREAM__ || [], inputs: window.__CANVAS_INPUTS__ || {} }; }",
"  function fireChange(){ var p = collect(); for (var i = 0; i < changeFns.length; i++) { try { changeFns[i](p); } catch (e) {} } }",
"  function apply(force){",
"    return fetch(CONTEXT_URL + (CONTEXT_URL.indexOf(\"?\") >= 0 ? \"&\" : \"?\") + \"t=\" + Date.now(), { cache: \"no-store\" })",
"      .then(function(r){ if (!r.ok) throw new Error(\"context \" + r.status); return r.text(); })",
"      .then(function(text){",
"        if (!force && text === lastRaw) return false;",
"        lastRaw = text;",
"        try { new Function(text)(); } catch (e) { console.error(\"[ui-debug-doc] context.js 执行失败\", e); return false; }",
"        return true;",
"      })",
"      .then(function(changed){ if (changed) fireChange(); })",
"      .catch(function(err){ console.warn(\"[ui-debug-doc] 拉取 context 失败\", err); });",
"  }",
"  apply(true);",
"  setInterval(function(){ apply(false); }, 5000);",
"  window.CanvasUI = {",
"    setInputs: function(params){",
"      var cur = window.__CANVAS_INPUTS__ || {};",
"      var next = {}; for (var k in cur) next[k] = cur[k];",
"      for (var k2 in (params || {})) next[k2] = params[k2];",
"      window.__CANVAS_INPUTS__ = next;",
"      fireChange();",
"    },",
"    onChange: function(fn){ if (typeof fn === \"function\") changeFns.push(fn); },",
"    save: function(data, name){",
"      var U = window.__CANVAS_UI__ || {};",
"      var bytes = data;",
"      if (typeof data === \"string\") bytes = new Blob([data], { type: \"text/plain\" });",
"      var fname = String(name || \"out.png\");",
"      var withExt = /\\./.test(fname) ? fname : fname + \".png\";",
"      var url = (U.baseUrl || \"\") + \"/api/canvases/\" + encodeURIComponent(U.canvasId || \"default\")",
"        + \"/resources?slot=\" + encodeURIComponent(U.nodeId || \"\")",
"        + \"&name=\" + encodeURIComponent(withExt);",
"      return fetch(url, { method: \"POST\", headers: { \"content-type\": (bytes && bytes.type) || \"application/octet-stream\" }, body: bytes })",
"        .then(function(r){ return r.json(); })",
"        .then(function(j){ if (!j || !j.ok) throw new Error((j && j.error) || \"保存产物失败\"); return j.url; });",
"    },",
"  };",
"})();",
].join('\n')

/**
 * 把 sdk 模板变成最终正文：替换 CONTEXT_URL 占位符。
 * 双重保险：模板里不该再出现第二个占位符（有就一并替换）。
 */
export function renderSdkJs(contextFileUrl: string): string {
  return SDK_JS_TEMPLATE.split('__CONTEXT_URL__').join(contextFileUrl)
}
