"""Author the three clips and bake underdamped secondary motion."""
import math
import bpy
import numpy as np
from mathutils import Euler, Vector

FPS = 48
TAU = math.tau
CLIPS = {'walk': 1, 'idle': 2, 'dance': 3}
WALK_SPEED = 1.2
STANCE = .25
HEEL_LIFT = .1875
TOE_PITCH = .76
WALK_RISE = .015


def ease(t):
    return t * t * (3 - 2 * t)


def walk_bob(t):
    phase = t % .5
    # Contact, compression, passing pose, toe-off, then the next contact.
    beats = ((0, -.021), (2 / FPS, -.035), (7 / FPS, .025), (.27, -.006), (.5, -.021))
    for (start, start_height), (end, end_height) in zip(beats, beats[1:]):
        if phase <= end:
            return start_height + (end_height - start_height) * ease((phase - start) / (end - start))


def heel_roll(sole, pitch):
    # Pivot about the leading point of the rolled sole and keep the lowest wool on the page.
    c, s = math.cos(pitch), math.sin(pitch)
    toe_c, toe_s = math.cos(TOE_PITCH), math.sin(TOE_PITCH)
    y, z = min(sole, key=lambda p: p[0] * toe_s + p[1] * toe_c)
    dy = y - (y * c - z * s)
    dz = min(z for _, z in sole) - min(y * s + z * c for y, z in sole)
    return dy, dz


def walk_step(phase, sole, flare):
    span = WALK_SPEED * STANCE / 2
    if phase <= STANCE:
        fore = WALK_SPEED * phase - span
        if phase <= HEEL_LIFT:
            return (0, fore, 0, 0)
        pitch = TOE_PITCH * ease((phase - HEEL_LIFT) / (STANCE - HEEL_LIFT))
        dy, dz = heel_roll(sole, pitch)
        return (0, fore + dy, dz, pitch)

    t = (phase - STANCE) / (1 - STANCE)
    dy, dz = heel_roll(sole, TOE_PITCH)
    # Delay the forward swing until the support foot has absorbed the next contact.
    progress = ease(t) - .08 * math.sin(math.pi * t) ** 2
    fore = (span + dy) * (1 - progress) - span * progress
    lower = ease(min(1, max(0, (t - .48) / .43)))
    lift = dz * (1 - progress) + (.077 - .042 * lower) * math.sin(math.pi * t) ** 1.45
    pitch = TOE_PITCH * (1 - ease(min(1, t / .72))) - .24 * math.sin(math.pi * t) ** 2
    return (flare * math.sin(math.pi * t**1.38) ** 1.65, fore, lift, pitch)


# Time, pelvis height, turn (rev), bank, bow, arm lifts, ankle offsets (x,y,z,pitch).
DANCE = (
    (0, 0, 0, 0, 0, (0, 0), (0, 0, 0, 0), (0, 0, 0, 0)),
    (.16, -.012, -.056, -.10, -.05, (1.15, .35), (0, 0, 0, 0), (-.072, .062, .024, 0)),
    (.38, -.010, -.075, -.18, -.09, (1.98, .53), (0, 0, 0, 0), (-.155, .052, .118, -.15)),
    (.56, -.010, -.075, -.18, -.09, (1.98, .53), (0, 0, 0, 0), (-.155, .052, .118, -.15)),
    (.68, 0, -.100, -.07, 0, (.93, .58), (0, 0, 0, 0), (-.121, .071, 0, 0)),
    (.88, -.034, -.100, -.10, .14, (.65, .83), (0, 0, 0, 0), (-.121, .071, 0, 0)),
    (1.02, .051, -.100, .19, -.10, (1.37, 1.36), (.016, -.038, .082, .39), (-.109, .068, .092, -.20)),
    (1.21, .111, .445, .06, -.15, (1.57, 1.78), (.026, -.047, .141, .34), (-.092, .064, .129, -.32)),
    (1.37, .059, .820, -.15, -.08, (1.32, 1.44), (.012, -.014, .065, .12), (-.121, .052, .100, -.17)),
    (1.55, -.021, 1.000, -.20, -.04, (1.70, .82), (0, -.016, 0, 0), (-.147, .059, .081, -.12)),
    (1.85, -.021, 1.000, -.20, -.04, (1.70, .82), (0, -.016, 0, 0), (-.147, .059, .081, -.12)),
    (2.06, -.006, 1.000, 0, 0, (.76, .71), (0, -.016, 0, 0), (-.115, .067, 0, 0)),
    (2.32, -.026, 1.000, -.025, .39, (.72, .66), (0, -.016, 0, 0), (-.115, .067, 0, 0)),
    (2.72, -.026, 1.000, -.025, .39, (.72, .66), (0, -.016, 0, 0), (-.115, .067, 0, 0)),
    (3, 0, 1.000, 0, 0, (0, 0), (0, 0, 0, 0), (0, 0, 0, 0)),
)


def dance_at(t):
    for a, b in zip(DANCE, DANCE[1:]):
        if t <= b[0]:
            s = ease((t - a[0]) / (b[0] - a[0]))
            height, turn, bank, pitch = (x + (y - x) * s for x, y in zip(a[1:5], b[1:5]))
            # Accelerate through the hop as a single turn, with no pauses at the airborne beats.
            if .99 <= t <= 1.55:
                turn = -.1 + 1.1 * ease((t - .99) / .56)
            hands = tuple(x + (y - x) * s for x, y in zip(a[5], b[5]))
            feet = [tuple(x + (y - x) * s for x, y in zip(a[n], b[n])) for n in (6, 7)]
            return height, turn * TAU, bank, pitch, hands, (.12 * hands[0], -.10 * hands[1]), feet
    raise ValueError(t)


def body_pose(clip, t, sole=()):
    if clip == 'walk':
        cycle = TAU * t
        bob = walk_bob(t)
        lean = .105 * math.sin(cycle + .38)
        pitch = -.040 - .075 * (bob + .005) / .030
        swing = .55 * math.cos(cycle + .25)
        feet = [walk_step(t % 1, sole, .026), walk_step((t + .5) % 1, sole, -.082)] if sole else ()
        return bob + WALK_RISE, 0, lean, pitch, (0, 0), (swing, -swing), feet
    if clip == 'idle':
        breath = math.sin(math.pi * t)
        feet = [(0, 0, 0, 0)] * 2
        return .0025 * breath, 0, .021 * math.sin(TAU * .5 * t), .019 * breath, (0, 0), (.026 * breath, -.019 * breath), feet
    return dance_at(t)


def bag_lift(t):
    # The pouch swings up with the bag-side foot plant, clearing the compressed shin.
    since_plant = (t - .542 + .5) % 1 - .5
    return .036 + .016 * math.exp(-(since_plant / .095)**2)


def rotate(pose_bone, xyz):
    rest = pose_bone.bone.matrix_local.to_quaternion()
    pose_bone.rotation_quaternion = rest.inverted() @ Euler(xyz, 'XYZ').to_quaternion() @ rest


def solve_leg(hip, knee, ankle, offsets, bob, knee_out=0):
    dx, dy, dz, pitch = offsets
    target = ankle + Vector((dx, dy, dz - bob))
    upper, lower = knee - hip, ankle - knee
    a, b = upper.length, lower.length
    reach = target - hip
    distance = min(reach.length, a + b - .00015)
    aim = reach.normalized()
    # Let the wide side kicks fold out away from the cross-body bag.
    outward = 1.65 * max(0, min(1, (abs(dx) - .056) / .062))
    front = Vector((knee_out + math.copysign(outward, dx), -1, 0)).normalized()
    pole = (front - aim * front.dot(aim)).normalized()
    along = (a*a - b*b + distance*distance) / (2 * distance)
    bend = math.sqrt(max(0, a*a - along*along))
    solved_upper = aim * along + pole * bend
    solved_lower = aim * distance - solved_upper
    thigh_q = upper.rotation_difference(solved_upper)
    calf_q = lower.rotation_difference(solved_lower)
    return thigh_q, calf_q, Euler((pitch, 0, 0)).to_quaternion()


def leg_pose(bones, side, offsets, bob, knee_out):
    thigh, calf, foot = [bones[stem + '_' + side] for stem in ('leg', 'shin', 'foot')]
    hip, knee, ankle = [joint.bone.head_local for joint in (thigh, calf, foot)]
    thigh_q, calf_q, foot_q = solve_leg(hip, knee, ankle, offsets, bob, knee_out)
    for bone, parent_q, q in ((thigh, None, thigh_q), (calf, thigh_q, calf_q),
                              (foot, calf_q, foot_q)):
        rest = bone.bone.matrix_local.to_quaternion()
        relative = parent_q.inverted() @ q if parent_q else q
        bone.rotation_quaternion = rest.inverted() @ relative @ rest


def angles(clip, t):
    bob, yaw, bank, pitch, *_ = body_pose(clip, t)
    return Vector((pitch * .58, -bank * .53, yaw + bank * .22)), bob


def secondary_motion(clip, duration):
    # Keep the crown seated. The longer upper locks follow the head on softer springs.
    displacement = [Vector((0, 0, 0)) for _ in range(4)]
    velocity = [v.copy() for v in displacement]
    cycle = clip != 'dance'
    clock = range(-FPS * 4 if cycle else 0, duration * FPS + 1)
    dt = 1 / (FPS * 4)
    gain = (.14 if clip == 'idle' else .047, .145, .78, .64)
    frequency = (28, 23, 16, 15)
    drag = .56 if cycle else .54
    samples = []

    def source(t):
        return angles(clip, t % duration if cycle else max(0, min(duration, t)))

    for frame in clock:
        for s in range(4):
            time = (frame + (s - 3) / 4) / FPS
            before, bot = source(time - dt)
            current, mid = source(time)
            after, top = source(time + dt)
            rate = (after - before) / (2 * dt)
            acceleration = (bot + top - 2 * mid) / dt**2
            if clip == 'walk':
                crown_drive = walk_bob(time - 1 / FPS)
                compression = max(0, (-crown_drive - .020) / .015)
                extension = max(0, (crown_drive - .005) / .020)
                pitch = .26 * compression - .28 * extension
            else:
                pitch = -.64 * current.x - .028 * rate.x - .006 * max(-16, min(16, acceleration))
            force = Vector((pitch, -.86 * current.y + .038 * rate.z, -.022 * rate.z))
            for k, omega in enumerate(frequency):
                target = force * gain[k]
                if k:
                    target += displacement[k - 1] * .07
                for axis in range(3):
                    target[axis] = max(-.25, min(.25, target[axis]))
                velocity[k] += (omega**2 * (target - displacement[k]) - 2 * drag * omega * velocity[k]) * dt
                displacement[k] += velocity[k] * dt
        if frame >= 0:
            samples.append([value.copy() for value in displacement])
    if cycle:
        samples[-1] = samples[0]
    else:
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

    ankle = bones['foot_L'].bone.head_local
    boot = bpy.data.objects['Felt boot and leg L']
    sole = [(point.co.y - ankle.y, point.co.z - ankle.z)
            for point in boot.data.vertices if point.co.z <= .051]

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
            bob, yaw, bank, pitch, arms, swing, feet = body_pose(name, t, sole)
            root = bones['root']
            rotate(root, (0, 0, yaw))
            root.location = root.bone.matrix_local.to_quaternion().inverted() @ Vector((0, 0, bob))

            spine = bones['spine']
            rotate(spine, (pitch, bank, 0))
            squash = (1.20 * (bob - WALK_RISE + .005) if name == 'walk'
                      else (.009 * math.sin(math.pi * t) if name == 'idle' else .42 * bob))
            spine.scale = (1 - squash * .48, 1 + squash, 1 - squash * .48)
            rotate(bones['head'], (-.42 * pitch, -.47 * bank, .19 * bank))
            satchel = bones['satchel']
            rotate(satchel, (.052 * math.sin(TAU * t - .63) if name == 'walk' else -.32 * hair[2].x,
                             -bank * .65 + .23 * hair[2].y, -.12 * hair[2].z))
            satchel_shift = Vector((0, -.012, bag_lift(t))) if name == 'walk' else Vector((0, 0, 0))
            satchel.location = satchel.bone.matrix_local.to_quaternion().inverted() @ satchel_shift
            satchel.keyframe_insert('location', frame=frame, group='satchel')

            for idx, side in enumerate(('L', 'R')):
                sign = 1 if idx == 0 else -1
                rotate(bones['arm_' + side], (swing[idx], -sign * arms[idx], .04 * sign * arms[idx]))
                rotate(bones['scarf_' + side], (hair[1].x * 1.25, -hair[2].x * .27 + .42 * bank,
                                                  -hair[2].y * .34 + .23 * bank))
                blink = 0
                if name == 'idle':
                    blink = .31 * max(0, 1 - abs(t - 1.21 - .025 * idx) / .11) ** 1.4
                rotate(bones['eye_' + side], (blink, .08 * sign * blink, .10 * sign * blink))
                knee_out = -.85 if name == 'walk' and side == 'R' else 0
                leg_pose(bones, side, feet[idx], bob, knee_out)
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
