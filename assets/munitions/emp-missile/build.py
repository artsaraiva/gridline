"""Build the EMP Strike's missile and its top-down sprite sheet (#143).

Headless Blender script (ADR 0001, ADR 0002), in the Drone Strike's sprite family (assets/objects/drone/build.py): one small
missile for both Factions (2.6 m long), flying level from the caller's HQ to burst over its spot. A slim body in Faction paint,
a fat grey warhead with a pale cyan emitter band round it and a white ceramic nose, short strakes mid-body, cruciform tail fins
and a small engine glow. Rendered level at 16 headings, lit with Kaltenbach's sun (azimuth 45 deg NE, elevation 24 deg) and sky
fill in world space, so the Console picks the nearest heading and the baked light never turns with it. The paint is the
`FactionPaint` material role, rendered once per Faction. Rows, in order: nato, pact; then the soft body shadow (facing east).
Packed into `public/munitions/emp-missile.png` (16 columns; frame = faction * 16 + heading; then the shadow).

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/munitions/emp-missile/build.py
"""
import json
import math
import os
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT_SHEET = os.path.join(ROOT, "public", "munitions", "emp-missile.png")
OUT_GLB = os.path.join(HERE, "emp-missile.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 128
HEADINGS = 16  # EMP_HEADINGS in src/console/sprites/emp.ts
# Sheet rows in order (EMP_FACTIONS): the FactionPaint material role, nato then pact, as the drone's.
PAINTS = (("nato", (0.20, 0.30, 0.40)), ("pact", (0.40, 0.22, 0.17)))
ORTHO_M = 3.2  # EMP_WORLD_M: the sprite quad's world size in metres (the missile is 2.6 m long)
SUN_ELEV = 24.0
SUN_AZ = 45.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def make_material(name, color, metallic=0.0, roughness=0.5, emission=None):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    return mat


faction_paint = make_material("FactionPaint", PAINTS[0][1], metallic=0.15, roughness=0.45)
airframe = make_material("AirframeGrey", (0.62, 0.64, 0.66), metallic=0.35, roughness=0.35)
ceramic = make_material("CeramicNose", (0.86, 0.86, 0.83), roughness=0.4)
emitter = make_material("EmitterBand", (0.16, 0.55, 0.95), roughness=0.2, emission=((0.20, 0.60, 1.0), 0.8))  # a faint glow: brighter washes out to white
nozzle = make_material("NozzleSteel", (0.20, 0.20, 0.22), metallic=0.7, roughness=0.3)
exhaust = make_material("EngineGlow", (1.0, 0.55, 0.15), roughness=1.0, emission=((1.0, 0.45, 0.10), 12.0))
PARTS = (faction_paint, airframe, ceramic, emitter, nozzle, exhaust)

# Revolved body along local +Y (nose at +Y, exhaust at -Y). Stations: (y, radius, material index of the band ending there).
# Materials: 0 Faction paint, 1 airframe grey, 2 ceramic nose, 3 emitter band, 4 nozzle, 5 engine glow.
PROFILE = [
    (-1.30, 0.000, 5),
    (-1.30, 0.060, 5),  # the glowing exhaust disc
    (-1.28, 0.080, 4),
    (-1.18, 0.100, 4),
    (-1.10, 0.110, 0),
    (0.20, 0.110, 0),  # the slim body in Faction paint
    (0.34, 0.165, 1),  # it swells into the warhead
    (0.52, 0.165, 1),
    (0.53, 0.168, 3),
    (0.68, 0.168, 3),  # the emitter band
    (0.69, 0.165, 1),
    (0.92, 0.165, 1),
    (1.08, 0.140, 2),  # the ceramic nose, blunt
    (1.22, 0.085, 2),
    (1.30, 0.000, 2),
]
SEGMENTS = 32

bm = bmesh.new()
rings = []
for y, r, _ in PROFILE:
    if r == 0.0:
        rings.append([bm.verts.new((0.0, y, 0.0))])
    else:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / SEGMENTS), y, r * math.sin(2 * math.pi * k / SEGMENTS))) for k in range(SEGMENTS)])
for i in range(len(PROFILE) - 1):
    r0, r1 = rings[i], rings[i + 1]
    mat_idx = PROFILE[i + 1][2]
    if len(r0) == 1:
        faces = [(r0[0], r1[(k + 1) % SEGMENTS], r1[k]) for k in range(SEGMENTS)]
    elif len(r1) == 1:
        faces = [(r0[k], r0[(k + 1) % SEGMENTS], r1[0]) for k in range(SEGMENTS)]
    else:
        faces = [(r0[k], r0[(k + 1) % SEGMENTS], r1[(k + 1) % SEGMENTS], r1[k]) for k in range(SEGMENTS)]
    for verts in faces:
        f = bm.faces.new(verts)
        f.material_index = mat_idx
        f.smooth = True


def slab(points, thickness, mat_idx, axis):
    """A thin flat plate: `points` are (along, out) pairs in the plane through the body axis; `axis` turns it round +Y."""
    ca, sa = math.cos(axis), math.sin(axis)
    hw = thickness / 2
    top = [bm.verts.new((o * ca - hw * sa, y, o * sa + hw * ca)) for y, o in points]
    bot = [bm.verts.new((o * ca + hw * sa, y, o * sa - hw * ca)) for y, o in points]
    for verts in (top, bot[::-1]):
        bm.faces.new(verts).material_index = mat_idx
    n = len(points)
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((top[k], top[j], bot[j], bot[k])).material_index = mat_idx


# Short strakes mid-body, level with the ground, in Faction paint; cruciform tail fins (one pair level, so they read from above) in grey.
STRAKE = [(-0.05, 0.10), (-0.25, 0.30), (-0.55, 0.30), (-0.60, 0.10)]
for axis in (0, math.pi):
    slab(STRAKE, 0.03, 0, axis)
FIN = [(-0.85, 0.10), (-1.02, 0.38), (-1.22, 0.38), (-1.26, 0.10)]
for axis in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
    slab(FIN, 0.03, 1, axis)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new("EmpMissile")
bm.to_mesh(mesh)
bm.free()
for mat in PARTS:
    mesh.materials.append(mat)
missile = bpy.data.objects.new("EmpMissile", mesh)
scene.collection.objects.link(missile)
missile.location = (0, 0, 0.6)

# Export GLB source asset alongside the script (ADR 0001)
bpy.ops.object.select_all(action="DESELECT")
missile.select_set(True)
bpy.context.view_layer.objects.active = missile
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True)

# Top-down orthographic camera matching the map view
cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = ORTHO_M
cam_d.clip_end = 80.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (0, 0, 30.0)
scene.collection.objects.link(cam)
scene.camera = cam

# Sun and sky matching assets/maps/kaltenbach/build.py, in world space: +X east, +Y north. The missile is yawed to each
# baked heading, so the light never turns with it.
sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 4.2
sun_d.angle = math.radians(0.6)
sun_d.color = (1.0, 0.95, 0.88)
sun = bpy.data.objects.new("sun", sun_d)
el = math.radians(SUN_ELEV)
az = math.radians(SUN_AZ)
sun_dir = Vector((-math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), -math.sin(el)))
sun.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
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
scene.cycles.samples = 48
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
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    img.save_render(path, scene=scene)
    scene.view_settings.view_transform = vt
    bpy.data.images.remove(img)


def render(tmp, name):
    path = os.path.join(tmp, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return load_pixels(path)


frames = []
with tempfile.TemporaryDirectory() as tmp:
    for faction, color in PAINTS:
        faction_paint.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1.0)
        for k in range(HEADINGS):
            # Yaw the nose (+Y) to k * 360 / HEADINGS deg from east; it flies level
            missile.rotation_euler = (0, 0, 2 * math.pi * k / HEADINGS - math.pi / 2)
            frames.append(render(tmp, f"{faction}-{k}"))

    # The soft body shadow, facing east (heading 0), via a Cycles shadow-catcher plane under the missile
    bg.inputs["Strength"].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(size=ORTHO_M, location=(0, 0, 0))
    catcher = bpy.context.object
    catcher.name = "ShadowCatcher"
    catcher.is_shadow_catcher = True
    sun.rotation_euler = (0, 0, 0)
    sun_d.angle = math.radians(8.0)
    missile.rotation_euler = (0, 0, -math.pi / 2)
    missile.visible_camera = False
    shadow_px = render(tmp, "shadow")
    shadow_px[..., :3] = 0.0
    shadow_px[..., 3] = np.where(shadow_px[..., 3] < 0.08, 0.0, np.clip(shadow_px[..., 3] * 1.75, 0.0, 0.95))
    frames.append(shadow_px)

# Pad the last row with empty cells, then stack rows top-down (Blender pixel rows run bottom-up).
n = len(frames)
frames += [np.zeros_like(frames[0])] * (-len(frames) % HEADINGS)
rows = [np.concatenate(frames[r:r + HEADINGS], axis=1) for r in range(0, len(frames), HEADINGS)]
sheet = np.concatenate(rows[::-1], axis=0)
save_sheet(OUT_SHEET, sheet)
# Layout and the src/console/sprites/emp.ts constants this bake fixes; sprites/sheet.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": n, "framePx": FRAME_PX, "cols": HEADINGS, "constants": {"EMP_HEADINGS": HEADINGS, "EMP_FACTIONS": len(PAINTS), "EMP_WORLD_M": ORTHO_M}}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {n}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
