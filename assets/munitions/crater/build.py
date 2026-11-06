"""Build the baked shell crater decals (#53, #62).

Headless Blender script (ADR 0001, ADR 0002). Displaces a ground patch into a shell crater (scorched
bowl, broken rim, thrown clods and ejecta rays), lit with Kaltenbach's sun (azimuth 45 deg NE,
elevation 24 deg) and sky fill so the bowl and rim shade like the map. The patch fades to transparent
through a noisy ejecta mask so it sits on any ground. Renders 3 variants top-down and packs them into
`public/munitions/crater.png`.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/munitions/crater/build.py
"""
import json
import math
import os
import random
import tempfile

import bpy
import numpy as np
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT_SHEET = os.path.join(ROOT, "public", "munitions", "crater.png")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 128
VARIANTS = 3
SUN_ELEV = 24.0
SUN_AZ = 45.0
GRID = 220
# One frame spans 2 units (ortho_scale); the game draws it 10 m across, so 1 unit = 5 m.

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def node_math(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


# Ground material: colour and alpha come from a per-vertex "crater" attribute (x = scorch, y = cover).
mat = bpy.data.materials.new("CraterGround")
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.95
attr = nt.nodes.new("ShaderNodeAttribute")
attr.attribute_name = "crater"
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(attr.outputs["Color"], sep.inputs[0])
grain = nt.nodes.new("ShaderNodeTexNoise")
grain.inputs["Scale"].default_value = 38.0
grain.inputs["Detail"].default_value = 6.0
soil = nt.nodes.new("ShaderNodeValToRGB")
soil.color_ramp.elements[0].color = (0.028, 0.023, 0.018, 1)
soil.color_ramp.elements[1].color = (0.085, 0.07, 0.052, 1)
nt.links.new(grain.outputs["Fac"], soil.inputs[0])
scorch = nt.nodes.new("ShaderNodeMix")
scorch.data_type = "RGBA"
nt.links.new(sep.outputs[0], scorch.inputs[0])
nt.links.new(soil.outputs[0], scorch.inputs[6])
scorch.inputs[7].default_value = (0.011, 0.01, 0.009, 1)
nt.links.new(scorch.outputs[2], bsdf.inputs["Base Color"])
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.5
bump.inputs["Distance"].default_value = 0.02
nt.links.new(grain.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
transparent = nt.nodes.new("ShaderNodeBsdfTransparent")
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(sep.outputs[1], mix.inputs[0])
nt.links.new(transparent.outputs[0], mix.inputs[1])
nt.links.new(bsdf.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], nt.nodes["Material Output"].inputs["Surface"])

bpy.ops.mesh.primitive_grid_add(x_subdivisions=GRID, y_subdivisions=GRID, size=2.0)
patch = bpy.context.object
patch.data.materials.append(mat)
bpy.ops.object.shade_smooth()
mesh = patch.data
colors = mesh.color_attributes.new("crater", "FLOAT_COLOR", "POINT")

clod_mat = bpy.data.materials.new("Clod")
clod_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.07, 0.05, 1)
clod_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def build_variant(seed):
    rng = random.Random(seed)
    off = Vector((rng.uniform(-50, 50), rng.uniform(-50, 50), seed * 7.3))
    bowl = rng.uniform(0.3, 0.36)
    rays = [(rng.uniform(0, 2 * math.pi), rng.uniform(0.7, 0.92), rng.uniform(0.07, 0.16)) for _ in range(rng.randint(7, 11))]
    for v, c in zip(mesh.vertices, colors.data):
        x, y = v.co.x, v.co.y
        r = math.hypot(x, y)
        a = math.atan2(y, x)
        wob = 1 + 0.16 * noise.noise(Vector((math.cos(a) * 1.4, math.sin(a) * 1.4, 0)) + off)
        rn = r / (bowl * wob)
        z = 0.0
        if rn < 1:
            z = -0.09 * (1 - rn * rn) ** 0.8
        z += 0.05 * math.exp(-((rn - 1.08) / 0.22) ** 2) * (0.85 + 0.3 * noise.noise(Vector((x * 3, y * 3, 0)) + off))
        lumps = noise.noise(Vector((x * 11, y * 11, 1)) + off)
        z += 0.006 * lumps * math.exp(-max(0, rn - 1) * 2.5)
        ray = max((math.exp(-(((a - ra + math.pi) % (2 * math.pi) - math.pi) / w) ** 2) * smooth(rl * 1.1, 0.5 * bowl, r)) for ra, rl, w in rays) * smooth(0.8 * bowl, 1.1 * bowl, r)
        speck = smooth(0.25, 0.6, noise.noise(Vector((x * 14, y * 14, 3)) + off))
        cover = smooth(2.1, 1.2, rn) * 0.95 + 0.75 * ray + 0.55 * speck * smooth(0.95, 0.4, r)
        cover *= smooth(0.95, 0.75, max(abs(x), abs(y)))
        cover *= 0.85 + 0.3 * noise.noise(Vector((x * 4, y * 4, 5)) + off)
        burn = max(smooth(2.0, 1.0, rn), 0.7 * ray) * (0.7 + 0.3 * noise.noise(Vector((x * 5, y * 5, 2)) + off))
        v.co.z = z
        c.color = (min(1.0, burn), min(1.0, max(0.0, cover)), 0.0, 1.0)
    mesh.update()
    # Thrown clods around the rim, each casting its own little sun shadow on the patch.
    for _ in range(rng.randint(14, 20)):
        a = rng.uniform(0, 2 * math.pi)
        d = bowl * rng.uniform(1.05, 2.2)
        s = rng.uniform(0.008, 0.022)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(math.cos(a) * d, math.sin(a) * d, s * 0.4))
        clod = bpy.context.object
        clod.scale = (s * rng.uniform(0.8, 1.4), s * rng.uniform(0.8, 1.4), s * 0.7)
        clod.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        clod.data.materials.append(clod_mat)
        clod["clod"] = True


cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = 2.0
cam_d.clip_end = 50.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (0, 0, 5.0)
scene.collection.objects.link(cam)
scene.camera = cam

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
scene.cycles.samples = 96
scene.cycles.use_denoising = True
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
    for idx in range(VARIANTS):
        for ob in [o for o in scene.objects if o.get("clod")]:
            bpy.data.objects.remove(ob)
        build_variant(idx + 1)
        path = os.path.join(tmp, f"crater-{idx}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        px = load_pixels(path)
        px[..., 3] = np.where(px[..., 3] < 0.02, 0.0, px[..., 3])
        px[[0, -1], :, 3] = 0.0
        px[:, [0, -1], 3] = 0.0
        frames.append(px)

sheet = np.concatenate(frames, axis=1)
save_sheet(OUT_SHEET, sheet)
# Layout and the src/console/sprites.ts constants this bake fixes; sprites.test.ts checks they match.
with open(os.path.splitext(OUT_SHEET)[0] + ".json", "w") as f:
    json.dump({"frames": len(frames), "framePx": FRAME_PX, "cols": len(frames), "constants": {"CRATER_VARIANTS": VARIANTS}}, f, indent=2)
    f.write("\n")
print(f"Wrote {len(frames)}-frame crater sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
