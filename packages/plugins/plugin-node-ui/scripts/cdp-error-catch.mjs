const ws = new WebSocket(process.argv[2]);
const fs = await import('node:fs');
let id = 0;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    fs.writeFileSync('cdp-error-catch.txt', (d.exception?.description || d.text || 'unknown').slice(0, 2000));
    process.exit(0);
  }
  if (m.id === 3) {
    // reload 完成，等错误出现
    setTimeout(() => { fs.writeFileSync('cdp-error-catch.txt', 'NO_ERROR_20S'); process.exit(0); }, 20000);
  }
};
ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }));
  ws.send(JSON.stringify({ id: 2, method: 'Page.enable', params: {} }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.reload', params: { ignoreCache: true } }));
};
ws.onerror = () => { fs.writeFileSync('cdp-error-catch.txt', 'WS_ERROR'); process.exit(1); };
setTimeout(() => { fs.writeFileSync('cdp-error-catch.txt', 'GLOBAL_TIMEOUT'); process.exit(1); }, 40000);
