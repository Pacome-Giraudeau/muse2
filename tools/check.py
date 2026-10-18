"""Vérification complète en une commande : mêmes <script src="lib/…"> (et même ordre) dans index.html et
tests/index.html + tests (tests/run_tests.py) + chargement de chaque page de l'application
(accueil, chaque projet du catalogue, chaque page de doc, chaque page Développement et chaque rapport) en recherchant les erreurs JavaScript dans la console.

Usage : python tools/check.py            (code de sortie 0 si tout va bien)
        python tools/check.py --pages    (seulement les pages, sans les tests)
Sortie courte : le détail n'est affiché qu'en cas de problème.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = next((c for c in [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                           r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"] if os.path.exists(c)), "google-chrome")


def routes():
    cat = open(os.path.join(ROOT, "app", "catalogue.js"), encoding="utf-8").read()
    projects = re.findall(r"id: '([\w-]+)',\s*\n\s*titre:", cat.split("docs:")[0])
    docs = re.findall(r"page: '([^']+)'", cat)
    dev = re.findall(r"id: '([\w-]+)',", cat.split("dev:")[1])  # pages Développement + rapports
    return ["index.html"] + [f"index.html#/p/{p}" for p in projects] + docs + [f"index.html#/dev/{d}" for d in dev]


def lib_scripts(path, prefix):
    """Liste ordonnée des briques lib/ chargées par une page (<script src="…lib/x.js">), commentaires HTML exclus."""
    html = re.sub(r"<!--.*?-->", "", open(os.path.join(ROOT, path), encoding="utf-8").read(), flags=re.S)
    return re.findall(r'<script[^>]*\ssrc="' + re.escape(prefix) + r'(lib/[^"]+)"', html)


def lib_order_errors():
    """index.html et tests/index.html doivent charger les mêmes fichiers lib/, dans le même ordre."""
    app, tests = lib_scripts("index.html", ""), lib_scripts(os.path.join("tests", "index.html"), "../")
    if app == tests:
        return []
    errs = [f"absent de tests/index.html : {f}" for f in app if f not in tests]
    errs += [f"absent de index.html : {f}" for f in tests if f not in app]
    if not errs:
        i = next((k for k, (a, b) in enumerate(zip(app, tests)) if a != b), None)
        errs.append(f"ordre différent à la position {i + 1} : index.html a {app[i]}, tests/index.html a {tests[i]}" if i is not None
                    else f"nombre différent ({len(app)} contre {len(tests)}) : fichier chargé deux fois ?")
    return errs


def page_errors(path):
    url = "file:///" + os.path.join(ROOT, path.split("#")[0]).replace("\\", "/").lstrip("/") + ("#" + path.split("#")[1] if "#" in path else "")
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--enable-logging=stderr",
                        "--v=0", "--virtual-time-budget=3000", "--dump-dom", url], capture_output=True, timeout=60)
    log = r.stderr.decode("utf-8", "replace")
    return [l.split('"')[1] if '"' in l else l for l in log.splitlines() if "CONSOLE" in l and ("rror" in l)]


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ok = True
    order = lib_order_errors()
    print("Scripts lib/ : index.html et tests/index.html identiques" if not order
          else "Scripts lib/ : ÉCHEC, index.html et tests/index.html diffèrent")
    for e in order:
        print("  ", e)
    ok &= not order
    if "--pages" not in sys.argv:
        r = subprocess.run([sys.executable, os.path.join(ROOT, "tests", "run_tests.py")], capture_output=True)
        out = r.stdout.decode("utf-8", "replace")
        passed = out.count("PASS ")
        fails = [l for l in out.splitlines() if l.startswith("FAIL") or "exception" in l]
        print(f"Tests : {passed} réussis" + ("" if r.returncode == 0 else f", ÉCHEC ({len(fails)})"))
        for l in fails:
            print("  ", l)
        if r.returncode != 0 and not fails:
            print(out[-800:])
        ok &= r.returncode == 0
    bad = 0
    for p in routes():
        errs = page_errors(p)
        if errs:
            bad += 1
            print(f"Page {p} : {len(errs)} erreur(s)")
            for e in errs[:3]:
                print("   ", e)
    print(f"Pages : {len(routes()) - bad}/{len(routes())} sans erreur")
    ok &= bad == 0
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
