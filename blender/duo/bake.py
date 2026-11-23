"""Bake the 190k-triangle Tripo surface onto the decimated body.

The Tripo surface is a soup of overlapping yarn sheets, so the body is voxel-remeshed and decimated to a
clean shell, which gets a fresh Smart UV layout and the original colour and normal maps are re-projected from the full mesh into
1024 px textures. The yarn and knit relief survives in the tangent-space normal map.
"""
import math

import bpy
import numpy as np

from common import activate, require
from params import TEXTURE_MAX


def prepare_source(high):
    """Tripo's ORM channel can make the diffuse bake black: the source is a plain colour + normal surface."""
    for material in high.data.materials:
        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        for name in ('Metallic', 'Roughness'):
            for link in list(shader.inputs[name].links):
                material.node_tree.links.remove(link)
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = 1


def unwrap(low, smooth_passes=40):
    """Smart UV project, run on a temporarily smoothed copy of the surface: the yarn bumps otherwise split
    the layout into ~1,500 tiny islands; the smoothed normals give ~150 usable ones."""
    me = low.data
    rest = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', rest)
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap')
    activate(low)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.vertices_smooth(factor=0.5, repeat=smooth_passes)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.012, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.vertices.foreach_set('co', rest)
    me.update()


def bake(high, low, color, normal, extrusion=0.02, ray=0.05):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    scene.render.bake.margin = 12
    scene.render.bake.margin_type = 'EXTEND'
    for obj in scene.objects:
        obj.select_set(False)
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low

    for image, kind in ((color, 'color'), (normal, 'normal')):
        for material in low.data.materials:
            nodes = material.node_tree.nodes
            target = next(node for node in nodes if node.type == 'TEX_IMAGE' and node.image == image)
            nodes.active = target
            for node in nodes:
                node.select = node == target
        if kind == 'color':
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                                cage_extrusion=extrusion, max_ray_distance=ray, use_clear=True)
        else:
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True,
                                cage_extrusion=extrusion, max_ray_distance=ray, use_clear=True)
        image.pack()
        print(f'Baked {image.name}: {image.size[0]}x{image.size[1]}')
    require(max(color.size) <= TEXTURE_MAX and max(normal.size) <= TEXTURE_MAX, 'Baked texture too large')
