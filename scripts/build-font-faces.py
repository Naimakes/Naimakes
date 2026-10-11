import os
import re

from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT_DIR = os.path.join(ROOT, "src", "typography")
FONT_DIR = os.path.join(OUT_DIR, "fonts")
OUT = os.path.join(OUT_DIR, "font-faces.css")
SOURCES = [
    "@fontsource-variable/newsreader/opsz.css",
    "@fontsource-variable/noto-serif-sc/wght.css",
]
ASCENT, DESCENT = 0.98, 0.22
USE_TYPO_METRICS = 1 << 7


def bake_metrics(src, dst):
    font = TTFont(src)
    upm = font["head"].unitsPerEm
    ascent, descent = round(ASCENT * upm), round(DESCENT * upm)
    hhea, os2 = font["hhea"], font["OS/2"]
    hhea.ascent, hhea.descent, hhea.lineGap = ascent, -descent, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascent, -descent, 0
    os2.usWinAscent, os2.usWinDescent = ascent, descent
    os2.fsSelection |= USE_TYPO_METRICS
    font.save(dst)


def main():
    os.makedirs(FONT_DIR, exist_ok=True)
    for name in os.listdir(FONT_DIR):
        os.remove(os.path.join(FONT_DIR, name))
    faces = []
    for source in SOURCES:
        path = os.path.join(ROOT, "node_modules", source)
        css = open(path, encoding="utf8").read()
        css = re.sub(r"/\*[^*]*\*/", "", css)
        for name in sorted(set(re.findall(r"url\(\./files/([^)]+\.woff2)\)", css))):
            bake_metrics(os.path.join(os.path.dirname(path), "files", name), os.path.join(FONT_DIR, name))
        css = css.replace("url(./files/", "url(./fonts/")
        faces.append(re.sub(r"\n{2,}", "\n", css).strip())
    open(OUT, "w", encoding="utf8").write("\n".join(faces) + "\n")
    print(f"{len(os.listdir(FONT_DIR))} fonts, {sum(f.count('@font-face') for f in faces)} faces -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
