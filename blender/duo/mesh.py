"""Import a raw Tripo mesh, put it on the contract frame, decimate it and split it into material regions."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, interpolate
from mathutils.bvhtree import BVHTree

from common import activate, require
from params import BODY_TRIANGLES, TEXTURE_MAX, hex_linear

MATERIAL_ORDER = ('body', 'knit', 'hair')       # felt_<k>_body, yarn_<k>_knit, yarn_<k>_hair


class Frame:
    """Raw mesh coordinates (landmarks) to the normalised contract frame: feet on y = 0 (glTF), origin
    between the soles, body height from soles to crown equal to `body_height`."""

    def __init__(self, scale, origin, mid_x):
        self.scale, self.origin, self.mid_x = scale, Vector(origin), mid_x

    def point(self, raw):
        return (Vector(raw) - self.origin) * self.scale

    def pair(self, half_x, y, z):
        """Left (+X) and right (-X) points for a landmark given as a half-offset from the mid line."""
        return (self.point((self.mid_x + half_x, y, z)), self.point((self.mid_x - half_x, y, z)))

    def length(self, value):
        return value * self.scale


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    high = rgb.max(axis=-1)
    low = rgb.min(axis=-1)
    delta = high - low
    safe = np.where(delta > 1e-9, delta, 1)
    hue = np.where(high == r, ((g - b) / safe) % 6, np.where(high == g, (b - r) / safe + 2, (r - g) / safe + 4)) / 6
    hue = np.where(delta > 1e-9, hue, 0)
    sat = np.where(high > 1e-9, delta / np.where(high > 1e-9, high, 1), 0)
    return np.stack([hue % 1, sat, high], axis=-1)


def texture_images(material):
    """The colour and normal images of the Tripo material (names Color_*, NormalGL_*)."""
    color = normal = None
    for node in material.node_tree.nodes:
        image = getattr(node, 'image', None)
        if image is None:
            continue
        if image.name.startswith('Color'):
            color = image
        elif image.name.startswith('NormalGL'):
            normal = image
    require(color is not None, 'Tripo colour texture not found')
    return color, normal


def image_pixels(image):
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)


def import_body(p):
    """Return (body object, Frame, raw colour image, raw normal image)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 50
    bpy.ops.import_scene.gltf(filepath=str(p.raw))
    body, = (obj for obj in bpy.context.scene.objects if obj.type == 'MESH')
    body.name = body.data.name = f'{p.title} body'
    # Tripo meshes stand on raw z with the face along +X; a -90 degree turn makes it -Y (glTF +Z).
    body.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z') @ body.matrix_world)
    body.parent = None
    body.matrix_world = Matrix.Identity(4)

    coords = np.empty(3 * len(body.data.vertices), dtype=np.float32)
    body.data.vertices.foreach_get('co', coords)
    coords = coords.reshape(-1, 3)
    low = float(coords[:, 2].min())
    soles = coords[coords[:, 2] < low + 0.018]
    origin = ((soles[:, 0].min() + soles[:, 0].max()) / 2, (soles[:, 1].min() + soles[:, 1].max()) / 2, low)
    scale = p.body_height / (p.crown - low)
    frame = Frame(scale, origin, p.mid_x)
    body.data.transform(Matrix.Scale(scale, 4) @ Matrix.Translation(-Vector(origin)))

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00001)
    bmesh.ops.delete(bm, geom=[edge for edge in bm.edges if not edge.link_faces], context='EDGES')
    bmesh.ops.delete(bm, geom=[vert for vert in bm.verts if not vert.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()

    material, = body.data.materials
    color, normal = texture_images(material)
    return body, frame, color, normal


def duplicate_high(body):
    """Keep the cleaned full-resolution mesh as the bake source."""
    high = body.copy()
    high.data = body.data.copy()
    high.name = high.data.name = body.name + ' source'
    bpy.context.collection.objects.link(high)
    return high


def decimate(body):
    activate(body)
    body.data.calc_loop_triangles()
    before = len(body.data.loop_triangles)
    modifier = body.modifiers.new('Triangle budget', 'DECIMATE')
    modifier.ratio = min(1., BODY_TRIANGLES / before)
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    if body.data.validate(verbose=True):
        print('Repaired degenerate geometry left by the decimation')
    body.data.calc_loop_triangles()
    after = len(body.data.loop_triangles)
    require(after <= BODY_TRIANGLES * 1.05, f'Decimated body has {after:,} triangles')
    print(f'Decimated {body.name}: {before:,} -> {after:,} triangles')


def remesh(body, voxel=0.005):
    """Tripo's surface is a soup of overlapping yarn sheets (12k non-manifold edges after decimation).
    A voxel remesh fuses it into one clean closed shell; the bake restores the detail."""
    activate(body)
    body.data.remesh_voxel_size = voxel
    bpy.ops.object.voxel_remesh()
    body.data.calc_loop_triangles()
    print(f'Voxel remesh {voxel}: {len(body.data.loop_triangles):,} triangles')


def classify(body, high, frame, p, color):
    """Per-face material class from the source texture colour: 0 felt, 1 knit, 2 hair (majority filtered).
    Each low-poly face takes the colour at the nearest point of the full mesh."""
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.update()

    source = bmesh.new()
    source.from_mesh(high.data)
    bmesh.ops.triangulate(source, faces=source.faces[:])
    source.faces.ensure_lookup_table()
    uv_layer = source.loops.layers.uv.active
    tree = BVHTree.FromBMesh(source)
    rgba = image_pixels(color)
    height, width, _ = rgba.shape
    n = len(me.polygons)
    col = np.empty((n, 3), dtype=np.float32)
    centres = np.empty((n, 3), dtype=np.float32)
    for poly in me.polygons:
        centre = poly.center
        centres[poly.index] = centre
        location, _, index, _ = tree.find_nearest(centre)
        face = source.faces[index]
        weights = interpolate.poly_3d_calc([loop.vert.co for loop in face.loops], location)
        u = sum(w * loop[uv_layer].uv.x for w, loop in zip(weights, face.loops))
        v = sum(w * loop[uv_layer].uv.y for w, loop in zip(weights, face.loops))
        col[poly.index] = rgba[int(v * height) % height, int(u * width) % width, :3]
    source.free()
    hsv = rgb_to_hsv(col)
    raw_z = centres[:, 2] / frame.scale + frame.origin.z

    def matches(rules):
        hit = np.zeros(n, dtype=bool)
        for (low, high_hue), sat, (z0, z1) in rules:
            hit |= (hsv[:, 0] >= low) & (hsv[:, 0] <= high_hue) & (hsv[:, 1] >= sat) & (raw_z >= z0) & (raw_z <= z1)
        return hit

    cls = np.zeros(n, dtype=np.int8)
    cls[matches(p.knit_rules)] = 1
    cls[matches(p.hair_rules)] = 2

    # Majority vote over edge neighbours removes speckles from texture noise.
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    neighbours = [[f.index for e in face.edges for f in e.link_faces if f != face] for face in bm.faces]
    bm.free()
    for _ in range(3):
        new = cls.copy()
        for index, near in enumerate(neighbours):
            votes = np.bincount(np.append(cls[near], cls[index]), minlength=3)
            best = votes.argmax()
            if votes[best] > votes[cls[index]]:
                new[index] = best
        cls = new
    return cls, hsv


def build_materials(p):
    """felt_<k>_body, yarn_<k>_knit and yarn_<k>_hair share one baked colour map and one normal map
    (1024 px, filled by bake.py)."""
    color = bpy.data.images.new(f'{p.key}_color', TEXTURE_MAX, TEXTURE_MAX, alpha=False)
    color.colorspace_settings.name = 'sRGB'
    normal = bpy.data.images.new(f'{p.key}_normal', TEXTURE_MAX, TEXTURE_MAX, alpha=False)
    normal.colorspace_settings.name = 'Non-Color'
    out = {}
    for region, roughness in (('body', 0.92), ('knit', 0.95), ('hair', 0.95)):
        prefix = 'felt' if region == 'body' else 'yarn'
        material = bpy.data.materials.new(f'{prefix}_{p.key}_{region}')
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        nodes.clear()
        shader = nodes.new('ShaderNodeBsdfPrincipled')
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = roughness
        shader.inputs['Specular IOR Level'].default_value = 0
        output = nodes.new('ShaderNodeOutputMaterial')
        links.new(shader.outputs['BSDF'], output.inputs['Surface'])
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = color
        links.new(tex.outputs['Color'], shader.inputs['Base Color'])
        ntex = nodes.new('ShaderNodeTexImage')
        ntex.image = normal
        nmap = nodes.new('ShaderNodeNormalMap')
        links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        links.new(nmap.outputs['Normal'], shader.inputs['Normal'])
        out[region] = material
    return out, color, normal


def apply_regions(body, cls, materials):
    me = body.data
    me.materials.clear()
    for region in MATERIAL_ORDER:
        me.materials.append(materials[region])
    # felt (0) -> slot 0 body, knit (1) -> slot 1, hair (2) -> slot 2
    me.polygons.foreach_set('material_index', cls.astype(np.int32))
    me.update()
    counts = np.bincount(cls, minlength=3)
    print(f'Regions: felt {counts[0]:,} faces, knit {counts[1]:,}, hair {counts[2]:,}')
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    return counts


def body_color(p, color_pixels, frame, body, centre_raw, radius_raw):
    """Mean felt colour (linear RGB) of the skin around a raw point: for lids and the mouth patch."""
    me = body.data
    uv = me.uv_layers.active.data
    height, width, _ = color_pixels.shape
    point = frame.point(centre_raw)
    radius = radius_raw * frame.scale
    samples = []
    for poly in me.polygons:
        if (poly.center - point).length < radius and poly.material_index == 0:
            u, v = sum((uv[i].uv for i in poly.loop_indices), Vector((0, 0))) / poly.loop_total
            samples.append(color_pixels[int(v * height) % height, int(u * width) % width, :3])
    require(len(samples) > 8, 'No skin samples near the face landmark')
    return np.median(np.array(samples), axis=0)
