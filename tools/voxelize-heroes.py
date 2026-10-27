#!/usr/bin/env python3
"""Turn the website's pixel-art agents into cell grids for the castle game's heroes.

Reads layerfs-website/public/agents/*.png (read only) and writes
src/renderer/src/components/projects/history/game/hero-sprites.ts.

    python3 -I tools/voxelize-heroes.py [--agents DIR] [--out FILE] [--preview PNG]

The sprites are upscaled pixel art, but drawn by hand (or a model), so the big
"pixels" are not on an exact grid: a cell is about N real pixels and the lines
wander a little. So, per image:

1. Cell size N: the shortest common run of one colour (along rows and
   columns). Longer runs are 2, 3... cells, so the first real peak of the
   run-length histogram is one cell.
2. Edge profiles: for every column (and row) boundary, how much colour changes
   across it. Cell borders show up as peaks.
3. Cut lines: a near-regular grid of pitch N that bends to sit on those edges
   (dynamic programming; each cell 0.65..1.35 N). This follows the drift.
4. Each cell takes the most common colour of its inner pixels (empty when
   mostly transparent). The resample error (each pixel against its cell) is
   printed as a check.
5. Eyes are evened (a drawn eye straddling a grid line comes out ragged), and
   colours snap to a small per-hero palette.

Deterministic: same PNGs in, same file out.
"""
import argparse
import math
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
AGENTS = os.path.join(os.path.dirname(REPO), 'layerfs-website', 'public', 'agents')
OUT = os.path.join(REPO, 'src', 'renderer', 'src', 'components', 'projects', 'history', 'game', 'hero-sprites.ts')
CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

EDGE = 48  # colour change (premultiplied RGBA, summed) that counts as an edge
SOLID = 120  # mean alpha a cell needs to be filled
MERGE = 30  # palette snap distance (RGB)
STIFF = 0.15  # how much a cell pays for being off the nominal size


def load(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    raw = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
    # premultiplied, so transparent pixels all look alike
    px = [(r * a / 255, g * a / 255, b * a / 255, a) for r, g, b, a in raw]
    return px, w, h


def diff(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) + abs(a[3] - b[3])


def profiles(px, w, h):
    """Edge weight at each boundary: ex[i] is between column i-1 and i."""
    ex = [0.0] * (w + 1)
    ey = [0.0] * (h + 1)
    for y in range(h):
        row = y * w
        for x in range(1, w):
            d = diff(px[row + x - 1], px[row + x])
            if d > EDGE:
                ex[x] += d
    for y in range(1, h):
        a, b = (y - 1) * w, y * w
        s = 0.0
        for x in range(w):
            d = diff(px[a + x], px[b + x])
            if d > EDGE:
                s += d
        ey[y] = s
    return ex, ey


def runs(px, w, h):
    """How often each opaque run length (in px, along rows and columns) occurs."""
    hist = {}
    for axis in (0, 1):
        n, m = (w, h) if axis == 0 else (h, w)
        for j in range(0, m, 2):
            line = px[j * w:(j + 1) * w] if axis == 0 else px[j::w]
            start = 0
            for i in range(1, n + 1):
                if i == n or diff(line[i], line[i - 1]) > 60:
                    k = i - start
                    if k >= 6 and line[start][3] > 200:
                        hist[k] = hist.get(k, 0) + 1
                    start = i
    return hist


def pitch(hist):
    """The one-cell run: the shortest common run length between 12 and 32 px.

    Longer runs are 2, 3... cells, so the first real peak of the (smoothed)
    histogram is the cell. A peak counts when it has at least 35% of the
    tallest; a parabola through it gives a fractional size.
    """
    def smooth(p):
        return sum(hist.get(q, 0) * max(0.0, 1 - abs(q - p) / 2.5) for q in range(p - 3, p + 4))

    sm = {p: smooth(p) for p in range(11, 34)}
    top = max(sm[p] for p in range(12, 33))
    for p in range(13, 33):
        if sm[p] >= sm[p - 1] and sm[p] >= sm[p + 1] and sm[p] >= 0.35 * top:
            a, b, c = sm[p - 1], sm[p], sm[p + 1]
            d = a - 2 * b + c
            return p + (0.5 * (a - c) / d if d else 0.0)
    return 16.0


def extent(px, w, h, axis):
    """First and last filled column (axis 0) or row (axis 1), as boundaries."""
    n = w if axis == 0 else h
    filled = []
    for i in range(n):
        if axis == 0:
            a = max(px[y * w + i][3] for y in range(h))
        else:
            a = max(px[i * w + x][3] for x in range(w))
        filled.append(a > 128)
    lo = filled.index(True)
    hi = n - filled[::-1].index(True)
    return lo, hi


def cuts(prof, lo, hi, p, bend=STIFF):
    """Cell boundaries from lo to hi: a near-regular grid that snaps to edges.

    Dynamic programming over boundary positions: each cell is 0.65..1.35 p
    long, a boundary on an edge scores its (normalised) strength, and a cell
    off the nominal size pays bend * (relative error)^2. So the grid follows
    the drawing's drift without inventing thin cells at every stray edge.
    """
    top = max(prof) or 1
    # soft edges spread over a pixel or two: take the local max
    e = [max(prof[max(0, i - 1):i + 2]) / top for i in range(len(prof))]
    short, long_ = int(math.ceil(0.65 * p)), int(math.floor(1.35 * p))
    best = {lo: (0.0, None)}
    for i in range(lo + 1, hi + 1):
        here = None
        for k in range(short, long_ + 1):
            j = i - k
            if j < lo:
                break
            if j not in best:
                continue
            sc = best[j][0] + e[i] - bend * ((k - p) / p) ** 2
            if here is None or sc > here[0]:
                here = (sc, j)
        if here is not None:
            best[i] = here
    if hi not in best:  # too short for a whole cell: one cell
        return [lo, hi]
    out = [hi]
    while best[out[-1]][1] is not None:
        out.append(best[out[-1]][1])
    return out[::-1]


def sample(px, w, xs, ys):
    """Each cell's colour from its inner pixels: (r, g, b) or None when empty."""
    grid = []
    for y0, y1 in zip(ys, ys[1:]):
        row = []
        for x0, x1 in zip(xs, xs[1:]):
            mx, my = (x1 - x0) * 0.25, (y1 - y0) * 0.25
            ia, ib = int(math.ceil(x0 + mx)), int(math.floor(x1 - mx))
            ja, jb = int(math.ceil(y0 + my)), int(math.floor(y1 - my))
            ib, jb = max(ib, ia + 1), max(jb, ja + 1)
            pts = [px[j * w + i] for j in range(ja, jb) for i in range(ia, ib)]
            alpha = sum(p[3] for p in pts) / len(pts)
            if alpha < SOLID:
                row.append(None)
                continue
            # the most common colour (coarse bins), averaged inside its bin
            bins = {}
            for p in pts:
                if p[3] < 200:
                    continue
                a = p[3] / 255
                c = (p[0] / a, p[1] / a, p[2] / a)
                key = (int(c[0]) >> 4, int(c[1]) >> 4, int(c[2]) >> 4)
                bins.setdefault(key, []).append(c)
            if not bins:
                row.append(None)
                continue
            best = max(bins.items(), key=lambda kv: (len(kv[1]), kv[0]))[1]
            row.append(tuple(sum(c[k] for c in best) / len(best) for k in range(3)))
        grid.append(row)
    return grid


def error(px, w, h, xs, ys, grid):
    """Mean resample error: every pixel against its cell's colour."""
    tot = 0.0
    n = 0
    for cj, (y0, y1) in enumerate(zip(ys, ys[1:])):
        for ci, (x0, x1) in enumerate(zip(xs, xs[1:])):
            c = grid[cj][ci]
            ref = (0, 0, 0, 0) if c is None else (c[0], c[1], c[2], 255)
            for j in range(int(math.ceil(y0)), min(h, int(math.ceil(y1)))):
                for i in range(int(math.ceil(x0)), min(w, int(math.ceil(x1)))):
                    tot += diff(px[j * w + i], ref)
                    n += 1
    return tot / max(n, 1)


def trim(grid):
    """Drop empty border rows and columns."""
    while grid and all(c is None for c in grid[0]):
        grid = grid[1:]
    while grid and all(c is None for c in grid[-1]):
        grid = grid[:-1]
    while grid and all(r[0] is None for r in grid):
        grid = [r[1:] for r in grid]
    while grid and all(r[-1] is None for r in grid):
        grid = [r[:-1] for r in grid]
    return grid


def luma(c):
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def even_eyes(grid):
    """Give the eyes one shape.

    Where a drawn eye straddles a grid line it comes out a cell wider, taller or
    ragged next to its twin. Small dark blobs are eyes; each becomes the
    smallest neat rectangle among them, placed where it covers most of the
    blob. Trimmed cells take the colour around them.
    """
    h, w = len(grid), len(grid[0])
    seen = set()
    eyes = []
    for y in range(h):
        for x in range(w):
            c = grid[y][x]
            if c is None or (x, y) in seen or luma(c) > 70:
                continue
            blob, todo = [], [(x, y)]
            seen.add((x, y))
            while todo:
                cx, cy = todo.pop()
                blob.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen:
                        n = grid[ny][nx]
                        if n is not None and luma(n) <= 70:
                            seen.add((nx, ny))
                            todo.append((nx, ny))
            if len(blob) <= 12:
                xs, ys = [b[0] for b in blob], [b[1] for b in blob]
                eyes.append((min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1, blob))
    if len(eyes) < 2:
        return grid
    # the shape: the smallest eye drawn as a full rectangle (else the smallest)
    full = [e for e in eyes if len(e[4]) == e[2] * e[3]]
    tw, th = min(((e[2], e[3]) for e in (full or eyes)), key=lambda k: (k[0] * k[1], k))
    grid = [list(r) for r in grid]
    dark = min((grid[y][x] for e in eyes for x, y in e[4]), key=lambda c: (luma(c), c))
    for x0, y0, ew, eh, blob in eyes:
        if ew < tw or eh < th:
            continue
        cells = set(blob)
        # the target-sized rectangle in this eye's box that covers most of it
        bx, by = max(
            ((bx, by) for by in range(y0, y0 + eh - th + 1) for bx in range(x0, x0 + ew - tw + 1)),
            key=lambda b: (sum((x, y) in cells for x in range(b[0], b[0] + tw) for y in range(b[1], b[1] + th)), -b[1], -b[0]),
        )
        keep = {(x, y) for x in range(bx, bx + tw) for y in range(by, by + th)}
        for cx, cy in sorted(cells - keep):
            around = [grid[ny][nx] for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1))
                      if 0 <= nx < w and 0 <= ny < h and grid[ny][nx] is not None and luma(grid[ny][nx]) > 70]
            grid[cy][cx] = max(around, key=lambda c: (around.count(c), c)) if around else None
        for cx, cy in sorted(keep - cells):
            grid[cy][cx] = dark
    return grid


def palette(grid):
    """Snap cell colours to a few: greedy merge, most common first."""
    counts = {}
    for row in grid:
        for c in row:
            if c is not None:
                key = tuple(round(v) for v in c)
                counts[key] = counts.get(key, 0) + 1
    order = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    groups = []  # [sum r, sum g, sum b, count]
    for c, n in order:
        for g in groups:
            m = (g[0] / g[3], g[1] / g[3], g[2] / g[3])
            if math.dist(m, c) < MERGE:
                for k in range(3):
                    g[k] += c[k] * n
                g[3] += n
                break
        else:
            groups.append([c[0] * n, c[1] * n, c[2] * n, n])
    # means drift as groups grow: merge any that ended up close
    merged = True
    while merged:
        merged = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                a, b = groups[i], groups[j]
                if math.dist([a[k] / a[3] for k in range(3)], [b[k] / b[3] for k in range(3)]) < MERGE:
                    for k in range(4):
                        a[k] += b[k]
                    del groups[j]
                    merged = True
                    break
            if merged:
                break
    colours = [tuple(round(g[k] / g[3]) for k in range(3)) for g in groups]
    rows = []
    for row in grid:
        s = ''
        for c in row:
            if c is None:
                s += '.'
            else:
                k = min(range(len(colours)), key=lambda i: (math.dist(colours[i], c), i))
                s += CHARS[k]
        rows.append(s)
    return colours, rows


def voxelize(path):
    px, w, h = load(path)
    p = pitch(runs(px, w, h))
    ex, ey = profiles(px, w, h)
    xs = cuts(ex, *extent(px, w, h, 0), p)
    ys = cuts(ey, *extent(px, w, h, 1), p)
    grid = sample(px, w, xs, ys)
    err = error(px, w, h, xs, ys, grid)
    grid = even_eyes(trim(grid))
    colours, rows = palette(grid)
    return p, err, colours, rows


def write_ts(heroes, out):
    lines = [
        '// GENERATED by tools/voxelize-heroes.py from layerfs-website/public/agents/*.png.',
        '// Do not edit. Regenerate: python3 -I tools/voxelize-heroes.py',
        '//',
        "// One entry per hero: the sprite as cells. rows[0] is the top; '.' is empty,",
        '// any other char indexes palette (0-9, then a-z).',
        '',
        'export interface HeroSprite {',
        '  name: string',
        '  width: number',
        '  height: number',
        '  palette: number[]',
        '  rows: string[]',
        '}',
        '',
        'export const HERO_SPRITES: HeroSprite[] = [',
    ]
    for name, p, colours, rows in heroes:
        pal = ', '.join('0x%02x%02x%02x' % c for c in colours)
        lines.append('  {')
        lines.append(f"    name: '{name}', // cell {p:.1f} px")
        lines.append(f'    width: {len(rows[0])},')
        lines.append(f'    height: {len(rows)},')
        lines.append(f'    palette: [{pal}],')
        lines.append('    rows: [')
        for r in rows:
            lines.append(f"      '{r}',")
        lines.append('    ],')
        lines.append('  },')
    lines.append(']')
    with open(out, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def preview(heroes, agents, out):
    """Originals beside their cell grids, for checking by eye."""
    tiles = []
    for name, p, colours, rows in heroes:
        src = Image.open(os.path.join(agents, name + '.png')).convert('RGBA')
        s = round(p)
        cells = Image.new('RGBA', (len(rows[0]) * s, len(rows) * s), (255, 255, 255, 255))
        for j, r in enumerate(rows):
            for i, ch in enumerate(r):
                if ch != '.':
                    cells.paste(colours[CHARS.index(ch)] + (255,), (i * s, j * s, i * s + s - 1, j * s + s - 1))
        tiles.append((src, cells))
    W = max(a.size[0] + b.size[0] for a, b in tiles) + 30
    H = sum(max(a.size[1], b.size[1]) + 10 for a, b in tiles)
    sheet = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    y = 0
    for a, b in tiles:
        sheet.alpha_composite(a, (0, y))
        sheet.alpha_composite(b, (a.size[0] + 20, y))
        y += max(a.size[1], b.size[1]) + 10
    sheet.convert('RGB').save(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--agents', default=AGENTS)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--preview', help='also write a PNG of originals beside their cell grids')
    args = ap.parse_args()
    names = sorted(f[:-4] for f in os.listdir(args.agents) if f.endswith('.png'))
    heroes = []
    for name in names:
        p, err, colours, rows = voxelize(os.path.join(args.agents, name + '.png'))
        print(f'{name:8} cell {p:5.1f} px  {len(rows[0]):2}x{len(rows):<2} cells  {len(colours):2} colours  resample error {err:4.1f}', file=sys.stderr)
        heroes.append((name, p, colours, rows))
    write_ts(heroes, args.out)
    if args.preview:
        preview(heroes, args.agents, args.preview)


if __name__ == '__main__':
    main()
