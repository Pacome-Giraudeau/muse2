"""Capture d'écran (et évaluation JavaScript facultative) d'une page de l'application, dans Chrome sans interface,
en TEMPS RÉEL (protocole DevTools) : les animations, IndexedDB et les minuteries fonctionnent normalement.

Usage :
  python tools/shot.py "#/p/etude" sortie.png                       # route de l'application
  python tools/shot.py docs/science.html#sim-eye sortie.png --size 1000x600
  python tools/shot.py "#/p/live" sortie.png --wait 4 --js "document.querySelector('h1').textContent"
Le résultat du --js (attendu s'il s'agit d'une promesse) est affiché. Écrire la capture hors du dépôt (dossier temporaire).
"""
import argparse, base64, json, os, socket, struct, subprocess, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = next((c for c in [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                           r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"] if os.path.exists(c)), "google-chrome")


def to_url(target):
    if target.startswith(("file:", "http:", "https:")):
        return target
    path, _, frag = (("index.html" + target) if target.startswith("#") else target).partition("#")
    full = os.path.join(ROOT, path).replace("\\", "/")
    return f"file:///{full.lstrip('/')}" + (f"#{frag}" if frag else "")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("target"); ap.add_argument("out")
    ap.add_argument("--wait", type=float, default=3); ap.add_argument("--size", default="1200x900"); ap.add_argument("--js")
    a = ap.parse_args()
    w, h = a.size.split("x")
    port = 9340
    p = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
                          f"--remote-debugging-port={port}", f"--window-size={w},{h}", to_url(a.target)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json")); break
            except Exception:
                time.sleep(0.2)
        ws = [t for t in tabs if t.get("type") == "page"][0]["webSocketDebuggerUrl"]
        host, path = ws[len("ws://"):].split("/", 1)
        s = socket.create_connection(tuple([host.split(":")[0], int(host.split(":")[1])]))
        s.send(f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {base64.b64encode(os.urandom(16)).decode()}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += s.recv(4096)

        def send(obj):
            data, mask = json.dumps(obj).encode(), os.urandom(4)
            n = len(data)
            hdr = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536
                                   else bytes([0x80 | 127]) + struct.pack(">Q", n))
            s.send(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

        def rd(n):
            o = b""
            while len(o) < n:
                o += s.recv(n - len(o))
            return o

        def call(i, method, params=None):
            send({"id": i, "method": method, "params": params or {}})
            while True:
                _, b2 = rd(2); n = b2 & 0x7F
                n = struct.unpack(">H", rd(2))[0] if n == 126 else struct.unpack(">Q", rd(8))[0] if n == 127 else n
                m = json.loads(rd(n))
                if m.get("id") == i:
                    return m

        time.sleep(a.wait)
        if a.js:
            r = call(1, "Runtime.evaluate", {"expression": a.js, "returnByValue": True, "awaitPromise": True})
            res = r.get("result", {})
            print("js:", res.get("exceptionDetails", {}).get("exception", {}).get("description") or res.get("result", {}).get("value"))
            time.sleep(1.0)
        m = call(2, "Page.captureScreenshot", {"format": "png"})
        open(a.out, "wb").write(base64.b64decode(m["result"]["data"]))
        print("capture :", a.out)
    finally:
        p.kill()


if __name__ == "__main__":
    main()
