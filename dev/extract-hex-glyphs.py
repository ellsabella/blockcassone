import json, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = os.path.expanduser('~/blockcassone/viewer/assets/NormiesFont.otf')
font = TTFont(FONT)
cmap = font.getBestCmap()
gs = font.getGlyphSet()

# Normalize each glyph into a 1000x1000 y-DOWN cell: scale the em to 0.78 of the cell,
# centre horizontally, sit the baseline at 850 (leaves headroom top + bottom). The Solidity
# side then just does translate(cellX,cellY) scale(cell/1000).
SF = 0.78
XINSET = round((1000 - 1000 * SF) / 2)   # 110
BASELINE = 850
paths = {}
total = 0
for ch in '0123456789ABCDEF':
    gname = cmap[ord(ch)]
    pen = SVGPathPen(gs, ntos=lambda v: str(round(v)))
    tpen = TransformPen(pen, (SF, 0, 0, -SF, XINSET, BASELINE))
    gs[gname].draw(tpen)
    d = pen.getCommands()
    paths[ch] = d
    total += len(d)
    print(f'{ch}: {len(d)} chars')

print(f'total={total}')
with open('/tmp/glyphs-norm.json', 'w') as f:
    json.dump(paths, f)

# Also emit a preview SVG (all 16 in a row) to eyeball.
cells = ''.join(
    f'<g transform="translate({i*60},0)"><rect width="50" height="50" fill="#111"/>'
    f'<g transform="scale(0.05)"><path d="{paths[ch]}" fill="#fff"/></g></g>'
    for i, ch in enumerate('0123456789ABCDEF'))
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 50">{cells}</svg>'
with open(os.path.expanduser('~/blockcassone/data/glyph-preview.svg'), 'w') as f:
    f.write(svg)
print('wrote /tmp/glyphs-norm.json + data/glyph-preview.svg')
