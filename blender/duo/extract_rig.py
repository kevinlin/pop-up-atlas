"""Record the pre-round-6 troll armature (git fa6d96b:public/models/troll.glb) as blender/duo/source/rig_a.json.

The duo build starts from these joint names, parents and rest orientations (round-5 method), so the
7 MB source GLB does not have to ship with the pipeline. Run once; the JSON is the pipeline input.

    git show fa6d96b:public/models/troll.glb > /tmp/troll_fa6d96b.glb
    Blender -b --factory-startup --python-exit-code 1 -P blender/duo/extract_rig.py -- /tmp/troll_fa6d96b.glb
"""
import json
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
OUT = HERE / 'source/rig_a.json'


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) != 1:
        raise SystemExit('Pass the source GLB after --')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args[0], bone_heuristic='BLENDER', disable_bone_shape=True)
    rig, = (obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    bones = []
    for bone in rig.data.bones:
        bones.append({
            'name': bone.name,
            'parent': bone.parent.name if bone.parent else None,
            'length': round(bone.length, 6),
            'head': [round(v, 6) for v in bone.head_local],
            'matrix': [[round(v, 6) for v in row] for row in bone.matrix_local],
        })
    if OUT.exists():
        raise FileExistsError(OUT)
    OUT.write_text(json.dumps({'source': 'git fa6d96b:public/models/troll.glb', 'bones': bones}, indent=1) + '\n')
    print(f'Wrote {OUT} with {len(bones)} bones')


if __name__ == '__main__':
    main()
