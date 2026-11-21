"""Re-import a GLB and check the traveller contract. Blender 5.2, no add-ons required."""
import json
import math
import os
import struct
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

MODEL = Path(__file__).resolve().parents[2] / 'public/models/troll.glb'
HAIR_MESHES = {'Sunset yarn plume', 'Wool flyaways'}
SECONDARY = ('hair', 'scarf', 'satchel')


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


def evaluated_points(obj, graph):
    evaluated = obj.evaluated_get(graph)
    return [evaluated.matrix_world @ point.co for point in evaluated.data.vertices]


def facing(rig, bone):
    # Yaw of the head's forward axis (Blender -Y) in degrees: 0 front, 90 profile, 180 back.
    turn = rig.matrix_world.to_3x3() @ bone.matrix.to_3x3() @ bone.bone.matrix_local.to_3x3().inverted()
    forward = turn @ Vector((0, -1, 0))
    return math.degrees(math.atan2(forward.x, -forward.y))


def clearance(a, b):
    return min((p - q).length for p in a[::3] for q in b[::3])


def verify_dance(rig, clips):
    scene = bpy.context.scene
    fps = scene.render.fps
    action, slot = clips['dance']
    rig.animation_data.action = action
    rig.animation_data.action_slot = slot
    start, end = map(round, action.frame_range)
    bones = rig.pose.bones
    objects = scene.objects
    boots = {side: objects['Felt boot and leg ' + side] for side in ('L', 'R')}
    arms = {side: objects['Felt arm ' + side] for side in ('L', 'R')}
    yaw, spin_root, root, held, soles, head_top, hands, scarf = ([] for _ in range(8))
    previous = previous_root = None
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        graph = bpy.context.evaluated_depsgraph_get()
        angle = facing(rig, bones['head'])
        if previous is not None:
            angle = previous + (angle - previous + 180) % 360 - 180
        yaw.append(previous := angle)
        angle = facing(rig, bones['root'])
        if previous_root is not None:
            angle = previous_root + (angle - previous_root + 180) % 360 - 180
        spin_root.append(previous_root := angle)
        root.append(rig.matrix_world @ bones['root'].head)
        held.append([bone.matrix.copy() for bone in bones if not bone.name.startswith(SECONDARY)])
        soles.append({side: min(p.z for p in evaluated_points(boot, graph)) for side, boot in boots.items()})
        head_top.append(max(p.z for p in evaluated_points(objects['Needle-felted pear'], graph)))
        hands.append({side: max(p.z for p in evaluated_points(arm, graph)) for side, arm in arms.items()})
        scarf.append(max(p.z for p in evaluated_points(objects['Knitted scarf wrap'], graph)))

    # Sideways step of half a body-width with one hand thrown above the head.
    scene.frame_set(start)
    body = evaluated_points(objects['Needle-felted pear'], bpy.context.evaluated_depsgraph_get())
    width = max(p.x for p in body) - min(p.x for p in body)
    early = range(0, round(.9 * fps))
    step = max(abs(root[i].x - root[0].x) for i in early)
    overhead = max(max(hands[i].values()) - head_top[i] for i in early)
    require(step >= .45 * width, f'Dance side step {step:.3f} is under half the body width {width:.3f}')
    require(overhead > 0, f'Dance raised hand stays {-overhead:.3f} below the head top')
    print(f'Dance side step {step:.3f} (body width {width:.3f}); hand {overhead:.3f} above head')

    # The body turn takes .75 s; the head passes front, profile, back and profile to the finish.
    begin = next(i for i in range(len(spin_root)) if abs(spin_root[i] - spin_root[0]) > .5) - 1
    finish = next(i for i in range(begin, len(spin_root)) if abs(spin_root[i] - spin_root[begin]) > 359.5)
    spin = [abs(a - yaw[begin]) for a in yaw[begin:finish + 1]]
    turn_time = (finish - begin) / fps
    require(.65 <= turn_time <= .85, f'Dance turn lasts {turn_time:.3f}s')
    back = [i for i, a in enumerate(spin) if 155 <= a <= 205]
    require(len(back) >= .15 * fps and back[-1] - back[0] == len(back) - 1,
            f'Dance turn back-facing pose lasts {len(back)} frames')
    for target in (90, 270):
        require(any(abs(a - target) < 12 for a in spin), f'Dance turn skips the {target} degree profile')
    require(all(a >= -1 for a in spin), 'Dance turn reverses')
    print(f'Dance turn {turn_time:.3f}s from frame {begin}: back-facing for {len(back) / fps:.3f}s')

    landing = min(r.z for r in root[finish:finish + round(.4 * fps)])
    require(landing <= -.06, f'Dance landing is only {landing:.3f} low')
    print(f'Dance lands {-landing:.3f} below standing height')

    # The crooked bow holds still on one boot with the hands above the scarf.
    hold = max_run = 0
    best = None
    for i in range(finish, len(held) - 1):
        moved = max(abs(a[r][c] - b[r][c]) for a, b in zip(held[i], held[i + 1])
                    for r in range(4) for c in range(4))
        planted = min(soles[i].values()) < .007 and max(soles[i].values()) > .04
        hold = hold + 1 if moved < .0015 and planted else 0
        if hold > max_run:
            max_run, best = hold, i + 1
    require(max_run / fps >= .35, f'Dance bow hold lasts {max_run / fps:.3f}s')
    scene.frame_set(start + best)
    graph = bpy.context.evaluated_depsgraph_get()
    lifted = max(soles[best], key=soles[best].get)
    standing = 'L' if lifted == 'R' else 'R'
    raised = min(hands[best].values()) - scarf[best]
    rest = boots[lifted].data.vertices
    boot = [p for p, v in zip(evaluated_points(boots[lifted], graph), rest) if v.co.z < .10]
    gap = clearance(boot,
                    evaluated_points(boots[standing], graph) + evaluated_points(objects['Needle-felted pear'], graph))
    require(raised > 0, f'Dance bow hands sit {-raised:.3f} below the scarf')
    require(gap >= .045, f'Dance bow lifted leg is only {gap:.3f} clear of the body')
    print(f'Dance bow held {max_run / fps:.3f}s on boot {standing}: {lifted} boot {soles[best][lifted]:.3f} up, '
          f'{gap:.3f} clear; hands {raised:.3f} above the scarf')


def verify_playback(rig, clips, hair):
    scene = bpy.context.scene
    rig.data.pose_position = 'POSE'
    boots = {side: scene.objects['Felt boot and leg ' + side] for side in ('L', 'R')}
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
        support = {'L': {}, 'R': {}}
        stance_x = {'L': [], 'R': []}
        swing_sole = {'L': 0, 'R': 0}
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
                require(abs(root.y) < .001 and abs(root.x) <= .03, 'Walk root drifts on the ground plane')
                if frame == end:
                    continue
                for offset, side in enumerate(boots):
                    phase = (frame - start + offset * (end - start) // 2) % (end - start)
                    boot = boots[side].evaluated_get(graph)
                    sole = min((boot.matrix_world @ Vector(point)).z for point in boot.bound_box)
                    if phase > scene.render.fps // 4:
                        swing_sole[side] = max(swing_sole[side], sole)
                        continue
                    stance_x[side].append(root.x)
                    require(abs(sole) < .007, f'Walk {side} foot loses ground contact at frame {frame}')
                    foot = bones['foot_' + side]
                    support[side][phase] = ((rig.matrix_world @ foot.head).y, foot.matrix.to_quaternion())
        require(highest <= .951, f'{name}: root-relative hair tip at {highest:.4f}')
        require(min(hair_motion) > .001, f'{name}: a hair joint is static')
        if name != 'dance':
            mismatch = max(abs(bone.matrix[r][c] - first[bone.name][r][c])
                           for bone in bones for r in range(4) for c in range(4))
            require(mismatch < .002, f'{name}: loop seam mismatch {mismatch:.5f}')
        if name == 'walk':
            bob = max(root_heights) - min(root_heights)
            fps = scene.render.fps
            half = (end - start) // 2
            for contact in (0, half):
                heights = root_heights[contact:contact + half]
                low_at = heights.index(min(heights)) / fps
                high_at = heights.index(max(heights)) / fps
                require(.02 <= low_at <= .07 and .11 <= high_at <= .18,
                        f'Walk body timing: low {low_at:.3f}s, high {high_at:.3f}s after contact')
            require(.087 <= bob <= .093, f'Walk bob is {bob:.4f}')
            shift = {side: sum(xs) / len(xs) for side, xs in stance_x.items()}
            require(shift['L'] > .008 and shift['R'] < -.008,
                    f'Walk hips do not shift over the planted foot: {shift}')
            for side, lift in swing_sole.items():
                require(.045 <= lift <= .075, f'Walk {side} swing boot only clears {lift:.3f}')
            print(f'Walk hips shift {shift["L"]:+.3f} / {shift["R"]:+.3f}; swing boots clear '
                  f'{min(swing_sole.values()):.3f}')
            for side, samples in support.items():
                speed = (samples[8][0] - samples[2][0]) * fps / 6
                flat, peeled = samples[8][1], samples[fps // 4][1]
                pitch = min(flat.rotation_difference(peeled).angle, flat.rotation_difference(-peeled).angle)
                require(abs(speed - 1.2) < .03, f'Walk {side} planted-foot speed is {speed:.4f}')
                require(.62 <= pitch <= .89, f'Walk {side} toe peel is {pitch:.3f} rad')
            print(f'Walk bob {bob:.3f}; both support feet stay planted for .25s and peel toe-last')
        print(f'{name}: root-relative hair tip <= {highest:.3f}, '
              f'hair joint travel {min(hair_motion):.3f} to {max(hair_motion):.3f} radians')


def verify(path):
    data = read_gltf(path)
    rig, clips = load_troll(path)
    expected = {'walk': (1, 1), 'idle': (2, 2), 'dance': (2.9, 3.1)}
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
    verify_dance(rig, clips)
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
