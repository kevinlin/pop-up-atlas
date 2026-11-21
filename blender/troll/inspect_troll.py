"""Re-import a GLB and check the traveller contract. Blender 5.2, no add-ons required."""
import json
import os
import struct
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

MODEL = Path(__file__).resolve().parents[2] / 'public/models/troll.glb'
HAIR_MESHES = {'Sunset yarn plume', 'Wool flyaways'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_gltf(path):
    with path.open('rb') as glb:
        magic, version, size = struct.unpack('<4sII', glb.read(12))
        require(magic == b'glTF' and version == 2 and size == path.stat().st_size,
                'Invalid glTF 2.0 binary header')
        length, kind = struct.unpack('<I4s', glb.read(8))
        require(kind == b'JSON', 'Missing glTF JSON chunk')
        return json.loads(glb.read(length))


def load_troll(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 48
    bpy.ops.import_scene.gltf(filepath=str(path), bone_heuristic='BLENDER', disable_bone_shape=True)
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    require(len(rigs) == 1, f'Expected one rig, found {len(rigs)}')
    rig, = rigs
    animation = rig.animation_data
    clips = {}
    if animation:
        for track in list(animation.nla_tracks):
            for strip in track.strips:
                clips[strip.action.name] = (strip.action, strip.action_slot)
            animation.nla_tracks.remove(track)
        if animation.action:
            clips[animation.action.name] = (animation.action, animation.action_slot)
        animation.action = None
    for action in bpy.data.actions:
        if action.name not in clips and action.slots:
            clips[action.name] = (action, action.slots[0])
    return rig, clips


def figures(meshes):
    for obj in meshes:
        for point in obj.data.vertices:
            yield obj.matrix_world @ point.co


def verify_playback(rig, clips, hair):
    scene = bpy.context.scene
    rig.data.pose_position = 'POSE'
    for name in ('walk', 'idle', 'dance'):
        action, slot = clips[name]
        rig.animation_data.action = action
        rig.animation_data.action_slot = slot
        start, end = map(round, action.frame_range)
        scene.frame_set(start)
        bones = rig.pose.bones
        first = {bone.name: bone.matrix.copy() for bone in bones}
        first_hair = [bones[f'hair_{k}'].rotation_quaternion.copy() for k in range(4)]
        hair_motion = [0.0] * 4
        highest = 0
        root_heights = []
        foot_positions = {}
        for frame in range(start, end + 1):
            scene.frame_set(frame)
            root = rig.matrix_world @ bones['root'].head
            root_heights.append(root.z)
            graph = bpy.context.evaluated_depsgraph_get()
            for obj in hair:
                evaluated = obj.evaluated_get(graph)
                top = max((evaluated.matrix_world @ Vector(point)).z for point in evaluated.bound_box)
                highest = max(highest, top - root.z)
            for k, reference in enumerate(first_hair):
                q = bones[f'hair_{k}'].rotation_quaternion
                excursion = min(reference.rotation_difference(q).angle, q.rotation_difference(-reference).angle)
                hair_motion[k] = max(hair_motion[k], excursion)
            if name == 'walk':
                require(max(abs(root.x), abs(root.y)) < .001, 'Walk root drifts on the ground plane')
                if frame in (start + 2, start + 8):
                    foot_positions[frame] = (rig.matrix_world @ bones['foot_L'].head).y
        require(highest <= .951, f'{name}: root-relative hair tip at {highest:.4f}')
        require(min(hair_motion) > .001, f'{name}: a hair joint is static')
        if name != 'dance':
            mismatch = max(abs(bone.matrix[r][c] - first[bone.name][r][c])
                           for bone in bones for r in range(4) for c in range(4))
            require(mismatch < .002, f'{name}: loop seam mismatch {mismatch:.5f}')
        if name == 'walk':
            bob = max(root_heights) - min(root_heights)
            speed = (foot_positions[start + 8] - foot_positions[start + 2]) * scene.render.fps / 6
            require(.024 <= bob <= .036, f'Walk bob is {bob:.4f}')
            require(abs(speed - 1.2) < .03, f'Walk planted-foot speed is {speed:.4f}')
            print(f'Walk bob {bob:.3f}; planted-foot travel matches {speed:.3f} units/s forward movement')
        print(f'{name}: root-relative hair tip <= {highest:.3f}, '
              f'hair joint travel {min(hair_motion):.3f} to {max(hair_motion):.3f} radians')


def verify(path):
    data = read_gltf(path)
    rig, clips = load_troll(path)
    expected = {'walk': (1, 1), 'idle': (2, 2), 'dance': (4, 6)}
    require(set(clips) == set(expected), f'Unexpected imported actions {sorted(clips)}')
    animations = {clip['name']: clip for clip in data['animations']}
    require(set(animations) == set(expected), f'Unexpected GLB animations {sorted(animations)}')
    for name, (minimum, maximum) in expected.items():
        action, _ = clips[name]
        times = [data['accessors'][sampler['input']] for sampler in animations[name]['samplers']]
        duration = max(a['max'][0] for a in times) - min(a['min'][0] for a in times)
        require(minimum - .001 <= duration <= maximum + .001, f'{name} duration: {duration:.5f}s')
        frame_span = (action.frame_range[1] - action.frame_range[0]) / bpy.context.scene.render.fps
        require(abs(duration - frame_span) < .002, f'{name} imported duration: {frame_span:.5f}s')
        print(f'{name}: {duration:.3f}s ({frame_span:.3f}s re-imported)')

    bones = rig.data.bones
    require('root' in bones, 'Missing root bone')
    for k in range(4):
        name = f'hair_{k}'
        require(name in bones, f'Missing {name}')
        if k:
            require(bones[name].parent == bones[f'hair_{k-1}'], f'Broken parent link for {name}')
    for name, clip in animations.items():
        animated = {data['nodes'][c['target']['node']].get('name')
                    for c in clip['channels'] if c['target']['path'] == 'rotation'}
        require(all(f'hair_{k}' in animated for k in range(4)), f'{name}: missing baked hair motion')
    print('Root and four linked hair bones present and animated')

    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    body = [obj for obj in meshes if obj.name not in HAIR_MESHES]
    hair = [obj for obj in meshes if obj.name in HAIR_MESHES]
    require(len(hair) == len(HAIR_MESHES), f'Missing hair meshes: {[m.name for m in hair]}')
    heights = [point.z for point in figures(body)]
    low, high = min(heights), max(heights)
    hair_tip = max(point.z for point in figures(hair))
    require(.55 <= high - low <= .65, f'Non-hair height: {high - low:.4f}')
    require(0 < hair_tip <= .95, f'Hair tip height: {hair_tip:.4f}')
    require(abs(low) <= .012, f'Feet must start on the origin plane, got {low:.4f}')
    require((rig.matrix_world @ bones['root'].head_local).length < .001, 'Root is off-centre')
    eyes = [obj for obj in meshes if obj.name.startswith('Four-hole eye ') and 'floss' not in obj.name]
    require(len(eyes) == 2 and max(p.y for p in figures(eyes)) < 0, 'Face must point to glTF +Z')
    print(f'Height without hair: {high - low:.4f}; rest hair tip: {hair_tip:.4f}; sole: {low:.4f}')

    triangles = 0
    for mesh in meshes:
        mesh.data.calc_loop_triangles()
        triangles += len(mesh.data.loop_triangles)
        require(any(mod.type == 'ARMATURE' and mod.object == rig for mod in mesh.modifiers),
                f'{mesh.name} is detached from skin')
        require(all(abs(sum(g.weight for g in vertex.groups) - 1) < .001
                    for vertex in mesh.data.vertices), f'{mesh.name} contains invalid skin weights')
    require(triangles <= 20_000, f'{triangles:,} triangles exceeds 20,000')
    print(f'{triangles:,} triangles')

    for entry in data['images']:
        require('bufferView' in entry and 'uri' not in entry, 'Found an external texture')
    images = [img for img in bpy.data.images if img.source == 'FILE' and img.packed_file]
    require(len(images) == len(data['images']) and images, 'Expected packed re-imported textures')
    for img in images:
        w, h = img.size
        require(0 < w <= 1024 and 0 < h <= 1024, f'{img.name}: {w}x{h}')
    print(f'{len(images)} embedded textures, largest {max(max(img.size) for img in images)} px')
    verify_playback(rig, clips, hair)
    print('PASS', flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    try:
        verify(Path(args[0]).resolve() if args else MODEL)
    except Exception:
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
