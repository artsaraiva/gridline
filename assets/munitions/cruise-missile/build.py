"""Build the Cruise Missile 3D asset and its top-down sprite sheet (#99).

Headless Blender script (ADR 0001, ADR 0002). Renders 4 top-down pitch rows (level, then nosing down into the
target, to straight down) of 16 headings each, once per Faction (the paint on the wings and the band is the `FactionPaint` material
role), plus 1 soft shadow frame, lit with Kaltenbach's sun (azimuth 45 deg NE, elevation 24 deg) and sky fill,
and packs them into `public/munitions/cruise-missile.png` (16 columns; frame = (faction * 4 + pitch) * 16 + heading).
The engine glow is an emissive exhaust baked into every frame.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/munitions/cruise-missile/build.py
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
OUT_SHEET = os.path.join(ROOT, "public", "munitions", "cruise-missile.png")
OUT_GLB = os.path.join(HERE, "cruise-missile.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 128
HEADINGS = 16  # MISSILE_HEADINGS in src/console/sprites/missile.ts
# Nose +Y; 0 = level cruise, negative = nose tilted down toward -Z, to -90 straight down: the drop onto the target.
PITCH_ANGLES = (0, -30, -60, -90)
# Faction colour through the FactionPaint material role (ADR 0001); frame rows in this order.
FACTIONS = (("nato", (0.26, 0.40, 0.56)), ("pact", (0.52, 0.26, 0.20)))
ORTHO_M = 6.5  # MISSILE_WORLD_M: the sprite quad's world size in metres (the missile is 5.6 m long)
SUN_ELEV = 24.0
SUN_AZ = 45.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def make_material(name, color, metallic=0.0, roughness=0.45, emission=None):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    return mat


airframe = make_material("AirframeGrey", (0.72, 0.74, 0.76), metallic=0.30, roughness=0.35)
faction_paint = make_material("FactionPaint", FACTIONS[0][1], metallic=0.15, roughness=0.40)
radome = make_material("Radome", (0.16, 0.17, 0.18), metallic=0.05, roughness=0.55)
nozzle = make_material("NozzleSteel", (0.22, 0.22, 0.24), metallic=0.70, roughness=0.30)
exhaust = make_material("EngineGlow", (1.0, 0.55, 0.15), roughness=1.0, emission=((1.0, 0.45, 0.10), 14.0))

# Revolved body along local +Y (nose at +Y, exhaust at -Y). Stations: (y, radius, material_index)
# Materials: 0 = airframe, 1 = faction_paint, 2 = radome, 3 = nozzle, 4 = exhaust
PROFILE = [
    (-2.80, 0.000, 4),
    (-2.80, 0.150, 4),   # the glowing exhaust disc
    (-2.78, 0.190, 3),
    (-2.60, 0.220, 3),
    (-2.45, 0.260, 0),
    (-2.30, 0.260, 1),   # tail band in Faction paint
    (-2.05, 0.260, 1),
    (-2.04, 0.260, 0),
    (1.60, 0.260, 0),
    (2.10, 0.200, 2),    # radome
    (2.55, 0.100, 2),
    (2.80, 0.000, 2),
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
    if len(r0) == 1 and len(r1) > 1:
        for k in range(SEGMENTS):
            f = bm.faces.new((r0[0], r1[(k + 1) % SEGMENTS], r1[k]))
            f.material_index = mat_idx
            f.smooth = True
    elif len(r0) > 1 and len(r1) == 1:
        for k in range(SEGMENTS):
            f = bm.faces.new((r0[k], r0[(k + 1) % SEGMENTS], r1[0]))
            f.material_index = mat_idx
            f.smooth = True
    elif len(r0) > 1 and len(r1) > 1:
        for k in range(SEGMENTS):
            j = (k + 1) % SEGMENTS
            f = bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
            f.material_index = mat_idx
            f.smooth = True


def slab(points, thickness, mat_idx, axis):
    """A thin flat plate: `points` are (along, out) pairs in the plane through the body axis; `axis` turns it round +Y."""
    ca, sa = math.cos(axis), math.sin(axis)
    hw = thickness / 2
    top = [bm.verts.new((o * ca - hw * sa, y, o * sa + hw * ca)) for y, o in points]
    bot = [bm.verts.new((o * ca + hw * sa, y, o * sa - hw * ca)) for y, o in points]
    for verts in (top, bot[::-1]):
        f = bm.faces.new(verts)
        f.material_index = mat_idx
    n = len(points)
    for k in range(n):
        j = (k + 1) % n
        f = bm.faces.new((top[k], top[j], bot[j], bot[k]))
        f.material_index = mat_idx


# Straight pop-out wings mid-body, swept back a little, in Faction paint; cruciform tail fins in airframe grey.
WING = [(0.20, 0.24), (-0.10, 1.75), (-0.55, 1.75), (-0.75, 0.24)]
for axis in (0, math.pi):
    slab(WING, 0.06, 1, axis)
FIN = [(-2.05, 0.24), (-2.25, 0.72), (-2.62, 0.72), (-2.70, 0.24)]
for axis in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4):
    slab(FIN, 0.05, 0, axis)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new("CruiseMissile")
bm.to_mesh(mesh)
bm.free()
for mat in (airframe, faction_paint, radome, nozzle, exhaust):
    mesh.materials.append(mat)

missile = bpy.data.objects.new("CruiseMissile", mesh)
scene.collection.objects.link(missile)

# Export GLB source asset alongside the script (ADR 0001)
bpy.ops.object.select_all(action="DESELECT")
missile.select_set(True)
bpy.context.view_layer.objects.active = missile
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True)

# Top-down orthographic camera matching the map view
cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = ORTHO_M
cam_d.clip_end = 50.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (0, 0, 10.0)
scene.collection.objects.link(cam)
scene.camera = cam

# Sun and sky matching assets/maps/bake.py, in world space: +X east, +Y north. The missile is yawed to
# each baked heading, so the light never turns with it.
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


frames = []
with tempfile.TemporaryDirectory() as tmp:
    for faction, color in FACTIONS:
        faction_paint.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1.0)
        for idx, pitch in enumerate(PITCH_ANGLES):
            for k in range(HEADINGS):
                # Pitch about X (nose +Y), then yaw so the nose flies at k * 360 / HEADINGS deg from east.
                missile.rotation_euler = (math.radians(pitch), 0, 2 * math.pi * k / HEADINGS - math.pi / 2)
                frame_path = os.path.join(tmp, f"{faction}-pitch-{idx}-heading-{k}.png")
                scene.render.filepath = frame_path
                bpy.ops.render.render(write_still=True)
                frames.append(load_pixels(frame_path))

    # The soft shadow frame, flying east (heading 0), via a Cycles shadow-catcher plane under the missile
    missile.rotation_euler = (0, 0, -math.pi / 2)
    missile.location = (0, 0, 0.6)
    missile.visible_camera = False
    bg.inputs["Strength"].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(size=ORTHO_M, location=(0, 0, 0))
    catcher = bpy.context.object
    catcher.name = "ShadowCatcher"
    catcher.is_shadow_catcher = True
    sun.rotation_euler = (0, 0, 0)
    sun_d.angle = math.radians(8.0)
    shadow_path = os.path.join(tmp, "shadow.png")
    scene.render.filepath = shadow_path
    bpy.ops.render.render(write_still=True)
    shadow_px = load_pixels(shadow_path)
    shadow_px[..., :3] = 0.0
    shadow_px[..., 3] = np.where(shadow_px[..., 3] < 0.08, 0.0, np.clip(shadow_px[..., 3] * 1.75, 0.0, 0.95))
    frames.append(shadow_px)

# Pad the last row with empty cells, then stack rows top-down (Blender pixel rows run bottom-up).
frames += [np.zeros_like(frames[0])] * (-len(frames) % HEADINGS)
rows = [np.concatenate(frames[r:r + HEADINGS], axis=1) for r in range(0, len(frames), HEADINGS)]
sheet = np.concatenate(rows[::-1], axis=0)
save_sheet(OUT_SHEET, sheet)
n = len(FACTIONS) * len(PITCH_ANGLES) * HEADINGS + 1
# Layout and the src/console/sprites/missile.ts constants this bake fixes; sprites/sheet.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": n, "framePx": FRAME_PX, "cols": HEADINGS, "constants": {"MISSILE_PITCH_FRAMES": len(PITCH_ANGLES), "MISSILE_HEADINGS": HEADINGS, "MISSILE_FACTIONS": len(FACTIONS), "MISSILE_WORLD_M": ORTHO_M}}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {n}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
