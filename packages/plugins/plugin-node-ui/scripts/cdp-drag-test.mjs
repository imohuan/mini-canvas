const [, , wsUrl] = process.argv;
const ws = new WebSocket(wsUrl);
const fs = await import('node:fs');
let id = 0; const pending = new Map();
const call = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, (m) => r(m)); ws.send(JSON.stringify({ id: i, method, params })); });
const done = (msg) => { fs.writeFileSync('cdp-drag-test.txt', msg); process.exit(0); };
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
ws.onopen = async () => {
  try {
    // 1. 找一个输出端口的屏幕位置（用 evaluate 查第一个节点的 source handle）
    const r1 = await call('Runtime.evaluate', { expression: "(() => { const h = document.querySelector('.vue-flow__handle.source'); if (!h) return 'no-handle'; const r = h.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()", returnByValue: true });
    const pos = JSON.parse(r1.result?.result?.value ?? '{}');
    if (!pos.x) { done('no source handle found: ' + (r1.result?.result?.value ?? '')); return; }
    // 2. 模拟：按下 → 移动到空白（+400, +200）→ 松开
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 300));
    for (let i = 1; i <= 10; i++) {
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x + i * 40, y: pos.y + i * 20, button: 'left' });
      await new Promise(r => setTimeout(r, 50));
    }
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x + 400, y: pos.y + 200, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 1500));
    // 3. 检查临时菜单节点是否出现
    const r2 = await call('Runtime.evaluate', { expression: "JSON.stringify({menuNode: !!document.querySelector('[data-id*=connection-menu]'), anyMenu: !!document.querySelector('.ctx-menu'), nodes: document.querySelectorAll('.vue-flow__node').length})", returnByValue: true });
    done('TEST=' + (r2.result?.result?.value ?? 'no-value'));
  } catch (e) { done('ERR: ' + e.message); }
};
ws.onerror = () => done('WS_ERROR');
setTimeout(() => done('GLOBAL_TIMEOUT'), 60000);
