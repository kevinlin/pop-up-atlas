"""Skeleton and skin weights: the round-5 method on the round-6 armature.

The bone names, parents and rest orientations come from lead A's pre-round-6 armature (source/rig_a.json);
joint positions are moved to the measured landmarks of each Tripo mesh. `head` and `hand_r` (and
`hand_l`) are kept or added; the satchel, scarf and eye bones of the old troll are dropped (the face
nodes replace the eye bones).
"""
import json
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

from common import activate, require, smooth
from params import SOURCE, WALK_SPEED

DROPPED = {'eye_L', 'eye_R', 'satchel', 'scarf_L', 'scarf_R'}
SIDES = ('L', 'R')
LEG_JOINTS = ('leg', 'shin', 'foot')
SKIRT_LEG_SHARE = 0.15       # share of the leg weights kept by knit that hangs over the thighs
DEFORM = ('spine', 'head', 'arm_L', 'arm_R', 'leg_L', 'leg_R', 'shin_L', 'shin_R', 'foot_L', 'foot_R')


def load_rest():
    data = json.loads((SOURCE / 'rig_a.json').read_text())
    return {bone['name']: bone for bone in data['bones'] if bone['name'] not in DROPPED}


def hair_vertices(body, hair_slot=2):
    me = body.data
    return {v for poly in me.polygons if poly.material_index == hair_slot for v in poly.vertices}


def hair_heads(body, crown_z, count=4, fractions=(0, .16, .40, .67)):
    me = body.data
    verts = hair_vertices(body)
    require(verts, 'No hair faces were classified')
    zs = [me.vertices[i].co.z for i in verts]
    tip = max(zs)
    heads = []
    for fraction in fractions:
        z = crown_z + fraction * (tip - crown_z)
        for width in (0.012, 0.02, 0.035):
            band = [me.vertices[i].co for i in verts if abs(me.vertices[i].co.z - z) < width and me.vertices[i].co.z >= crown_z - 1e-6]
            if len(band) > 8:
                break
        require(band, f'Hair band at z={z:.3f} is empty')
        heads.append(Vector((*[(min(v[i] for v in band) + max(v[i] for v in band)) / 2 for i in (0, 1)], z)))
    return heads, tip


def landmarks_norm(p, frame, body):
    """All joint heads in the normalised frame plus bone lengths."""
    low = frame.origin.z
    scale = frame.scale
    s = {}
    spine_y = frame.point((0, p.ankle[1], 0)).y
    mid = frame.point((p.mid_x, 0, 0)).x
    s['mid_x'] = mid
    s['hip_height'] = p.hip_height
    heads, lengths = {}, {}
    heads['root'] = Vector((0, 0, 0))
    heads['spine'] = Vector((mid, spine_y, p.hip_height))
    neck = frame.point((p.mid_x + p.neck[0], p.neck[1], p.neck[2]))
    heads['head'] = neck
    crown = (p.crown - low) * scale
    s['crown'] = crown
    s['neck_z'] = neck.z

    for side, sign in zip(SIDES, (1, -1)):
        ankle = frame.point((p.mid_x + sign * p.ankle[0], p.ankle[1], low + p.ankle[2]))
        hip = Vector((mid + sign * p.hip_x * scale, spine_y, p.hip_height))
        d = (hip - ankle).length
        # Chain long enough for the walk's stance span plus the highest bob, with the knee forward.
        walk = p.motion.walk
        span = WALK_SPEED * walk.stance / 2 + 0.02
        need = math.hypot(span, d + walk.bob / 2 + 0.02)
        total = max(1.3 * d, 1.12 * need)
        a = b = total / 2
        axis = (ankle - hip).normalized()
        forward = Vector((0, -1, 0))
        forward = (forward - axis * forward.dot(axis)).normalized()
        knee = (hip + ankle) / 2 + forward * math.sqrt(max(a * a - (d / 2) ** 2, 0))
        heads[f'leg_{side}'], heads[f'shin_{side}'], heads[f'foot_{side}'] = hip, knee, ankle
        lengths[f'leg_{side}'], lengths[f'shin_{side}'] = a, b
        lengths[f'foot_{side}'] = 0.1 * scale
        sh = frame.point((p.mid_x + sign * p.shoulder[0], p.shoulder[1], p.shoulder[2]))
        wr = frame.point((p.mid_x + sign * p.wrist[0], p.wrist[1], p.wrist[2]))
        tip = frame.point((p.mid_x + sign * p.hand_tip[0], p.hand_tip[1], p.hand_tip[2]))
        heads[f'arm_{side}'] = sh
        lengths[f'arm_{side}'] = (tip - sh).length
        heads[f'hand_{side.lower()}'] = wr
        lengths[f'hand_{side.lower()}'] = (tip - wr).length
    lengths['spine'] = neck.z - p.hip_height
    lengths['head'] = max(crown - neck.z, 0.05)
    hair, tip_z = hair_heads(body, crown, fractions=p.hair_fractions)
    for index, head in enumerate(hair):
        heads[f'hair_{index}'] = head
        lengths[f'hair_{index}'] = (hair[index + 1] - head).length if index < 3 else tip_z - head.z
    s['tip'] = tip_z
    return heads, lengths, s


def create_rig(p, frame, body):
    rest = load_rest()
    heads, lengths, info = landmarks_norm(p, frame, body)
    arm = bpy.data.armatures.new(f'{p.title} rig')
    rig = bpy.data.objects.new(f'{p.title} rig', arm)
    bpy.context.collection.objects.link(rig)
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    order = list(rest)
    # hands: same orientation as the arm, child of the arm
    extra = {f'hand_{side.lower()}': {'parent': f'arm_{side}', 'matrix': rest[f'arm_{side}']['matrix'], 'length': 0.05}
             for side in SIDES}
    for name in order + list(extra):
        spec = rest.get(name) or extra[name]
        bone = arm.edit_bones.new(name)
        bone.head = heads[name]
        bone.tail = heads[name] + Vector((0, 0, 0.05))
        bone.use_connect = False
    for name in order + list(extra):
        spec = rest.get(name) or extra[name]
        bone = arm.edit_bones[name]
        if spec['parent']:
            bone.parent = arm.edit_bones[spec['parent']]
        matrix = Matrix(spec['matrix'])
        matrix.translation = heads[name]
        bone.matrix = matrix
        bone.length = lengths.get(name, spec['length'])
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in arm.bones:
        bone.use_deform = True
    return rig, info, heads


def islands(mesh):
    adjacent = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacent[a].append(b)
        adjacent[b].append(a)
    remaining = set(range(len(adjacent)))
    parts = []
    while remaining:
        part = [remaining.pop()]
        for index in part:
            for other in adjacent[index]:
                if other in remaining:
                    remaining.remove(other)
                    part.append(other)
        parts.append(part)
    return sorted(parts, key=len, reverse=True)


def skin(rig, body, p, frame, info, mouth_z):
    """Heat weights from a closed voxel proxy, then region rules for hair, soles, neck and legs."""
    main, *loose = islands(body.data)
    proxy = body.copy()
    proxy.data = body.data.copy()
    bpy.context.collection.objects.link(proxy)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    loose_indices = {index for part in loose for index in part}
    bmesh.ops.delete(bm, geom=[vert for vert in bm.verts if vert.index in loose_indices], context='VERTS')
    bm.to_mesh(proxy.data)
    bm.free()
    activate(proxy)
    proxy.data.remesh_voxel_size = 0.006
    bpy.ops.object.voxel_remesh()
    for bone in rig.data.bones:
        bone.use_deform = bone.name in DEFORM
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for bone in rig.data.bones:
        bone.use_deform = True

    groups = {group.index: group.name for group in proxy.vertex_groups}
    proxy_weights = [{groups[g.group]: g.weight for g in v.groups if g.weight > 0} for v in proxy.data.vertices]
    grid_proxy = KDTree(len(proxy_weights))
    for v in proxy.data.vertices:
        grid_proxy.insert(v.co, v.index)
    grid_proxy.balance()
    heat = [{} for _ in body.data.vertices]
    for index in main:
        nearest = grid_proxy.find_n(body.data.vertices[index].co, 4)
        values = {}
        for _, other, distance in nearest:
            for name, value in proxy_weights[other].items():
                values[name] = values.get(name, 0.) + value / max(.001, distance)
        total = sum(values.values())
        require(total > 0, f'No automatic weights near body vertex {index}')
        heat[index] = {name: value / total for name, value in values.items()}
    bpy.data.objects.remove(proxy, do_unlink=True)
    grid = KDTree(len(main))
    for index in main:
        grid.insert(body.data.vertices[index].co, index)
    grid.balance()
    for part in loose:
        for index in part:
            _, nearest, _ = grid.find(body.data.vertices[index].co)
            heat[index] = heat[nearest]
    print(f'Automatic body weights: {len(main):,} vertices; {len(loose)} loose islands transferred')

    body.parent = rig
    modifier = body.modifiers.new('Skin', 'ARMATURE')
    modifier.object = rig
    vg = {bone.name: body.vertex_groups.new(name=bone.name) for bone in rig.data.bones}

    crown, neck, hip = info['crown'], info['neck_z'], info['hip_height']
    mid = info['mid_x']
    blend = frame.length(p.crown_blend)
    sole_top = p.sole_top
    head_full = min(neck + 0.05, mouth_z - 0.012)
    hair_bones = [rig.data.bones[f'hair_{i}'] for i in range(4)]
    width = 0.065 * (info['tip'] - crown)
    # A skirt or sweater hem that covers the thighs follows the spine; the legs move it only a little.
    knit = {v for poly in body.data.polygons if poly.material_index == 1 for v in poly.vertices}

    for vertex, auto in zip(body.data.vertices, heat):
        x, _, z = vertex.co
        side = 'L' if x >= mid else 'R'
        if z >= crown - blend:
            values = {'hair_0': smooth(crown - blend, crown, z)}
            values['head'] = 1 - values['hair_0']
            for index in range(1, 4):
                pivot = hair_bones[index].head_local.z
                t = smooth(pivot - width, pivot + width, z)
                if t:
                    values = {f'hair_{index - 1}': 1 - t, f'hair_{index}': t}
        elif z <= sole_top:
            values = {f'foot_{side}': 1.}
        else:
            values = {'spine': auto.get('spine', 0.) + 1e-4,
                      'head': auto.get('head', 0.) * smooth(neck - 0.035, neck + 0.01, z)}
            for joint in LEG_JOINTS:
                name = f'{joint}_{side}'
                follow = SKIRT_LEG_SHARE if vertex.index in knit else 1.
                values[name] = auto.get(name, 0.) * (1 - smooth(hip - 0.035, hip + 0.03, z)) * follow
            arm = f'arm_{side}'
            values[arm] = auto.get(arm, 0.)
            total = sum(values.values())
            values = {name: value / total for name, value in values.items()}
            if z < sole_top + 0.04:
                t = smooth(sole_top, sole_top + 0.04, z)
                total = sum(values.values())
                values = {name: t * value / total for name, value in values.items()}
                values[f'foot_{side}'] = values.get(f'foot_{side}', 0.) + 1 - t
            elif z > neck:
                t = smooth(neck, head_full, z)
                values = {name: (1 - t) * value for name, value in values.items()}
                values['head'] = values.get('head', 0.) + t
        strongest = sorted(((n, w) for n, w in values.items() if w > 1e-6), key=lambda item: -item[1])[:4]
        total = sum(w for _, w in strongest)
        for name, weight in strongest:
            vg[name].add([vertex.index], weight / total, 'REPLACE')
