"""Check Troll B from its exported GLB and optionally render evidence.

Blender -b --factory-startup --python-exit-code 1 -P blender/troll_b/inspect_troll_b.py -- MODEL.glb [--evidence DIRECTORY]
"""
import argparse
import math
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import bpy
from mathutils import Quaternion
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_troll_b import (
    BODY, CROWN, MATERIAL, MODEL_A, PROPS, SIDES, SOLE_TOP, STANCE, WALK_SPEED, set_clip,
)
from inspect_troll import load_troll, read_gltf, require
from render_troll import frame_camera, set_stage, still


def points(obj, *, posed=False):
    if posed:
        obj = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    coords = np.empty(3 * len(obj.data.vertices), dtype=np.float32)
    obj.data.vertices.foreach_get('co', coords)
    transform = np.array(obj.matrix_world)
    return coords.reshape(-1, 3) @ transform[:3, :3].T + transform[:3, 3]


def frame_at(scene, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)


def motion(rig, clips):
    scene = bpy.context.scene
    rotations, roots = {}, {}
    for name, clip in clips.items():
        set_clip(rig, clip)
        start, end = map(round, clip[0].frame_range)
        rotations[name], roots[name] = [], []
        for frame in range(start, end + 1):
            scene.frame_set(frame)
            rotations[name].append([tuple(b.rotation_quaternion) for b in rig.pose.bones])
            roots[name].append(tuple(rig.pose.bones['root'].location))
    return rotations, roots


def rig_signature(rig):
    return {bone.name: (bone.parent.name if bone.parent else None,
                        bone.matrix_local.to_3x3().copy()) for bone in rig.data.bones}


def leg_length(rig):
    return sum((rig.data.bones[f'{last}_{side}'].head_local -
                rig.data.bones[f'{first}_{side}'].head_local).length
               for side in SIDES for first, last in (('leg', 'shin'), ('shin', 'foot'))) / 2


def verify_rig(rig, clips, a_rig, a_rotations, a_roots, a_leg):
    b_rig = rig_signature(rig)
    require(set(b_rig) == set(a_rig), f'Joint mismatch: {set(b_rig) ^ set(a_rig)}')
    for name, (parent, axes) in b_rig.items():
        original_parent, original_axes = a_rig[name]
        require(parent == original_parent, f'{name}: changed parent')
        require(np.max(np.abs(np.array(axes) - np.array(original_axes))) < .00002,
                f'{name}: changed rest orientation')
    require(set(clips) == set(a_rotations), f'Clip mismatch: {sorted(clips)}')
    rotations, roots = motion(rig, clips)
    order = [list(b_rig).index(name) for name in a_rig]
    ratio = leg_length(rig) / a_leg
    max_error = 0.
    for name, angles in rotations.items():
        b = np.array(angles)[:, order]
        a = np.array(a_rotations[name])
        require(a.shape == b.shape, f'{name}: changed clip duration or joint count')
        error = np.minimum(np.linalg.norm(a - b, axis=2), np.linalg.norm(a + b, axis=2)).max()
        max_error = max(max_error, error)
        require(error < .00002, f'{name}: local rotation changed by {error:.6f}')
        require(np.allclose(roots[name], np.array(a_roots[name]) * ratio, atol=.00002),
                f'{name}: root channel was not scaled by the leg ratio')
    print(f'{len(b_rig)} joint names, hierarchies and axes match A, clips: {", ".join(sorted(clips))}')
    print(f'Maximum local quaternion delta {max_error:.2e}, root translation ratio {ratio:.3f}')


def landmarks(body):
    material, = body.data.materials
    texture = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    image = texture.inputs['Base Color'].links[0].from_node.image
    width, height = image.size
    pixels = np.empty(4 * width * height, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgba = pixels.reshape(height, width, 4)
    uvs = body.data.uv_layers.active.data
    nose, crown = [], []
    for face in body.data.polygons:
        x, y, z = body.matrix_world @ face.center
        if z < .40 or abs(x) > .10:
            continue
        u = sum(uvs[index].uv.x for index in face.loop_indices) / len(face.vertices)
        v = sum(uvs[index].uv.y for index in face.loop_indices) / len(face.vertices)
        red, green, blue, _ = rgba[int(v * height) % height, int(u * width) % width]
        if .42 < z < .49 and abs(x) < .024 and red > .62 and red > 2.4 * green:
            nose.append(-y)
        if .51 < z < .65 and red > .72 and green > .55 * red and blue < .68 * green:
            crown.extend((body.matrix_world @ body.data.vertices[index].co).z for index in face.vertices)
    require(len(nose) > 5 and len(crown) > 5, 'Nose or butter felt crown cannot be located in the texture')
    return float(np.median(nose)), max(crown)


def verify_mesh(rig, body, props, data):
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    coords = points(body)
    low, tip = coords[:, 2].min(), coords[:, 2].max()
    nose, crown = landmarks(body)
    height = crown - low
    require(.5 <= height <= .6 and abs(crown - CROWN) <= .009, f'Body height: {height:.4f}')
    require(tip <= .95, f'Hair tip: {tip:.4f}')
    require(nose > 0, f'Nose glTF Z: {nose:.4f}')
    near_floor = coords[coords[:, 2] < low + .015]
    midpoint = (near_floor[:, :2].min(axis=0) + near_floor[:, :2].max(axis=0)) / 2
    origin = rig.matrix_world @ rig.data.bones['root'].head_local
    require(abs(low) < .001 and abs(origin.z) < .001 and
            near_floor[:, 0].min() < origin.x < near_floor[:, 0].max() and
            np.max(np.abs(midpoint - np.array(origin)[:2])) <= .02,
            f'Feet are off-center: {midpoint}, floor: {low:.4f}')
    print(f'Body height {height:.4f}, hair tip {tip:.4f}, nose glTF Z {nose:+.4f}')
    print(f'Foot midpoint in glTF XZ ({midpoint[0]:+.4f}, {-midpoint[1]:+.4f}), sole Y {low:.4f}')

    triangles = 0
    for obj in (body, props):
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        require(len({index for face in mesh.polygons for index in face.vertices}) == len(mesh.vertices),
                f'{obj.name}: loose mesh vertices')
        require(any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers),
                f'{obj.name}: no armature skin')
        require(all(mat.name == MATERIAL for mat in mesh.materials), f'{obj.name}: invalid material')
        for v in mesh.vertices:
            require(abs(sum(group.weight for group in v.groups) - 1) < .001,
                    f'{obj.name}: unnormalized weights at vertex {v.index}')
            used = {obj.vertex_groups[group.group].name for group in v.groups if group.weight > 0}
            if obj == props:
                require(used == {'spine'}, 'Prop weights must be 100% spine')
            elif v.co.z > CROWN:
                require(used <= {f'hair_{index}' for index in range(4)}, 'Hair has non-hair weights')
    require(triangles <= 20_000, f'Triangles: {triangles:,}')
    images = [image for image in bpy.data.images if image.packed_file]
    require(len(images) == len(data['images']) > 0 and
            all('bufferView' in entry for entry in data['images']), 'Textures must be embedded')
    dims = [tuple(image.size) for image in images]
    require(all(max(size) <= 1024 for size in dims), f'Texture dimensions: {dims}')
    print(f'{triangles:,} triangles, {len(dims)} embedded textures: ' +
          ', '.join(f'{width}x{height}' for width, height in dims))
    return coords


def verify_hair(rig, body, props, rest):
    prop_rest = points(props)
    rig.animation_data.action = None
    rig.data.pose_position = 'POSE'
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
    for index in (1, 2, 3):
        rig.pose.bones[f'hair_{index}'].rotation_quaternion = Quaternion((1, 0, 0), .5)
    bpy.context.view_layer.update()
    delta = np.linalg.norm(points(body, posed=True) - rest, axis=1)
    travel = delta[rest[:, 2].argmax()]
    prop_delta = np.linalg.norm(points(props, posed=True) - prop_rest, axis=1)
    bleed = max(delta[rest[:, 2] < CROWN].max(), prop_delta.max())
    print(f'Hair tip travel {travel:.4f}, maximum below-crown displacement {bleed:.6f}')
    require(travel >= .15 and bleed <= .002, 'Hair tip travel or isolation failed')


def verify_walk(rig, clip, body, rest):
    set_clip(rig, clip)
    scene = bpy.context.scene
    fps = scene.render.fps
    start = clip[0].frame_range[0]
    for side, offset in zip(SIDES, (0., .5)):
        sole = np.flatnonzero((rest[:, 2] <= SOLE_TOP) & ((rest[:, 0] >= 0) == (side == 'L')))
        frame_at(scene, start + (offset + STANCE) * fps)
        toe = sole[points(body, posed=True)[sole, 2].argmin()]
        samples, heights = [], []
        for sample in range(math.floor(30 * STANCE) + 1):
            t = sample / 30
            frame_at(scene, start + (t + offset) * fps)
            posed = points(body, posed=True)
            heights.append(float(posed[sole, 2].min()))
            samples.append(posed[toe, :2] + (0, -WALK_SPEED * t))
        xy = np.array(samples)
        slip = np.linalg.norm(xy[:, None] - xy[None, :], axis=2).max()
        height = max(map(abs, heights))
        print(f'Walk {side} at 30 fps: max contact height error {height:.4f}, max slip {slip:.4f}')
        require(height <= .012 and slip <= .02, f'Walk {side} foot plant is out of tolerance')


def verify_umbrella(rig, clips, props):
    scene = bpy.context.scene
    rest = points(props)
    spine = rig.pose.bones['spine']
    rest_inverse = spine.bone.matrix_local.inverted()
    for name, clip in sorted(clips.items()):
        set_clip(rig, clip)
        start, end = map(round, clip[0].frame_range)
        worst = 0.
        for frame in range(start, end + 1):
            scene.frame_set(frame)
            pose = rig.matrix_world @ spine.matrix @ rest_inverse
            rotation = np.array(pose.to_quaternion().to_matrix())
            expected = rest @ rotation.T + np.array(pose.translation)
            error = np.linalg.norm(points(props, posed=True) - expected, axis=1).max()
            # Two points can differ in distance by at most the sum of their rigid-fit errors.
            worst = max(worst, 2 * error)
        print(f'{name}: umbrella/strap pair-distance change bound {worst:.2e}')
        require(worst <= .005, f'{name}: umbrella or strap bends')


def contact_sheet(rig, clips, directory):
    directory.mkdir(parents=True, exist_ok=True)
    names = ('turnaround', 'walk', 'idle', 'dance')
    for name in names:
        require(not (directory / f'{name}.png').exists(), f'{name}.png already exists in {directory}')
    scene, lights = set_stage(cycles=False)
    scene.eevee.taa_render_samples = 16
    panel = 300
    gap = 5
    scene.render.resolution_percentage = 100

    with TemporaryDirectory(dir=directory, prefix='.frames-') as tmp:
        tmp = Path(tmp)
        for name in names:
            rest = name == 'turnaround'
            rig.data.pose_position = 'REST' if rest else 'POSE'
            if rest:
                views, frames = (0, 90, 180, 270), (0,)
            else:
                set_clip(rig, clips[name])
                frames = np.linspace(*clips[name][0].frame_range, 6, endpoint=False)
                if name == 'dance':
                    # Show the overhead reach, the spin's profile and back, and the bow.
                    frames = frames[0] + scene.render.fps * np.array((.12, .46, .99, 1.31, 1.84, 2.47))
                views = (0, 90)

            cols, rows = (len(views), 1) if rest else (len(frames), len(views))
            width, height = cols * (panel + gap) + gap, rows * (panel + gap) + gap
            canvas = np.empty((height, width, 4), dtype=np.float32)
            canvas[:] = (.22, .16, .12, 1.)
            for row, angle in enumerate(views):
                frame_camera(scene, lights, angle)
                scene.camera.data.ortho_scale = 1.34 if name == 'dance' else 1.12
                scene.render.resolution_x = scene.render.resolution_y = panel
                for col, frame in enumerate(frames):
                    png = tmp / 'panel.png'
                    still(scene, png, float(frame))
                    source = bpy.data.images.load(str(png), check_existing=False)
                    rgba = np.empty(panel * panel * 4, dtype=np.float32)
                    source.pixels.foreach_get(rgba)
                    bpy.data.images.remove(source)
                    x = gap + (row if rest else col) * (panel + gap)
                    y = gap + (0 if rest else rows - 1 - row) * (panel + gap)
                    canvas[y:y + panel, x:x + panel] = rgba.reshape(panel, panel, 4)
            sheet = bpy.data.images.new(name, width, height, alpha=False)
            sheet.pixels.foreach_set(canvas.ravel())
            sheet.filepath_raw = str(directory / f'{name}.png')
            sheet.file_format = 'PNG'
            sheet.save()
            bpy.data.images.remove(sheet)
            print(f'Contact sheet: {name}.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', type=Path)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    data = read_gltf(args.model)
    rig, clips = load_troll(MODEL_A)
    a_rig = rig_signature(rig)
    a_leg = leg_length(rig)
    a_rotations, a_roots = motion(rig, clips)

    rig, clips = load_troll(args.model.resolve())
    objects = bpy.context.scene.objects
    body, props = objects[BODY], objects[PROPS]
    require(set(clips) == {clip['name'] for clip in data['animations']}, 'Actions did not round-trip')
    verify_rig(rig, clips, a_rig, a_rotations, a_roots, a_leg)
    rest = verify_mesh(rig, body, props, data)
    verify_hair(rig, body, props, rest)
    verify_walk(rig, clips['walk'], body, rest)
    verify_umbrella(rig, clips, props)
    print('Troll B GLB passes')
    if args.evidence:
        contact_sheet(rig, clips, args.evidence.resolve())


if __name__ == '__main__':
    main()
