"""Studio stage for evidence renders (EEVEE, orthographic camera, three warm area lights)."""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def set_stage(samples=16):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = samples
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
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
    floor.name = 'Stage floor'
    floor.location.z = -.002
    paper = bpy.data.materials.new('Warm paper stage')
    paper.use_nodes = True
    shader = paper.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.65, .46, .34, 1)
    shader.inputs['Roughness'].default_value = .92
    shader.inputs['Specular IOR Level'].default_value = 0
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


def frame_camera(scene, lights, azimuth, *, centre=(0, 0.02, .46), scale=1.24, elevation=1.43, size=528,
                 distance=2.0):
    """Orthographic view `azimuth` degrees around Z (0 = front, camera on -Y)."""
    rotation = Matrix.Rotation(math.radians(azimuth), 3, 'Z')
    camera = scene.camera
    camera.location = rotation @ Vector((0, -distance, elevation)) + Vector((centre[0], 0, 0))
    aim(camera, centre)
    camera.data.ortho_scale = scale
    scene.render.resolution_x = scene.render.resolution_y = size
    for light, location in lights:
        light.location = rotation @ location
        aim(light, (0, 0, .42))


def still(scene, path, frame=None):
    if frame is not None:
        scene.frame_set(math.floor(frame), subframe=frame % 1)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def load_png(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    width, height = image.size
    rgba = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(rgba)
    bpy.data.images.remove(image)
    return rgba.reshape(height, width, 4)


def save_sheet(canvas, path):
    height, width, _ = canvas.shape
    sheet = bpy.data.images.new(path.stem, width, height, alpha=False)
    sheet.pixels.foreach_set(canvas.ravel())
    sheet.filepath_raw = str(path)
    sheet.file_format = 'PNG'
    sheet.save()
    bpy.data.images.remove(sheet)
