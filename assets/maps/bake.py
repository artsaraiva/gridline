"""What every map bake shares (ADR 0001, ADR 0002): mode and paths, terrain helpers, the road index, materials,
mesh helpers, buildings, scenery prototypes and scatter, lighting, the data render and the image outputs.
A map's assets/maps/<map>/build.py holds its layout and landmarks, imports this module and calls finish().

Blender runs the map's build.py as __main__, and this module reads the map from it as MAP. The output paths
come from MAP.__file__ on import; the rest is read at call time, and build_materials() checks it is all there:
  HALF, EXT       half the map's side in metres, and half the side of what this mode renders
  RIVER_W         the river's width at the water line, in metres
  TERRAIN_N       vertices along each side of the terrain mesh
  HEIGHT_CELL_M   cell size of the written height grids; the cover grid is always 1 m
  CROSSINGS       [(id, kind, x, y, half width)], kind bridge | footbridge | ford
  height(x, y)    ground height with the river cut in
  rdist(x, y)     distance from the river's centre line
  river_dxdy(y)   the river's slope, as x per y
  zone(x, y)      land use: out | water | road | village | clear | border | bank | woods | farm
  clearing(x, y)  open ground kept free of woods and fields
  woods_val(x, y) woods density: zone() makes woods above 0.48, the edge of a wood is below 0.56
  meadow(x, y)    open ground where lone field trees stand
The map's outputs go to public/maps/<map>/ and its previews and intermediates sit beside its build.py.
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

MAP = sys.modules["__main__"]
NEEDS = ("HALF", "EXT", "RIVER_W", "TERRAIN_N", "HEIGHT_CELL_M", "CROSSINGS", "height", "rdist", "river_dxdy", "zone", "clearing", "woods_val", "meadow")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODE = argv[0] if argv else "preview"
# play and outer sizes are fixed: map.json lists those files and the mip chain needs a power of two
RES = {"play": 8192, "outer": 2048}.get(MODE) or (int(argv[1]) if len(argv) > 1 else 1024)
SAMPLES = int(argv[2]) if len(argv) > 2 else (16 if MODE == "preview" else 32)
OUTER = MODE == "outer"
SUN_ELEV = 24.0

HERE = os.path.dirname(os.path.abspath(MAP.__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
WORK = os.path.join(HERE, "work")  # large intermediates and preview runs, not committed
OUT = WORK if MODE == "preview" else os.path.join(REPO, "public", "maps", os.path.basename(HERE))  # what the game loads
PREV = WORK if MODE == "preview" else os.path.join(HERE, "previews")  # small images for review
for d in (OUT, PREV, WORK):
    os.makedirs(d, exist_ok=True)
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene
rng = random.Random(7)


# ---------------------------------------------------------------- terrain math
def sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def nz(x, y, s, z=0.0):
    return noise.noise(Vector((x / s, y / s, z)))


def bump(x, y, bx, by, r, h):
    r2 = ((x - bx) ** 2 + (y - by) ** 2) / (r * r)
    return h * (1 - r2) ** 2 if r2 < 1 else 0.0


def bank(d=0.0):
    """Distance from the river's centre line to d metres past its water line."""
    return MAP.RIVER_W / 2 + d


# ---------------------------------------------------------------------- roads
HALFW = {"main": 3.4, "minor": 2.7, "track": 1.7, "kolonne": 1.7, "path": 1.0, "rail": 2.4}
ZOFF = {"main": 0.24, "minor": 0.22, "track": 0.2, "kolonne": 0.2, "path": 0.18, "rail": 0.16}  # a road crosses over the rails
ROAD_PTS = []  # (kind, [(x, y)]) every 2 m along each road, filled by index_roads(); the first road is the main road
RS = []  # every road point: (x, y, half width, kind)
KD = None


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


def index_roads(roads):
    """Spline the map's roads ([(kind, control points)]; a Kolonnenweg comes already sampled) and index them."""
    global KD
    ROAD_PTS.extend((kind, catmull(pts) if kind != "kolonne" else pts) for kind, pts in roads)
    for kind, pts in ROAD_PTS:
        for x, y in pts:
            RS.append((x, y, HALFW[kind], kind))
    KD = kdtree.KDTree(len(RS))
    for i, (x, y, _, _) in enumerate(RS):
        KD.insert((x, y, 0), i)
    KD.balance()
    # the river is crossable only at the crossings: no road may touch the water anywhere else on the map
    for kind, pts in ROAD_PTS:
        for x, y in pts:
            if max(abs(x), abs(y)) < MAP.HALF + 20 and MAP.rdist(x, y) < bank(3) and not near_crossing(x, y, bank(10)):
                raise SystemExit(f"{kind} road touches the river at ({x:.0f}, {y:.0f}) away from a crossing")


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


def near_crossing(x, y, pad, kind=None):
    return any(math.hypot(x - cx, y - cy) < hw + pad for _, k, cx, cy, hw in MAP.CROSSINGS if kind in (None, k))


def near_bridge(x, y):
    """Within reach of a road bridge's deck, even where the road meets the river at a slant."""
    return near_crossing(x, y, 2 * bank(22), "bridge")


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
    missing = [k for k in NEEDS if not hasattr(MAP, k)]
    if missing:  # every bake builds its materials before anything else, once the map script has defined its layout
        raise SystemExit(f"{MAP.__file__} must define {', '.join(missing)} (see assets/maps/bake.py)")
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
        elif kind == "rail":  # ballast bed, sleepers every 0.6 m, two rails at standard gauge
            c = M.mix(M.mr(M.noise(w, 1.5, 4), 0.3, 0.7), (0.20, 0.19, 0.17), (0.28, 0.27, 0.24))
            sleeper = M.math("MULTIPLY", M.mr(au, 0.58, 0.52), M.stripes(uv[1], 0.6, 0.4))
            c = M.mix(M.math("MULTIPLY", sleeper, 0.85), c, (0.16, 0.12, 0.09))
            c = M.mix(M.band(au, 0.27, 0.33, 0.01), c, (0.32, 0.32, 0.33))
            c = M.mix(M.mr(au, 0.8, 1.0), c, (0.17, 0.18, 0.10))
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
    road("r_rail", "rail")

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
    zs = [MAP.height(cx + x * ca - y * sa, cy + x * sa + y * ca) for x in (-w / 2, w / 2) for y in (-d / 2, d / 2)]
    return min(zs), max(zs)


FOOT = []  # (x, y, r) occupied footprints


def free(x, y, r, road_margin=1.5, river=None):
    """No footprint, road or river within r; river is the clearance from the river's centre line (6 m past the water)."""
    for fx, fy, fr in FOOT:
        if (x - fx) ** 2 + (y - fy) ** 2 < (r + fr) ** 2:
            return False
    return not on_road(x, y, r * 0.65 + road_margin) and MAP.rdist(x, y) > r + (bank(6) if river is None else river)


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
            verts.append((x, y, MAP.height(wx, wy) + zoff))
    for j in range(ny):
        for i in range(nx):
            k = j * (nx + 1) + i
            faces.append((k, k + 1, k + nx + 2, k + nx + 1))
    return make_obj(name, verts, faces, [m], loc=(cx, cy, 0), rot=a, cover=cover)


def disc_patch(name, cx, cy, r, m, zoff=0.08, n=40):
    verts = [(0, 0, MAP.height(cx, cy) + zoff)]
    for k in range(n):
        x, y = r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)
        verts.append((x, y, MAP.height(cx + x, cy + y) + zoff))
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
    global PROTO_COLL
    PROTO_COLL = bpy.data.collections.new("protos")
    SCENE.collection.children.link(PROTO_COLL)
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


# -------------------------------------------------------------------- scatter
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
    SC[name].append((x, y, MAP.height(x, y) + zoff, s, rng.uniform(0, 2 * math.pi) if a is None else a))


def tree_at(x, y, kind=None, s=None):
    if kind is None:
        kind = rng.choice(["decid0", "decid1", "decid2", "bare0", "bare1"])
    put(kind, x, y, s or rng.uniform(0.75, 1.2))


def hedge_line(pts, gap=False, offset=0.0, trees=0.08):
    """Hedgerow of bushes with the odd tree: blocks sight, not movement."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-6:
            continue
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        s, gap_at = 0.0, rng.uniform(0, L) if gap else -99
        while s < L:
            x = x0 + (x1 - x0) * s / L + nx * offset
            y = y0 + (y1 - y0) * s / L + ny * offset
            s += rng.uniform(1.3, 2.2)
            if abs(s - gap_at) < 5 or on_road(x, y, 1.0) or MAP.zone(x, y) in ("water", "village", "border") or MAP.clearing(x, y):
                continue
            x += rng.uniform(-0.6, 0.6)
            y += rng.uniform(-0.6, 0.6)
            if rng.random() < trees:
                tree_at(x, y)
            else:
                put("bush" + str(rng.randint(0, 2)), x, y, rng.uniform(1.3, 2.6))


def build_banks():
    """Alder scrub and reeds along the river, kept off the water so the channel stays readable."""
    sp = 3.0
    lim = min(MAP.EXT, MAP.HALF + 60)
    for x in np.arange(-lim, lim, sp):
        for y in np.arange(-lim, lim, sp):
            px, py = x + rng.uniform(-1.2, 1.2), y + rng.uniform(-1.2, 1.2)
            d = MAP.rdist(px, py)
            if d > bank(8) or d < bank(1.5):
                continue
            z = MAP.zone(px, py)
            if z != "bank" and not (z == "clear" and d > bank(5) and not MAP.clearing(px, py) and not near_crossing(px, py, 10)):
                continue
            if d < bank(3.5) and rng.random() < 0.35:
                put("reed", px, py, rng.uniform(0.9, 1.3))
            elif d >= bank(3.5) and rng.random() < 0.4:
                put("bush" + str(rng.randint(0, 2)), px, py, rng.uniform(1.2, 1.9))
            elif d >= bank(5.5) and rng.random() < 0.3:
                tree_at(px, py, rng.choice(["decid0", "decid2", "bare0"]), rng.uniform(0.7, 1.0))


def build_poles():
    for kind, pts in ROAD_PTS:
        if kind in ("main", "minor"):
            for i in range(0, len(pts) - 1, 22):
                x, y = pts[i]
                t = Vector((pts[i + 1][0] - x, pts[i + 1][1] - y)).normalized()
                px, py = x - t.y * (HALFW[kind] + 4), y + t.x * (HALFW[kind] + 4)
                if MAP.zone(px, py) in ("farm", "bank") or MAP.zone(px, py) == "clear" and not MAP.clearing(px, py):
                    put("pole", px, py, 1.0, math.atan2(t.y, t.x) + math.pi / 2)


def build_woods():
    trees = 0
    sp = 5.5 if OUTER else 4.2
    for x in np.arange(-MAP.EXT - 4, MAP.EXT + 4, sp):
        for y in np.arange(-MAP.EXT - 4, MAP.EXT + 4, sp):
            plantation = nz(x, y, 120, 3.3) > 0.22
            px, py = (x, y) if plantation else (x + rng.uniform(-2, 2), y + rng.uniform(-2, 2))
            z = MAP.zone(px, py)
            if z == "woods":
                edge = MAP.woods_val(px, py) < 0.56
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
            elif z == "farm" and rng.random() < 0.004:
                tree_at(px, py, s=rng.uniform(1.0, 1.4))
            elif z == "clear" and MAP.meadow(px, py) and rng.random() < 0.006:
                tree_at(px, py, s=rng.uniform(1.0, 1.4))  # lone field trees on the open approaches
    log(f"  woods trees: {trees}")


# ------------------------------------------------------------------ buildings
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
        if not on_road(x, y, 2) and MAP.zone(x, y) != "water":
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
                if on_road(x, y, 0.8) or MAP.zone(x, y) == "water":
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
            SC["wrap"].append((x - j * 1.45 * sa, y + j * 1.45 * ca, MAP.height(x, y), 1.0, 0.0))
    # silage clamp with tyres
    sx, sy = W(yw / 2 + 22, -4)
    mb = MB()
    mb.box(0, 0, -1, 9, 30, 2.6, "silage")
    mb.box(-4.8, 0, -1, 0.5, 31, 3.4, "concrete")
    mb.box(4.8, 0, -1, 0.5, 31, 3.4, "concrete")
    mb.obj(f"clamp_{tag}", (sx, sy, MAP.height(sx, sy)), a, "wall")
    FOOT.append((sx, sy, 15))
    if big:
        for k in range(3):
            x, y = W(-yw / 2 - 16, -10 + k * 6.5)
            mb = MB()
            mb.cyl(0, 0, -1, 2.8, 14, "metal", 16)
            mb.obj(f"silo_{tag}_{k}", (x, y, MAP.height(x, y)), 0, "building")


# ----------------------------------------------------------------- the world
def build_terrain():
    n = MAP.TERRAIN_N
    xs = np.linspace(-MAP.EXT - 4, MAP.EXT + 4, n)
    verts, cols = [], []
    col = {"water": (0.10, 0.09, 0.07), "bank": (0.12, 0.13, 0.07), "woods": (0.08, 0.06, 0.04),
           "village": (0.13, 0.15, 0.07), "border": (0.17, 0.165, 0.10), "road": (0.14, 0.15, 0.08),
           "clear": (0.14, 0.16, 0.08), "farm": (0.14, 0.16, 0.08), "out": (0.14, 0.15, 0.08)}
    for y in xs:
        for x in xs:
            verts.append((x, y, MAP.height(x, y)))
            cols.extend((*col[MAP.zone(x, y)], 1.0))
    faces = []
    for j in range(n - 1):
        for i in range(n - 1):
            k = j * n + i
            faces.append((k, k + 1, k + n + 1, k + n))
    ob = make_obj("terrain", verts, faces, ["terrain"], cover="open", smooth=True)
    ca = ob.data.color_attributes.new("zcol", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", cols)
    me = bpy.data.meshes.new("water")
    s = MAP.EXT + 10
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
            far = max(abs(x), abs(y)) > MAP.HALF + 20  # beyond the map a road bridges the river without parapets
            # a road bridge's deck stands 2 m over the water; rails cross lower, under the walkway the crossing builds
            lift = 2.0 if far or near_bridge(x, y) else 0.9 if kind == "rail" and near_crossing(x, y, 2 * bank(22)) else 0
            deck = lift * (1 - sstep(bank(5), bank(22), MAP.rdist(x, y))) if lift else -9
            for side in (-1, 1):
                px, py = x + nrm.x * hw * side, y + nrm.y * hw * side
                verts.append((px, py, max(MAP.height(px, py) + ZOFF[kind], deck + ZOFF[kind])))
                uvs.append((side, dist))
        for i in range(len(pts) - 1):
            k = 2 * i
            faces.append((k, k + 2, k + 3, k + 1))
        mname = {"main": "r_main", "minor": "r_minor", "track": "r_track", "path": "r_track", "kolonne": "r_kolonne",
                 "rail": "r_rail"}[kind]
        ob = make_obj(f"road_{idx}_{kind}", verts, faces, [mname], cover="open" if kind == "rail" else "road")
        uv = ob.data.uv_layers.new(name="UVMap")
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv = uvs[ob.data.loops[li].vertex_index]
    # bridges: parapets and piers where a road crosses the river on a bridge
    mb = MB()
    for kind, pts in ROAD_PTS:
        hw = HALFW[kind]
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            if MAP.rdist(x0, y0) < bank(9) and max(abs(x0), abs(y0)) < MAP.HALF and near_bridge(x0, y0):
                t = Vector((x1 - x0, y1 - y0))
                L = t.length
                t.normalize()
                nrm = Vector((-t.y, t.x))
                a = math.atan2(t.y, t.x)
                for side in (-1, 1):
                    cx, cy = (x0 + x1) / 2 + nrm.x * (hw + 0.8) * side, (y0 + y1) / 2 + nrm.y * (hw + 0.8) * side
                    mb.box(cx, cy, 2.0, L + 0.05, 0.45, 1.0, "stone", a=a)
                mb.box((x0 + x1) / 2, (y0 + y1) / 2, 0.8, L + 0.05, 2 * hw + 2, 1.4, "stone", a=a)
    mb.obj("bridge", cover="road")


def build_crossings():
    """Footbridges and fords (a bridge comes with its road)."""
    for _, kind, cx, cy, hw in MAP.CROSSINGS:
        if kind == "bridge":
            continue
        a = math.atan(MAP.river_dxdy(cy))  # across the river: local x runs across, tilted with the channel
        if kind == "footbridge":
            mb = MB()
            L = MAP.RIVER_W + 13
            mb.box(0, 0, 1.0, L, 2.2, 0.3, "timber")
            for side in (-1, 1):
                mb.box(0, side * 1.05, 1.3, L, 0.12, 0.1, "timber")
                for k in range(7):
                    mb.box(-L / 2 + 0.2 + k * (L - 0.4) / 6, side * 1.05, 1.3, 0.14, 0.14, 1.0, "timber")
                    mb.box(-L / 2 + 0.2 + k * (L - 0.4) / 6, side * 1.05, 2.25, 0.14, 0.14, 0.1, "timber")
            for px in (-5.5, 0, 5.5):
                mb.box(px * L / 25, 0, -2.0, 0.5, 1.8, 3.0, "concrete")
            mb.obj(f"footbridge_{cy:+.0f}", (cx, cy, 0.0), -a, "road")
        else:
            e = bank(4)
            make_obj(f"ford_{cy:+.0f}", [(-e, -hw, 0.04), (e, -hw, 0.04), (e, hw, 0.04), (-e, hw, 0.04)],
                     [(0, 1, 2, 3)], ["ford"], loc=(cx, cy, 0), rot=-a, cover="ford")
            for side in (-1, 1):  # marker posts on both banks
                for s in (-1, 1):
                    put("post", cx + side * bank(3.5) * math.cos(a), cy + s * (hw + 0.6), 1.3)


VEHICLE_SLOTS = {}  # #107: per side, where its tanks wait: one under each vehicle-park camo net (build_hq)
HELIPADS = {}  # #109: per side, where its transport helicopter waits: open sand between the camo nets (build_hq); no pad drawn yet


def build_hq(tag, cx, cy, a, s=1.0):
    """Requisitioned motor pool: a ~70 m sandbagged compound with tents, containers, trucks under camo nets, sized for a
    35 m HQ radius; s spreads the compound for a bigger HQ, its tents and vehicles keep their size."""
    ca, sa = math.cos(a), math.sin(a)

    def W(x, y):
        return cx + x * s * ca - y * s * sa, cy + x * s * sa + y * s * ca

    flat_patch(f"hq_{tag}_ground", cx, cy, 70 * s, 64 * s, a, "sand", 0.11, cover="open")
    mb = MB()
    for (x0, y0), (x1, y1) in [((-35, -32), (35, -32)), ((-35, 32), (35, 32)), ((-35, -32), (-35, -7)), ((-35, 7), (-35, 32)),
                               ((35, -32), (35, -7)), ((35, 7), (35, 32))]:
        x0, y0, x1, y1 = x0 * s, y0 * s, x1 * s, y1 * s
        L = math.hypot(x1 - x0, y1 - y0)
        mb.box((x0 + x1) / 2, (y0 + y1) / 2, -1, L if y0 == y1 else 1.0, 1.0 if y0 == y1 else L, 2.2, "sand")
    mb.obj(f"hq_{tag}_berm", (cx, cy, MAP.height(cx, cy) - 0.5), a, "wall")
    for i, (x, y) in enumerate([(-22, 20), (-22, 7), (-22, -6), (-10, 22)]):
        mb = MB()
        gable(mb, 5.5, 9, 1.8, 35, "canvas", "canvas", oh=0.2, z0=-0.5)
        wx, wy = W(x, y)
        mb.obj(f"hq_{tag}_tent{i}", (wx, wy, MAP.height(wx, wy)), a + (math.pi / 2 if i == 3 else 0), "building")
    for i in range(6):
        wx, wy = W(24, -24 + i * 3.0)
        mb = MB()
        mb.box(0, 0, -0.3, 6.1, 2.45, 2.9, "container")
        mb.obj(f"hq_{tag}_cont{i}", (wx, wy, MAP.height(wx, wy)), a + math.pi / 2, "building")
    mb = MB()
    mb.cyl(0, 0, -0.5, 0.25, 22, "metal", 6)
    wx, wy = W(4, 14)
    mb.obj(f"hq_{tag}_mast", (wx, wy, MAP.height(wx, wy)), 0, "prop")
    r = random.Random(11 if tag == "nato" else 23)
    for net, (nx0, ny0) in enumerate([(4, -18), (8, 18)]):  # vehicle park: trucks under camo nets
        for i in range(3):
            wx, wy = W(nx0 - 6 + i * 5, ny0)
            mb = MB()
            mb.box(3.2, 0, 0.5, 2.0, 2.5, 2.4, "milgreen")
            mb.box(-1.0, 0, 0.6, 6.0, 2.5, 2.6, "canvas")
            mb.obj(f"hq_{tag}_truck{net}{i}", (wx, wy, MAP.height(wx, wy)), a + math.pi / 2, "prop")
        nx, ny = 14, 10
        verts, faces = [], []
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
        wx, wy = W(nx0 - 1, ny0)
        make_obj(f"hq_{tag}_net{net}", verts, faces, ["camonet"], loc=(wx, wy, MAP.height(wx, wy)), rot=a, cover="prop")
        VEHICLE_SLOTS.setdefault(tag, []).append((wx, wy))
    HELIPADS[tag] = W(6, 0)
    FOOT.append((cx, cy, 46 * s))


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
    object's cover id (pass index) and the hit height. Written row 0 = north, column 0 = west; the cover
    grid at 1 m, the height grids at the map's HEIGHT_CELL_M."""
    log("data: top-down data renders at 1 px per metre")
    N = int(2 * MAP.HALF)
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
    # the river is water whatever hangs over it: the ground pass sees the bed below the water plane
    # (a reading of the scene, not an override: the bed lies under the water plane, only crossings span it)
    river = (grd < -0.2) & ~np.isin(cover, [COVER_IDS["road"], COVER_IDS["ford"]])
    cover[river] = COVER_IDS["water"]
    # Blender's rows run south to north; the data files run north to south like the grid
    np.flipud(cover).tofile(os.path.join(OUT, "cover_u8.bin"))
    k = MAP.HEIGHT_CELL_M
    if k == 1:
        np.flipud(grd).tofile(os.path.join(OUT, "ground_f32.bin"))
        np.flipud(top).tofile(os.path.join(OUT, "top_f32.bin"))
    else:  # each k x k block: the mean ground and the highest top
        blocks = (N // k, k, N // k, k)
        np.flipud(grd.reshape(blocks).mean(axis=(1, 3))).astype(np.float32).tofile(os.path.join(OUT, "ground_f32.bin"))
        np.flipud(top.reshape(blocks).max(axis=(1, 3))).astype(np.float32).tofile(os.path.join(OUT, "top_f32.bin"))
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


def finish(P, meta):
    """Scatter the instances, light the scene, then write what this mode makes. play: map.json (meta), the
    data render, the 8192 render and its mips. preview: the same into work/ at RES, without the mips. outer:
    the surroundings image."""
    scatter_all(P)
    log("objects", len(bpy.data.objects), "instances", sum(len(v) for v in SC.values()))
    lighting(SCENE, RES, 2 * MAP.EXT)
    if OUTER:
        png = os.path.join(WORK, f"outer_{RES}.png")
        render(png)
        rgb = load_pixels(png)[..., :3]
        save_image(os.path.join(OUT, f"outer_{RES}.webp"), rgb)
        save_image(os.path.join(PREV, "outer_preview.png"), rgb[::2, ::2], "PNG")
    else:
        with open(os.path.join(OUT, "map.json"), "w") as f:
            json.dump(meta, f, indent=1)
            f.write("\n")
        export_data()
        if MODE == "play":
            png = os.path.join(WORK, f"map_{RES}.png")
            render(png)
            write_mips(png)
        else:
            render(os.path.join(WORK, "map_preview.png"))
    log("BUILD_OK", MODE)
