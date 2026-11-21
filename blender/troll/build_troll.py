"""Build and export the Pop-up Atlas traveller with Blender 5.2.

Run from any directory:
    Blender -b --python-exit-code 1 -P blender/troll/build_troll.py

Use a new destination after '--' for a preview export. The default is
public/models/troll.glb. Existing GLBs are protected.
"""
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.geometry import interpolate_bezier

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from textiles import materials
from motion import make_clips

TAU = math.tau
rng = random.Random(8104)
HERE = Path(__file__).resolve().parent
ANKLE_Z = .046
HIP_Z = .183
ARMS = {side: Vector((sign * .122, -.016, .354))
        for side, sign in (('L', 1), ('R', -1))}
HIPS = {side: Vector((sign * .073, .006, HIP_Z))
        for side, sign in (('L', 1), ('R', -1))}
HAIR_JOINTS = ((0, .012, .568), (.009, .056, .664),
               (.034, .130, .752), (.058, .195, .830), (.077, .253, .915))
SCARF_TAILS = (
    ((-.098, -.018, .386), (-.142, .027, .383),
     (-.227, .079, .351), (-.271, .095, .354)),
    ((-.106, -.010, .375), (-.139, .031, .354),
     (-.189, .101, .317), (-.234, .106, .293)),
)
EYES = ((.059, -.084, .495), (-.061, -.084, .490))
BAG_PIVOT = (-.094, -.103, .307)


def smooth(a, b, value):
    t = max(0, min(1, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def mix_weights(low, high, weight):
    return {low: 1 - weight, high: weight}


class Mesh:
    def __init__(self, name, mat):
        self.name = name
        self.mat = mat
        self.points = []
        self.faces = []
        self.uv = []

    def grid(self, rows, width, point, uv, *, closed=True, flip=False):
        start = len(self.points)
        for row in range(rows + 1):
            for col in range(width if closed else width + 1):
                self.points.append(Vector(point(col / width, row / rows)))
        stride = width if closed else width + 1
        for row in range(rows):
            for col in range(width):
                nxt = (col + 1) % stride
                face = (start + row * stride + col, start + row * stride + nxt,
                        start + (row + 1) * stride + nxt, start + (row + 1) * stride + col)
                coords = (uv(col / width, row / rows), uv((col + 1) / width, row / rows),
                          uv((col + 1) / width, (row + 1) / rows),
                          uv(col / width, (row + 1) / rows))
                self.faces.append(face[::-1] if flip else face)
                self.uv.extend(coords[::-1] if flip else coords)

    def tube(self, path, radius, sides=6, uv=None):
        path = list(map(Vector, path))
        frames = []
        for k, p in enumerate(path):
            tangent = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
            side = (frames[-1][0] - tangent * frames[-1][0].dot(tangent)
                    if frames else tangent.cross(Vector((0, 1, 0))))
            if side.length < .001:
                side = tangent.cross(Vector((1, 0, 0)))
            side.normalize()
            frames.append((side, tangent.cross(side)))

        def point(u, v):
            index = round(v * (len(path) - 1))
            side, up = frames[index]
            return path[index] + radius(v) * (math.cos(TAU * u) * side + math.sin(TAU * u) * up)

        self.grid(len(path) - 1, sides, point, uv or (lambda u, v: (u, v)))

    def finish(self, rig, weigh=None, assignments=None):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.points, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(self.mat)
        uv = mesh.uv_layers.new()
        uv.uv.foreach_set('vector', [c for pair in self.uv for c in pair])
        for face in mesh.polygons:
            face.use_smooth = True
        if rig:
            bind(obj, rig, assignments if assignments is not None else map(weigh, self.points))
        return obj


def bind(obj, rig, weights):
    groups = {}
    for vertex, values in enumerate(weights):
        for name, value in values.items():
            if value <= 0.00001:
                continue
            if name not in groups:
                groups[name] = obj.vertex_groups.new(name=name)
            groups[name].add([vertex], value, 'REPLACE')
    obj.parent = rig
    modifier = obj.modifiers.new('Traveller skin', 'ARMATURE')
    modifier.object = rig


def ellipsoid(mesh, center, radii, rotation=None, cols=20, rows=12, exponent=1):
    def power(value):
        return math.copysign(abs(value) ** exponent, value)

    def point(u, v):
        lat = math.pi * (.0001 + .9998 * v - .5)
        phi = TAU * u
        xyz = Vector((radii[0] * power(math.cos(lat)) * power(math.cos(phi)),
                      radii[1] * power(math.cos(lat)) * power(math.sin(phi)),
                      radii[2] * power(math.sin(lat))))
        return Vector(center) + (rotation @ xyz if rotation else xyz)

    mesh.grid(rows, cols, point, lambda u, v: (u, v))
    return point


def make_rig():
    armature = bpy.data.armatures.new('Traveller skeleton')
    rig = bpy.data.objects.new('Traveller', armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')

    def add(name, head, tail, parent=None):
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        if parent:
            bone.parent = armature.edit_bones[parent]
            bone.use_connect = (bone.parent.tail - bone.head).length < 1e-6

    add('root', (0, 0, 0), (0, 0, .15))
    add('spine', (0, 0, .19), (0, 0, .402), 'root')
    add('head', (0, 0, .402), (0, 0, .568), 'spine')
    for idx, side in enumerate(('L', 'R')):
        sign = 1 if side == 'L' else -1
        add('arm_' + side, ARMS[side], ARMS[side] + Vector((sign * .07, -.004, -.10)), 'spine')
        hip = HIPS[side]
        knee = hip + Vector((0, -.078, -.065))
        ankle = Vector((hip.x, .006, ANKLE_Z))
        add('leg_' + side, hip, knee, 'root')
        add('shin_' + side, knee, ankle, 'leg_' + side)
        add('foot_' + side, ankle, ankle + Vector((0, -.048, 0)), 'shin_' + side)
        eye = EYES[idx]
        add('eye_' + side, eye, Vector(eye) + Vector((0, 0, .041)), 'head')
    for name, path in zip(('scarf_L', 'scarf_R'), SCARF_TAILS):
        add(name, path[0], path[-1], 'spine')
    add('satchel', BAG_PIVOT, (-.101, -.137, .183), 'spine')
    for k in range(4):
        add(f'hair_{k}', HAIR_JOINTS[k], HAIR_JOINTS[k + 1], f'hair_{k-1}' if k else 'head')
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


BODY_PROFILE = (
    (.116, .002, .002), (.137, .084, .066), (.169, .122, .083),
    (.230, .145, .103), (.281, .149, .110), (.330, .143, .105),
    (.390, .127, .095), (.445, .118, .100), (.495, .112, .102),
    (.536, .094, .090), (.565, .066, .071), (.589, .035, .037), (.600, .002, .002),
)


def profile(z):
    for i, ((lo, *a), (hi, *b)) in enumerate(zip(BODY_PROFILE, BODY_PROFILE[1:])):
        if z <= hi:
            preceding = BODY_PROFILE[max(0, i - 1)]
            following = BODY_PROFILE[min(len(BODY_PROFILE) - 1, i + 2)]
            t = (z - lo) / (hi - lo)
            values = []
            for dim, (left, right) in enumerate(zip(a, b), 1):
                m0 = (right - preceding[dim]) * (hi - lo) / (hi - preceding[0])
                m1 = (following[dim] - left) * (hi - lo) / (following[0] - lo)
                values.append((2*t**3 - 3*t*t + 1)*left + (t**3 - 2*t*t + t)*m0
                              + (-2*t**3 + 3*t*t)*right + (t**3 - t*t)*m1)
            return values
    return BODY_PROFILE[-1][1:]


def body_point(u, v):
    angle = TAU * u
    z = .116 + .484 * v
    rx, ry = profile(z)
    wobble = 1 + .013 * math.sin(3 * angle + 12 * z) + .011 * math.sin(7 * angle - 24 * z)
    return (rx * wobble * math.cos(angle), ry * wobble * math.sin(angle) + .007,
            z + .0016 * math.cos(angle + 9 * z) * math.sin(math.pi * v))


def body_weights(point):
    return mix_weights('spine', 'head', smooth(.349, .462, point.z))


def stem_weights(point, side, knee_z):
    if point.z < .089:
        return mix_weights('foot_' + side, 'shin_' + side, smooth(.051, .089, point.z))
    return mix_weights('shin_' + side, 'leg_' + side,
                       smooth(knee_z - .020, knee_z + .020, point.z))


def wool_fibres(fibres, surface, uv, color, weigh, count, length):
    mesh, assignments = fibres[color]
    for _ in range(count):
        u, v = uv()
        p = Vector(surface(u, v))
        dx = Vector(surface(u + .001, v)) - p
        dy = Vector(surface(u, v + .001)) - p
        normal = dx.cross(dy).normalized()
        angle = rng.uniform(0, TAU)
        tangent = math.cos(angle) * dx.normalized() + math.sin(angle) * dy.normalized()
        tangent.normalize()
        side = normal.cross(tangent).normalized()
        reach = rng.uniform(.36, 1) * length
        width = rng.uniform(.00025, .00064)
        center = p + tangent * reach * .48 + normal * reach * .49
        tip = p + tangent * reach + normal * reach * rng.uniform(.43, .79)
        start = len(mesh.points)
        root = p - normal * .00035
        mesh.points.extend((root + side * width, root - side * width,
                            center + side * width * .63, center - side * width * .63, tip))
        mesh.faces.extend(((start, start + 1, start + 3, start + 2),
                           (start + 2, start + 3, start + 4)))
        mesh.uv.extend(((0, 0),) * 7)
        assignments.extend([weigh(p)] * 5)


def make_felt(rig, mats, fibres):
    body = Mesh('Needle-felted pear', mats['felt_mint'])
    body.grid(28, 30, body_point, lambda u, v: (u, v))
    body.finish(rig, body_weights)
    for color, count in (('mint', 235), ('green', 65), ('light', 150)):
        wool_fibres(fibres, body_point, lambda: (rng.random(), rng.uniform(.06, .97)),
                    color, body_weights, count, .014)

    nose = Mesh('Peach wool nose', mats['felt_peach'])
    surface = ellipsoid(nose, (.002, -.105, .457), (.035, .037, .031), cols=20, rows=12)
    nose.finish(rig, lambda _: {'head': 1})
    wool_fibres(fibres, surface, lambda: (rng.random(), rng.uniform(.10, .90)),
                'peach', lambda _: {'head': 1}, 85, .006)

    for side, hip in HIPS.items():
        sign = 1 if side == 'L' else -1
        arm = Mesh('Felt arm ' + side, mats['felt_mint'])
        shoulder = ARMS[side]
        axis = Vector((sign * .07, -.004, -.10)).normalized()
        transform = Vector((0, 0, 1)).rotation_difference(axis).to_matrix()
        surface = ellipsoid(arm, shoulder + axis * .057, (.032, .030, .081),
                            transform, cols=14, rows=10)
        arm_weight = lambda _, s=side: {'arm_' + s: 1}
        arm.finish(rig, arm_weight)
        wool_fibres(fibres, surface, lambda: (rng.random(), rng.uniform(.10, .90)),
                    'mint', arm_weight, 80, .007)

        leg = Mesh('Felt boot and leg ' + side, mats['felt_mint'])
        knee_z = rig.data.bones['shin_' + side].head_local.z
        def point(u, v):
            angle = TAU * u
            z = .001 + .217 * v
            heel = math.sin(math.pi * min(1, v / .49)) ** .65
            stem = math.sin(math.pi * v) ** .70
            radius = .001 + .026 * stem + .023 * heel
            knee = .064 * math.exp(-((z - knee_z) / .039) ** 2)
            center_y = .006 - .020 * heel - knee
            return (hip.x + radius * math.cos(angle),
                    center_y + (radius + .020 * heel) * math.sin(angle), z)
        weight = lambda p, s=side, k=knee_z: stem_weights(p, s, k)
        leg.grid(16, 18, point, lambda u, v: (u, v))
        leg.finish(rig, weight)
        wool_fibres(fibres, point, lambda: (rng.random(), rng.uniform(.06, .96)),
                    'light', weight, 68, .007)


def button(rig, name, center, normal, radius, material, thread, bone):
    # Each quadrant has a closed hole wall and shares its edges with the molded rim.
    basis = Vector((0, 0, 1)).rotation_difference(Vector(normal).normalized()).to_matrix()
    center = Vector(center)
    mesh = Mesh(name, material)
    lookup = {}

    def vertex(p):
        key = tuple(round(x, 7) for x in p)
        if key not in lookup:
            lookup[key] = len(mesh.points)
            mesh.points.append(center + basis @ (radius * Vector(p)))
        return lookup[key]

    def bridge(a, b, reverse=False):
        for i in range(len(a)):
            j = (i + 1) % len(a)
            face = (a[i], a[j], b[j], b[i])
            mesh.faces.append(face[::-1] if reverse else face)
            mesh.uv.extend(((0, 0),) * 4)

    inset = .73
    offset = .277
    diagonal = math.atan2(-offset, inset - offset)
    angles = sorted({round(x % TAU, 9) for x in
                     [i * TAU / 10 for i in range(10)]
                     + [diagonal, -3 * math.pi / 4, math.pi / 2 - diagonal]})
    perimeter = {}
    for quadrant in range(4):
        cos_q = math.cos(quadrant * math.pi / 2)
        sin_q = math.sin(quadrant * math.pi / 2)

        def turn(x, y, z):
            return (cos_q * x - sin_q * y, sin_q * x + cos_q * y, z)

        face, back, hole, through = [], [], [], []
        for angle in angles:
            x, y = math.cos(angle), math.sin(angle)
            dot = offset * (x + y)
            arc = -dot + math.sqrt(dot**2 + inset**2 - 2 * offset**2)
            reach = min(arc, -offset / x if x < 0 else 2, -offset / y if y < 0 else 2)
            boundary = (offset + x * reach, offset + y * reach)
            outer = turn(*boundary, .044)
            face.append(vertex(outer))
            back.append(vertex(turn(*boundary, -.31)))
            hole.append(vertex(turn(offset + .134 * x, offset + .134 * y, .044)))
            through.append(vertex(turn(offset + .134 * x, offset + .134 * y, -.31)))
            if abs(arc - reach) < 1e-6:
                angle_outer = math.atan2(outer[1], outer[0]) % TAU
                perimeter[0 if angle_outer > TAU - 1e-6 else round(angle_outer, 7)] = outer[:2]
        bridge(face, hole)
        bridge(back, through, reverse=True)
        bridge(hole, through)

    outline = [perimeter[key] for key in sorted(perimeter)]
    rings = ((inset, .044), (.82, .120), (.94, .104),
             (1, -.065), (.96, -.275), (inset, -.31))
    edge = [[vertex((x * r / inset, y * r / inset, z)) for x, y in outline] for r, z in rings]
    for a, b in zip(edge, edge[1:]):
        bridge(a, b, reverse=True)
    mesh.finish(rig, lambda _: {bone: 1})

    floss = Mesh(name + ' floss', thread)
    for x in (-.277, .277):
        path = [center + basis @ (radius * Vector((x + offset, y, z)))
                for y, z, offset in ((-.277, -.15, 0), (-.228, .072, 0),
                                     (0, .088, .014), (.228, .073, 0), (.277, -.15, 0))]
        floss.tube(path, lambda _: radius * .032, sides=5)
    floss.finish(rig, lambda _: {bone: 1})


def make_eyes(rig, mats):
    for side, center in zip(('L', 'R'), EYES):
        sign = 1 if side == 'L' else -1
        normal = Vector((sign * .27, -.96, .091))
        socket = Mesh('Eye backing ' + side, mats['felt_eye_socket'])
        facing = Vector((0, 1, 0)).rotation_difference(normal.normalized()).to_matrix()
        ellipsoid(socket, Vector(center) - normal * .010, (.030, .020, .030), facing, cols=16, rows=8)
        socket.finish(rig, lambda _, s=side: {'eye_' + s: 1})
        button(rig, 'Four-hole eye ' + side, Vector(center) + normal * .013,
               normal, .035 if side == 'L' else .033, mats['button_charcoal'],
               mats['yarn_button_thread'], 'eye_' + side)


def scarf_wrap(rig, mats):
    wrap = Mesh('Knitted scarf wrap', mats['yarn_mustard'])

    def point(u, v):
        around = TAU * u
        roll = TAU * v
        level = .033 * math.sin(roll)
        z = .385 + level + .006 * math.sin(around + .6)
        rx, ry = profile(z)
        ridge = math.exp(-((abs(level) - .016) / .009)**2)
        thickness = .009 + .009 * math.cos(roll) + .005 * ridge * max(0, math.cos(roll))
        return ((rx + thickness) * math.cos(around), (ry + thickness) * math.sin(around) + .006, z)

    wrap.grid(14, 40, point, lambda u, v: (.5 + .494 * math.sin(TAU * v) + .004 * math.cos(TAU * v), u))
    wrap.finish(rig, body_weights)
    edging = Mesh('Scarf rolled edges and knot', mats['yarn_fringe'])
    for angle in (.20, .80):
        path = [point(i / 32, angle + .008 * math.sin(TAU * i / 32 * 12)) for i in range(33)]
        edging.tube(path, lambda _: .0027, sides=4)
    ellipsoid(edging, (-.130, -.001, .378), (.022, .030, .025), cols=12, rows=8)
    edging.finish(rig, body_weights)


def bezier_path(points, steps):
    return interpolate_bezier(*(Vector(p) for p in points), steps)


def make_scarf_ends(rig, mats):
    for side, guides in zip(('L', 'R'), SCARF_TAILS):
        bone = 'scarf_' + side
        path = bezier_path(guides, 16)
        tail = Mesh('Knitted scarf end ' + side, mats['yarn_mustard'])

        def cross_section(index):
            along = (path[min(15, index + 1)] - path[max(0, index - 1)]).normalized()
            across = along.cross(Vector((0, 1, 0))).normalized()
            return along, across, across.cross(along)

        def point(u, v):
            index = round(v * 15)
            _, across, up = cross_section(index)
            angle = TAU * u
            twist = .16 * math.sin(v * math.pi)
            across, up = across * math.cos(twist) + up * math.sin(twist), up * math.cos(twist) - across * math.sin(twist)
            spread = (.017 + .014 * v) * (1 + .05 * math.sin(v * TAU * 2))
            return (path[index] + (math.cos(angle) * spread) * across
                    + (.0057 * math.sin(angle)) * up)

        tail.grid(15, 10, point, lambda u, v: (.5 + .499 * math.cos(TAU * u), v * .26), flip=True)
        weigh = lambda p, name=bone, root=Vector(guides[0]): mix_weights(
            'spine', name, smooth(0, .038, (p - root).length))
        tail.finish(rig, weigh)

        fringe = Mesh('Twisted scarf fringe ' + side, mats['yarn_fringe'])
        lit = Mesh('Golden scarf fibres ' + side, mats['yarn_gold'])
        along, across, up = cross_section(15)
        for ix in range(8):
            knot = path[-1] + across * (.0079 * (ix - 3.5))
            end = rng.uniform(.036, .052)
            points = [knot + along * (end * t) + up * (math.sin(t * 4 + ix) * .004 * t)
                      + across * (.0025 * (ix - 3.5) * t + .002 * math.sin(3 * t) * t)
                      for t in (0, .23, .53, .80, 1)]
            fringe.tube(points, lambda t: .0033 * (1 - .50 * t), sides=5)
            for sign in (-1, 1):
                split = (points[-2], points[-1] + up * (.001 * sign),
                         points[-1] + along * .011 + across * (.004 * sign))
                lit.tube(split, lambda t: .00115 * (1 - .86 * t), sides=3)
        for obj in (fringe, lit):
            obj.finish(rig, weigh)


def make_satchel(rig, mats, fibres):
    bag = Mesh('Tomato felt satchel', mats['felt_tomato'])
    tilt = Vector((0, 0, 1)).rotation_difference(Vector((-.20, .08, 1)).normalized()).to_matrix()
    center = Vector((-.104, -.110, .213))
    surface = ellipsoid(bag, center, (.074, .043, .071), tilt, cols=16, rows=12, exponent=.56)
    weigh = lambda _: {'satchel': 1}
    bag.finish(rig, weigh)
    wool_fibres(fibres, surface, lambda: (rng.random(), rng.uniform(.06, .94)),
                'red', weigh, 95, .006)
    flap = Mesh('Folded felt satchel flap', mats['felt_flap'])
    ellipsoid(flap, center + tilt @ Vector((0, -.026, .029)), (.071, .027, .043),
              tilt, cols=16, rows=10, exponent=.64)
    flap.finish(rig, weigh)

    strap = Mesh('Cross-body felt strap', mats['felt_strap'])
    def strap_surface(u, v):
        around = TAU * v
        z = .300 + .094 * math.cos(around + .75) + (u - .5) * .025
        rx, ry = profile(z)
        radial = .014 + .003 * math.sin(math.pi * u)
        return ((rx + radial) * math.cos(around), -(ry + radial) * math.sin(around) + .007, z)
    strap.grid(50, 4, strap_surface, lambda u, v: (u * .35, 4 * v), closed=False)
    strap.finish(rig, body_weights)

    seams = Mesh('Hand-sewn satchel seams', mats['yarn_floss'])
    for rim, count in ((False, 17), (True, 11)):
        def stitch(t):
            angle = math.pi * (1.03 + .94 * t)
            x = (.065 if rim else .069) * math.copysign(abs(math.cos(angle)) ** .61, math.cos(angle))
            z = (.037 if rim else .058) * -abs(math.sin(angle)) ** .56 + (.031 if rim else 0)
            depth = (-.046 if rim else -.030) - (.005 if rim else .009) * math.sin(math.pi * t)
            return center + tilt @ Vector((x, depth, z))
        for i in range(count):
            t = i / count
            a, b = stitch(t), stitch(t + .61 / count)
            mid = (a + b) * .5 + Vector((0, -.0018, .001))
            seams.tube((a, mid, b), lambda _: .00148, sides=4)
    seams.finish(rig, weigh)
    button(rig, 'Satchel flap button', center + tilt @ Vector((.003, -.052, .017)),
           tilt @ Vector((0, -1, 0)), .011, mats['button_ochre'],
           mats['yarn_button_thread'], 'satchel')


def hair_weights(p):
    # The blend bands straddle the chain joints and avoid visible hinges in the wool.
    z = p.z
    for k, joint in enumerate(HAIR_JOINTS[1:-1]):
        if z < joint[2] + .025:
            return mix_weights(f'hair_{k}', f'hair_{k + 1}',
                               smooth(joint[2] - .025, joint[2] + .025, z))
    return {'hair_3': 1}


def make_hair(rig, mats):
    yarn = Mesh('Sunset yarn plume', mats['yarn_sunset'])
    wisps = Mesh('Wool flyaways', mats['yarn_sunset_fibres'])
    wool_rng = random.Random(680)
    # Six bundles overlap through their shoulders, then curl apart at different heights.
    # Crown x/y, fan x, sweep y, rise, and the x/y curl at the tip.
    locks = (
        (-.037, -.008, -.145, .196, .325, -.037, .014),
        (-.023, .023, -.089, .263, .366, -.062, .044),
        (-.005, -.029, -.018, .227, .353, .043, -.066),
        (.015, .024, .052, .284, .379, -.023, .048),
        (.032, -.023, .112, .200, .365, .100, -.034),
        (.038, .005, .138, .232, .317, .096, .034),
    )
    for lock, (root_x, root_y, fan, sweep, rise, curl_x, curl_y) in enumerate(locks):
        for strand in range(15):
            solid = strand < 3
            angle = strand * 2.399963 + lock * 1.15
            spread = .011 + .026 * math.sqrt(strand / 14)
            length = rise + wool_rng.uniform(-.016, .013)
            wave = wool_rng.uniform(-.6, .6)

            def point(t):
                opening = smooth(.27, .86, t)
                hook = smooth(.61, 1, t)
                twist = angle + .68 * t + .27 * math.sin(TAU * t + wave)
                shoulder = spread * (.37 + .70 * opening)
                sway = .011 * math.sin(7 * t + lock + wave) * opening
                return Vector((
                    root_x + .76 * (fan * opening + curl_x * hook) + shoulder * math.cos(twist) + sway,
                    root_y + sweep * t**1.62 + curl_y * hook + shoulder * .85 * math.sin(twist),
                    .533 + length * t + .019 * math.sin(math.pi * t) - .010 * hook
                    + .006 * opening * math.sin(angle + 7 * t),
                ))

            if solid:
                def radius(t):
                    plump = .023 + .006 * math.sin(math.pi * t)
                    return max(.0012, plump * (1 - t**4) * (.72 + .28 * smooth(.06, .48, t)))

                yarn.tube([point(i / 12) for i in range(13)], radius, sides=6,
                          uv=lambda u, v: (u, .01 + .98 * v))
                continue

            rows = 14
            path = [point(i / rows) for i in range(rows + 1)]
            facing = angle + wool_rng.uniform(-.77, .77)
            horizontal = Vector((math.cos(facing), math.sin(facing), .12))
            across = []
            for i in range(rows + 1):
                tangent = (path[min(i + 1, rows)] - path[max(i - 1, 0)]).normalized()
                across.append(tangent.cross(horizontal).normalized())
            width = wool_rng.uniform(.041, .068)
            swatch = strand % 4

            def ribbon(u, t):
                i = round(t * rows)
                span = width * (.52 + .35 * smooth(.27, .69, t) + .10 * math.sin(math.pi * t))
                return path[i] + across[i] * ((u - .5) * span)

            wisps.grid(rows, 1, ribbon, lambda u, v: ((swatch + .012 + .976 * u) / 4, v),
                       closed=False)
    return (yarn.finish(rig, hair_weights), wisps.finish(rig, hair_weights))


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    output = Path(args[0]).resolve() if args else HERE.parents[1] / 'public/models/troll.glb'
    if output.exists():
        raise FileExistsError(output)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = materials()
    rig = make_rig()
    fibres = {color: (Mesh('Loose ' + color + ' wool fibres', mats['felt_fibre_' + color]), [])
              for color in ('mint', 'green', 'light', 'peach', 'red')}
    make_felt(rig, mats, fibres)
    make_eyes(rig, mats)
    scarf_wrap(rig, mats)
    make_scarf_ends(rig, mats)
    make_satchel(rig, mats, fibres)
    plume = make_hair(rig, mats)
    for mesh, weights in fibres.values():
        mesh.finish(rig, assignments=weights)
    triangles = sum(len(face.vertices) - 2 for obj in bpy.context.scene.objects if obj.type == 'MESH'
                    for face in obj.data.polygons)
    if triangles > 20_000:
        raise ValueError(f'Traveller geometry has {triangles:,} triangles; budget is 20,000')
    print(f'Traveller source mesh: {triangles:,} triangles', flush=True)
    make_clips(rig, plume)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_yup=True,
                             export_animations=True, export_animation_mode='ACTIONS',
                             export_force_sampling=True, export_frame_step=1, export_nla_strips=False,
                             export_rest_position_armature=True, export_image_format='AUTO',
                             export_extras=False, export_lights=False, export_cameras=False)


if __name__ == '__main__':
    main()
