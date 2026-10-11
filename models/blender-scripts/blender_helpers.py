import argparse
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

TAU = math.tau


def parse_args(description: str, defaults: dict):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--glb", default=defaults.get("glb"), help="导出的 .glb 路径")
    parser.add_argument("--blend", default=None, help="另存一份 .blend（可选）")
    parser.add_argument("--render", default=None, help="渲染预览图的目录（可选）")
    parser.add_argument("--scale", type=float, default=1.0, help="预览图分辨率倍数")
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    return scene


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(value: str, alpha: float = 1.0):
    value = value.lstrip("#")
    r, g, b = (int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


def set_world(color: str, strength: float = 1.0):
    world = bpy.data.worlds.new("World") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = hex_color(color)
    background.inputs["Strength"].default_value = strength
    return world


def collection(name: str, parent=None):
    coll = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def principled(name: str, color: str, *, alpha: float = 1.0, roughness: float = 0.6,
               metallic: float = 0.0, emission: str | None = None, emission_strength: float = 0.0,
               backface: bool = True):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_color(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    if emission:
        bsdf.inputs["Emission Color"].default_value = hex_color(emission)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    mat.diffuse_color = hex_color(color, alpha)
    mat.roughness = roughness
    if alpha < 1.0:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        if hasattr(mat, "blend_method"):
            try:
                mat.blend_method = "BLEND"
            except (TypeError, AttributeError):
                pass
    mat.use_backface_culling = not backface
    return mat


def revolve(profile, *, center=(0.0, 0.0), a0=0.0, a1=TAU, segments=384, radius_scale=None):
    full = abs((a1 - a0) - TAU) < 1e-9
    steps = max(8, round(segments * (a1 - a0) / TAU))
    n = len(profile)
    columns = steps if full else steps + 1
    verts = []
    for i in range(columns):
        a = a0 + (a1 - a0) * i / steps
        c, s = math.cos(a), math.sin(a)
        k = radius_scale(a) if radius_scale else 1.0
        for r, z in profile:
            verts.append((center[0] + r * k * c, center[1] + r * k * s, z))
    faces = []
    for i in range(steps):
        i2 = (i + 1) % columns
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i2 * n + j, i2 * n + j2, i * n + j2))
    if not full:
        faces.append(tuple(range(0, n)))
        faces.append(tuple(reversed(range(steps * n, steps * n + n))))
    return verts, faces


def ring_profile(r_in, r_out, z0, z1, *, top_round=0.0, round_steps=6, inner_round=0.0):
    points = [(r_in, z0), (r_out, z0)]
    if top_round > 0:
        cr, cz = r_out - top_round, z1 - top_round
        for k in range(round_steps + 1):
            t = (math.pi / 2) * k / round_steps
            points.append((cr + top_round * math.cos(t), cz + top_round * math.sin(t)))
    else:
        points += [(r_out, z1)]
    if inner_round > 0:
        cr, cz = r_in + inner_round, z1 - inner_round
        for k in range(round_steps + 1):
            t = math.pi / 2 + (math.pi / 2) * k / round_steps
            points.append((cr + inner_round * math.cos(t), cz + inner_round * math.sin(t)))
    else:
        points += [(r_in, z1)]
    clean = []
    for p in points:
        if not clean or (abs(p[0] - clean[-1][0]) > 1e-9 or abs(p[1] - clean[-1][1]) > 1e-9):
            clean.append(p)
    if abs(clean[0][0] - clean[-1][0]) < 1e-9 and abs(clean[0][1] - clean[-1][1]) < 1e-9:
        clean.pop()
    return clean


def frustum(r0, r1, z0, z1, *, segments=48, center=(0.0, 0.0)):
    verts = []
    for z, r in ((z0, r0), (z1, r1)):
        for i in range(segments):
            a = TAU * i / segments
            verts.append((center[0] + r * math.cos(a), center[1] + r * math.sin(a), z))
    faces = [(i, (i + 1) % segments, segments + (i + 1) % segments, segments + i) for i in range(segments)]
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range(segments, 2 * segments)))
    return verts, faces


def box(size, center=(0, 0, 0), rotation_z=0.0):
    sx, sy, sz = (v / 2 for v in size)
    corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
               (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    c, s = math.cos(rotation_z), math.sin(rotation_z)
    verts = [(center[0] + x * c - y * s, center[1] + x * s + y * c, center[2] + z) for x, y, z in corners]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return verts, faces


def merge(parts):
    verts, faces = [], []
    for v, f in parts:
        base = len(verts)
        verts.extend(v)
        faces.extend(tuple(base + i for i in face) for face in f)
    return verts, faces


def transform(part, matrix: Matrix):
    v, f = part
    return [tuple(matrix @ Vector(p)) for p in v], f


def mesh_object(name, part, material, *, parent=None, coll=None, props=None,
                smooth_angle=35.0, edges=None, location=(0, 0, 0)):
    verts, faces = part
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, edges or [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update(calc_edges=True)
    if faces:
        mesh.shade_smooth()
        mesh.set_sharp_from_angle(angle=math.radians(smooth_angle))
    if material is not None:
        mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    (coll or bpy.context.scene.collection).objects.link(obj)
    if parent is not None:
        obj.parent = parent
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def empty(name, *, parent=None, coll=None, location=(0, 0, 0), props=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.2
    obj.location = location
    (coll or bpy.context.scene.collection).objects.link(obj)
    if parent is not None:
        obj.parent = parent
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def polyline_edges(polylines, z=0.0):
    verts, edges = [], []
    for line in polylines:
        base = len(verts)
        for x, y, *rest in line:
            verts.append((x, y, rest[0] if rest else z))
        edges.extend((base + i, base + i + 1) for i in range(len(line) - 1))
    return verts, edges


def curve_from_polylines(name, polylines, *, width=0.006, z=0.0, material=None, coll=None):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = width / 2
    data.bevel_resolution = 2
    for line in polylines:
        spline = data.splines.new("POLY")
        spline.points.add(len(line) - 1)
        for point, (x, y, *rest) in zip(spline.points, line):
            point.co = (x, y, rest[0] if rest else z, 1.0)
    obj = bpy.data.objects.new(name, data)
    if material is not None:
        data.materials.append(material)
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


class CatmullRom:

    def __init__(self, points, curve_type="centripetal", tension=0.5):
        self.points = [Vector(p) for p in points]
        self.curve_type = curve_type
        self.tension = tension

    @staticmethod
    def _cubic(x0, x1, t0, t1):
        return (x0, t0, -3 * x0 + 3 * x1 - 2 * t0 - t1, 2 * x0 - 2 * x1 + t0 + t1)

    @classmethod
    def _nonuniform(cls, x0, x1, x2, x3, dt0, dt1, dt2):
        t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1
        t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2
        return cls._cubic(x1, x2, t1 * dt1, t2 * dt1)

    def point(self, t):
        pts = self.points
        count = len(pts)
        p = (count - 1) * t
        index = math.floor(p)
        weight = p - index
        if weight == 0 and index == count - 1:
            index = count - 2
            weight = 1.0
        p0 = pts[index - 1] if index > 0 else pts[0] + (pts[0] - pts[1])
        p1 = pts[index]
        p2 = pts[index + 1]
        p3 = pts[index + 2] if index + 2 < count else pts[count - 1] + (pts[count - 1] - pts[count - 2])
        power = 0.5 if self.curve_type == "chordal" else 0.25
        dt0 = ((p1 - p0).length_squared) ** power
        dt1 = ((p2 - p1).length_squared) ** power
        dt2 = ((p3 - p2).length_squared) ** power
        if dt1 < 1e-4:
            dt1 = 1.0
        if dt0 < 1e-4:
            dt0 = dt1
        if dt2 < 1e-4:
            dt2 = dt1
        out = []
        for axis in range(3):
            c0, c1, c2, c3 = self._nonuniform(p0[axis], p1[axis], p2[axis], p3[axis], dt0, dt1, dt2)
            out.append(c0 + c1 * weight + c2 * weight ** 2 + c3 * weight ** 3)
        return Vector(out)

    def spaced_points(self, divisions, sample=2000):
        dense = [self.point(i / sample) for i in range(sample + 1)]
        lengths = [0.0]
        for a, b in zip(dense, dense[1:]):
            lengths.append(lengths[-1] + (b - a).length)
        total = lengths[-1]
        result = []
        j = 0
        for i in range(divisions + 1):
            target = total * i / divisions
            while j < sample - 1 and lengths[j + 1] < target:
                j += 1
            seg = lengths[j + 1] - lengths[j] or 1.0
            k = (target - lengths[j]) / seg
            result.append(dense[j].lerp(dense[j + 1], min(1.0, max(0.0, k))))
        return result


def setup_freestyle(scene, *, thickness=1.2, alpha=0.8, color=(1.0, 1.0, 1.0), crease=140.0):
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    scene.render.line_thickness = thickness
    layer = scene.view_layers[0]
    layer.use_freestyle = True
    settings = layer.freestyle_settings
    settings.crease_angle = math.radians(crease)
    settings.use_culling = False
    lineset = settings.linesets.active or settings.linesets.new("Outline")
    lineset.select_by_visibility = True
    lineset.visibility = "VISIBLE"
    lineset.select_by_edge_types = True
    lineset.select_silhouette = True
    lineset.select_border = True
    lineset.select_crease = True
    lineset.select_edge_mark = True
    lineset.select_external_contour = True
    style = lineset.linestyle
    if style is None:
        style = bpy.data.linestyles.new("Outline")
        lineset.linestyle = style
    style.color = color
    style.alpha = alpha
    style.thickness = thickness
    style.caps = "ROUND"
    return lineset


def setup_render(scene, width, height, *, samples=32, transparent=False):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    if hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = samples


def render_still(scene, camera, path, width, height):
    setup_render(scene, width, height)
    scene.camera = camera
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[nmk] rendered {path}")


def select_only(objects):
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)


def export_glb(path, objects, *, compress=True):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    select_only(objects)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_cameras=True,
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_lights=False,
        export_animations=False,
        export_materials="EXPORT",
        use_mesh_edges=True,
        export_normals=True,
        export_tangents=False,
        export_texcoords=False,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_meshopt_compression_enable=compress,
    )
    print(f"[nmk] exported {path} ({os.path.getsize(path) / 1024:.1f} KiB)")


def save_blend(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    print(f"[nmk] saved {path}")


def look_at(obj, target, up=(0, 0, 1)):
    direction = Vector(target) - obj.location
    quat = direction.to_track_quat("-Z", "Y")
    obj.rotation_euler = quat.to_euler()
