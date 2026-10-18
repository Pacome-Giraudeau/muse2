"""Ajoute une ligne datée (aujourd'hui) au journal des évolutions de docs/technique.html, sans ouvrir le fichier.

Usage : python tools/journal.py "Projet « X » : description courte ; N tests."
Le texte peut contenir du HTML simple (<code>…</code>).
"""
import datetime, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    path = os.path.join(ROOT, "docs", "technique.html")
    s = open(path, encoding="utf-8").read()
    k = s.index("</table>", s.index('id="journal"'))
    row = f"  <tr><td>{datetime.date.today().isoformat()}</td><td>{sys.argv[1]}</td></tr>\n"
    open(path, "w", encoding="utf-8").write(s[:k] + row + s[k:])
    print("Journal :", row.strip())


if __name__ == "__main__":
    main()
