"""Lance Muse 2 Lab sur http://localhost:8000 et écrit les échantillons dans muse2/echantillons, sans rien demander.

    python serveur.py                 # sert l'application et ouvre le navigateur
    python serveur.py --port 8001 --sans-navigateur

Un navigateur ne peut pas écrire seul dans un dossier précis ; ce serveur le fait à sa place (lib/server-dir.js) :
    GET /api/echantillons             {"dossier": chemin absolu}  (l'application détecte ainsi le serveur)
    GET /api/echantillons/<dossier>/  [{"name", "kind": "file" | "directory"}]  ou 404
    GET /api/echantillons/<fichier>   contenu du fichier  ou 404
    PUT /api/echantillons/<fichier>   écrit le fichier (dossiers créés au besoin)
Les profils (lib/profiles.js) sont aussi écrits sur disque, dans profils/profils.json :
    GET /api/profils                  {"<clé>": "<valeur JSON en texte>", …}  ({} au premier lancement)
    PUT /api/profils                  remplace tout le contenu (objet de chaînes, sinon 400)
Sécurité : écoute seulement 127.0.0.1, chemins confinés à echantillons/, écriture refusée depuis une autre origine.
"""
import argparse, http.server, json, os, urllib.parse, webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(ROOT, "echantillons")
API = "/api/echantillons"
PROFILES = os.path.join(ROOT, "profils", "profils.json")
PROFILES_API = "/api/profils"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _target(self):
        """Chemin disque demandé sous echantillons/, ou None (hors API ou hors du dossier)."""
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path != API and not path.startswith(API + "/"):
            return None
        full = os.path.normpath(os.path.join(SAMPLES, path[len(API):].lstrip("/")))
        return full if full == SAMPLES or full.startswith(SAMPLES + os.sep) else None

    def _send(self, code, body=b"", ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _is_profiles(self):
        return urllib.parse.urlsplit(self.path).path == PROFILES_API

    def do_GET(self):
        if self._is_profiles():
            if os.path.isfile(PROFILES):
                with open(PROFILES, "rb") as f:
                    return self._send(200, f.read())
            return self._send(200, b"{}")
        target = self._target()
        if target is None:
            return super().do_GET()
        if target == SAMPLES and not self.path.endswith("/"):
            return self._send(200, json.dumps({"dossier": SAMPLES}).encode())
        if os.path.isdir(target):
            items = [{"name": n, "kind": "directory" if os.path.isdir(os.path.join(target, n)) else "file"} for n in sorted(os.listdir(target))]
            return self._send(200, json.dumps(items, ensure_ascii=False).encode())
        if os.path.isfile(target):
            with open(target, "rb") as f:
                return self._send(200, f.read(), "application/octet-stream")
        self._send(404, b"[]")

    def _put_profiles(self, data):
        try:
            obj = json.loads(data)
            ok = isinstance(obj, dict) and all(isinstance(v, str) for v in obj.values())
        except ValueError:
            ok = False
        if not ok:
            return self._send(400, b'{"erreur": "profils invalides"}')
        os.makedirs(os.path.dirname(PROFILES), exist_ok=True)
        tmp = PROFILES + ".tmp"
        with open(tmp, "wb") as f:
            f.write(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True).encode())
        os.replace(tmp, PROFILES)  # écriture atomique : jamais de fichier à moitié écrit
        self._send(200, b'{"ok": true}')

    def do_PUT(self):
        target = self._target()
        origin = self.headers.get("Origin")
        profiles = self._is_profiles()
        if (target is None and not profiles) or target == SAMPLES or (origin and origin != f"http://{self.headers.get('Host')}"):
            return self._send(403, b'{"erreur": "refus"}')
        data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if profiles:
            return self._put_profiles(data)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(data)
        self._send(200, b'{"ok": true}')
        print("écrit :", os.path.relpath(target, ROOT), flush=True)

    def log_message(self, fmt, *args):
        pass  # seules les écritures réussies sont affichées


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--sans-navigateur", action="store_true")
    args = p.parse_args()
    os.makedirs(SAMPLES, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://localhost:{args.port}/"
    print(f"Muse 2 Lab : {url}\nÉchantillons écrits dans : {SAMPLES}\n(Ctrl+C pour arrêter)")
    if not args.sans_navigateur:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
