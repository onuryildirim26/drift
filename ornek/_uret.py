# -*- coding: utf-8 -*-
"""Drift sample pairs.

Every pair is generated here, so the ground truth printed on the examples page
is exact rather than estimated. Each scene is drawn once, then the "after"
frame is produced by a known transform plus a deliberate change, so the tool
has both something to measure and something to find.

  %LOCALAPPDATA%\\Python\\pythoncore-3.14-64\\python.exe ornek/_uret.py

Nothing here is a photograph: the scenes are synthetic, which keeps the
repository free of any licensing or privacy question.
"""
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

K = os.path.dirname(os.path.abspath(__file__))
W, H = 640, 480


def grain(img, amount=5, seed=0):
    """A little sensor noise, so the pairs are not trivially identical."""
    rnd = random.Random(seed)
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b = px[x, y]
            n = rnd.randint(-amount, amount)
            px[x, y] = (max(0, min(255, r + n)),
                        max(0, min(255, g + n)),
                        max(0, min(255, b + n)))
    return img


def transform(img, dx=0, dy=0, angle=0.0, scale=1.0, bg=(28, 32, 38)):
    """Shift, rotate and scale about the centre; empty area gets `bg`."""
    out = img
    if angle or scale != 1.0:
        out = out.rotate(angle, resample=Image.BICUBIC, fillcolor=bg)
        if scale != 1.0:
            nw, nh = int(round(W * scale)), int(round(H * scale))
            big = out.resize((nw, nh), Image.BICUBIC)
            canvas = Image.new("RGB", (W, H), bg)
            canvas.paste(big, ((W - nw) // 2, (H - nh) // 2))
            out = canvas
    if dx or dy:
        canvas = Image.new("RGB", (W, H), bg)
        canvas.paste(out, (dx, dy))
        out = canvas
    return out


# --------------------------------------------------------------------------
# 1 · Car park seen from above. One car arrives.
# --------------------------------------------------------------------------
def carpark():
    img = Image.new("RGB", (W, H), (58, 60, 63))
    d = ImageDraw.Draw(img)
    rnd = random.Random(4)
    for y in range(0, H, 14):                       # asphalt texture
        d.line([(0, y), (W, y)], fill=(54, 56, 59), width=1)
    bays = []
    for row, top in enumerate((70, 250)):
        for i in range(10):
            x = 40 + i * 57
            d.rectangle([x, top, x + 50, top + 110], outline=(206, 208, 198), width=2)
            bays.append((x, top))
    d.rectangle([0, 190, W, 236], fill=(50, 52, 55))
    for x in range(10, W, 46):                       # lane dashes
        d.line([(x, 213), (x + 24, 213)], fill=(214, 200, 120), width=3)

    colours = [(176, 58, 54), (48, 86, 142), (221, 221, 214), (40, 44, 50),
               (92, 120, 96), (190, 150, 60)]
    occupied = rnd.sample(bays, 13)
    for (x, top) in occupied:
        c = colours[rnd.randrange(len(colours))]
        d.rounded_rectangle([x + 7, top + 12, x + 43, top + 98], 7, fill=c)
        d.rounded_rectangle([x + 12, top + 26, x + 38, top + 52], 4,
                            fill=tuple(int(v * .55) for v in c))
    free = [b for b in bays if b not in occupied]
    img = grain(img, 4, 1)

    after = transform(img, dx=23, dy=11)
    d2 = ImageDraw.Draw(after)
    x, top = free[3]                                 # the arriving car
    x, top = x + 23, top + 11
    d2.rounded_rectangle([x + 7, top + 12, x + 43, top + 98], 7, fill=(214, 196, 60))
    d2.rounded_rectangle([x + 12, top + 26, x + 38, top + 52], 4, fill=(120, 110, 36))
    return img, grain(after, 4, 2), dict(dx=23, dy=11, angle=0, scale=1,
                                         change="one car parked in an empty bay")


# --------------------------------------------------------------------------
# 2 · Circuit board. A component is missing.
# --------------------------------------------------------------------------
def board():
    img = Image.new("RGB", (W, H), (22, 72, 52))
    d = ImageDraw.Draw(img)
    rnd = random.Random(11)
    for i in range(70):                              # traces
        x0, y0 = rnd.randrange(W), rnd.randrange(H)
        x1 = x0 + rnd.choice((-1, 1)) * rnd.randrange(40, 150)
        d.line([(x0, y0), (x1, y0)], fill=(196, 170, 70), width=2)
        d.line([(x1, y0), (x1, y0 + rnd.choice((-1, 1)) * rnd.randrange(30, 110))],
               fill=(196, 170, 70), width=2)
    for i in range(44):                              # pads
        x, y = rnd.randrange(16, W - 16), rnd.randrange(16, H - 16)
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(214, 196, 120))
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(26, 62, 48))
    chips = [(90, 90, 180, 170), (300, 70, 420, 140),
             (120, 280, 250, 360), (420, 260, 540, 330)]
    for (a, b, c2, dd) in chips:
        d.rounded_rectangle([a, b, c2, dd], 5, fill=(32, 34, 38))
        for px in range(a + 10, c2 - 6, 12):
            d.rectangle([px, b - 5, px + 6, b], fill=(186, 188, 192))
            d.rectangle([px, dd, px + 6, dd + 5], fill=(186, 188, 192))
        d.text((a + 10, b + 10), "IC", fill=(150, 154, 160))
    caps = [(470, 160), (505, 160), (260, 420), (300, 420)]
    for (x, y) in caps:
        d.rounded_rectangle([x - 11, y - 18, x + 11, y + 18], 4, fill=(70, 74, 82))
        d.rectangle([x - 11, y - 18, x - 5, y + 18], fill=(176, 178, 182))
    img = grain(img, 4, 3)

    after = transform(img, dx=-14, dy=7)
    d2 = ImageDraw.Draw(after)
    x, y = caps[0][0] - 14, caps[0][1] + 7           # the missing capacitor
    d2.rounded_rectangle([x - 13, y - 20, x + 13, y + 20], 4, fill=(24, 74, 54))
    for px in (x - 7, x + 7):
        d2.ellipse([px - 4, y - 4, px + 4, y + 4], fill=(214, 196, 120))
    return img, grain(after, 4, 4), dict(dx=-14, dy=7, angle=0, scale=1,
                                         change="one capacitor removed from the board")


# --------------------------------------------------------------------------
# 3 · A scanned page, fed in crooked. A stamp is added.
#
# Only the sheet turns; the scanner bed behind it does not. That is what a
# crooked feeder actually does, and it keeps the frame edge identical in both
# frames, so the rotation estimate is not fighting a discontinuity that has
# nothing to do with the page. The sheet is centred, which puts its own centre
# of rotation on the centre of the frame — the axis Drift measures about.
# --------------------------------------------------------------------------
PW, PH = 500, 400                                    # the sheet, centred in WxH


def page():
    rnd = random.Random(21)
    sheet = Image.new("RGBA", (PW, PH), (250, 249, 245, 255))
    d = ImageDraw.Draw(sheet)
    d.rectangle([0, 0, PW - 1, PH - 1], outline=(206, 203, 195))
    d.rectangle([34, 30, 250, 50], fill=(44, 48, 54))      # title
    d.rectangle([34, 62, 166, 74], fill=(128, 132, 138))   # subtitle
    y = 106
    while y < PH - 56:
        d.rectangle([34, y, 34 + rnd.randrange(150, PW - 80), y + 7],
                    fill=(76, 80, 86))
        y += 19
        if rnd.random() < 0.16:
            y += 14
    d.rectangle([34, PH - 42, 206, PH - 34], fill=(128, 132, 138))

    def bed():
        b = Image.new("RGB", (W, H), (48, 50, 55))         # scanner lid
        return b

    ox, oy = (W - PW) // 2, (H - PH) // 2
    before = bed()
    before.paste(sheet, (ox, oy), sheet)

    turned = sheet.rotate(-6.5, resample=Image.BICUBIC, expand=True)
    after = bed()
    after.paste(turned, ((W - turned.width) // 2, (H - turned.height) // 2), turned)
    d2 = ImageDraw.Draw(after)
    cx, cy = 430, 330                                      # the stamp
    d2.ellipse([cx - 58, cy - 40, cx + 58, cy + 40], outline=(168, 56, 58), width=4)
    d2.ellipse([cx - 48, cy - 31, cx + 48, cy + 31], outline=(168, 56, 58), width=2)
    d2.text((cx - 32, cy - 6), "APPROVED", fill=(168, 56, 58))

    return (grain(before, 3, 5), grain(after, 3, 6),
            dict(dx=0, dy=0, angle=-6.5, scale=1,
                 change="an APPROVED stamp added, page fed in crooked"))


# --------------------------------------------------------------------------
# 4 · Terrain from the air, photographed closer. A building appears.
# --------------------------------------------------------------------------
def terrain():
    img = Image.new("RGB", (W, H), (96, 104, 74))
    d = ImageDraw.Draw(img)
    rnd = random.Random(31)
    for i in range(240):                             # fields
        x, y = rnd.randrange(-60, W), rnd.randrange(-60, H)
        w, h = rnd.randrange(50, 150), rnd.randrange(40, 120)
        tone = rnd.choice([(108, 118, 78), (126, 128, 86), (88, 98, 66),
                           (142, 136, 96), (74, 90, 62)])
        d.rectangle([x, y, x + w, y + h], fill=tone)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    d = ImageDraw.Draw(img)
    d.line([(0, 300), (160, 285), (330, 318), (520, 296), (W, 310)],
           fill=(196, 190, 170), width=7)            # road
    d.line([(250, 0), (268, 160), (240, 330), (258, H)], fill=(78, 104, 128), width=11)  # river
    for i in range(16):                              # farm buildings
        x, y = rnd.randrange(30, W - 50), rnd.randrange(30, H - 50)
        d.rectangle([x, y, x + rnd.randrange(14, 26), y + rnd.randrange(12, 22)],
                    fill=(176, 170, 158))
    img = grain(img, 5, 7)

    # Shift first, then zoom — the same order the registration undoes them in,
    # so the stated offset is the one the tool reports. Applying the shift after
    # the zoom would be just as physical, but then 9 px of post-zoom offset
    # reads back as 9/1.18 = 7.6 px, which only muddies a teaching example.
    after = transform(transform(img, dx=9, dy=-6), scale=1.18)
    d2 = ImageDraw.Draw(after)
    d2.rectangle([360, 180, 452, 244], fill=(206, 202, 192), outline=(150, 146, 138), width=2)
    d2.rectangle([368, 188, 444, 236], fill=(188, 184, 174))
    d2.rectangle([398, 244, 418, 268], fill=(150, 146, 138))
    return img, grain(after, 5, 8), dict(dx=9, dy=-6, angle=0, scale=1.18,
                                         change="a new warehouse built beside the road")


SCENES = [
    ("otopark", "Car park from above", carpark,
     "A drone photographs the same car park twice. Between the frames the aircraft "
     "drifted, and one car arrived."),
    ("devre", "Circuit board inspection", board,
     "Two boards off the same line, photographed at slightly different positions. "
     "One of them is missing a part."),
    ("belge", "Scanned page", page,
     "The same page scanned twice. The second went through the feeder crooked, and "
     "someone stamped it in between."),
    ("arazi", "Aerial survey, one year apart", terrain,
     "A survey flight repeated a year later, lower and slightly off-track, so the "
     "whole frame is both shifted and larger."),
]


def main():
    index = []
    for slug, title, fn, blurb in SCENES:
        a, b, truth = fn()
        a.save(os.path.join(K, slug + "-a.png"), optimize=True)
        b.save(os.path.join(K, slug + "-b.png"), optimize=True)
        needs_rot = truth["angle"] != 0 or truth["scale"] != 1
        index.append({
            "slug": slug, "title": title, "blurb": blurb,
            "a": "ornek/%s-a.png" % slug, "b": "ornek/%s-b.png" % slug,
            "truth": truth, "rotation": needs_rot,
        })
        print("%-8s  dx=%+3d dy=%+3d  angle=%5.1f  scale=%.2f  | %s"
              % (slug, truth["dx"], truth["dy"], truth["angle"], truth["scale"],
                 truth["change"]))
    with open(os.path.join(K, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print("\nindex.json written with %d pairs" % len(index))


if __name__ == "__main__":
    main()
