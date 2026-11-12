"""Build the artillery shell 3D asset and its top-down sprite sheet (#53, #61).

Headless Blender script (ADR 0001, ADR 0002). Renders 8 top-down pitch rows (climb, level, dive) of
16 headings each plus 1 soft shadow frame, lit with Kaltenbach's exact sun direction (azimuth 45 deg
NE, elevation 24 deg) and sky fill, and packs them into `public/munitions/artillery-shell.png`
(16 columns; frame = pitch * 16 + heading). Baking every heading keeps the lit side north-east
whichever way a shell flies: the Console only rotates the remainder of half a heading step.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/munitions/artillery-shell/build.py
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
OUT_SHEET = os.path.join(ROOT, "public", "munitions", "artillery-shell.png")
OUT_GLB = os.path.join(HERE, "artillery-shell.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 128
HEADINGS = 16  # SHELL_HEADINGS in src/console/sprites.ts
# In Blender, rotating +Y around +X by angle a maps (0, y, 0) -> (0, y*cos(a), y*sin(a)):
# positive pitch = nose (+Y) tilted up toward +Z (climb); 0 = level at apex; negative = nose tilted down toward -Z (dive).
PITCH_ANGLES = (52, 34, 16, 0, -16, -34, -50, -66)
SUN_ELEV = 24.0
SUN_AZ = 45.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def make_material(name, color, metallic=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


olive_steel = make_material("OrdnanceOliveSteel", (0.48, 0.52, 0.42), metallic=0.35, roughness=0.30)
oxide_nose = make_material("OxidePaintedOgive", (0.78, 0.36, 0.20), metallic=0.25, roughness=0.26)
fuze_steel = make_material("MachinedFuzeSteel", (0.94, 0.95, 0.96), metallic=0.78, roughness=0.16)
brass_band = make_material("BrassRotatingBand", (0.95, 0.74, 0.26), metallic=0.65, roughness=0.20)
tail_steel = make_material("GraphiteTailSteel", (0.20, 0.22, 0.24), metallic=0.58, roughness=0.34)

# Build a smooth revolved artillery shell profile along local +Y (nose at +Y, base/fins at -Y).
# Profile stations: (y, radius, material_index)
# Materials: 0 = olive_steel, 1 = oxide_nose, 2 = fuze_steel, 3 = brass_band, 4 = tail_steel
PROFILE = [
    (-0.56, 0.000, 4),
    (-0.56, 0.072, 4),
    (-0.46, 0.095, 4),
    (-0.36, 0.122, 4),
    (-0.30, 0.122, 0),
    (-0.29, 0.132, 3),  # copper/brass obturator driving band
    (-0.20, 0.132, 3),
    (-0.19, 0.122, 0),
    (0.06, 0.122, 0),
    (0.07, 0.128, 3),   # forward HE yellow/brass identification band
    (0.15, 0.126, 3),
    (0.16, 0.120, 1),   # smooth secant ogive warhead
    (0.26, 0.108, 1),
    (0.36, 0.086, 1),
    (0.45, 0.058, 1),
    (0.52, 0.034, 2),   # machined steel nose fuze
    (0.60, 0.014, 2),
    (0.63, 0.000, 2),
]

SEGMENTS = 32
bm = bmesh.new()
rings = []
for y, r, _ in PROFILE:
    if r == 0.0:
        rings.append([bm.verts.new((0.0, y, 0.0))])
    else:
        ring = [
            bm.verts.new((r * math.cos(2 * math.pi * k / SEGMENTS), y, r * math.sin(2 * math.pi * k / SEGMENTS)))
            for k in range(SEGMENTS)
        ]
        rings.append(ring)

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

# Add 4 cruciform stabilizing tail fins at the base (-Y)
for angle in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
    ca, sa = math.cos(angle), math.sin(angle)

    def fin_pt(x, y, z):
        return (x * ca - z * sa, y, x * sa + z * ca)

    hw = 0.016
    # Swept trapezoidal fin extending from radius 0.07 to 0.195 over y = -0.55 .. -0.33
    v = [
        bm.verts.new(fin_pt(-hw, -0.55, 0.06)),
        bm.verts.new(fin_pt(hw, -0.55, 0.06)),
        bm.verts.new(fin_pt(hw, -0.33, 0.09)),
        bm.verts.new(fin_pt(-hw, -0.33, 0.09)),
        bm.verts.new(fin_pt(-hw, -0.57, 0.195)),
        bm.verts.new(fin_pt(hw, -0.57, 0.195)),
        bm.verts.new(fin_pt(hw, -0.41, 0.185)),
        bm.verts.new(fin_pt(-hw, -0.41, 0.185)),
    ]
    for quad in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)):
        f = bm.faces.new([v[k] for k in quad])
        f.material_index = 4
        f.smooth = False

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new("ArtilleryShell")
bm.to_mesh(mesh)
bm.free()

for mat in (olive_steel, oxide_nose, fuze_steel, brass_band, tail_steel):
    mesh.materials.append(mat)

shell = bpy.data.objects.new("ArtilleryShell", mesh)
scene.collection.objects.link(shell)

# Export GLB source asset alongside the script (ADR 0001)
bpy.ops.object.select_all(action="DESELECT")
shell.select_set(True)
bpy.context.view_layer.objects.active = shell
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True)

# Top-down orthographic camera matching the map view
cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = 1.55  # SHELL_WORLD_M in src/console/sprites.ts
cam_d.clip_end = 50.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (0, 0, 5.0)
scene.collection.objects.link(cam)
scene.camera = cam

# Sun and sky matching assets/maps/bake.py (SUN_ELEV = 24 deg, azimuth = 45 deg NE), in world
# space: +X east, +Y north. The shell is yawed to each baked heading, so the light never turns with it.
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
    for idx, pitch in enumerate(PITCH_ANGLES):
        for k in range(HEADINGS):
            # Pitch about X (nose +Y), then yaw so the nose flies at k * 360 / HEADINGS deg from east.
            shell.rotation_euler = (math.radians(pitch), 0, 2 * math.pi * k / HEADINGS - math.pi / 2)
            frame_path = os.path.join(tmp, f"pitch-{idx}-heading-{k}.png")
            scene.render.filepath = frame_path
            bpy.ops.render.render(write_still=True)
            frames.append(load_pixels(frame_path))

    # Render the soft shadow frame via a Cycles shadow-catcher plane directly under the shell
    shell.rotation_euler = (0, 0, 0)
    shell.location = (0, 0, 0.28)
    shell.visible_camera = False
    bg.inputs["Strength"].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0))
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
# Layout and the src/console/sprites.ts constants this bake fixes; sprites.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": len(PITCH_ANGLES) * HEADINGS + 1, "framePx": FRAME_PX, "cols": HEADINGS, "constants": {"SHELL_PITCH_FRAMES": len(PITCH_ANGLES), "SHELL_HEADINGS": HEADINGS, "SHELL_WORLD_M": cam_d.ortho_scale}}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {len(PITCH_ANGLES) * HEADINGS + 1}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
