# 重启 cloud-server（8865）：先释放端口，再后台起，最后探一次 /health
$PORT = 8865
$WORK = 'D:\Code\Git\mini-canvas\packages\cloud-server'

$conns = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
}

Start-Process -FilePath 'node' -ArgumentList './dist/cli.js', 'serve' -WorkingDirectory $WORK -WindowStyle Hidden
Start-Sleep -Seconds 4

try {
  (Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/health" -UseBasicParsing).Content
} catch {
  'health failed: ' + $_.Exception.Message
}
