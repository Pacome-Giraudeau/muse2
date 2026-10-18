"""Lance tests/index.html dans Chrome sans interface, en temps réel, et affiche le rapport.

Usage : python tests/run_tests.py            (code de sortie 0 si TOUT PASSE, 1 sinon)

Pourquoi ce script : le mode « temps virtuel » de Chrome sans interface (--virtual-time-budget) bloque IndexedDB,
donc les tests de persistance n'aboutiraient jamais. Ici Chrome tourne en temps réel et la page envoie son rapport
(?report=…) à un petit serveur local.
"""
import http.server, os, subprocess, sys, threading

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "chromium",
]
PORT = 8766
TIMEOUT_S = 60
report = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        report['text'] = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf-8')
        self.send_response(204)
        self.end_headers()
        threading.Thread(target=self.server.shutdown).start()

    def log_message(self, *args):
        pass


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # console Windows
    chrome = next((c for c in CHROME_CANDIDATES if os.path.exists(c) or not os.path.isabs(c)), None)
    page = os.path.abspath(os.path.join(os.path.dirname(__file__), 'index.html')).replace('\\', '/')
    url = f"file:///{page.lstrip('/')}?report=http://127.0.0.1:{PORT}/report"
    server = http.server.HTTPServer(('127.0.0.1', PORT), Handler)
    browser = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--allow-file-access-from-files',
                                '--remote-debugging-port=9334', url],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    timer = threading.Timer(TIMEOUT_S, server.shutdown)
    timer.start()
    server.serve_forever()
    timer.cancel()
    browser.kill()
    text = report.get('text')
    if text is None:
        print(f'Aucun rapport reçu en {TIMEOUT_S} s (erreur JavaScript ? ouvrir tests/index.html dans un navigateur).')
        return 1
    print(text)
    return 0 if 'TOUT PASSE' in text else 1


if __name__ == '__main__':
    sys.exit(main())
