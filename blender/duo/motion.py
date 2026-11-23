"""Clips for both characters, authored from the numbers in params.py (`motion` namespaces).

One module for A and B: a gait generator (walk and skip share it), idle, the dance timeline with the shared
beat markers, and B's look. Legs are solved with a two-bone IK onto ground-fixed foot targets (the foot
treadmills back at 1.2 units/s during stance, so planted feet do not slip), hair is baked as underdamped
springs lagged behind the head. Nothing is scaled: squash and stretch are the runtime's job (on `root`),
and rigid props on the hands must stay rigid.

Axes: armature space (Blender): X = the character's left, -Y = forward, Z up. Angles in radians, lengths in
normalised units. `Pose` fields:
    height, shift   root translation (up, sideways)        yaw        root turn about Z
    pitch, bank     spine lean forward / sideways          twist      spine turn about Z
    head            extra head rotation (x, y, z)           arms       arm lift away from the body (L, R)
    swing           arm swing forward/back (L, R)           reach      shoulder rise (L, R)
    feet            page-space foot offsets (dx, dy, dz, pitch) per side from the rest ankle
"""
import math
from typing import NamedTuple

import bpy
from mathutils import Euler, Vector

from common import ease
from params import (CLIPS, DANCE_BOW, DANCE_HOLD, DANCE_LAND, DANCE_LENGTH, DANCE_TURN, FPS, WALK_SPEED)

TAU = math.tau
HEEL_FRACTION = .75           # heel lifts after this share of the stance
TOE_PITCH = .76
CYCLIC = ('walk', 'skip', 'idle')
ZERO_FOOT = (0., 0., 0., 0.)


class Pose(NamedTuple):
    height: float = 0.
    shift: float = 0.
    yaw: float = 0.
    pitch: float = 0.
    bank: float = 0.
    twist: float = 0.
    head: tuple = (0., 0., 0.)
    arms: tuple = (0., 0.)
    swing: tuple = (0., 0.)
    reach: tuple = (0., 0.)
    feet: tuple = ()


def lerp(a, b, t):
    return a + (b - a) * t


# --- curves ---------------------------------------------------------------------------------------------

def monotone(keys, t):
    """Piecewise cubic Hermite with Fritsch-Carlson slopes: no overshoot between keys, and flat spans
    (equal neighbouring keys) stay exactly flat."""
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    slopes = [(b - a) / (tb - ta) for (ta, a), (tb, b) in zip(keys, keys[1:])]
    tangents = [slopes[0]] + [0 if a * b <= 0 else 2 * a * b / (a + b) for a, b in zip(slopes, slopes[1:])] + [slopes[-1]]
    tangents[0] = tangents[-1] = 0.
    for i, ((ta, a), (tb, b)) in enumerate(zip(keys, keys[1:])):
        if t <= tb:
            h = tb - ta
            s = (t - ta) / h
            return ((2 * s ** 3 - 3 * s * s + 1) * a + (s ** 3 - 2 * s * s + s) * h * tangents[i]
                    + (-2 * s ** 3 + 3 * s * s) * b + (s ** 3 - s * s) * h * tangents[i + 1])
    raise ValueError(t)


def mix(a, b, t):
    return tuple(lerp(x, y, t) for x, y in zip(a, b))


# --- gait ------------------------------------------------------------------------------------------------

def bob_shape(g, t):
    """Body height of the gait in 0..1: low just after contact, high before toe-off, a second low-ish beat."""
    half = g.cycle / 2
    phase = t % half
    low, high = 2 / FPS, 7 / FPS
    mid = round(.54 * half * FPS) / FPS
    beats = ((0., .2333), (low, 0.), (high, 1.), (mid, .4833), (half, .2333))
    for (start, a), (end, b) in zip(beats, beats[1:]):
        if phase <= end:
            return a + (b - a) * ease((phase - start) / (end - start))
    return beats[-1][1]


def heel_roll(sole, pitch):
    """Pivot about the leading point of the rolled sole and keep the lowest wool on the page."""
    c, s = math.cos(pitch), math.sin(pitch)
    toe_c, toe_s = math.cos(TOE_PITCH), math.sin(TOE_PITCH)
    y, z = min(sole, key=lambda q: q[0] * toe_s + q[1] * toe_c)
    dy = y - (y * c - z * s)
    dz = min(q[1] for q in sole) - min(q[0] * s + q[1] * c for q in sole)
    return dy, dz


def foot_step(g, tau, sole, flare, speed=WALK_SPEED):
    """Page-space foot offset `tau` seconds after this foot's contact."""
    stance = g.stance
    span = speed * stance / 2
    if tau <= stance:
        fore = speed * tau - span
        heel = HEEL_FRACTION * stance
        if tau <= heel:
            return (0., fore, 0., 0.)
        pitch = TOE_PITCH * ease((tau - heel) / (stance - heel))
        dy, dz = heel_roll(sole, pitch)
        return (0., fore + dy, dz, pitch)
    t = (tau - stance) / (g.cycle - stance)
    dy, dz = heel_roll(sole, TOE_PITCH)
    progress = ease(t) - .08 * math.sin(math.pi * t) ** 2           # let the support foot take the next contact
    fore = (span + dy) * (1 - progress) - span * progress
    lower = ease(min(1, max(0, (t - .52) / .40)))
    lift = dz * (1 - progress) + (g.lift * (1 - .6 * lower) + getattr(g, 'tuck', 0.)) * math.sin(math.pi * t) ** 1.1
    pitch = TOE_PITCH * (1 - ease(min(1, t / .72))) - .24 * math.sin(math.pi * t) ** 2
    return (flare * math.sin(math.pi * t ** 1.38) ** 1.65, fore, lift, pitch)


def walk_pose(p, t, sole):
    g = p.motion.walk
    w = TAU * t / g.cycle
    shape = bob_shape(g, t)
    height = g.bob * shape
    pitch = g.lean + g.lean_mod * (1 - 2 * shape)
    bank = g.bank * math.sin(w + .38)
    swing = g.swing * math.cos(w + .25)
    lift = g.arm_in + g.arm_bounce * (2 * shape - 1)
    feet = ()
    if sole:
        feet = (foot_step(g, t % g.cycle, sole[0], g.flare), foot_step(g, (t + g.cycle / 2) % g.cycle, sole[1], -g.flare))
    return Pose(height=height, shift=g.sway * math.sin(TAU * (t + g.stance / 2) / g.cycle), pitch=pitch, bank=bank,
                head=(-.6 * pitch + g.head_nod * (1 - 2 * shape), -g.head_follow * bank * .9, .19 * bank),
                arms=(lift, lift), swing=(swing, -swing), feet=feet)


def skip_pose(p, t, sole):
    g = p.motion.skip
    half = g.cycle / 2
    u = (t % half) / half
    hop = g.hop * math.sin(math.pi * u)
    side = 1 if (t % g.cycle) < half else -1
    w = TAU * t / g.cycle
    swing = g.swing * math.cos(w + .25)
    lift = g.arm_lift * math.sin(math.pi * u)
    bank = g.bank * side * math.sin(math.pi * u) * .6 + g.bank * .4 * math.sin(w)
    pitch = g.lean + .02 * (1 - 2 * math.sin(math.pi * u))
    feet = ()
    if sole:
        feet = (foot_step(g, t % g.cycle, sole[0], .02), foot_step(g, (t + half) % g.cycle, sole[1], -.02))
    return Pose(height=hop, shift=.02 * math.sin(w + .5), pitch=pitch, bank=bank,
                head=(-.6 * pitch, -.5 * bank, 0.), arms=(lift, lift), swing=(swing, -swing), feet=feet)


def idle_pose(p, t, sole):
    g = p.motion.idle
    w = TAU * t / g.cycle
    breath = .5 - .5 * math.cos(w)
    feet = (ZERO_FOOT, ZERO_FOOT) if sole else ()
    pitch = .02 * breath
    return Pose(height=g.bob * breath + g.bounce * abs(math.sin(w)), shift=g.sway * math.sin(w), pitch=pitch,
                bank=g.bank * math.sin(w - .6), head=(-.6 * pitch, 0., g.head_turn * math.sin(w - .9)),
                swing=(g.arm_sway * math.sin(w), -g.arm_sway * math.sin(w)),
                arms=(.02 * breath, .02 * breath), feet=feet)


def look_pose(p, t, sole):
    g = p.motion.look
    phase = t / g.duration
    wave = math.sin(TAU * phase)
    lag = math.sin(TAU * max(0., phase - .06)) if phase > .06 else 0.
    feet = (ZERO_FOOT, ZERO_FOOT) if sole else ()
    return Pose(yaw=0., twist=g.body * lag, pitch=.03 * math.sin(math.pi * phase),
                head=(0., 0., g.yaw * wave), feet=feet, arms=(.02, .02))


# --- dance -------------------------------------------------------------------------------------------------

RAMP_UP, RAMP_DOWN = .08, .14
TURN_NORM = 1 - .5 * RAMP_UP - .5 * RAMP_DOWN
TURN_THRESHOLD = .05          # rad: the marker "turn start" is the first time the root yaw passes this


def _turn_yaw(start):
    """Full turn from `start` to the low landing: quick wind-up, near-constant rate, soft finish."""
    length = DANCE_LAND - start
    b = 1 - RAMP_DOWN

    def yaw(t):
        u = min(1., max(0., (t - start) / length))
        if u < RAMP_UP:
            value = .5 * u * u / RAMP_UP
        elif u < b:
            value = .5 * RAMP_UP + (u - RAMP_UP)
        else:
            value = .5 * RAMP_UP + (b - RAMP_UP) + (u - b) - .5 * (u - b) ** 2 / RAMP_DOWN
        return TAU * value / TURN_NORM
    return yaw


def _calibrated_turn():
    """Start the turn early enough that the yaw passes the threshold exactly at DANCE_TURN."""
    start = DANCE_TURN
    for _ in range(30):
        u0 = math.sqrt(2 * RAMP_UP * TURN_THRESHOLD * TURN_NORM / TAU)
        start = DANCE_TURN - (DANCE_LAND - start) * u0
    return _turn_yaw(start)


TURN = None


def dance_keys(d):
    """Channel key lists (time, value) for the shared dance timeline, scaled by the character's numbers."""
    S, H, L, A = d.step, d.hop, d.land, d.arms
    b, sp = d.bank, d.spread
    hold_end = DANCE_BOW + DANCE_HOLD
    bow_x, bow_z = .4 * S, .42 * L
    return {
        'x': [(0, 0), (.16, -.2 * S), (.46, S), (.70, S), (.92, .9 * S), (1.05, .6 * S), (1.30, .3 * S),
              (1.52, .05 * S), (DANCE_LAND, 0), (1.95, .25 * S), (2.20, bow_x), (2.54, bow_x), (2.80, .13 * S),
              (DANCE_LENGTH, 0)],
        'z': [(0, 0), (.16, .2 * L), (.46, 0), (.70, 0), (.92, .5 * L), (1.05, .55 * H), (1.30, H), (1.52, .35 * H),
              (DANCE_LAND, L), (1.95, .4 * L), (2.20, bow_z), (2.54, bow_z), (2.80, .17 * L), (DANCE_LENGTH, 0)],
        'bank': [(0, 0), (.16, .06 * b), (.46, -.10 * b), (.70, -.11 * b), (.92, 0), (1.30, .05 * b), (1.67, 0),
                 (1.95, .08 * b), (2.20, .15 * b), (2.54, .15 * b), (2.80, .04 * b), (DANCE_LENGTH, 0)],
        'pitch': [(0, 0), (.16, .05), (.46, 0), (.70, -.03), (.92, .10), (1.05, -.02), (1.30, -.06), (1.52, .02),
                  (DANCE_LAND, .16), (1.95, .12), (2.20, d.bow_pitch), (2.54, d.bow_pitch), (2.80, .07),
                  (DANCE_LENGTH, 0)],
        'armL': [(0, 0), (.16, .35), (.46, .9 * A), (.70, A), (.92, .55), (1.05, 1.9), (1.30, 2.9), (1.52, 1.8),
                 (DANCE_LAND, .15), (1.95, 1.6), (2.20, d.bow_arms[0]), (2.54, d.bow_arms[0]), (2.80, .8),
                 (DANCE_LENGTH, 0)],
        'armR': [(0, 0), (.16, .25), (.46, .45), (.70, .5), (.92, .55), (1.05, 1.6), (1.30, 2.9), (1.52, 2.0),
                 (DANCE_LAND, .15), (1.95, 1.8), (2.20, d.bow_arms[1]), (2.54, d.bow_arms[1]), (2.80, .9),
                 (DANCE_LENGTH, 0)],
        'swingL': [(0, 0), (.16, .2), (.46, -.1), (.70, -.1), (.92, .55), (1.30, -.4), (DANCE_LAND, .15),
                   (2.20, -.3), (2.54, -.3), (2.80, .05), (DANCE_LENGTH, 0)],
        'swingR': [(0, 0), (.16, .1), (.46, .2), (.70, .3), (.92, .55), (1.30, -.2), (DANCE_LAND, .15),
                   (2.20, .2), (2.54, .2), (2.80, .05), (DANCE_LENGTH, 0)],
        'reachL': [(0, 0), (.46, .045), (.70, .06), (.92, 0), (1.30, .07), (1.52, .02), (2.20, .03), (2.54, .03),
                   (DANCE_LENGTH, 0)],
        'reachR': [(0, 0), (.92, 0), (1.30, .07), (1.52, .02), (2.20, .03), (2.54, .03), (DANCE_LENGTH, 0)],
        'head': [(0, 0), (.46, -.08), (.92, 0), (2.20, -.10), (2.54, -.10), (DANCE_LENGTH, 0)],
    }


def dance_feet(d, channels):
    """Foot keys: ('g', dx, dy, dz, pitch) are page-space (planted or stepping); ('a', ...) travel with the body."""
    sp, S = d.spread, d.step
    wide = .15 * sp
    L = [
        (0, ('g', 0, 0, 0, 0)), (.16, ('g', 0, 0, 0, 0)), (.31, ('g', .65 * S, -.01, .045, -.12)),
        (.46, ('g', 1.3 * S, 0, 0, 0)), (.92, ('g', 1.0 * S, 0, 0, 0)),
        (1.05, ('a', 0, 0, -.015, -.25)), (1.30, ('a', .02 * sp, 0, .02, -.35)), (1.52, ('a', 0, 0, .01, -.2)),
        (DANCE_LAND, ('g', 0, 0, 0, 0)), (DANCE_LENGTH, ('g', 0, 0, 0, 0)),
    ]
    R = [
        (0, ('g', 0, 0, 0, 0)), (.16, ('g', 0, 0, 0, 0)), (.46, ('g', 0, 0, 0, 0)), (.60, ('g', .8 * S, 0, .03, -.1)),
        (.70, ('g', .6 * S, 0, 0, 0)), (.92, ('g', .5 * S, 0, 0, 0)),
        (1.05, ('a', 0, .01, 0, -.35)), (1.30, ('a', -.02 * sp, .015, .04, -.40)), (1.52, ('a', 0, 0, .02, -.2)),
        (DANCE_LAND, ('g', 0, 0, 0, 0)), (1.95, ('g', -.06 * sp, .02, .05, -.15)),
        (DANCE_BOW + .01, ('g', -wide, .045, .095, -.35)), (DANCE_BOW + DANCE_HOLD + .01, ('g', -wide, .045, .095, -.35)),
        (2.80, ('g', -.06 * sp, .015, .045, -.12)), (DANCE_LENGTH, ('g', 0, 0, 0, 0)),
    ]
    out = []
    for keys in (L, R):
        converted = [[], [], [], []]
        for t, (kind, dx, dy, dz, pitch) in keys:
            if kind == 'a':
                dx += monotone(channels['x'], t)
                dz += monotone(channels['z'], t)
            for series, value in zip(converted, (dx, dy, dz, pitch)):
                series.append((t, value))
        out.append(converted)
    return out


_DANCE_CACHE = {}


def dance_pose(p, t, sole):
    global TURN
    if TURN is None:
        TURN = _calibrated_turn()
    d = p.motion.dance
    if p.key not in _DANCE_CACHE:
        channels = dance_keys(d)
        _DANCE_CACHE[p.key] = (channels, dance_feet(d, channels))
    channels, foot_keys = _DANCE_CACHE[p.key]
    at = lambda name: monotone(channels[name], t)
    pitch = at('pitch')
    bank = at('bank')
    feet = ()
    if sole:
        feet = tuple(tuple(monotone(series, t) for series in side) for side in foot_keys)
    return Pose(height=at('z'), shift=at('x'), yaw=TURN(t), pitch=pitch, bank=bank,
                head=(-.45 * pitch, -.47 * bank, .19 * bank + at('head')),
                arms=(at('armL'), at('armR')), swing=(at('swingL'), at('swingR')),
                reach=(at('reachL'), at('reachR')), feet=feet)


POSES = {'walk': walk_pose, 'skip': skip_pose, 'idle': idle_pose, 'look': look_pose, 'dance': dance_pose}


def duration(p, clip):
    if clip == 'dance':
        return DANCE_LENGTH
    return {'walk': lambda: p.motion.walk.cycle, 'skip': lambda: p.motion.skip.cycle,
            'idle': lambda: p.motion.idle.cycle, 'look': lambda: p.motion.look.duration}[clip]()


# --- hair --------------------------------------------------------------------------------------------------

YAW_DELAY = (.005, .040, .112, .300)
YAW_LIMIT = (.20, .70, 1.5, 2.6)


def head_orientation(p, clip, t):
    """Net armature-axis rotation of the head (spine + head + root yaw) and the root height."""
    pose = POSES[clip](p, t, None)
    return (Vector((pose.pitch + pose.head[0], pose.bank + pose.head[1], pose.yaw + pose.twist + pose.head[2])),
            pose.height)


def hair_motion(p, clip, length, droop_axis):
    """Bake the plume as a lagged copy of the head pose on underdamped springs (per-joint local rotations)."""
    h = p.motion.hair
    cycle = clip in CYCLIC
    frames = round(length * FPS)
    clock = range(-FPS * 4 if cycle else 0, frames + 1)
    sub = 4
    dt = 1 / (FPS * sub)
    position = [Vector((0, 0, 0)) for _ in range(4)]
    velocity = [Vector((0, 0, 0)) for _ in range(4)]
    samples = []

    def source(t):
        return head_orientation(p, clip, t % length if cycle else max(0., min(length, t)))

    def lift_accel(t, step=1 / 96):
        return (source(t + step)[1] + source(t - step)[1] - 2 * source(t)[1]) / step ** 2

    for frame in clock:
        for s in range(sub):
            time = (frame + (s + 1 - sub) / sub) / FPS
            head, _ = source(time)
            for k in range(4):
                lagged, _ = source(time - h.delay[k])
                target = (lagged - head) * h.follow[k]
                accel = max(-12, min(12, lift_accel(time - h.delay[k])))
                target += droop_axis * (.016 * h.droop[k] * h.bounce * accel)
                if clip == 'idle':
                    phase = math.pi * time - .55 * k
                    target += Vector((.030 * math.sin(phase), .018 * math.sin(phase - .4), 0)) * h.droop[k]
                limit = h.limit[k]
                for axis in range(2):
                    target[axis] = limit * math.tanh(target[axis] / limit)
                limit = YAW_LIMIT[k]
                target.z = limit * math.tanh((source(time - YAW_DELAY[k])[0].z - head.z) / limit)
                omega = h.omega[k]
                velocity[k] += (omega ** 2 * (target - position[k]) - 2 * h.damping * omega * velocity[k]) * dt
                position[k] += velocity[k] * dt
        if frame >= 0:
            samples.append([position[k] - (position[k - 1] if k else Vector((0, 0, 0))) for k in range(4)])
    if cycle:
        samples[-1] = samples[0]
    else:
        for i in range(FPS // 4):
            frame = len(samples) - 1 - i
            samples[frame] = [value * ease(i / (FPS // 4)) for value in samples[frame]]
    return samples


# --- rig application -------------------------------------------------------------------------------------

def rotate(pose_bone, xyz):
    """Set a bone rotation given as an armature-axis Euler vector."""
    rest = pose_bone.bone.matrix_local.to_quaternion()
    pose_bone.rotation_quaternion = rest.inverted() @ Euler(xyz, 'XYZ').to_quaternion() @ rest


def solve_leg(hip, knee, ankle, offsets, height, shift):
    dx, dy, dz, pitch = offsets
    # Page offsets become root-space targets: undo the hip shift and the height.
    target = ankle + Vector((dx - shift, dy, dz - height))
    upper, lower = knee - hip, ankle - knee
    a, b = upper.length, lower.length
    reach = target - hip
    distance = min(reach.length, a + b - .00015)
    aim = reach.normalized()
    outward = 1.65 * max(0, min(1, (abs(dx) - .056) / .062))      # wide side steps fold the knee outward
    front = Vector((math.copysign(outward, dx), -1, 0)).normalized()
    pole = (front - aim * front.dot(aim)).normalized()
    along = (a * a - b * b + distance * distance) / (2 * distance)
    bend = math.sqrt(max(0, a * a - along * along))
    solved_upper = aim * along + pole * bend
    solved_lower = aim * distance - solved_upper
    return upper.rotation_difference(solved_upper), lower.rotation_difference(solved_lower), Euler((pitch, 0, 0)).to_quaternion()


def leg_pose(bones, side, offsets, height, shift):
    thigh, calf, foot = (bones[f'{stem}_{side}'] for stem in ('leg', 'shin', 'foot'))
    hip, knee, ankle = (joint.bone.head_local for joint in (thigh, calf, foot))
    thigh_q, calf_q, foot_q = solve_leg(hip, knee, ankle, offsets, height, shift)
    for bone, parent_q, q in ((thigh, None, thigh_q), (calf, thigh_q, calf_q), (foot, calf_q, foot_q)):
        rest = bone.bone.matrix_local.to_quaternion()
        relative = parent_q.inverted() @ q if parent_q else q
        bone.rotation_quaternion = rest.inverted() @ relative @ rest


def sole_profiles(rig, body, p):
    """Sole outline (y, z relative to the ankle) of each foot, from the skinned mesh's lowest band."""
    mid = rig.data.bones['spine'].head_local.x
    out = []
    for side, sign in (('L', 1), ('R', -1)):
        ankle = rig.data.bones[f'foot_{side}'].head_local
        out.append([(v.co.y - ankle.y, v.co.z - ankle.z) for v in body.data.vertices
                    if v.co.z <= p.sole_top and (v.co.x - mid) * sign > 0])
    return out


def make_clips(rig, body, p):
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    animation = rig.animation_data_create()
    bones = rig.pose.bones
    for bone in bones:
        bone.rotation_mode = 'QUATERNION'
    sole = sole_profiles(rig, body, p)
    sweep = rig.data.bones['hair_3'].tail_local - rig.data.bones['hair_0'].head_local
    droop_axis = Vector((-sweep.y, sweep.x, 0)).normalized()
    scene.frame_end = FPS * 3

    for name in CLIPS[p.key]:
        length = duration(p, name)
        frames = round(length * FPS)
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        action.use_frame_range = True
        action.frame_start, action.frame_end = 0, frames
        action.use_cyclic = name in CYCLIC
        animation.action = action
        hair = hair_motion(p, name, length, droop_axis)
        previous = {}
        for frame in range(frames + 1):
            t = frame / FPS
            pose = POSES[name](p, t, sole)
            root = bones['root']
            rotate(root, (0, 0, pose.yaw))
            root.location = root.bone.matrix_local.to_quaternion().inverted() @ Vector((pose.shift, 0, pose.height))
            rotate(bones['spine'], (pose.pitch, pose.bank, pose.twist))
            rotate(bones['head'], pose.head)
            for index, side in enumerate(('L', 'R')):
                sign = 1 if side == 'L' else -1
                arm = bones[f'arm_{side}']
                rotate(arm, (pose.swing[index], -sign * pose.arms[index], .04 * sign * pose.arms[index]))
                rise = pose.reach[index]
                arm.location = arm.bone.matrix_local.to_quaternion().inverted() @ Vector((sign * .28 * rise, 0, rise))
                arm.keyframe_insert('location', frame=frame, group=arm.name)
                if pose.feet:
                    leg_pose(bones, side, pose.feet[index], pose.height, pose.shift)
            for k, value in enumerate(hair[frame]):
                rotate(bones[f'hair_{k}'], value)
            for bone in bones:
                rotation = bone.rotation_quaternion.copy()
                if bone.name in previous:
                    rotation.make_compatible(previous[bone.name])
                bone.rotation_quaternion = rotation
                previous[bone.name] = rotation
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
            root.keyframe_insert('location', frame=frame, group='root')
        for curve in action.layers[0].strips[0].channelbag(action.slots[0]).fcurves:
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
        print(f'Baked {p.title} {name}: {length:.2f}s, {frames + 1} frames', flush=True)
    animation.action = None
    for bone in bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
    scene.frame_set(0)
