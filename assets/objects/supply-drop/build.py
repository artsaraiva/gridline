"""Build the Supply Drop 3D asset and its top-down sprite sheet (#53, #65).

Headless Blender script (ADR 0001, ADR 0002). Builds a strapped wooden supply crate on a pallet hanging
under a gored cargo parachute, and renders top-down with Kaltenbach's sun (azimuth 45 deg NE, elevation
24 deg) and sky fill:
  frames 0-7  the crate under its canopy through one pendulum swing (falling),
  frame 8     the falling assembly's soft ground shadow (Cycles shadow catcher, overhead sun),
  frame 9     the crate on the ground with its collapsed canopy beside it and its own cast shadow.
The frames are packed into `public/objects/supply-drop.png`; the assembly is exported as a .glb source.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/objects/supply-drop/build.py
"""
import math
import os
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT_SHEET = os.path.join(ROOT, "public", "objects", "supply-drop.png")
OUT_GLB = os.path.join(HERE, "supply-drop.glb")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 256
ORTHO_M = 9.0  # world metres across one frame; SUPPLY_WORLD_M in src/console/sprites.ts
SWING_FRAMES = 8
SUN_ELEV = 24.0
SUN_AZ = 45.0

CANOPY_R = 2.6
CANOPY_H = 1.5
GORES = 16
LINE_L = 5.0  # canopy skirt to the riser confluence above the crate
CRATE = (1.5, 1.2, 0.95)  # crate body (x, y, z) in metres, on a 0.15 m pallet
TILT = 37.0  # mean pendulum lean, crate swung toward the south-west of the canopy
SWING = 7.0
CROSS = 5.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, roughness=0.8, wood=False, fabric=False):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    if not (wood or fabric):
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        return mat
    coord = nt.nodes.new("ShaderNodeTexCoord")
    if wood:
        # Plank grain along x with darker board seams, varied per board.
        wave = nt.nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "Y"
        wave.inputs["Scale"].default_value = 3.2
        wave.inputs["Distortion"].default_value = 2.5
        wave.inputs["Detail"].default_value = 3.0
        nt.links.new(coord.outputs["Object"], wave.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (color[0] * 0.55, color[1] * 0.55, color[2] * 0.55, 1)
        ramp.color_ramp.elements[1].position = 0.35
        ramp.color_ramp.elements[1].color = (*color, 1)
        nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        # Nylon with faint crinkle, so the canopy does not read as a plastic dome.
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


wood = material("PineCrate", (0.46, 0.33, 0.18), 0.85, wood=True)
pallet_wood = material("PalletWood", (0.30, 0.22, 0.13), 0.9, wood=True)
strap = material("OliveStrap", (0.10, 0.11, 0.06), 0.7)
stencil = material("StencilPanel", (0.13, 0.15, 0.08), 0.8)
olive = material("CanopyOlive", (0.085, 0.10, 0.05), 0.75, fabric=True)
tan = material("CanopyTan", (0.28, 0.25, 0.17), 0.75, fabric=True)
cord = material("SuspensionCord", (0.62, 0.60, 0.52), 0.6)


def box(name, size, loc, mat, bevel=0.03):
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


def crate(prefix):
    """Strapped pine crate on a pallet, base at z = 0, centred on the origin."""
    w, d, h = CRATE
    parts = [box(f"{prefix}Body", (w, d, h), (0, 0, 0.15 + h / 2), wood)]
    for y in (-d / 2 + 0.1, 0, d / 2 - 0.1):  # pallet skids
        parts.append(box(f"{prefix}Skid", (w + 0.1, 0.14, 0.12), (0, y, 0.06), pallet_wood, 0.01))
    parts.append(box(f"{prefix}Deck", (w + 0.1, d + 0.04, 0.04), (0, 0, 0.13), pallet_wood, 0.01))
    for x in (-w / 2 + 0.05, w / 2 - 0.05):  # end battens
        parts.append(box(f"{prefix}Batten", (0.1, d + 0.04, h + 0.02), (x, 0, 0.15 + h / 2), pallet_wood, 0.015))
    for x in (-w * 0.25, w * 0.25):  # cargo straps over the lid and down the sides
        parts.append(box(f"{prefix}Strap", (0.09, d + 0.05, h + 0.05), (x, 0, 0.15 + h / 2 + 0.005), strap, 0.0))
    parts.append(box(f"{prefix}Stencil", (0.42, 0.5, 0.01), (0, 0, 0.15 + h + 0.005), stencil, 0.0))
    return parts


def cylinder_between(name, a, b, r, mat):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=r, depth=(b - a).length, location=(a + b) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(mat)
    return o


def canopy():
    """Inflated gored canopy with an open apex vent; skirt scalloped between the suspension lines."""
    bm = bmesh.new()
    rings = 14
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
    me.materials.append(tan)
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
crate_top = confluence.z - 0.9
crate_parts = crate("Hang")
for p in crate_parts:
    p.location.z += crate_top - (0.15 + CRATE[2])
lines = [cylinder_between(f"Line{g}", s, confluence, 0.03, cord) for g, s in enumerate(skirt)]
w, d, _ = CRATE
lines += [cylinder_between(f"Riser{c}", confluence, (sx * w * 0.45, sy * d * 0.45, crate_top), 0.035, strap)
          for c, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1)))]
assembly = [canopy_obj, *crate_parts, *lines]

rig = bpy.data.objects.new("SupplyDrop", None)
scene.collection.objects.link(rig)
for o in assembly:
    o.parent = rig

# Lean axis: horizontal and perpendicular to the south-west, so the crate swings out SW of the canopy.
LEAN_AXIS = Vector((1, -1, 0)).normalized()
CROSS_AXIS = Vector((1, 1, 0)).normalized()
PIVOT = Vector((0, 0, -LINE_L * 0.35))


def pose(lean, cross):
    rot = Matrix.Rotation(math.radians(-lean), 4, LEAN_AXIS) @ Matrix.Rotation(math.radians(cross), 4, CROSS_AXIS)
    rig.matrix_world = Matrix.Translation(PIVOT) @ rot @ Matrix.Translation(-PIVOT)


# Frame centre: midway between canopy and crate in the mean pose, so the swing stays centred in the cell.
pose(TILT, 0)
bpy.context.view_layer.update()
crate_mid = rig.matrix_world @ Vector((0, 0, crate_top - CRATE[2] / 2))
canopy_mid = rig.matrix_world @ Vector((0, 0, CANOPY_H * 0.5))
CENTRE = (crate_mid + canopy_mid) / 2
print(f"crate offset from frame centre: {crate_mid.x - CENTRE.x:.3f}, {crate_mid.y - CENTRE.y:.3f} m")

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
    bpy.ops.mesh.primitive_plane_add(size=ORTHO_M * 0.92, location=(cam.location.x, cam.location.y, z))
    c = bpy.context.object
    c.is_shadow_catcher = True
    return c


def collapsed_canopy():
    """The canopy lying deflated on the ground beside the landed crate: wrinkled, gored, lines to the crate."""
    bm = bmesh.new()
    rings, seg = 14, GORES * 4
    verts = []
    for i in range(rings):
        rr = 0.04 + i / (rings - 1)
        row = []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            edge = 1 + 0.28 * noise.noise(Vector((math.cos(t) * 1.3, math.sin(t) * 1.3, 4.0)))
            x, y = 1.5 * rr * edge * math.cos(t), 0.8 * rr * edge * math.sin(t)
            # Crumpled fabric: broad folds plus fine wrinkles, piled up a little toward the middle.
            fold = abs(noise.noise(Vector((x * 1.1, y * 2.4, 0.3))))
            z = 0.03 + 0.34 * fold + 0.06 * noise.noise(Vector((x * 5, y * 5, 1.7))) + 0.18 * (1 - rr)
            z = max(0.02, z)
            row.append(bm.verts.new((x, y, z)))
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
    me.materials.append(tan)
    o = bpy.data.objects.new("CollapsedCanopy", me)
    scene.collection.objects.link(o)
    o.location = (1.95, 1.15, 0)
    o.rotation_euler = (0, 0, math.radians(32))
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
    low = min((o.matrix_world @ Vector(c)).z for o in crate_parts for c in o.bound_box)
    shadow_plane = catcher(low - 0.05)
    sun.rotation_euler = (0, 0, 0)
    sun_d.angle = math.radians(6.0)
    px = render(tmp, "shadow")
    px[..., :3] = 0.0
    px[..., 3] = np.where(px[..., 3] < 0.08, 0.0, np.clip(px[..., 3] * 1.6, 0.0, 0.9))
    frames.append(px)

    # Landed: crate on the ground at the frame centre with its canopy collapsed beside it and its own cast shadow.
    for o in assembly:
        o.hide_render = True
    bpy.data.objects.remove(shadow_plane)
    cam.location = (0, 0, 30.0)
    bg.inputs["Strength"].default_value = 0.55
    sun.rotation_euler = SUN_ROT
    sun_d.angle = math.radians(0.6)
    crate("Landed")
    collapsed_canopy()
    for g in range(-2, 3):  # a few slack lines from the crate to the fabric
        cylinder_between(f"Slack{g}", (0.75, 0.2 * g, 0.9), (1.2 + 0.1 * abs(g), 0.6 + 0.35 * g, 0.04), 0.018, strap)
    catcher(0.0)
    px = render(tmp, "landed")
    px[..., 3] = np.where(px[..., 3] < 0.05, 0.0, px[..., 3])
    frames.append(px)

sheet = np.concatenate(frames, axis=1)
save_sheet(OUT_SHEET, sheet)
print(f"Wrote {OUT_GLB} and {len(frames)}-frame sprite sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
