"""Auental, the 128 v 128 Conquest map (#150): terrain, the river Auer with its reservoir and seven crossings, roads, the
rail line, the HQs, a landmark at each of the 12 Capture Points, the twin town, woods, fields and hedges, and what the
war has left on them: shell holes, tank ruts, wrecks and burnt farms.
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
from mathutils import Vector, kdtree

sys.dont_write_bytecode = True  # no __pycache__ beside the shared module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bake import (COVER_IDS, FOOT, MATS, MB, OUTER, ROAD_PTS, RS, Mat, bank, blob, build_banks,  # noqa: E402
                  build_crossings, build_houses, build_hq, build_materials, build_poles, build_protos, build_roads,
                  build_terrain, build_woods, bump, catmull, church, disc_patch, farmstead, finish, flat_patch, free, gable,
                  ground_z, hedge_line, house, index_roads, log, log_stack, make_obj, near_crossing, nz, on_road, proto, put,
                  r2, rng, road_near, sstep, strip, tree_at, vary)

HALF = 1250.0
OUTER_EXT = 3750.0  # the surroundings: 3x the map, as on Kaltenbach
EXT = OUTER_EXT if OUTER else HALF
RIVER_W = 20.0
TERRAIN_N = 1025 if OUTER else 1281  # 2 m between vertices on the play bake, 7 m on the surroundings
HEIGHT_CELL_M = 2  # nothing in the game reads the height grids yet, and at 1 m they would add 50 MB a bake

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
_RAIL_PTS = [(EXT + 12, 2500), (2900, 2000), (2000, 1500), (1340, 1080), (960, 840), (640, 640), (425, 546), (150, 455),
             (-165, 430), (-330, 330), (-450, 110), (-520, -180), (-560, -420), (-700, -820), (-900, -1100), (-1100, -1340),
             (-1600, -1900), (-2500, -2600), (-EXT - 12, -3300)]
_RAIL = catmull(_RAIL_PTS)  # the main line every 2 m, running south-west
_RAILI = _kd(_RAIL)


def rail_at(x, y):
    """The main line's point nearest (x, y): its index, the point, and the line's heading there (toward the south-west)."""
    i = _RAILI.find((x, y, 0))[1]
    (ax, ay), (bx, by) = _RAIL[i - 1], _RAIL[i + 1]
    return i, _RAIL[i], math.atan2(by - ay, bx - ax)


_STATION = rail_at(455, 556)[0]  # the platform's middle, beside I


def _siding(off, k0, k1):
    """A siding off metres to the main line's left (north at the station), leaving it k0 points up the line from the station
    and rejoining it at k1."""
    pts = []
    for k in range(k0, k1 + 1, 5):
        (x, y), (ax, ay), (bx, by) = _RAIL[_STATION - k], _RAIL[_STATION - k - 1], _RAIL[_STATION - k + 1]
        o = off * sstep(k0, k0 + 15, k) * sstep(k1, k1 - 15, k) / math.hypot(bx - ax, by - ay)
        pts.append((x - (by - ay) * o, y + (bx - ax) * o))
    return pts


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
    ("rail", _RAIL_PTS),
    ("rail", _siding(-6.0, 10, 110)), ("rail", _siding(-11.5, 25, 95)),  # the station's sidings, north of the main line
]
# Unterau's streets off the square at E, and Oberau's as their half turn, so both Sides drive the same town
_STREETS = [[(-130, 40), (-120, 100), (-135, 160), (-190, 190)], [(-135, 160), (-85, 150), (-62, 90), (-55, 17)],
            [(-130, 40), (-105, -30), (-70, -90), (-20, -150)], [(-250, 160), (-245, 100), (-225, 50), (-215, -20), (-170, -80)]]
ROADS += [("minor", st) for st in _STREETS] + [("minor", [(-x, -y) for x, y in st]) for st in _STREETS]
index_roads(ROADS)
_RAILKD = _kd([p for kind, pts in ROAD_PTS if kind == "rail" for p in pts])
# the high-voltage line from the dam's substation out over the west edge; woods are felled under it
_LINE = catmull([(-70, -952), (-420, -860), (-800, -800), (-1250, -700), (-2400, -520), (-EXT - 200, -350)], 10.0)
_LINEKD = _kd(_LINE)


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
def _turn(sites):
    """Sites with their half turns: (x, y, heading, ...) on NATO's bank and its twin on the Warsaw Pact's."""
    return sites + [(-x, -y, a + math.pi, *rest) for x, y, a, *rest in sites]


# the rear points' farms, beside the road through each point: centre, heading (the house toward the road), big or not
FARM_A, FARM_B = (-932.0, 510.0, 2.39, True), (-875.0, -663.5, 3.735, False)
(_, _, FARM_L, FARM_K) = _turn([FARM_A, FARM_B])
FARMS = [(-1010, 150, 0.3), (-690, 290, -0.4), (-650, -360, 0.8), (-290, -430, 0.2), (-560, 860, 1.1), (-960, -430, -0.2),
         (-330, 830, 0.5), (700, -300, 0.6), (640, 390, -0.3), (290, 430, 1.2), (560, -860, 0.1), (960, 420, 0.9),
         (1010, -110, -0.5), (330, -840, 0.4), (-180, -620, -0.7), (160, 650, 0.2)]  # lone farms in the fields
TOWN = (-128.0, 38.0, 112.0, 215.0)  # Unterau: its centre, the radius of its core, and how far it runs out along its streets


def in_town(x, y, s=1.0):
    """The twin town, a half on each bank (Oberau is Unterau's half turn): a core round the square, and houses strung out
    along the streets beyond it."""
    cx, cy, core, reach = TOWN
    tx, ty = (x, y) if x < river_x(y) else (-x, -y)
    d, n = math.hypot(tx - cx, ty - cy) / s, nz(x, y, 60, 6.6)
    if d < core * (1 + 0.25 * n):
        return True
    if d > reach * (1 + 0.2 * n):
        return False
    i, dr = road_near(x, y)
    return RS[i][3] in ("main", "minor") and dr < 34 + 14 * n


WOOD_BLOBS = [
    (-1080, 1000, 260), (-860, 1130, 170), (-1160, 720, 150), (-700, 1010, 120),  # the north-west forest, behind A
    (1080, -1000, 260), (840, -1150, 180), (1170, -740, 140), (640, -1010, 110),  # the south-east forest, behind L
    (960, 790, 170), (760, 830, 120), (1010, 560, 110), (1130, 900, 160),  # Waldhof's forest, round K
    (-1040, -850, 150), (-1150, -1050, 170), (-820, -1080, 120),  # the Lindenwald, south of B
    (10, 1120, 90), (260, 1130, 120), (330, 960, 100), (210, 860, 80),  # Hochwacht's slopes
    (220, -1010, 80), (330, -1090, 100), (-260, -1090, 90), (-330, -1180, 110),  # the gorge and the reservoir's shores
]
for _pts, _r in [  # blocks between the Lanes, and copses toward the river
        ([(-660, 200), (-590, 240), (-540, 300)], 48), ([(-800, -340), (-760, -280), (-700, -270)], 40),
        ([(-580, -110), (-545, -60)], 30), ([(600, -300), (640, -250), (700, -230)], 45),
        ([(760, 280), (800, 330), (860, 350)], 50), ([(540, 90), (580, 140)], 32), ([(-350, 490), (-320, 540)], 32),
        ([(-400, -800), (-360, -760)], 34), ([(310, -500), (350, -460)], 30), ([(360, 780), (410, 820)], 34),
        ([(-110, -540), (-80, -500)], 28), ([(70, 540), (110, 580)], 28)]:
    WOOD_BLOBS += strip(_pts, _r)
if OUTER:
    WOOD_BLOBS += [(-2300, 1900, 600), (-2800, -600, 500), (-1900, -2400, 550), (2200, -1900, 600), (2900, 500, 500),
                   (1800, 2500, 550), (600, 2900, 450), (-700, -2900, 450), (3000, -3000, 500), (-3100, 3000, 500)]


def woods_val(x, y):
    w = sum(math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (r * r)) for bx, by, r in WOOD_BLOBS if abs(x - bx) < 3 * r)
    return 0.9 * w + 0.35 * nz(x, y, 45, 2.2) + 0.2 * nz(x, y, 150, 4.1)


# open ground kept free of woods and fields: the HQs, the point zones, and the sites of the landmarks beside them
CLEAR = ([(*HQS["nato"], HQ_RADIUS + 20), (*HQS["pact"], HQ_RADIUS + 20)] + [(x, y, r + 15) for _, x, y, r, _ in POINTS]
         + [(x, y, 66 if big else 58) for x, y, _, big in (FARM_A, FARM_B, FARM_K, FARM_L)] + [(x, y, 46) for x, y, _ in FARMS]
         + [(-560, 500, 64), (-640, 452, 42), (560, -500, 64), (640, -452, 46),  # C's brickworks and clay pit, J's gravel works and pit
            (-400, -500, 66), (-385, -420, 95), (-444, -566, 34), (-608, -556, 30),  # D's manor, orchard, greenhouses, halt
            (478, 552, 78), (560, 600, 60),  # I's station and goods yard
            (-110, -990, 70), (40, -985, 30),  # F's substation and the powerhouse
            (120, 1006, 72),  # G's summit
            (330, 15, 66), (1010, -590, 54),  # the football pitch, the solar park
            (1130, -1120, 22), (1010, -1195, 22), (1195, -975, 22)])  # the wind turbines


def clearing(x, y):
    return any((x - cx) ** 2 + (y - cy) ** 2 < r * r for cx, cy, r in CLEAR)


def meadow(x, y):
    """The Auen: grazing meadows with lone trees along the river, where no fields are ploughed."""
    return rdist(x, y) < 48 + 22 * nz(x, y, 90, 3.1)


def zone(x, y):
    if abs(x) > EXT + 4 or abs(y) > EXT + 4:
        return "out"
    d, lv = rdist(x, y), lake(x, y)
    if d < bank(0.5) or lv > LAKE_WATER:
        return "water"
    if on_road(x, y, 1.0):
        return "road"
    inside = max(abs(x), abs(y)) <= HALF + 4
    if inside and in_town(x, y):
        return "village"
    if inside and clearing(x, y):
        return "clear"
    if d < bank(5) or lv > 0.3:
        return "clear" if near_crossing(x, y, 6) else "bank"
    if woods_val(x, y) > 0.48:  # a verge is kept along every road and rail through a wood, and a ride under the power line
        return "clear" if on_road(x, y, 5.0) or _LINEKD.find((x, y, 0))[2] < 16 else "woods"
    return "clear" if meadow(x, y) else "farm"


# ------------------------------------------------------------------ landmarks
def frame(cx, cy, a):
    """Local to world for a landmark standing at (cx, cy), turned by a."""
    ca, sa = math.cos(a), math.sin(a)
    return lambda x, y: (cx + x * ca - y * sa, cy + x * sa + y * ca)


def stand(mb, name, x, y, a=0.0, cover="building"):
    """Stands what mb holds on the ground at (x, y)."""
    return mb.obj(name, (x, y, height(x, y)), a, cover)


def plain(name, colour, rough=0.9):
    M = Mat(name)
    M.base(vary(M, colour, 0.12))
    M.bsdf.inputs["Roughness"].default_value = rough
    MATS[name] = M
    return M


def build_extras():
    """Auental's own materials and scatter prototypes, beside the shared ones. Returns the prototypes."""
    plain("white", (0.72, 0.73, 0.71), 0.5)
    plain("gravel", (0.33, 0.31, 0.27)).bump(MATS["gravel"].noise(MATS["gravel"].coord("Object"), 2.5, 4), 0.5, 0.15)
    M = Mat("glass")  # a greenhouse roof: panes between glazing bars
    o = M._sep(M.coord("Object"))
    bars = M.math("MAXIMUM", M.stripes(o[0], 0.8, 0.12), M.stripes(o[1], 3.0, 0.04))
    M.base(M.mix(M.math("MULTIPLY", bars, 0.8), (0.30, 0.40, 0.40), (0.62, 0.63, 0.60)))
    M.bsdf.inputs["Roughness"].default_value = 0.15
    MATS["glass"] = M
    M = Mat("wagon")  # freight wagons: one livery per wagon
    M.base(M.ramp(M.rand(), [(0.24, 0.10, 0.06), (0.16, 0.12, 0.09), (0.20, 0.21, 0.20), (0.10, 0.15, 0.11), (0.30, 0.16, 0.08)]))
    MATS["wagon"] = M
    P = build_protos()
    mb = MB()  # a covered freight wagon, along local x
    mb.box(0, 0, 0.9, 12.5, 2.9, 2.6, "wagon", top_m="roof_metal")
    mb.box(0, 0, 0.3, 13.6, 2.2, 0.6, "dark")
    P["wagon"] = proto("wagon", mb, "prop")
    for name, colour in (("scorch", (0.03, 0.028, 0.026)), ("ejecta", (0.24, 0.19, 0.13)), ("bowl", (0.06, 0.045, 0.03)), ("rut", (0.065, 0.05, 0.035))):
        plain(name, colour, 0.95)
    mb = MB()  # a burnt-out tank, its turret slewed, along local x
    mb.box(0, 0, 0.3, 6.6, 3.4, 1.2, "burnt")
    for sy in (-1.45, 1.45):
        mb.box(0, sy, 0.0, 6.9, 0.6, 1.0, "dark")
    mb.box(-0.3, 0, 1.5, 2.7, 2.4, 0.8, "burnt", a=0.5)
    mb.box(1.9, 1.1, 1.75, 4.2, 0.26, 0.26, "burnt", a=0.5)
    P["wreck_tank"] = proto("wreck_tank", mb, "prop")
    mb = MB()  # a burnt-out truck: the cab, the bed and the bare hoops of its canvas
    mb.box(2.6, 0, 0.5, 2.0, 2.5, 2.1, "burnt")
    mb.box(-1.0, 0, 0.6, 6.0, 2.5, 0.5, "burnt")
    for k in range(4):
        mb.box(-3.4 + k * 1.6, 0, 1.1, 0.12, 2.5, 1.7, "dark")
    P["wreck_truck"] = proto("wreck_truck", mb, "prop")
    return P


def wall_run(mb, pts, h, m, t=0.5):
    """A wall h high along a local polyline."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        mb.box((x0 + x1) / 2, (y0 + y1) / 2, -1.2, math.hypot(x1 - x0, y1 - y0) + t, t, h + 1.2, m, a=math.atan2(y1 - y0, x1 - x0))


def open_shed(mb, w, L, h, m="roof_metal", ox=0.0):
    """Posts under a long pent roof, open on every side; its length runs along local y."""
    for k in range(int(L / 5.5) + 1):
        for sx in (-1, 1):
            mb.box(ox + sx * (w / 2 - 0.3), -L / 2 + 0.3 + k * (L - 0.6) / int(L / 5.5), -0.5, 0.3, 0.3, h + 0.5, "timber")
    mb.poly([(ox - w / 2 - 0.8, -L / 2 - 0.8, h), (ox + w / 2 + 0.8, -L / 2 - 0.8, h + 1.2),
             (ox + w / 2 + 0.8, L / 2 + 0.8, h + 1.2), (ox - w / 2 - 0.8, L / 2 + 0.8, h)], m)


def hall(name, x, y, a, w, d, wall_h, roof, pitch=16.0, wall="wall"):
    """A long hall, its ridge along its length (local y), with a line of skylights down each slope."""
    mb = MB()
    zr, t = gable(mb, w, d, wall_h, pitch, roof, wall, oh=0.4)
    for k in range(int((d - 6) / 9) + 1):
        for sx in (-1, 1):
            lx, ly, z, dz = sx * w / 4, -d / 2 + 4.5 + k * 9, zr - w / 4 * t + 0.08, 0.9 * t
            mb.poly([(lx - sx * 0.9, ly - 1.5, z + dz), (lx + sx * 0.9, ly - 1.5, z - dz), (lx + sx * 0.9, ly + 1.5, z - dz),
                     (lx - sx * 0.9, ly + 1.5, z + dz)][::sx], "skylight")
    mb.obj(name, (x, y, ground_z(x, y, w, d, a)[0]), a, "building")
    FOOT.append((x, y, max(w, d) / 2))


def pit(name, x, y, r, m, zoff, seed):
    """Worked ground with a ragged edge, about r across, laid on the terrain."""
    verts = [(0, 0, height(x, y) + zoff)]
    n = 48
    for k in range(n):
        c, sn = math.cos(2 * math.pi * k / n), math.sin(2 * math.pi * k / n)
        rr = r * (1 + 0.28 * nz(c, sn, 0.6, seed))
        verts.append((rr * c, rr * sn, height(x + rr * c, y + rr * sn) + zoff))
    return make_obj(name, verts, [(0, 1 + k, 1 + (k + 1) % n) for k in range(n)], [m], loc=(x, y, 0))


def build_dam():
    """The dam in its gorge: a concrete wall across the river on the reservoir side of the dam road, an intake tower in the
    reservoir, white water below the spillway, and the powerhouse at the dam's toe on NATO's bank."""
    _, _, cx, cy, _ = CROSSINGS[-1]
    a = -math.atan(river_dxdy(cy))
    W = frame(cx, cy, a)
    mb = MB()
    mb.box(0, -4, -3.0, 60, 4.0, 5.9, "concrete")  # local x across the river, y downstream (north)
    mb.cyl(-6, -22, -3.0, 3.2, 8.5, "concrete", 12, top_m="roof_flat")  # the intake tower
    mb.box(-6, -13, 2.2, 1.6, 18, 0.3, "metal")  # its gangway from the crest
    mb.obj("dam", (cx, cy, 0.0), a, "wall")
    make_obj("spillway", [(-7, 0, 0.03), (7, 0, 0.03), (5, 16, 0.03), (-5, 16, 0.03)], [(0, 1, 2, 3)], ["foam"],
             loc=(*W(0, 6), 0), rot=a, cover="water")
    px, py = W(-34, 34)
    mb = MB()
    mb.box(0, 0, -4, 13, 24, 13, "concrete", top_m="roof_flat")
    mb.box(0, -15, -4, 9, 6, 9, "concrete", top_m="roof_flat")
    for sx in (-3, 3):  # the penstocks down from the dam
        mb.box(sx, -24, -3, 1.8, 14, 4.5, "metal")
    stand(mb, "powerhouse", px, py, a)
    FOOT.append((px, py, 16))


def build_staudamm():
    """F: the dam works at the west end of the dam road: a fenced substation feeding the high-voltage line, the control
    building and a workshop across the road from it."""
    fx, fy = PT["F"]
    sx, sy, a = fx + 36, fy + 36, -0.03
    flat_patch("substation", sx, sy, 38, 28, a, "gravel", 0.08, cover="open")
    mb = MB()
    for k in (-1, 1):  # two transformers with their radiator banks
        mb.box(k * 9, -5, -0.5, 4.6, 6.5, 5.0, "metal")
        mb.box(k * 9, -9.4, -0.3, 4.0, 1.4, 3.6, "dark")
    for x in (-13, 0, 13):  # the busbar gantry
        mb.box(x, 6, -0.5, 0.5, 0.5, 9.5, "metal")
    mb.box(0, 6, 8.6, 27, 0.5, 0.5, "metal")
    stand(mb, "transformers", sx, sy, a)
    mb = MB()  # chain-link fence, the gate toward the road left open
    wall_run(mb, [(-6, -14), (-19, -14), (-19, 14), (19, 14), (19, -14), (6, -14)], 2.4, "metal", 0.15)
    stand(mb, "substation_fence", sx, sy, a, "wall")
    house("dam_control", fx - 6, fy - 36, a, 10, 18, "modern")
    hall("dam_workshop", fx - 46, fy - 38, a + math.pi / 2, 11, 24, 5.5, "roof_metal")
    FOOT.extend([(sx, sy, 22), (fx - 6, fy - 36, 11)])
    for k in range(4):  # spare pipe sections and cable drums in the works yard
        put("wrap", fx - 24 + rng.uniform(-3, 3), fy - 30 + k * 2.2, 1.3)
    put("car", fx - 20, fy - 44, 1.0)


def build_powerline():
    """Lattice pylons carrying the dam's power west out of the valley, one about every 190 m."""
    step = 19  # _LINE is sampled every 10 m
    for k in range(step // 2, len(_LINE) - 1, step):
        (x, y), (bx, by) = _LINE[k], _LINE[k + 1]
        if max(abs(x), abs(y)) > EXT or on_road(x, y, 6):
            continue
        mb = MB()
        for sx in (-1, 1):
            for sy in (-1, 1):
                mb.box(sx * 2.2, sy * 2.2, -1, 0.5, 0.5, 13, "metal")
        mb.box(0, 0, 11, 1.6, 1.6, 23, "metal")
        for z, w in ((20, 15), (26, 19), (32, 11)):
            mb.box(0, 0, z, 0.6, w, 0.6, "metal")
        stand(mb, f"pylon_{k}", x, y, math.atan2(by - y, bx - x), "prop")


def build_hochwacht():
    """G: the radar station on the summit: a radome on its drum, the operations block, a search radar on a lattice mast,
    generator containers and two bunkers by the road, inside what is left of the perimeter fence."""
    gx, gy = PT["G"]
    flat_patch("radar_apron", gx + 2, gy + 27, 58, 36, 0.0, "yardconc", 0.08, cover="open")
    mb = MB()
    mb.cyl(0, 0, -1, 6.5, 7.5, "concrete", 16)
    blob(mb, 0, 0, 11.5, 8.5, 8.5, 8.5, "white", 1, 0.0, 3)
    stand(mb, "radome", gx - 14, gy + 31)
    mb = MB()
    mb.box(0, 0, -1, 9, 17, 6, "concrete", top_m="roof_flat")
    mb.box(2, 4, 5, 2.4, 2.4, 1.4, "metal")
    stand(mb, "radar_ops", gx + 14, gy + 33, 0.04)
    mb = MB()
    mb.box(0, 0, -1, 1.8, 1.8, 19, "metal")
    mb.box(0, 0, 18, 10, 0.7, 4.0, "metal", a=0.6)  # the search antenna
    stand(mb, "radar_mast", gx + 28, gy + 17, 0.0, "prop")
    for k in range(3):
        mb = MB()
        mb.box(0, 0, -0.3, 6.1, 2.45, 2.9, "container")
        stand(mb, f"radar_gen{k}", gx - 30, gy + 14 + k * 3.4)
    for bx, by, a in ((gx - 24, gy - 21, 0.2), (gx + 27, gy - 23, -0.3)):
        mb = MB()
        mb.box(0, 0, -1, 7, 9, 3.4, "concrete")
        stand(mb, "radar_bunker", bx, by, a)
    mb = MB()  # the fence, flattened in places
    wall_run(mb, [(-34, 9), (-34, 46), (-8, 48)], 2.4, "metal", 0.15)
    wall_run(mb, [(10, 48), (36, 46), (36, 30)], 2.4, "metal", 0.15)
    stand(mb, "radar_fence", gx, gy, 0.0, "wall")
    FOOT.extend([(gx, gy + 27, 34)])
    for _ in range(30):  # scrub round the summit
        x, y = gx + rng.uniform(-66, 66), gy + rng.uniform(-60, 72)
        if math.hypot(x - gx, y - gy - 6) > 50 and not on_road(x, y, 2):
            put("bush" + str(rng.randint(0, 2)), x, y, rng.uniform(1.0, 2.0))


def build_farm_points():
    """A, B, K, L: the rear points' farms, each beside the road through its point. A Kreuzhof: a big farm with its wayside
    cross under two limes. B Lindenhof: walled, limes along the road. K Waldhof: in the forest, with log stacks and a
    high seat. L Birkenhof: a big farm with birches along the road and a solar park behind it."""
    for tag, (x, y, a, big) in (("a", FARM_A), ("b", FARM_B), ("k", FARM_K), ("l", FARM_L)):
        farmstead(tag, x, y, a, big)
    ax, ay = PT["A"]
    mb = MB()
    mb.box(0, 0, -0.5, 1.2, 1.2, 1.3, "stone")
    mb.box(0, 0, 0.8, 0.4, 0.4, 3.4, "stone")
    mb.box(0, 0, 3.0, 1.8, 0.4, 0.4, "stone")
    stand(mb, "wayside_cross", ax + 14, ay - 9, 0.8, "prop")
    for dx, dy in ((19, -5), (11, -15)):
        tree_at(ax + dx, ay + dy, "decid0", 1.25)
    W = frame(*FARM_B[:3])
    mb = MB()  # the farm wall: gates toward the road and out to the fields
    wall_run(mb, [(-27, -6), (-27, -25), (40, -25), (40, -6)], 2.0, "stone", 0.6)
    wall_run(mb, [(40, 6), (40, 29), (-27, 29), (-27, 6)], 2.0, "stone", 0.6)
    stand(mb, "lindenhof_wall", *FARM_B[:2], FARM_B[2], "wall")
    for k in range(6):
        tree_at(*W(-33, -30 + k * 12), "decid0", 1.15)
    W = frame(*FARM_K[:3])
    for lx, ly, L, wd, turn in ((-31, -16, 9, 2.2, 1.57), (-33, 8, 11, 2.2, 1.57), (-8, -30, 10, 1.8, 0.0), (14, 34, 9, 2.2, 0.0),
                                (-30, 26, 8, 1.8, 0.4)):
        log_stack(*W(lx, ly), L, wd, FARM_K[2] + turn)
    mb = MB()  # the high seat on the forest edge
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box(sx * 0.9, sy * 0.9, -0.5, 0.18, 0.18, 5.0, "timber")
    mb.box(0, 0, 4.2, 2.2, 2.2, 1.9, "timber", top_m="roof_metal")
    stand(mb, "high_seat", *W(6, -44), 0.3, "prop")
    W = frame(*FARM_L[:3])
    for k in range(7):
        tree_at(*W(-38, -36 + k * 12), "bare" + str(k % 2), 1.0)
    sx, sy, a = 1010.0, -590.0, 0.1
    mb = MB()  # the solar park: rows tilted to the south
    for r in range(11):
        y0 = -34 + r * 6.2
        mb.poly([(-42, y0, 0.7), (42, y0, 0.7), (42, y0 + 3.4, 2.5), (-42, y0 + 3.4, 2.5)], "solar")
        for x in range(-40, 41, 10):
            mb.box(x, y0 + 2.6, -0.5, 0.15, 0.15, 2.6, "metal")
    stand(mb, "solar_park", sx, sy, a, "prop")
    FOOT.append((sx, sy, 50))


def build_ziegelei():
    """C: the brickworks south of the road: the kiln hall and its chimney, open drying sheds, stacked bricks in the yard,
    the office, and the clay pit beyond."""
    cx, cy, a = -552.0, 520.0, -1.40  # local x away from the road, y along it
    W = frame(cx, cy, a)
    hall("kiln", cx, cy, a, 16, 52, 7, "roof_tile", 30)
    mb = MB()
    mb.box(0, 0, -1, 4.6, 4.6, 5, "chimney")
    mb.cyl(0, 0, 3.5, 1.7, 34, "chimney", 10)
    stand(mb, "kiln_chimney", *W(12, 22))
    for k in range(3):
        mb = MB()
        open_shed(mb, 8, 40, 4.2, "roof_tile" if k else "roof_metal")
        stand(mb, f"drying_shed{k}", *W(18 + 11 * k, -4), a)
    flat_patch("brick_yard", *W(4, -46), 46, 26, a, "yardconc", 0.08, cover="open")
    mb = MB()
    for i in range(8):
        for j in range(4):
            if rng.random() < 0.7:
                mb.box(-19 + i * 5.4, -8 + j * 5.2, -0.3, 4.2, 2.2, rng.choice((1.4, 1.4, 2.6)), "chimney")
    stand(mb, "brick_stacks", *W(5, -46), a, "wall")
    house("ziegelei_office", *W(-9, 34), a, 8, 11, "house")
    pit("clay_pit", -640, 452, 34, "sand", 0.09, 1.3)
    pit("clay_pit_floor", -644, 449, 19, "manure", 0.11, 2.1)
    for dx, dy in ((-18, 12), (9, -14)):
        put("car", -640 + dx, 452 + dy, 1.5)
    FOOT.extend([(*W(30, -4), 24), (*W(4, -46), 22), (*W(-9, 34), 7), (-640, 452, 36)])


def build_kieswerk():
    """J: the gravel works north of the road: the screening tower with conveyors out to the graded heaps, hoppers over
    the loading lane, the weighbridge office, and the worked-out pit beyond."""
    cx, cy, a = 552.0, -520.0, -1.40 + math.pi  # the brickworks' half turn: local x away from the road
    W = frame(cx, cy, a)
    pit("kieswerk_yard", *W(14, 2), 46, "gravel", 0.08, 3.3)
    heaps = [(24, -26, 13, 7.5), (33, 6, 11, 6.5), (22, 32, 12, 7), (44, -8, 9, 5)]
    mb = MB()
    for k, (hx, hy, r, h) in enumerate(heaps):
        blob(mb, hx, hy, -0.3, r, r, h, "sand" if k == 1 else "gravel", 5 + k, 0.2, 2)
    stand(mb, "gravel_heaps", cx, cy, a, "wall").data.polygons.foreach_set("use_smooth", [True] * (len(heaps) * 80))
    mb = MB()
    mb.box(0, 0, -1, 8, 9, 15, "metal", top_m="roof_metal")
    for hx, hy, r, h in heaps[:3]:  # a conveyor rising from the tower to the top of each heap
        L = math.hypot(hx, hy)
        nx, ny = -hy / L * 0.8, hx / L * 0.8
        mb.poly([(nx, ny, 12), (-nx, -ny, 12), (hx - nx, hy - ny, h + 2.5), (hx + nx, hy + ny, h + 2.5)], "dark")
        mb.box(hx / 2, hy / 2, -0.5, 0.4, 0.4, (12 + h + 2.5) / 2 + 0.5, "metal")
    stand(mb, "screening_tower", cx, cy, a)
    for k in range(3):
        mb = MB()
        mb.cyl(0, 0, 2.5, 2.7, 7.5, "metal", 14)
        for sx in (-1, 1):
            for sy in (-1, 1):
                mb.box(sx * 1.9, sy * 1.9, -0.5, 0.35, 0.35, 3.2, "metal")
        stand(mb, f"hopper{k}", *W(-12, -14 + k * 6.6))
    house("kieswerk_office", *W(-12, 30), a, 7, 10, "shed")
    pit("gravel_pit", 640, -452, 38, "gravel", 0.09, 4.2)
    pit("gravel_pit_floor", 636, -449, 22, "sand", 0.11, 5.4)
    for wx, wy, s in ((*W(-20, -2), 1.6), (*W(-20, 9), 1.6), (628, -440, 1.5)):
        put("car", wx, wy, s)
    FOOT.extend([(cx, cy, 44), (640, -452, 40)])


def build_obstgut():
    """D: the orchard estate east of the crossroads: a hip-roofed manor with two wings behind its forecourt and garden
    wall, the orchard in rows to the north, greenhouses to the south, and the rail halt where the road west meets the line."""
    dx, dy = PT["D"]
    mx, my, a = dx + 48, dy + 28, 0.5
    W = frame(mx, my, a)
    mb = MB()
    gable(mb, 13, 26, 9, 38, "roof_slate", hip=True)
    for sy in (-1, 1):
        gable(mb, 9, 10, 6.5, 38, "roof_slate", ox=3, oy=sy * 17.5)
    mb.obj("manor", (mx, my, ground_z(mx, my, 16, 46, a)[0]), a, "building")
    flat_patch("manor_court", *W(-14, 0), 14, 34, a, "yardconc", 0.08, cover="open")
    mb = MB()
    wall_run(mb, [(-6, -25), (24, -25), (24, 25), (-6, 25)], 2.0, "stone", 0.5)
    stand(mb, "manor_wall", mx, my, a, "wall")
    FOOT.append((mx, my, 26))
    for lx, ly in ((-22, -18), (-22, 18)):
        tree_at(*W(lx, ly), "decid0", 1.2)
    for i in range(-12, 13):  # the orchard, in rows square to the manor
        for j in range(-9, 10):
            x, y = frame(dx + 45, dy + 100, a)(i * 8.0 + rng.uniform(-0.8, 0.8), j * 8.0 + rng.uniform(-0.8, 0.8))
            if (i / 12) ** 2 + (j / 9) ** 2 < 1 + 0.2 * nz(x, y, 40, 1.1) and zone(x, y) == "clear" and free(x, y, 3) and rng.random() < 0.92:
                put("fruit", x, y, rng.uniform(0.8, 1.15))
    gx, gy, ga = dx - 14, dy - 46, -0.25
    for k in (-1, 0, 1):
        mb = MB()
        gable(mb, 8, 30, 2.6, 24, "glass", "glass", oh=0.0, z0=-0.5)
        stand(mb, f"greenhouse{k}", *frame(gx, gy, ga)(k * 9.5, 0), ga)
    FOOT.append((gx, gy, 20))
    _, (hx, hy), ha = rail_at(-612, -556)
    H = frame(hx, hy, ha)  # local x down the line, y to its left
    flat_patch("halt_platform", *H(0, 4.8), 50, 4.0, ha, "yardconc", 0.3, cover="open")
    mb = MB()
    open_shed(mb, 3.2, 10, 2.8)
    stand(mb, "halt_shelter", *H(0, 8.6), ha - math.pi / 2)


def build_bahnhof():
    """I: the station between the point and the main line: the station building and its platform canopy, the goods shed up
    the line, a signal box, the water tower, and freight wagons left on the two sidings."""
    _, (rx, ry), ra = rail_at(*_RAIL[_STATION])
    W = frame(rx, ry, ra)  # local x down the line (south-west), y to its left: the point's side
    along = ra - math.pi / 2  # turns a building's length along the line
    flat_patch("platform", *W(-5, 5.3), 90, 4.6, ra, "yardconc", 0.3, cover="open")
    mb = MB()
    gable(mb, 9, 26, 7.5, 40, "roof_slate")
    gable(mb, 7, 9, 6, 40, "roof_slate", oy=-17)
    open_shed(mb, 3.0, 30, 3.4, ox=-7.2)
    sx, sy = W(8, 14.5)
    mb.obj("station", (sx, sy, ground_z(sx, sy, 9, 36, along)[0]), along, "building")
    hall("goods_shed", *W(-78, 14), along, 10, 30, 5.5, "roof_tile", 28, "timber")
    flat_patch("goods_ramp", *W(-78, 6.8), 34, 4.2, ra, "yardconc", 0.6, cover="open")
    mb = MB()
    mb.box(0, 0, -1, 4, 6, 6.5, "wall")
    mb.box(0, 0, 5.5, 5, 7, 2.4, "timber", top_m="roof_slate")
    stand(mb, "signal_box", *W(52, 8), along)
    mb = MB()
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box(sx * 2.2, sy * 2.2, -1, 0.5, 0.5, 12, "metal")
    mb.cyl(0, 0, 10.5, 4.2, 5.5, "metal", 14, top_m="roof_metal")
    stand(mb, "water_tower", *W(-18, -24))
    FOOT.extend([(sx, sy, 16), (*W(-18, -24), 5)])
    for kind, pts in ROAD_PTS:  # wagons on the sidings: every siding leaves the main line and rejoins it
        if kind != "rail" or len(pts) > 400:
            continue
        for k in range(22, len(pts) - 22, 7):
            (x0, y0), (x1, y1) = pts[k], pts[k + 1]
            if rng.random() < 0.72:
                put("wagon", x0, y0, 1.0, math.atan2(y1 - y0, x1 - x0), 0.3)
    for lx in (-30, -8, 24, 38):
        put("car", *W(lx, 21), 1.0, ra + rng.choice((0, math.pi)))


def build_town():
    """The twin town: Unterau on NATO's bank, with its church and town hall on the square at E, and Oberau on the Warsaw
    Pact's, with warehouses and a container yard round the square at H; rows of houses along the streets of both, and the
    football ground on Oberau's edge."""
    (ex, ey), (hx, hy) = PT["E"], PT["H"]
    disc_patch("square_w", ex, ey, 22, "cobble", 0.12)
    disc_patch("square_e", hx, hy, 22, "yardconc", 0.12)
    church(ex + 38, ey + 40, 0.2)
    mb = MB()  # the town hall: a slate roof with a clock turret
    zr, _ = gable(mb, 11, 18, 9, 45, "roof_slate")
    mb.box(0, 0, zr - 1, 2.4, 2.4, 5, "wall", top_m="roof_slate")
    tx, ty = ex - 12, ey + 33
    mb.obj("town_hall", (tx, ty, ground_z(tx, ty, 11, 18, 0.5)[0]), 0.5, "building")
    FOOT.append((tx, ty, 11))
    for dx, dy in ((-18, 6), (16, 10), (4, -19)):
        tree_at(ex + dx, ey + dy, "decid0", 1.2)
    hall("warehouse0", hx - 34, hy - 44, 0.2, 18, 40, 8, "roof_metal")
    hall("warehouse1", hx + 16, hy - 46, 0.35, 16, 34, 7.5, "roof_metal")
    hall("warehouse2", hx - 30, hy + 38, 1.2, 15, 30, 7, "roof_flat", 8)
    flat_patch("container_yard", hx - 12, hy - 52, 24, 40, 0.25, "yardconc", 0.08, cover="open")
    Y = frame(hx - 10, hy - 50, 0.25)
    for i in range(3):
        for j in range(5):
            if rng.random() < 0.7:
                mb = MB()
                mb.box(0, 0, -0.3, 2.45, 6.1, 2.9 * rng.choice((1, 1, 2)), "container" if rng.random() < 0.5 else "wagon")
                stand(mb, "container", *Y(-4 + i * 3.6, -14 + j * 7), 0.25)
    for lx, ly in ((8, -28), (9, 2), (-9, 16)):
        put("car", *Y(lx, ly), 1.7, 0.25 + math.pi / 2)
    FOOT.append((hx - 12, hy - 52, 16))
    for west in (True, False):
        s = 1 if west else -1
        build_houses(lambda x, y, k=1.0, west=west: (x < river_x(y)) == west and in_town(x, y, k),
                     (s * TOWN[0], s * TOWN[1], TOWN[3], TOWN[3]), bank(8), bank(6))
    px, py, a = 330.0, 15.0, 0.05  # the football ground
    W = frame(px, py, a)
    flat_patch("pitch", px, py, 100, 64, a, "f_meadow", 0.08, cover="open")
    for lx, ly, w, d in ((0, 32, 100, 0.5), (0, -32, 100, 0.5), (-50, 0, 0.5, 64), (50, 0, 0.5, 64), (0, 0, 0.5, 64),
                         (-42, 0, 0.5, 36), (42, 0, 0.5, 36), (-46, 18, 8, 0.5), (-46, -18, 8, 0.5), (46, 18, 8, 0.5), (46, -18, 8, 0.5)):
        flat_patch("pitch_line", *W(lx, ly), w, d, a, "wrap", 0.1)
    house("clubhouse", *W(-20, -42), a + math.pi / 2, 7, 16, "shed")
    FOOT.append((px, py, 58))


def build_farmsteads():
    """Lone farms through the farmland, and hamlets out in the surroundings."""
    for k, (x, y, a) in enumerate(FARMS):
        if free(x, y, 24, 1.0) and woods_val(x, y) < 0.4:
            (burnt_farm if k in BURNT else farmstead)(f"f{k}", x, y, a)
    if not OUTER:
        return
    for k, (hx, hy, ha) in enumerate([(-2400, 1100, 0.3), (2100, -2500, -0.2), (-2000, -1500, 0.9), (2500, 1700, 0.1),
                                      (-2900, -2300, -0.6), (700, 2300, 0.5), (2800, -700, 0.2), (-1500, 2700, 1.0)]):
        if not free(hx, hy, 30):
            continue
        farmstead(f"o{k}", hx, hy, ha)
        for j in range(14):
            x, y = hx + rng.uniform(-110, 110), hy + rng.uniform(-110, 110)
            if free(x, y, 7):
                house(f"oh{k}_{j}", x, y, ha + rng.choice((0, math.pi / 2)), rng.uniform(9, 11), rng.uniform(11, 14))
                FOOT.append((x, y, 7))


BURNT = (1, 7, 14, 15)  # the lone farms (indices into FARMS) that burned: a pair on each bank


def burnt_farm(tag, cx, cy, a):
    """A farm that burned: roofless walls round the yard, breached, a few charred rafters, rubble, scorched ground."""
    W = frame(cx, cy, a)
    pit(f"scorch_{tag}", cx, cy, 30, "scorch", 0.075, cx)
    for i, ((x, y), w, d, da) in enumerate((((-16.5, 0), 11, 16, 0.0), ((17.5, 0), 13, 34, 0.0), ((0, 19), 12, 22, math.pi / 2))):
        mb = MB()
        wall_run(mb, [(-w / 2, -d / 2 + 4), (-w / 2, d / 2), (w / 2, d / 2), (w / 2, -d / 2), (-w / 2 + 3, -d / 2)],
                 rng.uniform(3.0, 5.5), "burnt", 0.4)
        for k in range(int(d / 3)):
            if rng.random() < 0.45:
                mb.box(0, -d / 2 + 2 + k * 3, rng.uniform(2.5, 4.5), w, 0.25, 0.25, "burnt", a=rng.uniform(-0.3, 0.3))
        stand(mb, f"ruin_{tag}_{i}", *W(x, y), a + da, "wall")
    for _ in range(14):
        put("grave", *W(rng.uniform(-24, 26), rng.uniform(-12, 26)), rng.uniform(0.8, 1.8))
    FOOT.append((cx, cy, 26))


def crater(x, y, r):
    """A shell hole: thrown earth round a scorched bowl, standing water in some. Painted on the ground: no cover."""
    pit("ejecta", x, y, 1.7 * r, "ejecta", 0.09, x)
    pit("crater", x, y, r, "bowl", 0.11, y)
    if rng.random() < 0.25:
        pit("crater_water", x, y, 0.55 * r, "water", 0.13, x + y)


def ruts(name, pts):
    """A tracked vehicle's two ruts along a spline, pressed into fields and meadows wherever it left the road: no cover."""
    line = catmull(pts, 3.0)
    verts, faces = [], []
    for side in (-1.35, 1.35):
        b = len(verts)
        for i, (x, y) in enumerate(line):
            (ax, ay), (bx, by) = line[max(0, i - 1)], line[min(len(line) - 1, i + 1)]
            t = Vector((bx - ax, by - ay)).normalized()
            for w in (side - 0.35, side + 0.35):
                px, py = x - t.y * w, y + t.x * w
                verts.append((px, py, height(px, py) + 0.1))
        open_ = [zone(x, y) in ("farm", "clear", "bank", "road") for x, y in line]  # not through water, woods or the town
        faces += [(b + 2 * i, b + 2 * i + 2, b + 2 * i + 3, b + 2 * i + 1) for i in range(len(line) - 1) if open_[i] and open_[i + 1]]
    make_obj(name, verts, faces, ["rut"])


def build_war():
    """What the fighting has left outside the town: shell holes thick toward the crossings and the armour points, the ruts
    of tank columns from each HQ to its fords, burnt-out tanks and a shot-up convoy, cars abandoned on the road out of town,
    a crashed helicopter and wagons off the rails at the halt. Each bank gets its twin's share, never its twin's copy."""
    if OUTER:
        return
    hot = [(x, y) for _, _, x, y, _ in CROSSINGS] + [PT[i] for i in "CDIJ"]
    n = 0
    for _ in range(4000):  # shell holes, in clusters
        cx, cy = rng.uniform(-HALF, HALF), rng.uniform(-HALF, HALF)
        near = min(math.hypot(cx - hx, cy - hy) for hx, hy in hot)
        if rng.random() > 0.04 + 0.5 * math.exp(-near / 160) or near < 40:
            continue
        for _ in range(rng.randint(2, 7)):
            x, y, r = cx + rng.gauss(0, 16), cy + rng.gauss(0, 16), rng.uniform(1.4, 4.2)
            if zone(x, y) in ("farm", "clear", "road") and not clearing(x, y) and not near_crossing(x, y, 35) and free(x, y, r):
                crater(x, y, r)
                n += 1
    log(f"  craters: {n}")
    # tank columns: NATO's routes, fixed where they take a ford; the Warsaw Pact's are their half turns, wandering their own way
    routes = [
        [(-1050, -10), (-860, 140), (-640, 420), (-470, 600), (-330, 690), (-215, 722, 1), (-165, 718, 1), (-40, 690), (190, 620), (400, 530)],
        [(-1050, -70), (-830, -260), (-600, -420), (-450, -505), (-300, -600), (-60, -690), (165, -722, 1), (215, -718, 1), (330, -690), (500, -580)],
        [(-430, -480), (-520, -380), (-610, -250), (-520, -140), (-380, -200), (-330, -330), (-400, -450)],
        [(-900, 440), (-760, 330), (-560, 300), (-420, 250), (-330, 120)],
    ]
    for k, route in enumerate(routes + [[(-x, -y, *f) for x, y, *f in r] for r in routes]):
        for lane in range(3 if k % 4 < 2 else 1):
            j = lambda f: rng.uniform(-3, 3) if f else rng.uniform(-16, 16)  # noqa: E731
            ruts(f"ruts_{k}_{lane}", [(x + j(f), y + j(f)) for x, y, *f in route])

    def wreck(kind, x, y, a):
        pit("wreck_scorch", x, y, 5.5, "scorch", 0.1, x)
        put(kind, x, y, 1.0, a)

    for x, y in ((-245, 706), (-560, -455), (-310, 68), (-700, 60), (-120, -690), (-470, 380)):  # tanks, and their twins
        wreck("wreck_tank", x + rng.uniform(-6, 6), y + rng.uniform(-6, 6), rng.uniform(0, 6.3))
        wreck("wreck_tank", -x + rng.uniform(-6, 6), -y + rng.uniform(-6, 6), rng.uniform(0, 6.3))
    for road in (1, 2):  # a convoy caught on each valley road, between the HQ and the rear point
        pts = ROAD_PTS[road][1]
        for k in range(5):
            (x, y), (bx, by) = pts[70 + k * 6], pts[71 + k * 6]
            t = Vector((bx - x, by - y)).normalized()
            if rng.random() < 0.85:
                wreck("wreck_truck", x - t.y * 4.6, y + t.x * 4.6, math.atan2(t.y, t.x) + rng.uniform(-0.5, 0.5))
    pts = ROAD_PTS[0][1]  # cars left on the verge of the main road, pointing away from the town
    for i in range(0, len(pts) - 1, 9):
        (x, y), (bx, by) = pts[i], pts[i + 1]
        if 240 < abs(x) < 720 and rng.random() < 0.45:
            t = Vector((bx - x, by - y)).normalized() * (1 if x > 0 else -1)
            put("car", x - t.y * 4.9, y + t.x * 4.9, 1.0, math.atan2(t.y, t.x) + rng.uniform(-0.4, 0.4))
    hx, hy, ha = 215.0, 330.0, 0.9  # the crashed helicopter
    pit("heli_scorch", hx, hy, 11, "scorch", 0.1, 7.7)
    mb = MB()
    mb.box(0, 0, 0.2, 8.5, 2.3, 2.0, "burnt")
    mb.box(-7.5, 0.6, 0.8, 7.5, 0.6, 0.6, "burnt", a=-0.15)
    for a in (0.4, 2.3):
        mb.box(3 * math.cos(a), 3 * math.sin(a), 2.3, 9, 0.5, 0.1, "dark", a=a)
    stand(mb, "heli_wreck", hx, hy, ha, "prop")
    _, (rx, ry), ra = rail_at(-612, -556)  # wagons off the rails below the halt
    H = frame(rx, ry, ra)
    for lx, ly, da in ((-34, -1.0, 0.2), (-47, -4.5, 0.55), (-61, -3.0, -0.3)):
        put("wagon", *H(lx, ly), 1.0, ra + da, 0.2)


def build_avenue():
    """Roadside trees along the main road, as on any German Allee: cover beside the road, clear of the carriageway."""
    pts = ROAD_PTS[0][1]
    for i in range(4, len(pts) - 1, 8):
        (x, y), (bx, by) = pts[i], pts[i + 1]
        t = Vector((bx - x, by - y)).normalized()
        for side in (-1, 1):
            px, py = x - t.y * 9.5 * side, y + t.x * 9.5 * side
            if zone(px, py) in ("farm", "clear") and not clearing(px, py) and rdist(px, py) > bank(14) and rng.random() < 0.85:
                tree_at(px, py, s=rng.uniform(0.85, 1.0))


def build_turbines():
    """Three wind turbines on the south-east upland, beyond the Play Area: 2034's skyline, and its longest shadows."""
    for k, (x, y, a) in enumerate(((1130, -1120, 0.5), (1010, -1195, 0.7), (1195, -975, 0.4))):
        mb = MB()
        mb.cyl(0, 0, -1, 2.1, 91, "white", 12)
        mb.box(1.5, 0, 89, 10, 3.6, 3.6, "white")
        stand(mb, f"turbine{k}", x, y, a, "prop")
        mb = MB()
        for b in range(3):
            th = 0.5 + k + 2 * math.pi * b / 3
            mb.poly([(4.6, 0, 90.8), (7.4, 0, 90.8), (6.3, 44 * math.cos(th), 90.8 + 44 * math.sin(th)),
                     (5.7, 44 * math.cos(th), 90.8 + 44 * math.sin(th))], "white")
        stand(mb, f"turbine{k}_rotor", x, y, a, None)


FIELD_TYPES = [("f_plough", 0.32), ("f_winter", 0.26), ("f_stubble", 0.18), ("f_maize", 0.1), ("f_meadow", 0.14)]
FRAMES = [0.21, -0.35, 0.6, -0.14, 0.42, -0.5]


def frame_of(x, y):
    """Field blocks turned against each other: by Lane band and by river bank."""
    band = 2 if y > 250 + 0.15 * x else 0 if y < -250 + 0.15 * x else 1
    return 2 * band + (x > river_x(y))


def build_fields():
    """Parcels on the farmland, bigger on the surroundings: orchards round the twin town, bales on some stubble, and
    hedgerows that thicken into bocage in places and thin out on the armour ground round D and I."""
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
        orchard = all(in_town(*p, 1.5) for p in ps)  # zone() already keeps the parcel out of the town itself
        if orchard:
            typ = "f_meadow"
        flat_patch(f"field_{n}", cx, cy, w, d, a, typ, 0.07, step=6.0 * k, cover="open")
        n += 1

        def P(x, y):
            return cx + x * ca - y * sa, cy + x * sa + y * ca

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
        armour = min(math.hypot(cx - px, cy - py) for px, py in (PT["D"], PT["I"]))
        hedge_p = 0.08 if OUTER else (0.05 + 0.4 * sstep(-0.1, 0.35, nz(cx, cy, 380, 4.4))) * sstep(180, 420, armour)
        corners = [P(-w / 2 - 1.2, -d / 2 - 1.2), P(w / 2 + 1.2, -d / 2 - 1.2), P(w / 2 + 1.2, d / 2 + 1.2), P(-w / 2 - 1.2, d / 2 + 1.2)]
        for e in range(4):
            if rng.random() < hedge_p:
                hedge_line([corners[e], corners[(e + 1) % 4]], gap=True)

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
    P = build_extras()
    log("landmarks")
    build_hq("nato", *HQS["nato"], 0.05, HQ_RADIUS / 35)
    build_hq("pact", *HQS["pact"], -0.12, HQ_RADIUS / 35)
    for side in HQS:  # what the bigger compound adds to the motor pool: a pad under each helicopter, a tent line at the back
        for k, (dx, dy) in enumerate(HQ_PADS):
            pad = hq_slot(side, dx, dy)
            disc_patch(f"helipad_{side}{k}", pad["x"], pad["y"], 8.5, "yardconc", 0.14)
        for k in range(6):
            tent = hq_slot(side, -50, -40 + k * 16)
            mb = MB()
            gable(mb, 5.5, 9, 1.8, 35, "canvas", "canvas", oh=0.2, z0=-0.5)
            stand(mb, f"hq_{side}_line{k}", tent["x"], tent["y"], math.pi / 2)
    build_crossings()
    build_dam()
    build_staudamm()
    build_powerline()
    build_hochwacht()
    build_farm_points()
    build_ziegelei()
    build_kieswerk()
    build_obstgut()
    build_bahnhof()
    build_turbines()
    log("town")
    build_town()
    build_farmsteads()
    log("fields")
    build_fields()
    log("avenue, banks, woods")
    build_avenue()
    build_banks()
    build_poles()
    build_woods()
    log("war")
    build_war()
    finish(P, meta())


main()
