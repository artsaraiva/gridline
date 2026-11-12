"""Kaltenbach, the Skirmish slice map (#30). Headless Blender script; it is the map's source of truth
(ADR 0001, ADR 0002) and its outputs are committed.

A 960 m Hessian river valley across the inner German border in late autumn, built with the look-dev
generator from #23 (organic roads, field blocks turned against each other, woods patches, farmsteads,
a church village) and steered by the slice layout from #25 as revised on 2026-11-04: NATO HQ west and
Warsaw Pact HQ east at x = +-415, Capture Points 1-3-1 (A on the south-west hill, B sawmill, C bridge
square, D farmstead, E on the north-east hill), a 12 m river S-curve with 5 crossings, a village split
by the breached border wall. Positions of points, HQs, crossings, the boundary and the river match
under a 180 degree rotation about the map centre; the scenery around them is organic and not mirrored.

Run from the repo root (assets/maps/kaltenbach/bake.sh runs the full bake):
  blender -b --factory-startup -Y --python-exit-code 1 -P assets/maps/kaltenbach/build.py -- MODE [PREVIEW_RES] [SAMPLES]
  MODE play     map.json, 1 m data render, 8192 render, WebP mip chain, previews
       preview  everything play writes except the mips, at PREVIEW_RES (1024), into work/ for iterating
       outer    the low-detail surroundings out to 2.88 km, 2048 WebP
This file is the layout and the landmarks; what every map bake shares is in assets/maps/bake.py.
"""
import math
import os
import sys

import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True  # no __pycache__ beside the shared module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bake import (COVER_IDS, FOOT, HALFW, HELIPADS, MATS, MB, OUTER, ROAD_PTS, RS, SC, VEHICLE_SLOTS, Mat,  # noqa: E402
                  build_banks, build_crossings, build_hq, build_materials, build_poles, build_protos, build_roads,
                  build_terrain, build_woods, bump, disc_patch, farmstead, finish, flat_patch, free, gable, ground_z,
                  hedge_line, house, index_roads, log, make_obj, near_crossing, nz, on_road, plot_extras, put, r2,
                  rng, road_near, road_tangent, rot_from_dir, sstep, tree_at)

HALF = 480.0
EXT = 1440.0 if OUTER else HALF
RIVER_W = 12.0
TERRAIN_N = 513  # 1.9 m between vertices on the play bake
HEIGHT_CELL_M = 1

# ------------------------------------------------------------------ layout (#25 revised, #30)
# Metres, origin at map centre, x east, y north. Gameplay positions are listed for one half and turned
# 180 degrees for the other, so they match under rotation.
_HALF_AREA = [(456, -12), (452, 90), (460, 200), (447, 310), (438, 425), (330, 432), (200, 421), (80, 436),
              (-40, 428), (-150, 433), (-240, 420), (-330, 332), (-420, 243), (-452, 150), (-447, 40)]
PLAY_AREA = _HALF_AREA + [(-x, -y) for x, y in _HALF_AREA]  # cut corners north-west and south-east
HQS = {"nato": (-415.0, 0.0), "pact": (415.0, 0.0)}
HQ_RADIUS = 35.0
POINTS = [("A", -262.0, -322.0, "nato"), ("B", 0.0, 300.0, None), ("C", 0.0, 0.0, None), ("D", 0.0, -300.0, None),
          ("E", 262.0, 322.0, "pact")]
PT = {i: (x, y) for i, x, y, _ in POINTS}
POINT_RADIUS = 25.0
# #154: the jeep at every point but C, where the Simulation put it before vehicles were map data (the nearest drivable cell)
POINT_VEHICLES = {"A": [("jeep", -263, -325)], "B": [("jeep", -1, 307)], "D": [("jeep", 0, -300)], "E": [("jeep", 265, 321)]}
FORD_Y, FOOT_Y, FORD_HW, FOOT_HW, BRIDGE_HW = 345.0, 210.0, 6.5, 1.5, 4.0


def river_x(y):
    """An odd function of y, so the river matches itself under the rotation: north of the centre it runs
    east of the spine (B on NATO's bank), south of it west of the spine (D on the Warsaw Pact's)."""
    return 105 * math.sin(math.pi * y / 600) + 12 * math.sin(y / 37)


def river_dxdy(y):
    return 105 * math.pi / 600 * math.cos(math.pi * y / 600) + 12 / 37 * math.cos(y / 37)


CROSSINGS = [("NF", "ford", river_x(FORD_Y), FORD_Y, FORD_HW), ("NB", "footbridge", river_x(FOOT_Y), FOOT_Y, FOOT_HW),
             ("C", "bridge", 0.0, 0.0, BRIDGE_HW), ("SB", "footbridge", river_x(-FOOT_Y), -FOOT_Y, FOOT_HW),
             ("SF", "ford", river_x(-FORD_Y), -FORD_Y, FORD_HW)]


# ---------------------------------------------------------------- terrain math
def rdist(x, y):
    return abs(x - river_x(y)) / math.sqrt(1 + river_dxdy(y) ** 2)


def ground(x, y):
    """Valley rising ~19 m from the river toward each HQ edge, an overwatch hill under A and E, organic relief."""
    d = rdist(x, y)
    u = min(d / 380, 1.0)
    h = 0.8 + 19 * u * u * (3 - 2 * u)
    h += bump(x, y, *PT["A"], 125, 15) + bump(x, y, *PT["E"], 125, 15)
    h += sstep(10, 45, d) * (1.6 * nz(x, y, 130, 1.7) + 0.6 * nz(x, y, 45, 5.1))
    far = max(abs(x), abs(y))
    if far > HALF:  # rolling hills beyond the map
        h += 18 * sstep(HALF, HALF + 500, far) * (0.6 + nz(x, y, 520, 8.8))
    return max(h, 0.4)


def height(x, y):
    """Ground with the river channel cut in: 12 m of water, steep banks, shallow at the fords."""
    d = rdist(x, y)
    h = ground(x, y)
    if d >= 8.5:
        return h
    bed = -0.35 if any(k == "ford" and abs(y - cy) < FORD_HW for _, k, _, cy, _ in CROSSINGS) else -1.6
    return bed + (h - bed) * sstep(3.5, 8.5, d)


# ---------------------------------------------------------------------- roads
def _kolonne(y0, y1):
    """Kolonnenweg east of the fence, swinging round the B and D yards."""
    return [(6 + 2 * math.sin(y / 40) + 48 * math.exp(-((abs(y) - PT["B"][1]) / 42) ** 2), float(y))
            for y in np.arange(y0, y1 + 0.1, 2.0)]


_NF, _SF = river_x(FORD_Y), river_x(-FORD_Y)
ROADS = [
    ("main", [(-HALF - 12, -10), (-415, 0), (-340, 14), (-250, 32), (-160, 26), (-80, 10), (-30, 3), (0, 0), (35, -6),
              (90, -18), (160, -30), (240, -22), (330, -8), (415, 0), (HALF + 12, 12)]),
    ("kolonne", _kolonne(104, HALF + 12)), ("kolonne", _kolonne(-HALF - 12, -104)),
    # farm tracks from each HQ through its Lane's ford to the enemy's home-bank point
    ("track", [(-400, -25), (-360, -95), (-300, -160), (-235, -230), (-180, -300), (-140, -338), (_SF - 14, -346),
               (_SF + 14, -344), (-60, -338), (-25, -318), (-8, -300)]),
    ("track", [(400, 30), (372, 90), (330, 170), (270, 230), (200, 300), (150, 335), (_NF + 14, 344), (_NF - 14, 346),
               (55, 342), (25, 322), (8, 302)]),
    # country roads
    ("minor", [(-160, 26), (-185, 110), (-170, 200), (-120, 280), (-95, 380), (-80, HALF + 12)]),
    ("minor", [(160, -30), (200, -110), (255, -200), (320, -300), (370, -400), (400, -HALF - 12)]),
    # village streets
    ("minor", [(-80, 10), (-92, 60), (-110, 115), (-60, 150), (-22, 158)]),
    ("minor", [(-60, 7), (-85, -45), (-120, -95), (-170, -130)]),
    ("minor", [(115, -22), (112, 40), (100, 100), (112, 160)]),
    ("minor", [(70, -12), (85, -60), (112, -105), (150, -150)]),
    ("minor", [(-92, 60), (-55, 72), (-28, 96)]),
    ("minor", [(85, -60), (48, -76), (24, -98)]),
    # tracks at all angles
    ("track", [(-120, 280), (-60, 292), (-12, 300)]),
    ("track", [(-250, 32), (-280, 120), (-330, 230), (-360, 330), (-390, HALF + 12)]),
    ("track", [(-160, 26), (-210, -60), (-232, -140)]),
    ("track", [(-360, -95), (-420, -160), (-HALF - 12, -200)]),
    ("track", [(240, -22), (290, -90), (380, -120), (HALF + 12, -140)]),
    ("track", [(240, -22), (250, 70), (220, 150)]),
    ("track", [(200, -110), (120, -170), (60, -230), (22, -264)]),
    ("track", [(330, 170), (400, 230), (HALF + 12, 262)]),
    # tracks along the cut corners, just outside the Play Area
    ("track", [(-198, HALF + 12), (-262, 432), (-341, 345), (-430, 258), (-HALF - 12, 196)]),
    ("track", [(HALF + 12, -190), (420, -262), (338, -347), (268, -415), (205, -HALF - 12)]),
]


if OUTER:  # carry the roads that leave the map out to the edge of the surroundings
    def _extend(pts, end):
        a, b = (pts[-2], pts[-1]) if end else (pts[1], pts[0])
        if max(abs(b[0]), abs(b[1])) < HALF:
            return pts
        d = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        far = [(b[0] + d.x * k, b[1] + d.y * k + 50 * math.sin(k / 220)) for k in (300, 650, 1100)]
        return pts + far if end else far[::-1] + pts
    ROADS = [(k, _extend(_extend(p, True), False)) for k, p in ROADS if k != "kolonne"]
    ROADS += [("kolonne", _kolonne(104, EXT + 12)), ("kolonne", _kolonne(-EXT - 12, -104)),
              ("minor", [(-EXT - 12, -620), (-1050, -570), (-700, -450), (-500, -300)]),
              ("minor", [(EXT + 12, 640), (1080, 560), (760, 470), (600, 330)]),
              ("minor", [(-900, EXT + 12), (-840, 900), (-780, 300), (-810, -450), (-750, -EXT - 12)]),
              ("minor", [(930, -EXT - 12), (840, -750), (900, 0), (870, 750), (960, EXT + 12)])]
index_roads(ROADS)


# ----------------------------------------------------------------------- zones
VILLAGE = (0.0, 0.0, 125.0, 100.0)  # look-dev size, centred on the bridge square


def in_village(x, y, s=1.0):
    cx, cy, rx, ry = VILLAGE
    return ((x - cx) / (rx * s)) ** 2 + ((y - cy) / (ry * s)) ** 2 < 1 + 0.12 * nz(x, y, 40, 6.6)


def _strip(pts, r, step=22.0):
    """Blobs along a polyline: a wood strip."""
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        out += [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r) for k in range(n)]
    return out + [(*pts[-1], r)]


WOOD_BLOBS = [
    (-190, 345, 125), (-55, 405, 85), (-300, 235, 75), (-265, 400, 70),  # the north woodland Lane
    (38, 238, 45), (165, 190, 68), (245, 125, 52), (330, 95, 32),  # cover on both banks of the north footbridge
    (-400, 340, 55), (380, 160, 42), (-325, -55, 40), (170, -215, 48), (330, -335, 72), (-345, -425, 58),
    (-205, 95, 34), (290, -460, 45), (-440, -300, 40),
] + _strip([(-365, -168), (-290, -188), (-220, -200), (-150, -207), (-112, -211)], 23)  # NATO's to the south footbridge
if OUTER:
    WOOD_BLOBS += [(-1050, 450, 285), (-675, -1170, 315), (375, 1140, 300), (-1320, -675, 225), (1230, 1230, 225),
                   (1080, -480, 195), (90, -1080, 180), (-450, 975, 180), (1350, 375, 180), (-840, 780, 165)]


def woods_val(x, y):
    w = sum(math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (r * r)) for bx, by, r in WOOD_BLOBS if abs(x - bx) < 3 * r)
    return 0.9 * w + 0.35 * nz(x, y, 45, 2.2) + 0.2 * nz(x, y, 150, 4.1)


CLEAR = [(*HQS["nato"], 52), (*HQS["pact"], 52), (*PT["B"], 33), (*PT["D"], 46), (*PT["A"], 52), (*PT["E"], 52)]


def clearing(x, y):
    """Open ground kept free of woods and fields: HQs, the point zones, the hilltops."""
    return any((x - cx) ** 2 + (y - cy) ** 2 < r * r for cx, cy, r in CLEAR)


def meadow(x, y):
    """Each attacker's open approach to the ford in its Lane: grazing meadows, no hedges, no woods."""
    return (((x - 185) / 105) ** 2 + ((y - 372) / 58) ** 2 < 1 + 0.15 * nz(x, y, 30, 7.7)
            or ((x + 200) / 100) ** 2 + ((y + 368) / 56) ** 2 < 1 + 0.15 * nz(x, y, 30, 7.9))


def zone(x, y):
    if abs(x) > EXT + 4 or abs(y) > EXT + 4:
        return "out"
    d = rdist(x, y)
    if d < 6.5:
        return "water"
    if on_road(x, y, 1.0):
        return "road"
    inside = max(abs(x), abs(y)) <= HALF + 4
    if inside and in_village(x, y):
        return "village"
    if inside and clearing(x, y):
        return "clear"
    if abs(x) < 20:
        return "border"
    if d < 11:
        return "clear" if near_crossing(x, y, 6) else "bank"
    if inside and meadow(x, y):
        return "clear"
    if woods_val(x, y) > 0.48:
        return "woods"
    return "farm"


# ------------------------------------------------------------------ landmarks
def build_village():
    """Look-dev church village around the bridge square, split by the river and the breached border wall."""
    disc_patch("square_w", -14, 6, 17, "cobble", 0.12)
    disc_patch("square_e", 16, -8, 15, "cobble", 0.12)
    # breached border wall on the spine: panels with a pipe on top, gaps where it was blown
    mb = MB()
    for y0, y1 in ((14, 30), (37, 62), (69, 96)):
        for sg in (1, -1):
            for y in np.arange(y0, y1, 1.2):
                yy = sg * (y + 0.6)
                if on_road(0, yy, 0.5):
                    continue
                z = height(0, yy)
                mb.box(0, yy, z - 0.5, 0.25, 1.18, 4.0, "concrete")
                mb.cyl(0, yy, z + 3.5, 0.3, 0.05, "concrete", 6)
    mb.obj("border_wall", cover="wall")
    for y in (33.5, 65.5, -33.5, -65.5):  # rubble in the breaches
        for _ in range(6):
            put("grave", rng.uniform(-3, 3), y + rng.uniform(-2.5, 2.5), rng.uniform(0.8, 1.6))
    FOOT.extend([(0, y, 1.5) for y in np.arange(-100, 101, 3.0)])
    # church with churchyard on the west bank, look-dev size
    ccx, ccy, ang = -58.0, 42.0, 0.35
    mb = MB()
    gable(mb, 13, 30, 11, 52, "roof_slate")
    mb.box(0, -15 - 3.5, -2, 7.5, 7.5, 26, "stone")
    for (x0, y0), (x1, y1) in (((-4, -22.5), (4, -22.5)), ((4, -22.5), (4, -14.5)), ((4, -14.5), (-4, -14.5)),
                               ((-4, -14.5), (-4, -22.5))):
        mb.poly([(x0, y0, 24), (x1, y1, 24), (0, -18.5, 42)], "roof_slate")
    mb.cyl(0, 15, -2, 6.5, 12.5, "wall", 10, top_m="roof_slate")
    zmin, _ = ground_z(ccx, ccy, 13, 30, ang)
    mb.obj("church", (ccx, ccy, zmin), ang, "building")
    FOOT.append((ccx, ccy, 25))
    ca, sa = math.cos(ang), math.sin(ang)
    mb = MB()
    for (x0, y0), (x1, y1) in [((-20, -28), (20, -28)), ((20, -28), (20, 30)), ((20, 30), (-20, 30)), ((-20, 30), (-20, -28))]:
        L = math.hypot(x1 - x0, y1 - y0)
        mb.box((x0 + x1) / 2, (y0 + y1) / 2, -1.5, L if y0 == y1 else 0.5, 0.5 if y0 == y1 else L, 3.0, "stone")
    mb.obj("churchyard", (ccx, ccy, zmin), ang, "wall")
    for i in range(-6, 7):
        for j in range(-11, 12):
            lx, ly = i * 2.6, j * 2.4
            if abs(lx) < 9 and abs(ly) < 23 or rng.random() > 0.7:
                continue
            x, y = ccx + lx * ca - ly * sa, ccy + lx * sa + ly * ca
            SC["grave"].append((x, y, height(x, y), 1.0, ang))
    for lx, ly in [(-16, -24), (16, 26), (-16, 26), (16, -24)]:
        tree_at(ccx + lx * ca - ly * sa, ccy + lx * sa + ly * ca, "decid1", 1.1)
    put("decid0", -24, 16, 1.3)  # linden on the square
    # community hall on the east bank: a flat-roofed GDR Kulturhaus with a forecourt
    hx, hy, ang = 62.0, -48.0, 0.45
    flat_patch("hall_court", hx, hy, 30, 44, ang, "yardconc", 0.08, cover="open")
    mb = MB()
    mb.box(0, 2, -2, 13, 26, 10, "wall", top_m="roof_flat")
    mb.box(0, -14, -2, 9, 8, 7, "wall", top_m="roof_flat")
    for x in (-6.4, 6.4):
        mb.box(x, 2, 8, 0.3, 26, 0.5, "wall")
    mb.box(3, 6, 8, 2.4, 2.4, 1.6, "metal")
    for k in range(3):
        mb.cyl(-4 + 4 * k, -20, -1, 0.08, 9, "metal", 5)
    zmin, _ = ground_z(hx, hy, 13, 30, ang)
    mb.obj("hall", (hx, hy, zmin), ang, "building")
    FOOT.append((hx, hy, 24))
    # farmsteads on the village edge, set back from the nearest road
    for k, (fx, fy) in enumerate([(-130, 60), (-95, -85), (128, 60), (105, -105)]):
        i, _ = road_near(fx, fy)
        t = road_tangent(i)
        nr = Vector((-t.y, t.x))
        rx, ry = RS[i][0], RS[i][1]
        sgn = 1 if (fx - rx) * nr.x + (fy - ry) * nr.y >= 0 else -1
        off = RS[i][2] + 21
        x, y = rx + nr.x * off * sgn, ry + nr.y * off * sgn
        if free(x, y, 18, 0.5, 8):
            farmstead(f"v{k}", x, y, rot_from_dir(t.x, t.y))
    n = 0

    def place(cx, cy, a, w, d, kind):
        nonlocal n
        r = 0.5 * math.hypot(w, d) * 0.62 + 0.5  # a Hessian village packs houses close
        if not in_village(cx, cy, 1.05) or not free(cx, cy, r, 0.6, 4):
            return
        house(f"house_{n}", cx, cy, a, w, d, kind)
        FOOT.append((cx, cy, r))
        plot_extras(cx, cy, a, w, d)
        n += 1

    for kind, pts in ROAD_PTS:  # rows along the streets, gable or eaves to the street
        if kind not in ("main", "minor"):
            continue
        i = 0
        while i < len(pts):
            x, y = pts[i]
            if in_village(x, y, 1.05):
                a_, b_ = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
                t = Vector((b_[0] - a_[0], b_[1] - a_[1])).normalized()
                nr = Vector((-t.y, t.x))
                for side in (-1, 1):
                    for row in (0, 1, 2):
                        if rng.random() > (0.92, 0.65, 0.3)[row]:
                            continue
                        w, d = rng.uniform(8.5, 11.5), rng.uniform(10.5, 15)
                        to_street = rng.random() < 0.6
                        off = HALFW[kind] + rng.uniform(2.5, 5) + (d if to_street else w) / 2 + row * 21
                        a = rot_from_dir(nr.x, nr.y) if to_street else rot_from_dir(t.x, t.y)
                        place(x + nr.x * off * side, y + nr.y * off * side, a, w, d, "modern" if rng.random() < 0.15 else "house")
            i += rng.randint(5, 7)
    cx0, cy0, rx, ry = VILLAGE
    for _ in range(3000):  # infill: barns and back houses facing the nearest street
        cx, cy = rng.uniform(cx0 - rx, cx0 + rx), rng.uniform(cy0 - ry, cy0 + ry)
        if not in_village(cx, cy):
            continue
        i, d = road_near(cx, cy)
        if d > 60 or RS[i][3] not in ("main", "minor"):
            continue
        w, dd = rng.uniform(8.5, 12), rng.uniform(10, 15)
        place(cx, cy, rot_from_dir(*road_tangent(i)) + rng.choice((0, math.pi / 2)), w, dd,
              rng.choice(["house"] * 5 + ["modern", "barn"]))
    log(f"  village houses: {n}")
    for kind, pts in ROAD_PTS:  # street-parked cars
        if kind not in ("main", "minor"):
            continue
        for i in range(0, len(pts) - 1, 3):
            x, y = pts[i]
            if in_village(x, y) and rng.random() < 0.18 and rdist(x, y) > 14:
                t = Vector((pts[i + 1][0] - x, pts[i + 1][1] - y)).normalized()
                nr = Vector((-t.y, t.x))
                side = rng.choice((-1, 1))
                off = HALFW[kind] + 1.3
                put("car", x + nr.x * off * side, y + nr.y * off * side, 1.0, math.atan2(t.y, t.x))


def build_mill():
    """Watermill on the west bank south of the village, its weir just upstream (water: not a crossing)."""
    my = -138.0
    a = math.atan(river_dxdy(my))
    mx = river_x(my) - 21 * math.sqrt(1 + river_dxdy(my) ** 2)
    house("mill", mx, my, -a, 14, 22, "house")
    house("mill_barn", mx - 22, my - 8, -a, 12, 24, "barn")
    flat_patch("mill_yard", mx - 11, my + 12, 18, 14, -a, "yardconc", 0.07, cover="open")
    FOOT.extend([(mx, my, 13), (mx - 22, my - 8, 14)])
    wy = my + 26
    mb = MB()
    mb.box(river_x(wy), wy, -1.5, 22, 1.4, 1.75, "concrete", a=math.atan(river_dxdy(wy)))
    mb.obj("weir", cover="water")
    foam = Mat("foam")
    foam.base(foam.mix(foam.mr(foam.noise(foam.coord("Object"), 1.5, 4), 0.4, 0.7), (0.25, 0.27, 0.27), (0.6, 0.62, 0.6)))
    MATS["foam"] = foam
    fa = math.atan(river_dxdy(wy))
    make_obj("foam", [(-8, -2.5, 0.03), (8, -2.5, 0.03), (8, 2.5, 0.03), (-8, 2.5, 0.03)], [(0, 1, 2, 3)], ["foam"],
             loc=(river_x(wy - 4), wy - 4, 0), rot=-fa, cover="water")


def build_sawmill():
    """B: a sawmill clearing on the edge of the north woods, log stacks as cover."""
    cx, cy = PT["B"]
    flat_patch("sawmill_yard", cx - 4, cy + 3, 66, 48, 0.12, "sand", 0.07, cover="open")
    house("sawmill_hall", cx - 18, cy + 11, math.pi / 2 + 0.12, 11, 24, "barn")
    house("sawmill_shed", cx + 19, cy - 15, 0.12, 9, 9, "shed")
    house("sawmill_office", cx - 26, cy - 14, 0.12, 8, 10, "house")
    mb = MB()  # open drying shed: timber posts under a long pent roof
    for k in range(6):
        for sy in (-5.5, 5.5):
            mb.box(-14 + k * 5.6, sy, -0.5, 0.3, 0.3, 5.0, "timber")
    mb.poly([(-15.5, -6.5, 4.0), (15.5, -6.5, 4.0), (15.5, 6.5, 5.2), (-15.5, 6.5, 5.2)], "roof_metal")
    mb.obj("drying_shed", (cx + 8, cy - 2, height(cx + 8, cy - 2)), 0.12, "building")
    FOOT.extend([(cx - 18, cy + 11, 13), (cx + 19, cy - 15, 7), (cx - 26, cy - 14, 7), (cx + 8, cy - 2, 16)])
    for x0, y0, x1, y1 in [(-12, -12, -3, -10), (27, 6, 29, 17), (-34, 0, -32, 9), (-4, 22, 7, 24), (10, 20, 20, 22),
                           (-2, -26, 7, -24), (-8, 2, -6, 11), (-36, 14, -34, 22), (22, -30, 31, -28)]:
        mb = MB()
        along_x = x1 - x0 > y1 - y0
        L, Wd = (x1 - x0, y1 - y0) if along_x else (y1 - y0, x1 - x0)
        for layer in range(3):
            for k in range(int(Wd / 0.45) - layer):
                off = -Wd / 2 + 0.225 + (k + layer * 0.5) * 0.45
                mb.box(0, off, -0.3 + layer * 0.42, L * rng.uniform(0.92, 1.0), 0.42, 0.42, "logs")
        lx, ly = cx + (x0 + x1) / 2, cy + (y0 + y1) / 2
        mb.obj("logs", (lx, ly, height(lx, ly)), 0.0 if along_x else math.pi / 2, "wall")
    for _ in range(3):
        put("car", cx + rng.uniform(-8, 12), cy + rng.uniform(-8, 0), 1.0)
    for _ in range(14):
        put("bale" if rng.random() < 0.3 else "wrap", cx + rng.uniform(26, 36), cy + rng.uniform(8, 20), 0.8)


def build_farm_point():
    """D: a big courtyard farm with silos in open fields."""
    (cx, cy), a = PT["D"], -0.18
    farmstead("d", cx, cy, a)
    ca, sa = math.cos(a), math.sin(a)
    for k in range(3):  # the silo farm landmark
        x, y = cx + (-27) * ca - (-8 + k * 6.5) * sa, cy + (-27) * sa + (-8 + k * 6.5) * ca
        mb = MB()
        mb.cyl(0, 0, -1, 2.8, 14, "metal", 16)
        mb.obj(f"silo_d_{k}", (x, y, height(x, y)), 0, "building")


def build_hilltops():
    """A: a wayside chapel with limes on the south-west hill. E: a relay station on the north-east hill.
    Each has a few hard spots in open scrub, so neither hill is a fortress."""
    ax, ay = PT["A"]
    mb = MB()
    gable(mb, 7, 11, 5, 50, "roof_tile")
    mb.box(0, -6.5, -2, 3, 3, 11, "stone")
    zmin, _ = ground_z(ax + 4, ay + 3, 7, 11, 0.6)
    mb.obj("chapel", (ax + 4, ay + 3, zmin), 0.6, "building")
    mb = MB()
    for (x0, y0), (x1, y1) in [((-13, -12), (13, -12)), ((-13, 12), (2, 12)), ((-13, -12), (-13, 12))]:
        L = math.hypot(x1 - x0, y1 - y0)
        mb.box((x0 + x1) / 2, (y0 + y1) / 2, -1.2, L if y0 == y1 else 0.6, 0.6 if y0 == y1 else L, 2.2, "stone")
    mb.obj("chapel_wall", (ax + 4, ay + 3, height(ax, ay)), 0.6, "wall")
    for lx, ly in [(-14, 14), (16, 12), (12, -16), (-16, -10)]:
        tree_at(ax + lx, ay + ly, "decid0", 1.15)
    for _ in range(4):
        x, y = ax + rng.uniform(-20, 20), ay + rng.uniform(-20, 20)
        mb = MB()
        mb.box(0, 0, -0.5, rng.uniform(3, 6), 0.9, 1.6, "stone")
        mb.obj("ruin", (x, y, height(x, y)), rng.uniform(0, 3), "wall")
    ex, ey = PT["E"]
    flat_patch("relay_yard", ex - 3, ey - 2, 26, 22, -0.4, "yardconc", 0.08, cover="open")
    mb = MB()
    mb.box(-6, 2, -1, 9, 6, 4, "concrete", top_m="roof_flat")
    mb.box(5, -5, -0.5, 6.1, 2.45, 2.9, "container")
    mb.obj("relay_hut", (ex, ey, height(ex, ey)), -0.4, "building")
    mb = MB()
    mb.cyl(0, 0, -0.5, 0.9, 38, "metal", 6)
    for z in (12, 22, 32):
        mb.box(0, 0, z, 2.6, 0.3, 0.3, "metal")
    mb.obj("relay_mast", (ex + 5, ey + 6, height(ex + 5, ey + 6)), 0.3, "prop")
    mb = MB()
    for (x0, y0), (x1, y1) in [((-13, -11), (13, -11)), ((13, -11), (13, 11)), ((-13, 11), (0, 11))]:
        L = math.hypot(x1 - x0, y1 - y0)
        mb.box((x0 + x1) / 2, (y0 + y1) / 2, -1.2, L if y0 == y1 else 0.6, 0.6 if y0 == y1 else L, 2.2, "concrete")
    mb.obj("relay_wall", (ex - 3, ey - 2, height(ex, ey)), -0.4, "wall")
    for lx, ly in [(-18, 10), (15, 17), (-12, -18)]:
        tree_at(ex + lx, ey + ly, "bare0", 1.1)
    for _ in range(3):
        x, y = ex + rng.uniform(-22, 22), ey + rng.uniform(-22, 22)
        mb = MB()
        mb.box(0, 0, -0.5, rng.uniform(3, 6), 0.9, 1.6, "concrete")
        mb.obj("blocks", (x, y, height(x, y)), rng.uniform(0, 3), "wall")
    FOOT.extend([(ax, ay, 22), (ex, ey, 22)])
    for cx, cy in ((ax, ay), (ex, ey)):  # scrub on the hilltops
        for _ in range(26):
            x, y = cx + rng.uniform(-48, 48), cy + rng.uniform(-48, 48)
            if 26 < math.hypot(x - cx, y - cy) < 50 and not on_road(x, y, 1.5):
                put("bush" + str(rng.randint(0, 2)), x, y, rng.uniform(1.0, 2.0))


def build_border():
    """The inner German border on the spine: flattened fence with low leftover segments, burnt-out towers."""
    mb = MB()
    for y in np.arange(-EXT, EXT, 14.0):
        if in_village(-10, y, 1.1) or on_road(-10, y + 7, 2) or any(abs(y + 7 - py) < 52 for py in (PT["B"][1], PT["D"][1])):
            continue
        r = (math.sin(y * 12.9898) * 43758.5453) % 1.0
        if r < 0.55:  # standing remnant: posts with sagging mesh, low cover
            for k in range(5):
                yy = y + k * 3.5
                mb.box(-10, yy, height(-10, yy) - 0.5, 0.15, 0.15, 1.7, "metal")
            mb.box(-10, y + 7, height(-10, y + 7) + 0.2, 0.05, 14, 0.9, "metal")
        else:  # flattened: mesh lying in the grass
            mb.box(-11.5, y + 7, height(-11.5, y + 7) + 0.05, 2.6, 13, 0.06, "metal")
    mb.obj("fence_remnants", cover="wall")
    for k, (tx, ty) in enumerate(((-7, 168.0), (-6, -205.0), (-8, 420.0), (-7, -440.0))):
        mb = MB()
        mb.box(0, 0, -1, 2.6, 2.6, 12, "burnt")
        for x0, y0, w, d in ((0, -2, 4.2, 0.25), (0, 2, 4.2, 0.25), (-2, 0, 0.25, 4.2), (2, 0, 0.25, 4.2)):
            mb.box(x0, y0, 11, w, d, 1.4, "burnt")
        mb.box(0, 0, 10.8, 4.2, 4.2, 0.2, "burnt")
        mb.obj(f"tower{k}", (tx, ty, height(tx, ty)), 0.15 + k, "building")
        FOOT.append((tx, ty, 4))


FIELD_TYPES = [("f_plough", 0.32), ("f_winter", 0.26), ("f_stubble", 0.18), ("f_maize", 0.1), ("f_meadow", 0.14)]
FRAMES = [0.21, -0.35, 0.6, -0.14, 0.42, -0.5, 0.05, 0.3]


def north_divider(x):
    """Line between the centre and north Lanes."""
    return 150 - 0.3 * x + 8 * math.sin(x / 60)


def south_divider(x):
    """Line between the centre and south Lanes."""
    return -140 + 0.25 * x + 8 * math.sin(x / 50)


def frame_of(x, y):
    """Field blocks turned against each other: by river bank and by Lane band, and LPG blocks beyond the map's east."""
    if x > HALF + 40:
        return 6  # East German collective-farm (LPG) fields
    if x < -HALF - 40:
        return 7
    band = 2 if y > north_divider(x) else 0 if y < south_divider(x) else 1
    return (1 if x > river_x(y) else 0) + 2 * band if band < 2 else 4 + (x > river_x(y))


def build_fields():
    n = [0]

    def parcel(fi, a, uc, vc, W, L, depth):
        ca, sa = math.cos(a), math.sin(a)
        cx, cy = uc * ca - vc * sa, uc * sa + vc * ca
        if abs(cx) > EXT + 60 or abs(cy) > EXT + 60 or frame_of(cx, cy) != fi and depth == 0:
            return
        w, d = W - 2.5, L - 2.5

        def P(x, y):
            return cx + x * ca - y * sa, cy + x * sa + y * ca

        samples = [P(sx * w / 2, sy * d / 2) for sx in (-1, -0.5, 0, 0.5, 1) for sy in (-1, -0.66, -0.33, 0, 0.33, 0.66, 1)]
        zs = [zone(*p) for p in samples]
        if any(z in ("village", "clear", "border", "out", "water") for z in zs) or zs.count("farm") < len(zs) * 0.6:
            if depth < 4 and max(W, L) > 30:
                if L >= W:
                    f = rng.uniform(0.35, 0.65)
                    parcel(fi, a, uc, vc - L / 2 + L * f / 2, W, L * f, depth + 1)
                    parcel(fi, a, uc, vc + L * f / 2, W, L * (1 - f), depth + 1)
                else:
                    parcel(fi, a, uc - W / 4, vc, W / 2, L, depth + 1)
                    parcel(fi, a, uc + W / 4, vc, W / 2, L, depth + 1)
            return
        orchard = all(in_village(*p, 1.6) and not in_village(*p, 1.0) for p in samples)
        if orchard:
            typ = "f_meadow"
        else:
            r, acc = rng.random(), 0
            for typ, pr in FIELD_TYPES:
                acc += pr
                if r < acc:
                    break
        flat_patch(f"field_{n[0]}", cx, cy, w, d, a, typ, 0.07, step=6.0, cover="open")
        n[0] += 1
        if orchard:
            for ox in np.arange(-w / 2 + 4, w / 2 - 3, 9):
                for oy in np.arange(-d / 2 + 4, d / 2 - 3, 9):
                    if rng.random() < 0.85:
                        put("fruit", *P(ox + rng.uniform(-1, 1), oy + rng.uniform(-1, 1)), rng.uniform(0.7, 1.1))
        elif typ == "f_stubble" and rng.random() < 0.5:
            for ox in np.arange(-w / 2 + 6, w / 2 - 4, 12):
                for oy in np.arange(-d / 2 + 5, d / 2 - 4, 7):
                    if rng.random() < 0.35:
                        put("bale", *P(ox + rng.uniform(-2, 2), oy + rng.uniform(-2, 2)), 1.0)
        hedge_p = 0.1 if fi >= 6 else 0.28 if cx > 0 else 0.45  # fewer hedgerows on the collectivised east side
        corners = [P(-w / 2 - 1.2, -d / 2 - 1.2), P(w / 2 + 1.2, -d / 2 - 1.2), P(w / 2 + 1.2, d / 2 + 1.2), P(-w / 2 - 1.2, d / 2 + 1.2)]
        for e in range(4):
            if rng.random() < hedge_p:
                hedge_line([corners[e], corners[(e + 1) % 4]], gap=True)

    for fi, a in enumerate(FRAMES):
        if fi >= 6 and not OUTER:
            continue
        lim = EXT * 1.45 + 10
        v = -lim
        while v < lim:
            L = rng.uniform(250, 450) if fi == 6 else rng.uniform(80, 150) if fi < 6 else rng.uniform(90, 170)
            u = -lim
            while u < lim:
                W = rng.uniform(120, 260) if fi == 6 else rng.uniform(22, 55) if fi < 6 else rng.uniform(25, 60)
                parcel(fi, a, u + W / 2, v + L / 2, W, L, 0)
                u += W
            v += L
    log(f"  fields: {n[0]}")


def build_hedges():
    """Lane dividers (sight, not movement), NATO's sunken lane to D, hedgerows along the cut corners."""
    gaps = lambda xs, c: [x for x in xs if all(abs(x - g) > 7 for g in c)]  # noqa: E731
    north = gaps(np.arange(-HALF + 20, HALF - 20, 2.0), (-300, -150, 30, 200, 380))
    south = gaps(np.arange(-HALF + 20, HALF - 20, 2.0), (-360, -200, -40, 150, 320))
    for xs, f in ((north, north_divider), (south, south_divider)):
        run = []
        for x in xs:
            if run and x - run[-1][0] > 2.5:
                hedge_line(run, trees=0.18)
                run = []
            run.append((float(x), f(x)))
        hedge_line(run, trees=0.18)
    lane = [(river_x(-FOOT_Y) + 10, -FOOT_Y), (-50, -232), (-30, -262), (-14, -276)]
    for off in (-3.5, 3.5):
        hedge_line(lane, offset=off, trees=0.2)
    for half in (_HALF_AREA[9:14], [(-x, -y) for x, y in _HALF_AREA[9:14]]):
        hedge_line(half, trees=0.15)


def build_farmsteads():
    """Farms scattered through the farmland, plus hamlets in the surroundings."""
    for k, (x, y, a) in enumerate([(-300, 112, 0.2), (305, -150, -0.4), (215, 62, 0.9), (-235, -100, 0.6),
                                   (-330, -250, -0.3), (365, 300, 0.15)]):
        if free(x, y, 18, 1.0):
            farmstead(f"f{k}", x, y, a)
    if not OUTER:
        return
    for k, (hx, hy, ha) in enumerate([(-960, 630, 0.3), (780, -1035, -0.2), (-840, -930, 0.9), (990, 840, 0.1),
                                      (-1170, -120, -0.6), (270, 1050, 0.5), (1150, 120, 0.2)]):
        farmstead(f"o{k}", hx, hy, ha)
        for j in range(9):
            x, y = hx + rng.uniform(-80, 80), hy + rng.uniform(-80, 80)
            if free(x, y, 7):
                house(f"oh{k}_{j}", x, y, ha + rng.choice((0, math.pi / 2)), rng.uniform(9, 11), rng.uniform(11, 14))
                FOOT.append((x, y, 7))


# ----------------------------------------------------------------- map.json
def hq_vehicles(side, nets):
    """#154: a tank under each camo net, then two jeeps and the AA 9, 18 and 36 m past the last toward the field, where the
    Simulation's row put them before vehicles were map data."""
    (x, y), s = nets[-1], 1 if side == "nato" else -1
    tanks = [{"kind": "tank", "x": r2(a), "y": r2(b)} for a, b in nets]
    return tanks + [{"kind": k, "x": r2(r2(x) + s * 9 * n), "y": r2(y)} for k, n in (("jeep", 1), ("jeep", 2), ("aa", 4))]


def meta():
    return {
        "name": "Kaltenbach", "village": "Kaltenbach", "river": "Erlenbach", "sizeM": int(2 * HALF),
        "playArea": [{"x": x, "y": y} for x, y in PLAY_AREA],
        "hqs": {side: {"x": x, "y": y, "radius": HQ_RADIUS} for side, (x, y) in HQS.items()},
        "points": [{"id": i, "name": i, "x": x, "y": y, "radius": POINT_RADIUS, "owner": o,
                    **({"vehicles": [{"kind": k, "x": r2(vx), "y": r2(vy)} for k, vx, vy in POINT_VEHICLES[i]]} if i in POINT_VEHICLES else {})}
                   for i, x, y, o in POINTS],
        "crossings": [{"id": i, "kind": k, "x": r2(x), "y": r2(y), "halfWidth": hw} for i, k, x, y, hw in CROSSINGS],
        "vehicleSlots": {side: hq_vehicles(side, nets) for side, nets in VEHICLE_SLOTS.items()},
        "helipad": {side: [{"x": r2(x), "y": r2(y)}] for side, (x, y) in HELIPADS.items()},
        "jets": {side: 1 for side in HQS},
        "grid": {"cols": 13, "rows": 13, "squareM": 2 * HALF / 13, "letters": "ABCDEFGHIJKLM"},
        "data": {"cells": int(2 * HALF), "cellM": 1, "cover": "cover_u8.bin", "ground": "ground_f32.bin", "top": "top_f32.bin",
                 "coverIds": COVER_IDS},
        "images": {"play": [f"map_{8192 >> k}.webp" for k in range(14)], "outer": {"file": "outer_2048.webp", "sizeM": 2880}},
    }


# ----------------------------------------------------------------------- main
def main():
    build_materials()
    log("terrain")
    build_terrain()
    log("roads")
    build_roads()
    P = build_protos()
    log("landmarks")
    build_hq("nato", *HQS["nato"], 0.05)
    build_hq("pact", *HQS["pact"], -0.12)
    build_sawmill()
    build_farm_point()
    build_hilltops()
    build_border()
    build_crossings()
    log("village")
    build_village()
    build_mill()
    build_farmsteads()
    log("fields")
    build_fields()
    log("hedges, banks, woods")
    build_hedges()
    build_banks()
    build_poles()
    build_woods()
    finish(P, meta())


main()
