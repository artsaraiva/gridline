"""Kaltenbach, the Skirmish slice map (#30). Headless Blender script; it is the map's source of truth
(ADR 0001, ADR 0002) and its outputs are committed.

Builds the slice layout from #25 (fords at y = +-230 per #26) on top of the look-dev scene from #23:
a 640 m Hessian river valley across the inner German border in late autumn. NATO HQ west, Warsaw Pact
HQ east, Capture Points on the border spine at E2, E5, E8, a 12 m river S-curve with 5 crossings,
woodland Lane north, split village centre, farmland Lane south, an overwatch hill on each attacker's bank.
Gameplay features match under a 180 degree rotation about the map centre: the river, roads, crossings,
hills and the village are built once in the west half and copied turned 180 degrees (see twin()).

Run from the repo root (assets/maps/kaltenbach/bake.sh runs the full bake):
  blender -b --factory-startup -Y --python-exit-code 1 -P assets/maps/kaltenbach/build.py -- MODE [PREVIEW_RES] [SAMPLES]
  MODE play     map.json, 1 m data render, 8192 render, WebP mip chain, previews
       preview  everything play writes except the mips, at PREVIEW_RES (1024), into work/ for iterating
       outer    the low-detail surroundings out to 1.92 km, 2048 WebP
"""
import json
import math
import os
import random
import sys
import time
from collections import defaultdict

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector, kdtree, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODE = argv[0] if argv else "preview"
# play and outer sizes are fixed: map.json lists those files and the mip chain needs a power of two
RES = {"play": 8192, "outer": 2048}.get(MODE) or (int(argv[1]) if len(argv) > 1 else 1024)
SAMPLES = int(argv[2]) if len(argv) > 2 else (16 if MODE == "preview" else 32)
SUN_ELEV = 24.0

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
WORK = os.path.join(HERE, "work")  # large intermediates and preview runs, not committed
OUT = WORK if MODE == "preview" else os.path.join(REPO, "public", "maps", "kaltenbach")  # what the game loads
PREV = WORK if MODE == "preview" else os.path.join(HERE, "previews")  # small images for review
for d in (OUT, PREV, WORK):
    os.makedirs(d, exist_ok=True)
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene
rng = random.Random(7)
HALF = 320.0
OUTER = MODE == "outer"
EXT = 960.0 if OUTER else HALF

# ------------------------------------------------------------------ layout (#25, #26)
# Metres, origin at map centre, x east, y north. Shapes are odd functions so they match under rotation.
PLAY_AREA = [(-172, 298), (298, 298), (298, -172), (172, -298), (-298, -298), (-298, 172)]
HQS = {"nato": (-277.0, 0.0), "pact": (277.0, 0.0)}
HQ_RADIUS = 25.0
POINTS = [("A", 0.0, 200.0), ("B", 0.0, 0.0), ("C", 0.0, -200.0)]
POINT_RADIUS = 25.0
FORD_Y, FOOT_Y, FORD_HW, FOOT_HW, BRIDGE_HW = 230.0, 140.0, 6.5, 1.5, 4.0


def river_x(y):
    return 70 * math.sin(math.pi * y / 400)


def river_dxdy(y):
    return 70 * math.pi / 400 * math.cos(math.pi * y / 400)


def road_y(x):
    return 12 * math.sin(math.pi * x / 280)


def kolonne_x(y):
    return 1.5 * math.sin(y / 40)


CROSSINGS = [("NF", "ford", river_x(FORD_Y), FORD_Y, FORD_HW), ("NB", "footbridge", river_x(FOOT_Y), FOOT_Y, FOOT_HW),
             ("C", "bridge", 0.0, 0.0, BRIDGE_HW), ("SB", "footbridge", river_x(-FOOT_Y), -FOOT_Y, FOOT_HW),
             ("SF", "ford", river_x(-FORD_Y), -FORD_Y, FORD_HW)]


# ---------------------------------------------------------------- terrain math
def sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def nz(x, y, s, z=0.0):
    return noise.noise(Vector((x / s, y / s, z)))


def sym(f, x, y):
    """f made symmetric under the 180 degree rotation (only inside the map; the surroundings stay free)."""
    w = sstep(HALF + 10, HALF + 60, max(abs(x), abs(y)))
    return (1 - w) * 0.5 * (f(x, y) + f(-x, -y)) + w * f(x, y)


def rdist(x, y):
    return abs(x - river_x(y)) / math.sqrt(1 + river_dxdy(y) ** 2)


def bump(x, y, bx, by, r, h):
    r2 = ((x - bx) ** 2 + (y - by) ** 2) / (r * r)
    return h * (1 - r2) ** 2 if r2 < 1 else 0.0


def ground(x, y):
    """Valley rising ~18 m from the river toward each HQ edge, an overwatch hill on each attacker's bank, soft relief."""
    d = rdist(x, y)
    u = min(d / 290, 1.0)
    h = 0.8 + 18 * u * u * (3 - 2 * u)
    h += bump(x, y, 175, 215, 80, 13) + bump(x, y, -175, -215, 80, 13)
    h += sstep(10, 45, d) * sym(lambda a, b: 1.4 * nz(a, b, 90, 1.7) + 0.5 * nz(a, b, 31, 5.1), x, y)
    far = max(abs(x), abs(y))
    if far > HALF:  # rolling hills beyond the map
        h += 16 * sstep(HALF, HALF + 400, far) * (0.6 + nz(x, y, 420, 8.8))
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
def _main_road():
    xs = np.arange(-EXT - 12, EXT + 12.1, 2.0)
    return [(float(x), road_y(x)) for x in xs]


def _kolonne(y0, y1):
    ys = np.arange(y0, y1 + 0.1, 2.0)
    return [(kolonne_x(y), float(y)) for y in ys]


def _pair(kind, pts):
    """A road and its copy turned 180 degrees."""
    return [(kind, pts), (kind, [(-x, -y) for x, y in pts])]


ROADS = [("main", _main_road()), ("kolonne", _kolonne(76, EXT + 12)), ("kolonne", _kolonne(-EXT - 12, -76))]
# farm track from each HQ through the ford it attacks over to the enemy's home-bank point
ROADS += _pair("track", [(-262, -12), (-200, -90), (-140, -200), (river_x(-FORD_Y) - 18, -228), (-50, -232), (-33, -203)])
# forest/farm track from each HQ to its own home-bank point
ROADS += _pair("track", [(-262, 14), (-190, 120), (-110, 186), (-47, 202)])
# village streets
ROADS += _pair("minor", [(-38, road_y(-38)), (-42, 40), (-52, 78)])
ROADS += _pair("minor", [(-74, road_y(-74)), (-78, 40), (-86, 74)])
# NATO's covered approach south: a path in the wood strip to the footbridge, then a sunken track to the farmstead
ROADS += [("path", [(-290, -140), (-160, -141), (river_x(-FOOT_Y) - 8, -FOOT_Y)]),
          ("path", [(river_x(-FOOT_Y) + 8, -FOOT_Y), (-40, -160), (-24, -178), (-4, -173)])]
# Pact's covered approach north: a woodland path from the north footbridge to the sawmill
ROADS += [("path", [(river_x(FOOT_Y) + 8, FOOT_Y), (150, 150), (230, 120)]),
          ("path", [(river_x(FOOT_Y) - 8, FOOT_Y), (35, 160), (20, 180)])]
# tracks along the cut corners, just outside the Play Area
ROADS += _pair("track", [(-312, 166), (-166, 312)])
HALFW = {"main": 3.4, "minor": 2.7, "track": 1.7, "kolonne": 1.7, "path": 1.0}
ZOFF = {"main": 0.24, "minor": 0.22, "track": 0.2, "kolonne": 0.2, "path": 0.18}


def catmull(pts, step=2.0):
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = (Vector(q) for q in p[i - 1:i + 3])
        n = max(1, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(Vector(pts[-1]))
    return [(v.x, v.y) for v in out]


if OUTER:
    ROADS += [("minor", catmull([(-EXT, -420), (-700, -380), (-450, -300), (-292, -12)])),
              ("minor", catmull([(EXT, 420), (700, 380), (450, 300), (292, 12)])),
              ("minor", catmull([(-600, EXT), (-560, 600), (-520, 200), (-540, -300), (-500, -EXT)])),
              ("minor", catmull([(620, -EXT), (560, -500), (600, 0), (580, 500), (640, EXT)]))]
ROAD_PTS = [(kind, catmull(pts) if kind not in ("main", "kolonne") else pts) for kind, pts in ROADS]
RS = []
for kind, pts in ROAD_PTS:
    for x, y in pts:
        RS.append((x, y, HALFW[kind], kind))
KD = kdtree.KDTree(len(RS))
for i, (x, y, _, _) in enumerate(RS):
    KD.insert((x, y, 0), i)
KD.balance()


def on_road(x, y, margin=0.0):
    for _, i, d in KD.find_range((x, y, 0), 4.6 + margin):
        if d < RS[i][2] + margin:
            return True
    return False


def road_near(x, y):
    co, i, d = KD.find((x, y, 0))
    return i, d


def road_tangent(i):
    a = RS[max(0, i - 1)]
    b = RS[min(len(RS) - 1, i + 1)]
    if a[3] != b[3]:
        a, b = RS[i], RS[min(len(RS) - 1, i + 1)]
    t = Vector((b[0] - a[0], b[1] - a[1]))
    return t.normalized() if t.length > 0 else Vector((1, 0))


# ----------------------------------------------------------------------- zones
def wob(x):
    return 5 * math.sin(x / 23) + 3 * math.sin(x / 9 + 1)


def lane(x, y):
    if y > 105 + wob(x):
        return "north"
    if y < -100 + wob(x):
        return "south"
    return "centre"


def in_village(x, y, s=1.0):
    return (abs(x) / (84 * s)) ** 4 + (abs(y) / (78 * s)) ** 4 < 1


def near_crossing(x, y, pad):
    return any(math.hypot(x - cx, y - cy) < hw + pad for _, _, cx, cy, hw in CROSSINGS)


WOOD_BLOBS = [(-700, 300, 190), (-450, -780, 210), (250, 760, 200), (-880, -450, 150), (820, 820, 150),
              (720, -320, 130), (60, -720, 120), (-300, 650, 120), (900, 250, 120), (-560, 520, 110)]


def woods_val(x, y):
    w = sum(math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (r * r)) for bx, by, r in WOOD_BLOBS)
    return 0.9 * w + 0.35 * nz(x, y, 45, 2.2) + 0.2 * nz(x, y, 150, 4.1)


def clearing(x, y):
    """Open ground inside the Lanes: HQs, the north point's sawmill, the hilltops, the open approaches to the fords."""
    w = wob(x)
    if any(abs(x - hx) < 27 and abs(y - hy) < 27 for hx, hy in HQS.values()):
        return True
    if (x / 46) ** 2 + ((y - 200) / 36) ** 2 < 1 or abs(x) < 34 and abs(y + 202) < 31:
        return True
    if (x - 175) ** 2 + (y - 215) ** 2 < 32 ** 2 or (x + 175) ** 2 + (y + 215) ** 2 < 32 ** 2:
        return True
    if x > 78 and y > 238 + w or x < -78 and y < -238 + w:  # open meadows on each attacker's open approach
        return True
    return abs(y - FORD_Y) < 11 and -8 < x < 80  # open band through the woods at the north ford


def zone(x, y):
    if abs(x) > EXT + 4 or abs(y) > EXT + 4:
        return "out"
    d = rdist(x, y)
    if d < 6.5:
        return "water"
    if on_road(x, y, 1.0):
        return "road"
    inside = max(abs(x), abs(y)) <= HALF + 4
    if abs(x) < 22 and not in_village(x, y):
        return "border"
    if inside and in_village(x, y):
        return "village"
    if d < 10.5:
        return "clear" if near_crossing(x, y, 6) else "bank"
    if not inside:
        return "woods" if woods_val(x, y) > 0.48 else "farm"
    if y - x > 470 or x - y > 470:  # beyond the cut corners
        return "farm"
    if clearing(x, y):
        return "clear"
    if y < -100 + wob(x) and -300 < x < -70 and -147 < y < -133:  # NATO's wood strip to the south footbridge
        return "woods"
    return "woods" if lane(x, y) == "north" else "farm"


# ------------------------------------------------------------------ materials
class Mat:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.nt = self.m.node_tree
        self.bsdf = self.nt.nodes["Principled BSDF"]
        self.bsdf.inputs["Roughness"].default_value = 0.85

    def node(self, t, **kw):
        n = self.nt.nodes.new(t)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def set(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            if isinstance(v, tuple) and len(v) == 3 and len(sock.default_value) == 4:
                v = (*v, 1.0)
            sock.default_value = v

    def math(self, op, a, b=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        return n.outputs[0]

    def mr(self, x, a, b, smooth=True):  # 0 below a, 1 above b
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP" if smooth else "LINEAR")
        self.set(n.inputs["Value"], x)
        n.inputs["From Min"].default_value = a
        n.inputs["From Max"].default_value = b
        return n.outputs["Result"]

    def band(self, x, lo, hi, e=0.03):
        return self.math("MULTIPLY", self.mr(x, lo - e, lo + e), self.math("SUBTRACT", 1.0, self.mr(x, hi - e, hi + e)))

    def mix(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA")
        self.set(n.inputs[0], fac)
        self.set(n.inputs[6], (*a, 1) if isinstance(a, tuple) else a)
        self.set(n.inputs[7], (*b, 1) if isinstance(b, tuple) else b)
        return n.outputs[2]

    def noise(self, coord, scale, detail=4.0, rough=0.55):
        n = self.node("ShaderNodeTexNoise")
        if coord is not None:
            self.set(n.inputs["Vector"], coord)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        return n.outputs["Fac"]

    def coord(self, kind="Object"):
        return self.node("ShaderNodeTexCoord").outputs[kind]

    def _sep(self, v):
        n = self.node("ShaderNodeSeparateXYZ")
        self.set(n.inputs[0], v)
        return n.outputs

    def rand(self):
        return self.node("ShaderNodeObjectInfo").outputs["Random"]

    def ramp(self, fac, colors, constant=True):
        n = self.node("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = "CONSTANT" if constant else "LINEAR"
        while len(cr.elements) < len(colors):
            cr.elements.new(0.5)
        for i, c in enumerate(colors):
            cr.elements[i].position = i / len(colors) if constant else i / max(1, len(colors) - 1)
            cr.elements[i].color = (*c, 1)
        self.set(n.inputs[0], fac)
        return n.outputs[0]

    def stripes(self, v, period, duty=0.5):  # 1 inside stripe
        f = self.math("FRACT", self.math("DIVIDE", v, period))
        return self.math("LESS_THAN", f, duty)

    def base(self, c):
        self.set(self.bsdf.inputs["Base Color"], c)

    def bump(self, h, strength=0.4, dist=0.1):
        n = self.node("ShaderNodeBump")
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = dist
        self.set(n.inputs["Height"], h)
        self.set(self.bsdf.inputs["Normal"], n.outputs["Normal"])


def vary(M, c, amount=0.15, scale=None, coord=None):
    """Colour times per-object random brightness, times optional noise."""
    f = M.math("ADD", 1 - amount, M.math("MULTIPLY", M.rand(), 2 * amount))
    out = M.mix(1.0, c, c)
    mul = M.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    M.set(mul.inputs[0], 1.0)
    M.set(mul.inputs[6], out if not isinstance(out, tuple) else (*out, 1))
    cc = M.node("ShaderNodeCombineXYZ")
    for k in range(3):
        M.set(cc.inputs[k], f)
    M.set(mul.inputs[7], cc.outputs[0])
    return mul.outputs[2]


MATS = {}


def mat(name):
    return MATS[name].m


def build_materials():
    # terrain: zone colour attribute + noise, micro-relief bump
    M = Mat("terrain")
    attr = M.node("ShaderNodeAttribute", attribute_name="zcol").outputs["Color"]
    w = M.coord("Object")
    n1 = M.noise(w, 0.05)
    n2 = M.noise(w, 0.6, 6)
    c = M.mix(M.mr(n1, 0.35, 0.7), attr, M.mix(0.6, attr, (0.22, 0.19, 0.11)))
    c = M.mix(M.math("MULTIPLY", M.mr(M.noise(w, 0.012, 3), 0.4, 0.65), 0.6), c, M.mix(0.5, attr, (0.07, 0.08, 0.04)))
    c = M.mix(M.math("MULTIPLY", M.mr(n2, 0.4, 0.75), 0.35), c, (0.07, 0.07, 0.04))
    tuft = M.noise(w, 0.35, 6, 0.6)
    c = M.mix(M.math("MULTIPLY", M.mr(tuft, 0.42, 0.62), 0.55), c, M.mix(0.55, c, (0.02, 0.025, 0.01)))
    c = M.mix(M.math("MULTIPLY", M.mr(M.noise(w, 2.5, 4), 0.55, 0.75), 0.3), c, M.mix(0.6, c, (0.30, 0.28, 0.18)))
    M.base(c)
    M.bump(M.noise(w, 1.5, 8), 0.45, 0.3)
    MATS["terrain"] = M

    M = Mat("water")
    M.base((0.025, 0.04, 0.045))
    M.bsdf.inputs["Roughness"].default_value = 0.12
    M.bump(M.noise(M.coord("Object"), 0.3, 3), 0.12, 0.2)
    MATS["water"] = M

    # fields, object coords: x = across furrows, y = along the parcel
    def field(name, soil, crop, period, duty, crop_amt, tram=True):
        M = Mat(name)
        o = M._sep(M.coord("Object"))
        rows = M.stripes(o[0], period, duty)
        c = M.mix(M.math("MULTIPLY", rows, crop_amt), soil, crop)
        n = M.noise(M.coord("Object"), 0.04, 3)
        c = M.mix(M.math("MULTIPLY", M.mr(n, 0.3, 0.75), 0.5), c, M.mix(0.5, c, (0.05, 0.04, 0.03)))
        c = M.mix(M.math("MULTIPLY", M.mr(M.noise(M.coord("Object"), 0.4, 5), 0.5, 0.8), 0.25), c, (0.30, 0.27, 0.20))
        if tram:  # tramlines every 18 m: two wheel tracks
            f = M.math("FRACT", M.math("DIVIDE", o[0], 18.0))
            t = M.math("ADD", M.band(f, 0.02, 0.035, 0.004), M.band(f, 0.115, 0.13, 0.004))
            c = M.mix(M.math("MULTIPLY", t, 0.8), c, (0.09, 0.07, 0.05))
        M.base(vary(M, c, 0.18))
        M.bump(M.math("MULTIPLY", rows, 1.0), 0.25, 0.05)
        MATS[name] = M

    field("f_plough", (0.105, 0.072, 0.048), (0.07, 0.05, 0.035), 0.9, 0.45, 0.9, tram=False)
    field("f_winter", (0.12, 0.09, 0.06), (0.17, 0.23, 0.09), 0.5, 0.45, 0.85)
    field("f_stubble", (0.31, 0.27, 0.17), (0.24, 0.20, 0.12), 6.0, 0.5, 0.6)
    field("f_maize", (0.24, 0.20, 0.13), (0.15, 0.11, 0.07), 0.75, 0.3, 0.9)
    field("f_meadow", (0.17, 0.21, 0.09), (0.14, 0.18, 0.07), 3.0, 0.5, 0.5, tram=False)

    # roads: uv x = across (-1..1), uv y = metres along
    def road(name, kind):
        M = Mat(name)
        uv = M._sep(M.coord("UV"))
        au = M.math("ABSOLUTE", uv[0])
        w = M.coord("Object")
        if kind == "asphalt":
            c = M.mix(M.mr(M.noise(w, 0.15, 4), 0.35, 0.7), (0.06, 0.06, 0.065), (0.10, 0.10, 0.10))
            c = M.mix(M.mr(au, 0.85, 1.0), c, (0.16, 0.15, 0.12))
            dash = M.math("MULTIPLY", M.mr(au, 0.035, 0.02), M.stripes(uv[1], 12.0, 0.5))
            edge = M.band(au, 0.86, 0.9, 0.01)
            c = M.mix(M.math("MULTIPLY", M.math("ADD", dash, edge), 0.8), c, (0.55, 0.55, 0.52))
            M.bsdf.inputs["Roughness"].default_value = 0.7
        elif kind == "track":
            grav = M.mix(M.mr(M.noise(w, 1.2, 5), 0.3, 0.7), (0.30, 0.27, 0.21), (0.22, 0.20, 0.16))
            rut = M.band(au, 0.32, 0.6, 0.06)
            c = M.mix(M.math("MULTIPLY", rut, 0.7), grav, (0.17, 0.15, 0.11))
            mid = M.math("MULTIPLY", M.mr(au, 0.22, 0.08), M.mr(M.noise(w, 0.8, 3), 0.35, 0.5))
            c = M.mix(mid, c, (0.17, 0.20, 0.09))
            c = M.mix(M.mr(au, 0.75, 1.0), c, (0.18, 0.20, 0.10))
        else:  # kolonnenweg: two perforated concrete strips
            slab = M.band(au, 0.18, 0.88, 0.02)
            hole = M.math("MULTIPLY", M.stripes(uv[1], 0.5, 0.45), M.stripes(M.math("ADD", au, 0.0), 0.12, 0.45))
            cc = M.mix(M.math("MULTIPLY", hole, 0.7), (0.40, 0.39, 0.36), (0.12, 0.14, 0.08))
            cc = M.mix(M.math("MULTIPLY", M.stripes(uv[1], 3.0, 0.03), 0.8), cc, (0.1, 0.1, 0.1))
            c = M.mix(slab, (0.18, 0.21, 0.10), cc)
        M.base(c)
        MATS[name] = M

    road("r_main", "asphalt")
    road("r_minor", "asphalt")
    road("r_track", "track")
    road("r_kolonne", "kolonne")

    # roofs: per-object palette; weathering, patchy tiles, streaks running downslope (local x), dirtier eaves
    def roof(name, palette, period, bumpstr=0.3, moss=0.25):
        M = Mat(name)
        co = M.coord("Object")
        o = M._sep(co)
        c = M.ramp(M.rand(), palette)
        dark, light = M.mix(0.3, c, (0, 0, 0)), M.mix(0.22, c, (0.8, 0.8, 0.78))
        vor = M.node("ShaderNodeTexVoronoi")
        M.set(vor.inputs["Vector"], co)
        vor.inputs["Scale"].default_value = 4.5
        cell = M._sep(vor.outputs["Color"])[0]
        c = M.mix(M.mr(cell, 0.15, 0.85, False), M.mix(0.3, c, dark), M.mix(0.25, c, light))
        st = M.node("ShaderNodeVectorMath", operation="MULTIPLY")
        M.set(st.inputs[0], co)
        st.inputs[1].default_value = (0.25, 3.5, 1.0)
        streak = M.noise(st.outputs[0], 1.0, 4, 0.6)
        c = M.mix(M.math("MULTIPLY", M.mr(streak, 0.5, 0.72), 0.65), c, dark)
        c = M.mix(M.math("MULTIPLY", M.mr(streak, 0.62, 0.8), 0.25), c, light)
        eave = M.math("SUBTRACT", 1.0, M.mr(o[2], 5.0, 10.0, False))
        c = M.mix(M.math("MULTIPLY", eave, 0.45), c, M.mix(0.4, dark, (0.05, 0.05, 0.04)))
        n = M.noise(co, 0.35, 6)
        c = M.mix(M.math("MULTIPLY", M.mr(n, 0.56, 0.8), moss), c, (0.10, 0.12, 0.06))
        c = M.mix(M.math("MULTIPLY", M.mr(M.noise(co, 0.08, 2), 0.3, 0.7), 0.3), c, light)
        rows = M.stripes(o[0], period, 0.7)
        c = M.mix(M.math("MULTIPLY", rows, 0.5), c, M.mix(0.6, dark, (0, 0, 0)))
        M.base(c)
        M.bump(M.math("ADD", rows, M.math("MULTIPLY", cell, 0.6)), bumpstr, 0.05)
        MATS[name] = M

    M = Mat("skylight")
    M.base((0.02, 0.025, 0.03))
    M.bsdf.inputs["Roughness"].default_value = 0.05
    MATS["skylight"] = M
    M = Mat("ridge")
    M.base(vary(M, (0.10, 0.06, 0.05), 0.3))
    MATS["ridge"] = M
    roof("roof_tile", [(0.30, 0.10, 0.06), (0.36, 0.14, 0.08), (0.22, 0.09, 0.06), (0.26, 0.15, 0.10),
                       (0.40, 0.18, 0.10), (0.18, 0.08, 0.06)], 0.33)
    roof("roof_slate", [(0.09, 0.09, 0.10), (0.12, 0.12, 0.13), (0.07, 0.075, 0.08)], 0.25, 0.2, 0.15)
    roof("roof_metal", [(0.30, 0.31, 0.30), (0.20, 0.22, 0.22), (0.28, 0.18, 0.12), (0.15, 0.20, 0.17)], 0.2, 0.5, 0.35)
    roof("roof_flat", [(0.26, 0.26, 0.25), (0.20, 0.20, 0.20), (0.32, 0.31, 0.28)], 3.0, 0.05, 0.4)

    M = Mat("solar")
    o = M._sep(M.coord("Object"))
    cells = M.math("MAXIMUM", M.stripes(o[0], 0.17, 0.08), M.stripes(o[1], 0.17, 0.08))
    M.base(M.mix(M.math("MULTIPLY", cells, 0.6), (0.02, 0.025, 0.05), (0.25, 0.27, 0.3)))
    M.bsdf.inputs["Roughness"].default_value = 0.25
    MATS["solar"] = M

    for name, c, r in [("wall", (0.55, 0.52, 0.46), 0.9), ("concrete", (0.38, 0.37, 0.34), 0.9),
                       ("chimney", (0.25, 0.14, 0.1), 0.9), ("metal", (0.35, 0.36, 0.36), 0.5),
                       ("dark", (0.04, 0.04, 0.04), 0.6), ("stone", (0.42, 0.40, 0.35), 0.9),
                       ("canvas", (0.22, 0.23, 0.14), 0.95), ("sand", (0.27, 0.23, 0.16), 0.95),
                       ("grave", (0.45, 0.45, 0.43), 0.8), ("container", (0.24, 0.26, 0.17), 0.7),
                       ("trunk", (0.12, 0.09, 0.07), 0.9), ("wrap", (0.80, 0.80, 0.77), 0.4),
                       ("straw", (0.45, 0.37, 0.20), 0.95), ("manure", (0.10, 0.07, 0.05), 0.9),
                       ("milgreen", (0.16, 0.18, 0.10), 0.7)]:
        M = Mat(name)
        M.base(vary(M, c, 0.12))
        M.bsdf.inputs["Roughness"].default_value = r
        if name in ("sand", "straw", "canvas"):
            M.bump(M.noise(M.coord("Object"), 3.0, 4), 0.4, 0.1)
        MATS[name] = M

    for name, base in [("cobble", (0.22, 0.21, 0.20)), ("yardconc", (0.24, 0.235, 0.22))]:
        M = Mat(name)
        o = M._sep(M.coord("Object"))
        g = M.math("MAXIMUM", M.stripes(o[0], 0.6 if name == "cobble" else 4, 0.06),
                   M.stripes(o[1], 0.6 if name == "cobble" else 4, 0.06))
        c = M.mix(M.math("MULTIPLY", g, 0.5), base, (0.12, 0.12, 0.11))
        c = M.mix(M.math("MULTIPLY", M.mr(M.noise(M.coord("Object"), 0.2, 4), 0.5, 0.8), 0.5), c, (0.18, 0.18, 0.13))
        M.base(c)
        MATS[name] = M

    M = Mat("silage")  # black plastic held by tyres
    o = M._sep(M.coord("Object"))
    dots = M.math("MULTIPLY", M.stripes(o[0], 1.6, 0.4), M.stripes(o[1], 1.6, 0.4))
    M.base(M.mix(M.math("MULTIPLY", dots, 0.9), (0.02, 0.02, 0.02), (0.10, 0.10, 0.10)))
    M.bsdf.inputs["Roughness"].default_value = 0.35
    MATS["silage"] = M

    M = Mat("camonet")
    w = M.coord("Object")
    n = M.noise(w, 1.4, 4)
    c = M.ramp(n, [(0.10, 0.11, 0.06), (0.17, 0.17, 0.09), (0.21, 0.18, 0.11), (0.12, 0.14, 0.07)], False)
    M.base(c)
    holes = M.mr(M.noise(w, 6.0, 2), 0.62, 0.66)
    mixs = M.node("ShaderNodeMixShader")
    tr = M.node("ShaderNodeBsdfTransparent")
    out = M.nt.nodes["Material Output"]
    M.set(mixs.inputs[0], holes)
    M.nt.links.new(M.bsdf.outputs[0], mixs.inputs[1])
    M.nt.links.new(tr.outputs[0], mixs.inputs[2])
    M.nt.links.new(mixs.outputs[0], out.inputs["Surface"])
    MATS["camonet"] = M

    M = Mat("car")
    M.base(M.ramp(M.rand(), [(0.75, 0.75, 0.74), (0.45, 0.46, 0.47), (0.03, 0.03, 0.03), (0.06, 0.10, 0.20),
                             (0.35, 0.05, 0.04), (0.6, 0.6, 0.62), (0.12, 0.12, 0.13), (0.20, 0.25, 0.20)]))
    M.bsdf.inputs["Roughness"].default_value = 0.3
    MATS["car"] = M

    # foliage: per-instance palette + leafy noise; card foliage gets noise-cut holes (fluffy edges, dappled shade)
    def leaf(name, palette, scale=2.5, dark=0.45, holes=0.0):
        M = Mat(name)
        co = M.coord("Object")
        c = M.ramp(M.rand(), palette, constant=False)
        n = M.noise(co, scale, 6, 0.65)
        black = M.mix(0.75, c, (0, 0, 0))
        c = M.mix(M.math("MULTIPLY", M.mr(n, 0.35, 0.7), dark), c, black)
        c = M.mix(M.math("MULTIPLY", M.mr(n, 0.64, 0.8), 0.35), c, M.mix(0.45, c, (1, 1, 0.85)))
        M.base(c)
        M.bump(n, 0.7, 0.25)
        if holes:
            cut_ = M.mr(M.noise(co, holes, 3, 0.6), 0.47, 0.5)
            mixs = M.node("ShaderNodeMixShader")
            tr = M.node("ShaderNodeBsdfTransparent")
            M.set(mixs.inputs[0], cut_)
            M.nt.links.new(tr.outputs[0], mixs.inputs[1])
            M.nt.links.new(M.bsdf.outputs[0], mixs.inputs[2])
            M.nt.links.new(mixs.outputs[0], M.nt.nodes["Material Output"].inputs["Surface"])
        MATS[name] = M

    leaf("leaf_conifer", [(0.05, 0.075, 0.045), (0.065, 0.09, 0.05), (0.045, 0.065, 0.045), (0.075, 0.085, 0.05)])
    leaf("leaf_card", [(0.24, 0.10, 0.035), (0.28, 0.19, 0.06), (0.16, 0.10, 0.05), (0.11, 0.13, 0.05),
                       (0.21, 0.15, 0.07), (0.15, 0.08, 0.04), (0.12, 0.11, 0.07)], 4.0, 0.5, 2.2)
    leaf("leaf_bushcard", [(0.10, 0.11, 0.05), (0.16, 0.12, 0.05), (0.08, 0.10, 0.05), (0.22, 0.13, 0.05)], 5.0, 0.5, 3.0)
    leaf("leaf_autumn", [(0.24, 0.10, 0.035), (0.28, 0.19, 0.06), (0.16, 0.10, 0.05), (0.11, 0.13, 0.05),
                         (0.21, 0.15, 0.07), (0.15, 0.08, 0.04), (0.12, 0.11, 0.07)])
    leaf("leaf_bare", [(0.17, 0.14, 0.12), (0.14, 0.12, 0.11), (0.21, 0.17, 0.13)], 6.0, 0.3)
    leaf("leaf_bush", [(0.10, 0.11, 0.05), (0.16, 0.12, 0.05), (0.08, 0.10, 0.05), (0.22, 0.13, 0.05)], 4.0)
    leaf("leaf_reed", [(0.36, 0.30, 0.17), (0.30, 0.25, 0.14), (0.26, 0.24, 0.13)], 8.0, 0.4)


# --------------------------------------------------------------- mesh helpers
def make_obj(name, verts, faces, mats, mat_idx=None, loc=(0, 0, 0), rot=0.0, cover=None, smooth=False,
             coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(mat(m))
    if mat_idx is not None:
        me.polygons.foreach_set("material_index", mat_idx)
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot)
    if cover:
        ob["cover"] = cover
    (coll or SCENE.collection).objects.link(ob)
    return ob


class MB:
    """Accumulates local-space polygons with material names."""

    def __init__(self):
        self.v, self.f, self.mi, self.names = [], [], [], []

    def _m(self, name):
        if name not in self.names:
            self.names.append(name)
        return self.names.index(name)

    def poly(self, pts, m):
        b = len(self.v)
        self.v.extend(pts)
        self.f.append(list(range(b, b + len(pts))))
        self.mi.append(self._m(m))

    def box(self, cx, cy, z0, w, d, h, m, top_m=None, a=0.0, bottom=False):
        ca, sa = math.cos(a), math.sin(a)

        def P(x, y, z):
            return (cx + x * ca - y * sa, cy + x * sa + y * ca, z)

        x, y = w / 2, d / 2
        z1 = z0 + h
        c = [P(-x, -y, z0), P(x, -y, z0), P(x, y, z0), P(-x, y, z0),
             P(-x, -y, z1), P(x, -y, z1), P(x, y, z1), P(-x, y, z1)]
        for q in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.poly([c[i] for i in q], m)
        self.poly([c[4], c[5], c[6], c[7]], top_m or m)
        if bottom:
            self.poly([c[3], c[2], c[1], c[0]], m)

    def cyl(self, cx, cy, z0, r, h, m, n=12, top_m=None):
        ring0 = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n), z0) for k in range(n)]
        ring1 = [(x, y, z0 + h) for x, y, _ in ring0]
        for k in range(n):
            j = (k + 1) % n
            self.poly([ring0[k], ring0[j], ring1[j], ring1[k]], m)
        self.poly(ring1, top_m or m)

    def obj(self, name, loc=(0, 0, 0), rot=0.0, cover=None, coll=None):
        return make_obj(name, self.v, self.f, self.names, self.mi, loc, rot, cover, coll=coll)


def gable(mb, w, d, wall_h, pitch, roof_m, wall_m="wall", oh=0.5, ox=0.0, oy=0.0, z0=-2.0, hip=False):
    """House body + gable roof, ridge along local y. Returns ridge height."""
    t = math.tan(math.radians(pitch))
    mb.box(ox, oy, z0, w, d, wall_h - z0, wall_m)
    ex, ey = w / 2 + oh, d / 2 + oh
    zr = wall_h + (w / 2) * t
    ze = wall_h - oh * t
    if hip:
        hy = d / 2 - w / 2 * 0.8
        hy = max(hy, 0.5)
        mb.poly([(ox - ex, oy - ey, ze), (ox, oy - hy, zr), (ox, oy + hy, zr), (ox - ex, oy + ey, ze)], roof_m)
        mb.poly([(ox + ex, oy - ey, ze), (ox + ex, oy + ey, ze), (ox, oy + hy, zr), (ox, oy - hy, zr)], roof_m)
        mb.poly([(ox - ex, oy - ey, ze), (ox + ex, oy - ey, ze), (ox, oy - hy, zr)], roof_m)
        mb.poly([(ox + ex, oy + ey, ze), (ox - ex, oy + ey, ze), (ox, oy + hy, zr)], roof_m)
    else:
        mb.poly([(ox - ex, oy - ey, ze), (ox, oy - ey, zr), (ox, oy + ey, zr), (ox - ex, oy + ey, ze)], roof_m)
        mb.poly([(ox + ex, oy - ey, ze), (ox + ex, oy + ey, ze), (ox, oy + ey, zr), (ox, oy - ey, zr)], roof_m)
        for y in (-d / 2, d / 2):
            mb.poly([(ox - w / 2, oy + y, wall_h), (ox + w / 2, oy + y, wall_h), (ox, oy + y, zr)], wall_m)
        mb.box(ox, oy, zr - 0.12, 0.32, 2 * ey, 0.2, "ridge")
        for sx in (-1, 1):
            mb.box(ox + sx * (ex - 0.05), oy, ze - 0.18, 0.2, 2 * ey, 0.18, "metal")
    return zr, t


def ground_z(cx, cy, w, d, a):
    ca, sa = math.cos(a), math.sin(a)
    zs = [height(cx + x * ca - y * sa, cy + x * sa + y * ca) for x in (-w / 2, w / 2) for y in (-d / 2, d / 2)]
    return min(zs), max(zs)


FOOT = []  # (x, y, r) occupied footprints


def free(x, y, r, road_margin=1.5, river=12):
    if not canon_ok(x + r, y):
        return False
    for fx, fy, fr in FOOT:
        if (x - fx) ** 2 + (y - fy) ** 2 < (r + fr) ** 2:
            return False
    return not on_road(x, y, r * 0.65 + road_margin) and rdist(x, y) > r + river


def rot_from_dir(dx, dy):
    """Object rotation so local +y points along (dx, dy)."""
    return math.atan2(dy, dx) - math.pi / 2


def flat_patch(name, cx, cy, w, d, a, m, zoff=0.06, step=3.0, cover=None):
    nx, ny = max(1, int(w / step)), max(1, int(d / step))
    ca, sa = math.cos(a), math.sin(a)
    verts, faces = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x, y = -w / 2 + w * i / nx, -d / 2 + d * j / ny
            wx, wy = cx + x * ca - y * sa, cy + x * sa + y * ca
            verts.append((x, y, height(wx, wy) + zoff))
    for j in range(ny):
        for i in range(nx):
            k = j * (nx + 1) + i
            faces.append((k, k + 1, k + nx + 2, k + nx + 1))
    return make_obj(name, verts, faces, [m], loc=(cx, cy, 0), rot=a, cover=cover)


def disc_patch(name, cx, cy, r, m, zoff=0.08, n=40):
    verts = [(0, 0, height(cx, cy) + zoff)]
    for k in range(n):
        x, y = r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)
        verts.append((x, y, height(cx + x, cy + y) + zoff))
    faces = [(0, 1 + k, 1 + (k + 1) % n) for k in range(n)]
    return make_obj(name, verts, faces, [m], loc=(cx, cy, 0))


# --------------------------------------------------------------- prototypes
PROTO_COLL = None


def proto(name, mb, cover):
    ob = mb.obj("proto_" + name, cover=cover, coll=PROTO_COLL)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    return ob


def blob(mb, cx, cy, cz, rx, ry, rz, m, seed, rough=0.3, sub=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    s = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    b = len(mb.v)
    for v in bm.verts:
        k = 1 + rough * noise.noise(v.co * 1.8 + s)
        mb.v.append((cx + v.co.x * rx * k, cy + v.co.y * ry * k, cz + v.co.z * rz * k))
    mi = mb._m(m)
    for f in bm.faces:
        mb.f.append([b + v.index for v in f.verts])
        mb.mi.append(mi)
    bm.free()


def crown(mb, r, R, Z, n, m, seed, smin=0.7, smax=1.3, flat=0.7):
    """Crown as many small leaf clusters biased to the shell: a broken, clumpy silhouette."""
    for k in range(n):
        while True:
            p = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1)))
            if 0.4 < p.length <= 1:
                break
        s = r.uniform(smin, smax) * (R / 3.5)
        blob(mb, p.x * R, p.y * R, Z + p.z * R * flat, s, s, s * 0.85, m, seed + k, 0.45, 1)


def cards(mb, r, R, Z, n, m, smin=1.4, smax=2.6, flat=0.65):
    """Crown of irregular leaf cards at random tilts; the material cuts holes, so edges stay fluffy."""
    for k in range(n):
        while True:
            p = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1)))
            if 0.3 < p.length <= 1:
                break
        c = Vector((p.x * R, p.y * R, Z + p.z * R * flat))
        s = r.uniform(smin, smax)
        rot = Euler((r.uniform(-1.0, 1.0), r.uniform(-1.0, 1.0), r.uniform(0, 6.3))).to_matrix()
        pts = []
        for j in range(7):
            a = 2 * math.pi * j / 7
            rr = s / 2 * r.uniform(0.7, 1.0)
            pts.append(tuple(c + rot @ Vector((rr * math.cos(a), rr * math.sin(a), 0))))
        mb.poly(pts, m)


def branches(mb, r, p, d, L, w, depth, m):
    end = p + d * L
    perp = Vector((-d.y, d.x, 0))
    perp = (perp.normalized() if perp.length > 1e-3 else Vector((1, 0, 0))) * w
    mb.poly([p - perp, p + perp, end + perp * 0.6, end - perp * 0.6], m)
    if depth == 0:
        return
    for _ in range(r.randint(2, 3)):
        nd = (d + Vector((r.uniform(-0.9, 0.9), r.uniform(-0.9, 0.9), r.uniform(-0.15, 0.45)))).normalized()
        branches(mb, r, end, nd, L * r.uniform(0.6, 0.8), w * 0.62, depth - 1, m)


def build_protos():
    P = {}
    for i in range(3):  # spruce from above: tiers of radial branch spikes, a starburst
        mb = MB()
        mb.cyl(0, 0, 0, 0.25, 4, "trunk", 6)
        r = random.Random(100 + i)
        H = r.uniform(17, 23)
        tiers = 10
        for t in range(tiers):
            f = t / (tiers - 1)
            z0 = 3.5 + f * (H - 5)
            L = 3.3 * (1 - f) ** 0.9 + 0.35
            n = r.randint(10, 15) if f < 0.8 else 6
            off = r.uniform(0, 2 * math.pi)
            for k in range(n):
                a = off + 2 * math.pi * k / n + r.uniform(-0.2, 0.2)
                l = L * r.uniform(0.7, 1.15)
                ca, sa = math.cos(a), math.sin(a)
                w = 0.3 + 0.25 * l / 3
                c = (0, 0, z0 + 0.6)
                left = (-sa * w + ca * 0.3, ca * w + sa * 0.3, z0 + 0.2)
                right = (sa * w + ca * 0.3, -ca * w + sa * 0.3, z0 + 0.2)
                mid = (ca * l * 0.55 - sa * w * 0.6, sa * l * 0.55 + ca * w * 0.6, z0 - 0.1 * l)
                mid2 = (ca * l * 0.55 + sa * w * 0.6, sa * l * 0.55 - ca * w * 0.6, z0 - 0.1 * l)
                tip = (ca * l, sa * l, z0 - 0.3 * l)
                mb.poly([c, left, mid], "leaf_conifer")
                mb.poly([c, mid, tip], "leaf_conifer")
                mb.poly([c, tip, mid2], "leaf_conifer")
                mb.poly([c, mid2, right], "leaf_conifer")
        mb.cyl(0, 0, H - 1.5, 0.12, 2.0, "leaf_conifer", 5)
        P[f"conifer{i}"] = proto(f"conifer{i}", mb, "woods")
    for i in range(3):  # deciduous in autumn: clumpy crown of leaf clusters
        mb = MB()
        mb.cyl(0, 0, 0, 0.3, 7, "trunk", 6)
        r = random.Random(200 + i)
        for k in range(4):  # a few limbs show through the gaps
            a = 2 * math.pi * k / 4 + r.uniform(-0.3, 0.3)
            branches(mb, r, Vector((0, 0, 5)), Vector((math.cos(a) * 0.7, math.sin(a) * 0.7, 0.7)).normalized(), 2.2, 0.18, 2, "trunk")
        cards(mb, r, r.uniform(3.3, 4.1), r.uniform(8.5, 10), 75, "leaf_card")
        P[f"decid{i}"] = proto(f"decid{i}", mb, "woods")
    for i in range(2):  # bare deciduous: branching limbs throw twig shadows
        mb = MB()
        mb.cyl(0, 0, 0, 0.3, 4.5, "trunk", 6)
        r = random.Random(300 + i)
        for k in range(5):
            a = 2 * math.pi * k / 5 + r.uniform(-0.3, 0.3)
            d = Vector((math.cos(a) * 0.75, math.sin(a) * 0.75, 0.66)).normalized()
            branches(mb, r, Vector((0, 0, 4.3)), d, 2.6, 0.2, 4, "leaf_bare")
        for k in range(6):  # last clinging leaves
            a, rr = r.uniform(0, 2 * math.pi), r.uniform(1, 3.5)
            blob(mb, rr * math.cos(a), rr * math.sin(a), r.uniform(7, 10), 0.5, 0.5, 0.4, "leaf_autumn", 70 + k, 0.4, 1)
        P[f"bare{i}"] = proto(f"bare{i}", mb, "woods")
    for i in range(3):
        mb = MB()
        r = random.Random(400 + i)
        cards(mb, r, 1.1, 0.9, 22, "leaf_bushcard", 0.7, 1.3, 0.75)
        P[f"bush{i}"] = proto(f"bush{i}", mb, "hedge")
    mb = MB()
    blob(mb, 0, 0, 0.8, 1.0, 1.0, 0.9, "leaf_reed", 90, 0.5, 1)
    P["reed"] = proto("reed", mb, "open")
    mb = MB()  # fruit tree
    mb.cyl(0, 0, 0, 0.15, 2.2, "trunk", 6)
    cards(mb, random.Random(95), 2.3, 3.4, 40, "leaf_card", 1.0, 1.9)
    P["fruit"] = proto("fruit", mb, "open")
    mb = MB()
    mb.cyl(0, 0, 0, 0.14, 9, "trunk", 6)
    mb.box(0, 0, 8.4, 1.6, 0.12, 0.12, "trunk")
    P["pole"] = proto("pole", mb, "open")
    mb = MB()
    mb.cyl(0, 0, 0, 0.08, 1.3, "trunk", 5)
    P["post"] = proto("post", mb, "open")
    mb = MB()  # round bale lying on its side: axis along local x
    n = 12
    ring0 = [(-0.6, 0.75 * math.cos(2 * math.pi * k / n), 0.75 + 0.75 * math.sin(2 * math.pi * k / n)) for k in range(n)]
    ring1 = [(0.6, y, z) for _, y, z in ring0]
    for k in range(n):
        j = (k + 1) % n
        mb.poly([ring0[k], ring1[k], ring1[j], ring0[j]], "straw")
    mb.poly(ring0[::-1], "straw")
    mb.poly(ring1, "straw")
    P["bale"] = proto("bale", mb, "open")
    mb = MB()
    mb.cyl(0, 0, 0, 0.7, 1.4, "wrap", 12)
    P["wrap"] = proto("wrap", mb, "open")
    mb = MB()  # car: body + cabin, nose along +x
    mb.box(0, 0, 0.25, 4.4, 1.8, 0.8, "car")
    mb.box(-0.3, 0, 1.05, 2.4, 1.6, 0.55, "car", top_m="car")
    mb.box(0.75, 0, 1.05, 0.25, 1.5, 0.45, "dark")
    P["car"] = proto("car", mb, "prop")
    mb = MB()
    mb.box(0, 0, 0, 0.8, 2.0, 0.35, "grave")
    P["grave"] = proto("grave", mb, "prop")
    return P


SC = defaultdict(list)  # proto name -> [(x, y, z, scale, heading)]


def scatter_all(P):
    k = 2 / 3 ** 0.25
    for name, pts in SC.items():
        verts, faces = [], []
        for x, y, z, s, a in pts:
            L = k * s
            h = L * math.sqrt(3) / 2
            ca, sa = math.cos(a), math.sin(a)
            b = len(verts)
            for px, py in ((-L / 2, -h / 3), (L / 2, -h / 3), (0, 2 * h / 3)):
                verts.append((x + px * ca - py * sa, y + px * sa + py * ca, z))
            faces.append((b, b + 1, b + 2))
        me = bpy.data.meshes.new("inst_" + name)
        me.from_pydata(verts, [], faces)
        ob = bpy.data.objects.new("inst_" + name, me)
        SCENE.collection.objects.link(ob)
        ob.instance_type = "FACES"
        ob.use_instance_faces_scale = True
        ob.show_instancer_for_render = False
        pr = P[name]
        pr.parent = ob
        log(f"  scatter {name}: {len(pts)}")
    for name, pr in P.items():  # unused prototypes would render at the origin
        if name not in SC:
            pr.hide_render = pr.hide_viewport = True


def put(name, x, y, s=1.0, a=None, zoff=0.0):
    if not canon_ok(x, y):
        return
    SC[name].append((x, y, height(x, y) + zoff, s, rng.uniform(0, 2 * math.pi) if a is None else a))


def tree_at(x, y, kind=None, s=None):
    if kind is None:
        kind = rng.choice(["decid0", "decid1", "decid2", "bare0", "bare1"])
    put(kind, x, y, s or rng.uniform(0.75, 1.2))



def house(name, cx, cy, a, w, d, kind="house", cover="building"):
    """kind: house | barn | modern | shed"""
    zmin, zmax = ground_z(cx, cy, w, d, a)
    mb = MB()
    r = rng.random()
    if kind == "barn":
        roof_m = "roof_metal" if r < 0.5 else "roof_tile"
        zr, t = gable(mb, w, d, rng.uniform(5.5, 7), rng.uniform(22, 32), roof_m, oh=0.6)
    elif kind == "modern":
        h = rng.uniform(5.8, 7)
        mb.box(0, 0, -2, w, d, h + 2, "wall", top_m="roof_flat")
        mb.box(0, -d / 2 + 0.15, h, w, 0.3, 0.5, "wall")
        mb.box(0, d / 2 - 0.15, h, w, 0.3, 0.5, "wall")
        mb.box(-w / 2 + 0.15, 0, h, 0.3, d, 0.5, "wall")
        mb.box(w / 2 - 0.15, 0, h, 0.3, d, 0.5, "wall")
        for _ in range(rng.randint(1, 3)):
            mb.box(rng.uniform(-w / 3, w / 3), rng.uniform(-d / 3, d / 3), h, 1.2, 1.0, 0.8, "metal")
        if rng.random() < 0.6:
            for i in range(int((w - 2) / 1.1)):
                for j in range(int((d - 2) / 2.2)):
                    mb.box(-w / 2 + 1.4 + i * 1.1, -d / 2 + 1.5 + j * 2.2, h + 0.2, 1.0, 1.7, 0.08, "dark",
                           top_m="solar")
        return mb.obj(name, (cx, cy, zmin), a, cover)
    elif kind == "shed":
        mb.box(0, 0, -1, w, d, rng.uniform(3, 3.6), "wall", top_m="roof_metal" if r < 0.5 else "roof_flat")
        return mb.obj(name, (cx, cy, zmin), a, cover)
    else:
        roof_m = "roof_slate" if r < 0.22 else "roof_tile"
        wall0, pitch = rng.uniform(5.5, 7.5), rng.uniform(40, 52)
        zr, t = gable(mb, w, d, wall0, pitch, roof_m, hip=rng.random() < 0.15)
        if rng.random() < 0.3:  # L-shaped house: a lower perpendicular wing
            sub = MB()
            w2, d2 = w * rng.uniform(0.65, 0.8), rng.uniform(5, 7)
            gable(sub, w2, d2, wall0 - 0.6, pitch, roof_m)
            sx, sy = rng.choice((-1, 1)), rng.choice((-1, 1))
            ox, oy = sx * (w / 2 + d2 / 2 - 0.6), sy * (d / 2 - w2 / 2)
            b = len(mb.v)
            mb.v.extend((-y + ox, x + oy, z) for x, y, z in sub.v)
            for f, mi in zip(sub.f, sub.mi):
                mb.f.append([b + k for k in f])
                mb.mi.append(mb._m(sub.names[mi]))
        for side in (-1, 1):  # roof windows and vents
            for _ in range(rng.choice((0, 0, 1, 2, 3))):
                x = side * rng.uniform(1.2, max(1.3, w / 2 - 1.2))
                y = rng.uniform(-d / 2 + 1.5, d / 2 - 1.5)
                z = zr - abs(x) * t + 0.08
                dz = 0.4 * t
                mb.poly([(x - side * 0.4, y - 0.6, z + dz), (x + side * 0.4, y - 0.6, z - dz),
                         (x + side * 0.4, y + 0.6, z - dz), (x - side * 0.4, y + 0.6, z + dz)][::side], "skylight")
            if rng.random() < 0.5:
                x = side * rng.uniform(0.8, w / 2 - 1)
                mb.cyl(x, rng.uniform(-d / 3, d / 3), zr - abs(x) * t - 0.2, 0.12, 0.8, "metal", 6)
        # chimneys
        for _ in range(rng.randint(1, 2)):
            cxl = rng.choice((-1, 1)) * rng.uniform(0.2, 0.3) * w
            mb.box(cxl, rng.uniform(-d / 3, d / 3), zr - abs(cxl) * t - 1, 0.6, 0.6, abs(cxl) * t + 1.9, "chimney")
        wall_h = zr - (w / 2) * t
        # dormers
        if rng.random() < 0.4:
            side = rng.choice((-1, 1))
            for j in range(rng.randint(1, 2)):
                dy = (j - 0.5) * d / 3 if True else 0
                x0 = side * w * 0.28
                ztop = zr - abs(side * w * 0.12) * t
                mb.box(x0, dy, wall_h, w * 0.2, 2.4, ztop - wall_h, "wall", top_m=roof_m)
        # solar panels on the south-facing slope (2034)
        if rng.random() < 0.4:
            sx = -1 if math.sin(a) > 0 else 1
            for i in range(2):
                for j in range(int((d - 2.5) / 1.15)):
                    x = sx * (1.1 + i * 1.75)
                    if abs(x) + 0.9 > w / 2:
                        continue
                    y = -d / 2 + 1.5 + j * 1.15
                    z = zr - abs(x) * t + 0.15
                    dz = 0.85 * t
                    mb.poly([(x - sx * 0.85, y - 0.5, z + dz), (x + sx * 0.85, y - 0.5, z - dz),
                             (x + sx * 0.85, y + 0.5, z - dz), (x - sx * 0.85, y + 0.5, z + dz)][::sx], "solar")
    return mb.obj(name, (cx, cy, zmin), a, cover)


def plot_extras(cx, cy, a, w, d):
    """Garden around a house: trees, shed, car, fence."""
    ca, sa = math.cos(a), math.sin(a)

    def W(x, y):
        return cx + x * ca - y * sa, cy + x * sa + y * ca

    for _ in range(rng.randint(0, 3)):
        x, y = W(rng.choice((-1, 1)) * (w / 2 + rng.uniform(3, 8)), rng.uniform(-d / 2 - 6, d / 2 + 6))
        if not on_road(x, y, 2) and zone(x, y) != "water":
            if rng.random() < 0.3:
                put("conifer" + str(rng.randint(0, 2)), x, y, rng.uniform(0.35, 0.55))
            elif rng.random() < 0.5:
                put("fruit", x, y, rng.uniform(0.7, 1.0))
            else:
                put("bush" + str(rng.randint(0, 2)), x, y, rng.uniform(1.0, 1.8))
    if rng.random() < 0.55:
        x, y = W(rng.choice((-1, 1)) * (w / 2 + 3.2), rng.uniform(-d / 3, d / 3))
        if not on_road(x, y, 2.5):
            put("car", x, y, 1.0, a + math.pi / 2 + rng.choice((0, math.pi)) + rng.uniform(-0.1, 0.1), 0.0)
    if rng.random() < 0.4:
        x, y = W(rng.uniform(-w / 2, w / 2), -d / 2 - rng.uniform(5, 9))
        if free(x, y, 3):
            house(f"shed_{len(FOOT)}", x, y, a, rng.uniform(3, 4.5), rng.uniform(3.5, 6), "shed")
            FOOT.append((x, y, 3))
    if rng.random() < 0.5:  # fence or hedge along the back and sides
        hw, hd = w / 2 + rng.uniform(6, 10), d / 2 + rng.uniform(6, 10)
        corners = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
        hedge = rng.random() < 0.5
        for e in range(3):
            (x0, y0), (x1, y1) = corners[e], corners[e + 1]
            L = math.hypot(x1 - x0, y1 - y0)
            for s in np.arange(0, L, 1.3 if hedge else 2.2):
                x, y = W(x0 + (x1 - x0) * s / L, y0 + (y1 - y0) * s / L)
                if on_road(x, y, 0.8) or zone(x, y) == "water":
                    continue
                if hedge:
                    put("bush" + str(rng.randint(0, 2)), x, y, rng.uniform(0.6, 0.85))
                else:
                    put("post", x, y, 1.0)


def farmstead(tag, cx, cy, a, big=False):
    """Hessian courtyard farm: house, barn, stable around a paved yard."""
    s = 1.3 if big else 1.0
    yw, yd = 22 * s, 26 * s
    flat_patch(f"yard_{tag}", cx, cy, yw + 2, yd + 2, a, "yardconc", 0.07, cover="open")
    ca, sa = math.cos(a), math.sin(a)

    def W(x, y):
        return cx + x * ca - y * sa, cy + x * sa + y * ca

    parts = [((-yw / 2 - 5.5, 0), 11, 16 * s, "house", 0.0), ((yw / 2 + 6.5, 0), 13 * s, yd + 8, "barn", 0.0),
             ((0, yd / 2 + 6), 12, yw, "barn", math.pi / 2)]
    if big:
        parts.append(((0, -yd / 2 - 6), 10, yw - 4, "barn", math.pi / 2))
    for i, ((x, y), w, d, kind, da) in enumerate(parts):
        wx, wy = W(x, y)
        house(f"farm_{tag}_{i}", wx, wy, a + da, w, d, kind)
        FOOT.append((wx, wy, max(w, d) / 2))
    FOOT.append((cx, cy, min(yw, yd) / 2))
    mx, my = W(rng.uniform(-4, 4), rng.uniform(-4, 4))
    disc_patch(f"manure_{tag}", mx, my, 3.0, "manure", 0.25)
    # tractor-ish and bales
    for _ in range(rng.randint(1, 3)):
        x, y = W(rng.uniform(-yw / 3, yw / 3), rng.uniform(-yd / 3, yd / 3))
        put("car", x, y, 1.0, a + rng.uniform(0, 3))
    bx, by = W(-yw / 2 - 2, -yd / 2 - 14)
    for i in range(10):
        for j in range(2):
            x, y = bx + (i * 1.45) * ca, by + (i * 1.45) * sa
            SC["wrap"].append((x - j * 1.45 * sa, y + j * 1.45 * ca, height(x, y), 1.0, 0.0))
    # silage clamp with tyres
    sx, sy = W(yw / 2 + 22, -4)
    mb = MB()
    mb.box(0, 0, -1, 9, 30, 2.6, "silage")
    mb.box(-4.8, 0, -1, 0.5, 31, 3.4, "concrete")
    mb.box(4.8, 0, -1, 0.5, 31, 3.4, "concrete")
    mb.obj(f"clamp_{tag}", (sx, sy, height(sx, sy)), a, "wall")
    FOOT.append((sx, sy, 15))
    if big:
        for k in range(3):
            x, y = W(-yw / 2 - 16, -10 + k * 6.5)
            mb = MB()
            mb.cyl(0, 0, -1, 2.8, 14, "metal", 16)
            mb.obj(f"silo_{tag}_{k}", (x, y, height(x, y)), 0, "building")



def lighting(scene, res, ortho, cam_z=400.0):
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 4.2
    sun_d.angle = math.radians(0.6)
    sun_d.color = (1.0, 0.95, 0.88)
    sun = bpy.data.objects.new("sun", sun_d)
    el = math.radians(SUN_ELEV)
    az = math.radians(45)  # light comes from the north-east, shadows fall south-west (lower left)
    d = Vector((-math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), -math.sin(el)))
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("sky")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.40, 0.48, 0.62, 1)
    bg.inputs["Strength"].default_value = 0.55
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = ortho
    cam_d.clip_end = 1000
    cam = bpy.data.objects.new("cam", cam_d)
    cam.location = (0, 0, cam_z)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dv in prefs.devices:
        dv.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.tile_size = 2048
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"



def extra_materials():
    for name, c, r in [("timber", (0.27, 0.20, 0.13), 0.9), ("burnt", (0.10, 0.095, 0.09), 0.95),
                       ("logs", (0.30, 0.21, 0.12), 0.9)]:
        M = Mat(name)
        M.base(vary(M, c, 0.15))
        M.bsdf.inputs["Roughness"].default_value = r
        if name == "logs":
            M.bump(M.noise(M.coord("Object"), 4.0, 3), 0.5, 0.1)
        MATS[name] = M
    M = Mat("ford")  # wet gravel under a skin of fast shallow water
    w = M.coord("Object")
    o = M._sep(w)
    c = M.mix(M.mr(M.noise(w, 1.6, 5), 0.3, 0.7), (0.10, 0.10, 0.09), (0.22, 0.21, 0.18))
    st = M.node("ShaderNodeVectorMath", operation="MULTIPLY")
    M.set(st.inputs[0], w)
    st.inputs[1].default_value = (0.4, 2.5, 1.0)
    rip = M.mr(M.noise(st.outputs[0], 1.2, 4, 0.6), 0.55, 0.7)
    c = M.mix(M.math("MULTIPLY", rip, 0.55), c, (0.42, 0.44, 0.43))
    c = M.mix(M.math("MULTIPLY", M.mr(M.math("ABSOLUTE", o[1]), 4.5, 6.5), 0.6), c, (0.05, 0.07, 0.07))
    M.base(c)
    M.bsdf.inputs["Roughness"].default_value = 0.25
    MATS["ford"] = M


# ------------------------------------------------------------------- symmetry
CANON = False  # building the west half that twin() copies; nothing may land on the east side


def twin(build):
    """Build canonical (west-half) content, then copy it turned 180 degrees about the map centre,
    so gameplay features match under rotation (#25: balanced, not mirrored)."""
    global CANON
    before = set(o.name for o in SCENE.collection.objects)
    sc0 = {k: len(v) for k, v in SC.items()}
    f0 = len(FOOT)
    CANON = True
    build()
    CANON = False
    for ob in [o for o in SCENE.collection.objects if o.name not in before]:
        c = ob.copy()
        c.location = (-ob.location.x, -ob.location.y, ob.location.z)
        c.rotation_euler = (0, 0, ob.rotation_euler.z + math.pi)
        SCENE.collection.objects.link(c)
    for k, v in list(SC.items()):
        v.extend([(-x, -y, z, s, a + math.pi) for x, y, z, s, a in v[sc0.get(k, 0):]])
    FOOT.extend([(-x, -y, r) for x, y, r in FOOT[f0:]])


def canon_ok(x, y):
    return not CANON or x < -1 or max(abs(x), abs(y)) > HALF + 20


# ----------------------------------------------------------------- the world
def build_terrain():
    n = 513
    xs = np.linspace(-EXT - 4, EXT + 4, n)
    verts, cols = [], []
    col = {"water": (0.10, 0.09, 0.07), "bank": (0.12, 0.13, 0.07), "woods": (0.08, 0.06, 0.04),
           "village": (0.13, 0.15, 0.07), "border": (0.17, 0.165, 0.10), "road": (0.14, 0.15, 0.08),
           "clear": (0.14, 0.16, 0.08), "farm": (0.14, 0.16, 0.08), "out": (0.14, 0.15, 0.08)}
    for y in xs:
        for x in xs:
            verts.append((x, y, height(x, y)))
            cols.extend((*col[zone(x, y)], 1.0))
    faces = []
    for j in range(n - 1):
        for i in range(n - 1):
            k = j * n + i
            faces.append((k, k + 1, k + n + 1, k + n))
    ob = make_obj("terrain", verts, faces, ["terrain"], cover="open", smooth=True)
    ca = ob.data.color_attributes.new("zcol", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", cols)
    me = bpy.data.meshes.new("water")
    s = EXT + 10
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(mat("water"))
    w = bpy.data.objects.new("water", me)
    w["cover"] = "water"
    SCENE.collection.objects.link(w)


def build_roads():
    for idx, (kind, pts) in enumerate(ROAD_PTS):
        hw = HALFW[kind]
        verts, faces, uvs = [], [], []
        dist = 0.0
        for i, (x, y) in enumerate(pts):
            a = pts[max(0, i - 1)]
            b = pts[min(len(pts) - 1, i + 1)]
            t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
            nrm = Vector((-t.y, t.x))
            if i:
                dist += math.hypot(x - pts[i - 1][0], y - pts[i - 1][1])
            deck = 2.0 * (1 - sstep(11, 28, rdist(x, y))) if kind == "main" else -9
            for side in (-1, 1):
                px, py = x + nrm.x * hw * side, y + nrm.y * hw * side
                verts.append((px, py, max(height(px, py) + ZOFF[kind], deck + ZOFF[kind])))
                uvs.append((side, dist))
        for i in range(len(pts) - 1):
            k = 2 * i
            faces.append((k, k + 2, k + 3, k + 1))
        mname = {"main": "r_main", "minor": "r_minor", "track": "r_track", "path": "r_track", "kolonne": "r_kolonne"}[kind]
        ob = make_obj(f"road_{idx}_{kind}", verts, faces, [mname], cover="road")
        uv = ob.data.uv_layers.new(name="UVMap")
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv = uvs[ob.data.loops[li].vertex_index]
    # centre bridge: parapets and piers where the main road crosses the river
    mb = MB()
    pts = ROAD_PTS[0][1]
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        if rdist(x0, y0) < 15:
            t = Vector((x1 - x0, y1 - y0))
            L = t.length
            t.normalize()
            nrm = Vector((-t.y, t.x))
            a = math.atan2(t.y, t.x)
            for side in (-1, 1):
                cx, cy = (x0 + x1) / 2 + nrm.x * 4.2 * side, (y0 + y1) / 2 + nrm.y * 4.2 * side
                mb.box(cx, cy, 2.0, L + 0.05, 0.45, 1.0, "stone", a=a)
            mb.box((x0 + x1) / 2, (y0 + y1) / 2, 0.8, L + 0.05, 8.8, 1.4, "stone", a=a)
    mb.obj("bridge", cover="road")


def build_crossings_half():
    """South footbridge and south ford (twin() makes the north pair)."""
    for _, kind, cx, cy, hw in CROSSINGS:
        if cy >= 0 or kind == "bridge":
            continue
        a = math.atan(river_dxdy(cy))  # across the river: local x runs across, tilted with the channel
        if kind == "footbridge":
            mb = MB()
            L = 25.0
            mb.box(0, 0, 1.0, L, 2.2, 0.3, "timber")
            for side in (-1, 1):
                mb.box(0, side * 1.05, 1.3, L, 0.12, 0.1, "timber")
                for k in range(7):
                    mb.box(-L / 2 + 0.2 + k * (L - 0.4) / 6, side * 1.05, 1.3, 0.14, 0.14, 1.0, "timber")
                    mb.box(-L / 2 + 0.2 + k * (L - 0.4) / 6, side * 1.05, 2.25, 0.14, 0.14, 0.1, "timber")
            for px in (-5.5, 0, 5.5):
                mb.box(px, 0, -2.0, 0.5, 1.8, 3.0, "concrete")
            mb.obj(f"footbridge_{cy:+.0f}", (cx, cy, 0.0), -a, "road")
        else:
            make_obj(f"ford_{cy:+.0f}", [(-10, -hw, 0.04), (10, -hw, 0.04), (10, hw, 0.04), (-10, hw, 0.04)],
                     [(0, 1, 2, 3)], ["ford"], loc=(cx, cy, 0), rot=-a, cover="ford")
            for side in (-1, 1):  # marker posts on both banks
                for s in (-1, 1):
                    x = cx + side * 9.5 * math.cos(a)
                    put("post", x, cy + s * (hw + 0.6), 1.3)


def build_hq(tag, cx, cy, a):
    """Motor-pool HQ: a ~50 m sandbagged compound with tents, containers, trucks under a camo net."""
    ca, sa = math.cos(a), math.sin(a)

    def W(x, y):
        return cx + x * ca - y * sa, cy + x * sa + y * ca

    flat_patch(f"hq_{tag}_ground", cx, cy, 50, 46, a, "sand", 0.11, cover="open")
    mb = MB()
    for (x0, y0), (x1, y1) in [((-25, -23), (25, -23)), ((-25, 23), (25, 23)), ((-25, -23), (-25, -6)), ((-25, 6), (-25, 23)),
                               ((25, -23), (25, -6)), ((25, 6), (25, 23))]:
        L = math.hypot(x1 - x0, y1 - y0)
        mb.box((x0 + x1) / 2, (y0 + y1) / 2, -1, L if y0 == y1 else 1.0, 1.0 if y0 == y1 else L, 2.2, "sand")
    mb.obj(f"hq_{tag}_berm", (cx, cy, height(cx, cy) - 0.5), a, "wall")
    for i, (x, y) in enumerate([(-14, 14), (-14, 1), (-14, -12)]):
        mb = MB()
        gable(mb, 5.5, 9, 1.8, 35, "canvas", "canvas", oh=0.2, z0=-0.5)
        wx, wy = W(x, y)
        mb.obj(f"hq_{tag}_tent{i}", (wx, wy, height(wx, wy)), a, "building")
    for i in range(5):
        wx, wy = W(17, -18 + i * 3.0)
        mb = MB()
        mb.box(0, 0, -0.3, 6.1, 2.45, 2.9, "container")
        mb.obj(f"hq_{tag}_cont{i}", (wx, wy, height(wx, wy)), a + math.pi / 2, "building")
    mb = MB()
    mb.cyl(0, 0, -0.5, 0.25, 22, "metal", 6)
    wx, wy = W(2, 10)
    mb.obj(f"hq_{tag}_mast", (wx, wy, height(wx, wy)), 0, "prop")
    for i in range(3):
        wx, wy = W(-2 + i * 5, -14)
        mb = MB()
        mb.box(3.2, 0, 0.5, 2.0, 2.5, 2.4, "milgreen")
        mb.box(-1.0, 0, 0.6, 6.0, 2.5, 2.6, "canvas")
        mb.obj(f"hq_{tag}_truck{i}", (wx, wy, height(wx, wy)), a + math.pi / 2, "prop")
    nx, ny = 14, 10
    verts, faces = [], []
    r = random.Random(11)
    for j in range(ny + 1):
        for i in range(nx + 1):
            x, y = -11 + 22 * i / nx, -8 + 16 * j / ny
            edge = min(i, nx - i, j, ny - j)
            z = 3.6 if edge > 1 else 3.6 * edge / 2 + 0.2
            verts.append((x + r.uniform(-0.3, 0.3), y + r.uniform(-0.3, 0.3), z + r.uniform(-0.25, 0.25)))
    for j in range(ny):
        for i in range(nx):
            k = j * (nx + 1) + i
            faces.append((k, k + 1, k + nx + 2, k + nx + 1))
    wx, wy = W(3, -14)
    make_obj(f"hq_{tag}_net", verts, faces, ["camonet"], loc=(wx, wy, height(wx, wy)), rot=a, cover="prop")
    FOOT.append((cx, cy, 33))


def build_village_half():
    """West half of the split village: rows of houses along the main road and its side streets."""
    n = 0

    def place(cx, cy, a, w, d, kind):
        nonlocal n
        r = 0.5 * math.hypot(w, d) * 0.62 + 0.5  # tight: a Hessian village packs houses close
        if not in_village(cx, cy) or not free(cx, cy, r, 0.5, 5):
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
            if x < -4 and in_village(x, y, 1.05):
                a_, b_ = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
                t = Vector((b_[0] - a_[0], b_[1] - a_[1])).normalized()
                nr = Vector((-t.y, t.x))
                for side in (-1, 1):
                    for row in (0, 1, 2):
                        if rng.random() > (0.95, 0.7, 0.35)[row]:
                            continue
                        w, d = rng.uniform(8.5, 11.5), rng.uniform(10.5, 15)
                        to_street = rng.random() < 0.6
                        off = HALFW[kind] + rng.uniform(2.5, 5) + (d if to_street else w) / 2 + row * 19
                        a = rot_from_dir(nr.x, nr.y) if to_street else rot_from_dir(t.x, t.y)
                        place(x + nr.x * off * side, y + nr.y * off * side, a, w, d, "modern" if rng.random() < 0.12 else "house")
            i += rng.randint(5, 7)
    for _ in range(3000):  # infill: barns and back houses facing the nearest street
        cx, cy = rng.uniform(-90, -4), rng.uniform(-82, 82)
        if not in_village(cx, cy):
            continue
        i, d = road_near(cx, cy)
        if d > 50:
            continue
        w, dd = rng.uniform(8.5, 12.5), rng.uniform(10, 16)
        place(cx, cy, rot_from_dir(*road_tangent(i)) + rng.choice((0, math.pi / 2)), w, dd,
              rng.choice(["house"] * 4 + ["modern", "barn", "barn"]))
    log(f"  village houses per half: {n}")
    for kind, pts in ROAD_PTS:  # street-parked cars
        if kind not in ("main", "minor"):
            continue
        for i in range(0, len(pts) - 1, 3):
            x, y = pts[i]
            if x < -6 and in_village(x, y) and rng.random() < 0.2 and rdist(x, y) > 14:
                t = Vector((pts[i + 1][0] - x, pts[i + 1][1] - y)).normalized()
                nr = Vector((-t.y, t.x))
                side = rng.choice((-1, 1))
                off = HALFW[kind] + 1.3
                put("car", x + nr.x * off * side, y + nr.y * off * side, 1.0, math.atan2(t.y, t.x))


CHURCH = (-64.0, -40.0)
HALL = (64.0, 40.0)


def build_village_landmarks():
    """Bridge square, the breached border wall, the church (west) and the community hall (east)."""
    disc_patch("square", 0, 0, 24, "cobble", 0.12)
    # breached border wall on the spine: panels with a pipe on top, gaps where it was blown
    mb = MB()
    for y0, y1 in ((12, 24), (30, 50), (56, 75)):
        for sg in (1, -1):
            for y in np.arange(y0, y1, 1.2):
                yy = sg * (y + 0.6)
                z = height(0, yy)
                mb.box(0, yy, z - 0.5, 0.25, 1.18, 4.0, "concrete")
                mb.cyl(0, yy, z + 3.5, 0.3, 0.05, "concrete", 6)
    mb.obj("border_wall", cover="wall")
    for y in (27, 53, -27, -53):  # rubble in the breaches
        for _ in range(6):
            put("grave", rng.uniform(-3, 3), y + rng.uniform(-2.5, 2.5), rng.uniform(0.8, 1.6))
    # church with churchyard (west bank)
    ccx, ccy = CHURCH
    ang = 0.1
    mb = MB()
    gable(mb, 11, 24, 10, 52, "roof_slate")
    mb.box(0, -12 - 3.5, -2, 7, 7, 24, "stone")
    for (x0, y0), (x1, y1) in (((-3.8, -19.3), (3.8, -19.3)), ((3.8, -19.3), (3.8, -11.7)), ((3.8, -11.7), (-3.8, -11.7)),
                               ((-3.8, -11.7), (-3.8, -19.3))):
        mb.poly([(x0, y0, 22), (x1, y1, 22), (0, -15.5, 38)], "roof_slate")
    mb.cyl(0, 12, -2, 5.5, 11.5, "wall", 10, top_m="roof_slate")
    zmin, _ = ground_z(ccx, ccy, 11, 24, ang)
    mb.obj("church", (ccx, ccy, zmin), ang, "building")
    ca, sa = math.cos(ang), math.sin(ang)
    mb = MB()
    for (x0, y0), (x1, y1) in [((-16, -23), (16, -23)), ((16, -23), (16, 23)), ((16, 23), (-16, 23)), ((-16, 23), (-16, -23))]:
        L = math.hypot(x1 - x0, y1 - y0)
        mb.box((x0 + x1) / 2, (y0 + y1) / 2, -1.5, L if y0 == y1 else 0.5, 0.5 if y0 == y1 else L, 3.0, "stone")
    mb.obj("churchyard", (ccx, ccy, zmin), ang, "wall")
    for lx in (-13.5, -11, -8.5, 8.5, 11, 13.5):
        for ly in np.arange(-20, 20.1, 2.4):
            if rng.random() < 0.75:
                SC["grave"].append((ccx + lx * ca - ly * sa, ccy + lx * sa + ly * ca, height(ccx, ccy), 1.0, ang))
    for lx, ly in [(-12, -20), (12, 20), (-12, 20), (12, -20)]:
        tree_at(ccx + lx * ca - ly * sa, ccy + lx * sa + ly * ca, "decid1", 1.0)
    # community hall (east bank): a flat-roofed block with a stage wing and a forecourt
    hx, hy = HALL
    ang = 0.1 + math.pi
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
    for k in range(8):
        put("decid0", hx - 13 + (k % 2) * 26, hy - 18 + (k // 2) * 10, 0.7)


def build_sawmill():
    """North Capture Point (E2): a sawmill clearing on the forest edge, log stacks as cover."""
    flat_patch("sawmill_yard", 0, 203, 64, 46, 0.0, "sand", 0.07, cover="open")
    house("sawmill_hall", -15, 210.5, math.pi / 2, 11, 22, "barn")
    house("sawmill_shed", 17.5, 185.5, 0.0, 9, 9, "shed")
    for x0, y0, x1, y1 in [(3, 207, 12, 209), (-15, 189, -6, 191), (20, 199, 22, 208), (-31, 195, -29, 204), (-4, 224, 6, 226)]:
        mb = MB()
        along_x = x1 - x0 > y1 - y0
        L, W = (x1 - x0, y1 - y0) if along_x else (y1 - y0, x1 - x0)
        for layer in range(3):
            n = int(W / 0.45) - layer
            for k in range(n):
                off = -W / 2 + 0.225 + (k + layer * 0.5) * 0.45
                mb.box(0, off, -0.3 + layer * 0.42, L * rng.uniform(0.92, 1.0), 0.42, 0.42, "logs")
        mb.obj("logs", ((x0 + x1) / 2, (y0 + y1) / 2, height((x0 + x1) / 2, (y0 + y1) / 2)),
               0.0 if along_x else math.pi / 2, "wall")
    for _ in range(3):
        put("car", rng.uniform(-10, 10), rng.uniform(193, 202), 1.0)
    for _ in range(14):
        put("bale" if rng.random() < 0.3 else "wrap", rng.uniform(-36, -26), rng.uniform(208, 222), 0.8)


def build_farm_point():
    """South Capture Point (E8): a walled Hessian farmstead in open fields."""
    flat_patch("farm_yard", 0, -202, 56, 52, 0.0, "yardconc", 0.07, cover="open")
    house("farm_house", -14, -195.5, math.pi / 2, 11, 14, "house")
    house("farm_barn", 15.5, -212, math.pi / 2, 14, 19, "barn")
    house("farm_stable", -14.5, -218.5, 0.0, 9, 9, "barn")
    mb = MB()
    for x0, y0, x1, y1 in [(-29, -229, -4, -228), (4, -229, 29, -228), (-29, -177, -4, -176), (4, -177, 29, -176),
                           (-29, -229, -28, -207), (-29, -199, -28, -176), (28, -229, 29, -207), (28, -199, 29, -176)]:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        mb.box(cx, cy, height(cx, cy) - 0.5, x1 - x0, y1 - y0, 1.7, "stone")
    mb.obj("farm_walls", cover="wall")
    disc_patch("farm_manure", 6, -190, 3.0, "manure", 0.25)
    for k in range(2):
        put("car", 4 + k * 5, -198, 1.0, 0.2)
    for i in range(8):
        for j in range(2):
            SC["wrap"].append((32 + i * 1.45, -236 - j * 1.45, height(32, -236), 1.0, 0.0))


def build_border_half():
    """West side of the border strip: flattened fence with low leftover segments, a burnt-out tower."""
    mb = MB()
    for y in np.arange(-EXT, EXT, 14.0):
        if in_village(-13, y) or on_road(-13, y + 7, 2) or abs(y) < 80 or abs(abs(y + 7) - 200) < 42:  # not through the points
            continue
        r = (math.sin(y * 12.9898) * 43758.5453) % 1.0
        if r < 0.55:  # standing remnant: posts with sagging mesh, low cover
            for k in range(5):
                yy = y + k * 3.5
                mb.box(-13, yy, height(-13, yy) - 0.5, 0.15, 0.15, 1.7, "metal")
            mb.box(-13, y + 7, height(-13, y + 7) + 0.2, 0.05, 14, 0.9, "metal")
        else:  # flattened: mesh lying in the grass
            mb.box(-14.5, y + 7, height(-14.5, y + 7) + 0.05, 2.6, 13, 0.06, "metal")
    mb.obj("fence_remnants", cover="wall")
    for k, ty in enumerate((118.0, -249.0)):
        mb = MB()
        mb.box(0, 0, -1, 2.6, 2.6, 12, "burnt")
        for x0, y0, w, d in ((0, -2, 4.2, 0.25), (0, 2, 4.2, 0.25), (-2, 0, 0.25, 4.2), (2, 0, 0.25, 4.2)):
            mb.box(x0, y0, 11, w, d, 1.4, "burnt")
        mb.box(0, 0, 10.8, 4.2, 4.2, 0.2, "burnt")
        mb.obj(f"tower{k}", (-10, ty, height(-10, ty)), 0.15, "building")


FIELD_TYPES = [("f_plough", 0.32), ("f_winter", 0.26), ("f_stubble", 0.18), ("f_maize", 0.1), ("f_meadow", 0.14)]


def fields(ok, box, a, wr, lr, hedge_p, tag):
    """Parcels in a frame turned by a, kept where ok(x, y) holds and the ground is farmland."""
    n = [0]
    x0, y0, x1, y1 = box

    def parcel(uc, vc, W, L, depth):
        ca, sa = math.cos(a), math.sin(a)
        cx, cy = uc * ca - vc * sa, uc * sa + vc * ca
        if not (x0 - 60 < cx < x1 + 60 and y0 - 60 < cy < y1 + 60):
            return
        w, d = W - 2.5, L - 2.5

        def P(x, y):
            return cx + x * ca - y * sa, cy + x * sa + y * ca

        samples = [P(sx * w / 2, sy * d / 2) for sx in (-1, -0.5, 0, 0.5, 1) for sy in (-1, -0.66, -0.33, 0, 0.33, 0.66, 1)]
        good = [ok(*p) and zone(*p) == "farm" for p in samples]
        if not all(good):
            if depth < 4 and max(W, L) > 28 and any(good):
                if L >= W:
                    f = rng.uniform(0.35, 0.65)
                    parcel(uc, vc - L / 2 + L * f / 2, W, L * f, depth + 1)
                    parcel(uc, vc + L * f / 2, W, L * (1 - f), depth + 1)
                else:
                    parcel(uc - W / 4, vc, W / 2, L, depth + 1)
                    parcel(uc + W / 4, vc, W / 2, L, depth + 1)
            return
        r, acc = rng.random(), 0
        for typ, pr in FIELD_TYPES:
            acc += pr
            if r < acc:
                break
        flat_patch(f"field_{tag}_{n[0]}", cx, cy, w, d, a, typ, 0.07, step=6.0, cover="open")
        n[0] += 1
        if typ == "f_stubble" and rng.random() < 0.5:
            for ox in np.arange(-w / 2 + 6, w / 2 - 4, 12):
                for oy in np.arange(-d / 2 + 5, d / 2 - 4, 7):
                    if rng.random() < 0.35:
                        put("bale", *P(ox + rng.uniform(-2, 2), oy + rng.uniform(-2, 2)), 1.0)
        corners = [P(-w / 2 - 1.2, -d / 2 - 1.2), P(w / 2 + 1.2, -d / 2 - 1.2), P(w / 2 + 1.2, d / 2 + 1.2), P(-w / 2 - 1.2, d / 2 + 1.2)]
        for e in range(4):
            (ax, ay), (bx, by) = corners[e], corners[(e + 1) % 4]
            if rng.random() > hedge_p((ax + bx) / 2, (ay + by) / 2):
                continue
            hedge_line([(ax, ay), (bx, by)], gap=True)

    lim = max(abs(x0), abs(x1), abs(y0), abs(y1)) * 1.45 + 10
    v = -lim
    while v < lim:
        L = rng.uniform(*lr)
        u = -lim
        while u < lim:
            W = rng.uniform(*wr)
            parcel(u + W / 2, v + L / 2, W, L, 0)
            u += W
        v += L
    log(f"  fields {tag}: {n[0]}")


def hedge_line(pts, gap=False, offset=0.0, trees=0.08):
    """Hedgerow of bushes with the odd tree: blocks sight, not movement."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        s, gap_at = 0.0, rng.uniform(0, L) if gap else -99
        while s < L:
            x = x0 + (x1 - x0) * s / L + nx * offset
            y = y0 + (y1 - y0) * s / L + ny * offset
            s += rng.uniform(1.3, 2.2)
            if abs(s - gap_at) < 5 or on_road(x, y, 1.0) or zone(x, y) in ("water", "village", "border"):
                continue
            x += rng.uniform(-0.6, 0.6)
            y += rng.uniform(-0.6, 0.6)
            if rng.random() < trees:
                tree_at(x, y)
            else:
                put("bush" + str(rng.randint(0, 2)), x, y, rng.uniform(1.3, 2.6))


def build_hedges():
    # Lane divider between the village fields and the farmland Lane
    for sgn in (-1, 1):
        xs = np.arange(84, HALF + 4, 2.0) * sgn
        hedge_line([(float(x), -100 + wob(x)) for x in xs], trees=0.12)
    # NATO's sunken track from the south footbridge toward the farmstead
    lane_pts = [(river_x(-FOOT_Y) + 8, -FOOT_Y), (-40, -160), (-24, -178)]
    for off in (-3.5, 3.5):
        hedge_line(lane_pts, offset=off, trees=0.15)


def build_corner_hedge_half():
    hedge_line([(-302.0, 176.0), (-176.0, 302.0)], trees=0.15)


def build_banks_half():
    """Alder scrub and reeds on the south-flowing half of the river (twin() mirrors it north)."""
    sp = 3.0
    for x in np.arange(-EXT - 4, EXT + 4, sp):
        for y in np.arange(-EXT - 4, 0, sp):
            px, py = x + rng.uniform(-1.2, 1.2), y + rng.uniform(-1.2, 1.2)
            if py >= 0:
                continue
            d = rdist(px, py)
            if d > 11:
                continue
            z = zone(px, py)
            if z == "bank":
                if d < 9 and rng.random() < 0.45:
                    put("reed", px, py, rng.uniform(1.0, 1.8))
                elif rng.random() < 0.55:
                    put("bush" + str(rng.randint(0, 2)), px, py, rng.uniform(1.4, 2.6))
                elif rng.random() < 0.35:
                    tree_at(px, py, rng.choice(["decid0", "decid2", "bare0"]), rng.uniform(0.7, 1.0))
            elif z == "water" and 5.0 < d < 6.5 and not near_crossing(px, py, 4) and rng.random() < 0.5:
                put("reed", px, py, rng.uniform(0.8, 1.4))


def build_poles_half():
    pts = ROAD_PTS[0][1]
    for i in range(0, len(pts) - 1, 22):
        x, y = pts[i]
        px, py = x, y + HALFW["main"] + 4
        if x < -1 and zone(px, py) in ("farm", "clear", "bank"):
            put("pole", px, py, 1.0, math.pi / 2)


def build_woods():
    trees = 0
    sp = 5.5 if OUTER else 4.2
    for x in np.arange(-EXT - 4, EXT + 4, sp):
        for y in np.arange(-EXT - 4, EXT + 4, sp):
            plantation = nz(x, y, 120, 3.3) > 0.22
            px, py = (x, y) if plantation else (x + rng.uniform(-2, 2), y + rng.uniform(-2, 2))
            z = zone(px, py)
            if z == "woods":
                edge = abs(py - (105 + wob(px))) < 8 if max(abs(px), abs(py)) < HALF else woods_val(px, py) < 0.56
                if rng.random() < 0.06 and not plantation:
                    continue
                conifer = plantation or (nz(px, py, 80, 9.3) > 0.05 and not edge)
                if conifer:
                    put(f"conifer{rng.randint(0, 2)}", px, py, rng.uniform(0.8, 1.15) if not plantation else 0.95)
                else:
                    tree_at(px, py, s=rng.uniform(0.85, 1.3))
                trees += 1
                if not conifer and rng.random() < 0.3:
                    put("bush" + str(rng.randint(0, 2)), px + 2, py + 1, rng.uniform(1.0, 2.0))
            elif z == "farm" and rng.random() < 0.004 and (lane(px, py) == "south" or max(abs(px), abs(py)) > HALF):
                tree_at(px, py, s=rng.uniform(1.0, 1.4))
            elif z == "clear" and abs(abs(px) - 175) < 34 and abs(abs(py) - 215) < 34 and rng.random() < 0.02:
                put("bush" + str(rng.randint(0, 2)), px, py, rng.uniform(1.0, 2.0))  # scrub on the hilltops
    log(f"  woods trees: {trees}")


def build_surroundings():
    for k, (hx, hy, ha) in enumerate([(-640, 420, 0.3), (520, -690, -0.2), (-560, -620, 0.9), (660, 560, 0.1),
                                      (-780, -80, -0.6), (180, 700, 0.5)]):
        farmstead(f"o{k}", hx, hy, ha)
        for j in range(7):
            x, y = hx + rng.uniform(-70, 70), hy + rng.uniform(-70, 70)
            if free(x, y, 7):
                house(f"oh{k}_{j}", x, y, ha + rng.choice((0, math.pi / 2)), rng.uniform(9, 11), rng.uniform(11, 14))
                FOOT.append((x, y, 7))
    beyond = lambda x, y: max(abs(x), abs(y)) > HALF + 6  # noqa: E731
    fields(lambda x, y: beyond(x, y) and x < -22, (-EXT, -EXT, -22, EXT), 0.21, (22, 55), (80, 150), lambda x, y: 0.45, "west")
    fields(lambda x, y: beyond(x, y) and x > 22, (22, -EXT, EXT, EXT), 0.04, (120, 260), (250, 450), lambda x, y: 0.1, "lpg")


# ----------------------------------------------------------------- data export
COVER_IDS = {"open": 0, "road": 1, "water": 2, "hedge": 3, "woods": 4, "building": 5, "wall": 6, "prop": 7, "ford": 8}
COVER_COLS = {0: (0, 0, 0, 0), 1: (0.6, 0.6, 0.6, 0.8), 2: (0.1, 0.4, 1, 0.8), 3: (0.5, 0.9, 0.2, 0.8),
              4: (0.1, 0.6, 0.1, 0.8), 5: (1, 0.2, 0.2, 0.9), 6: (1, 0.7, 0.1, 0.9), 7: (0.9, 0.3, 0.9, 0.8),
              8: (0.3, 0.9, 1, 0.9)}
GAP = 255  # cover id and height the data render writes where it hits nothing


def save_png(path, rgba):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new("png_out", w, h, alpha=True)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def export_data():
    """Top-down data render of the same scene at 1 px per metre: an emission override writes the
    object's cover id (pass index) and the hit height. Written row 0 = north, column 0 = west."""
    log("data: top-down data renders at 1 px per metre")
    N = 640
    for ob in bpy.data.objects:
        c = ob.get("cover")
        if c is not None:
            ob.pass_index = COVER_IDS[c]
    M = Mat("data_override")
    info = M.node("ShaderNodeObjectInfo")
    geo = M.node("ShaderNodeNewGeometry")
    z = M._sep(geo.outputs["Position"])[2]
    comb = M.node("ShaderNodeCombineXYZ")
    M.set(comb.inputs[0], info.outputs["Object Index"])
    M.set(comb.inputs[1], z)
    em = M.node("ShaderNodeEmission")
    M.set(em.inputs["Color"], comb.outputs[0])
    M.nt.links.new(em.outputs[0], M.nt.nodes["Material Output"].inputs["Surface"])
    r, cy = SCENE.render, SCENE.cycles
    bg = SCENE.world.node_tree.nodes["Background"]
    saved = (r.resolution_x, cy.samples, cy.use_denoising, cy.filter_width, SCENE.view_settings.view_transform,
             tuple(bg.inputs["Color"].default_value), bg.inputs["Strength"].default_value, cy.max_bounces,
             r.image_settings.file_format, r.image_settings.color_depth)
    bg.inputs["Color"].default_value = (GAP, GAP, 0, 1)
    bg.inputs["Strength"].default_value = 1.0
    r.resolution_x = r.resolution_y = N
    cy.samples, cy.use_denoising, cy.filter_width = 1, False, 0.01
    cy.max_bounces = 0
    SCENE.view_settings.view_transform = "Standard"
    r.image_settings.file_format = "OPEN_EXR"
    r.image_settings.color_depth = "32"
    vl = SCENE.view_layers[0]
    vl.material_override = M.m

    def shoot(name):
        r.filepath = os.path.join(WORK, name + ".exr")
        bpy.ops.render.render(write_still=True)
        return load_pixels(r.filepath)

    allpx = shoot("data_top")
    hidden = [ob for ob in SCENE.objects if ob.name != "terrain" and ob.type == "MESH" and not ob.hide_render]
    for ob in hidden:
        ob.hide_render = True
    groundpx = shoot("data_ground")
    for ob in hidden:
        ob.hide_render = False
    vl.material_override = None
    r.resolution_x = r.resolution_y = saved[0]
    cy.samples, cy.use_denoising, cy.filter_width = saved[1], saved[2], saved[3]
    SCENE.view_settings.view_transform = saved[4]
    bg.inputs["Color"].default_value = saved[5]
    bg.inputs["Strength"].default_value = saved[6]
    cy.max_bounces = saved[7]
    r.image_settings.file_format, r.image_settings.color_depth = saved[8], saved[9]
    cover = np.clip(np.rint(allpx[..., 0]), 0, 255).astype(np.uint8)
    top = allpx[..., 1].astype(np.float32)
    grd = groundpx[..., 1].astype(np.float32)
    # Blender's rows run south to north; the data files run north to south like the grid
    np.flipud(cover).tofile(os.path.join(OUT, "cover_u8.bin"))
    np.flipud(grd).tofile(os.path.join(OUT, "ground_f32.bin"))
    np.flipud(top).tofile(os.path.join(OUT, "top_f32.bin"))
    log("data: cover counts", {k: int((cover == v).sum()) for k, v in COVER_IDS.items()}, "gaps", int((cover == GAP).sum()))
    g = (grd - grd.min()) / max(1e-6, grd.max() - grd.min())
    gy, gx = np.gradient(grd)
    shade = np.clip(0.5 + (-gx - gy) * 0.8, 0, 1)
    v = 0.65 * g + 0.35 * shade
    save_png(os.path.join(PREV, "height.png"), np.dstack([v, v, v, np.ones_like(v)]))
    lut = np.array([COVER_COLS.get(k, (1, 0, 1, 1)) for k in range(256)], np.float32)
    save_png(os.path.join(PREV, "cover.png"), lut[cover])
    obst = np.clip((top - grd) / 15.0, 0, 1)
    save_png(os.path.join(PREV, "obstacle.png"), np.dstack([obst, obst * 0.6, obst * 0.2, (obst > 0.05) * 0.85]))


def r2(v):
    return round(float(v), 2)


def write_meta():
    meta = {
        "name": "Kaltenbach", "village": "Kaltenbach", "river": "Erlenbach", "sizeM": 640,
        "playArea": [{"x": x, "y": y} for x, y in PLAY_AREA],
        "hqs": {side: {"x": x, "y": y, "radius": HQ_RADIUS} for side, (x, y) in HQS.items()},
        "points": [{"id": i, "name": i, "x": x, "y": y, "radius": POINT_RADIUS} for i, x, y in POINTS],
        "crossings": [{"id": i, "kind": k, "x": r2(x), "y": r2(y), "halfWidth": hw} for i, k, x, y, hw in CROSSINGS],
        "grid": {"cols": 9, "rows": 9, "squareM": 640 / 9, "letters": "ABCDEFGHI"},
        "data": {"cells": 640, "cellM": 1, "cover": "cover_u8.bin", "ground": "ground_f32.bin", "top": "top_f32.bin",
                 "coverIds": COVER_IDS},
        "images": {"play": [f"map_{8192 >> k}.webp" for k in range(14)], "outer": {"file": "outer_2048.webp", "sizeM": 1920}},
    }
    with open(os.path.join(OUT, "map.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")


# ----------------------------------------------------------------- image output
def load_pixels(path):
    """RGBA rows bottom to top, as Blender stores them."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def save_image(path, rgb, fmt="WEBP"):
    """Write sRGB-encoded pixels unchanged (Standard view transform, no look)."""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new("out", w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    s = SCENE.render.image_settings
    vt = SCENE.view_settings.view_transform
    SCENE.view_settings.view_transform = "Standard"
    s.file_format, s.color_mode = fmt, "RGB"
    if fmt == "WEBP":
        s.quality = 82
    img.save_render(path, scene=SCENE)
    SCENE.view_settings.view_transform = vt
    s.file_format, s.color_mode = "PNG", "RGBA"
    bpy.data.images.remove(img)


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def write_mips(png):
    """The play-area bake as WebP, halving down to 1 px. Each level averages 2x2 texels in linear
    light: three's GPU mip generation came out dark at 8192 on WebGPU (#23)."""
    lin = to_linear(load_pixels(png)[..., :3])
    while True:
        s = lin.shape[0]
        save_image(os.path.join(OUT, f"map_{s}.webp"), to_srgb(lin))
        if s == 1024:
            save_image(os.path.join(PREV, "map_1024.png"), to_srgb(lin), "PNG")
        log(f"  mip {s}")
        if s == 1:
            break
        lin = 0.25 * (lin[0::2, 0::2] + lin[1::2, 0::2] + lin[0::2, 1::2] + lin[1::2, 1::2])


def render(path):
    SCENE.render.filepath = path
    log(f"render {RES}x{RES} @ {SAMPLES} spp")
    bpy.ops.render.render(write_still=True)
    log("render done")


# ----------------------------------------------------------------------- main
def main():
    global PROTO_COLL
    PROTO_COLL = bpy.data.collections.new("protos")
    SCENE.collection.children.link(PROTO_COLL)
    build_materials()
    extra_materials()
    log("terrain")
    build_terrain()
    log("roads")
    build_roads()
    P = build_protos()
    for x, y, r in [(*CHURCH, 25), (*HALL, 25), (0, 0, 24), (-15, 210, 14), (17, 185, 7)]:
        FOOT.append((x, y, r))
    FOOT.extend([(-x, -y, r) for x, y, r in FOOT])
    log("landmarks")
    build_village_landmarks()
    build_sawmill()
    build_farm_point()
    log("west half, twinned")
    twin(build_village_half)
    twin(lambda: build_hq("nato", *HQS["nato"], 0.0))
    twin(build_border_half)
    twin(build_crossings_half)
    twin(build_banks_half)
    twin(build_poles_half)
    twin(build_corner_hedge_half)
    twin(lambda: fields(lambda x, y: x < -86 and lane(x, y) == "centre" and max(abs(x), abs(y)) <= HALF + 4,
                        (-HALF - 4, -110, -86, 120), 0.0, (40, 72), (45, 58), lambda x, y: 0.5, "centre"))
    log("farmland Lane, hedges, woods")
    fields(lambda x, y: lane(x, y) == "south" and max(abs(x), abs(y)) <= HALF + 4, (-HALF - 4, -HALF - 4, HALF + 4, -90),
           0.0, (40, 96), (50, 80), lambda x, y: 0.45 if abs(x) > 120 else 0.12, "south")
    build_hedges()
    build_woods()
    if OUTER:
        log("surroundings")
        build_surroundings()
    scatter_all(P)
    log("objects", len(bpy.data.objects), "instances", sum(len(v) for v in SC.values()))
    lighting(SCENE, RES, 2 * EXT)
    if OUTER:
        png = os.path.join(WORK, f"outer_{RES}.png")
        render(png)
        rgb = load_pixels(png)[..., :3]
        save_image(os.path.join(OUT, f"outer_{RES}.webp"), rgb)
        save_image(os.path.join(PREV, "outer_preview.png"), rgb[::2, ::2], "PNG")
    else:
        write_meta()
        export_data()
        if MODE == "play":
            png = os.path.join(WORK, f"map_{RES}.png")
            render(png)
            write_mips(png)
        else:
            render(os.path.join(WORK, "map_preview.png"))
    log("BUILD_OK", MODE)


main()
