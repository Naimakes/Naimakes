import json
import os

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import OverlapMode, instantiateVariableFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FONT = os.path.join(ROOT, "node_modules", "@fontsource-variable", "newsreader", "files", "newsreader-latin-opsz-normal.woff2")
OUT = os.path.join(ROOT, "src", "landing", "ui", "logo-lettering.json")
TEXT = "NAIMAKES"
LEFT, RIGHT, BASELINE, CAP = 15.0, 295.0, 174.0, 11.0


def main():
    font = instantiateVariableFont(TTFont(FONT), {"wght": 700, "opsz": 12}, overlap=OverlapMode.REMOVE)
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    s = CAP / font["OS/2"].sCapHeight
    names = [cmap[ord(ch)] for ch in TEXT]
    bounds = []
    for name in names:
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        bounds.append(pen.bounds)
    advances = [font["hmtx"][name][0] for name in names]
    ink = sum(advances[:-1]) - bounds[0][0] + bounds[-1][2]
    tracking = ((RIGHT - LEFT) / s - ink) / (len(TEXT) - 1)
    letters = []
    x = -bounds[0][0]
    for name, advance in zip(names, advances):
        svg = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        glyphs[name].draw(TransformPen(svg, (s, 0, 0, -s, LEFT + x * s, BASELINE)))
        letters.append(svg.getCommands())
        x += advance + tracking
    json.dump({"text": TEXT, "letters": letters}, open(OUT, "w"), separators=(",", ":"))
    print(f"tracking {tracking * s:.2f}")


if __name__ == "__main__":
    main()
