"""Contact sheets of an exported GLB: a turntable and one frame sheet per clip.

    Blender -b --python-exit-code 1 -P blender/duo/sheets.py -- MODEL.glb OUTPUT_DIR

Both are rendered from the GLB re-imported into a fresh scene (what the game loads), orthographic EEVEE.
"""
import argparse
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy                                   # noqa: E402
import numpy as np                           # noqa: E402

import stage                                 # noqa: E402
from common import require, set_clip         # noqa: E402

CELL = 360


def import_glb(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 50
    bpy.ops.import_scene.gltf(filepath=str(path))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    require(len(rigs) == 1, f'{path}: expected one armature, found {len(rigs)}')
    return rigs[0]


def clips_of(rig):
    """{name: (action, slot)} of every imported action."""
    return {action.name.split('|')[-1] if '|' in action.name else action.name: (action, action.slots[0])
            for action in bpy.data.actions}


def grid(images, columns):
    rows = math.ceil(len(images) / columns)
    canvas = np.zeros((rows * CELL, columns * CELL, 4), dtype=np.float32)
    canvas[..., 3] = 1
    for index, image in enumerate(images):
        row, column = divmod(index, columns)
        top = (rows - 1 - row) * CELL                        # Blender images are bottom-up
        canvas[top:top + CELL, column * CELL:(column + 1) * CELL] = image
    return canvas


def render_views(scene, lights, views, directory, tag):
    images = []
    for index, (azimuth, frame, centre, scale) in enumerate(views):
        stage.frame_camera(scene, lights, azimuth, centre=centre, scale=scale, size=CELL)
        path = directory / f'.{tag}-{index}.png'
        path.unlink(missing_ok=True)
        stage.still(scene, path, frame)
        images.append(stage.load_png(path))
        path.unlink()
    return images


def make_sheets(glb, directory):
    directory.mkdir(parents=True, exist_ok=True)
    rig = import_glb(glb)
    scene, lights = stage.set_stage(samples=20)
    stem = Path(glb).stem
    # Bounds from the rest pose: centre and framing scale for this model (hair and umbrella included).
    scene.frame_set(0)
    clips = clips_of(rig)
    results = []

    # Turntable at the rest pose (no action), eight azimuths.
    rig.animation_data_create()
    rig.animation_data.action = None
    bpy.context.view_layer.update()
    centre, scale = (0, 0.02, .50), 1.34
    views = [(az, None, centre, scale) for az in range(0, 360, 45)]
    path = directory / f'{stem}-turntable.png'
    stage.save_sheet(grid(render_views(scene, lights, views, directory, 'turn'), 4), path)
    results.append(path)

    # One sheet per clip: ten evenly spaced frames, front-three-quarter view, same framing.
    for name, clip in sorted(clips.items()):
        set_clip(rig, clip)
        start, end = clip[0].frame_range
        frames = np.linspace(start, end, 10)
        views = [(25, float(frame), centre, scale) for frame in frames]
        path = directory / f'{stem}-clip-{name}.png'
        stage.save_sheet(grid(render_views(scene, lights, views, directory, name), 5), path)
        results.append(path)
    for path in results:
        print(f'Sheet: {path}')
    return results


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('glb', type=Path)
    parser.add_argument('out', type=Path)
    args = parser.parse_args(argv)
    make_sheets(args.glb, args.out)


if __name__ == '__main__':
    main()
