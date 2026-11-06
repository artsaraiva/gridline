"""Build the baked shell impact explosion flipbook (#53, #62).

Headless Blender script (ADR 0001, ADR 0002). A procedural volumetric explosion (the spec allows it in
place of a fire/smoke sim): flash, an emissive fireball cooling into soot, a ground-hugging dust skirt,
billowing smoke lumps and ballistic debris and sparks with motion blur. Lit with Kaltenbach's sun
(azimuth 45 deg NE, elevation 24 deg) and sky fill; a shadow catcher puts the smoke and debris shadows on
the ground. Renders 32 top-down frames at 16 fps and packs them into an 8x4 grid,
`public/munitions/explosion.png`. The drifting plume that follows reuses `smoke-puff.png` (#63).

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/munitions/explosion/build.py
"""
import math
import os
import random
import tempfile

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT_SHEET = os.path.join(ROOT, "public", "munitions", "explosion.png")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 256
FRAMES = 32
COLS = 8
FPS = 16
SUN_ELEV = 24.0
SUN_AZ = 45.0
# One frame spans 2 units (ortho_scale); the game draws it 36 m across, so 1 unit = 18 m.

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = FRAMES
rng = random.Random(62)


def node_math(nt, op, a, b=None, c=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def map_range(nt, v, f0, f1, t0=0.0, t1=1.0):
    n = nt.nodes.new("ShaderNodeMapRange")
    n.clamp = True
    n.inputs["From Min"].default_value = f0
    n.inputs["From Max"].default_value = f1
    n.inputs["To Min"].default_value = t0
    n.inputs["To Max"].default_value = t1
    nt.links.new(v, n.inputs["Value"])
    return n.outputs["Result"]


def volume_material(name, color, radial="sphere", emissive=False):
    """Noisy volume inside a unit mesh. Returns the sockets driven per frame."""
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    out = nt.nodes["Material Output"]
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (*color, 1.0)
    vol.inputs["Anisotropy"].default_value = 0.25
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    coord = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    info = nt.nodes.new("ShaderNodeObjectInfo").outputs["Random"]
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 2.4
    noise.inputs["Detail"].default_value = 7.0
    noise.inputs["Roughness"].default_value = 0.62
    nt.links.new(coord, noise.inputs["Vector"])
    w_base = nt.nodes.new("ShaderNodeValue")
    nt.links.new(node_math(nt, "MULTIPLY_ADD", info, 17.0, w_base.outputs[0]), noise.inputs["W"])
    if radial == "ring":
        # Wide skirt in the XY plane, peaking at r = 0.55, thin in Z.
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(coord, sep.inputs[0])
        r = node_math(nt, "SQRT", node_math(nt, "ADD", node_math(nt, "POWER", sep.outputs[0], 2.0), node_math(nt, "POWER", sep.outputs[1], 2.0)))
        band = node_math(nt, "SUBTRACT", 1.0, node_math(nt, "ABSOLUTE", node_math(nt, "DIVIDE", node_math(nt, "SUBTRACT", r, 0.55), 0.5)))
        vert = map_range(nt, node_math(nt, "ABSOLUTE", sep.outputs[2]), 0.9, 0.05)
        falloff = node_math(nt, "MULTIPLY", node_math(nt, "MAXIMUM", band, 0.0), vert)
    else:
        length = nt.nodes.new("ShaderNodeVectorMath")
        length.operation = "LENGTH"
        nt.links.new(coord, length.inputs[0])
        falloff = map_range(nt, length.outputs["Value"], 0.95, 0.1)
    # density = max(0, noise + falloff * 0.95 - 1) * gain
    shaped = node_math(nt, "ADD", noise.outputs["Fac"], node_math(nt, "MULTIPLY_ADD", falloff, 0.95, -1.0))
    dens = node_math(nt, "MAXIMUM", shaped, 0.0)
    gain = nt.nodes.new("ShaderNodeValue")
    nt.links.new(node_math(nt, "MULTIPLY", dens, gain.outputs[0]), vol.inputs["Density"])
    sockets = {"w": w_base.outputs[0], "gain": gain.outputs[0], "noise": noise}
    if emissive:
        # Hot core: emission follows the dense middle; `cool` (0..1) shifts it from yellow-white to deep red.
        heat = node_math(nt, "MULTIPLY", node_math(nt, "MULTIPLY", falloff, falloff), noise.outputs["Fac"])
        cool = nt.nodes.new("ShaderNodeValue")
        hue = node_math(nt, "MULTIPLY", map_range(nt, heat, 0.05, 0.55), node_math(nt, "SUBTRACT", 1.0, cool.outputs[0]))
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        cr = ramp.color_ramp
        cr.elements[0].position = 0.0
        cr.elements[0].color = (0.9, 0.32, 0.06, 1)
        cr.elements[1].position = 1.0
        cr.elements[1].color = (1.0, 0.96, 0.82, 1)
        mid = cr.elements.new(0.5)
        mid.color = (1.0, 0.64, 0.24, 1)
        nt.links.new(hue, ramp.inputs[0])
        nt.links.new(ramp.outputs[0], vol.inputs["Emission Color"])
        strength = nt.nodes.new("ShaderNodeValue")
        nt.links.new(node_math(nt, "MULTIPLY", map_range(nt, heat, 0.02, 0.4), strength.outputs[0]), vol.inputs["Emission Strength"])
        sockets |= {"cool": cool.outputs[0], "emit": strength.outputs[0]}
    return mat, sockets


def sphere(name, mat, segments=40):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=segments, ring_count=segments // 2)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


def ease(x):
    return 1.0 - math.exp(-max(0.0, x))


# --- volumes
fire_mat, fire = volume_material("Fireball", (0.09, 0.08, 0.07), emissive=True)
fire["noise"].inputs["Scale"].default_value = 3.2
fireball = sphere("Fireball", fire_mat)
halo_mat, halo = volume_material("FlashHalo", (0.9, 0.85, 0.75), emissive=True)
halo["noise"].inputs["Scale"].default_value = 1.2
flash_halo = sphere("FlashHalo", halo_mat)
dust_mat, dust = volume_material("DustSkirt", (0.46, 0.40, 0.31), radial="ring")
dust["noise"].inputs["Scale"].default_value = 4.5
bpy.ops.mesh.primitive_cylinder_add(radius=1.0, depth=2.0, vertices=48)
dust_skirt = bpy.context.object
dust_skirt.data.materials.append(dust_mat)
smoke_mat, smoke = volume_material("Smoke", (0.62, 0.59, 0.54))
smoke["noise"].inputs["Scale"].default_value = 3.0
smoke["noise"].inputs["Detail"].default_value = 9.0
# Overlapping billows of random size around the column: (direction, distance, size, height jitter).
LUMPS = [(0.0, 0.0, 1.0, 0.04)] + [(rng.uniform(0, 2 * math.pi), rng.uniform(0.35, 1.0), rng.uniform(0.6, 1.0), rng.uniform(-0.02, 0.03)) for _ in range(13)]
lumps = [sphere(f"Smoke{i}", smoke_mat, 32) for i in range(len(LUMPS))]

# --- debris: dark clods plus a few glowing fragments, keyframed on ballistic arcs so motion blur streaks them
clod_mat = bpy.data.materials.new("Clod")
clod_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.04, 0.03, 1)
spark_mat = bpy.data.materials.new("Spark")
sp = spark_mat.node_tree.nodes["Principled BSDF"]
sp.inputs["Base Color"].default_value = (0.1, 0.05, 0.02, 1)
sp.inputs["Emission Color"].default_value = (1.0, 0.45, 0.1, 1)
G = 4.0
debris = []
for i in range(54):
    spark = i % 3 == 0
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0)
    ob = bpy.context.object
    ob.scale = [rng.uniform(0.007, 0.016) * (0.7 if spark else 1.0) for _ in range(3)]
    ob.rotation_euler = [rng.uniform(0, 6.28) for _ in range(3)]
    ob.data.materials.append(spark_mat if spark else clod_mat)
    a = rng.uniform(0, 2 * math.pi)
    v = rng.uniform(0.3, 0.8)
    vz = rng.uniform(0.4, 1.1)
    for f in range(1, FRAMES + 1):
        t = (f - 1) / FPS
        land = 2 * vz / G
        tt = min(t, land)
        z = max(0.012, vz * tt - 0.5 * G * tt * tt)
        ob.location = (math.cos(a) * v * tt, math.sin(a) * v * tt, z + 0.04)
        ob.keyframe_insert("location", frame=f)
    debris.append(ob)

# --- ground shadow catcher, so smoke and debris shadows fall south-west on the map
bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0, 0, 0))
ground = bpy.context.object
ground.is_shadow_catcher = True

# --- camera, sun, sky (as assets/maps/kaltenbach/build.py and the other munitions bakes)
cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = 2.0
cam_d.clip_end = 50.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (0, 0, 8.0)
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

glow_d = bpy.data.lights.new("fireglow", "POINT")
glow_d.color = (1.0, 0.55, 0.22)
glow_d.shadow_soft_size = 0.15
glow_d.use_shadow = False
glow = bpy.data.objects.new("fireglow", glow_d)
scene.collection.objects.link(glow)

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
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.cycles.volume_bounces = 2
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.8
scene.render.film_transparent = True
scene.render.resolution_x = FRAME_PX
scene.render.resolution_y = FRAME_PX
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"


def pose(t):
    """Drive every volume and light for time t seconds after impact."""
    flash = math.exp(-t / 0.04)
    flash_halo.scale = (0.5, 0.5, 0.25)
    flash_halo.location = (0, 0, 0.12)
    flash_halo.hide_render = flash < 0.02
    halo["gain"].default_value = 3.0 * flash
    halo["emit"].default_value = 90.0 * flash
    halo["cool"].default_value = 0.0

    rf = 0.1 + 0.32 * ease(t / 0.18)
    fireball.scale = (rf, rf, rf * 0.75)
    fireball.location = (0, 0, rf * 0.45 + 0.05 * t)
    fire["w"].default_value = 1.3 + t * 0.9
    fire["gain"].default_value = 26.0 + 10.0 * ease(t / 0.5)
    fire["emit"].default_value = 80.0 * math.exp(-t / 0.3) + 4.0 * math.exp(-t / 0.5)
    fire["cool"].default_value = min(1.0, t / 1.3)

    rd = 0.2 + 0.72 * ease(t / 0.35)
    dust_skirt.scale = (rd, rd, 0.1 + 0.08 * ease(t / 0.5))
    dust_skirt.location = (0, 0, 0.03)
    dust["gain"].default_value = 12.0 * math.exp(-t / 0.55) * min(1.0, t / 0.06 + 0.2)
    dust["w"].default_value = 4.0 + t * 0.6

    s = max(0.0, t - 0.08)
    grow = ease(s / 0.75)
    smoke["gain"].default_value = 30.0 * min(1.0, s / 0.3)
    smoke["w"].default_value = 7.0 + t * 0.5
    # Kept low and flat so the long low-sun shadows stay inside the frame.
    for ob, (a, d, k, dz) in zip(lumps, LUMPS):
        r = (0.1 + 0.34 * grow) * k
        off = d * (0.06 + 0.34 * grow)
        ob.scale = (r, r, r * 0.4)
        ob.location = (math.cos(a) * off, math.sin(a) * off, 0.06 + 0.06 * grow + dz)
        ob.hide_render = s <= 0.0

    sp.inputs["Emission Strength"].default_value = 30.0 * math.exp(-t / 0.35)
    glow.location = (0, 0, 0.12)
    glow_d.energy = 140.0 * math.exp(-t / 0.12) + 6.0 * math.exp(-t / 0.5)


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


# Square soft edge mask: whatever reaches the frame edge (long south-west shadows) fades out before it.
ax = np.abs(np.linspace(-1, 1, FRAME_PX))
edge = np.clip((0.985 - np.maximum(ax[:, None], ax[None, :])) / 0.13, 0.0, 1.0)

frames = []
with tempfile.TemporaryDirectory() as tmp:
    for i in range(FRAMES):
        scene.frame_set(i + 1)
        pose(i / FPS)
        path = os.path.join(tmp, f"explosion-{i}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        px = load_pixels(path)
        px[..., 3] *= edge
        px[..., 3] = np.where(px[..., 3] < 0.02, 0.0, px[..., 3])
        frames.append(px)
        print(f"frame {i + 1}/{FRAMES}")

# Blender images store rows bottom-up, so the first sheet row (frames 0..7) goes last.
rows = [np.concatenate(frames[r * COLS:(r + 1) * COLS], axis=1) for r in range(FRAMES // COLS)]
sheet = np.concatenate(rows[::-1], axis=0)
save_sheet(OUT_SHEET, sheet)
print(f"Wrote {FRAMES}-frame explosion sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
