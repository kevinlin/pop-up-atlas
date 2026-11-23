"""Build lead A and companion B: Tripo mesh -> clean, rigged, animated GLB (contract "Round 6" -> Characters).

    Blender -b --python-exit-code 1 -P blender/duo/build_duo.py -- --char a|b|both [--out DIR] [--blend PATH]

Per-character numbers live in params.py; there are no per-character branches here. The output directory
must not already exist for the files it receives: nothing is overwritten and nothing under public/ is touched.
"""
import argparse
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy                                   # noqa: E402

import bake                                  # noqa: E402
import face                                  # noqa: E402
import mesh                                  # noqa: E402
import motion                                # noqa: E402
import rig as rigging                        # noqa: E402
import umbrella                              # noqa: E402
from common import require                   # noqa: E402
from params import CHARACTERS, MAX_TRIANGLES, OUTPUT, REPO   # noqa: E402

VOXEL = .005


def build(p, blend=None):
    """Build one character in the current (fresh) scene and return the armature object."""
    body, frame, color_source, _ = mesh.import_body(p)
    high = mesh.duplicate_high(body)
    bake.prepare_source(high)
    mesh.remesh(body, VOXEL)
    mesh.decimate(body)
    cls, _ = mesh.classify(body, high, frame, p, color_source)
    materials, color, normal = mesh.build_materials(p)
    mesh.apply_regions(body, cls, materials)
    bake.unwrap(body)
    bake.bake(high, body, color, normal)
    bpy.data.objects.remove(high, do_unlink=True)
    for image in list(bpy.data.images):
        if image.users == 0:
            bpy.data.images.remove(image)

    rig, info, _ = rigging.create_rig(p, frame, body)
    mouth_z = frame.point((0, 0, p.mouth.z)).z
    rigging.skin(rig, body, p, frame, info, mouth_z)
    body.name = f'{p.title} body'

    face.build_face(p, frame, rig, body, color)
    if p.umbrella:
        umbrella.build_umbrella(p, rig)
    motion.make_clips(rig, body, p)
    triangles = 0
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    require(triangles <= MAX_TRIANGLES, f'{p.title}: {triangles:,} triangles (cap {MAX_TRIANGLES:,})')
    print(f'{p.title}: {triangles:,} triangles')
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(blend), copy=True)
    return rig


def export(p, directory):
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / p.out
    require(not output.exists(), f'{output} already exists: pass a new --out directory, nothing is overwritten')
    # Stage in a temp dir and hard-link into place so a concurrent creator of the output cannot be clobbered.
    with TemporaryDirectory(dir=directory, prefix=f'.{p.key}-') as staging:
        path = Path(staging) / 'model.glb'
        bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_yup=True,
                                  export_animations=True, export_animation_mode='ACTIONS',
                                  export_force_sampling=True, export_rest_position_armature=True,
                                  export_optimize_animation_keep_anim_armature=True, export_extras=True,
                                  export_image_format='AUTO', export_apply=False)
        os.link(path, output)
    print(f'Built {output}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--char', choices=('a', 'b', 'both'), default='both')
    parser.add_argument('--out', type=Path, default=OUTPUT)
    parser.add_argument('--blend', type=Path, help='also save the scene (a .blend per character is named by key)')
    args = parser.parse_args(argv)
    out = args.out.resolve()
    require(REPO / 'public' not in (out, *out.parents), 'Refusing to write under public/')
    keys = ('a', 'b') if args.char == 'both' else (args.char,)
    for key in keys:
        p = CHARACTERS[key]
        require(not (out / p.out).exists(), f'{out / p.out} already exists: pass a new --out directory')
    for key in keys:
        p = CHARACTERS[key]
        blend = args.blend.with_name(f'{args.blend.stem}_{key}.blend') if args.blend else None
        build(p, blend)
        export(p, out)


if __name__ == '__main__':
    main()
