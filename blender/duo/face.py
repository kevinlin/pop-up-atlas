"""Face nodes: glossy eye domes, body-colour lids that close by node scale, and the stitched mouth atlas.

The runtime (src/character/face.js) finds these by name: `eye_l`/`eye_r`, `lid_l`/`lid_r` under `head`
(`scale.y` goes from `extras.lidOpen` to 1) and `mouth` on material `felt_mouth` (a 4x2 atlas whose
texture offset picks the cell). Everything is rigid on the `head` bone.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from common import activate, parent_to_bone, require
from mesh import image_pixels
from params import MOUTH_CELLS, hex_linear

ATLAS = (1024, 512)
COLUMNS, ROWS = 4, 2


def surface(tree, x, z):
    """Front surface point and normal of the body at (x, z), cast along +Y from in front of the face."""
    hit, normal, _, _ = tree.ray_cast(Vector((x, -2., z)), Vector((0, 1, 0)))
    require(hit is not None, f'No face surface at x={x:.3f}, z={z:.3f}')
    return hit, normal


def srgb_to_linear_array(rgb):
    rgb = np.asarray(rgb, dtype=float)
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def skin_color(body, color, tree, x, z, radius):
    """Median baked felt colour (sRGB, as stored) on the skin faces within `radius` of the face point (x, z)."""
    hit, _ = surface(tree, x, z)
    pixels = image_pixels(color)
    height, width, _ = pixels.shape
    uv = body.data.uv_layers.active.data
    samples = []
    for poly in body.data.polygons:
        if poly.material_index == 0 and (poly.center - hit).length < radius:
            u, v = sum((uv[i].uv for i in poly.loop_indices), Vector((0, 0))) / poly.loop_total
            samples.append(pixels[int(v * height) % height, int(u * width) % width, :3])
    require(len(samples) > 4, f'No skin samples near x={x:.3f}, z={z:.3f}')
    return np.median(np.array(samples), axis=0)


def mouth_color(body, color, cx, cz, half_w, half_h):
    """Median baked felt colour (sRGB, as stored) in the skin ring right around the mouth patch.

    The ring is the front-facing skin between 1.1 and 1.8 patch radii from the patch centre, on and
    below the patch's mid line: the nose and the cheek rouge above it are left out, and the chin and the
    cheeks beside the mouth carry the same baked shading the patch has to disappear into.
    """
    pixels = image_pixels(color)
    height, width, _ = pixels.shape
    uv = body.data.uv_layers.active.data
    samples = []
    for poly in body.data.polygons:
        if poly.material_index != 0 or poly.normal.y > -.3:
            continue
        dx = (poly.center.x - cx) / half_w
        dz = (poly.center.z - cz) / half_h
        if 1.1 <= math.hypot(dx, dz) <= 1.8 and dz <= .35:
            u, v = sum((uv[i].uv for i in poly.loop_indices), Vector((0, 0))) / poly.loop_total
            samples.append(pixels[int(v * height) % height, int(u * width) % width, :3])
    require(len(samples) > 8, f'No skin around the mouth at x={cx:.3f}, z={cz:.3f}')
    return np.median(np.array(samples), axis=0)


def make_material(name, color, roughness, specular=0.):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color[:3], 1.)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = 0.
    shader.inputs['Specular IOR Level'].default_value = specular
    return material


def hemisphere(name, radius, depth, segments=20, rings=10):
    """Front half (-Y) of a sphere, squashed to `depth` along Y; its origin is the sphere centre."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.scale(bm, vec=(1, depth, 1), verts=bm.verts)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > 1e-6], context='VERTS')
    # The cut leaves an open rim: close it so the dome is a solid cap with no see-through back.
    rim = [edge for edge in bm.edges if edge.is_boundary]
    bmesh.ops.edgeloop_fill(bm, edges=rim)
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def build_eyes_and_lids(p, frame, rig, tree, body_rgb):
    spec = p.eyes
    radius = frame.length(spec.radius)
    ink = make_material(f'felt_{p.key}_eye', hex_linear('#0A0710'), roughness=.10, specular=1.)
    lid_material = make_material(f'felt_{p.key}_lid', srgb_to_linear_array(body_rgb), roughness=.93)
    made = {}
    for side, sign in (('l', 1), ('r', -1)):
        x = frame.point((spec.mid_x + sign * spec.x, 0, spec.z)).x
        z = frame.point((0, 0, spec.z)).z
        hit, _ = surface(tree, x, z)
        centre = Vector((x, hit.y + .12 * radius, z))

        eye = hemisphere(f'eye_{side}', radius, spec.depth)
        eye.location = centre
        eye.data.materials.append(ink)
        parent_to_bone(eye, rig, 'head')

        grown = radius * p.lid.grow
        lid = hemisphere(f'lid_{side}', grown, spec.depth * p.lid.grow)
        # Origin at the top of the eye so a smaller scale.z leaves a lid hanging from the upper rim.
        lid.data.transform(Matrix.Translation((0, 0, -grown)))
        lid.location = centre + Vector((0, 0, grown))
        lid.scale = (1, 1, p.lid.open)
        lid['lidOpen'] = p.lid.open
        lid.data.materials.append(lid_material)
        parent_to_bone(lid, rig, 'head')
        made[f'eye_{side}'], made[f'lid_{side}'] = eye, lid
    return made


# --- mouth atlas ------------------------------------------------------------------------------------------
# Shapes live in cell space: x in [-aspect, aspect] and y in [-1, 1], both in units of the patch half height,
# so a cell stretched over the patch keeps its proportions.

def _arc(aspect, half, lift, bend):
    xs = np.linspace(-half * aspect, half * aspect, 80)
    return np.stack([xs, lift + bend * (1 - (xs / (half * aspect)) ** 2)], axis=1)


def _ellipse(rx, ry, count=90, cy=0.):
    angle = np.linspace(0, math.tau, count, endpoint=False)
    return np.stack([rx * np.cos(angle), cy + ry * np.sin(angle)], axis=1)


def _closed_mouth(aspect, width, top, depth, upturn):
    """D-shaped open mouth: gently curved lip line on top, round lower edge."""
    xs = np.linspace(-width, width, 60)
    upper = np.stack([xs, top + upturn * (xs / width) ** 2], axis=1)
    lower_x = xs[::-1]
    lower = np.stack([lower_x, top - depth * np.sqrt(np.clip(1 - (lower_x / width) ** 2, 0, 1))], axis=1)
    return np.concatenate([upper, lower[1:-1]])


def mouth_shapes(aspect):
    """Per cell: (outline polyline, closed?, filled?, extra stitch lines)."""
    w = aspect * .62
    return {
        'smile': (_arc(aspect, .62, .05, -.52)[:, :] * [1, 1], False, False, []),
        'open_smile': (_closed_mouth(aspect, w, .22, .78, .12), True, True, []),
        'o': (_ellipse(.30 * aspect * .62, .56, cy=-.02), True, True, []),
        'flat': (np.array([[-w * .92, 0.], [w * .92, 0.]]), False, False, []),
        'frown': (_arc(aspect, .55, -.30, .46), False, False, []),
        'sing': (_ellipse(.42 * aspect * .62, .72), True, True, []),
        'ee': (np.array([[-w, .34], [w, .34], [w, -.34], [-w, -.34]]), True, True,
               [np.array([[-w, 0.], [w, 0.]])]),
        'grin': (_closed_mouth(aspect, w * 1.1, .30, .72, .26), True, True,
                 [np.array([[-w * 1.0, .02], [w * 1.0, .02]])]),
    }


def _segment_distance(px, py, a, b):
    ab = b - a
    t = np.clip(((px - a[0]) * ab[0] + (py - a[1]) * ab[1]) / max(ab @ ab, 1e-12), 0, 1)
    return np.hypot(px - (a[0] + t * ab[0]), py - (a[1] + t * ab[1]))


def _stitches(points, closed, dash=.55, gap=.26):
    """Break a polyline into dashes (list of point pairs) like running-stitch floss."""
    if closed:
        points = np.concatenate([points, points[:1]])
    lengths = np.hypot(*np.diff(points, axis=0).T)
    cumulative = np.concatenate([[0], np.cumsum(lengths)])
    pairs, start = [], 0.
    total = cumulative[-1]
    while start < total:
        end = min(start + dash, total)
        pairs.append((np.array([np.interp(start, cumulative, points[:, k]) for k in (0, 1)]),
                      np.array([np.interp(end, cumulative, points[:, k]) for k in (0, 1)])))
        start = end + gap
    return pairs


def _inside(points, px, py):
    """Even-odd fill of a closed polygon for every pixel."""
    inside = np.zeros(px.shape, dtype=bool)
    n = len(points)
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        crosses = (y0 > py) != (y1 > py)
        slope_x = x0 + (py - y0) * (x1 - x0) / (y1 - y0 + 1e-12)
        inside ^= crosses & (px < slope_x)
    return inside


def draw_atlas(p, aspect, skin_rgb):
    """1024x512 sRGB atlas (rows top-down): stitched floss shapes on body-colour felt."""
    width, height = ATLAS
    cell = width // COLUMNS
    floss = np.array([int(p.floss[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    inside = np.array([int(p.mouth_inside[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    cream = np.array([.97, .93, .86])
    atlas = np.empty((height, width, 3), dtype=np.float32)
    atlas[:] = skin_rgb
    shapes = mouth_shapes(aspect)
    ys, xs = np.mgrid[0:cell, 0:cell].astype(np.float32)
    cell_x = ((xs + .5) / cell * 2 - 1) * aspect
    cell_y = -((ys + .5) / cell * 2 - 1)               # image rows run downward
    pixel = 2 / cell                                   # one texel in half-height units (y)
    thickness = .075                                   # floss half-width, half-height units (readable at game size)
    for index, name in enumerate(MOUTH_CELLS):
        outline, closed, filled, extra = shapes[name]
        tile = np.empty((cell, cell, 3), dtype=np.float32)
        tile[:] = skin_rgb
        if filled:
            mask = _inside(outline, cell_x, cell_y)
            tile[mask] = inside
        # Teeth line and other inner seams in cream floss, outline in dark floss.
        for line in extra:
            for a, b in _stitches(line, False, .45, .25):
                d = _segment_distance(cell_x, cell_y, a, b)
                tile[d < thickness * .8] = cream
        for a, b in _stitches(outline, closed):
            d = _segment_distance(cell_x, cell_y, a, b)
            shade = np.clip((thickness - d) / pixel, 0, 1)[..., None]
            tile = tile * (1 - shade) + floss * shade
        row, column = divmod(index, COLUMNS)
        atlas[row * cell:(row + 1) * cell, column * cell:(column + 1) * cell] = tile
    return atlas


def build_mouth(p, frame, rig, tree, skin_srgb):
    spec = p.mouth
    cx = frame.point((spec.x, 0, 0)).x
    cz = frame.point((0, 0, spec.z)).z
    half_w, half_h = frame.length(spec.half_w), frame.length(spec.half_h)
    aspect = half_w / half_h
    atlas = draw_atlas(p, aspect, skin_srgb)
    image = bpy.data.images.new('mouth_atlas', *ATLAS, alpha=False)
    image.colorspace_settings.name = 'sRGB'
    rgba = np.ones((ATLAS[1], ATLAS[0], 4), dtype=np.float32)
    rgba[..., :3] = atlas[::-1]                         # Blender images are stored bottom-up
    image.pixels.foreach_set(rgba.ravel())
    image.pack()

    material = bpy.data.materials.new('felt_mouth')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = .95
    shader.inputs['Specular IOR Level'].default_value = 0
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    links.new(texture.outputs['Color'], shader.inputs['Base Color'])

    # Elliptical patch (polar grid) projected onto the face, first atlas cell UVs inset by two texels.
    rings, segments = 6, 28
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    inset = 2 / (ATLAS[0] // COLUMNS)
    centre = bm.verts.new(surface(tree, cx, cz)[0])
    ideal = {centre: (0., 0.)}
    grid = [[centre]]
    for ring in range(1, rings + 1):
        row = []
        for segment in range(segments):
            angle = math.tau * segment / segments
            x = cx + half_w * ring / rings * math.cos(angle)
            z = cz + half_h * ring / rings * math.sin(angle)
            hit, normal = surface(tree, x, z)
            vertex = bm.verts.new(hit + normal * spec.lift)
            ideal[vertex] = (ring / rings * math.cos(angle), ring / rings * math.sin(angle))
            row.append(vertex)
        grid.append(row)

    def unit(vertex):
        # UVs come from the ideal patch position, not the projected one: they stay inside the first cell.
        x, z = ideal[vertex]
        cell = 1. / COLUMNS
        # First atlas cell: top-left of the image, i.e. u in [0, 1/4], Blender v in [1/2, 1].
        return (inset + (cell - 2 * inset) * (.5 + .5 * x), .5 + inset + (.5 - 2 * inset) * (.5 + .5 * z))

    faces = []
    for segment in range(segments):
        nxt = (segment + 1) % segments
        faces.append([centre, grid[1][segment], grid[1][nxt]])
        for ring in range(1, rings):
            faces.append([grid[ring][segment], grid[ring + 1][segment], grid[ring + 1][nxt], grid[ring][nxt]])
    for corners in faces:
        face = bm.faces.new(corners)
        if face.normal.y > 0:
            face.normal_flip()
        face.smooth = True
        for loop in face.loops:
            loop[uv].uv = unit(loop.vert)
    bm.normal_update()
    me = bpy.data.meshes.new('mouth')
    bm.to_mesh(me)
    bm.free()
    mouth = bpy.data.objects.new('mouth', me)
    bpy.context.collection.objects.link(mouth)
    mouth.data.materials.append(material)
    parent_to_bone(mouth, rig, 'head')
    return mouth


def build_face(p, frame, rig, body, color):
    """Create eye, lid and mouth objects parented to the head bone; returns {name: object}."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    tree = BVHTree.FromBMesh(bm)
    spec = p.eyes
    mid = frame.point((spec.mid_x, 0, 0)).x
    body_rgb = skin_color(body, color, tree, mid, frame.point((0, 0, spec.z)).z + 2.0 * frame.length(spec.radius),
                          frame.length(.03))
    objects = build_eyes_and_lids(p, frame, rig, tree, body_rgb)
    mouth = p.mouth
    around = mouth_color(body, color, frame.point((mouth.x, 0, 0)).x, frame.point((0, 0, mouth.z)).z,
                         frame.length(mouth.half_w), frame.length(mouth.half_h))
    print(f'{p.title} mouth felt (sRGB) {np.round(around, 3)}, forehead {np.round(body_rgb, 3)}')
    objects['mouth'] = build_mouth(p, frame, rig, tree, around)
    bm.free()
    return objects
