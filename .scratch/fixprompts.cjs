const BASE = 'http://127.0.0.1:8865';
(async () => {
  const cur = await (await fetch(BASE + '/api/agent/prompts')).json();
  const prompts = cur.prompts || [];
  // 丢掉两条内置（general / script）：PUT 回去时后端会用**新的** DEFAULT_PROMPTS 重新补上，
  // 于是内置提示词更新为新版；用户自建的一个不动。
  const keep = prompts.filter(p => p.id !== 'general' && p.id !== 'script');
  const res = await fetch(BASE + '/api/agent/prompts', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompts: keep }),
  });
  const out = await res.json();
  for (const p of out.prompts || []) {
    console.log(p.id, '|', p.name, '| len=' + p.text.length, '| canvasId=' + /canvasId/.test(p.text) + ' | edges=' + /canvas_batch_edges/.test(p.text));
  }
})();
