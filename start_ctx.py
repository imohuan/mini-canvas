# -*- coding: utf-8 -*-
import subprocess, json, time, urllib.request, os, sys
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
userdata = r"D:\Code\Git\mini-canvas\.chrome-ctx"
args = ["--headless=new","--disable-gpu","--remote-debugging-port=9291",
        "--window-size=1500,950","--user-data-dir=" + userdata, "http://localhost:5288/"]
proc = subprocess.Popen([chrome]+args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
page=None
for _ in range(80):
    try:
        with urllib.request.urlopen("http://127.0.0.1:9291/json", timeout=2) as r:
            lst=json.loads(r.read())
        page=next((t for t in lst if t.get("type")=="page"),None)
        if page: break
    except Exception: pass
    time.sleep(0.5)
if not page:
    print("NO PAGE"); proc.kill(); sys.exit(1)
open(r"D:\Code\Git\mini-canvas\cdp_ctx.json","w").write(json.dumps({"ws": page["webSocketDebuggerUrl"]}))
print("READY")
