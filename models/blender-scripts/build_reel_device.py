import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import blender_helpers as nb

TAU = math.tau
DEG = math.pi / 180

P = {
    "colors": {
        "body": "#B9B9B9",
        "orange": "#D9772B",
        "background": "#E9E5E0",
        "line": "#FFFFFF",
        "grid": "#AAA6A1",
    },
    "alpha": 0.45,
    "roughness": 0.6,
    "segments": {"big": 384, "small": 256},

    "big": {
        "center": (0.0, 0.0),
        "hole": 0.545,
        "height": 0.30,
        "base": (0.58, 0.995, 0.000, 0.040),
        "base_edge": 0.94,
        "colonnade": (0.60, 0.90, 0.040, 0.140),
        "ribs": {"count": 144, "r0": 0.900, "r1": 0.926, "width": 0.011, "z0": 0.046, "z1": 0.134},
        "middle": (0.585, 0.935, 0.140, 0.195),
        "tread": (0.645, 0.905, 0.195, 0.255),
        "tread_cuts": [98.0, 158.0, 214.0, 287.0, 338.0, 38.0],
        "tread_gap": 0.5,
        "rim": (0.865, 0.955, 0.225, 0.300),
        "rim_round": 0.035,
        "rim_notches": [(172.0, 1.6), (191.0, 1.6)],
        "collar": (0.545, 0.645, 0.020, 0.270),
        "collar_chamfer": (0.600, 0.225),
        "orange_inner": (112.0, 224.0),
        "orange_inner_z0": 0.120,
        "orange_bottom": (-126.0, 4.0),
        "orange_bands": [(0.004, 0.014), (0.016, 0.026), (0.028, 0.038)],
    },

    "small": {
        "center": (1.666, 0.647),
        "height": 0.215,
        "base": (0.19, 0.575, 0.000, 0.035),
        "tier": (0.20, 0.590, 0.035, 0.075),
        "body": (0.35, 0.605, 0.075, 0.160),
        "rim": (0.53, 0.615, 0.140, 0.215),
        "rim_round": 0.03,
        "step": (0.25, 0.355, 0.075, 0.125),
        "hub": (0.185, 0.255, 0.035, 0.165),
        "orange_ring": (0.255, 0.350, 0.125, 0.134),
        "orange_wall": (0.345, 0.3505, 0.126, 0.160),
        "orange_side": [(0.575, 0.010, 0.027), (0.590, 0.045, 0.064)],
    },

    "ribbon": {
        "width": 0.25,
        "thickness": 0.004,
        "big_wrap": (225.0, 306.0),
        "big_radius": 1.10,
        "big_z": 0.15,
        "bridge": [(0.98, -0.80, 0.150), (1.22, -0.56, 0.165), (1.30, -0.20, 0.190)],
        "small_arrive": 222.0,
        "small_radius": (0.625, 0.600),
        "small_z": (0.224, 0.240),
        "turns": 1.0,
        "bank": 0.22,
        "samples": 640,
    },

    "plan": {
        "boundaries": [
            [(-0.983, 1.95), (-0.983, -1.10), (1.066, -1.10)],
            [(0.882, 1.95), (0.882, 1.212), (2.398, 1.212), (2.398, -0.704), (1.066, -0.704), (1.066, -1.60)],
        ],
        "circles": [((0.0, 0.0), 1.04), ((1.666, 0.647), 0.66)],
        "belt": ((0.0, 0.0), 1.0, (1.666, 0.647), 0.635),
    },

    "cameras": {
        "plan": {"center": (0.520, 0.210), "width": 5.03, "aspect": 2978 / 1516},
        "oblique": {"target": (0.5049, 0.1697, 0.0), "azimuth": 119.419, "elevation": 34.886,
                    "distance": 10.504, "lens": 78.0, "aspect": 2992 / 1552},
    },

    "grid": {"cell": 0.22, "line": 0.02},

    "card": {"center": (0.457, 0.030), "width": 5.48, "height": 5.48 / 1.5},
}


def rect(r_in, r_out, z0, z1):
    return [(r_in, z0), (r_out, z0), (r_out, z1), (r_in, z1)]


def arc_segments(cuts_deg, gap_deg):
    cuts = sorted(c % 360 for c in cuts_deg)
    out = []
    for i, c in enumerate(cuts):
        nxt = cuts[(i + 1) % len(cuts)] + (360 if i + 1 == len(cuts) else 0)
        out.append(((c + gap_deg / 2) * DEG, (nxt - gap_deg / 2) * DEG))
    return out


def arc_complement(ranges_deg, a0_deg=0.0):
    ranges = sorted(((a % 360), (a % 360) + (b - a)) for a, b in ranges_deg)
    out = []
    start = ranges[0][1]
    for i in range(len(ranges)):
        nxt = ranges[(i + 1) % len(ranges)][0] + (360 if i + 1 == len(ranges) else 0)
        if nxt - start > 1e-6:
            out.append((start * DEG, nxt * DEG))
        start = ranges[(i + 1) % len(ranges)][1] + (360 if i + 1 == len(ranges) else 0)
    return out


def build_big(parent, m, coll):
    B = P["big"]
    seg = P["segments"]["big"]
    body = lambda name, part, **kw: nb.mesh_object(name, part, m["body"], parent=parent, coll=coll,
                                                    props={"role": "body", "reel": "big", **kw.pop("props", {})}, **kw)
    r_in, r_out, z0, z1 = B["base"]
    body("Big_Base", nb.revolve(rect(r_in, B["base_edge"], z0, z1), segments=seg))
    oa0, oa1 = B["orange_bottom"]
    for a0, a1 in arc_complement([(oa0, oa1)]):
        body("Big_BaseEdge", nb.revolve(rect(B["base_edge"], r_out, z0, z1), a0=a0, a1=a1, segments=seg))
    bands = [nb.revolve(rect(B["base_edge"], r_out + 0.002, b0, b1), a0=oa0 * DEG, a1=oa1 * DEG, segments=seg)
             for b0, b1 in B["orange_bands"]]
    nb.mesh_object("Big_OrangeBottom", nb.merge(bands), m["orange"], parent=parent, coll=coll,
                   props={"role": "orange", "reel": "big"})
    gaps = []
    edges_z = [z0] + [v for band in B["orange_bands"] for v in band] + [z1]
    for k in range(0, len(edges_z) - 1, 2):
        g0, g1 = edges_z[k], edges_z[k + 1]
        if g1 - g0 > 1e-4:
            gaps.append(nb.revolve(rect(B["base_edge"], r_out, g0, g1), a0=oa0 * DEG, a1=oa1 * DEG, segments=seg))
    if gaps:
        body("Big_OrangeBottomGaps", nb.merge(gaps), props={"edges": 0})

    body("Big_Colonnade", nb.revolve(rect(*B["colonnade"]), segments=seg))
    rib = B["ribs"]
    ribs = []
    for i in range(rib["count"]):
        a = TAU * (i + 0.5) / rib["count"]
        r_mid = (rib["r0"] + rib["r1"]) / 2
        ribs.append(nb.box((rib["r1"] - rib["r0"], rib["width"], rib["z1"] - rib["z0"]),
                           (r_mid * math.cos(a), r_mid * math.sin(a), (rib["z0"] + rib["z1"]) / 2), a))
    nb.mesh_object("Big_Ribs", nb.merge(ribs), m["body"], parent=parent, coll=coll,
                   props={"role": "rib", "reel": "big", "edges": 0})

    body("Big_Middle", nb.revolve(rect(*B["middle"]), segments=seg))

    tread = rect(*B["tread"])
    parts = [nb.revolve(tread, a0=a0, a1=a1, segments=seg) for a0, a1 in arc_segments(B["tread_cuts"], B["tread_gap"])]
    body("Big_Tread", nb.merge(parts))

    r_in, r_out, z0, z1 = B["rim"]
    rim_profile = nb.ring_profile(r_in, r_out, z0, z1, top_round=B["rim_round"], round_steps=8)
    notches = [(c - w / 2, c + w / 2) for c, w in B["rim_notches"]]
    parts = [nb.revolve(rim_profile, a0=a0, a1=a1, segments=seg) for a0, a1 in arc_complement(notches)]
    body("Big_Rim", nb.merge(parts), props={"edgeAngle": 40})

    r_in, r_out, z0, z1 = B["collar"]
    cr, cz = B["collar_chamfer"]
    collar = [(r_in, z0), (r_out, z0), (r_out, z1), (cr, z1), (r_in, cz)]
    body("Big_Collar", nb.revolve(collar, segments=seg))

    t = 0.004
    zb = B["orange_inner_z0"]
    dr, dz = cr - r_in, z1 - cz
    length = math.hypot(dr, dz)
    nr, nz = -dz / length, dr / length
    inner_arc = [
        (r_in - t, zb), (r_in + 0.0005, zb), (r_in + 0.0005, cz),
        (cr + 0.0005 * nr, z1 + 0.0005 * nz), (cr + t * nr, z1 + t * nz), (r_in - t, cz + t * nz),
    ]
    a0, a1 = B["orange_inner"]
    nb.mesh_object("Big_OrangeInner", nb.revolve(inner_arc, a0=a0 * DEG, a1=a1 * DEG, segments=seg), m["orange"],
                   parent=parent, coll=coll, props={"role": "orange", "reel": "big"})


def build_small(parent, m, coll):
    S = P["small"]
    seg = P["segments"]["small"]
    body = lambda name, part, **kw: nb.mesh_object(name, part, m["body"], parent=parent, coll=coll,
                                                    props={"role": "body", "reel": "small", **kw.pop("props", {})}, **kw)
    body("Small_Base", nb.revolve(rect(*S["base"]), segments=seg))
    body("Small_Tier", nb.revolve(rect(*S["tier"]), segments=seg))
    body("Small_Body", nb.revolve(rect(*S["body"]), segments=seg))
    r_in, r_out, z0, z1 = S["rim"]
    body("Small_Rim", nb.revolve(nb.ring_profile(r_in, r_out, z0, z1, top_round=S["rim_round"], round_steps=8), segments=seg),
         props={"edgeAngle": 40})
    body("Small_Step", nb.revolve(rect(*S["step"]), segments=seg))
    body("Small_Hub", nb.revolve(rect(*S["hub"]), segments=seg))
    r0, r1, z0, z1 = S["orange_ring"]
    orange = [nb.revolve(rect(r0, r1, z0, z1), segments=seg)]
    for r, b0, b1 in S["orange_side"]:
        orange.append(nb.revolve(rect(r - 0.0005, r + 0.004, b0, b1), segments=seg))
    w0, w1, wz0, wz1 = S["orange_wall"]
    orange.append(nb.revolve(rect(w0 - 0.004, w1, wz0, wz1), segments=seg))
    nb.mesh_object("Small_Orange", nb.merge(orange), m["orange"], parent=parent, coll=coll,
                   props={"role": "orange", "reel": "small"})


def ribbon_path():
    R = P["ribbon"]
    big_c = Vector((*P["big"]["center"], 0))
    small_c = Vector((*P["small"]["center"], 0))
    points, twist = [], []
    a0, a1 = R["big_wrap"]
    steps = 8
    for k in range(steps + 1):
        a = (a0 + (a1 - a0) * k / steps) * DEG
        points.append(big_c + Vector((math.cos(a), math.sin(a), 0)) * R["big_radius"] + Vector((0, 0, R["big_z"])))
        twist.append(0.0)
    for (x, y, z), bank in zip(R["bridge"], (R["bank"] * 0.5, R["bank"], R["bank"] * 0.6)):
        points.append(Vector((x, y, z)))
        twist.append(bank)
    r0, r1 = R["small_radius"]
    z0, z1 = R["small_z"]
    steps = 18
    for k in range(steps + 1):
        f = k / steps
        a = (R["small_arrive"] - 360.0 * R["turns"] * f) * DEG
        r = r0 + (r1 - r0) * f
        points.append(small_c + Vector((math.cos(a), math.sin(a), 0)) * r + Vector((0, 0, z0 + (z1 - z0) * f)))
        twist.append(0.0)
    return points, twist


def build_ribbon(parent, m, coll):
    R = P["ribbon"]
    points, twist = ribbon_path()
    curve = nb.CatmullRom(points)
    n = R["samples"]
    samples = curve.spaced_points(n)
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total_ctrl = lengths[-1]
    dense = [0.0]
    for a, b in zip(samples, samples[1:]):
        dense.append(dense[-1] + (b - a).length)
    total = dense[-1]

    def twist_at(u):
        target = u * total_ctrl
        for i in range(len(lengths) - 1):
            if lengths[i + 1] >= target:
                k = (target - lengths[i]) / max(1e-9, lengths[i + 1] - lengths[i])
                k = k * k * (3 - 2 * k)
                return twist[i] + (twist[i + 1] - twist[i]) * k
        return twist[-1]

    up = Vector((0, 0, 1))
    half_w, half_t = R["width"] / 2, R["thickness"] / 2
    verts, faces = [], []
    for i, p in enumerate(samples):
        prev = samples[max(0, i - 1)]
        nxt = samples[min(n, i + 1)]
        tangent = (nxt - prev).normalized()
        side = tangent.cross(up).normalized()
        k = twist_at(dense[i] / total)
        width_dir = (side * math.cos(k * math.pi / 2) + up * math.sin(k * math.pi / 2)).normalized()
        normal = tangent.cross(width_dir).normalized()
        for sw, st in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(tuple(p + width_dir * (sw * half_w) + normal * (st * half_t)))
    for i in range(n):
        a, b = i * 4, (i + 1) * 4
        for j in range(4):
            j2 = (j + 1) % 4
            faces.append((a + j, a + j2, b + j2, b + j))
    faces.append((3, 2, 1, 0))
    last = n * 4
    faces.append((last, last + 1, last + 2, last + 3))
    obj = nb.mesh_object("Ribbon", (verts, faces), m["ribbon"], parent=parent, coll=coll,
                         props={"role": "ribbon", "edgeAngle": 60}, smooth_angle=60)
    obj["path"] = [round(c, 5) for p in points for c in p]
    obj["twist"] = [round(t, 3) for t in twist]
    return obj


def circle(center, r, count=256, z=0.0):
    return [(center[0] + r * math.cos(TAU * i / count), center[1] + r * math.sin(TAU * i / count), z) for i in range(count + 1)]


def outer_tangents(c1, r1, c2, r2):
    c1, c2 = Vector((*c1, 0)), Vector((*c2, 0))
    d = c2 - c1
    base = math.atan2(d.y, d.x)
    offset = math.acos((r1 - r2) / d.length)
    lines = []
    for a in (base + offset, base - offset):
        n = Vector((math.cos(a), math.sin(a), 0))
        lines.append([tuple(c1 + n * r1), tuple(c2 + n * r2)])
    return lines


def plan_polylines():
    L = P["plan"]
    lines = [circle(center, r) for center, r in L["circles"]]
    c1, r1, c2, r2 = L["belt"]
    lines += outer_tangents(c1, r1, c2, r2)
    return [[(p[0], p[1]) for p in line] for line in lines]


def site_polylines():
    return [[(p[0], p[1]) for p in line] for line in P["plan"]["boundaries"]]


def build_plan_lines(parent, m, coll):
    for name, lines in (("PlanLines", plan_polylines()), ("SiteLines", site_polylines())):
        verts, edges = nb.polyline_edges(lines, z=0.001)
        nb.mesh_object(name, (verts, []), m["line"], parent=parent, coll=coll, edges=edges,
                       props={"role": "planline" if name == "PlanLines" else "siteline"})


def build_cameras(coll):
    C = P["cameras"]
    plan = C["plan"]
    cam = bpy.data.cameras.new("Cam_Plan_Ortho")
    cam.type = "ORTHO"
    cam.ortho_scale = plan["width"]
    cam.sensor_fit = "HORIZONTAL"
    cam.clip_start = 0.1
    cam.clip_end = 100
    plan_obj = bpy.data.objects.new("Cam_Plan_Ortho", cam)
    plan_obj.location = (plan["center"][0], plan["center"][1], 20.0)
    plan_obj.rotation_euler = (0.0, 0.0, 0.0)
    plan_obj["aspect"] = plan["aspect"]
    coll.objects.link(plan_obj)

    ob = C["oblique"]
    cam2 = bpy.data.cameras.new("Cam_Oblique")
    cam2.type = "PERSP"
    cam2.lens = ob["lens"]
    cam2.sensor_width = 36.0
    cam2.sensor_fit = "HORIZONTAL"
    cam2.clip_start = 0.05
    cam2.clip_end = 200
    oblique = bpy.data.objects.new("Cam_Oblique", cam2)
    az, el = ob["azimuth"] * DEG, ob["elevation"] * DEG
    forward = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), -math.sin(el)))
    target = Vector(ob["target"])
    oblique.location = target - forward * ob["distance"]
    nb.look_at(oblique, target)
    oblique["aspect"] = ob["aspect"]
    oblique["target"] = list(ob["target"])
    coll.objects.link(oblique)
    return plan_obj, oblique


def build_preview_stage(coll):
    mat = bpy.data.materials.new("Preview_Grid")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emit = nodes.new("ShaderNodeEmission")
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    cell, line = P["grid"]["cell"], P["grid"]["line"]

    def gridline(axis_socket):
        div = nodes.new("ShaderNodeMath"); div.operation = "DIVIDE"; div.inputs[1].default_value = cell
        links.new(axis_socket, div.inputs[0])
        frac = nodes.new("ShaderNodeMath"); frac.operation = "FRACT"
        links.new(div.outputs[0], frac.inputs[0])
        less = nodes.new("ShaderNodeMath"); less.operation = "LESS_THAN"; less.inputs[1].default_value = line / cell
        links.new(frac.outputs[0], less.inputs[0])
        return less.outputs[0]

    links.new(coord.outputs["Object"], sep.inputs[0])
    gx, gy = gridline(sep.outputs["X"]), gridline(sep.outputs["Y"])
    mx = nodes.new("ShaderNodeMath"); mx.operation = "MAXIMUM"
    links.new(gx, mx.inputs[0]); links.new(gy, mx.inputs[1])
    mix = nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs["A"].default_value = nb.hex_color(P["colors"]["background"])
    mix.inputs["B"].default_value = nb.hex_color(P["colors"]["grid"])
    links.new(mx.outputs[0], mix.inputs["Factor"])
    links.new(mix.outputs["Result"], emit.inputs["Color"])
    links.new(emit.outputs[0], out.inputs["Surface"])
    verts, faces = [(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [(0, 1, 2, 3)]
    floor = nb.mesh_object("Preview_Floor", (verts, faces), mat, coll=coll)
    floor.location = (0.0, 0.0, -0.0005)
    sun = bpy.data.lights.new("Preview_Sun", "SUN")
    sun.energy = 1.6
    sun.angle = 12 * DEG
    sun_obj = bpy.data.objects.new("Preview_Sun", sun)
    sun_obj.rotation_euler = (38 * DEG, 0, -35 * DEG)
    coll.objects.link(sun_obj)
    return floor, sun_obj


def main():
    args = nb.parse_args("Naimakes 卷盘装置", {"glb": os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "landing", "models", "reel-device.glb")})
    scene = nb.reset_scene()
    nb.set_world(P["colors"]["background"], 1.0)
    C = P["colors"]
    m = {
        "body": nb.principled("Device_Body", C["body"], alpha=P["alpha"], roughness=P["roughness"]),
        "ribbon": nb.principled("Device_Ribbon", C["body"], alpha=P["alpha"], roughness=P["roughness"]),
        "orange": nb.principled("Device_Orange", C["orange"], alpha=1.0, roughness=P["roughness"]),
        "line": nb.principled("Device_Line", C["line"], alpha=0.8, roughness=1.0),
    }
    model = nb.collection("ReelDevice")
    preview = nb.collection("Preview")

    root = nb.empty("ReelDevice", coll=model, props={
        "card": [*P["card"]["center"], P["card"]["width"], P["card"]["height"]],
        "bigCenter": list(P["big"]["center"]), "smallCenter": list(P["small"]["center"]),
        "units": "big reel outer radius = 1",
    })
    big = nb.empty("BigReel", parent=root, coll=model, location=(0, 0, 0), props={"role": "reel", "height": P["big"]["height"]})
    small = nb.empty("SmallReel", parent=root, coll=model, location=(0, 0, 0), props={"role": "reel", "height": P["small"]["height"]})
    ribbon_group = nb.empty("RibbonGroup", parent=root, coll=model, props={"role": "ribbonGroup"})
    plan = nb.empty("Plan", parent=root, coll=model, props={"role": "plan"})

    build_big(big, m, model)
    small.location = (*P["small"]["center"], 0)
    build_small(small, m, model)
    build_ribbon(ribbon_group, m, model)
    build_plan_lines(plan, m, model)
    plan_cam, oblique_cam = build_cameras(model)

    nb.setup_freestyle(scene, thickness=1.1, alpha=0.8, crease=150)
    nb.curve_from_polylines("Preview_PlanLines", plan_polylines() + site_polylines(), width=0.006, z=0.001,
                            material=nb.principled("Preview_Line", "#FFFFFF", alpha=0.8, roughness=1.0), coll=preview)
    build_preview_stage(preview)

    export = [o for o in model.all_objects]
    if args.glb:
        nb.export_glb(args.glb, export)
    if args.blend:
        nb.save_blend(args.blend)
    if args.render:
        os.makedirs(args.render, exist_ok=True)
        s = args.scale
        floor = bpy.data.objects["Preview_Floor"]
        floor.hide_render = True
        nb.render_still(scene, plan_cam, os.path.join(args.render, "plan.png"),
                        round(1489 * s), round(1489 * s / P["cameras"]["plan"]["aspect"]))
        floor.hide_render = False
        nb.render_still(scene, oblique_cam, os.path.join(args.render, "oblique.png"),
                        round(1496 * s), round(1496 * s / P["cameras"]["oblique"]["aspect"]))


if __name__ == "__main__":
    main()
