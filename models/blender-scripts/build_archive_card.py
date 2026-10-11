import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bmesh
import bpy
from mathutils import Matrix, Vector

import blender_helpers as nb
import build_reel_device as rd

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DESIGN = json.load(open(os.path.join(ROOT, "src", "landing", "array", "card-design.json")))
LETTERING = json.load(open(os.path.join(HERE, "card-lettering.json")))

BOX_X, BOX_Y, BOX_W, BOX_H = DESIGN["box"]
WIDTH = 5.0
HEIGHT = WIDTH * BOX_H / BOX_W
K = WIDTH / BOX_W
CX = BOX_X + BOX_W / 2
BOTTOM = BOX_Y + BOX_H

FACE = -0.206
COVER_BACK = -0.174
TRAY_BACK = 0.130
PANE = (FACE + 0.003, FACE + 0.015)
DIFFUSER = (0.038, 0.062)
LABEL_FRONT = -0.214
INK = 0.0005
ROUND_FACE = (0.013, 6)
ROUND_SEAM = (0.004, 2)
ROUND_BACK = (0.026, 6)
WINDOW_EDGE = (0.0045, 2)
SEAT_DEPTH = 0.0042
GROOVE_WIDTH = 3.0
GROOVE_DEPTH = 2.1
LETTER_RELIEF = 0.0045
LETTER_BEVEL = 0.0035
SQUASH = 0.62
HAIRLINE = 1.05
P_SEGMENTS = 384

FACE_TEXTURE = (4092, 2728)
AMBIENT = 0.40


def px(x, y):
    return ((x - CX) * K, (BOTTOM - y) * K)


TOKEN = re.compile(r"[MLHVCQAZmlhvcqaz]|-?\d*\.?\d+(?:e-?\d+)?")


def svg_polylines(d, *, offset=(0.0, 0.0), curve_steps=14):
    tokens = TOKEN.findall(d)
    i = 0
    lines, current = [], []
    x = y = 0.0
    start = (0.0, 0.0)
    ox, oy = offset

    def num():
        nonlocal i
        value = float(tokens[i])
        i += 1
        return value

    cmd = None
    while i < len(tokens):
        if re.match(r"[A-Za-z]", tokens[i]):
            cmd = tokens[i]
            i += 1
        if cmd == "M":
            if len(current) > 1:
                lines.append(current)
            x, y = num() + ox, num() + oy
            current = [(x, y)]
            start = (x, y)
            cmd = "L"
        elif cmd == "L":
            x, y = num() + ox, num() + oy
            current.append((x, y))
        elif cmd == "H":
            x = num() + ox
            current.append((x, y))
        elif cmd == "V":
            y = num() + oy
            current.append((x, y))
        elif cmd == "C":
            x1, y1, x2, y2, x3, y3 = num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy
            for k in range(1, curve_steps + 1):
                t = k / curve_steps
                a, b, c, e = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
                current.append((a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3))
            x, y = x3, y3
        elif cmd == "Q":
            x1, y1, x2, y2 = num() + ox, num() + oy, num() + ox, num() + oy
            for k in range(1, curve_steps + 1):
                t = k / curve_steps
                a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t ** 2
                current.append((a * x + b * x1 + c * x2, a * y + b * y1 + c * y2))
            x, y = x2, y2
        elif cmd == "A":
            rx, ry, rot, large, sweep, x2, y2 = num(), num(), num(), num(), num(), num() + ox, num() + oy
            current += arc_points(x, y, rx, ry, rot, int(large), int(sweep), x2, y2)
            x, y = x2, y2
        elif cmd == "Z":
            if (x, y) != start:
                current.append(start)
            x, y = start
            lines.append(current)
            current = []
            cmd = None
        else:
            raise ValueError(f"unsupported path command {cmd!r} in {d}")
    if len(current) > 1:
        lines.append(current)
    return lines


def arc_points(x1, y1, rx, ry, rot, large, sweep, x2, y2, step_deg=3.0):
    phi = math.radians(rot)
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    lam = (x1p ** 2) / (rx ** 2) + (y1p ** 2) / (ry ** 2)
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    coef = math.sqrt(max(0.0, num / den)) * (-1 if large == sweep else 1)
    cxp, cyp = coef * rx * y1p / ry, -coef * ry * x1p / rx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2
    ang = lambda ux, uy, vx, vy: math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dt > 0:
        dt -= math.tau
    elif sweep and dt < 0:
        dt += math.tau
    steps = max(6, int(abs(dt) / math.radians(step_deg)))
    out = []
    for k in range(1, steps + 1):
        t = t1 + dt * k / steps
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        out.append((cp * ex - sp * ey + cx, sp * ex + cp * ey + cy))
    return out


def shift_path(d, dx, dy):
    tokens = TOKEN.findall(d)
    out, i, cmd = [], 0, None
    while i < len(tokens):
        tok = tokens[i]
        if re.match(r"[A-Za-z]", tok):
            cmd = tok
            out.append(tok)
            i += 1
            continue
        if cmd == "A":
            rx, ry, rot, large, sweep, x, y = tokens[i:i + 7]
            out += [rx, ry, rot, large, sweep, str(float(x) + dx), str(float(y) + dy)]
            i += 7
        else:
            x, y = tokens[i:i + 2]
            out += [str(float(x) + dx), str(float(y) + dy)]
            i += 2
    return " ".join(out)


def circle_px(cx, cy, r, step_deg=3.0):
    n = max(24, int(360 / step_deg))
    return [(cx + r * math.cos(math.tau * k / n), cy + r * math.sin(math.tau * k / n)) for k in range(n)] + \
        [(cx + r, cy)]


def clean_polyline(points, eps=1e-7):
    pts = [Vector(p) for p in points]
    closed = len(pts) > 2 and (pts[0] - pts[-1]).length < 1e-6
    if closed:
        pts = pts[:-1]
    out = [pts[0]]
    for p in pts[1:]:
        if (p - out[-1]).length > eps:
            out.append(p)
    if closed and len(out) > 2 and (out[0] - out[-1]).length < eps:
        out.pop()
    return out, closed


def outline_prism(name, outer, holes, y0, y1, material, coll, *, bevel=0.0, bevel_steps=2, offset=0.0):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.extrude = max(0.0, abs(y1 - y0) / 2 - bevel)
    curve.bevel_depth = bevel
    curve.bevel_resolution = bevel_steps
    curve.offset = offset
    curve.resolution_u = 1
    for loop in [outer] + holes:
        spline = curve.splines.new("POLY")
        spline.points.add(len(loop) - 1)
        for point, (x, z) in zip(spline.points, loop):
            point.co = (x, z, 0.0, 1.0)
        spline.use_cyclic_u = True
    temp = bpy.data.objects.new(name + "_curve", curve)
    coll.objects.link(temp)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(temp.evaluated_get(depsgraph))
    bpy.data.objects.remove(temp, do_unlink=True)
    bpy.data.curves.remove(curve)
    center = (y0 + y1) / 2
    mesh.transform(Matrix.Translation((0, center, 0)) @ Matrix.Rotation(math.radians(90), 4, "X"))
    if material is not None:
        mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    return obj


def _on_outline(point, loop, tol=1e-5):
    px_, pz = point
    for (ax, az), (bx, bz) in zip(loop, loop[1:] + loop[:1]):
        dx, dz = bx - ax, bz - az
        length2 = dx * dx + dz * dz
        t = 0.0 if length2 < 1e-18 else max(0.0, min(1.0, ((px_ - ax) * dx + (pz - az) * dz) / length2))
        ex, ez = ax + dx * t - px_, az + dz * t - pz
        if ex * ex + ez * ez < tol * tol:
            return True
    return False


def bevel_loops(obj, rounds):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts, edges=bm.edges)
    for loop, y, radius, segments in rounds:
        edges = [e for e in bm.edges
                 if all(abs(v.co.y - y) < 1e-6 for v in e.verts)
                 and _on_outline(((e.verts[0].co.x + e.verts[1].co.x) / 2, (e.verts[0].co.z + e.verts[1].co.z) / 2), loop)]
        if edges:
            bmesh.ops.bevel(bm, geom=edges, offset=radius, offset_type="OFFSET", segments=segments,
                            profile=0.5, affect="EDGES", clamp_overlap=True)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


def shade_part(obj, smooth_angle=30.0):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    limit = math.radians(smooth_angle)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        faces = e.link_faces
        if len(faces) != 2:
            e.smooth = False
            continue
        a, b = faces
        cap_a, cap_b = abs(a.normal.y) > 0.9999, abs(b.normal.y) > 0.9999
        e.smooth = cap_a == cap_b and a.normal.angle(b.normal, 0.0) <= limit
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


def boolean(obj, cutters, operation="DIFFERENCE", mark=None):
    coll = bpy.data.collections.new(obj.name + "_cutters")
    bpy.context.scene.collection.children.link(coll)
    temps = []
    for i, part in enumerate(cutters):
        if not part[0]:
            continue
        cutter = nb.mesh_object(f"{obj.name}_cutter{i}", part, mark, coll=coll)
        bm = bmesh.new()
        bm.from_mesh(cutter.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(cutter.data)
        bm.free()
        temps.append(cutter)
    mod = obj.modifiers.new("cut", "BOOLEAN")
    mod.operation = operation
    mod.operand_type = "COLLECTION"
    mod.collection = coll
    mod.solver = "EXACT"
    if mark is not None:
        mod.material_mode = "TRANSFER"
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.remove(mod)
    old = obj.data
    obj.data = mesh
    bpy.data.meshes.remove(old)
    for cutter in temps:
        bpy.data.meshes.remove(cutter.data)
    bpy.data.collections.remove(coll)
    return obj


def groove_shading(obj, mark, strength=0.6, lip=0.28):
    mesh = obj.data
    slot = next((i for i, m in enumerate(mesh.materials) if m == mark), None)
    attr = mesh.color_attributes.get("Color") or mesh.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for item in attr.data:
        item.color = (1.0, 1.0, 1.0, 1.0)
    if slot is None:
        return obj
    light = Vector((-1.0, 1.0)).normalized()
    out = Vector((0.0, -1.0, 0.0))
    groove = [p.material_index == slot for p in mesh.polygons]
    rim = [False] * len(mesh.vertices)
    for poly, is_groove in zip(mesh.polygons, groove):
        if not is_groove:
            for v in poly.vertices:
                rim[v] = True
    normals = [Vector(n.vector) for n in mesh.corner_normals]
    for poly, is_groove in zip(mesh.polygons, groove):
        if not is_groove:
            continue
        n = poly.normal
        side = Vector((n.x, n.z))
        dark = 0.0
        if side.length > 0.2:
            dark = strength * max(0.0, -side.normalized().dot(light)) ** 0.8
        for li in poly.loop_indices:
            v = mesh.loops[li].vertex_index
            if rim[v]:
                normals[li] = (out * (1.0 - lip) + n * lip).normalized() if n.dot(out) > 0.05 else Vector(n)
                attr.data[li].color = (1.0, 1.0, 1.0, 1.0)
            else:
                normals[li] = Vector(n)
                value = 1.0 - dark
                attr.data[li].color = (value, value, value, 1.0)
    for poly in mesh.polygons:
        poly.material_index = 0
        poly.use_smooth = True
    mesh.materials.pop(index=slot)
    mesh.normals_split_custom_set([tuple(n) for n in normals])
    return obj


def paint_white(obj):
    mesh = obj.data
    attr = mesh.color_attributes.get("Color") or mesh.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for item in attr.data:
        item.color = (1.0, 1.0, 1.0, 1.0)
    return obj


def v_groove(points_px, surface_y, *, width_px=GROOVE_WIDTH, depth_px=GROOVE_DEPTH, into=1.0, above=0.004,
             cone_steps=16):
    pts2, closed = clean_polyline([px(*p) for p in points_px])
    n = len(pts2)
    if n < 2:
        return [], []
    w, d = width_px * K / 2, depth_px * K
    top_y = surface_y - into * above
    bottom_y = surface_y + into * d
    half_top = w * (d + above) / d

    def normal(a, b):
        t = (b - a).normalized()
        return Vector((-t.y, t.x))

    verts, faces = [], []
    left, right, apex = [], [], []
    for i, p in enumerate(pts2):
        ns = []
        if i > 0 or closed:
            ns.append(normal(pts2[i - 1], p))
        if i < n - 1 or closed:
            ns.append(normal(p, pts2[(i + 1) % n]))
        m = (ns[0] + ns[-1]).normalized() if len(ns) == 2 else ns[0]
        scale = 1.0 / max(0.3, m.dot(ns[-1]))
        lp, rp = p + m * half_top * scale, p - m * half_top * scale
        left.append(len(verts)); verts.append((lp.x, top_y, lp.y))
        right.append(len(verts)); verts.append((rp.x, top_y, rp.y))
        apex.append(len(verts)); verts.append((p.x, bottom_y, p.y))
    count = n if closed else n - 1
    for i in range(count):
        j = (i + 1) % n
        faces.append((left[i], left[j], apex[j], apex[i]))
        faces.append((right[j], right[i], apex[i], apex[j]))
        faces.append((left[j], left[i], right[i], right[j]))
    if not closed:
        for end in (0, n - 1):
            p = pts2[end]
            t = (pts2[1] - pts2[0]).normalized() if end == 0 else (pts2[-1] - pts2[-2]).normalized()
            nn = Vector((-t.y, t.x))
            back = -t if end == 0 else t
            ring = []
            for k in range(cone_steps + 1):
                phi = math.pi * k / cone_steps
                if end == 0:
                    direction = nn * math.cos(phi) + back * math.sin(phi)
                else:
                    direction = -nn * math.cos(phi) + back * math.sin(phi)
                q = p + direction * half_top
                if k == 0:
                    ring.append(left[end] if end == 0 else right[end])
                elif k == cone_steps:
                    ring.append(right[end] if end == 0 else left[end])
                else:
                    ring.append(len(verts))
                    verts.append((q.x, top_y, q.y))
            for k in range(cone_steps):
                faces.append((apex[end], ring[k + 1], ring[k]))
            faces.append(tuple(ring))
    return verts, faces


def cylinder_cutter(cx, cz, radius, y0, y1, segments=128, radius_end=None):
    radius_end = radius if radius_end is None else radius_end
    verts = []
    for y, r in ((y0, radius), (y1, radius_end)):
        for k in range(segments):
            a = math.tau * k / segments
            verts.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
    faces = [(k, (k + 1) % segments, segments + (k + 1) % segments, segments + k) for k in range(segments)]
    faces.append(tuple(range(segments)))
    faces.append(tuple(reversed(range(segments, 2 * segments))))
    return verts, faces


def ink_line(points_px, width_px, y, *, offset_px=(0.0, 0.0), caps=True, cap_steps=10):
    pts2, closed = clean_polyline([px(x + offset_px[0], yy + offset_px[1]) for x, yy in points_px])
    n = len(pts2)
    if n < 2:
        return [], []
    half = width_px * K / 2
    verts, faces = [], []

    def normal(a, b):
        t = (b - a).normalized()
        return Vector((-t.y, t.x))

    left, right = [], []
    for i, p in enumerate(pts2):
        ns = []
        if i > 0 or closed:
            ns.append(normal(pts2[i - 1], p))
        if i < n - 1 or closed:
            ns.append(normal(p, pts2[(i + 1) % n]))
        m = (ns[0] + ns[-1]).normalized() if len(ns) == 2 else ns[0]
        scale = 1.0 / max(0.3, m.dot(ns[-1]))
        a, b = p + m * half * scale, p - m * half * scale
        left.append(len(verts)); verts.append((a.x, y, a.y))
        right.append(len(verts)); verts.append((b.x, y, b.y))
    count = n if closed else n - 1
    for i in range(count):
        j = (i + 1) % n
        faces.append((left[i], right[i], right[j], left[j]))
    if caps and not closed:
        for end in (0, n - 1):
            p = pts2[end]
            t = (pts2[1] - pts2[0]).normalized() if end == 0 else (pts2[-1] - pts2[-2]).normalized()
            nn = Vector((-t.y, t.x))
            back = -t if end == 0 else t
            center = len(verts)
            verts.append((p.x, y, p.y))
            ring = [left[end] if end == 0 else right[end]]
            for k in range(1, cap_steps):
                phi = math.pi * k / cap_steps
                direction = (nn if end == 0 else -nn) * math.cos(phi) + back * math.sin(phi)
                q = p + direction * half
                ring.append(len(verts))
                verts.append((q.x, y, q.y))
            ring.append(right[end] if end == 0 else left[end])
            for k in range(len(ring) - 1):
                faces.append((center, ring[k], ring[k + 1]))
    return verts, faces


def ink_disc(cx, cy, r_px, y, segments=40):
    x, z = px(cx, cy)
    r = r_px * K
    verts = [(x, y, z)] + [(x + r * math.cos(math.tau * k / segments), y, z + r * math.sin(math.tau * k / segments))
                           for k in range(segments)]
    faces = [(0, 1 + k, 1 + (k + 1) % segments) for k in range(segments)]
    return verts, faces


def orient_toward(part, direction=Vector((0, -1, 0))):
    verts, faces = part
    out = []
    for f in faces:
        a, b, c = (Vector(verts[i]) for i in f[:3])
        normal = (b - a).cross(c - a)
        out.append(f if normal.dot(direction) >= 0 else tuple(reversed(f)))
    return verts, out


def chamfered_rect(x0, z0, x1, z1, c):
    return [(x0 + c, z0), (x1 - c, z0), (x1, z0 + c), (x1, z1 - c), (x1 - c, z1), (x0 + c, z1), (x0, z1 - c), (x0, z0 + c)]


def rounded_rect_px(x, y, w, h, r, steps=6):
    corners = [(x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180), (x + w - r, y + r, 270)]
    pts = []
    for cx, cy, a0 in corners:
        for k in range(steps + 1):
            a = math.radians(a0 + 90 * k / steps)
            pts.append(px(cx + r * math.cos(a), cy + r * math.sin(a)))
    return ccw(pts)


def ccw(pts):
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))
    return pts if area > 0 else list(reversed(pts))


def window_loop():
    line = svg_polylines(DESIGN["window"], curve_steps=8)[0]
    return ccw([px(*p) for p in line[:-1]])


def shrink(loop, d):
    n = len(loop)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(loop[i - 1]), Vector(loop[i]), Vector(loop[(i + 1) % n])
        t0, t1 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n0, n1 = Vector((-t0.y, t0.x)), Vector((-t1.y, t1.x))
        bis = (n0 + n1)
        if bis.length < 1e-6:
            bis = n0
        bis.normalize()
        scale = 1.0 / max(0.3, bis.dot(n0))
        q = p1 + bis * d * scale
        out.append((q.x, q.y))
    return out


def round_box(obj, radius, segments=2):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius, offset_type="OFFSET", segments=segments,
                    profile=0.5, affect="EDGES", clamp_overlap=True)
    bm.normal_update()
    for f in bm.faces:
        f.smooth = True
    flat = lambda f: max(abs(f.normal.x), abs(f.normal.y), abs(f.normal.z)) > 0.9999
    for e in bm.edges:
        faces = e.link_faces
        e.smooth = (len(faces) == 2 and not flat(faces[0]) and not flat(faces[1])
                    and faces[0].normal.angle(faces[1].normal, 0.0) <= math.radians(60))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


SURFACES = {
    "Frosted_Polymer": ("#e1dad5", 0.46, 0.0, 0.0, 1.0),
    "Optical_Window": ("#f4f1ee", 0.08, 0.0, 1.0, 1.0),
    "Ivory_Edges": ("#d6cec7", 0.42, 0.0, 0.0, 1.0),
    "Optical_Edges": ("#dad3cd", 0.42, 0.0, 0.0, 1.0),
    "Optical_Diffuser": ("#e1dad5", 0.5, 0.0, 0.0, 1.0),
    "Printed_Label": ("#e8e5e2", 0.6, 0.0, 0.0, 1.0),
    "Index_Inlay": ("#ccb8a9", 0.5, 0.0, 0.0, 1.0),
    "Case_Engraving": ("#968e87", 0.5, 0.0, 0.0, 1.0),
    "Case_Engraving_Highlight": ("#fcf9f6", 0.4, 0.0, 0.0, 1.0),
    "Champagne_Index": ("#8d857d", 0.45, 0.0, 0.0, 1.0),
    "Titanium_Fasteners": ("#bdb9cb", 0.3, 0.75, 0.0, 1.0),
    "Fastener_Socket": ("#3f3b49", 0.5, 0.2, 0.0, 1.0),
    "Subsurface_Optics": ("#ffffff", 0.55, 0.0, 0.0, 1.0),
    "Amber_Optical_Inlay": ("#d68342", 0.5, 0.0, 0.0, 1.0),
    "Optical_Film": ("#b9b9b9", 0.4, 0.0, 0.0, 0.18),
    "Plan_Hairline": ("#f4f3f1", 0.6, 0.0, 0.0, 1.0),
}
PARTS = {
    "Frosted_Polymer": "cover", "Optical_Window": "cover", "Printed_Label": "cover", "Index_Inlay": "cover",
    "Case_Engraving": "cover", "Case_Engraving_Highlight": "cover", "Champagne_Index": "cover",
    "Ivory_Edges": "carrier", "Optical_Edges": "carrier",
    "Optical_Diffuser": "substrate",
    "Subsurface_Optics": "optical-core", "Amber_Optical_Inlay": "optical-core",
    "Optical_Film": "optical-lenses",
    "Titanium_Fasteners": "fasteners", "Fastener_Socket": "fasteners",
    "Plan_Hairline": "optical-core",
}

REEL_GREYS = {
    "Big_Base": "#d2cfcc", "Big_BaseEdge": "#d2cfcc", "Big_OrangeBottomGaps": "#d2cfcc",
    "Big_Colonnade": "#c6c5c3", "Big_Ribs": "#c6c5c3", "Big_Middle": "#c6c5c3",
    "Big_Tread": "#c1c1c0", "Big_Rim": "#c5c4c3", "Big_Collar": "#a3a2a1",
    "Small_Base": "#c9c8c6", "Small_Tier": "#c9c8c6", "Small_Body": "#c8c7c5", "Small_Rim": "#c5c1be",
    "Small_Step": "#c8c7c5", "Small_Hub": "#8e8c89",
}


def materials():
    out = {}
    for name, (color, rough, metal, transmission, alpha) in SURFACES.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = nb.hex_color(color)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Transmission Weight"].default_value = transmission
        bsdf.inputs["IOR"].default_value = 1.46 if transmission else 1.5
        bsdf.inputs["Alpha"].default_value = alpha
        if name == "Subsurface_Optics":
            attr = nodes.new("ShaderNodeVertexColor")
            attr.layer_name = "Color"
            mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha < 1.0:
            if hasattr(mat, "surface_render_method"):
                mat.surface_render_method = "BLENDED"
        mat.diffuse_color = nb.hex_color(color, alpha)
        out[name] = mat
    return out


def engraving_paths():
    out = [(svg_polylines(DESIGN["rim"]), 0.9)]
    for g in DESIGN["grooves"]:
        if g["id"] == "panel":
            continue
        out.append((svg_polylines(g["d"]), g["strength"]))
    return out


def screw_centers():
    return [px(sx, sy) for sx, sy in DESIGN["screws"]]


def build_frame(coll, m):
    x0, x1 = -WIDTH / 2, WIDTH / 2
    chamfer = DESIGN["chamfer"] * K
    outer = chamfered_rect(x0, 0.0, x1, HEIGHT, chamfer)
    window = window_loop()
    cover = outline_prism("cover__Frosted_Polymer", outer, [window], FACE, COVER_BACK, m["Frosted_Polymer"], coll)
    bevel_loops(cover, [(outer, FACE, *ROUND_FACE), (outer, COVER_BACK, *ROUND_SEAM), (window, FACE, *WINDOW_EDGE)])
    cutters = []
    for lines, strength in engraving_paths():
        for line in lines:
            cutters.append(v_groove(line, FACE, width_px=GROOVE_WIDTH * (0.55 + 0.45 * strength),
                                    depth_px=GROOVE_DEPTH * (0.5 + 0.5 * strength)))
    seat = DESIGN["screw"]["seat"] * K
    slope = 2.6 * K / SEAT_DEPTH
    for cx, cz in screw_centers():
        cutters.append(cylinder_cutter(cx, cz, seat + 0.004 * slope, FACE - 0.004, FACE + SEAT_DEPTH,
                                       radius_end=seat - SEAT_DEPTH * slope))
    mark = bpy.data.materials.get("Groove_Mark") or bpy.data.materials.new("Groove_Mark")
    boolean(cover, cutters, mark=mark)
    shade_part(cover)
    groove_shading(cover, mark)
    return cover


def glyph_loops(d):
    loops = []
    for line in svg_polylines(d, curve_steps=10):
        pts, _ = clean_polyline([px(*p) for p in line])
        if len(pts) >= 3:
            loops.append([(p.x, p.y) for p in pts])
    return loops


def build_lettering(coll, m):
    objs = []
    for i, glyph in enumerate(LETTERING["glyphs"]):
        loops = glyph_loops(glyph["d"])
        if not loops:
            continue
        obj = outline_prism(f"letter_{i}", loops[0], loops[1:], FACE + LETTER_RELIEF, FACE - LETTER_RELIEF,
                            m["Frosted_Polymer"], coll, bevel=LETTER_BEVEL, bevel_steps=3, offset=-LETTER_BEVEL)
        objs.append(obj)
    merged = join_objects(objs, "cover__Lettering")
    shade_part(merged, smooth_angle=35)
    return paint_white(merged)


def join_objects(objs, name):
    meshes = []
    for obj in objs:
        mesh = obj.data.copy()
        mesh.transform(obj.matrix_world)
        meshes.append(mesh)
    material = objs[0].data.materials[0] if objs[0].data.materials else None
    merged = merge_meshes(meshes, name, material)
    coll = objs[0].users_collection[0]
    for obj in objs:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)
    out = bpy.data.objects.new(name, merged)
    coll.objects.link(out)
    return out


def domed_screw(cx, cz, lod=False):
    head_r = DESIGN["screw"]["head"] * K
    base = FACE + SEAT_DEPTH
    to_card = Matrix.Translation((cx, base, cz)) @ Matrix.Rotation(math.radians(90), 4, "X")
    top = 0.0042 + 0.02
    if lod:
        profile = [(0.0, 0.0), (head_r, 0.0), (head_r, 0.0042 + 0.006), (head_r * 0.9, 0.0042 + 0.0135),
                   (head_r * 0.6, 0.0042 + 0.0185), (0.0, top)]
        return nb.transform(nb.revolve(profile, segments=48), to_card), None
    head = nb.revolve([(0.0, 0.0), (head_r, 0.0), (head_r, 0.0042 + 0.006), (head_r * 0.97, 0.0042 + 0.0105),
                       (head_r * 0.86, 0.0042 + 0.0148), (head_r * 0.62, 0.0042 + 0.0185), (head_r * 0.42, top - 0.0004),
                       (head_r * 0.3, top), (0.0, top)], segments=96)
    head = nb.transform(head, to_card)
    hexr = head_r * 0.46
    hexagon = [(hexr * math.cos(math.radians(30 + 60 * k)), hexr * math.sin(math.radians(30 + 60 * k))) for k in range(6)]
    y_top, y_bottom = base - top - 0.0003, base - top + 0.004
    socket_v = [(cx + hx, y_top, cz + hz) for hx, hz in hexagon] + [(cx + hx, y_bottom, cz + hz) for hx, hz in hexagon]
    socket_f = [tuple(range(0, 6)), tuple(reversed(range(6, 12)))] + [(k, 6 + k, 6 + (k + 1) % 6, (k + 1) % 6) for k in range(6)]
    return head, orient_toward((socket_v, socket_f))


def build_window_prints(add, m):
    front = PANE[0]
    lx, ly, lw, lh = DESIGN["label"]
    (lx0, lz0), (lx1, lz1) = px(lx, ly + lh), px(lx + lw, ly)
    plate = nb.box((lx1 - lx0, front - LABEL_FRONT + 0.001, lz1 - lz0),
                   ((lx0 + lx1) / 2, (front + 0.001 + LABEL_FRONT) / 2, (lz0 + lz1) / 2))
    round_box(add("Printed_Label", plate, name="cover__Label_Plate"), 0.0012)
    ticks = []
    for x, y, w, h in DESIGN["ticks"]:
        loop = rounded_rect_px(x, y, w, h, 2.5)
        ticks.append(loop)
    for i, loop in enumerate(ticks):
        tick = outline_prism(f"cover__Tick{i}", loop, [], front + 0.0004, front - 0.0012, m["Champagne_Index"],
                             m["_coll"], bevel=0.0003, bevel_steps=1, offset=-0.0003)
        add("Champagne_Index", None, obj=tick)
    s = DESIGN["stripes"]
    dark, light = [], []
    for i in range(s["count"]):
        x = s["x"] + i * s["step"]
        path = [(x, s["bottom"]), (x + s["rise"], s["top"]), (x + s["rise"] + s["cap"], s["top"])]
        light.append(ink_line(path, 3.4, front - INK, offset_px=(1.2, 1.2)))
        dark.append(ink_line(path, 3.4, front - 2 * INK))
        dx, dy, dr = s["dot"]
        light.append(ink_disc(x + dx + 1.2, dy + 1.2, dr, front - INK))
        dark.append(ink_disc(x + dx, dy, dr, front - 2 * INK))
    dial = DESIGN["dial"]
    cxp, cyp = dial["center"]
    for d in dial["arcs"]:
        for line in svg_polylines(shift_path(d, cxp, cyp)):
            light.append(ink_line(line, 1.5, front - INK, offset_px=(1.2, 1.3)))
            dark.append(ink_line(line, 1.8, front - 2 * INK))
    dark.append(ink_line(circle_px(cxp, cyp, dial["ring"]), 1.8, front - 2 * INK, caps=False))
    dot = ink_disc(cxp, cyp, dial["dot"], front - 3 * INK)
    add("Printed_Label", orient_toward(dot), name="cover__Dial_Dot")
    dark.append(ink_line(circle_px(cxp, cyp, dial["dot"]), 1.4, front - 4 * INK, caps=False))
    add("Case_Engraving", orient_toward(nb.merge(dark)), name="cover__Ink")
    add("Case_Engraving_Highlight", orient_toward(nb.merge(light)), name="cover__Ink_Light")


def build_plan(coll, m):
    plan = DESIGN["plan"]
    scale = plan["pxPerUnit"] * K
    ox, oy = plan["origin"]
    cx, cz = px(ox, oy)
    to_card = Matrix((
        (scale, 0, 0, cx),
        (0, 0, -scale * SQUASH, DIFFUSER[0]),
        (0, scale, 0, cz),
        (0, 0, 0, 1),
    ))
    temp = nb.collection("PlanTemp")
    mats = {
        "body": m["Subsurface_Optics"],
        "ribbon": m["Optical_Film"],
        "orange": m["Amber_Optical_Inlay"],
        "line": m["Plan_Hairline"],
    }
    root = nb.empty("PlanRoot", coll=temp)
    big = nb.empty("BigReel", parent=root, coll=temp)
    small = nb.empty("SmallReel", parent=root, coll=temp, location=(*rd.P["small"]["center"], 0))
    ribbon = nb.empty("Ribbon", parent=root, coll=temp)
    rd.build_big(big, mats, temp)
    B = rd.P["big"]
    oa0, oa1 = B["orange_bottom"]
    z1 = B["base"][3]
    top = B["rim"][3] - B["rim_round"]
    nb.mesh_object("Big_OrangeTop", nb.revolve(rd.rect(0.957, B["base"][1] + 0.001, z1, top),
                                               a0=math.radians(oa0), a1=math.radians(oa1), segments=P_SEGMENTS),
                   mats["orange"], parent=big, coll=temp, props={"role": "orange", "reel": "big", "edgeAngle": 40})
    rd.build_small(small, mats, temp)
    rd.build_ribbon(ribbon, mats, temp)
    bpy.context.view_layer.update()

    groups = {}
    edge_parts = []
    for obj in list(temp.objects):
        if obj.type != "MESH":
            continue
        role = obj.get("role", "body")
        if role == "orange":
            surface = "Amber_Optical_Inlay"
        elif role == "ribbon":
            surface = "Optical_Film"
        else:
            surface = "Subsurface_Optics"
        mesh = obj.data.copy()
        mesh.transform(to_card @ obj.matrix_world)
        if to_card.determinant() * obj.matrix_world.determinant() < 0:
            mesh.flip_normals()
        if surface == "Subsurface_Optics":
            grey = REEL_GREYS.get(obj.name.split(".")[0], "#c4c3c1")
            paint(mesh, nb.hex_color(grey))
        groups.setdefault(surface, []).append(mesh)
        if obj.get("edges", 1) != 0 and role not in ("rib",):
            edge_parts.append(feature_bands(mesh, float(obj.get("edgeAngle", 30))))
    pieces = []
    for surface, meshes in groups.items():
        merged = merge_meshes(meshes, f"{PARTS[surface]}__{surface}__plan", m[surface])
        obj = bpy.data.objects.new(merged.name, merged)
        coll.objects.link(obj)
        pieces.append((surface, obj))
    bands = nb.mesh_object("optical-core__Plan_Hairline__edges", nb.merge(edge_parts), m["Plan_Hairline"], coll=coll,
                           smooth_angle=5)
    pieces.append(("Plan_Hairline", bands))

    window = [p for line in svg_polylines(DESIGN["window"], curve_steps=4) for p in line]
    bounds = (min(p[0] for p in window) + 6, min(p[1] for p in window) + 6,
              max(p[0] for p in window) - 6, max(p[1] for p in window) - 6)
    strips = []
    for line in rd.plan_polylines():
        pts = [(ox + x * plan["pxPerUnit"], oy - y * plan["pxPerUnit"]) for x, y in line]
        for piece in clip_polyline(pts, bounds):
            strips.append(ink_line(piece, HAIRLINE, DIFFUSER[0] - 0.0006, caps=False))
    lines = nb.mesh_object("substrate__Plan_Hairline", orient_toward(nb.merge(strips)), m["Plan_Hairline"], coll=coll)
    pieces.append(("Plan_Hairline", lines))

    for obj in list(temp.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(temp)
    return pieces


def paint(mesh, color):
    attr = mesh.color_attributes.get("Color") or mesh.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for item in attr.data:
        item.color = color
    return mesh


def feature_bands(mesh, angle_deg, width_px=HAIRLINE, lift=0.0004):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.normal_update()
    limit = math.radians(angle_deg)
    width = width_px * K
    out = Vector((0, -1, 0))
    verts, faces = [], []
    for e in bm.edges:
        linked = e.link_faces
        if len(linked) == 2 and linked[0].normal.angle(linked[1].normal, 0.0) <= limit:
            continue
        if not linked:
            continue
        face = max(linked, key=lambda f: f.normal.dot(out))
        if face.normal.dot(out) < 0.35:
            continue
        a, b = e.verts[0].co.copy(), e.verts[1].co.copy()
        along = b - a
        if along.length < 1e-9:
            continue
        inward = face.normal.cross(along).normalized()
        if inward.dot(face.calc_center_median() - (a + b) / 2) < 0:
            inward = -inward
        lift_v = face.normal * lift
        base = len(verts)
        verts += [tuple(a + lift_v), tuple(b + lift_v), tuple(b + lift_v + inward * width), tuple(a + lift_v + inward * width)]
        quad = (base, base + 1, base + 2, base + 3)
        n = (Vector(verts[base + 1]) - Vector(verts[base])).cross(Vector(verts[base + 3]) - Vector(verts[base]))
        faces.append(quad if n.dot(face.normal) >= 0 else tuple(reversed(quad)))
    bm.free()
    return verts, faces


def clip_polyline(points, rect):
    x0, y0, x1, y1 = rect
    pieces, current = [], []
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        dx, dy = bx - ax, by - ay
        t0, t1 = 0.0, 1.0
        ok = True
        for p, q in ((-dx, ax - x0), (dx, x1 - ax), (-dy, ay - y0), (dy, y1 - ay)):
            if abs(p) < 1e-12:
                if q < 0:
                    ok = False
                    break
                continue
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
        if not ok or t0 > t1:
            if len(current) > 1:
                pieces.append(current)
            current = []
            continue
        start = (ax + dx * t0, ay + dy * t0)
        end = (ax + dx * t1, ay + dy * t1)
        if not current or abs(current[-1][0] - start[0]) > 1e-6 or abs(current[-1][1] - start[1]) > 1e-6:
            if len(current) > 1:
                pieces.append(current)
            current = [start]
        current.append(end)
        if t1 < 1.0:
            pieces.append(current)
            current = []
    if len(current) > 1:
        pieces.append(current)
    return pieces


def merge_meshes(meshes, name, material):
    bm = bmesh.new()
    for mesh in meshes:
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    if "Color" in out.color_attributes:
        out.color_attributes.active_color_name = "Color"
        out.color_attributes.default_color_name = "Color"
    if material is not None:
        out.materials.append(material)
    for poly in out.polygons:
        poly.material_index = 0
    return out


def build_card(coll):
    m = materials()
    m["_coll"] = coll
    pieces = []

    def add(surface, geometry, name=None, obj=None, smooth_angle=30):
        if obj is None:
            obj = nb.mesh_object(name or f"{PARTS[surface]}__{surface}", geometry, m[surface], coll=coll,
                                 smooth_angle=smooth_angle)
        pieces.append((surface, obj))
        return obj

    x0, x1 = -WIDTH / 2, WIDTH / 2
    chamfer = DESIGN["chamfer"] * K
    window = window_loop()

    add("Frosted_Polymer", None, obj=build_frame(coll, m))
    add("Frosted_Polymer", None, obj=build_lettering(coll, m))
    pane = outline_prism("cover__Optical_Window", shrink(window, 0.0005), [], PANE[0], PANE[1], m["Optical_Window"], coll)
    add("Optical_Window", None, obj=shade_part(pane))
    build_window_prints(add, m)

    tray = chamfered_rect(x0 + 0.004, 0.004, x1 - 0.004, HEIGHT - 0.004, chamfer)
    frame = outline_prism("carrier__Ivory_Edges", tray, [window], COVER_BACK, TRAY_BACK - 0.03, m["Ivory_Edges"], coll)
    bevel_loops(frame, [(tray, COVER_BACK, *ROUND_SEAM)])
    add("Ivory_Edges", None, obj=shade_part(frame))
    back = outline_prism("carrier__Ivory_Back", tray, [], TRAY_BACK - 0.03, TRAY_BACK, m["Ivory_Edges"], coll)
    bevel_loops(back, [(tray, TRAY_BACK, *ROUND_BACK)])
    add("Ivory_Edges", None, obj=shade_part(back))
    lining = outline_prism("carrier__Optical_Edges", window, [shrink(window, 0.012)], COVER_BACK + 0.002, DIFFUSER[0],
                           m["Optical_Edges"], coll)
    add("Optical_Edges", None, obj=shade_part(lining))

    diffuser = outline_prism("substrate__Optical_Diffuser", shrink(window, 0.012), [], DIFFUSER[0], DIFFUSER[1],
                             m["Optical_Diffuser"], coll)
    cutters = []
    for g in DESIGN["site"]:
        for line in svg_polylines(g["d"]):
            cutters.append(v_groove(line, DIFFUSER[0], width_px=GROOVE_WIDTH * (0.55 + 0.45 * g["strength"]),
                                    depth_px=GROOVE_DEPTH * (0.5 + 0.5 * g["strength"]), into=1.0))
    mark = bpy.data.materials.get("Groove_Mark") or bpy.data.materials.new("Groove_Mark")
    boolean(diffuser, cutters, mark=mark)
    shade_part(diffuser)
    add("Optical_Diffuser", None, obj=groove_shading(diffuser, mark))

    bx, by, bw, bh = DESIGN["beige"]
    (ix0, iz0), (ix1, iz1) = px(bx, by + bh), px(bx + bw, by)
    block = nb.box((ix1 - ix0, (TRAY_BACK - 0.03) - (FACE - 0.008), (HEIGHT + 0.012) - iz0),
                   ((ix0 + ix1) / 2, ((FACE - 0.008) + (TRAY_BACK - 0.03)) / 2, (iz0 + HEIGHT + 0.012) / 2))
    round_box(add("Index_Inlay", block), 0.006)

    heads, sockets = [], []
    for cx, cz in screw_centers():
        head, socket = domed_screw(cx, cz)
        heads.append(head)
        sockets.append(socket)
    add("Titanium_Fasteners", nb.merge(heads), smooth_angle=40)
    add("Fastener_Socket", nb.merge(sockets))

    pieces += build_plan(coll, m)
    return pieces, m


def build_lod(coll, m, detail):
    pieces = []
    x0, x1 = -WIDTH / 2, WIDTH / 2
    chamfer = DESIGN["chamfer"] * K
    outer = chamfered_rect(x0, 0.0, x1, HEIGHT, chamfer)
    cover = outline_prism("lod__Frosted_Polymer", outer, [], FACE, COVER_BACK, m["Frosted_Polymer"], coll)
    bevel_loops(cover, [(outer, FACE, *ROUND_FACE), (outer, COVER_BACK, *ROUND_SEAM)])
    pieces.append(("Frosted_Polymer", shade_part(cover)))
    tray = chamfered_rect(x0 + 0.004, 0.004, x1 - 0.004, HEIGHT - 0.004, chamfer)
    body = outline_prism("lod__Ivory_Edges", tray, [], COVER_BACK, TRAY_BACK, m["Ivory_Edges"], coll)
    bevel_loops(body, [(tray, COVER_BACK, *ROUND_SEAM), (tray, TRAY_BACK, *ROUND_BACK)])
    pieces.append(("Ivory_Edges", shade_part(body)))
    window = window_loop()
    shadow = outline_prism("lod__Optical_Diffuser", shrink(window, 0.012), [], DIFFUSER[0], DIFFUSER[1],
                           m["Optical_Diffuser"], coll)
    pieces.append(("Optical_Diffuser", shade_part(shadow)))
    heads = [domed_screw(cx, cz, lod=True)[0] for cx, cz in screw_centers()]
    screws = nb.mesh_object("lod__Titanium_Fasteners", nb.merge(heads), m["Titanium_Fasteners"], coll=coll, smooth_angle=40)
    pieces.append(("Titanium_Fasteners", screws))
    for surface, obj in detail:
        if surface == "Index_Inlay" or obj.name == "cover__Label_Plate":
            copy = obj.copy()
            copy.data = obj.data.copy()
            copy.name = "lod__" + obj.name
            coll.objects.link(copy)
            pieces.append((surface, copy))
    return pieces


def render_face(detail, path, size=FACE_TEXTURE, samples=64):
    scene = bpy.context.scene
    hidden = []
    for surface, obj in detail:
        if surface in ("Optical_Window", "Index_Inlay", "Titanium_Fasteners", "Fastener_Socket"):
            obj.hide_render = True
            hidden.append(obj)
    world = nb.set_world("#ffffff", AMBIENT)
    sun = bpy.data.lights.new("FaceKey", "SUN")
    direction = Vector((0.55, 0.62, -0.56)).normalized()
    cos_face = Vector((0, -1, 0)).dot(-direction)
    sun.energy = (1.0 - AMBIENT) * math.pi / cos_face
    sun.angle = math.radians(6)
    sun.use_shadow = False
    sun_obj = bpy.data.objects.new("FaceKey", sun)
    sun_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun_obj)
    cam = bpy.data.cameras.new("FaceCam")
    cam.type = "ORTHO"
    cam.ortho_scale = WIDTH
    cam.sensor_fit = "HORIZONTAL"
    cam.clip_start = 0.01
    cam.clip_end = 20
    cam_obj = bpy.data.objects.new("FaceCam", cam)
    cam_obj.location = (0.0, -5.0, HEIGHT / 2)
    cam_obj.rotation_euler = (math.radians(90), 0.0, 0.0)
    scene.collection.objects.link(cam_obj)
    nb.setup_render(scene, *size, samples=samples)
    scene.render.filter_size = 1.0
    scene.render.dither_intensity = 0.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.eevee.use_fast_gi = False
    scene.camera = cam_obj
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[nmk] card face {size[0]}×{size[1]} → {path} (sun cos {cos_face:.3f})")
    for obj in hidden:
        obj.hide_render = False
    bpy.data.objects.remove(sun_obj, do_unlink=True)
    bpy.data.objects.remove(cam_obj, do_unlink=True)
    normalize_face(path)
    return path


def normalize_face(path):
    import numpy as np
    image = bpy.data.images.load(path, check_existing=False)
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)
    to_linear = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    to_srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0.0), 1 / 2.4) - 0.055)
    linear = to_linear(pixels[..., :3])
    samples = []
    for x, y in ((166, 330), (166, 1000), (1575, 600), (1575, 800), (700, 1060), (1000, 1060), (700, 100), (1300, 95)):
        col = int((x - BOX_X) / BOX_W * w)
        row = h - 1 - int((y - BOX_Y) / BOX_H * h)
        patch = linear[row - 4:row + 5, col - 4:col + 5].reshape(-1, 3)
        samples.append(np.median(patch, axis=0))
    measured = np.mean(samples, axis=0)
    target = np.array(nb.hex_color(SURFACES["Frosted_Polymer"][0])[:3])
    scale = target / np.maximum(measured, 1e-6)
    pixels[..., :3] = np.clip(to_srgb(linear * scale), 0.0, 1.0)
    image.pixels.foreach_set(pixels.ravel())
    out = os.path.splitext(path)[0] + ".webp"
    settings = bpy.context.scene.render.image_settings
    settings.file_format = "WEBP"
    settings.color_mode = "RGB"
    settings.quality = 100
    image.save_render(out, scene=bpy.context.scene)
    bpy.data.images.remove(image)
    if os.path.abspath(out) != os.path.abspath(path):
        os.remove(path)
    print(f"[nmk] card face normalised: measured {np.round(measured, 4)} → target {np.round(target, 4)} "
          f"(× {np.round(scale, 4)}) → {out} ({os.path.getsize(out) / 1e6:.2f} MB)")


def export_glb(pieces, coll, path, *, by_part):
    buckets = {}
    for surface, obj in pieces:
        key = (PARTS[surface], surface) if by_part else surface
        buckets.setdefault(key, []).append(obj)
    created = []
    for key, objs in buckets.items():
        meshes = []
        for obj in objs:
            mesh = obj.data.copy()
            mesh.transform(obj.matrix_world)
            meshes.append(mesh)
        surface = key[1] if by_part else key
        name = f"{key[0]}__{key[1]}" if by_part else key
        mesh = merge_meshes(meshes, name, bpy.data.materials[surface])
        obj = bpy.data.objects.new(name, mesh)
        coll.objects.link(obj)
        if by_part:
            obj["assemblyPart"] = key[0]
        created.append(obj)
    nb.export_glb(path, created, compress=False)
    for obj in created:
        bpy.data.objects.remove(obj, do_unlink=True)


def stats(pieces):
    tris = 0
    for _, obj in pieces:
        mesh = obj.data
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
    return tris


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = os.path.join(ROOT, "src", "landing", "models")
    face = os.path.join(ROOT, "src", "landing", "models", "archive-card-face.png")
    render_dir = blend = None
    make_face = True
    for i, arg in enumerate(argv):
        if arg == "--out":
            out_dir = argv[i + 1]
        elif arg == "--face":
            face = argv[i + 1]
        elif arg == "--no-face":
            make_face = False
        elif arg == "--render":
            render_dir = argv[i + 1]
        elif arg == "--blend":
            blend = argv[i + 1]
    scene = nb.reset_scene()
    coll = nb.collection("ArchiveCard")
    lod_coll = nb.collection("ArchiveCardLOD")
    detail, m = build_card(coll)
    lod = build_lod(lod_coll, m, detail)
    print(f"[nmk] card {WIDTH} × {HEIGHT:.4f}: detail {len(detail)} pieces / {stats(detail)} tris, "
          f"lod {len(lod)} pieces / {stats(lod)} tris")
    export_glb(detail, coll, os.path.join(out_dir, "archive-assembly.glb"), by_part=True)
    export_glb(lod, lod_coll, os.path.join(out_dir, "archive-cassette.glb"), by_part=False)
    lod_coll.hide_render = True
    for obj in lod_coll.objects:
        obj.hide_render = True
    if make_face:
        render_face(detail, face)
    if blend:
        nb.save_blend(blend)
    if render_dir:
        preview(scene, detail, render_dir)


def preview(scene, detail, render_dir):
    os.makedirs(render_dir, exist_ok=True)
    for surface, obj in detail:
        if surface == "Optical_Window":
            obj.hide_render = True
    nb.set_world("#E9E5E0", 0.7)
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 2.2
    sun.angle = math.radians(8)
    sun_obj = bpy.data.objects.new("Sun", sun)
    sun_obj.rotation_euler = Vector((0.55, 0.62, -0.56)).normalized().to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun_obj)
    cam = bpy.data.cameras.new("Front")
    cam.type = "PERSP"
    cam.lens = 85
    obj = bpy.data.objects.new("Front", cam)
    scene.collection.objects.link(obj)
    obj.location = (3.2, -11.5, HEIGHT / 2 + 3.0)
    nb.look_at(obj, (0.2, 0, HEIGHT / 2))
    scene.render.filter_size = 1.0
    nb.render_still(scene, obj, os.path.join(render_dir, "card_oblique.png"), 2400, 1600)
    obj.location = (-1.6, -6.0, HEIGHT / 2 + 1.2)
    nb.look_at(obj, (-1.2, 0, HEIGHT / 2 + 0.9))
    nb.render_still(scene, obj, os.path.join(render_dir, "card_closeup.png"), 2400, 1600)


if __name__ == "__main__":
    main()
