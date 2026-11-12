"""Build the AA 3D asset and its top-down sprite sheet (#110).

Headless Blender script (ADR 0001, ADR 0002). One self-propelled anti-air gun for both Factions, laid out as the tank's bake
(assets/objects/tank/build.py): a tracked hull and a turret as separate objects, rendered on their own at 16 headings each, so
the Console turns the turret to its target over the hull. The turret carries a twin cannon, one barrel either side, a
search radar on a mast at the back and a tracking radar at the front. The paint is the `FactionPaint` material role,
rendered once per variant: nato, pact, and the burnt-out `wreck`. Plus 2 soft shadow frames (hull, then turret, both
facing east), lit with Kaltenbach's sun (azimuth 45 deg NE, elevation 24 deg) and sky fill, packed into
`public/objects/aa.png` (16 columns; frame = (variant * 2 + part) * 16 + heading, part 0 hull, 1 turret; then the two
shadows). The turret pivot is the hull frame's centre.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/objects/aa/build.py
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
OUT_SHEET = os.path.join(ROOT, "public", "objects", "aa.png")
OUT_GLB = os.path.join(HERE, "aa.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 160
HEADINGS = 16  # AA_HEADINGS in src/console/sprites/aa.ts
# Paint variants through the FactionPaint material role (ADR 0001); frame rows in this order. The wreck chars everything.
VARIANTS = (("nato", (0.20, 0.30, 0.40)), ("pact", (0.40, 0.22, 0.17)), ("wreck", (0.035, 0.032, 0.03)))
ORTHO_M = 12.0  # AA_WORLD_M: the sprite quad's world size in metres (hull 6.6 m, barrels reaching 4.4 m ahead of the pivot)
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


faction_paint = make_material("FactionPaint", VARIANTS[0][1], roughness=0.62)
running_gear = make_material("RunningGear", (0.05, 0.05, 0.05), metallic=0.4, roughness=0.7)
gun_steel = make_material("GunSteel", (0.11, 0.115, 0.12), metallic=0.5, roughness=0.45)
optics = make_material("Optics", (0.02, 0.03, 0.04), metallic=0.2, roughness=0.2)
PARTS = (faction_paint, running_gear, gun_steel, optics)


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


def cylinder(bm, x, y, z, r, length, mat, segments=16):
    """A barrel along +Y from (x, y, z)."""
    ring0 = [bm.verts.new((x + r * math.cos(2 * math.pi * k / segments), y, z + r * math.sin(2 * math.pi * k / segments))) for k in range(segments)]
    ring1 = [bm.verts.new((v.co.x, y + length, v.co.z)) for v in ring0]
    for k in range(segments):
        j = (k + 1) % segments
        f = bm.faces.new((ring0[k], ring0[j], ring1[j], ring1[k]))
        f.material_index = mat
        f.smooth = True
    for ring in (ring0[::-1], ring1):
        f = bm.faces.new(ring)
        f.material_index = mat


# Hull: a lighter tracked chassis than the tank's, a short sloped glacis, side skirts, a raised engine deck at the back.
hull = solid("AaHull", [
    (0.0, 0.0, 0.9, 2.8, 6.2, 0.7, 0, 1.0),         # upper hull, glacis sloping to the nose
    (-1.5, 0.0, 0.5, 0.56, 6.6, 1.0, 1, 0.0),       # left track
    (1.5, 0.0, 0.5, 0.56, 6.6, 1.0, 1, 0.0),        # right track
    (-1.52, 0.1, 0.98, 0.64, 6.0, 0.16, 0, 0.0),    # left skirt top
    (1.52, 0.1, 0.98, 0.64, 6.0, 0.16, 0, 0.0),     # right skirt top
    (0.0, -2.35, 1.32, 2.3, 1.3, 0.12, 1, 0.0),     # engine grilles
    (-0.85, 2.55, 1.28, 0.6, 0.5, 0.12, 3, 0.0),    # driver's hatch and vision blocks
    (-0.8, -3.1, 1.05, 0.45, 0.25, 0.25, 1, 0.0),   # exhausts
    (0.8, -3.1, 1.05, 0.45, 0.25, 0.25, 1, 0.0),
])

# Turret about the pivot (0, 0): a tall boxy turret, a cannon housing either side, the search radar on its mast at the back
# and the tracking radar dish at the front.
turret = solid("AaTurret", [
    (0.0, -0.1, 1.8, 2.5, 2.9, 0.95, 0, 0.55),      # turret body, sloped front
    (-1.5, 0.15, 1.9, 0.6, 2.2, 0.6, 0, 0.35),      # left cannon housing
    (1.5, 0.15, 1.9, 0.6, 2.2, 0.6, 0, 0.35),       # right cannon housing
    (0.0, -1.5, 2.55, 0.3, 0.3, 0.9, 2, 0.0),       # radar mast
    (0.0, -1.5, 3.05, 2.6, 0.5, 0.7, 1, 0.0),       # search radar
    (0.0, 1.25, 2.4, 1.0, 0.35, 0.8, 1, 0.0),       # tracking radar dish
    (0.55, -0.55, 2.32, 0.55, 0.55, 0.14, 3, 0.0),  # commander's sight
])
bm = bmesh.new()
bm.from_mesh(turret.data)
for x in (-1.5, 1.5):
    cylinder(bm, x, 1.25, 1.95, 0.13, 3.0, 2)         # the barrels reach 4.4 m ahead of the pivot
    cylinder(bm, x, 3.85, 1.95, 0.19, 0.5, 2)         # muzzle brakes
bm.to_mesh(turret.data)
bm.free()

# Export GLB source asset alongside the script (ADR 0001)
bpy.ops.object.select_all(action="DESELECT")
for o in (hull, turret):
    o.select_set(True)
bpy.context.view_layer.objects.active = hull
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

# Sun and sky matching assets/maps/bake.py, in world space: +X east, +Y north. The AA is yawed to each baked
# heading, so the light never turns with it.
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


def set_paint(color, wreck):
    paint = faction_paint.node_tree.nodes["Principled BSDF"]
    paint.inputs["Base Color"].default_value = (*color, 1.0)
    paint.inputs["Roughness"].default_value = 0.95 if wreck else 0.62
    for mat in (running_gear, gun_steel):  # a burnt-out hull is soot all over
        mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.0 if wreck else 0.45


frames = []
with tempfile.TemporaryDirectory() as tmp:
    for name, color in VARIANTS:
        set_paint(color, name == "wreck")
        for part, (shown, hidden) in enumerate(((hull, turret), (turret, hull))):
            shown.hide_render = False
            hidden.hide_render = True
            for k in range(HEADINGS):
                shown.rotation_euler = (0, 0, 2 * math.pi * k / HEADINGS - math.pi / 2)  # nose at k * 360 / HEADINGS deg from east
                frame_path = os.path.join(tmp, f"{name}-{part}-{k}.png")
                scene.render.filepath = frame_path
                bpy.ops.render.render(write_still=True)
                frames.append(load_pixels(frame_path))

    # The soft shadow frames, facing east (heading 0), via a Cycles shadow-catcher plane under the AA
    set_paint(VARIANTS[0][1], False)
    bg.inputs["Strength"].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(size=ORTHO_M, location=(0, 0, 0))
    catcher = bpy.context.object
    catcher.name = "ShadowCatcher"
    catcher.is_shadow_catcher = True
    sun.rotation_euler = (0, 0, 0)
    sun_d.angle = math.radians(8.0)
    for shown, hidden in ((hull, turret), (turret, hull)):
        shown.hide_render = False
        hidden.hide_render = True
        shown.rotation_euler = (0, 0, -math.pi / 2)
        shown.visible_camera = False
        shadow_path = os.path.join(tmp, f"shadow-{shown.name}.png")
        scene.render.filepath = shadow_path
        bpy.ops.render.render(write_still=True)
        shadow_px = load_pixels(shadow_path)
        shadow_px[..., :3] = 0.0
        shadow_px[..., 3] = np.where(shadow_px[..., 3] < 0.08, 0.0, np.clip(shadow_px[..., 3] * 1.75, 0.0, 0.95))
        frames.append(shadow_px)

# Pad the last row with empty cells, then stack rows top-down (Blender pixel rows run bottom-up).
n = len(frames)
frames += [np.zeros_like(frames[0])] * (-len(frames) % HEADINGS)
rows = [np.concatenate(frames[r:r + HEADINGS], axis=1) for r in range(0, len(frames), HEADINGS)]
sheet = np.concatenate(rows[::-1], axis=0)
save_sheet(OUT_SHEET, sheet)
# Layout and the src/console/sprites/aa.ts constants this bake fixes; sprites/sheet.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": n, "framePx": FRAME_PX, "cols": HEADINGS, "constants": {"AA_HEADINGS": HEADINGS, "AA_VARIANTS": len(VARIANTS), "AA_WORLD_M": ORTHO_M}}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {n}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
