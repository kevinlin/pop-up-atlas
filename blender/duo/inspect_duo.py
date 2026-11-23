"""Static checks of the round-6 character GLBs (contract "Round 6" -> Characters).

    Blender -b --python-exit-code 1 -P blender/duo/inspect_duo.py -- MODEL.glb [MODEL.glb ...] [--evidence DIR]

Each model is identified as lead A (`troll.glb`) or companion B (`troll_b.glb`) by its file name, or `--char`.
Numbers here are the contract's, written out on purpose (they are not read from params.py): when the
contract changes, change them here, in params.py and in the log together. `--evidence DIR` also renders the
turntable and per-clip contact sheets (sheets.py).

Runtime behaviour (skip selection, look interruptions, umbrella trigger, face and hair response) is not
checked here; only what is in the file.
"""
import argparse
import math
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy                                   # noqa: E402
import numpy as np                           # noqa: E402
from mathutils import Quaternion, Vector     # noqa: E402

from common import NodeTree, points, read_gltf, set_clip, frame_at   # noqa: E402

FPS = 50
WALK_SPEED = 1.2
MAX_TRIANGLES = 20_000
TEXTURE_MAX = 1024
PREFIX = re.compile(r'^(felt|card|glitter|yarn)_.+$')
BONES = ('root', 'spine', 'head', 'hand_r', 'hand_l', 'arm_L', 'arm_R', 'leg_L', 'leg_R', 'shin_L', 'shin_R',
         'foot_L', 'foot_R', 'hair_0', 'hair_1', 'hair_2', 'hair_3')
FACE = ('eye_l', 'eye_r', 'lid_l', 'lid_r', 'mouth')
MOUTH_CELLS = ('smile', 'open_smile', 'o', 'flat', 'frown', 'sing', 'ee', 'grin')
SOLE_TOP = .05                 # rest height below which a vertex counts as sole
DANCE = dict(length=3.0, length_tol=.05, turn=.92, land=1.67, bow=2.19, hold=.35, tol=.03, wrist=.35)
TURN_THRESHOLD = .05           # rad of root yaw that marks the start of the dance turn
STILL = 1e-4                   # largest pose-matrix change per frame that still counts as held
SPEC = {
    'a': dict(title='Lead A', file='troll.glb', clips=('walk', 'idle', 'dance', 'skip'),
              walk=dict(cycle=1.0, stance=.25, bob=.09, bob_tol=.003, lean=(6, 10), swing_min=30),
              skip=dict(cycle=1.0, stance=.16, contacts=(0., .5), hops=2)),
    'b': dict(title='Companion B', file='troll_b.glb', clips=('walk', 'idle', 'dance', 'look'),
              walk=dict(cycle=.8, stance=.2, bob=.06, bob_tol=.003, lean=(8, 12), swing_max=15),
              look=dict(duration=.6, yaw_min=25), umbrella=dict(canopy=(0x7E, 0xC8, 0xE8))),
}


class Report:
    def __init__(self, title):
        self.title, self.failures = title, []

    def check(self, name, ok, detail=''):
        print(f'  {"PASS" if ok else "FAIL"}  {name}' + (f': {detail}' if detail else ''))
        if not ok:
            self.failures.append(name)
        return ok

    def section(self, text):
        print(f'\n[{self.title}] {text}')


# --- glTF data ---------------------------------------------------------------------------------------------

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def accessor(doc, binary, index):
    entry = doc['accessors'][index]
    view = doc['bufferViews'][entry['bufferView']]
    dtype = np.dtype(COMPONENT[entry['componentType']])
    width = WIDTH[entry['type']]
    start = view.get('byteOffset', 0) + entry.get('byteOffset', 0)
    stride = view.get('byteStride', width * dtype.itemsize)
    count = entry['count']
    if stride == width * dtype.itemsize:
        data = np.frombuffer(binary, dtype=dtype, count=count * width, offset=start)
    else:
        rows = [np.frombuffer(binary, dtype=dtype, count=width, offset=start + i * stride) for i in range(count)]
        data = np.concatenate(rows)
    return data.reshape(count, width) if width > 1 else data


def mesh_nodes(doc):
    return [(index, node) for index, node in enumerate(doc['nodes']) if 'mesh' in node]


def triangles(doc):
    total = 0
    for _, node in mesh_nodes(doc):
        for primitive in doc['meshes'][node['mesh']]['primitives']:
            if primitive.get('mode', 4) == 4:
                total += doc['accessors'][primitive['indices']]['count'] // 3
    return total


def node_name(doc, wanted):
    return [index for index, node in enumerate(doc['nodes']) if node.get('name') == wanted]


# --- static checks -----------------------------------------------------------------------------------------

def check_static(report, doc, binary, tree, key, spec):
    report.section('size, facing, origin, budget')
    count = triangles(doc)
    report.check('triangles <= 20,000', count <= MAX_TRIANGLES, f'{count:,}')

    skin_names = {doc['nodes'][j].get('name') for skin in doc.get('skins', ()) for j in skin['joints']}
    missing = [name for name in BONES if name not in skin_names and name not in tree.by_name]
    report.check('bones present (incl. head, hand_r, hair_0..3)', not missing, f'missing {missing}' if missing else
                 f'{len(skin_names)} joints')

    body_index = max(mesh_nodes(doc), key=lambda item: sum(
        doc['accessors'][p['indices']]['count'] for p in doc['meshes'][item[1]['mesh']]['primitives']))[0]
    body = doc['nodes'][body_index]
    world = tree.world(body_index)
    verts = []
    for primitive in doc['meshes'][body['mesh']]['primitives']:
        verts.append(accessor(doc, binary, primitive['attributes']['POSITION']))
    verts = np.concatenate(verts)
    verts = verts @ world[:3, :3].T + world[:3, 3]
    low, tip = float(verts[:, 1].min()), float(verts[:, 1].max())
    soles = verts[verts[:, 1] < low + .018]
    centre = ((soles[:, 0].min() + soles[:, 0].max()) / 2, (soles[:, 2].min() + soles[:, 2].max()) / 2)
    crown = float(tree.world(tree.named('hair_0'))[1, 3])
    report.check('body height (soles to crown) 0.5-0.6', .5 <= crown - low <= .6, f'{crown - low:.3f}')
    report.check('hair tip <= 1.05', tip <= 1.05, f'{tip:.3f}')
    report.check('origin between the feet (+-0.02)', abs(low) <= .02 and abs(centre[0]) <= .02 and abs(centre[1]) <= .02,
                 f'soles y {low:.3f}, centre x {centre[0]:.3f} z {centre[1]:.3f}')
    eyes = [tree.world(tree.named(name))[:3, 3] for name in ('eye_l', 'eye_r')]
    spine_z = tree.world(tree.named('spine'))[2, 3]
    report.check('faces +Z (eyes in front of the spine)', all(e[2] - spine_z >= .05 for e in eyes),
                 f'eye z {[round(float(e[2]), 3) for e in eyes]}, spine z {spine_z:.3f}')

    report.section('materials and textures')
    names = [m.get('name', '') for m in doc.get('materials', ())]
    bad = [n for n in names if not PREFIX.match(n)]
    report.check('material prefixes felt_/card_/glitter_/yarn_', not bad, f'{bad}' if bad else f'{len(names)} materials')
    other = 'b' if key == 'a' else 'a'
    own = [n for n in names if n.startswith((f'felt_{key}_', f'yarn_{key}_'))]
    foreign = [n for n in names if n.startswith((f'felt_{other}_', f'yarn_{other}_'))]
    report.check(f'felt_{key}_* and yarn_{key}_* present (hair is yarn_)', any(n.startswith(f'felt_{key}_') for n in own)
                 and any(n.startswith(f'yarn_{key}_') for n in own), f'{own}')
    report.check(f'no felt_{other}_* / yarn_{other}_* materials', not foreign, f'{foreign}' if foreign else '')
    report.check('felt_mouth material', 'felt_mouth' in names)
    images = doc.get('images', ())
    report.check('textures embedded', len(images) > 0 and all('bufferView' in image for image in images),
                 f'{len(images)} images')
    sizes = {}
    for image in images:
        blender = bpy.data.images.get(image.get('name', ''))
        if blender is not None:
            sizes[image['name']] = tuple(blender.size)
    report.check('textures <= 1024 px', bool(sizes) and all(max(size) <= TEXTURE_MAX for size in sizes.values()), f'{sizes}')


def check_face(report, doc, binary, tree, key):
    report.section('face nodes')
    for name in FACE:
        report.check(f'node {name}', name in tree.by_name)
    if any(name not in tree.by_name for name in FACE):
        return
    for name in FACE:
        report.check(f'{name} under head', 'head' in set(tree.ancestors(tree.named(name))))
    for side in ('l', 'r'):
        node = doc['nodes'][tree.named(f'lid_{side}')]
        scale = node.get('scale', [1, 1, 1])
        open_value = node.get('extras', {}).get('lidOpen')
        report.check(f'lid_{side} extras.lidOpen = node scale.y, 0 < open < 1',
                     open_value is not None and abs(open_value - scale[1]) < 1e-5 and 0 < open_value < 1,
                     f'lidOpen {open_value}, scale {scale}')
        report.check(f'lid_{side} scales along Y only', abs(scale[0] - 1) < 1e-5 and abs(scale[2] - 1) < 1e-5)
        world = tree.world(tree.named(f'lid_{side}'))
        axes = np.linalg.norm(world[:3, :3], axis=0)
        report.check(f'lid_{side} world axes stay vertical', abs(world[1, 1] - scale[1]) < 1e-4 * max(1, scale[1]) and
                     abs(world[0, 0] - 1) < 1e-4 and abs(world[2, 2] - 1) < 1e-4, f'scale {np.round(axes, 3)}')
    eye_domes = [doc['nodes'][tree.named(name)] for name in ('eye_l', 'eye_r')]
    report.check('eyes are meshes on a glossy material', all('mesh' in node for node in eye_domes) and all(
        doc['materials'][doc['meshes'][node['mesh']]['primitives'][0]['material']]['pbrMetallicRoughness']
        .get('roughnessFactor', 1) <= .3 for node in eye_domes))

    mouth = doc['nodes'][tree.named('mouth')]
    primitive = doc['meshes'][mouth['mesh']]['primitives'][0]
    material = doc['materials'][primitive['material']]
    report.check('mouth material is felt_mouth', material.get('name') == 'felt_mouth', material.get('name'))
    uv = accessor(doc, binary, primitive['attributes']['TEXCOORD_0'])
    report.check('mouth UVs cover exactly the first atlas cell (u<=1/4, v<=1/2)',
                 uv[:, 0].min() >= 0 and uv[:, 0].max() <= .25 + 1e-6 and uv[:, 1].min() >= 0 and uv[:, 1].max() <= .5 + 1e-6,
                 f'u {uv[:, 0].min():.3f}-{uv[:, 0].max():.3f}, v {uv[:, 1].min():.3f}-{uv[:, 1].max():.3f}')
    texture = material['pbrMetallicRoughness']['baseColorTexture']['index']
    image = doc['images'][doc['textures'][texture]['source']]
    blender = bpy.data.images[image['name']]
    width, height = blender.size
    report.check('mouth atlas is a 4x2 grid of square cells', width == 2 * height and width % 4 == 0 and height % 2 == 0,
                 f'{width}x{height}')
    pixels = np.empty(width * height * 4, dtype=np.float32)
    blender.pixels.foreach_get(pixels)
    rgb = pixels.reshape(height, width, 4)[::-1, :, :3]                    # top row first
    flat = rgb.reshape(-1, 3)
    values, counts = np.unique(np.round(flat, 3), axis=0, return_counts=True)
    background = values[counts.argmax()]
    cw, ch = width // 4, height // 2
    cells, shapes = [], []
    for index, name in enumerate(MOUTH_CELLS):
        row, column = divmod(index, 4)
        cell = rgb[row * ch:(row + 1) * ch, column * cw:(column + 1) * cw]
        cells.append(cell)
        shapes.append(float((np.abs(cell - background).max(axis=2) > .08).mean()))
    report.check('atlas: every cell holds a stitched shape on body-colour felt', min(shapes) > .004,
                 ', '.join(f'{n} {s:.3f}' for n, s in zip(MOUTH_CELLS, shapes)))
    closest = min(float(np.abs(cells[i] - cells[j]).mean()) for i in range(8) for j in range(i + 1, 8))
    report.check('atlas: the eight shapes differ pairwise', closest > .002, f'closest pair mean difference {closest:.4f}')


def check_umbrella(report, doc, tree, spec):
    report.section('umbrella (B)')
    for name in ('umbrella_closed', 'umbrella_open'):
        present = name in tree.by_name
        report.check(f'node {name} under hand_r', present and 'hand_r' in set(tree.ancestors(tree.named(name))))
    if 'umbrella_open' not in tree.by_name or 'umbrella_closed' not in tree.by_name:
        return
    opened = doc['nodes'][tree.named('umbrella_open')]
    closed = doc['nodes'][tree.named('umbrella_closed')]
    report.check('umbrella_open authored at scale 0', max(abs(v) for v in opened.get('scale', [1, 1, 1])) < 1e-6,
                 f'{opened.get("scale")}')
    report.check('umbrella_closed at scale 1', all(abs(v - 1) < 1e-5 for v in closed.get('scale', [1, 1, 1])))
    canopy = [m for m in doc['materials'] if m.get('name', '').startswith('felt_b_umbrella')]
    want = np.array(spec['umbrella']['canopy']) / 255
    got = canopy[0]['pbrMetallicRoughness']['baseColorFactor'][:3] if canopy else None
    to_srgb = lambda c: 12.92 * c if c <= .0031308 else 1.055 * c ** (1 / 2.4) - .055
    ok = got is not None and all(abs(to_srgb(g) - w) < .02 for g, w in zip(got, want))
    report.check('canopy colour #7EC8E8', ok, f'{got}')
    thin = None
    for name in ('umbrella_closed', 'umbrella_open'):
        report.check(f'{name} has geometry', 'mesh' in doc['nodes'][tree.named(name)])


# --- animation data ---------------------------------------------------------------------------------------

def check_clip_names(report, doc, spec):
    report.section('clips')
    names = sorted(a.get('name', '') for a in doc.get('animations', ()))
    report.check('clip set', set(names) >= set(spec['clips']) and set(names) <= set(spec['clips']),
                 f'{names} (expected {sorted(spec["clips"])})')


def check_no_scale_on_rigid_chain(report, doc, binary, tree):
    """Rigid props under hand_r: no clip animates them, and the ancestor chain stays unscaled and orthonormal."""
    report.section('rigid umbrella across all clips')
    chain = {tree.named(n) for n in ('hand_r',)}
    index = tree.named('hand_r')
    while index in tree.parent:
        index = tree.parent[index]
        chain.add(index)
    props = {tree.named(n) for n in ('umbrella_closed', 'umbrella_open') if n in tree.by_name}
    worst = 0.
    animated_props = []
    for animation in doc['animations']:
        for channel in animation['channels']:
            target = channel['target']['node']
            if target in props:
                animated_props.append(animation['name'])
            if target in chain and channel['target']['path'] == 'scale':
                values = accessor(doc, binary, animation['samplers'][channel['sampler']]['output'])
                worst = max(worst, float(np.abs(values - 1).max()))
    report.check('no clip animates the umbrella nodes', not animated_props, f'{sorted(set(animated_props))}')
    report.check('no scale on spine/arm/hand chain in any clip (|s-1| <= 1e-4)', worst <= 1e-4, f'worst {worst:.2e}')


# --- Blender-evaluated checks ----------------------------------------------------------------------------------

def import_model(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=str(path))
    rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    body = max(meshes, key=lambda obj: len(obj.data.polygons))
    clips = {}
    for action in bpy.data.actions:
        name = action.name.split('|')[-1]
        clips[name] = (action, action.slots[0])
    return rig, body, clips


class Sampler:
    """Evaluate a clip frame by frame and cache pose-bone matrices (armature space)."""

    def __init__(self, rig, clip):
        self.rig, self.clip = rig, clip
        set_clip(rig, clip)
        self.start, self.end = (round(v) for v in clip[0].frame_range)
        self.scene = bpy.context.scene
        self.frames = list(range(self.start, self.end + 1))
        self.matrices = {}

    def matrix(self, name, frame):
        key = (name, frame)
        if key not in self.matrices:
            self.scene.frame_set(frame)
            self.matrices[key] = np.array(self.rig.matrix_world @ self.rig.pose.bones[name].matrix)
        return self.matrices[key]

    def series(self, name):
        return np.array([self.matrix(name, f) for f in self.frames])

    def seconds(self, index):
        return index / FPS

    @property
    def duration(self):
        return (self.end - self.start) / FPS


def sagittal(matrices):
    """Angle (rad, positive = backward) of the bone axis in the side view, from straight down."""
    axis = matrices[:, :3, 1]
    return np.arctan2(axis[:, 1], -axis[:, 2])


def pitch_forward(matrices):
    axis = matrices[:, :3, 1]
    return np.arctan2(-axis[:, 1], axis[:, 2])


def yaw_of(matrices):
    axis = matrices[:, :3, 0]
    return np.arctan2(axis[:, 1], axis[:, 0])


def plant(rig, body, clip, rest, side, offset, window, mid):
    """Round-5 plant test: lowest sole vertex height and slip of the toe vertex (ground-fixed) over the window."""
    scene = bpy.context.scene
    sole = np.flatnonzero((rest[:, 2] <= SOLE_TOP) & ((rest[:, 0] >= mid) == (side == 'L')))
    start = clip[0].frame_range[0]
    frame_at(scene, start + (offset + window) * FPS)
    toe = sole[points(body, posed=True)[sole, 2].argmin()]
    samples, heights = [], []
    for sample in range(math.floor(30 * window) + 1):
        t = sample / 30
        frame_at(scene, start + (t + offset) * FPS)
        posed = points(body, posed=True)
        heights.append(float(posed[sole, 2].min()))
        samples.append(posed[toe, :2] + (0, -WALK_SPEED * t))
    xy = np.array(samples)
    slip = float(np.linalg.norm(xy[:, None] - xy[None, :], axis=2).max())
    return max(map(abs, heights)), slip


def check_hair(report, rig, body, rest, crown):
    report.section('hair weights')
    rig.animation_data_create()
    rig.animation_data.action = None
    rig.data.pose_position = 'POSE'
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
    groups = {g.index: g.name for g in body.vertex_groups}
    stray = 0
    for vertex in body.data.vertices:
        if rest[vertex.index, 2] >= crown + 1e-4:
            if any(not groups[g.group].startswith('hair_') and g.weight > 1e-4 for g in vertex.groups):
                stray += 1
    report.check('vertices above the crown weighted only to hair_0..3', stray == 0, f'{stray} vertices with other weights')
    for index in (1, 2, 3):
        rig.pose.bones[f'hair_{index}'].rotation_quaternion = Quaternion((1, 0, 0), .5)
    bpy.context.view_layer.update()
    delta = np.linalg.norm(points(body, posed=True) - rest, axis=1)
    travel = float(delta[rest[:, 2].argmax()])
    bleed = float(delta[rest[:, 2] < crown].max())
    report.check('hair_1..3 at 0.5 rad move the tip >= 0.15', travel >= .15, f'{travel:.3f}')
    report.check('no vertex below the crown moves > 0.002', bleed <= .002, f'{bleed:.5f}')
    for index in (1, 2, 3):
        rig.pose.bones[f'hair_{index}'].rotation_quaternion = (1, 0, 0, 0)


def check_walk(report, rig, body, clip, rest, spec, mid):
    s = spec['walk']
    sampler = Sampler(rig, clip)
    report.section('walk')
    report.check(f'duration {s["cycle"]} s (2 steps, cycle)', abs(sampler.duration - s['cycle']) < .011, f'{sampler.duration:.3f} s')
    root = sampler.series('root')
    height = root[:, 2, 3]
    bob = float(height.max() - height.min())
    report.check(f'bob {s["bob"]} +- {s["bob_tol"]}', abs(bob - s['bob']) <= s['bob_tol'], f'{bob:.4f}')
    travel = float(np.abs(root[:, :2, 3]).max())
    report.check('root in place (|x|,|y| shift <= 0.03)', travel <= .03, f'{travel:.4f}')
    half = int(round(sampler.duration * FPS / 2))
    lows = [int(np.argmin(height[c:c + half])) / FPS for c in (0, half)]
    report.check('body low point just after each contact (<= 0.08 s)', all(0 < t <= .08 for t in lows), f'{lows}')
    shift = root[:, 0, 3]
    over_l = float(shift[int(round(s['stance'] / 2 * FPS))])
    over_r = float(shift[half + int(round(s['stance'] / 2 * FPS))])
    report.check('hips shift over the planted foot (L +x, R -x)', over_l > .005 and over_r < -.005, f'{over_l:.3f}, {over_r:.3f}')
    lean = np.degrees(pitch_forward(sampler.series('spine')))
    low, high = s['lean']
    report.check(f'spine lean {low}-{high} deg forward throughout', lean.min() >= low and lean.max() <= high,
                 f'{lean.min():.1f}-{lean.max():.1f} deg, mean {lean.mean():.1f}')
    swings = []
    for arm in ('arm_L', 'arm_R'):
        angle = np.degrees(sagittal(sampler.series(arm)))
        swings.append((angle.max() - angle.min()) / 2)
    if 'swing_min' in s:
        report.check(f'shoulder swing >= +-{s["swing_min"]} deg', min(swings) >= s['swing_min'], f'{swings[0]:.1f}, {swings[1]:.1f}')
    else:
        report.check(f'shoulder swing <= +-{s["swing_max"]} deg', max(swings) <= s['swing_max'], f'{swings[0]:.1f}, {swings[1]:.1f}')
    for side, offset in (('L', 0.), ('R', sampler.duration / 2)):
        error, slip = plant(rig, body, clip, rest, side, offset, s['stance'], mid)
        report.check(f'foot {side} plant: height <= 0.012, slip <= 0.02', error <= .012 and slip <= .02,
                     f'height {error:.4f}, slip {slip:.4f}')


def check_skip(report, rig, body, clip, rest, spec, mid):
    s = spec['skip']
    sampler = Sampler(rig, clip)
    report.section('skip')
    report.check(f'duration {s["cycle"]} s', abs(sampler.duration - s['cycle']) < .011, f'{sampler.duration:.3f} s')
    height = sampler.series('root')[:, 2, 3]
    peaks = [i for i in range(1, len(height) - 1) if height[i] >= height[i - 1] and height[i] > height[i + 1]
             and height[i] - height.min() > .03]
    report.check('two hops per cycle', len(peaks) == s['hops'], f'peaks at {[round(i / FPS, 2) for i in peaks]}')
    report.check('hop height >= 0.05', float(height.max() - height.min()) >= .05, f'{float(height.max() - height.min()):.3f}')
    for side, offset in zip(('L', 'R'), s['contacts']):
        error, slip = plant(rig, body, clip, rest, side, offset, s['stance'], mid)
        report.check(f'contact {offset} s foot {side}: height <= 0.012, slip <= 0.02 (1.2 u/s)', error <= .012 and slip <= .02,
                     f'height {error:.4f}, slip {slip:.4f}')


def check_look(report, rig, clip, spec):
    s = spec['look']
    sampler = Sampler(rig, clip)
    report.section('look')
    report.check(f'duration {s["duration"]} s', abs(sampler.duration - s['duration']) < .011, f'{sampler.duration:.3f} s')
    yaw = np.degrees(yaw_of(sampler.series('head')))
    report.check(f'head yaw >= {s["yaw_min"]} deg each way', yaw.max() >= s['yaw_min'] and yaw.min() <= -s['yaw_min'],
                 f'{yaw.min():.1f} to {yaw.max():.1f}')


def check_dance(report, rig, clip):
    d = DANCE
    sampler = Sampler(rig, clip)
    report.section('dance')
    report.check('duration 3.0 +- 0.05 s', abs(sampler.duration - d['length']) <= d['length_tol'], f'{sampler.duration:.3f} s')
    root = sampler.series('root')
    yaw = np.abs(yaw_of(root))
    turn = next((i for i in range(len(yaw)) if yaw[i] > TURN_THRESHOLD), None)
    turn_t = None if turn is None else turn / FPS
    report.check(f'turn start {d["turn"]} +- {d["tol"]} s', turn_t is not None and abs(turn_t - d['turn']) <= d['tol'], f'{turn_t}')
    land = int(np.argmin(root[:, 2, 3])) / FPS
    report.check(f'low landing {d["land"]} +- {d["tol"]} s', abs(land - d['land']) <= d['tol'], f'{land:.2f}')
    hair = {f'hair_{k}' for k in range(4)}
    names = [b.name for b in rig.pose.bones if b.name not in hair]
    stack = np.concatenate([sampler.series(n).reshape(len(sampler.frames), -1) for n in names], axis=1)
    still = np.abs(np.diff(stack, axis=0)).max(axis=1) < STILL
    best, run, start = (0, 0), 0, 0
    for i, flag in enumerate(still):
        if flag:
            if run == 0:
                start = i
            run += 1
            if run > best[1]:
                best = (start, run)
        else:
            run = 0
    bow, hold = best[0] / FPS, best[1] / FPS
    report.check(f'bow {d["bow"]} +- {d["tol"]} s', abs(bow - d['bow']) <= d['tol'], f'{bow:.2f}')
    report.check(f'bow held {d["hold"]} +- {d["tol"]} s', abs(hold - d['hold']) <= d['tol'], f'{hold:.2f}')
    ranges = {n: float(sampler.series(n)[:, 2, 3].max() - sampler.series(n)[:, 2, 3].min()) for n in ('hand_l', 'hand_r')}
    report.check('wrist path spans >= 0.35 vertically (each hand)', min(ranges.values()) >= d['wrist'],
                 ', '.join(f'{n} {v:.3f}' for n, v in ranges.items()))


def check_idle(report, rig, clip):
    sampler = Sampler(rig, clip)
    report.section('idle')
    report.check('duration 2.0 s', abs(sampler.duration - 2.0) < .011, f'{sampler.duration:.3f} s')
    first, last = sampler.series('head')[0], sampler.series('head')[-1]
    report.check('idle loops (last frame = first)', float(np.abs(first - last).max()) < 1e-4)


def check_dynamic(report, path, key, spec):
    rig, body, clips = import_model(path)
    bpy.context.view_layer.update()
    rest = points(body)
    mid = float(rig.data.bones['spine'].head_local.x)
    crown = float((rig.matrix_world @ Vector(rig.data.bones['hair_0'].head_local)).z)
    check_hair(report, rig, body, rest, crown)
    for name, run in (('walk', lambda c: check_walk(report, rig, body, c, rest, spec, mid)),
                      ('skip', lambda c: check_skip(report, rig, body, c, rest, spec, mid)),
                      ('look', lambda c: check_look(report, rig, c, spec)),
                      ('dance', lambda c: check_dance(report, rig, c)),
                      ('idle', lambda c: check_idle(report, rig, c))):
        if name in spec['clips'] and name in clips:
            run(clips[name])
        elif name in spec['clips']:
            report.check(f'clip {name} importable', False)


# --- driver ---------------------------------------------------------------------------------------------

def identify(path, forced):
    if forced:
        return forced
    for key, spec in SPEC.items():
        if Path(path).name == spec['file']:
            return key
    raise SystemExit(f'Cannot tell which character {path} is: pass --char a|b')


def inspect(path, key, evidence=None):
    spec = SPEC[key]
    report = Report(spec['title'])
    print(f'\n==== {spec["title"]}: {path} ====')
    doc, binary = read_gltf(path)
    tree = NodeTree(doc)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))                  # for image sizes and pixels
    check_static(report, doc, binary, tree, key, spec)
    check_face(report, doc, binary, tree, key)
    if key == 'b':
        check_umbrella(report, doc, tree, spec)
    check_clip_names(report, doc, spec)
    if key == 'b':
        check_no_scale_on_rigid_chain(report, doc, binary, tree)
    check_dynamic(report, path, key, spec)
    verdict = 'PASS' if not report.failures else 'FAIL'
    print(f'\n[{spec["title"]}] {verdict}' + ('' if not report.failures else f' ({len(report.failures)} failed: {report.failures})'))
    if evidence:
        import sheets
        sheets.make_sheets(path, evidence)
    return report


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('models', nargs='+', type=Path)
    parser.add_argument('--char', choices=tuple(SPEC))
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args(argv)
    reports = [inspect(path.resolve(), identify(path, args.char), args.evidence) for path in args.models]
    failed = [r.title for r in reports if r.failures]
    print('\nRESULT: ' + ('PASS' if not failed else f'FAIL ({", ".join(failed)})'))
    if failed:
        raise RuntimeError('inspect_duo: ' + ', '.join(failed))


if __name__ == '__main__':
    main()
