"""Build the Redeploy Beacon 3D asset and its top-down sprite sheet (#142).

Headless Blender script (ADR 0001, ADR 0002). Builds a ribbed olive-drab transit case with a telescopic antenna mast on one
corner, a lamp housing on top of it, hanging under a two-tone gored canopy (smaller than the Supply Drop's, grey and olive
gores so it reads apart from the Supply crate in the air), and renders top-down with Kaltenbach's sun (azimuth 45 deg NE,
elevation 24 deg) and sky fill:
  frames 0-7  the case under its canopy through one pendulum swing (falling),
  frame 8     the falling assembly's soft ground shadow (Cycles shadow catcher, overhead sun),
  frame 9     the case on the ground, mast up, its canopy collapsed beside it and its own cast shadow (the mast's long).
The lamp lens is a pale neutral material role ("LampLens"): the Console lays the blinking Faction-colour light over it.
The frames are packed into `public/objects/beacon.png`; the assembly is exported as a .glb source.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/objects/beacon/build.py
"""
import json
import math
import os
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT_SHEET = os.path.join(ROOT, "public", "objects", "beacon.png")
OUT_GLB = os.path.join(HERE, "beacon.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 256
ORTHO_M = 8.0  # world metres across one frame; BEACON_WORLD_M in src/console/sprites/beacon.ts
SWING_FRAMES = 8
SUN_ELEV = 24.0
SUN_AZ = 45.0

CANOPY_R = 2.1
CANOPY_H = 1.25
GORES = 12
LINE_L = 4.2  # canopy skirt to the riser confluence above the case
CASE = (1.1, 0.75, 0.55)  # transit case body (x, y, z) in metres, on 0.06 m feet
MAST_H = 1.6  # lid to the lamp's base; any taller and its shadow (24 deg sun) runs off the landed frame
FIRST = 0.65  # the mast's first section, all that stands while it falls
MAST_AT = (0.38, 0.22)  # mast foot on the lid, from the case centre (north-east corner)
LAMP_R = 0.09
TILT = 34.0  # mean pendulum lean, case swung toward the south-west of the canopy
SWING = 7.0
CROSS = 5.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, roughness=0.8, metallic=0.0, fabric=False):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if not fabric:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        return mat
    # Nylon with faint crinkle, so the canopy does not read as a plastic dome.
    coord = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 6.0
    n.inputs["Detail"].default_value = 4.0
    nt.links.new(coord.outputs["Object"], n.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (color[0] * 0.82, color[1] * 0.82, color[2] * 0.82, 1)
    mix.inputs["B"].default_value = (*color, 1)
    nt.links.new(n.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


case_paint = material("CaseOD", (0.12, 0.14, 0.08), 0.55, 0.15)
rib_paint = material("CaseRib", (0.09, 0.105, 0.06), 0.5, 0.15)
steel = material("Hardware", (0.30, 0.30, 0.28), 0.35, 0.8)
stencil = material("StencilPanel", (0.55, 0.52, 0.40), 0.7)
mast_mat = material("MastAlloy", (0.42, 0.43, 0.42), 0.3, 0.9)
housing = material("LampHousing", (0.06, 0.06, 0.06), 0.4, 0.3)
lens = material("LampLens", (0.85, 0.86, 0.82), 0.15)
olive = material("CanopyOlive", (0.085, 0.10, 0.05), 0.75, fabric=True)
grey = material("CanopyGrey", (0.36, 0.37, 0.34), 0.75, fabric=True)
cord = material("SuspensionCord", (0.62, 0.60, 0.52), 0.6)
strap = material("OliveStrap", (0.10, 0.11, 0.06), 0.7)


def box(name, size, loc, mat, bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 2
    o.data.materials.append(mat)
    return o


def cylinder(name, r, depth, loc, mat, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=depth, location=loc)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    return o


def cylinder_between(name, a, b, r, mat):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=r, depth=(b - a).length, location=(a + b) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(mat)
    return o


def beacon(prefix):
    """The case on its feet with the mast up and the lamp on top, base at z = 0, centred on the origin."""
    w, d, h = CASE
    z0 = 0.06
    parts = [box(f"{prefix}Body", (w, d, h), (0, 0, z0 + h / 2), case_paint, 0.05)]
    for x in (-w / 2 + 0.08, w / 2 - 0.08):  # feet
        for y in (-d / 2 + 0.08, d / 2 - 0.08):
            parts.append(box(f"{prefix}Foot", (0.1, 0.1, z0), (x, y, z0 / 2), rib_paint, 0.01))
    for x in (-w * 0.3, 0, w * 0.3):  # reinforcing ribs over the lid and down the sides
        parts.append(box(f"{prefix}Rib", (0.06, d + 0.03, h + 0.03), (x, 0, z0 + h / 2 + 0.005), rib_paint, 0.01))
    parts.append(box(f"{prefix}Seam", (w + 0.02, d + 0.02, 0.035), (0, 0, z0 + h * 0.72), rib_paint, 0.005))
    for y in (-d / 2 - 0.02, d / 2 + 0.02):  # latches on the long sides
        for x in (-w * 0.15, w * 0.15):
            parts.append(box(f"{prefix}Latch", (0.08, 0.03, 0.08), (x, y, z0 + h * 0.72), steel, 0.005))
    parts.append(box(f"{prefix}Handle", (0.32, 0.05, 0.03), (-w * 0.15, 0, z0 + h + 0.03), steel, 0.01))
    parts.append(box(f"{prefix}Stencil", (0.3, 0.22, 0.008), (-w * 0.15, -d * 0.2, z0 + h + 0.006), stencil, 0.0))
    parts.append(box(f"{prefix}Radio", (0.26, 0.2, 0.08), (w * 0.12, -d * 0.15, z0 + h + 0.04), housing, 0.01))
    # Telescopic mast: three tapering sections from a socket on the lid's north-east corner, the lamp on top.
    mx, my = MAST_AT
    top = z0 + h
    parts.append(cylinder(f"{prefix}Socket", 0.07, 0.08, (mx, my, top + 0.04), steel))
    sections = [(0.035, 0.0, FIRST), (0.027, FIRST - 0.05, 1.15), (0.02, 1.1, MAST_H)]
    for i, (r, a, b) in enumerate(sections):
        parts.append(cylinder(f"{prefix}Mast{i}", r, b - a, (mx, my, top + (a + b) / 2), mast_mat, 10))
    lamp_z = top + MAST_H
    parts.append(cylinder(f"{prefix}LampBase", LAMP_R, 0.08, (mx, my, lamp_z + 0.04), housing, 16))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=LAMP_R * 0.85, location=(mx, my, lamp_z + 0.08))
    dome = bpy.context.object
    dome.name = f"{prefix}LampLens"
    dome.scale = (1, 1, 0.9)
    dome.data.materials.append(lens)
    parts.append(dome)
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
        for k in range(seg):
            t = k / seg
            frac = (k % 6) / 6
            bulge = 1 + 0.05 * math.sin(math.pi * frac) * (0.4 + 0.6 * i / (rings - 1))
            r = CANOPY_R * math.sin(phi) / math.sin(phis[-1]) * bulge
            z = CANOPY_H * math.cos(phi) - 0.06 * math.sin(math.pi * frac) * (i / (rings - 1)) ** 2
            row.append(bm.verts.new((r * math.cos(2 * math.pi * t), r * math.sin(2 * math.pi * t), z)))
        verts.append(row)
    for i in range(rings - 1):
        for k in range(seg):
            j = (k + 1) % seg
            f = bm.faces.new((verts[i][k], verts[i][j], verts[i + 1][j], verts[i + 1][k]))
            f.material_index = (k // 6) % 2
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Canopy")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(olive)
    me.materials.append(grey)
    o = bpy.data.objects.new("Canopy", me)
    scene.collection.objects.link(o)
    o.modifiers.new("solid", "SOLIDIFY").thickness = 0.02
    skirt = [Vector((CANOPY_R * math.cos(2 * math.pi * g / GORES), CANOPY_R * math.sin(2 * math.pi * g / GORES),
                     CANOPY_H * math.cos(phis[-1]))) for g in range(GORES)]
    return o, skirt


# ---------------------------------------------------------------- falling assembly
# Built hanging straight down with the canopy skirt centre at the origin, then leaned as a rigid pendulum. The mast is
# telescoped down for the drop: only its socket and first section stand on the lid.
canopy_obj, skirt = canopy()
confluence = Vector((0, 0, -LINE_L))
case_top = confluence.z - 0.8
hang = beacon("Hang")
for p in hang:
    if p.name.startswith(("HangMast1", "HangMast2", "HangLamp")):
        p.location.z -= MAST_H - FIRST  # collapsed onto the first section
    p.location.z += case_top - (0.06 + CASE[2])
lines = [cylinder_between(f"Line{g}", s, confluence, 0.025, cord) for g, s in enumerate(skirt)]
w, d, _ = CASE
lines += [cylinder_between(f"Riser{c}", confluence, (sx * w * 0.42, sy * d * 0.42, case_top), 0.03, strap)
          for c, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1)))]
assembly = [canopy_obj, *hang, *lines]

rig = bpy.data.objects.new("RedeployBeacon", None)
scene.collection.objects.link(rig)
for o in assembly:
    o.parent = rig

# Lean axis: horizontal and perpendicular to the south-west, so the case swings out SW of the canopy.
LEAN_AXIS = Vector((1, -1, 0)).normalized()
CROSS_AXIS = Vector((1, 1, 0)).normalized()
PIVOT = Vector((0, 0, -LINE_L * 0.35))


def pose(lean, cross):
    rot = Matrix.Rotation(math.radians(-lean), 4, LEAN_AXIS) @ Matrix.Rotation(math.radians(cross), 4, CROSS_AXIS)
    rig.matrix_world = Matrix.Translation(PIVOT) @ rot @ Matrix.Translation(-PIVOT)


# Frame centre: midway between canopy and case in the mean pose, so the swing stays centred in the cell.
pose(TILT, 0)
bpy.context.view_layer.update()
case_mid = rig.matrix_world @ Vector((0, 0, case_top - CASE[2] / 2))
canopy_mid = rig.matrix_world @ Vector((0, 0, CANOPY_H * 0.5))
CENTRE = (case_mid + canopy_mid) / 2
print(f"case offset from frame centre: {case_mid.x - CENTRE.x:.3f}, {case_mid.y - CENTRE.y:.3f} m")

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
    """The canopy lying deflated on the ground beside the landed case: wrinkled, gored, west of it so the mast shadow stays clear."""
    bm = bmesh.new()
    rings, seg = 12, GORES * 4
    verts = []
    for i in range(rings):
        rr = 0.04 + i / (rings - 1)
        row = []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            edge = 1 + 0.28 * noise.noise(Vector((math.cos(t) * 1.3, math.sin(t) * 1.3, 7.0)))
            x, y = 0.75 * rr * edge * math.cos(t), 1.25 * rr * edge * math.sin(t)
            fold = abs(noise.noise(Vector((x * 2.4, y * 1.1, 0.3))))
            z = 0.03 + 0.3 * fold + 0.05 * noise.noise(Vector((x * 5, y * 5, 2.9))) + 0.15 * (1 - rr)
            row.append(bm.verts.new((x, y, max(0.02, z))))
        verts.append(row)
    for i in range(rings - 1):
        for k in range(seg):
            j = (k + 1) % seg
            f = bm.faces.new((verts[i][k], verts[i][j], verts[i + 1][j], verts[i + 1][k]))
            f.material_index = (k // 4) % 2
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Collapsed")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(olive)
    me.materials.append(grey)
    o = bpy.data.objects.new("CollapsedCanopy", me)
    scene.collection.objects.link(o)
    o.location = (-1.55, 0.95, 0)
    o.rotation_euler = (0, 0, math.radians(-18))
    return o


frames = []
with tempfile.TemporaryDirectory() as tmp:
    # Falling: one full pendulum swing (lean in and out, with a small elliptical cross swing).
    for k in range(SWING_FRAMES):
        a = 2 * math.pi * k / SWING_FRAMES
        pose(TILT + SWING * math.sin(a), CROSS * math.cos(a))
        frames.append(render(tmp, f"swing-{k}"))

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

    # Landed: the case at the frame centre, mast up, canopy collapsed beside it, its own cast shadow.
    for o in assembly:
        o.hide_render = True
    bpy.data.objects.remove(shadow_plane)
    cam.location = (0, 0, 30.0)
    bg.inputs["Strength"].default_value = 0.55
    sun.rotation_euler = SUN_ROT
    sun_d.angle = math.radians(0.6)
    beacon("Landed")
    collapsed_canopy()
    for g in range(-2, 3):  # a few slack lines from the case to the fabric
        cylinder_between(f"Slack{g}", (-0.5, 0.15 * g, 0.5), (-0.95 - 0.08 * abs(g), 0.55 + 0.3 * g, 0.04), 0.015, strap)
    catcher(0.0)
    px = render(tmp, "landed")
    px[..., 3] = np.where(px[..., 3] < 0.05, 0.0, px[..., 3])
    frames.append(px)

sheet = np.concatenate(frames, axis=1)
save_sheet(OUT_SHEET, sheet)
# Layout and the src/console/sprites/beacon.ts constants this bake fixes; sheet.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": len(frames), "framePx": FRAME_PX, "cols": len(frames), "constants": {
        "BEACON_SWING_FRAMES": SWING_FRAMES,
        "BEACON_WORLD_M": ORTHO_M,
        "BEACON_CRATE_OFFSET_M": round(CENTRE.x - case_mid.x, 3),
        "BEACON_LAMP_X_M": MAST_AT[0],
        "BEACON_LAMP_Y_M": MAST_AT[1],
    }}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {len(frames)}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
