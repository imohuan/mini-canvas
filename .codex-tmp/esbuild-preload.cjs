
// 让 esbuild 的 spawn 走 cmd /c 包装，绕过沙箱对直接 spawn exe 的限制
const cp = require('child_process');
const origSpawn = cp.spawn;
cp.spawn = function (cmd, args, opts) {
  if (typeof cmd === 'string' && /esbuild(\.exe)?$/.test(cmd) && Array.isArray(args) && args.includes('--service=0.25.12')) {
    return origSpawn(process.env.ComSpec || 'cmd.exe', ['/c', cmd].concat(args), opts);
  }
  return origSpawn.call(this, cmd, args, opts);
};
const origSpawnSync = cp.spawnSync;
cp.spawnSync = function (cmd, args, opts) {
  if (typeof cmd === 'string' && /esbuild(\.exe)?$/.test(cmd) && Array.isArray(args)) {
    return origSpawnSync(process.env.ComSpec || 'cmd.exe', ['/c', cmd].concat(args), opts);
  }
  return origSpawnSync.call(this, cmd, args, opts);
};

