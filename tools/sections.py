"""Plan d'une page de documentation : identifiant, titre et lignes de chaque section, pour ne lire que la partie utile.

Usage : python tools/sections.py docs/technique.html
        python tools/sections.py docs/science.html etat     (affiche seulement la section « etat », avec son texte)
        python tools/sections.py docs/science.html etat --brut   (HTML brut numéroté de la section, pour l'éditer)
"""
import html, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    brut = "--brut" in sys.argv
    args = [a for a in sys.argv if a != "--brut"]
    path = os.path.join(ROOT, args[1])
    lines = open(path, encoding="utf-8").read().split("\n")
    heads = [(i + 1, m.group(1), re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip())
             for i, l in enumerate(lines) for m in [re.search(r'<(?:h2|div class="part-head") id="([^"]+)">(.*?)(?:</h2>|$)', l)] if m]
    ends = [h[0] - 1 for h in heads[1:]] + [len(lines)]
    if len(args) > 2:
        for (start, sid, _), end in zip(heads, ends):
            if sid == args[2]:
                if brut:
                    print(f"{args[1]} lignes {start}-{end}")
                    print("\n".join(f"{n:5}| {l}" for n, l in enumerate(lines[start - 1:end], start)))
                    return
                text = re.sub(r"<[^>]+>", "", "\n".join(lines[start - 1:end]))
                print(f"{sys.argv[1]} lignes {start}-{end}\n" + html.unescape(re.sub(r"\n\s*\n+", "\n", text)))
                return
        print("Section introuvable :", args[2]); sys.exit(1)
    for (start, sid, title), end in zip(heads, ends):
        print(f"{start:5}-{end:<5} {sid:16} {html.unescape(title)}")


if __name__ == "__main__":
    main()
