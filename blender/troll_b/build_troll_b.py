"""Fit Traveller A's skeleton and clips to the Tripo mesh and export a new GLB.

Blender -b --factory-startup --python-exit-code 1 -P blender/troll_b/build_troll_b.py -- OUTPUT.glb
"""
import math
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree
import numpy as np

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'troll'))
from inspect_troll import load_troll, require

MODEL_A = HERE.parents[1] / 'public/models/troll.glb'
RAW = HERE / 'source/troll_b_raw.glb'
BODY = 'Troll B'
PROPS = 'Troll B umbrella and strap'
MATERIAL = 'felt_b_body'
SIDES = ('L', 'R')
CROWN = .595
BODY_SCALE = .85
SOLE_TOP = .055
STANCE = .25
WALK_SPEED = 1.2


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def smooth(start, end, value):
    t = min(1., max(0., (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def geometry(rig):
    for obj in list(bpy.context.scene.objects):
        if obj != rig:
            bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.import_scene.gltf(filepath=str(RAW))
    body, = (obj for obj in bpy.context.scene.objects if obj.type == 'MESH')
    body.name = BODY
    body.data.name = BODY
    body.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z') @ body.matrix_world)
    body.parent = None
    body.matrix_world = Matrix.Identity(4)
    low = min(v.co.z for v in body.data.vertices)
    soles = [v.co for v in body.data.vertices if v.co.z < low + .018]
    center = Vector(((min(v.x for v in soles) + max(v.x for v in soles)) / 2,
                     (min(v.y for v in soles) + max(v.y for v in soles)) / 2, low))
    body.data.transform(Matrix.Scale(BODY_SCALE, 4) @ Matrix.Translation(-center))

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bmesh.ops.delete(bm, geom=[edge for edge in bm.edges if not edge.link_faces], context='EDGES')
    bmesh.ops.delete(bm, geom=[vert for vert in bm.verts if not vert.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()

    activate(body)
    body.data.calc_loop_triangles()
    modifier = body.modifiers.new('Triangle budget', 'DECIMATE')
    modifier.ratio = min(1., 19_500 / len(body.data.loop_triangles))
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    body.data.calc_loop_triangles()
    require(len(body.data.loop_triangles) <= 20_000, 'Decimated mesh exceeds triangle budget')
    print(f'Decimated mesh: {len(body.data.loop_triangles):,} triangles')

    material, = body.data.materials
    material.name = MATERIAL
    nodes = material.node_tree.nodes
    shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
    links = material.node_tree.links
    color = shader.inputs['Base Color'].links[0].from_node.image
    # Tripo baked the prop and sweater into one welded surface. Keep the prop faces
    # identifiable, and give their shared boundary vertices the same skin weights.
    pixels = np.empty(len(color.pixels), dtype=np.float32)
    color.pixels.foreach_get(pixels)
    width, height = color.size
    pixels = pixels.reshape(height, width, 4)
    uv = body.data.uv_layers.active.data

    def is_prop(face):
        x, y, z = face.center / BODY_SCALE + center
        z -= low
        u, v = sum((uv[index].uv for index in face.loop_indices), Vector((0, 0))) / len(face.vertices)
        red, green, blue, _ = pixels[int(v * height) % height, int(u * width) % width]
        leather = red > .92 * green and blue < .84 * green
        front_strap = (-.177 < x < .151 and y < -.049 and abs(z - (.324 + .52 * x)) < .023)
        rear_strap = (-.169 < x < .155 and y >= -.049 and .225 < z < .415
                      and abs(z - (.321 + .47 * x)) < .052)
        umbrella = (y > .074 and .168 < z < .552 and abs(x - (.012 + .50 * (z - .20)))
                    < .037 + .17 * (z - .168))
        handle = y > .116 and x > .137 and .414 < z < .550
        return handle or umbrella or ((front_strap or rear_strap) and leather)

    prop_faces = {face.index for face in body.data.polygons if is_prop(face)}
    require(len(prop_faces) > 300, 'Umbrella and strap mask is missing')
    for socket_name in ('Metallic', 'Roughness'):
        for link in list(shader.inputs[socket_name].links):
            links.remove(link)
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Roughness'].default_value = .92
    for node in nodes:
        image = getattr(node, 'image', None)
        if image is not None and node.outputs[0].is_linked and max(image.size) > 1024:
            factor = 1024 / max(image.size)
            image.scale(*(round(size * factor) for size in image.size))
            image.pack()
    return body, prop_faces


def fit_rig(rig, body):
    bones = rig.data.bones
    original = {bone.name: bone.matrix_local.copy() for bone in bones}
    old_lengths = {bone.name: bone.length for bone in bones}
    tip_z = max(v.co.z for v in body.data.vertices)
    hair_heads = []
    for fraction in (0, .16, .40, .67):
        z = CROWN + fraction * (tip_z - CROWN)
        band = [v.co for v in body.data.vertices if abs(v.co.z - z) < .012 and v.co.z >= CROWN]
        hair_heads.append(Vector((*[(min(v[i] for v in band) + max(v[i] for v in band)) / 2
                                     for i in (0, 1)], z)))

    # The soles, knees and hips are at about .050, .105 and .158 in the normalized mesh.
    # Use the same ratio on both leg segments to keep the source of the bend and roll.
    leg_ratio = .82
    heads = {
        'root': (0, 0, 0), 'spine': (0, .034, .153), 'head': (0, .043, .357),
        'arm_L': (.138, .032, .307), 'arm_R': (-.138, .032, .307),
        'eye_L': (.038, -.073, .474), 'eye_R': (-.038, -.073, .474),
    }
    lengths = {f'arm_{side}': .132 for side in SIDES}
    for side, sign in zip(SIDES, (1, -1)):
        ankle = Vector((sign * .077, .032, .046))
        for joint in ('leg', 'shin', 'foot'):
            name = f'{joint}_{side}'
            heads[name] = ankle + leg_ratio * (original[name].translation
                                               - original[f'foot_{side}'].translation)
            lengths[name] = leg_ratio * old_lengths[name]
    for index, head in enumerate(hair_heads):
        name = f'hair_{index}'
        heads[name] = head
        lengths[name] = (hair_heads[index + 1] - head).length if index < 3 else tip_z - head.z

    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig.data.edit_bones:
        bone.use_connect = False
    for bone in rig.data.edit_bones:
        rest = original[bone.name]
        rest.translation = heads.get(bone.name, rest.translation)
        bone.matrix = rest
        bone.length = lengths.get(bone.name, old_lengths[bone.name])
    bpy.ops.object.mode_set(mode='OBJECT')
    return leg_ratio


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


def weights(rig, body, prop_faces):
    main, *loose = islands(body.data)
    proxy = body.copy()
    proxy.data = body.data.copy()
    bpy.context.collection.objects.link(proxy)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    loose_indices = {index for part in loose for index in part}
    bmesh.ops.delete(bm, geom=[vert for vert in bm.verts if vert.index in loose_indices],
                     context='VERTS')
    bm.to_mesh(proxy.data)
    bm.free()
    # A closed voxel proxy makes Blender's heat solver robust at Tripo's UV seams.
    activate(proxy)
    proxy.data.remesh_voxel_size = .006
    bpy.ops.object.voxel_remesh()
    deform = {'spine', 'head', *(f'{joint}_{side}' for joint in ('leg', 'shin', 'foot', 'arm')
                                for side in SIDES)}
    for bone in rig.data.bones:
        bone.use_deform = bone.name in deform
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for bone in rig.data.bones:
        bone.use_deform = True

    props = {idx for face in body.data.polygons if face.index in prop_faces for idx in face.vertices}
    groups = {group.index: group.name for group in proxy.vertex_groups}
    proxy_weights = [{groups[g.group]: g.weight for g in v.groups if g.weight > 0}
                     for v in proxy.data.vertices]
    proxy_grid = KDTree(len(proxy_weights))
    for v in proxy.data.vertices:
        proxy_grid.insert(v.co, v.index)
    proxy_grid.balance()
    heat = [{} for _ in body.data.vertices]
    for index in main:
        nearest = proxy_grid.find_n(body.data.vertices[index].co, 4)
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
    modifier = body.modifiers.new('Traveller skin', 'ARMATURE')
    modifier.object = rig
    vg = {bone.name: body.vertex_groups.new(name=bone.name) for bone in rig.data.bones}
    for vertex, auto in zip(body.data.vertices, heat):
        x, _, z = vertex.co
        side = 'L' if x >= 0 else 'R'
        if vertex.index in props:
            values = {'spine': 1.}
        elif z >= CROWN - .012:
            values = {'hair_0': smooth(CROWN - .012, CROWN, z)}
            values['head'] = 1 - values['hair_0']
            for index in range(1, 4):
                pivot = rig.data.bones[f'hair_{index}'].head_local.z
                blend = smooth(pivot - .021, pivot + .021, z)
                if blend:
                    values = {f'hair_{index - 1}': 1 - blend, f'hair_{index}': blend}
        elif z <= SOLE_TOP:
            values = {f'foot_{side}': 1.}
        else:
            # Limit heat leakage across the collar, opposite limbs and the broad soles.
            values = {'spine': auto.get('spine', 0.) + 1e-4,
                      'head': auto.get('head', 0.) * smooth(.321, .385, z)}
            for joint in ('leg', 'shin', 'foot'):
                name = f'{joint}_{side}'
                values[name] = auto.get(name, 0.) * (1 - smooth(.126, .188, z))

            # The fused sleeve meets the knit body along this diagonal. Keep
            # the hem rigid and let the outer sleeve travel with the arm.
            border = .148 - .30 * (z - .25)
            arm = f'arm_{side}'
            arm_weight = max(auto.get(arm, 0.) * smooth(border - .012, border + .017, abs(x)),
                             smooth(border + .014, border + .036, abs(x)))
            arm_weight *= smooth(.15, .181, z) * (1 - smooth(.319, .355, z))
            total = sum(values.values())
            values = {name: (1 - arm_weight) * value / total for name, value in values.items()}
            values[arm] = arm_weight

            if z < .09:
                blend = smooth(SOLE_TOP, .09, z)
                total = sum(values.values())
                values = {name: blend * value / total for name, value in values.items()}
                values[f'foot_{side}'] += 1 - blend
            elif z > .386:
                blend = smooth(.386, .423, z)
                total = sum(values.values())
                values = {name: (1 - blend) * value / total for name, value in values.items()}
                values['head'] += blend

        strongest = sorted(((name, weight) for name, weight in values.items() if weight > 1e-6),
                           key=lambda item: -item[1])[:4]
        total = sum(value for _, value in strongest)
        for name, weight in strongest:
            vg[name].add([vertex.index], weight / total, 'REPLACE')

    activate(body)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(body.data)
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    for face in bm.faces:
        if face.index in prop_faces:
            face.select_set(True)
    bmesh.update_edit_mesh(body.data)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    props_obj, = (obj for obj in bpy.context.selected_objects if obj != body)
    props_obj.name = PROPS
    props_obj.data.name = PROPS


def set_clip(rig, clip):
    rig.animation_data.action, rig.animation_data.action_slot = clip


def sole_points(body):
    return {side: [v.co.copy() for v in body.data.vertices if v.co.z <= SOLE_TOP
                   and (v.co.x >= 0) == (side == 'L')] for side in SIDES}


def retarget_walk(rig, clip, body):
    """Retain the source rotations and align B's sole to the 1.2 units/s treadmill."""
    set_clip(rig, clip)
    scene = bpy.context.scene
    fps = scene.render.fps
    n = round(fps * STANCE)
    start, end = map(round, clip[0].frame_range)
    soles = sole_points(body)
    tracks = []
    for side, contact in zip(SIDES, (0, fps // 2)):
        foot = rig.pose.bones[f'foot_{side}']
        shin = rig.pose.bones[f'shin_{side}']
        rest_inverse = foot.bone.matrix_local.inverted()
        scene.frame_set(start + contact + n)
        rolled = foot.matrix @ rest_inverse
        toe = min(soles[side], key=lambda point: (rolled @ point).z)

        scene.frame_set(start + contact)
        landing = (foot.matrix @ rest_inverse) @ toe
        stance = []
        for phase in range(n + 1):
            scene.frame_set(start + contact + phase)
            skin = foot.matrix @ rest_inverse
            toe_now = skin @ toe
            low = min((skin @ point).z for point in soles[side])
            stance.append(Vector((landing.x - toe_now.x,
                                  landing.y + WALK_SPEED * phase / fps - toe_now.y, -low)))

        for frame in range(start, end + 1):
            scene.frame_set(frame)
            phase = (frame - start - contact) % (end - start)
            if phase <= n:
                shift = stance[phase]
            else:
                t = smooth(n, end - start, phase)
                shift = stance[-1].lerp(stance[0], t)
            # Use the knee and ankle offsets together so the correction is shared
            # by the shin and avoids displacing the entire leg at the hip.
            for bone, share in ((shin, .4), (foot, .6)):
                pose_basis = bone.matrix.to_3x3() @ bone.matrix_basis.to_3x3().inverted()
                tracks.append((bone, frame, bone.location + pose_basis.inverted() @ (share * shift)))

    for bone, frame, position in tracks:
        bone.location = position
        bone.keyframe_insert(data_path='location', frame=frame, group=bone.name)
    bag = clip[0].layers[0].strips[0].channelbag(clip[1])
    for curve in bag.fcurves:
        if curve.data_path.endswith('.location') and any(
            f'"{joint}_{side}"' in curve.data_path for joint in ('shin', 'foot') for side in SIDES
        ):
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'


def fit_clips(rig, clips, body, leg_ratio):
    for action, slot in clips.values():
        action.use_fake_user = True
        bag = action.layers[0].strips[0].channelbag(slot)
        for curve in list(bag.fcurves):
            if curve.data_path == 'pose.bones["root"].location':
                for key in curve.keyframe_points:
                    for point in (key.co, key.handle_left, key.handle_right):
                        point.y *= leg_ratio
            elif curve.data_path == 'pose.bones["spine"].scale':
                # The welded umbrella and strap follow rigid torso motion.
                bag.fcurves.remove(curve)
    rig.pose.bones['spine'].scale = (1, 1, 1)
    retarget_walk(rig, clips['walk'], body)
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) != 1 or Path(args[0]).suffix.lower() != '.glb':
        raise SystemExit('Pass one output .glb path after --')
    output = Path(args[0]).absolute()
    if os.path.lexists(output):
        raise FileExistsError(output)

    rig, clips = load_troll(MODEL_A)
    body, prop_faces = geometry(rig)
    ratio = fit_rig(rig, body)
    weights(rig, body, prop_faces)
    fit_clips(rig, clips, body, ratio)

    # Assemble privately and publish with an exclusive operation, including if
    # another process created the output after the initial existence check.
    with TemporaryDirectory(dir=output.parent, prefix='.troll_b-') as directory:
        staging = Path(directory) / 'model.glb'
        bpy.ops.export_scene.gltf(filepath=str(staging), export_format='GLB', export_yup=True,
                                  export_animations=True, export_animation_mode='ACTIONS',
                                  export_force_sampling=True, export_rest_position_armature=True,
                                  export_optimize_animation_keep_anim_armature=True)
        os.link(staging, output)
    print(f'Built {output} with root translations scaled by {ratio:.3f}')


if __name__ == '__main__':
    main()
