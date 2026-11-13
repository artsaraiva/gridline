"""Build the Recon Plane and its top-down sprite sheet (#139).

Headless Blender script (ADR 0001, ADR 0002), laid out as the Gunship's bake (assets/objects/gunship/build.py). One light
twin-boom observation aircraft for both Factions (12.2 m span, 10 m nose to tail): a short glazed fuselage pod under a
straight high wing, an engine on each wing running back into a slim tail boom, a fin on each boom and the tailplane high
between them. Rendered level at 16 headings, lit with Kaltenbach's sun (azimuth 45 deg NE, elevation 24 deg) and sky fill in
world space, so the Console picks the nearest heading and the baked light never turns with it. The paint is the
`FactionPaint` material role, rendered once per Faction. Rows, in order: nato, pact; then the soft body shadow (facing east).
Packed into `public/objects/recon.png` (16 columns; frame = faction * 16 + heading; then the shadow).

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/objects/recon/build.py
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
OUT_SHEET = os.path.join(ROOT, "public", "objects", "recon.png")
OUT_GLB = os.path.join(HERE, "recon.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 160
HEADINGS = 16  # RECON_HEADINGS in src/console/sprites/recon.ts
# Sheet rows in order (RECON_FACTIONS): the FactionPaint material role, nato then pact.
PAINTS = (("nato", (0.20, 0.30, 0.40)), ("pact", (0.40, 0.22, 0.17)))
ORTHO_M = 14.0  # RECON_WORLD_M: the sprite quad's world size in metres (a 12.2 m span)
SUN_ELEV = 24.0
SUN_AZ = 45.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def make_material(name, color, metallic=0.0, roughness=0.6):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


faction_paint = make_material("FactionPaint", PAINTS[0][1], roughness=0.62)
running_gear = make_material("RunningGear", (0.05, 0.05, 0.05), metallic=0.4, roughness=0.7)
airframe = make_material("AirframeGrey", (0.30, 0.32, 0.32), roughness=0.5)
optics = make_material("Optics", (0.03, 0.05, 0.07), metallic=0.3, roughness=0.15)
PARTS = (faction_paint, running_gear, airframe, optics)


def solid(name, boxes):
    """One object from boxes (cx, cy, cz, sx, sy, sz, material index, front taper); nose +Y. Taper slopes the +Y top edge back."""
    bm = bmesh.new()
    for cx, cy, cz, sx, sy, sz, mat, taper in boxes:
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        corners = []
        for z in (-hz, hz):
            for y in (-hy, hy):
                for x in (-hx, hx):
                    yy = y - (taper if (z > 0 and y > 0) else 0)
                    corners.append(bm.verts.new((cx + x, cy + yy, cz + z)))
        c = corners
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            face = bm.faces.new([c[i] for i in f])
            face.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in PARTS:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def slab(bm, outline, z0, z1, mat):
    """A prism: the top-down `outline` (x, y), counter-clockwise, from z0 up to z1."""
    lo = [bm.verts.new((x, y, z0)) for x, y in outline]
    hi = [bm.verts.new((x, y, z1)) for x, y in outline]
    faces = [hi, lo[::-1]] + [(lo[i], lo[(i + 1) % len(lo)], hi[(i + 1) % len(hi)], hi[i]) for i in range(len(lo))]
    for f in faces:
        bm.faces.new(f).material_index = mat


def mirrored(half):
    """A counter-clockwise outline from its right half, listed nose to tail (x >= 0)."""
    return [(x, y) for x, y in reversed(half)] + [(-x, y) for x, y in half if x > 0]


def pair(half):
    """The right outline (counter-clockwise) and its mirror on the left."""
    return half, [(-x, y) for x, y in reversed(half)]


BOOM_X = 1.9  # each tail boom out from the centre line
# The body, nose +Y, centred on its middle: a short glazed fuselage pod under a straight high wing, an engine on each wing
# running back into a slim tail boom, a fin on each boom and the tailplane between them. Material indices: 0 FactionPaint,
# 1 running gear, 2 airframe grey, 3 optics.
boxes = [
    (0.0, 2.9, 1.75, 1.0, 2.2, 0.5, 3, 0.9),          # the long greenhouse canopy
    (0.0, 0.2, 1.3, 0.5, 0.5, 0.4, 3, 0.0),           # the camera fairing under the pod
]
for sx in (-BOOM_X, BOOM_X):
    boxes.append((sx, 1.3, 1.75, 0.7, 2.6, 0.7, 0, 0.0))      # engine nacelle
    boxes.append((sx, 2.75, 1.75, 0.4, 0.3, 0.4, 1, 0.0))     # spinner
    boxes.append((sx, 2.95, 1.75, 2.3, 0.06, 0.2, 1, 0.0))    # propeller disc, edge-on from above
    boxes.append((sx, -2.4, 1.75, 0.34, 5.0, 0.34, 2, 0.0))   # tail boom
    boxes.append((sx, -4.6, 2.6, 0.14, 1.3, 1.7, 0, 0.7))     # fin, its top swept back
recon = solid("ReconPlane", boxes)
bm = bmesh.new()
bm.from_mesh(recon.data)
slab(bm, mirrored([(0.0, 4.6), (0.4, 4.3), (0.62, 3.4), (0.66, 1.0), (0.6, -0.6), (0.3, -1.5)]), 0.8, 1.9, 0)  # fuselage pod
for wing in pair([(0.4, 1.9), (6.1, 1.5), (6.1, 0.3), (0.4, -0.1)]):  # straight high wing
    slab(bm, wing, 2.0, 2.18, 0)
slab(bm, [(-BOOM_X, -5.2), (BOOM_X, -5.2), (BOOM_X, -4.2), (-BOOM_X, -4.2)], 3.3, 3.42, 0)  # tailplane, high between the fins
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(recon.data)
bm.free()

# Export GLB source asset alongside the script (ADR 0001)
bpy.ops.object.select_all(action="DESELECT")
recon.select_set(True)
bpy.context.view_layer.objects.active = recon
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

# Sun and sky matching assets/maps/kaltenbach/build.py, in world space: +X east, +Y north. The recon is yawed (and banked)
# to each baked pose, so the light never turns with it.
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
            recon.rotation_euler = (0, 0, 2 * math.pi * k / HEADINGS - math.pi / 2)
            frames.append(render(tmp, f"{faction}-{k}"))

    # The soft body shadow, facing east (heading 0), via a Cycles shadow-catcher plane under the aircraft
    bg.inputs["Strength"].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(size=ORTHO_M, location=(0, 0, 0))
    catcher = bpy.context.object
    catcher.name = "ShadowCatcher"
    catcher.is_shadow_catcher = True
    sun.rotation_euler = (0, 0, 0)
    sun_d.angle = math.radians(8.0)
    recon.rotation_euler = (0, 0, -math.pi / 2)
    recon.visible_camera = False
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
# Layout and the src/console/sprites/recon.ts constants this bake fixes; sprites/sheet.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": n, "framePx": FRAME_PX, "cols": HEADINGS, "constants": {"RECON_HEADINGS": HEADINGS, "RECON_FACTIONS": len(PAINTS), "RECON_WORLD_M": ORTHO_M}}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {n}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
