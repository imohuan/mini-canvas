const [, , wsUrl] = process.argv;
const ws = new WebSocket(wsUrl);
const fs = await import('node:fs');
let id = 0; const pending = new Map();
const call = (method, params) => new Promise((r) => {
  const i = ++id; pending.set(i, r);
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); r({}); } }, 15000);
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const done = (msg) => { fs.writeFileSync('cdp-agent-test.txt', msg); process.exit(0); };
ws.onopen = async () => {
  try {
    // 1. 找「新建对话」按钮并点击
    await call('Runtime.evaluate', { expression: "(() => { const btn = [...document.querySelectorAll('button')].find(b => /新建对话/.test(b.textContent || '')); if (btn) { btn.click(); return 'ok'; } return 'no-btn'; })()", returnByValue: true });
    await new Promise(r => setTimeout(r, 2000));
    // 2. 在输入框输入文字（找 contenteditable）
    const inputRes = await call('Runtime.evaluate', { expression: "(() => { const ed = document.querySelector('.ProseMirror, [contenteditable=true]'); if (!ed) return 'no-editor'; ed.focus(); document.execCommand('insertText', false, 'test message'); return 'typed'; })()", returnByValue: true });
    await new Promise(r => setTimeout(r, 1000));
    // 3. 点发送按钮
    const sendRes = await call('Runtime.evaluate', { expression: "(() => { const btn = [...document.querySelectorAll('button')].find(b => /发送/.test(b.textContent || b.ariaLabel || '')); if (btn) { btn.click(); return 'sent'; } return 'no-send-btn'; })()", returnByValue: true });
    // 4. 等 10 秒让 AI 回复流跑起来，同时采样 CPU 由外部做
    await new Promise(r => setTimeout(r, 10000));
    done('input=' + inputRes.result?.result?.value + ' send=' + sendRes.result?.result?.value);
  } catch (e) { done('ERR: ' + e.message); }
};
ws.onerror = () => done('WS_ERROR');
setTimeout(() => done('GLOBAL_TIMEOUT'), 40000);
