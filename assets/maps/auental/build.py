"""Auental, the 128 v 128 Conquest map (#150), as a greybox: terrain, the river Auer with its reservoir and seven crossings,
roads, the rail line, the HQs and the Capture Points on plain fields, with no dressing yet (#150 build plan step 2).
Headless Blender script; it is the map's source of truth (ADR 0001, ADR 0002) and its outputs are committed.

A 2.5 km valley from the layout session of 2026-11-10: NATO HQ west and Warsaw Pact HQ east, 12 Capture Points in three
Lanes, a 20 m river crossing the line between the HQs north to south with 7 crossings (3 / 1 / 3), a reservoir behind a dam
in a gorge filling the south edge, Hochwacht hill over the old bridge in the north. Points, HQs, crossings and the boundary
match under a half turn about the map centre; the scenery around them is not mirrored.

Run from the repo root (assets/maps/auental/bake.sh runs the full bake):
  blender -b --factory-startup -Y --python-exit-code 1 -P assets/maps/auental/build.py -- MODE [PREVIEW_RES] [SAMPLES]
  MODE play     map.json, 1 m data render, 8192 render, WebP mip chain, previews
       preview  everything play writes except the mips, at PREVIEW_RES (1024), into work/ for iterating
       outer    the low-detail surroundings out to 7.5 km, 2048 WebP
This file is the layout and the landmarks; what every map bake shares is in assets/maps/bake.py.
"""
import math
import os
import sys

import numpy as np
from mathutils import kdtree

sys.dont_write_bytecode = True  # no __pycache__ beside the shared module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bake import (COVER_IDS, MB, OUTER, ROAD_PTS, bank, build_crossings, build_hq,  # noqa: E402
                  build_materials, build_protos, build_roads, build_terrain, bump, catmull, finish, flat_patch, index_roads,
                  log, near_crossing, nz, on_road, r2, rng, sstep)

HALF = 1250.0
OUTER_EXT = 3750.0  # the surroundings: 3x the map, as on Kaltenbach
EXT = OUTER_EXT if OUTER else HALF
RIVER_W = 20.0
TERRAIN_N = 1025 if OUTER else 1281  # 2 m between vertices on the play bake, 7 m on the surroundings
HEIGHT_CELL_M = 2  # nothing reads the height grids yet, and at 1 m they would add 50 MB a bake

# ------------------------------------------------------------------ layout (#150)
# Metres, origin at map centre, x east, y north. Gameplay positions match under a half turn about the centre.
_HALF_AREA = [(-1250, 800), (-1120, 930), (-980, 1060), (-830, 1250), (1250, 1250)]
PLAY_AREA = _HALF_AREA + [(-x, -y) for x, y in _HALF_AREA]  # 6.05 km², corners cut north-west and south-east
HQS = {"nato": (-1120.0, -40.0), "pact": (1120.0, 40.0)}
HQ_RADIUS = 60.0
POINTS = [  # id, x, y, capture radius, owner at the start; the site each one gets when the map is dressed
    ("A", -900.0, 480.0, 30.0, "nato"),  # Kreuzhof: farmstead on the west ridge road
    ("B", -840.0, -640.0, 30.0, "nato"),  # Lindenhof: walled farm on the south road out of the HQ
    ("C", -520.0, 560.0, 35.0, None),  # Ziegelei: brickworks 300 m from the west bank
    ("D", -430.0, -520.0, 35.0, None),  # Obstgut: orchard estate and rail halt on open farmland
    ("E", -130.0, 40.0, 45.0, None),  # Unterau: west half of the twin town, the west bridgehead
    ("F", -120.0, -1000.0, 35.0, None),  # Staudamm: dam works at the west end of the dam road
    ("G", 120.0, 1000.0, 35.0, None),  # Hochwacht: radar station on the highest hill
    ("H", 130.0, -40.0, 45.0, None),  # Oberau: east half of the twin town, the east bridgehead
    ("I", 430.0, 520.0, 35.0, None),  # Bahnhof: station and sidings on the rail line
    ("J", 520.0, -560.0, 35.0, None),  # Kieswerk: gravel works 300 m from the east bank
    ("K", 840.0, 640.0, 30.0, "pact"),  # Waldhof: forest farm on the east ridge road
    ("L", 900.0, -480.0, 30.0, "pact"),  # Birkenhof: farm on the south road out of the HQ
]
PT = {i: (x, y) for i, x, y, _, _ in POINTS}
KEYSTONE = ["E", "H"]  # the twin town: the Missile gate needs both halves
CROSSINGS = [  # north to south, twins under the half turn; armour crosses at the bridges and, at half speed, the fords
    ("OLD", "bridge", -60.0, 1020.0, 4.0), ("NF", "ford", -190.0, 720.0, 6.5), ("RAIL", "footbridge", -165.0, 430.0, 1.5),
    ("MAIN", "bridge", 0.0, 0.0, 4.0),
    ("WEIR", "footbridge", 165.0, -430.0, 1.5), ("SF", "ford", 190.0, -720.0, 6.5), ("DAM", "bridge", 60.0, -1020.0, 4.0),
]
# #154: each Side's vehicles, sized so about a third of a Side can ride out at the opening. HQ slots and helipads are metres
# from NATO's HQ, x toward the field, and PACT's are their half turn. Odd metres put each one on a 2 m cell centre, so a slot
# and its twin fall in twin cells. The slots clear the compound's tents and containers on both Sides.
HQ_VEHICLES = [("tank", 1, 29), ("tank", 13, 29), ("tank", 25, 29), ("tank", 37, 29),
               ("jeep", 1, 15), ("jeep", 13, 15), ("jeep", 25, 15), ("jeep", 1, -17), ("jeep", 13, -17), ("jeep", 25, -17),
               ("aa", 1, -29), ("aa", 13, -29)]
HQ_PADS = [(-15, 25), (-15, -1), (-15, -27)]  # one helicopter on each
JETS = 3  # at the off-map base
# Metres from NATO's bank's points, on the road back toward its HQ; each PACT-bank point takes its twin's half turn. None in
# the twin town (the keystone is an infantry fight), a tank and a jeep at the armour points D and I, a jeep at every other.
POINT_VEHICLES = {"A": [("jeep", -5, -7)], "B": [("jeep", -5, 9)], "C": [("jeep", -9, -1)],
                  "D": [("tank", -9, -3), ("jeep", -19, -7)], "F": [("jeep", -9, -1)]}

# The Auer north of the centre, through the north crossings; the south is its half turn, so the twin crossings sit on it too.
# It runs on past both edges: north out of the map, south into the reservoir and beyond it for the surroundings.
_RIVER_N = [(-60, 210), (-165, 430), (-215, 560), (-190, 720), (-120, 890), (-60, 1020), (-100, 1170), (-210, 1340),
            (-330, 1700), (-290, 2300), (-420, 3000), (-380, 3900)]
def _kd(pts):
    t = kdtree.KDTree(len(pts))
    for i, (x, y) in enumerate(pts):
        t.insert((x, y, 0), i)
    t.balance()
    return t


_RIVER = catmull([(-x, -y) for x, y in reversed(_RIVER_N)] + [(0, 0)] + _RIVER_N, 1.0)
assert all(b[1] > a[1] for a, b in zip(_RIVER, _RIVER[1:])), "the river must run north all the way"
_RX, _RY = np.array([p[0] for p in _RIVER]), np.array([p[1] for p in _RIVER])
_RKD = _kd(_RIVER)


def river_x(y):
    return float(np.interp(y, _RY, _RX))


def river_dxdy(y):
    return (river_x(y + 2) - river_x(y - 2)) / 4


def rdist(x, y):
    return _RKD.find((x, y, 0))[2]


# the reservoir behind the dam: water where lake() > LAKE_WATER, nothing north of the dam's reservoir face
LAKE_BLOBS = [(60, -1062, 34), (130, -1110, 55), (240, -1165, 75), (340, -1250, 70), (40, -1180, 80), (-90, -1235, 75),
              (170, -1290, 95), (0, -1330, 95), (260, -1350, 90), (120, -1450, 110), (-60, -1420, 90), (200, -1560, 110)]
LAKE_Y = -1038.0
LAKE_WATER = 0.56


def lake(x, y):
    if y > LAKE_Y or not -320 < x < 520:
        return 0.0
    return sum(math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (r * r)) for bx, by, r in LAKE_BLOBS)


# ---------------------------------------------------------------------- roads
ROADS = [
    ("main", [(-EXT - 12, -150), (-2400, -110), (-1300, -60), (-1120, -40), (-940, -80), (-700, -20), (-420, 60), (-220, 50),
              (-130, 40), (0, 0), (130, -40), (230, -45), (420, -60), (700, 20), (940, 80), (1120, 40), (1300, 60), (2400, 110),
              (EXT + 12, 150)]),
    # the valley roads: HQ, rear point, bank point, outer bridge, outlier, and on to the other HQ
    ("minor", [(-1120, -40), (-1060, 200), (-900, 480), (-720, 570), (-520, 560), (-400, 700), (-230, 930), (-60, 1020),
               (120, 1000), (300, 1010), (600, 890), (840, 640), (1000, 300), (1120, 40)]),
    ("minor", [(1120, 40), (1060, -200), (900, -480), (720, -570), (520, -560), (400, -700), (230, -930), (60, -1020),
               (-120, -1000), (-300, -1010), (-600, -890), (-840, -640), (-1000, -300), (-1120, -40)]),
    # spurs from every approach point to the twin town
    ("minor", [(-520, 560), (-380, 330), (-250, 160), (-130, 40)]),
    ("minor", [(-430, -520), (-300, -260), (-170, -80), (-130, 40)]),
    ("minor", [(430, 520), (300, 260), (170, 80), (130, -40)]),
    ("minor", [(520, -560), (380, -330), (250, -160), (130, -40)]),
    ("minor", [(-840, -640), (-640, -600), (-430, -520)]),
    ("minor", [(840, 640), (640, 600), (430, 520)]),
    # farm tracks: across the farmland, through the fords, out to the outliers
    ("track", [(-900, 480), (-760, 120), (-620, -200), (-430, -520)]),
    ("track", [(900, -480), (760, -120), (620, 200), (430, 520)]),
    ("track", [(-400, 700), (-300, 690), (-190, 720), (-20, 700), (200, 640), (430, 520)]),
    ("track", [(400, -700), (300, -700), (190, -720), (20, -700), (-200, -640), (-430, -520)]),
    ("track", [(120, 1000), (200, 820), (300, 640), (430, 520)]),
    ("track", [(-120, -1000), (-200, -820), (-300, -640), (-430, -520)]),
    # the rail line, north-east to south-west: the station by I, the rail bridge, a level crossing west of Unterau, the halt by D
    ("rail", [(EXT + 12, 2500), (2900, 2000), (2000, 1500), (1340, 1080), (960, 840), (640, 640), (440, 500), (150, 455),
              (-165, 430), (-330, 330), (-450, 110), (-520, -180), (-560, -420), (-700, -820), (-900, -1100), (-1100, -1340),
              (-1600, -1900), (-2500, -2600), (-EXT - 12, -3300)]),
]
index_roads(ROADS)
_RAILKD = _kd([p for kind, pts in ROAD_PTS if kind == "rail" for p in pts])


# ---------------------------------------------------------------- terrain math
def ground(x, y):
    """Valley rising ~23 m from the river to the HQ edges, Hochwacht ~60 m above the river, uplands behind A and L, low
    ridges along the HQ edges, a gorge at the dam, the rail embankment, organic relief."""
    d = rdist(x, y)
    u = min(d / 700, 1.0)
    h = 0.8 + 22 * u * u * (3 - 2 * u)
    h += bump(x, y, 150, 1020, 300, 58)  # Hochwacht, over the old bridge
    h += bump(x, y, -1100, 1000, 560, 22) + bump(x, y, 1100, -1000, 560, 22)  # uplands behind A and L
    h += 8 * math.exp(-((abs(x) - 1150) / 160) ** 2)
    h += 14 * math.exp(-((y + 1030) / 90) ** 2 - ((x - 60) / 260) ** 2) * sstep(12, 55, d)  # the dam's gorge
    h += sstep(12, 50, d) * (2.5 * nz(x, y, 240, 1.7) + 0.9 * nz(x, y, 70, 5.1))
    far = max(abs(x), abs(y))
    if far > HALF:  # rolling hills beyond the map, the river keeping its valley floor
        h += 25 * sstep(HALF, HALF + 900, far) * sstep(12, 300, d) * (0.6 + nz(x, y, 800, 8.8))
    h += 1.6 * (1 - sstep(3.5, 11, _RAILKD.find((x, y, 0))[2]))
    return max(h, 0.4)


def height(x, y):
    """Ground with the river and the reservoir cut in: 20 m of water at any bank height, shallow at the fords."""
    h = ground(x, y)
    d = rdist(x, y)
    if d < 30:
        bed = -0.35 if any(k == "ford" and abs(y - cy) < hw for _, k, _, cy, hw in CROSSINGS) else -1.6
        h = bed + (0.8 - bed) * sstep(5, 13, d) + (h - 0.8) * sstep(10.5, 30, d)
    lv = lake(x, y)
    if lv > 0.01:  # the shore lies where lake() is about LAKE_WATER, steep under the gorge
        h = min(h, -2.5 + 60 * max(0.0, 0.6 - lv))
    return h


# ----------------------------------------------------------------------- zones
CLEAR = [(*HQS["nato"], HQ_RADIUS + 20), (*HQS["pact"], HQ_RADIUS + 20)] + [(x, y, r + 15) for _, x, y, r, _ in POINTS]


def clearing(x, y):
    """Open ground kept free of fields: the HQs and the point zones."""
    return any((x - cx) ** 2 + (y - cy) ** 2 < r * r for cx, cy, r in CLEAR)


def woods_val(x, y):
    return 0.0  # no woods in the greybox


def meadow(x, y):
    return False  # no lone field trees either


def zone(x, y):
    if abs(x) > EXT + 4 or abs(y) > EXT + 4:
        return "out"
    d, lv = rdist(x, y), lake(x, y)
    if d < bank(0.5) or lv > LAKE_WATER:
        return "water"
    if on_road(x, y, 1.0):
        return "road"
    if max(abs(x), abs(y)) <= HALF + 4 and clearing(x, y):
        return "clear"
    if d < bank(5) or lv > 0.3:
        return "clear" if near_crossing(x, y, 6) else "bank"
    return "farm"


# ------------------------------------------------------------------ landmarks
def build_dam():
    """The dam in its gorge: a concrete wall across the river on the reservoir side of the dam road."""
    _, _, cx, cy, _ = CROSSINGS[-1]
    mb = MB()
    mb.box(0, -4, -3.0, 60, 4.0, 5.9, "concrete")  # local x across the river, y downstream (north)
    mb.obj("dam", (cx, cy, 0.0), -math.atan(river_dxdy(cy)), "wall")


FIELD_TYPES = [("f_plough", 0.32), ("f_winter", 0.26), ("f_stubble", 0.18), ("f_maize", 0.1), ("f_meadow", 0.14)]
FRAMES = [0.21, -0.35, 0.6, -0.14, 0.42, -0.5]


def frame_of(x, y):
    """Field blocks turned against each other: by Lane band and by river bank."""
    band = 2 if y > 250 + 0.15 * x else 0 if y < -250 + 0.15 * x else 1
    return 2 * band + (x > river_x(y))


def build_fields():
    """Plain parcels on the farmland, no hedges, orchards or bales; bigger on the surroundings."""
    k = 2.0 if OUTER else 1.0
    n = 0

    def parcel(fi, a, uc, vc, W, L, depth):
        nonlocal n
        ca, sa = math.cos(a), math.sin(a)
        cx, cy = uc * ca - vc * sa, uc * sa + vc * ca
        if abs(cx) > EXT + 60 or abs(cy) > EXT + 60 or depth == 0 and frame_of(cx, cy) != fi:
            return
        w, d = W - 2.5, L - 2.5
        ps = [(cx + px * ca - py * sa, cy + px * sa + py * ca) for px in np.linspace(-w / 2, w / 2, 5)
              for py in np.linspace(-d / 2, d / 2, 7)]
        # split round a road, the river, a clearing, or the next frame's block, whose parcels would overlap this one
        if any(zone(*p) != "farm" or frame_of(*p) != fi for p in ps):
            if depth < 3 and max(W, L) > 30 * k:
                if L >= W:
                    parcel(fi, a, uc, vc - L / 4, W, L / 2, depth + 1)
                    parcel(fi, a, uc, vc + L / 4, W, L / 2, depth + 1)
                else:
                    parcel(fi, a, uc - W / 4, vc, W / 2, L, depth + 1)
                    parcel(fi, a, uc + W / 4, vc, W / 2, L, depth + 1)
            return
        r, acc = rng.random(), 0
        for typ, pr in FIELD_TYPES:
            acc += pr
            if r < acc:
                break
        flat_patch(f"field_{n}", cx, cy, w, d, a, typ, 0.07, step=6.0 * k, cover="open")
        n += 1

    lim = EXT * 1.45 + 10
    for fi, a in enumerate(FRAMES):
        v = -lim
        while v < lim:
            L = rng.uniform(80, 150) * k
            u = -lim
            while u < lim:
                W = rng.uniform(22, 55) * k
                parcel(fi, a, u + W / 2, v + L / 2, W, L, 0)
                u += W
            v += L
    log(f"  fields: {n}")


# ----------------------------------------------------------------- map.json
def hq_slot(side, dx, dy):
    """#154: the spot dx, dy metres from the Side's HQ as NATO's HQ_VEHICLES and HQ_PADS give it; PACT's is the half turn."""
    s, (x, y) = 1 if side == "nato" else -1, HQS[side]
    return {"x": x + s * dx, "y": y + s * dy}


def point_vehicles(i):
    """#154: the vehicles waiting at point i for its owner: its own POINT_VEHICLES, else its twin's half-turned."""
    x, y = PT[i]
    twin = next(j for j, p in PT.items() if p == (-x, -y))
    s, listed = (1, POINT_VEHICLES[i]) if i in POINT_VEHICLES else (-1, POINT_VEHICLES.get(twin, []))
    return {"vehicles": [{"kind": k, "x": x + s * dx, "y": y + s * dy} for k, dx, dy in listed]} if listed else {}


def meta():
    return {
        "name": "Auental", "village": "Unterau", "river": "Auer", "sizeM": int(2 * HALF),
        "playArea": [{"x": x, "y": y} for x, y in PLAY_AREA],
        "hqs": {side: {"x": x, "y": y, "radius": HQ_RADIUS} for side, (x, y) in HQS.items()},
        "points": [{"id": i, "name": i, "x": x, "y": y, "radius": r, "owner": o, **point_vehicles(i)} for i, x, y, r, o in POINTS],
        "keystone": KEYSTONE,
        "crossings": [{"id": i, "kind": k, "x": r2(x), "y": r2(y), "halfWidth": hw} for i, k, x, y, hw in CROSSINGS],
        "vehicleSlots": {side: [{"kind": k, **hq_slot(side, dx, dy)} for k, dx, dy in HQ_VEHICLES] for side in HQS},
        "helipad": {side: [hq_slot(side, dx, dy) for dx, dy in HQ_PADS] for side in HQS},
        "jets": {side: JETS for side in HQS},
        "grid": {"cols": 10, "rows": 10, "squareM": 250.0, "letters": "ABCDEFGHIJ"},
        "data": {"cells": int(2 * HALF), "cellM": 1, "cover": "cover_u8.bin", "ground": "ground_f32.bin", "top": "top_f32.bin",
                 "heightCellM": HEIGHT_CELL_M, "coverIds": COVER_IDS},
        "images": {"play": [f"map_{8192 >> k}.webp" for k in range(14)],
                   "outer": {"file": "outer_2048.webp", "sizeM": int(2 * OUTER_EXT)}},
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
    build_hq("nato", *HQS["nato"], 0.05, HQ_RADIUS / 35)
    build_hq("pact", *HQS["pact"], -0.12, HQ_RADIUS / 35)
    build_crossings()
    build_dam()
    log("fields")
    build_fields()
    finish(P, meta())


main()
