"""Per-character parameters for the duo pipeline (contract "Round 6" -> Characters).

Everything that differs between lead A and companion B is data here; the build, the face, the motion
and the inspector read it and contain no per-character branches.

Landmarks are measured on the raw Tripo meshes after the -90 degree turn about Z that makes them face
-Y (Blender; glTF +Z), in raw mesh units (the mesh is 1.0 tall, soles at z = -0.5). The `x` of paired
landmarks is a half-offset from `mid_x`. They were read off front and side silhouette renders with a 0.1
grid and refined against the baked texture (eye domes sit on the painted eyes, see the turntable sheets).
"""
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SOURCE = HERE / 'source'
OUTPUT = REPO / 'build/duo-r6'

FPS = 50                       # clip sampling rate: 0.8, 0.6, 1.0, 3.0 s and the contacts land on frames
WALK_SPEED = 1.2               # contract: root-in-place clips match 1.2 units/s
MAX_TRIANGLES = 20_000
BODY_TRIANGLES = 17_500        # decimation target for the Tripo body; face, lids, umbrella fit under the cap
TEXTURE_MAX = 1024

# Contract palette (docs/contracts.md "Look targets")
PALETTE = {
    'tomato': '#D9453B', 'pink': '#F4A6C8', 'hot_pink': '#E8478F', 'butter': '#F7DC6F',
    'sky': '#7EC8E8', 'lime': '#A7D84A', 'orange': '#F59A3C', 'mint': '#9EE0B8', 'violet': '#7A52C7',
    'cream': '#FFF8EC',
}

A = SimpleNamespace(
    key='a',
    raw=SOURCE / 'a_raw.glb',
    out='troll.glb',
    title='Lead A',
    body_height=0.58,                      # soles to crown (the band tying the hair), 0.5-0.6
    crown=0.14,                            # raw z of the crown: the lime band's lower edge
    crown_blend=0.012,                     # raw height over which skin hands over to hair_0
    # Face classification on the texture colour at the face centre: (hue range, min saturation,
    # raw z window). Hair also takes the lime band that ties it; knit is the lime pinafore below it.
    hair_rules=(((0.50, 0.62), 0.25, (-1, 1)), ((0.17, 0.32), 0.45, (0.10, 1))),
    knit_rules=(((0.17, 0.32), 0.45, (-1, 0.0)),),
    # Joints (raw): x half-offsets from the sole midpoint, y and z absolute.
    mid_x=0.0,
    shoulder=(0.115, 0.012, -0.205),
    wrist=(0.185, 0.012, -0.262),
    hand_tip=(0.240, 0.012, -0.285),
    neck=(0.0, 0.004, -0.170),
    hip_x=0.075,
    hip_height=0.235,                      # normalised units above the soles (long enough for the stride)
    ankle=(0.083, 0.0, 0.062),             # x half-offset, raw y, height above the soles (raw)
    sole_top=0.055,                        # normalised height of the sole band weighted to the foot only
    # Face (raw): button eyes, nose and the mouth patch that covers the baked smile.
    eyes=SimpleNamespace(x=0.1165, z=-0.0205, radius=0.037, depth=0.62, mid_x=0.0),
    lid=SimpleNamespace(open=0.04, color='orange', grow=1.10),
    mouth=SimpleNamespace(x=0.0, z=-0.098, half_w=0.062, half_h=0.030, lift=0.0025),
    floss='#5A2A1A', mouth_inside='#4A1B2A',
    # Hair chain
    hair_fractions=(0.0, 0.16, 0.40, 0.67),
    # Motion: see motion.py. Angles in radians, distances in normalised units.
    motion=SimpleNamespace(
        walk=SimpleNamespace(cycle=1.0, stance=0.25, bob=0.09, lean=0.14, lean_mod=0.026,
                             swing=0.62, arm_in=-0.18, arm_bounce=0.10, bank=0.105, sway=0.02,
                             lift=0.050, flare=0.024, head_follow=0.55, head_nod=0.0,
                             knee_out=0.0),
        skip=SimpleNamespace(cycle=1.0, stance=0.16, hop=0.115, lean=0.085, swing=0.75,
                             arm_lift=0.55, bank=0.10, lift=0.075, tuck=0.045),
        idle=SimpleNamespace(cycle=2.0, bob=0.010, sway=0.014, bank=0.026, arm_sway=0.05,
                             head_turn=0.16, bounce=0.006),
        dance=SimpleNamespace(step=0.115, hop=0.150, land=-0.072, arms=2.05, bow_pitch=0.30,
                              bow_arms=(2.30, 2.50), spread=1.0, bank=1.0),
        hair=SimpleNamespace(delay=(0.012, 0.030, 0.048, 0.088), omega=(34, 30, 27, 23),
                             follow=(0.25, 0.62, 1.0, 1.0), droop=(0.05, 0.30, 0.65, 1.0),
                             limit=(0.06, 0.22, 0.42, 0.58), damping=0.30, bounce=1.0),
    ),
    umbrella=None,
)

B = SimpleNamespace(
    key='b',
    raw=SOURCE / 'b_raw.glb',
    out='troll_b.glb',
    title='Companion B',
    body_height=0.52,
    crown=0.20,
    crown_blend=0.02,
    hair_rules=(((0.0, 0.04), 0.6, (-0.06, 1)), ((0.96, 1.0), 0.6, (-0.06, 1))),   # tomato yarn
    knit_rules=(((0.68, 0.82), 0.20, (-1, 0.10)),),                              # violet sweater
    mid_x=-0.009,
    shoulder=(0.130, -0.030, -0.168),
    wrist=(0.215, -0.040, -0.240),
    hand_tip=(0.280, -0.040, -0.275),
    neck=(0.0, -0.035, -0.135),
    hip_x=0.075,
    hip_height=0.215,
    ankle=(0.085, -0.040, 0.068),
    sole_top=0.05,
    eyes=SimpleNamespace(x=0.098, z=0.022, radius=0.046, depth=0.62, mid_x=-0.009),
    lid=SimpleNamespace(open=0.23, color='mint', grow=1.10),
    mouth=SimpleNamespace(x=-0.009, z=-0.066, half_w=0.052, half_h=0.024, lift=0.0025),
    floss='#2B2233', mouth_inside='#3A2030',
    hair_fractions=(0.0, 0.18, 0.42, 0.68),
    motion=SimpleNamespace(
        walk=SimpleNamespace(cycle=0.8, stance=0.20, bob=0.06, lean=0.175, lean_mod=0.017,
                             swing=0.22, arm_in=0.20, arm_bounce=0.0, bank=0.07, sway=0.012,
                             lift=0.040, flare=0.016, head_follow=-0.35, head_nod=0.05,
                             knee_out=0.0),
        skip=None,
        idle=SimpleNamespace(cycle=2.0, bob=0.004, sway=0.010, bank=0.016, arm_sway=0.02,
                             head_turn=0.07, bounce=0.0),
        look=SimpleNamespace(duration=0.6, yaw=0.56, body=0.16),
        dance=SimpleNamespace(step=0.075, hop=0.160, land=-0.065, arms=1.95, bow_pitch=0.24,
                              bow_arms=(2.10, 2.25), spread=0.7, bank=0.7),
        hair=SimpleNamespace(delay=(0.016, 0.040, 0.066, 0.110), omega=(28, 24, 21, 18),
                             follow=(0.25, 0.60, 1.0, 1.0), droop=(0.08, 0.35, 0.75, 1.1),
                             limit=(0.06, 0.22, 0.42, 0.58), damping=0.42, bounce=1.0),
    ),
    umbrella=SimpleNamespace(canopy='#7EC8E8', handle='#F7DC6F'),
)

CHARACTERS = {'a': A, 'b': B}

# Shared dance markers (contract "Round 6" -> Clips per rig), seconds from the clip start
DANCE_LENGTH = 3.0
DANCE_TURN = 0.92
DANCE_LAND = 1.67
DANCE_BOW = 2.19
DANCE_HOLD = 0.35
MARKER_TOLERANCE = 0.03

# Rest closure of the runtime lids for the rig, mirrored in face.js (REST_CLOSURE)
LID_REST = {'a': 0.0, 'b': 0.35}
MOUTH_CELLS = ('smile', 'open_smile', 'o', 'flat', 'frown', 'sing', 'ee', 'grin')

CLIPS = {'a': ('walk', 'idle', 'dance', 'skip'), 'b': ('walk', 'idle', 'dance', 'look')}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_linear(code, alpha=1.0):
    code = code.lstrip('#')
    r, g, b = (int(code[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)
