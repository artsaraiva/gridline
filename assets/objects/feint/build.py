"""Build the Feint's dummy paratrooper 3D asset and its top-down sprite sheet (#143).

Headless Blender script (ADR 0001, ADR 0002), laid out as the Redeploy Beacon's bake (assets/objects/beacon/build.py). The decoy
is the SAS's paradummy of D-Day (the "Rupert"): a crude doll of stuffed burlap a little under a man's size, with a steel helmet
and webbing, a string of red firecrackers strapped across its chest, under a personnel canopy of white and sand gores (paler
than the Supply Drop's olive and tan and the beacon's olive and grey, so it reads apart from both in the air). Rendered
top-down with Kaltenbach's sun (azimuth 45 deg NE, elevation 24 deg) and sky fill:
  frames 0-7  the dummy hanging limp under its canopy through one pendulum swing (falling),
  frame 8     the falling assembly's soft ground shadow (Cycles shadow catcher, overhead sun),
  frame 9     the dummy on the ground, spread-eagled on its back with the spent firecrackers on its chest and their red paper
              scattered round it, its canopy collapsed beside it, and its own cast shadow.
The frames are packed into `public/objects/feint.png`; the assembly is exported as a .glb source.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/objects/feint/build.py
"""
import json
import math
import os
import random
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT_SHEET = os.path.join(ROOT, "public", "objects", "feint.png")
OUT_GLB = os.path.join(HERE, "feint.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 256
ORTHO_M = 8.0  # world metres across one frame; FEINT_WORLD_M in src/console/sprites/feint.ts
SWING_FRAMES = 8
SUN_ELEV = 24.0
SUN_AZ = 45.0

CANOPY_R = 2.0
CANOPY_H = 1.2
GORES = 12
LINE_L = 3.6  # canopy skirt to the riser confluence above the dummy
RISER_L = 0.7  # confluence down to its shoulders
TALL = 1.5  # the doll, feet to the crown of its helmet: a little under a man
TILT = 34.0  # mean pendulum lean, the dummy swung toward the south-west of the canopy
SWING = 7.0
CROSS = 5.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
random.seed(143)


def material(name, color, roughness=0.8, metallic=0.0, fabric=False, crinkle=6.0):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if not fabric:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        return mat
    # Cloth with a faint weave and crinkle, so neither the canopy nor the burlap reads as plastic.
    coord = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = crinkle
    n.inputs["Detail"].default_value = 4.0
    nt.links.new(coord.outputs["Object"], n.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (color[0] * 0.8, color[1] * 0.8, color[2] * 0.8, 1)
    mix.inputs["B"].default_value = (*color, 1)
    nt.links.new(n.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.3
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


burlap = material("Burlap", (0.33, 0.24, 0.13), 0.95, fabric=True, crinkle=40.0)  # darker than the sand gores, so the doll stands off its canopy
helmet = material("HelmetOD", (0.055, 0.06, 0.035), 0.5, 0.1)
webbing = material("Webbing", (0.075, 0.08, 0.05), 0.7)
cracker = material("FirecrackerRed", (0.60, 0.05, 0.035), 0.45)
paper = material("CrackerPaper", (0.62, 0.55, 0.38), 0.8)
fuse = material("Fuse", (0.04, 0.04, 0.035), 0.8)
white = material("CanopyWhite", (0.62, 0.62, 0.58), 0.75, fabric=True)
sand = material("CanopySand", (0.36, 0.32, 0.22), 0.75, fabric=True)
cord = material("SuspensionCord", (0.62, 0.60, 0.52), 0.6)


def cylinder_between(name, a, b, r, mat, vertices=8):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=(b - a).length, location=(a + b) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(mat)
    return o


def ball(name, at, r, mat, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=r, location=at)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def limb(name, a, b, r, mat):
    """A stuffed sausage of a limb: a tube from `a` to `b` with rounded ends."""
    return [cylinder_between(name, a, b, r, mat, 12), ball(f"{name}A", a, r, mat), ball(f"{name}B", b, r * 0.95, mat)]


def dummy(prefix, lying):
    """The doll, in its own frame: hanging upright (feet at z = 0, chest +Y) or lying on its back spread-eagled (head +Y, chest up)."""
    k = TALL / 1.5

    def at(x, y, z):
        """A point of the upright doll (x right, y chest-forward, z up); lying, it is turned onto its back with the head to +Y."""
        p = Vector((x * k, y * k, z * k))
        return Vector((p.x, p.z - 0.75 * k, 0.09 * k - p.y)) if lying else p

    hip, shoulder = 0.70, 1.17
    arm_to = (0.62, 0.0, 1.32) if lying else (0.27, 0.02, 0.66)  # lying, the arms are flung out and up
    leg_to = (0.30, 0.0, 0.02) if lying else (0.12, 0.02, 0.02)  # ... and the legs apart
    parts = []
    # torso: a stuffed sack, wider at the shoulders, flattened front to back
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.18 * k, depth=(shoulder - hip + 0.08) * k, location=at(0, 0, (hip + shoulder) / 2))
    torso = bpy.context.object
    torso.name = f"{prefix}Torso"
    torso.scale = (1.0, 0.72, 1.0)
    if lying:
        torso.rotation_euler = (math.pi / 2, 0, 0)
    torso.data.materials.append(burlap)
    parts.append(torso)
    parts.append(ball(f"{prefix}Seat", at(0, 0, hip), 0.165 * k, burlap, (1.0, 0.72, 0.7)))
    parts.append(ball(f"{prefix}Neck", at(0, 0, shoulder + 0.04), 0.17 * k, burlap, (1.05, 0.75, 0.45)))
    parts.append(ball(f"{prefix}Head", at(0, 0, 1.33), 0.105 * k, burlap))
    helm = ball(f"{prefix}Helmet", at(0, 0.01, 1.37), 0.15 * k, helmet, (1.0, 1.08, 0.62))
    if lying:
        helm.rotation_euler = (math.pi / 2, 0, 0)
    parts.append(helm)
    for s in (-1, 1):
        parts += limb(f"{prefix}Arm{s}", at(0.21 * s, 0, shoulder - 0.02), at(arm_to[0] * s, arm_to[1], arm_to[2]), 0.058 * k, burlap)
        parts += limb(f"{prefix}Leg{s}", at(0.09 * s, 0, hip - 0.04), at(leg_to[0] * s, leg_to[1], leg_to[2]), 0.075 * k, burlap)
        # webbing: a shoulder strap down the chest and a leg loop
        parts.append(cylinder_between(f"{prefix}Strap{s}", at(0.11 * s, 0.13, shoulder + 0.02), at(0.07 * s, 0.135, hip + 0.04), 0.022 * k, webbing))
        parts.append(cylinder_between(f"{prefix}Loop{s}", at(0.15 * s, 0.07, hip - 0.05), at(0.03 * s, 0.12, hip - 0.1), 0.02 * k, webbing))
    parts.append(cylinder_between(f"{prefix}ChestStrap", at(-0.15, 0.135, 0.98), at(0.15, 0.135, 0.98), 0.02 * k, webbing))
    # the firecrackers: a string of red tubes across the chest, shoulder to hip, on a fuse
    a, b = Vector((-0.12, 0.15, 1.10)), Vector((0.13, 0.15, 0.78))
    n = 7
    for i in range(n):
        c = a + (b - a) * (i / (n - 1))
        tube = cylinder_between(f"{prefix}Cracker{i}", at(c.x - 0.06, c.y + 0.02, c.z - 0.025), at(c.x + 0.06, c.y + 0.02, c.z + 0.025), 0.034 * k, cracker, 10)
        parts.append(tube)
        parts.append(ball(f"{prefix}CrackerEnd{i}", at(c.x + 0.062, c.y + 0.02, c.z + 0.026), 0.03 * k, paper))
    parts.append(cylinder_between(f"{prefix}Fuse", at(a.x, a.y + 0.03, a.z), at(b.x, b.y + 0.03, b.z), 0.007 * k, fuse, 6))
    return parts


def canopy():
    """Inflated gored canopy with an open apex vent; skirt scalloped between the suspension lines."""
    bm = bmesh.new()
    rings = 12
    seg = GORES * 6
    phis = [math.radians(9 + (82 - 9) * i / (rings - 1)) for i in range(rings)]
    verts = []
    for i, phi in enumerate(phis):
        row = []
        for kk in range(seg):
            t = kk / seg
            frac = (kk % 6) / 6
            bulge = 1 + 0.05 * math.sin(math.pi * frac) * (0.4 + 0.6 * i / (rings - 1))
            r = CANOPY_R * math.sin(phi) / math.sin(phis[-1]) * bulge
            z = CANOPY_H * math.cos(phi) - 0.06 * math.sin(math.pi * frac) * (i / (rings - 1)) ** 2
            row.append(bm.verts.new((r * math.cos(2 * math.pi * t), r * math.sin(2 * math.pi * t), z)))
        verts.append(row)
    for i in range(rings - 1):
        for kk in range(seg):
            j = (kk + 1) % seg
            f = bm.faces.new((verts[i][kk], verts[i][j], verts[i + 1][j], verts[i + 1][kk]))
            f.material_index = (kk // 6) % 2
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Canopy")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(white)
    me.materials.append(sand)
    o = bpy.data.objects.new("Canopy", me)
    scene.collection.objects.link(o)
    o.modifiers.new("solid", "SOLIDIFY").thickness = 0.02
    skirt = [Vector((CANOPY_R * math.cos(2 * math.pi * g / GORES), CANOPY_R * math.sin(2 * math.pi * g / GORES),
                     CANOPY_H * math.cos(phis[-1]))) for g in range(GORES)]
    return o, skirt


# ---------------------------------------------------------------- falling assembly
# Built hanging straight down with the canopy skirt centre at the origin, then leaned as a rigid pendulum.
canopy_obj, skirt = canopy()
confluence = Vector((0, 0, -LINE_L))
shoulders_z = confluence.z - RISER_L
drop = shoulders_z - 1.19 * TALL / 1.5  # the doll's feet, so its shoulders meet the risers
hang = dummy("Hang", lying=False)
for p in hang:
    p.location.z += drop
lines = [cylinder_between(f"Line{g}", s, confluence, 0.022, cord, 6) for g, s in enumerate(skirt)]
lines += [cylinder_between(f"Riser{s}", confluence, (0.11 * s, 0.0, shoulders_z), 0.03, webbing, 6) for s in (-1, 1)]
assembly = [canopy_obj, *hang, *lines]

rig = bpy.data.objects.new("FeintDummy", None)
scene.collection.objects.link(rig)
for o in assembly:
    o.parent = rig

# Lean axis: horizontal and perpendicular to the south-west, so the dummy swings out SW of the canopy.
LEAN_AXIS = Vector((1, -1, 0)).normalized()
CROSS_AXIS = Vector((1, 1, 0)).normalized()
PIVOT = Vector((0, 0, -LINE_L * 0.35))


def pose(lean, cross):
    rot = Matrix.Rotation(math.radians(-lean), 4, LEAN_AXIS) @ Matrix.Rotation(math.radians(cross), 4, CROSS_AXIS)
    rig.matrix_world = Matrix.Translation(PIVOT) @ rot @ Matrix.Translation(-PIVOT)


# Frame centre: midway between canopy and dummy in the mean pose, so the swing stays centred in the cell.
pose(TILT, 0)
bpy.context.view_layer.update()
dummy_mid = rig.matrix_world @ Vector((0, 0, drop + 0.95 * TALL / 1.5))
canopy_mid = rig.matrix_world @ Vector((0, 0, CANOPY_H * 0.5))
CENTRE = (dummy_mid + canopy_mid) / 2
print(f"dummy offset from frame centre: {dummy_mid.x - CENTRE.x:.3f}, {dummy_mid.y - CENTRE.y:.3f} m")

bpy.ops.object.select_all(action="DESELECT")
for o in assembly:
    o.select_set(True)
bpy.context.view_layer.objects.active = canopy_obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True, export_apply=True)

# ---------------------------------------------------------------- camera, sun, sky (as the map bake)
cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = ORTHO_M
cam_d.clip_end = 100.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (CENTRE.x, CENTRE.y, 30.0)
scene.collection.objects.link(cam)
scene.camera = cam

sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 4.2
sun_d.angle = math.radians(0.6)
sun_d.color = (1.0, 0.95, 0.88)
sun = bpy.data.objects.new("sun", sun_d)
el = math.radians(SUN_ELEV)
az = math.radians(SUN_AZ)
SUN_ROT = Vector((-math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), -math.sin(el))).to_track_quat("-Z", "Y").to_euler()
sun.rotation_euler = SUN_ROT
scene.collection.objects.link(sun)

world = bpy.data.worlds.new("sky")
scene.world = world
bg = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.40, 0.48, 0.62, 1.0)
bg.inputs["Strength"].default_value = 0.55

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for dv in prefs.devices:
    dv.use = True
scene.cycles.device = "GPU"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
scene.render.film_transparent = True
scene.render.resolution_x = FRAME_PX
scene.render.resolution_y = FRAME_PX
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"


def load_pixels(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def save_sheet(path, rgba):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new("sheet", w, h, alpha=True)
    img.pixels.foreach_set(np.clip(rgba, 0.0, 1.0).astype(np.float32).ravel())
    vt = scene.view_settings.view_transform
    scene.view_settings.view_transform = "Standard"
    img.save_render(path, scene=scene)
    scene.view_settings.view_transform = vt
    bpy.data.images.remove(img)


def render(tmp, name):
    path = os.path.join(tmp, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return load_pixels(path)


def catcher(z):
    bpy.ops.mesh.primitive_plane_add(size=ORTHO_M * 0.96, location=(cam.location.x, cam.location.y, z))
    c = bpy.context.object
    c.is_shadow_catcher = True
    return c


def collapsed_canopy():
    """The canopy lying deflated on the ground beside the dummy: wrinkled, gored, west of it so its long shadow stays clear."""
    bm = bmesh.new()
    rings, seg = 12, GORES * 4
    verts = []
    for i in range(rings):
        rr = 0.04 + i / (rings - 1)
        row = []
        for kk in range(seg):
            t = 2 * math.pi * kk / seg
            edge = 1 + 0.28 * noise.noise(Vector((math.cos(t) * 1.3, math.sin(t) * 1.3, 4.0)))
            x, y = 0.7 * rr * edge * math.cos(t), 1.2 * rr * edge * math.sin(t)
            fold = abs(noise.noise(Vector((x * 2.4, y * 1.1, 0.3))))
            z = 0.03 + 0.28 * fold + 0.05 * noise.noise(Vector((x * 5, y * 5, 2.9))) + 0.14 * (1 - rr)
            row.append(bm.verts.new((x, y, max(0.02, z))))
        verts.append(row)
    for i in range(rings - 1):
        for kk in range(seg):
            j = (kk + 1) % seg
            f = bm.faces.new((verts[i][kk], verts[i][j], verts[i + 1][j], verts[i + 1][kk]))
            f.material_index = (kk // 4) % 2
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Collapsed")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(white)
    me.materials.append(sand)
    o = bpy.data.objects.new("CollapsedCanopy", me)
    scene.collection.objects.link(o)
    o.location = (-1.75, 0.55, 0)
    o.rotation_euler = (0, 0, math.radians(-12))
    return o


frames = []
with tempfile.TemporaryDirectory() as tmp:
    # Falling: one full pendulum swing (lean in and out, with a small elliptical cross swing).
    for kk in range(SWING_FRAMES):
        a = 2 * math.pi * kk / SWING_FRAMES
        pose(TILT + SWING * math.sin(a), CROSS * math.cos(a))
        frames.append(render(tmp, f"swing-{kk}"))

    # Falling shadow: overhead soft sun onto a catcher, assembly hidden from camera (offset at runtime by altitude).
    pose(TILT, 0)
    for o in assembly:
        o.visible_camera = False
    bg.inputs["Strength"].default_value = 0.0
    low = min((o.matrix_world @ Vector(c)).z for o in hang for c in o.bound_box)
    shadow_plane = catcher(low - 0.05)
    sun.rotation_euler = (0, 0, 0)
    sun_d.angle = math.radians(6.0)
    px = render(tmp, "shadow")
    px[..., :3] = 0.0
    px[..., 3] = np.where(px[..., 3] < 0.08, 0.0, np.clip(px[..., 3] * 1.6, 0.0, 0.9))
    frames.append(px)

    # Landed: the dummy spread-eagled on its back at the frame centre (head to the north-east), its canopy collapsed beside
    # it, the spent firecrackers' red paper scattered round it, its own cast shadow.
    for o in assembly:
        o.hide_render = True
    bpy.data.objects.remove(shadow_plane)
    cam.location = (0, 0, 30.0)
    bg.inputs["Strength"].default_value = 0.55
    sun.rotation_euler = SUN_ROT
    sun_d.angle = math.radians(0.6)
    lie = bpy.data.objects.new("Lying", None)
    scene.collection.objects.link(lie)
    for p in dummy("Landed", lying=True):
        p.parent = lie
    lie.rotation_euler = (0, 0, math.radians(-30))
    lie.location = (0.25, 0.0, 0)
    collapsed_canopy()
    for g in range(-2, 3):  # a few slack lines from the dummy's shoulders to the fabric
        cylinder_between(f"Slack{g}", (-0.05, 0.35 + 0.04 * g, 0.12), (-1.0 - 0.08 * abs(g), 0.25 + 0.28 * g, 0.03), 0.014, cord, 6)
    for i in range(16):  # shreds of red paper from the burst firecrackers
        r, t = 0.35 + 0.6 * random.random(), 2 * math.pi * random.random()
        bpy.ops.mesh.primitive_plane_add(size=0.06 + 0.04 * random.random(), location=(0.25 + r * math.cos(t), r * math.sin(t), 0.015))
        shred = bpy.context.object
        shred.rotation_euler = (0, 0, random.random() * math.pi)
        shred.data.materials.append(cracker)
    catcher(0.0)
    px = render(tmp, "landed")
    px[..., 3] = np.where(px[..., 3] < 0.05, 0.0, px[..., 3])
    frames.append(px)

sheet = np.concatenate(frames, axis=1)
save_sheet(OUT_SHEET, sheet)
# Layout and the src/console/sprites/feint.ts constants this bake fixes; sheet.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": len(frames), "framePx": FRAME_PX, "cols": len(frames), "constants": {
        "FEINT_SWING_FRAMES": SWING_FRAMES,
        "FEINT_WORLD_M": ORTHO_M,
        "FEINT_DUMMY_OFFSET_M": round(CENTRE.x - dummy_mid.x, 3),
    }}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {len(frames)}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
