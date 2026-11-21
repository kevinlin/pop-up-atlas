"""Render evidence from the exported GLB, using EEVEE or Cycles CPU.

    Blender -b --python-exit-code 1 -P blender/troll/render_troll.py -- MODEL EVIDENCE
    Blender -b --python-exit-code 1 -P blender/troll/render_troll.py -- MODEL EVIDENCE --cpu

Requires FFmpeg on PATH.
"""
import argparse
import math
from pathlib import Path
import subprocess
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_troll import load_troll


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def set_stage(cycles):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES' if cycles else 'BLENDER_EEVEE'
    if cycles:
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 24
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 4
        scene.cycles.diffuse_bounces = 2
        scene.cycles.glossy_bounces = 2
    else:
        scene.eevee.taa_render_samples = 32

    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 20
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = .14
    world = bpy.data.worlds.new('Pastel evening sky')
    world.use_nodes = True
    world.node_tree.nodes.get('Background').inputs[0].default_value = (.64, .53, .60, 1)
    world.node_tree.nodes.get('Background').inputs[1].default_value = .22
    scene.world = world

    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.location.z = -.002
    paper = bpy.data.materials.new('Warm paper stage')
    paper.use_nodes = True
    nodes = paper.node_tree.nodes
    links = paper.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.65, .46, .34, 1)
    shader.inputs['Roughness'].default_value = .92
    shader.inputs['Specular IOR Level'].default_value = 0
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 170
    noise.inputs['Detail'].default_value = 2
    uv = nodes.new('ShaderNodeTexCoord')
    links.new(uv.outputs['Object'], noise.inputs['Vector'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .17
    bump.inputs['Distance'].default_value = .0018
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    floor.data.materials.append(paper)

    camera = bpy.data.objects.new('Evidence camera', bpy.data.cameras.new('Evidence camera'))
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    lights = []
    for name, location, color, power, size in (
        ('Warm upper left', (-.72, -1.17, 1.73), (1, .79, .59), 51, 1.04),
        ('Pink violet fill', (.91, -.34, 1.06), (.76, .47, 1), 18, 1.06),
        ('Warm rim', (.17, .82, 1.44), (1, .74, .53), 42, .71),
    ):
        data = bpy.data.lights.new(name, 'AREA')
        data.color, data.energy, data.size = color, power, size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        lights.append((obj, Vector(location)))
    return scene, lights


def frame_camera(scene, lights, azimuth, *, video=False):
    angle = math.radians(azimuth)
    rotation = Matrix.Rotation(angle, 3, 'Z')
    camera = scene.camera
    camera.location = rotation @ Vector((0, -2.0, 1.43))
    aim(camera, (0, .024, .49 if video else .465))
    camera.data.ortho_scale = 1.70 if video else 1.24
    scene.render.resolution_x = 640 if video else 528
    scene.render.resolution_y = 480 if video else 528
    for light, location in lights:
        light.location = rotation @ location
        aim(light, (0, 0, .42))


def set_action(rig, clip):
    rig.animation_data.action, rig.animation_data.action_slot = clip
    return clip[0].frame_range[0]


def still(scene, file, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)
    scene.render.filepath = str(file)
    bpy.ops.render.render(write_still=True)


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', *map(str, args)], check=True)


def sheet(source, dest, count, cols):
    rows = math.ceil(count / cols)
    ffmpeg('-framerate', 24, '-i', source / '%03d.png', '-vf',
           f'scale=368:368,tile={cols}x{rows}:padding=6:margin=8:color=0xffeed4',
           '-frames:v', 1, '-update', 1, dest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--cpu', action='store_true')
    parser.add_argument('--review-sheets', action='store_true',
                        help='Render only turntable, walk and dance contact sheets')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.output.mkdir(parents=True, exist_ok=True)
    names = ['turntable.png', 'walk.png', 'dance.png']
    if not args.review_sheets:
        names += ['idle.png', 'walk.mp4', 'dance.mp4']
    for name in names:
        if (args.output / name).exists():
            raise FileExistsError(args.output / name)
    rig, clips = load_troll(args.model.resolve())
    scene, lights = set_stage(args.cpu)
    fps = scene.render.fps

    with tempfile.TemporaryDirectory(prefix='troll-render-') as tmp:
        tmp = Path(tmp)
        angles = tmp / 'turntable'
        angles.mkdir()
        rig.data.pose_position = 'REST'
        for index in range(8):
            frame_camera(scene, lights, index * 45)
            still(scene, angles / f'{index:03d}.png', 0)
        sheet(angles, args.output / 'turntable.png', 8, 4)
        rig.data.pose_position = 'POSE'

        samples = {
            'walk': (0, .125, .25, .375, .5, .625, .75, .875),
            'idle': (0, .57, 1.21, 1.7),
            'dance': (.30, .62, .88, 1.42, 1.88, 2.05, 2.24, 2.43, 2.64, 3.57, 3.82, 4.77),
        }
        if args.review_sheets:
            del samples['idle']
        for clip, times in samples.items():
            print(f'Rendering {clip} sheet', flush=True)
            source = tmp / clip
            source.mkdir()
            start = set_action(rig, clips[clip])
            frame_camera(scene, lights, -48 if clip == 'walk' else -24)
            for index, time in enumerate(times):
                still(scene, source / f'{index:03d}.png', start + fps * time)
            sheet(source, args.output / f'{clip}.png', len(times), 4)

        if args.review_sheets:
            return
        if args.cpu:
            scene.cycles.samples = 14
        for clip in ('walk', 'dance'):
            print(f'Rendering {clip} video at 480p', flush=True)
            source = tmp / f'{clip}-video'
            source.mkdir()
            start = set_action(rig, clips[clip])
            duration = (clips[clip][0].frame_range[1] - start) / fps
            frame_camera(scene, lights, -52 if clip == 'walk' else -23, video=True)
            # Translate the camera-side stage against the treadmill walk to show planted feet.
            stage = bpy.data.objects['Plane']
            for index in range(round(duration * 24)):
                if clip == 'walk':
                    stage.location.y = index / 24 * 1.2
                still(scene, source / f'{index:03d}.png', start + index / 24 * fps)
            stage.location.y = 0
            loop = ['-stream_loop', '1'] if clip == 'walk' else []
            ffmpeg(*loop, '-framerate', 24, '-i', source / '%03d.png',
                   '-c:v', 'libx264', '-crf', 18, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                   args.output / f'{clip}.mp4')


if __name__ == '__main__':
    main()
