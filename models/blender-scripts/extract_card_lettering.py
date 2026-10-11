import json
import os
import re

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import OverlapMode, instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FONT = os.path.join(ROOT, "node_modules", "@fontsource-variable", "newsreader", "files", "newsreader-latin-opsz-normal.woff2")
AXES = {"wght": 700, "opsz": 72}
DESIGN = json.load(open(os.path.join(ROOT, "src", "landing", "array", "card-design.json")))

TEXT = "NAIMAKES FORUM."


def kerning(font, cmap, left, right):
    gpos = font["GPOS"].table
    indices = {i for record in gpos.FeatureList.FeatureRecord if record.FeatureTag == "kern"
               for i in record.Feature.LookupListIndex}
    a, b = cmap[ord(left)], cmap[ord(right)]
    for index in sorted(indices):
        for table in gpos.LookupList.Lookup[index].SubTable:
            if table.LookupType == 9:
                table = table.ExtSubTable
            if a not in table.Coverage.glyphs:
                continue
            if table.Format == 1:
                for record in table.PairSet[table.Coverage.glyphs.index(a)].PairValueRecord:
                    if record.SecondGlyph == b:
                        return getattr(record.Value1, "XAdvance", 0) or 0
            else:
                c1, c2 = table.ClassDef1.classDefs.get(a, 0), table.ClassDef2.classDefs.get(b, 0)
                return getattr(table.Class1Record[c1].Class2Record[c2].Value1, "XAdvance", 0) or 0
    return 0


def outer_first(d):
    contours = ["M" + part for part in d.split("M") if part.strip()]

    def extent(contour):
        numbers = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", contour)]
        xs, ys = numbers[0::2], numbers[1::2]
        return (max(xs) - min(xs)) * (max(ys) - min(ys))

    return "".join(sorted(contours, key=extent, reverse=True))


def main():
    L = DESIGN["lettering"]
    font = instantiateVariableFont(TTFont(FONT), AXES, overlap=OverlapMode.REMOVE)
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    upem = font["head"].unitsPerEm
    size = L["cap"] * upem / font["OS/2"].sCapHeight
    s = size / upem
    advances = []
    for i, ch in enumerate(TEXT):
        advance = font["hmtx"][cmap[ord(ch)]][0]
        if i + 1 < len(TEXT):
            advance += kerning(font, cmap, ch, TEXT[i + 1])
        advances.append(advance)
    stretch = L["length"] / (sum(advances) * s)
    out = []
    pen_x = 0.0
    for ch, advance in zip(TEXT, advances):
        name = cmap[ord(ch)]
        if ch != " ":
            svg = SVGPathPen(glyphs)
            a, b = s * stretch, s
            pen = TransformPen(svg, (0, a, b, 0, L["x"] + (L["height"] - L["cap"]) / 2, L["y"] + pen_x * s * stretch))
            glyphs[name].draw(pen)
            out.append({"char": ch, "d": outer_first(svg.getCommands())})
        pen_x += advance
    json.dump({
        "text": TEXT, "size": round(size, 3), "stretch": round(stretch, 6), "capHeight": round(font["OS/2"].sCapHeight * s, 3),
        "glyphs": out,
    }, open(os.path.join(HERE, "card-lettering.json"), "w"), ensure_ascii=False, indent=1)
    print(f"stretch {stretch:.4f}, {len(out)} glyphs")


if __name__ == "__main__":
    main()
