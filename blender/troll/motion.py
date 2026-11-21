"""Author the three clips and bake underdamped secondary motion."""
import math
from typing import NamedTuple

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
SWING_LIFT = .050
# Front, profile, back (held so a 4 fps capture sees it), profile, finish.
TURN = ((44 / 48, 0), (46 / 48, 0), (53 / 48, .25), (58 / 48, .44), (68 / 48, .56),
        (73 / 48, .75), (82 / 48, 1))
BOW = (105 / 48, 122 / 48)
BOW_POSE = dict(x=.045, z=-.030, bank=.15, pitch=.30, arms=(2.30, 2.50), swing=(-.30, .20),
                stretch=(1.15, 1.12), reach=(.030, .030), feet=((0, 0, 0, 0), (-.150, .045, .095, -.35)))


def ease(t):
    return t * t * (3 - 2 * t)


def walk_bob(t):
    phase = t % .5
    # Contact, compression, high over the support boot, toe-off, then the next contact.
    beats = ((0, -.0315), (2 / FPS, -.0525), (7 / FPS, .0375), (.27, -.009), (.5, -.0315))
    for (start, start_height), (end, end_height) in zip(beats, beats[1:]):
        if phase <= end:
            return start_height + (end_height - start_height) * ease((phase - start) / (end - start))


def walk_shift(t):
    # The hips sit over whichever boot is planted, peaking at mid-stance.
    return .02 * math.sin(TAU * (t + STANCE / 2))


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
    lower = ease(min(1, max(0, (t - .52) / .40)))
    lift = dz * (1 - progress) + (SWING_LIFT - .030 * lower) * math.sin(math.pi * t) ** 1.1
    pitch = TOE_PITCH * (1 - ease(min(1, t / .72))) - .24 * math.sin(math.pi * t) ** 2
    return (flare * math.sin(math.pi * t**1.38) ** 1.65, fore, lift, pitch)


class Pose(NamedTuple):
    height: float
    yaw: float
    bank: float
    pitch: float
    arms: tuple
    swing: tuple
    feet: list
    shift: float = 0
    stretch: tuple = (1, 1)
    reach: tuple = (0, 0)


def _air(dx, dy, dz, pitch):
    return ('body', dx, dy, dz, pitch)


ZERO_FOOT = (0, 0, 0, 0)
# Seconds sit on 48 fps frames. Feet are page offsets from the rest ankle, or
# _air() offsets that travel with the body. Arms: lift (L, R), swing (L, R), stretch (L, R),
# reach (L, R): how far the shoulder rides up the body for an overhead throw.
DANCE_KEYS = (
    dict(t=0),
    # Anticipate, then step out half a body-width and throw the left arm overhead.
    dict(t=7 / 48, x=-.020, z=-.030, bank=-.06, pitch=.06, arms=(.35, .25), swing=(.25, .15)),
    dict(t=14 / 48, x=.030, z=-.002, bank=.02, arms=(1.70, .45), swing=(-.10, .20),
         stretch=(1.10, 1), reach=(.020, 0), feet=((.080, -.005, .055, -.12), ZERO_FOOT)),
    dict(t=21 / 48, x=.110, z=-.020, bank=-.10, pitch=-.04, arms=(2.05, .55), swing=(-.10, .30),
         stretch=(1.55, 1), reach=(.065, 0), feet=((.150, 0, 0, 0), ZERO_FOOT)),
    dict(t=31 / 48, x=.110, z=-.016, bank=-.11, pitch=-.05, arms=(2.10, .60), swing=(-.10, .30),
         stretch=(1.60, 1), reach=(.068, 0), feet=((.150, 0, 0, 0), ZERO_FOOT)),
    dict(t=37 / 48, x=.130, z=-.010, bank=.03, arms=(1.50, .50), swing=(.20, .20),
         stretch=(1.05, 1), reach=(.015, 0), feet=((.150, 0, 0, 0), (.075, 0, .050, -.10))),
    # Gather facing front, then the 0.75 s hop turn: front, profile, back, profile, finish.
    dict(t=44 / 48, x=.150, z=-.060, pitch=.12, arms=(.55, .55), swing=(.55, .55),
         feet=((.150, 0, 0, 0), (.150, 0, 0, 0))),
    dict(t=46 / 48, x=.150, z=-.062, pitch=.13, arms=(.50, .50), swing=(.60, .60),
         feet=((.150, 0, 0, 0), (.150, 0, 0, 0))),
    dict(t=50 / 48, x=.140, z=.020, pitch=-.02, arms=(1.00, 1.00), swing=(-.30, -.30),
         feet=(_air(.010, 0, .012, -.15), _air(.010, 0, .012, -.15))),
    dict(t=54 / 48, x=.110, z=.080, bank=.05, pitch=-.05, arms=(1.90, 1.50), swing=(-.40, -.20),
         stretch=(1.08, 1.04), feet=(_air(.025, 0, .055, -.35), _air(-.030, .015, .070, -.40))),
    dict(t=63 / 48, x=.070, z=.105, pitch=-.06, arms=(2.60, 2.60), stretch=(1.15, 1.15),
         feet=(_air(.040, .020, .080, -.30), _air(-.040, .020, .080, -.30))),
    dict(t=71 / 48, x=.035, z=.070, arms=(1.80, 2.00), swing=(.20, 0), stretch=(1.06, 1.08),
         feet=(_air(.020, -.010, .050, -.20), _air(-.020, 0, .035, -.15))),
    dict(t=82 / 48, x=0, z=-.015, pitch=.06, arms=(1.30, 1.30), swing=(.10, .10)),
    # Land low, rise onto the left boot and hold a crooked bow with both hands raised.
    dict(t=89 / 48, x=0, z=-.075, bank=-.03, pitch=.16, arms=(1.15, 1.25), swing=(.15, .15)),
    dict(t=97 / 48, x=.030, z=-.030, bank=.08, pitch=.12, arms=(1.60, 1.80), swing=(-.10, .10),
         feet=(ZERO_FOOT, (-.060, .020, .050, -.15))),
    dict(t=BOW[0], **BOW_POSE),
    dict(t=BOW[1], **BOW_POSE),
    dict(t=132 / 48, x=.015, z=-.012, bank=.04, pitch=.07, arms=(.80, .90), swing=(.05, .05),
         feet=(ZERO_FOOT, (-.060, .015, .045, -.12))),
    dict(t=3),
)


def _dance_frames():
    keys = []
    for key in DANCE_KEYS:
        x, z = key.get('x', 0), key.get('z', 0)
        feet = []
        for foot in key.get('feet', (ZERO_FOOT, ZERO_FOOT)):
            if foot[0] == 'body':
                _, dx, dy, dz, pitch = foot
                foot = (x + dx, dy, z + dz, pitch)
            feet.append(foot)
        keys.append((key['t'], (x, z, key.get('bank', 0), key.get('pitch', 0)),
                     key.get('arms', (0, 0)), key.get('swing', (0, 0)),
                     key.get('stretch', (1, 1)), feet, key.get('reach', (0, 0))))
    return keys


DANCE = _dance_frames()


def monotone(keys, t):
    # Piecewise cubic Hermite with Fritsch-Carlson slopes: no overshoot between poses.
    times, values = zip(*keys)
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    slopes = [(b - a) / (tb - ta) for (ta, a), (tb, b) in zip(keys, keys[1:])]
    tangents = [0] + [0 if a * b <= 0 else 2 * a * b / (a + b)
                      for a, b in zip(slopes, slopes[1:])] + [0]
    for i, ((ta, a), (tb, b)) in enumerate(zip(keys, keys[1:])):
        if t <= tb:
            h = tb - ta
            s = (t - ta) / h
            return ((2*s**3 - 3*s*s + 1) * a + (s**3 - 2*s*s + s) * h * tangents[i]
                    + (-2*s**3 + 3*s*s) * b + (s**3 - s*s) * h * tangents[i + 1])
    raise ValueError(t)


def dance_at(t):
    for a, b in zip(DANCE, DANCE[1:]):
        if t <= b[0] + 1e-9:
            s = ease(max(0, min(1, (t - a[0]) / (b[0] - a[0]))))

            def mix(p, q):
                return tuple(x + (y - x) * s for x, y in zip(p, q))
            x, z, bank, pitch = mix(a[1], b[1])
            feet = [mix(p, q) for p, q in zip(a[5], b[5])]
            return Pose(z, monotone(TURN, t) * TAU, bank, pitch, mix(a[2], b[2]),
                        mix(a[3], b[3]), feet, x, mix(a[4], b[4]), mix(a[6], b[6]))
    raise ValueError(t)


def body_pose(clip, t, sole=()):
    if clip == 'walk':
        cycle = TAU * t
        bob = walk_bob(t)
        lean = .105 * math.sin(cycle + .38)
        pitch = -.040 - .075 * (bob + .0075) / .045
        swing = math.cos(cycle + .25)
        feet = [walk_step(t % 1, sole, .026), walk_step((t + .5) % 1, sole, -.082)] if sole else ()
        # The satchel-side arm reaches out and forward past the bag on each counter-swing.
        return Pose(bob + WALK_RISE, 0, lean, pitch, (.10, .32), (.70 * swing, -.95 * swing - .08),
                    feet, walk_shift(t))
    if clip == 'idle':
        breath = math.sin(math.pi * t)
        feet = [(0, 0, 0, 0)] * 2
        return Pose(.0025 * breath, 0, .021 * math.sin(TAU * .5 * t), .019 * breath, (0, 0),
                    (.026 * breath, -.019 * breath), feet)
    return dance_at(t)

def bag_lift(t):
    # The pouch swings up with the bag-side foot plant, clearing the compressed shin.
    since_plant = (t - .542 + .5) % 1 - .5
    return .036 + .016 * math.exp(-(since_plant / .095)**2)


def rotate(pose_bone, xyz):
    rest = pose_bone.bone.matrix_local.to_quaternion()
    pose_bone.rotation_quaternion = rest.inverted() @ Euler(xyz, 'XYZ').to_quaternion() @ rest


def solve_leg(hip, knee, ankle, offsets, bob, knee_out=0, shift=0):
    dx, dy, dz, pitch = offsets
    # Page offsets become root-space targets: undo the hip shift and the bob.
    target = ankle + Vector((dx - shift, dy, dz - bob))
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


def leg_pose(bones, side, offsets, bob, knee_out, shift=0):
    thigh, calf, foot = [bones[stem + '_' + side] for stem in ('leg', 'shin', 'foot')]
    hip, knee, ankle = [joint.bone.head_local for joint in (thigh, calf, foot)]
    thigh_q, calf_q, foot_q = solve_leg(hip, knee, ankle, offsets, bob, knee_out, shift)
    for bone, parent_q, q in ((thigh, None, thigh_q), (calf, thigh_q, calf_q),
                              (foot, calf_q, foot_q)):
        rest = bone.bone.matrix_local.to_quaternion()
        relative = parent_q.inverted() @ q if parent_q else q
        bone.rotation_quaternion = rest.inverted() @ relative @ rest


def angles(clip, t):
    bob, yaw, bank, pitch, *_ = body_pose(clip, t)
    return Vector((pitch * .58, -bank * .53, yaw + bank * .22)), bob


def head_orientation(clip, t):
    # Net armature-axis rotation of the head: spine plus head counter-tilt plus root yaw.
    pose = body_pose(clip, t)
    return Vector((.58 * pose.pitch, .53 * pose.bank, pose.yaw + .19 * pose.bank)), pose.height


# Per hair joint: delay behind the head (s), spring (rad/s), share of the follow-through.
HAIR_DELAY = (.012, .030, .048, .088)
HAIR_OMEGA = (34, 30, 27, 23)
HAIR_FOLLOW = (.25, .62, 1, 1)
HAIR_DROOP = (.05, .30, .65, 1)
HAIR_LIMIT = (.06, .22, .42, .58)
# Yaw follow-through (cumulative delay and limit): each clump tip ends on a later joint.
HAIR_YAW_DELAY = (.005, .040, .112, .300)
HAIR_YAW_LIMIT = (.20, .70, 1.5, 2.6)
HAIR_DAMPING = .30


def hair_motion(clip, duration, droop_axis):
    """Bake the plume as a lagged copy of the head pose on underdamped springs.

    Joint k aims where the head pointed HAIR_DELAY[k] seconds ago, so the outer
    locks start a turn after the crown and swing once past rest when it stops.
    Returns local per-joint rotations (armature-axis Euler vectors).
    """
    cycle = clip != 'dance'
    clock = range(-FPS * 4 if cycle else 0, duration * FPS + 1)
    sub = 4
    dt = 1 / (FPS * sub)
    position = [Vector((0, 0, 0)) for _ in range(4)]
    velocity = [Vector((0, 0, 0)) for _ in range(4)]
    samples = []

    def source(t):
        return head_orientation(clip, t % duration if cycle else max(0, min(duration, t)))

    def lift_accel(t, h=1 / 96):
        return (source(t + h)[1] + source(t - h)[1] - 2 * source(t)[1]) / h**2

    for frame in clock:
        for s in range(sub):
            time = (frame + (s + 1 - sub) / sub) / FPS
            head, _ = source(time)
            for k in range(4):
                lagged, _ = source(time - HAIR_DELAY[k])
                target = (lagged - head) * HAIR_FOLLOW[k]
                # Upward acceleration of the crown bends the plume down along its sweep.
                target += droop_axis * (.016 * HAIR_DROOP[k] * max(-12, min(12, lift_accel(time - HAIR_DELAY[k]))))
                if clip == 'idle':
                    phase = math.pi * time - .55 * k
                    target += Vector((.030 * math.sin(phase), .018 * math.sin(phase - .4), 0)) * HAIR_DROOP[k]
                limit = HAIR_LIMIT[k]
                for axis in range(2):
                    target[axis] = limit * math.tanh(target[axis] / limit)
                limit = HAIR_YAW_LIMIT[k]
                target.z = limit * math.tanh((source(time - HAIR_YAW_DELAY[k])[0].z - head.z) / limit)
                omega = HAIR_OMEGA[k]
                velocity[k] += (omega**2 * (target - position[k])
                                - 2 * HAIR_DAMPING * omega * velocity[k]) * dt
                position[k] += velocity[k] * dt
        if frame >= 0:
            samples.append([position[k] - (position[k - 1] if k else Vector((0, 0, 0)))
                            for k in range(4)])
    if cycle:
        samples[-1] = samples[0]
    else:
        for i in range(FPS // 4):
            frame = len(samples) - 1 - i
            samples[frame] = [value * ease(i / (FPS // 4)) for value in samples[frame]]
    return samples


def secondary_motion(clip, duration):
    # Scarf tails and satchel: the crown-seated springs that used to drive the hair.
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
                compression = max(0, (-crown_drive - .030) / .0225)
                extension = max(0, (crown_drive - .0075) / .030)
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
    # Droop axis: horizontal, across the plume's sweep (Z x sweep).
    sweep = rig.data.bones['hair_3'].tail_local - rig.data.bones['hair_0'].head_local
    droop_axis = Vector((-sweep.y, sweep.x, 0)).normalized()

    for name, duration in CLIPS.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        action.use_frame_range = True
        action.frame_start, action.frame_end = 0, duration * FPS
        action.use_cyclic = name != 'dance'
        animation.action = action
        springs = secondary_motion(name, duration)
        plume_follow = hair_motion(name, duration, droop_axis)
        prev_rotations = {}
        for frame, (hair, locks) in enumerate(zip(springs, plume_follow)):
            t = frame / FPS
            pose = body_pose(name, t, sole)
            bob, yaw, bank, pitch, arms, swing, feet = pose[:7]
            root = bones['root']
            rotate(root, (0, 0, yaw))
            root.location = (root.bone.matrix_local.to_quaternion().inverted()
                             @ Vector((pose.shift, 0, bob)))

            spine = bones['spine']
            rotate(spine, (pitch, bank, 0))
            squash = (1.0 * (bob - WALK_RISE + .0075) if name == 'walk'
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
                arm = bones['arm_' + side]
                rotate(arm, (swing[idx], -sign * arms[idx], .04 * sign * arms[idx]))
                # Stubby felt arms stretch along their length when thrown overhead.
                stretch = pose.stretch[idx]
                arm.scale = (1 / stretch ** .5, stretch, 1 / stretch ** .5)
                arm.keyframe_insert('scale', frame=frame, group=arm.name)
                rise = pose.reach[idx]
                arm.location = (arm.bone.matrix_local.to_quaternion().inverted()
                                @ Vector((sign * .28 * rise, 0, rise)))
                arm.keyframe_insert('location', frame=frame, group=arm.name)
                rotate(bones['scarf_' + side], (hair[1].x * 1.25, -hair[2].x * .27 + .42 * bank,
                                                  -hair[2].y * .34 + .23 * bank))
                blink = 0
                if name == 'idle':
                    blink = .31 * max(0, 1 - abs(t - 1.21 - .025 * idx) / .11) ** 1.4
                rotate(bones['eye_' + side], (blink, .08 * sign * blink, .10 * sign * blink))
                knee_out = -.85 if name == 'walk' and side == 'R' else 0
                leg_pose(bones, side, feet[idx], bob, knee_out, pose.shift)
            for k, value in enumerate(locks):
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
