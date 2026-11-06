"""Build the Scan UAV 3D asset and its top-down sprite sheet (#53, #64).

Headless Blender script (ADR 0001, ADR 0002). Models a small twin-boom tactical UAV (RQ-7 Shadow
class: 4.3 m wingspan, pusher prop, inverted-V tail) and renders it top-down at 16 headings
(frame k flies at k * 22.5 deg, 0 = east, counter-clockwise), each lit with Kaltenbach's exact sun
(azimuth 45 deg NE, elevation 24 deg) and sky fill in world space, so the runtime picks the nearest
heading and the baked light never turns with the aircraft. A 17th frame is a soft ground shadow
(flying east) from a Cycles shadow catcher. Frames pack into `public/objects/scan-uav.png`.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/objects/scan-uav/build.py
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
OUT_SHEET = os.path.join(ROOT, "public", "objects", "scan-uav.png")
OUT_GLB = os.path.join(HERE, "scan-uav.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 160
ORTHO_M = 5.0  # UAV_WORLD_M in src/console/sprites.ts
HEADINGS = 16  # UAV_HEADINGS in src/console/sprites.ts
SUN_ELEV = 24.0
SUN_AZ = 45.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def make_material(name, color, metallic=0.0, roughness=0.45, emission=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


# Material indices: 0 airframe grey, 1 darker composite (booms, tail, cowling), 2 black prop/anti-glare,
# 3 red port light, 4 green starboard light, 5 sensor window glass
MATS = [
    make_material("AirframeGrey", (0.33, 0.35, 0.34), roughness=0.42),
    make_material("CompositeGrey", (0.21, 0.22, 0.22), roughness=0.5),
    make_material("PropBlack", (0.035, 0.037, 0.04), roughness=0.35),
    make_material("NavRed", (0.9, 0.05, 0.03), roughness=0.3, emission=2.0),
    make_material("NavGreen", (0.05, 0.85, 0.2), roughness=0.3, emission=2.0),
    make_material("SensorGlass", (0.05, 0.08, 0.1), metallic=0.6, roughness=0.08),
]

bm = bmesh.new()


def ring_faces(r0, r1, mat, smooth=True):
    n = len(r0)
    for k in range(n):
        f = bm.faces.new((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]))
        f.material_index = mat
        f.smooth = smooth


def cap(ring, centre, mat, flip=False):
    c = bm.verts.new(centre)
    n = len(ring)
    for k in range(n):
        tri = (ring[k], ring[(k + 1) % n], c)
        f = bm.faces.new(tri[::-1] if flip else tri)
        f.material_index = mat
        f.smooth = True


def revolve(profile, cx, cz, sx=1.0, sz=1.0, segments=28):
    """Body of revolution along +Y at (cx, cz). profile: (y, radius, material) nose-last; ends are capped."""
    rings = []
    for y, r, _ in profile:
        rings.append([
            bm.verts.new((cx + sx * r * math.cos(2 * math.pi * k / segments), y, cz + sz * r * math.sin(2 * math.pi * k / segments)))
            for k in range(segments)
        ])
    for i in range(len(rings) - 1):
        ring_faces(rings[i], rings[i + 1], profile[i + 1][2])
    cap(rings[0], (cx, profile[0][0] - 0.01, cz), profile[0][2], flip=True)
    cap(rings[-1], (cx, profile[-1][0] + 0.01, cz), profile[-1][2])


def airfoil(chord, y_le, x, z, t=0.13, n=12):
    """Closed NACA 00xx-style section in the YZ plane, leading edge at +Y."""
    pts = []
    xs = [0.5 * (1 - math.cos(math.pi * i / n)) for i in range(n + 1)]
    half = lambda u: 5 * t * chord * (0.2969 * math.sqrt(u) - 0.126 * u - 0.3516 * u**2 + 0.2843 * u**3 - 0.1036 * u**4)
    for u in xs:  # upper surface, leading edge to trailing edge
        pts.append((x, y_le - u * chord, z + half(u)))
    for u in reversed(xs[1:-1]):  # lower surface back to the leading edge
        pts.append((x, y_le - u * chord, z - half(u)))
    return [bm.verts.new(p) for p in pts]


def loft(sections, mat):
    """Skins airfoil sections given as (x, z, chord, y_le) and caps both ends."""
    loops = [airfoil(c, yl, x, z) for x, z, c, yl in sections]
    for a, b in zip(loops, loops[1:]):
        ring_faces(a, b, mat)
    for loop, flip in ((loops[0], False), (loops[-1], True)):
        f = bm.faces.new(loop[::-1] if flip else loop)
        f.material_index = mat
        f.smooth = True
    return loops


WING_Z = 0.17
BOOM_X = 0.46

# Fuselage: rounded nose with a sensor window, deep mid body under the high wing, tapering to the engine.
revolve([
    (-0.98, 0.050, 1),
    (-0.90, 0.085, 1),
    (-0.72, 0.115, 1),
    (-0.45, 0.150, 0),
    (-0.10, 0.168, 0),
    (0.30, 0.168, 0),
    (0.58, 0.150, 0),
    (0.78, 0.118, 0),
    (0.90, 0.082, 5),
    (0.97, 0.040, 5),
], cx=0.0, cz=0.0, sx=0.88, sz=1.0)

# High wing with slight taper and dihedral, nav lights on the tips.
span = 2.15
loft([(-span, WING_Z + 0.07, 0.30, 0.20), (-BOOM_X, WING_Z, 0.42, 0.26), (0.0, WING_Z, 0.44, 0.27),
      (BOOM_X, WING_Z, 0.42, 0.26), (span, WING_Z + 0.07, 0.30, 0.20)], 0)
for sx, mat in ((-1, 3), (1, 4)):
    revolve([(0.04, 0.026, mat), (0.10, 0.026, mat), (0.13, 0.012, mat)], cx=sx * (span + 0.01), cz=WING_Z + 0.07, segments=12)

# Twin tail booms from the wing to the tail.
for sx in (-1, 1):
    revolve([(-1.62, 0.020, 1), (-1.50, 0.034, 1), (-0.40, 0.040, 1), (0.20, 0.046, 1), (0.42, 0.030, 1)],
            cx=sx * BOOM_X, cz=WING_Z, segments=16)

# Inverted-V tail: each panel slopes down from a boom tip to a centre apex.
loft([(-BOOM_X, WING_Z + 0.02, 0.30, -1.30), (0.0, WING_Z - 0.18, 0.26, -1.34), (BOOM_X, WING_Z + 0.02, 0.30, -1.30)], 1)

# Two-blade pusher propeller behind the engine, frozen at a slant so it shows as a thin dark bar from above.
for sgn in (-1, 1):
    a = math.radians(18)
    tip = (sgn * 0.40 * math.cos(a), -1.03, sgn * 0.40 * math.sin(a))
    w, t = 0.035, 0.012
    v = [
        bm.verts.new((0.0, -1.03 + w, t)), bm.verts.new((0.0, -1.03 - w, t)),
        bm.verts.new((tip[0], tip[1] - w * 0.6, tip[2] + t)), bm.verts.new((tip[0], tip[1] + w * 0.6, tip[2] + t)),
        bm.verts.new((0.0, -1.03 + w, -t)), bm.verts.new((0.0, -1.03 - w, -t)),
        bm.verts.new((tip[0], tip[1] - w * 0.6, tip[2] - t)), bm.verts.new((tip[0], tip[1] + w * 0.6, tip[2] - t)),
    ]
    for quad in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 3, 7, 4), (1, 5, 6, 2), (3, 2, 6, 7), (0, 4, 5, 1)):
        f = bm.faces.new([v[k] for k in quad])
        f.material_index = 2
revolve([(-1.10, 0.012, 2), (-1.05, 0.045, 2), (-0.99, 0.050, 2)], cx=0.0, cz=0.0, segments=16)  # spinner

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new("ScanUAV")
bm.to_mesh(mesh)
bm.free()
for mat in MATS:
    mesh.materials.append(mat)
uav = bpy.data.objects.new("ScanUAV", mesh)
scene.collection.objects.link(uav)

# Export GLB source asset alongside the script (ADR 0001)
bpy.ops.object.select_all(action="DESELECT")
uav.select_set(True)
bpy.context.view_layer.objects.active = uav
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True)

# Top-down orthographic camera matching the map view: image up = +Y = north, right = +X = east.
cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = ORTHO_M
cam_d.clip_end = 50.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (0, 0, 5.0)
scene.collection.objects.link(cam)
scene.camera = cam

# Sun and sky exactly as assets/maps/kaltenbach/build.py lighting(): light from the north-east.
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
scene.cycles.samples = 64
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


frames = []
with tempfile.TemporaryDirectory() as tmp:
    for k in range(HEADINGS):
        # The model's nose is +Y (heading 90 deg); yaw it so it flies at k * 360 / HEADINGS deg from east.
        uav.rotation_euler = (0, 0, 2 * math.pi * k / HEADINGS - math.pi / 2)
        path = os.path.join(tmp, f"heading-{k}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        frames.append(load_pixels(path))

    # Soft ground shadow flying east, via a Cycles shadow catcher under an overhead sun.
    uav.rotation_euler = (0, 0, -math.pi / 2)
    uav.location = (0, 0, 0.9)
    uav.visible_camera = False
    bg.inputs["Strength"].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(size=ORTHO_M, location=(0, 0, 0))
    catcher = bpy.context.object
    catcher.is_shadow_catcher = True
    sun.rotation_euler = (0, 0, 0)
    sun_d.angle = math.radians(9.0)
    path = os.path.join(tmp, "shadow.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    shadow = load_pixels(path)
    shadow[..., :3] = 0.0
    shadow[..., 3] = np.where(shadow[..., 3] < 0.08, 0.0, np.clip(shadow[..., 3] * 1.6, 0.0, 0.9))
    frames.append(shadow)

sheet = np.concatenate(frames, axis=1)
save_sheet(OUT_SHEET, sheet)
# Layout and the src/console/sprites.ts constants this bake fixes; sprites.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": len(frames), "framePx": FRAME_PX, "cols": len(frames), "constants": {"UAV_HEADINGS": HEADINGS, "UAV_WORLD_M": ORTHO_M}}, f, indent=2)
    f.write("\n")
print(f"Wrote {OUT_GLB} and {len(frames)}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
