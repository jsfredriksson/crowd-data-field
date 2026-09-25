#!/usr/bin/env python3
"""
Build the app icon: a camera lens drawn entirely out of the field's own
vocabulary. Same tokens, same weights, same black-and-white rule as the app.

Needs ImageMagick (`brew install imagemagick`). Re-run after changing TOKENS.
    python3 make-icon.py
"""
import math, random, subprocess, sys

FONT = "/System/Library/Fonts/Menlo.ttc"   # swap for Maurten Mono when installed
ADV  = 0.6022                              # Menlo advance width / point size
SZ   = 1024                                # render size, downsampled for AA
R    = SZ / 2

# same vocabulary and weighting as TOKEN_SETS.metabolic in app.js
TOKENS = [("VO₂", 34), ("CO₂", 20), ("H⁺", 20), ("¹³C", 13), ("DLW", 13)]

FS     = 20      # type size at SZ
LEADK  = 1.06    # leading as a multiple of type size
GAP    = 0.22    # space between tokens, in ems
JITTER = 0.07    # opacity variance
BOLD   = 0.9     # stroke width — Menlo.ttc only exposes the regular cut

# lens geometry, as fractions of R. Outer edge stays inside 0.80 so the icon
# survives Android's maskable crop.
BARREL_OUT = 0.79
GAP_IN, GAP_OUT = 0.45, 0.59     # black ring between barrel and glass
PUPIL = 0.20                     # black centre

def lens(dx, dy):
    r = math.hypot(dx, dy)
    if r >= BARREL_OUT * R: return 0.0
    if GAP_IN * R <= r < GAP_OUT * R: return 0.0
    if r < PUPIL * R: return 0.0
    return 1.0

def main():
    cum, tot = [], 0
    for t, w in TOKENS:
        tot += w; cum.append((tot, t))
    def pick(u):
        x = u * tot
        for c, t in cum:
            if x < c: return t
        return cum[-1][1]

    random.seed(5)
    lead = FS * LEADK
    cx = cy = SZ / 2
    mvg = ['push graphic-context', 'font-family "Menlo"', 'font-size %g' % FS,
           'fill white', 'stroke white', 'stroke-width %g' % BOLD,
           'stroke-linejoin round']

    y = lead
    while y < SZ + lead:
        x = 0.0
        while x < SZ:
            tok = pick(random.random())
            w = len(tok) * ADV * FS
            if lens(x + w / 2 - cx, y - FS * 0.34 - cy) > 0:
                a = 1 - JITTER + JITTER * random.random()
                mvg.append('fill-opacity %.3f' % a)
                mvg.append('stroke-opacity %.3f' % a)
                mvg.append("text %.1f,%.1f '%s'" % (x, y, tok))
                x += w + ADV * FS * GAP
            else:
                x += ADV * FS * 2.2      # coarse strides through the black
        y += lead
    mvg.append('pop graphic-context')

    open('.icon.mvg', 'w').write("\n".join(mvg))
    for out, px in (("icon.png", 512), ("icon-180.png", 180), ("favicon.png", 64)):
        subprocess.run(['magick', '-size', '%dx%d' % (SZ, SZ), 'xc:black',
                        '-font', FONT, '-draw', '@.icon.mvg',
                        '-resize', '%dx%d' % (px, px), '-depth', '8', '-strip', out], check=True)
        print("wrote", out)
    import os; os.remove('.icon.mvg')

if __name__ == "__main__":
    sys.exit(main())
