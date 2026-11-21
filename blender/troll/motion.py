"""Author the three clips and bake underdamped secondary motion."""
import math
import bpy
import numpy as np
from mathutils import Euler, Vector

FPS = 48
TAU = math.tau
CLIPS = {'walk': 1, 'idle': 2, 'dance': 5}
WALK_SPEED = 1.2
STANCE = .22


def ease(t):
    return t * t * (3 - 2 * t)


def walk_step(phase):
    if phase <= STANCE:
        return (0, WALK_SPEED * (phase - STANCE / 2), 0, 0)
    t = (phase - STANCE) / (1 - STANCE)
    span = WALK_SPEED * STANCE / 2
    # Small roll off the toes and a quick pickup through the middle of the swing.
    fore = span * (1 - 2 * ease(t)) + .63 * t * (1-t) * (1-2*t)
    lift = .083 * math.sin(math.pi * t) ** 1.4
    pitch = .46 * math.sin(TAU * t) * math.sin(math.pi * t) ** .5
    return (0, fore, lift, pitch)


# Time, pelvis height offset, turn (rev), bank, arm lift, and ankle offsets (x,y,z,pitch).
DANCE = (
    (0, .000, 0, 0, 0, (0, 0, 0, 0), (0, 0, 0, 0)),
    (.30, -.026, -.033, -.14, .32, (0, 0, 0, 0), (0, 0, 0, 0)),
    (.62, .079, .030, .14, 1.60, (.049, -.065, .113, .20), (-.026, .030, .072, -.30)),
    (.88, -.012, .051, .17, 1.48, (.055, -.111, .100, -.21), (0, 0, 0, 0)),
    (1.12, .034, .018, -.09, .98, (.022, -.040, .035, 0), (-.065, .026, .056, .21)),
    (1.42, -.013, -.036, -.20, 1.69, (0, 0, 0, 0), (-.152, .042, .110, -.15)),
    (1.69, -.029, -.072, -.08, .64, (0, .023, 0, 0), (-.106, .079, 0, 0)),
    (1.88, .036, -.025, .20, 1.24, (.025, -.047, .081, .35), (-.023, .063, .062, -.42)),
    (2.05, .094, .189, .10, 1.72, (.022, -.064, .143, .37), (-.032, .046, .095, -.40)),
    (2.24, .106, .504, -.11, 1.75, (.020, -.055, .151, .34), (-.038, .025, .100, -.37)),
    (2.43, .062, .809, -.21, 1.44, (.029, -.036, .099, .16), (-.029, .024, .059, -.27)),
    (2.64, -.029, 1.014, .13, .70, (.022, -.032, 0, 0), (-.020, .021, 0, 0)),
    (2.89, .013, 1.042, .22, 1.43, (.043, -.089, .074, -.24), (-.020, .021, 0, 0)),
    (3.12, -.014, 1.016, .10, 1.18, (.021, -.033, 0, 0), (-.020, .021, 0, 0)),
    (3.32, .045, .960, -.20, 1.57, (.024, .030, .037, -.19), (-.131, .029, .101, .16)),
    (3.57, -.014, .945, -.24, 1.58, (.015, .014, 0, 0), (-.153, .044, .123, -.12)),
    (3.82, .059, .985, .04, 1.65, (.039, -.052, .072, .26), (-.069, .023, .076, .18)),
    (4.06, -.017, 1.017, .10, 1.38, (.021, -.027, 0, 0), (-.021, 0, 0, 0)),
    (4.40, .003, 1.005, .02, .60, (.008, -.010, .008, 0), (-.010, 0, .005, 0)),
    (4.77, 0, 1, 0, 0, (0, 0, 0, 0), (0, 0, 0, 0)),
    (5, 0, 1, 0, 0, (0, 0, 0, 0), (0, 0, 0, 0)),
)


def dance_at(t):
    for a, b in zip(DANCE, DANCE[1:]):
        if t <= b[0]:
            u = (t - a[0]) / (b[0] - a[0])
            s = ease(u)
            # Keep the middle of the turn moving through the authored beats.
            turn_ease = u if 1.88 <= a[0] and b[0] <= 2.64 else s
            height = a[1] + (b[1] - a[1]) * s
            turn = a[2] + (b[2] - a[2]) * turn_ease
            bank = a[3] + (b[3] - a[3]) * s
            hands = a[4] + (b[4] - a[4]) * s
            feet = [tuple(x + (y - x) * s for x, y in zip(a[n], b[n])) for n in (5, 6)]
            return height, turn * TAU, bank, hands, feet
    raise ValueError(t)


def body_pose(clip, t):
    if clip == 'walk':
        cycle = TAU * t
        bob = .015 * -math.cos(cycle * 2 - .55)
        lean = .083 * math.sin(cycle - .25)
        pitch = -.068 + .098 * math.cos(cycle * 2 - .1)
        swing = .51 * math.cos(cycle + .54)
        feet = [walk_step((t + offset) % 1) for offset in (0, .5)]
        return bob, 0, lean, pitch, (0, 0), (swing, -swing), feet
    if clip == 'idle':
        breath = math.sin(math.pi * t)
        feet = [(0, 0, 0, 0)] * 2
        return .0025 * breath, 0, .021 * math.sin(TAU * .5 * t), .019 * breath, (0, 0), (.026 * breath, -.019 * breath), feet
    bob, turn, bank, hands, feet = dance_at(t)
    return bob, turn, bank, -.052 * hands, (hands * .96, hands), (.12 * hands, -.08 * hands), feet


def rotate(pose_bone, xyz):
    rest = pose_bone.bone.matrix_local.to_quaternion()
    pose_bone.rotation_quaternion = rest.inverted() @ Euler(xyz, 'XYZ').to_quaternion() @ rest


def solve_leg(hip, knee, ankle, offsets, bob):
    dx, dy, dz, pitch = offsets
    target = ankle + Vector((dx, dy, dz - bob))
    upper, lower = knee - hip, ankle - knee
    a, b = upper.length, lower.length
    reach = target - hip
    distance = min(reach.length, a + b - .00015)
    aim = reach.normalized()
    # Let the wide side kicks fold out away from the cross-body bag.
    outward = 1.65 * max(0, min(1, (abs(dx) - .056) / .062))
    front = Vector((math.copysign(outward, dx), -1, 0)).normalized()
    pole = (front - aim * front.dot(aim)).normalized()
    along = (a*a - b*b + distance*distance) / (2 * distance)
    bend = math.sqrt(max(0, a*a - along*along))
    solved_upper = aim * along + pole * bend
    solved_lower = aim * distance - solved_upper
    thigh_q = upper.rotation_difference(solved_upper)
    calf_q = lower.rotation_difference(solved_lower)
    return thigh_q, calf_q, Euler((pitch, 0, 0)).to_quaternion()


def leg_pose(bones, side, offsets, bob):
    thigh, calf, foot = [bones[stem + '_' + side] for stem in ('leg', 'shin', 'foot')]
    hip, knee, ankle = [joint.bone.head_local for joint in (thigh, calf, foot)]
    thigh_q, calf_q, foot_q = solve_leg(hip, knee, ankle, offsets, bob)
    for bone, parent_q, q in ((thigh, None, thigh_q), (calf, thigh_q, calf_q),
                              (foot, calf_q, foot_q)):
        rest = bone.bone.matrix_local.to_quaternion()
        relative = parent_q.inverted() @ q if parent_q else q
        bone.rotation_quaternion = rest.inverted() @ relative @ rest


def angles(clip, t):
    bob, yaw, bank, pitch, *_ = body_pose(clip, t)
    return Vector((pitch * .58, -bank * .53, yaw + bank * .22)), bob


def secondary_motion(clip, duration):
    # A head-relative angular spring is driven by head orientation, turn rate and
    # vertical acceleration. Each joint follows the joint before it with a softer spring.
    displacement = [Vector((0, 0, 0)) for _ in range(4)]
    velocity = [v.copy() for v in displacement]
    cycle = clip != 'dance'
    clock = range(-FPS * 4 if cycle else 0, duration * FPS + 1)
    dt = 1 / (FPS * 4)
    samples = []
    for frame in clock:
        for s in range(4):
            time = (frame + (s - 3) / 4) / FPS
            def source(t):
                return angles(clip, t % duration if cycle else max(0, min(duration, t)))
            before, bot = source(time - dt)
            current, mid = source(time)
            after, top = source(time + dt)
            rate = (after - before) / (2 * dt)
            acceleration = (bot + top - 2 * mid) / dt**2
            force = Vector((
                -current.x * .63 - .045 * rate.x - max(-16, min(16, acceleration)) * .012,
                -current.y * .68 - .035 * rate.y + .030 * rate.z,
                -.022 * rate.z,
            ))
            for k in range(4):
                omega = (20, 18, 16, 14)[k]
                drag = .33 if cycle else .43
                target = force * (1.03 - .15 * k)
                if k:
                    target += displacement[k - 1] * .54
                for axis in range(3):
                    target[axis] = max(-.25, min(.25, target[axis]))
                velocity[k] += (omega**2 * (target - displacement[k]) - 2 * drag * omega * velocity[k]) * dt
                displacement[k] += velocity[k] * dt
        if frame >= 0:
            samples.append([value.copy() for value in displacement])
    if cycle:
        samples[-1] = samples[0]
    elif samples:
        for i in range(FPS // 4):
            frame = len(samples) - 1 - i
            samples[frame] = [value * ease(i / (FPS // 4)) for value in samples[frame]]
    return samples


def key_hair_headroom(scene, rig, plume, frame_count):
    # Uniformly compress the plume at the highest part of a bounce. All four
    # hair joints inherit the scale about the crown, so the roots stay seated.
    buffers = [np.empty(len(obj.data.vertices) * 3, dtype=np.float32) for obj in plume]
    scales = []
    for frame in range(frame_count):
        scene.frame_set(frame)
        graph = bpy.context.evaluated_depsgraph_get()
        tip = 0
        for obj, buffer in zip(plume, buffers):
            obj.evaluated_get(graph).data.vertices.foreach_get('co', buffer)
            tip = max(tip, float(buffer[2::3].max()))
        root = rig.pose.bones['root'].head.z
        crown = rig.pose.bones['hair_0'].head.z
        cap = root + .937
        scales.append(min(1, (cap - crown) / (tip - crown)))
    hair_root = rig.pose.bones['hair_0']
    for frame, scale in enumerate(scales):
        hair_root.scale = (scale,) * 3
        hair_root.keyframe_insert('scale', frame=frame, group='hair_0')
    hair_root.scale = (1, 1, 1)


def make_clips(rig, plume):
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = FPS * max(CLIPS.values())
    animation = rig.animation_data_create()
    bones = rig.pose.bones
    for bone in bones:
        bone.rotation_mode = 'QUATERNION'

    for name, duration in CLIPS.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        action.use_frame_range = True
        action.frame_start, action.frame_end = 0, duration * FPS
        action.use_cyclic = name != 'dance'
        animation.action = action
        springs = secondary_motion(name, duration)
        prev_rotations = {}
        for frame, hair in enumerate(springs):
            t = frame / FPS
            bob, yaw, bank, pitch, arms, swing, feet = body_pose(name, t)
            root = bones['root']
            rotate(root, (0, 0, yaw))
            root.location = root.bone.matrix_local.to_quaternion().inverted() @ Vector((0, 0, bob))

            spine = bones['spine']
            rotate(spine, (pitch, bank, 0))
            squash = (.035 * -math.cos(TAU * t * 2 - .55) if name == 'walk'
                      else (.009 * math.sin(math.pi * t) if name == 'idle' else .42 * bob))
            spine.scale = (1 - squash * .48, 1 + squash, 1 - squash * .48)
            rotate(bones['head'], (-.42 * pitch, -.47 * bank, .19 * bank))
            rotate(bones['satchel'], (.052 * math.sin(TAU * t - .63) if name == 'walk' else -1.1 * hair[0].x,
                                       -bank * .65 + .79 * hair[0].y, -.33 * hair[0].z))

            for idx, side in enumerate(('L', 'R')):
                sign = 1 if idx == 0 else -1
                rotate(bones['arm_' + side], (swing[idx], -sign * arms[idx], .04 * sign * arms[idx]))
                rotate(bones['scarf_' + side], (hair[0].x * 1.9, -hair[1].x * 1.05 + .42 * bank,
                                                  -hair[1].y * 1.4 + .23 * bank))
                blink = 0
                if name == 'idle':
                    blink = .31 * max(0, 1 - abs(t - 1.21 - .025 * idx) / .11) ** 1.4
                rotate(bones['eye_' + side], (blink, .08 * sign * blink, .10 * sign * blink))
                leg_pose(bones, side, feet[idx], bob)
            for k, value in enumerate(hair):
                rotate(bones[f'hair_{k}'], value)
            for bone in bones:
                rotation = bone.rotation_quaternion.copy()
                if bone.name in prev_rotations:
                    rotation.make_compatible(prev_rotations[bone.name])
                bone.rotation_quaternion = rotation
                prev_rotations[bone.name] = rotation
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
            root.keyframe_insert('location', frame=frame, group='root')
            spine.keyframe_insert('scale', frame=frame, group='spine')
        key_hair_headroom(scene, rig, plume, len(springs))
        for curve in action.layers[0].strips[0].channelbag(action.slots[0]).fcurves:
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
        print(f'Baked {name}: {duration:.1f}s, {len(springs)} hair samples', flush=True)
    animation.action = None
    for bone in bones:
        bone.matrix_basis.identity()
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
    scene.frame_set(0)
