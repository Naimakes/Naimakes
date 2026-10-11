import argparse
import json
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
GLB = os.path.join(ROOT, "src", "landing", "models", "archive-cassette.glb")
GLB_DETAIL = os.path.join(ROOT, "src", "landing", "models", "archive-assembly.glb")

with open(os.path.join(ROOT, "src", "landing", "array", "card-design.json")) as _f:
    _DESIGN = json.load(_f)
_BX, _BY, _BW, _BH = _DESIGN["box"]
CARD_W = 5.0
CARD_H = CARD_W * _BH / _BW
_K = CARD_W / _BW


def _card(x, y):
    return (x - (_BX + _BW / 2)) * _K, (_BY + _BH - y) * _K


_LX, _LY, _LW, _LH = _DESIGN["label"]
LABEL_CENTER = _card(_LX + _LW / 2, _LY + _LH / 2)
LABEL_SIZE = (_LW * _K, _LH * _K)

LOOK = {
    "board_color": "#F5ECE1",
    "board_roughness": 0.5,
    "board_transmission": 0.5,
    "board_subsurface": 0.3,
    "board_sss_radius": (1.0, 0.45, 0.2),
    "board_sss_scale": 0.8,
    "board_coat": 0.2,
    "board_coat_roughness": 0.35,
    "board_ior": 1.49,
    "board_edge_sheen": 0.0,
    "array_diffuser": False,
    "focus_color": "#FFA24D",
    "focus_emission": 14.0,
    "focus_glow_low": 0.05,
    "focus_glow_high": 0.45,
    "focus_glow_top": 0.03,
    "focus_light_power": 900.0,
    "focus_light_radius": 0.2,
    "focus_light_pos": (-2.7, -0.15, 2.15),
    "screw_color": "#C9C9C5",
    "screw_metallic": 0.8,
    "screw_roughness": 0.3,
    "world_color": "#EFE9E1",
    "world_strength": 0.35,
    "key_size": 14.0,
    "key_distance": 18.0,
    "key_irradiance": 16.0,
    "key_left": 0.515,
    "key_up": 1.43,
    "key_back": -0.857,
    "key_color": "#FFD2A8",
    "fill_ratio": 0.01,
    "fill_size": 40.0,
    "fill_color": "#F4F1EE",
    "ground_color": "#EFE9E1",
    "mist_start": 140.0,
    "mist_depth": 14.0,
    "mist_falloff": "LINEAR",
    "fog_display": "#EFE9E1",
    "bloom_strength": 0.6,
    "bloom_threshold": 1.2,
    "bloom_size": 0.6,
    "view_transform": "AgX",
    "look": "AgX - Low Contrast",
    "exposure": 0.5,
    "fstop": 0.35,
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--state", default=os.path.join(HERE, "array-state.json"))
    p.add_argument("--blend", default=os.path.join(HERE, "array-lighting.blend"))
    p.add_argument("--render", default="")
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--samples", type=int, default=512)
    p.add_argument("--engine", default="CYCLES", choices=["CYCLES", "BLENDER_EEVEE"])
    p.add_argument("--no-save", action="store_true")
    p.add_argument("--set", action="append", default=[], help="覆盖 LOOK 里的参数：key=value")
    return p.parse_args(argv)


def linear(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, alpha)


def three_to_blender(v):
    x, y, z = v
    return Vector((x, -z, y))


def surface_of(name):
    return re.sub(r"\.\d+$", "", name)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "Array"
    scene.unit_settings.system = "METRIC"
    return scene


def collection(name, parent=None):
    coll = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def layer_collection(coll, root=None):
    root = root or bpy.context.view_layer.layer_collection
    if root.collection == coll:
        return root
    for child in root.children:
        found = layer_collection(coll, child)
        if found:
            return found
    return None


def import_cassette(coll, prefix, path=GLB):
    bpy.context.view_layer.active_layer_collection = layer_collection(coll)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    parts = {}
    for obj in [o for o in bpy.data.objects if o not in before]:
        if obj.type != "MESH":
            continue
        mat = obj.material_slots[0].material if obj.material_slots else None
        surface = surface_of(mat.name if mat else obj.name)
        obj.name = f"{prefix}_{surface}"
        obj.data.name = obj.name
        parts.setdefault(surface, []).append(obj)
    return parts


def principled(name, color, **inputs):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = linear(color) if isinstance(color, str) else color
    for key, value in inputs.items():
        bsdf.inputs[key].default_value = value
    return mat, bsdf


def board_material(look):
    mat, bsdf = principled(
        "M_Board_FrostedAcrylic",
        look["board_color"],
        **{
            "Roughness": look["board_roughness"],
            "IOR": look["board_ior"],
            "Transmission Weight": look["board_transmission"],
            "Subsurface Weight": look["board_subsurface"],
            "Subsurface Radius": look["board_sss_radius"],
            "Subsurface Scale": look["board_sss_scale"],
            "Coat Weight": look["board_coat"],
            "Coat Roughness": look["board_coat_roughness"],
            "Coat IOR": 1.5,
            "Sheen Weight": look["board_edge_sheen"],
            "Sheen Roughness": 0.45,
            "Sheen Tint": linear("#FFF6EA"),
        },
    )
    bsdf.subsurface_method = "RANDOM_WALK"
    mat.diffuse_color = linear(look["board_color"])
    return mat


def focus_core_material(look):
    mat, bsdf = principled(
        "M_Focus_Core_Glow",
        look["board_color"],
        **{
            "Roughness": 0.6,
            "Subsurface Weight": 0.3,
            "Subsurface Radius": look["board_sss_radius"],
            "Subsurface Scale": look["board_sss_scale"],
            "Emission Color": linear(look["focus_color"]),
        },
    )
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new("ShaderNodeTexCoord")
    coords.location = (-900, -300)
    split = nodes.new("ShaderNodeSeparateXYZ")
    split.location = (-700, -300)
    ramp = nodes.new("ShaderNodeMapRange")
    ramp.location = (-500, -300)
    ramp.clamp = True
    ramp.interpolation_type = "SMOOTHSTEP"
    ramp.inputs["From Min"].default_value = look["focus_glow_low"]
    ramp.inputs["From Max"].default_value = look["focus_glow_high"]
    ramp.inputs["To Min"].default_value = look["focus_emission"]
    ramp.inputs["To Max"].default_value = look["focus_emission"] * look["focus_glow_top"]
    links.new(coords.outputs["Generated"], split.inputs[0])
    links.new(split.outputs["Z"], ramp.inputs["Value"])
    links.new(ramp.outputs["Result"], bsdf.inputs["Emission Strength"])
    return mat


def screw_material(look):
    mat, _ = principled(
        "M_Screw_Metal",
        look["screw_color"],
        Metallic=look["screw_metallic"],
        Roughness=look["screw_roughness"],
    )
    return mat


def image_material(name, path, *, alpha_mask=False, roughness=0.6, color="#FFFFFF", opacity=1.0, coat=0.0):
    mat, bsdf = principled(name, color, Roughness=roughness, **({"Coat Weight": coat} if coat else {}))
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.interpolation = "Cubic"
    tex.location = (-420, 120)
    if alpha_mask:
        tex.image.alpha_mode = "STRAIGHT"
        mul = nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = opacity
        mul.location = (-180, -80)
        links.new(tex.outputs["Alpha"], mul.inputs[0])
        links.new(mul.outputs[0], bsdf.inputs["Alpha"])
    else:
        tex.image.colorspace_settings.name = "sRGB"
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


ARRAY_SURFACES = ("Frosted_Polymer", "Ivory_Edges", "Index_Inlay", "Titanium_Fasteners")


def build_prototype(mats, look):
    coll = collection("Board_Prototype")
    parts = import_cassette(coll, "Board")
    keep = ARRAY_SURFACES + (("Optical_Diffuser",) if look["array_diffuser"] else ())
    for surface, objs in list(parts.items()):
        for obj in objs:
            if surface not in keep:
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            assign(obj, mats["screw"] if surface == "Titanium_Fasteners" else mats["board"])
    layer_collection(coll).exclude = True
    return coll


def build_array(state, prototype):
    coll = collection("Array_Boards")
    for cell in state["cells"]:
        empty = bpy.data.objects.new(f"Board_L{cell['lane']}_R{cell['row']}", None)
        empty.instance_type = "COLLECTION"
        empty.instance_collection = prototype
        empty.location = three_to_blender(cell["position"])
        empty.rotation_euler = (cell["rotationX"], 0.0, 0.0)
        empty.empty_display_size = 0.4
        coll.objects.link(empty)
    return coll


def build_focus(state, mats, look):
    coll = collection("Focus_Board")
    parts = import_cassette(coll, "Focus", GLB_DETAIL)
    root = bpy.data.objects.new("Focus_Board", None)
    root.empty_display_type = "CUBE"
    root.empty_display_size = 0.2
    coll.objects.link(root)
    sel = state["selected"]
    root.location = three_to_blender(sel["position"])
    root.rotation_euler = (sel["rotationX"], 0.0, 0.0)

    internal = {
        "Internal_Ceramic": principled("M_Focus_Ceramic", "#CFC5B8", Roughness=0.5)[0],
        "Optical_Edges": principled("M_Focus_OpticalEdges", "#EDE6DE", Roughness=0.3, **{"Transmission Weight": 0.6})[0],
        "Subsurface_Optics": principled("M_Focus_ReelGlass", "#B3ACA4", Roughness=0.22, **{"Transmission Weight": 0.3, "Coat Weight": 0.5})[0],
        "Optical_Film_Edge": principled("M_Focus_FilmEdge", "#C2B9AE", Roughness=0.3, Metallic=0.2)[0],
        "Optical_Film": principled("M_Focus_Film", "#D6CEC4", Roughness=0.3)[0],
        "Champagne_Index": principled("M_Focus_Champagne", "#CDB08A", Roughness=0.35, Metallic=0.6)[0],
        "Case_Engraving": principled("M_Focus_Engraving", "#DDD2C5", Roughness=0.45)[0],
        "Amber_Optical_Inlay": principled(
            "M_Focus_AmberInlay", "#DE7C2C", Roughness=0.3,
            **{"Emission Color": linear(look["focus_color"]), "Emission Strength": look["focus_emission"] * 0.6},
        )[0],
    }
    internal.update({
        "Optical_Window": principled("M_Focus_Window", "#FBF8F4", Roughness=0.06, **{"Transmission Weight": 1.0, "IOR": 1.46})[0],
        "Plan_Hairline": principled("M_Focus_Hairline", "#F4F3F1", Roughness=0.6)[0],
        "Fastener_Socket": principled("M_Focus_Socket", "#3F3B49", Roughness=0.5)[0],
        "Case_Engraving_Highlight": principled("M_Focus_InkLight", "#FCF9F6", Roughness=0.4)[0],
    })
    for surface, objs in parts.items():
        for obj in objs:
            if surface == "Titanium_Fasteners":
                assign(obj, mats["screw"])
            elif surface == "Optical_Diffuser":
                assign(obj, mats["focus_core"])
            elif surface == "Printed_Label":
                assign(obj, principled("M_Focus_LabelStock", "#EAE5DC", Roughness=0.65)[0])
            elif surface in internal:
                assign(obj, internal[surface])
            else:
                assign(obj, mats["board"])
            obj.parent = root

    bpy.ops.mesh.primitive_plane_add(size=1)
    label = bpy.context.active_object
    label.name = "Focus_Label_NMK"
    label.scale = (LABEL_SIZE[0], LABEL_SIZE[1], 1)
    label.location = (LABEL_CENTER[0], -0.2146, LABEL_CENTER[1])
    label.rotation_euler = (math.radians(90), 0, 0)
    assign(label, image_material("M_Focus_Label", os.path.join(HERE, "textures", "nmk_label.png"), roughness=0.62))
    label.parent = root
    for c in label.users_collection:
        c.objects.unlink(label)
    coll.objects.link(label)

    target = bpy.data.objects.new("Focus_Target", None)
    target.empty_display_size = 0.3
    target.location = (0, -0.05, CARD_H / 2)
    target.parent = root
    coll.objects.link(target)

    light_data = bpy.data.lights.new("Focus_Backlight", "POINT")
    light_data.color = linear(look["focus_color"])[:3]
    light_data.energy = look["focus_light_power"]
    light_data.shadow_soft_size = look["focus_light_radius"]
    light = bpy.data.objects.new("Focus_Backlight", light_data)
    light.location = look["focus_light_pos"]
    light.parent = root
    coll.objects.link(light)
    return root, target


def build_camera(state, look, focus_target, res):
    cam_state = state["camera"]
    data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", data)
    bpy.context.scene.collection.objects.link(cam)
    position = three_to_blender(cam_state["position"])
    aim = three_to_blender(cam_state["aim"])
    cam.location = position
    cam.rotation_euler = (aim - position).to_track_quat("-Z", "Y").to_euler()
    data.sensor_fit = "VERTICAL"
    data.sensor_height = 24.0
    data.lens = 12.0 / math.tan(math.radians(cam_state["verticalFovDeg"]) / 2)
    data.clip_start = 5.0
    data.clip_end = 1000.0
    data.dof.use_dof = True
    data.dof.focus_object = focus_target
    data.dof.aperture_fstop = look["fstop"]
    data.dof.aperture_blades = 0
    bpy.context.scene.camera = cam
    w, h = (int(v) for v in res.lower().split("x"))
    r = bpy.context.scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = w, h, 100
    return cam


def camera_basis(cam, aim):
    forward = (aim - cam.location).normalized()
    flat = Vector((forward.x, forward.y, 0)).normalized()
    right = flat.cross(Vector((0, 0, 1))).normalized()
    return flat, right


def area_light(name, size, power, location, target, color="#FFFFFF"):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "DISK"
    data.size = size
    data.energy = power
    data.color = linear(color)[:3]
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = (target - location).to_track_quat("-Z", "Y").to_euler()
    return obj


def build_lights(state, look, cam):
    coll = collection("Lights")
    aim = three_to_blender(state["camera"]["aim"])
    forward, right = camera_basis(cam, aim)
    world_irradiance = math.pi * look["world_strength"]

    key_dir = (-right * look["key_left"] + Vector((0, 0, look["key_up"])) + forward * look["key_back"]).normalized()
    d = look["key_distance"]
    key_power = look["key_irradiance"] * world_irradiance * math.pi * d * d
    key = area_light("Key_Area_UpperLeft", look["key_size"], key_power, aim + key_dir * d, aim, look["key_color"])
    coll.objects.link(key)

    fill_dir = Vector((-key_dir.x, -key_dir.y, max(0.25, key_dir.z * 0.4))).normalized()
    fill = area_light("Fill_Area_Opposite", look["fill_size"], key_power * look["fill_ratio"], aim + fill_dir * d, aim, look["fill_color"])
    coll.objects.link(fill)

    world = bpy.data.worlds.new("World_Cream")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = linear(look["world_color"])
    bg.inputs["Strength"].default_value = look["world_strength"]
    return key, fill


def build_ground(state, look):
    coll = collection("Ground")
    bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, state["floor"]["y"]))
    ground = bpy.context.active_object
    ground.name = "Ground_Plane"
    for c in ground.users_collection:
        c.objects.unlink(ground)
    coll.objects.link(ground)
    assign(ground, principled("M_Ground", look["ground_color"], Roughness=0.9)[0])
    return ground


def setup_fog(scene, look):
    world = scene.world
    world.mist_settings.start = look["mist_start"]
    world.mist_settings.depth = look["mist_depth"]
    world.mist_settings.falloff = look["mist_falloff"]
    view_layer = bpy.context.view_layer
    view_layer.use_pass_mist = True

    tree = bpy.data.node_groups.new("Array_Mist_Composite", "CompositorNodeTree")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    nodes, links = tree.nodes, tree.links
    rl = nodes.new("CompositorNodeRLayers")
    rl.location = (-700, 0)

    def to_display(name, invert, x):
        node = nodes.new("CompositorNodeConvertToDisplay")
        node.name = node.label = name
        node.location = (x, 0)
        node.inputs["Invert"].default_value = invert
        node.view_settings.view_transform = look["view_transform"]
        node.view_settings.look = look["look"]
        node.display_settings.display_device = "sRGB"
        return node

    def exposure(name, stops, x):
        node = nodes.new("CompositorNodeExposure")
        node.name = node.label = name
        node.location = (x, 0)
        node.inputs["Exposure"].default_value = stops
        return node

    pre = exposure("Exposure (scene)", look["exposure"], -620)
    forward = to_display("Scene → Display (AgX)", False, -450)
    back = to_display("Display → Scene (AgX⁻¹)", True, 150)
    post = exposure("Exposure (undo)", -look["exposure"], 320)
    fog = nodes.new("CompositorNodeRGB")
    target = look["fog_display"] or look["world_color"]
    fog.name = fog.label = f"Fog_Color {target} (screen)"
    h = target.lstrip("#")
    fog.outputs[0].default_value = (*(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)), 1.0)
    fog.location = (-450, -260)
    mix = nodes.new("ShaderNodeMix")
    mix.name = mix.label = "Mist Fog"
    mix.data_type = "RGBA"
    mix.blend_type = "MIX"
    mix.clamp_factor = True
    mix.location = (-150, 0)
    out = nodes.new("NodeGroupOutput")
    out.location = (520, 0)
    rl.location = (-880, 0)
    sock = lambda node, ident, outputs=False: next(s for s in (node.outputs if outputs else node.inputs) if s.identifier == ident)
    source = rl.outputs["Image"]
    if look["bloom_strength"] > 0:
        glare = nodes.new("CompositorNodeGlare")
        glare.name = glare.label = "Soft Bloom"
        glare.location = (-760, 220)
        glare.inputs["Type"].default_value = "Bloom"
        glare.inputs["Quality"].default_value = "High"
        glare.inputs["Threshold"].default_value = look["bloom_threshold"]
        glare.inputs["Strength"].default_value = look["bloom_strength"]
        glare.inputs["Size"].default_value = look["bloom_size"]
        links.new(source, glare.inputs["Image"])
        source = glare.outputs["Image"]
    links.new(source, pre.inputs["Image"])
    links.new(pre.outputs["Image"], forward.inputs["Image"])
    links.new(rl.outputs["Mist"], sock(mix, "Factor_Float"))
    links.new(forward.outputs["Image"], sock(mix, "A_Color"))
    links.new(fog.outputs[0], sock(mix, "B_Color"))
    links.new(sock(mix, "Result_Color", True), back.inputs["Image"])
    links.new(back.outputs["Image"], post.inputs["Image"])
    links.new(post.outputs["Image"], out.inputs[0])
    scene.compositing_node_group = tree
    scene.render.use_compositing = True
    scene.render.compositor_device = "CPU"


def setup_render(scene, look, engine, samples):
    scene.render.engine = engine
    if engine == "CYCLES":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        try:
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for dev in prefs.devices:
                dev.use = dev.type == "METAL"
            scene.cycles.device = "GPU"
        except Exception as exc:
            print("GPU unavailable:", exc)
        c = scene.cycles
        c.samples = samples
        c.use_adaptive_sampling = True
        c.adaptive_threshold = 0.01
        c.use_denoising = True
        c.denoiser = "OPENIMAGEDENOISE"
        c.max_bounces = 12
        c.diffuse_bounces = 4
        c.glossy_bounces = 4
        c.transmission_bounces = 12
        c.transparent_max_bounces = 12
        c.volume_bounces = 0
        c.caustics_reflective = False
        c.caustics_refractive = False
        c.blur_glossy = 1.0
        c.sample_clamp_indirect = 6.0
        c.use_light_tree = True
    else:
        e = scene.eevee
        e.taa_render_samples = max(64, samples // 2)
        e.use_raytracing = True
        e.use_shadows = True
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    vs = scene.view_settings
    vs.view_transform = look["view_transform"]
    vs.look = look["look"]
    vs.exposure = look["exposure"]
    vs.gamma = 1.0
    scene.display_settings.display_device = "sRGB"


def main():
    args = parse_args()
    look = dict(LOOK)
    for item in args.set:
        key, value = item.split("=", 1)
        look[key] = type(LOOK[key])(value) if not isinstance(LOOK[key], tuple) else tuple(float(v) for v in value.split(","))
    with open(args.state) as f:
        state = json.load(f)

    scene = reset_scene()
    mats = {
        "board": board_material(look),
        "screw": screw_material(look),
        "focus_core": focus_core_material(look),
    }
    prototype = build_prototype(mats, look)
    build_array(state, prototype)
    _, focus_target = build_focus(state, mats, look)
    cam = build_camera(state, look, focus_target, args.res)
    build_lights(state, look, cam)
    build_ground(state, look)
    setup_render(scene, look, args.engine, args.samples)
    setup_fog(scene, look)
    bpy.data.orphans_purge(do_recursive=True)

    if not args.no_save:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend, relative_remap=True)
        print("saved", args.blend)
    if args.render:
        out = args.render if os.path.isabs(args.render) else os.path.join(HERE, args.render)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print("rendered", out)


main()
