"""En-têtes des fichiers JS (leur API), pour ne pas lire le code.

Usage : python tools/entete.py lib                  (une ligne par fichier : première ligne de l'en-tête)
        python tools/entete.py lib/muse.js ui/x.js  (en-tête complet de chaque fichier)
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def header(path):
    """Premier bloc /* … */ du fichier, sans les astérisques de début de ligne."""
    m = re.match(r"\s*/\*(.*?)\*/", open(path, encoding="utf-8").read(), re.S)
    if not m:
        return ""
    return "\n".join(re.sub(r"^\s?\* ?", "", l) for l in m.group(1).strip("*\n").split("\n")).strip()


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    for arg in sys.argv[1:]:
        path = os.path.join(ROOT, arg)
        if os.path.isdir(path):
            for name in sorted(f for f in os.listdir(path) if f.endswith(".js")):
                print(f"{name:24} {(header(os.path.join(path, name)).split(chr(10)) or [''])[0]}")
        else:
            print(f"=== {arg}\n{header(path) or '(pas d’en-tête)'}\n")


if __name__ == "__main__":
    main()
