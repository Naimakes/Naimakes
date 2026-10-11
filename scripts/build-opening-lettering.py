import json
import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FONT = os.path.join(ROOT, "node_modules", "@fontsource-variable", "newsreader", "files", "newsreader-latin-opsz-normal.woff2")
ART = os.path.join(ROOT, "src", "landing", "opening", "opening-lettering-art.json")
AXES = {"Normal": {"wght": 400, "opsz": 24}, "Bold": {"wght": 700, "opsz": 48}}
UNITS = 1000
BASELINE = 800
CAP_HEIGHT = 700


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


def build(weight, text):
    font = instantiateVariableFont(TTFont(FONT), AXES[weight])
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    upem = font["head"].unitsPerEm
    s = UNITS / upem * CAP_HEIGHT / (font["OS/2"].sCapHeight / upem * UNITS)
    letters = []
    for i, ch in enumerate(text):
        name = cmap[ord(ch)]
        advance = font["hmtx"][name][0]
        if i + 1 < len(text):
            advance += kerning(font, cmap, ch, text[i + 1])
        letter = {"width": round(advance * s / UNITS, 3)}
        if ch != " ":
            svg = SVGPathPen(glyphs, ntos=lambda v: f"{round(v):d}")
            glyphs[name].draw(TransformPen(svg, (s, 0, 0, -s, 0, BASELINE)))
            letter["path"] = svg.getCommands()
        letters.append(letter)
    return letters


def main():
    art = json.load(open(ART))
    for entry in art.values():
        entry["letters"] = build(entry["weight"], entry["text"])
    json.dump(art, open(ART, "w"), ensure_ascii=False, separators=(",", ":"))
    print({key: len(entry["letters"]) for key, entry in art.items()})


if __name__ == "__main__":
    main()
