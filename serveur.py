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
Le journal de séance (lib/session-log.js) s'écrit en ajout dans seances/ :
    POST /api/seances/<nom>.csv       ajoute le corps de la requête au fichier (créé au besoin), 1 Mo au plus par requête
Pont Bluetooth facultatif (tools/pont_ble.py ; `python serveur.py --pont [ADRESSE | simule]`, exige `pip install bleak`) :
    GET /api/pont/etat                {"disponible": true | false}
    GET /api/pont                     flux SSE : état du casque et notifications BLE brutes (format : tools/pont_ble.py)
Sécurité : écoute seulement 127.0.0.1, chemins confinés à echantillons/ et seances/, écriture et pont refusés depuis une autre
origine ou sous un autre nom d'hôte que localhost / 127.0.0.1 (anti « DNS rebinding »).
"""
import argparse, http.server, json, os, queue, re, sys, urllib.parse, webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(ROOT, "echantillons")
API = "/api/echantillons"
PROFILES = os.path.join(ROOT, "profils", "profils.json")
PROFILES_API = "/api/profils"
SESSIONS = os.path.join(ROOT, "seances")
SESSIONS_API = "/api/seances/"
SESSION_NAME = re.compile(r"^[A-Za-z0-9._-]+\.csv$")
MAX_APPEND = 1_000_000
PONT = None  # Pont de tools/pont_ble.py quand le serveur est lancé avec --pont


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

    def _same_origin(self):
        """Hôte localhost / 127.0.0.1 et, si présente, origine = ce serveur (refuse une page tierce et le DNS rebinding)."""
        host = self.headers.get("Host", "")
        if host.rsplit(":", 1)[0] not in ("localhost", "127.0.0.1"):
            return False
        origin = self.headers.get("Origin")
        return not origin or origin == f"http://{host}"

    def _is_profiles(self):
        return urllib.parse.urlsplit(self.path).path == PROFILES_API

    def _pont(self):
        if urllib.parse.urlsplit(self.path).path == "/api/pont/etat":
            return self._send(200, json.dumps({"disponible": PONT is not None}).encode())
        if PONT is None or not self._same_origin():
            return self._send(404, b'{"erreur": "pont indisponible"}')
        q = PONT.abonner()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            while True:
                try:
                    self.wfile.write(b"data: " + q.get(timeout=15).encode() + b"\n\n")
                except queue.Empty:
                    self.wfile.write(b": ouvert\n\n")  # garde la liaison vivante
                self.wfile.flush()
        except OSError:  # navigateur parti (BrokenPipe, ConnectionReset…)
            pass
        finally:
            PONT.desabonner(q)

    def do_POST(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        name = path[len(SESSIONS_API):] if path.startswith(SESSIONS_API) else ""
        size = int(self.headers.get("Content-Length") or 0)
        if not SESSION_NAME.match(name) or not self._same_origin() or size > MAX_APPEND:
            return self._send(403, b'{"erreur": "refus"}')
        data = self.rfile.read(size)
        os.makedirs(SESSIONS, exist_ok=True)
        with open(os.path.join(SESSIONS, name), "ab") as f:
            f.write(data)
        self._send(200, b'{"ok": true}')

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path.startswith("/api/pont"):
            return self._pont()
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
        profiles = self._is_profiles()
        if (target is None and not profiles) or target == SAMPLES or not self._same_origin():
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
    p.add_argument("--pont", nargs="?", const="auto", metavar="ADRESSE|simule",
                   help="pilote le casque avec bleak : adresse MAC, « auto » (1er Muse trouvé, défaut) ou « simule » (faux casque)")
    args = p.parse_args()
    if args.pont:
        global PONT
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import pont_ble
        PONT = pont_ble.PontSimule() if args.pont == "simule" else pont_ble.Pont(None if args.pont == "auto" else args.pont)
        PONT.demarrer()
    os.makedirs(SAMPLES, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True  # les flux SSE du pont ne doivent pas empêcher l'arrêt
    url = f"http://localhost:{args.port}/"
    print(f"Muse 2 Lab : {url}\nÉchantillons écrits dans : {SAMPLES}\nJournaux de séance dans : {SESSIONS}")
    if PONT:
        print("Pont Bluetooth actif : bouton « Connecter via Python » dans l'application")
    print("(Ctrl+C pour arrêter)")
    if not args.sans_navigateur:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
