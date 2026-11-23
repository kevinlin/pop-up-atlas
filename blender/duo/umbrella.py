"""Companion B's umbrella, built here (not part of the Tripo mesh): `umbrella_closed` and `umbrella_open`
under the `hand_r` bone. Both are rigid; `umbrella_open` is authored at scale 0 and popped open by the
runtime. Both objects have their origin at the grip."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from common import activate, parent_to_bone
from face import make_material
from params import hex_linear

CANOPY_RADIUS = .175
CANOPY_HEIGHT = .075
POLE = .33
TILT = math.radians(32)             # the open umbrella leans away from the head so it clears the hair


def _object(name, bm, materials):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    for material in materials:
        obj.data.materials.append(material)
    return obj


def _tube(bm, start, end, r0, r1, material_index, segments=8):
    """Cone frustum between two points."""
    direction = (end - start)
    length = direction.length
    result = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r0, radius2=r1, depth=length)
    verts = result['verts']
    rotation = Vector((0, 0, 1)).rotation_difference(direction.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((start + end) / 2) @ rotation, verts=verts)
    for face in {f for v in verts for f in v.link_faces}:
        face.material_index = material_index
    return verts


def _hook(bm, end, radius, r, material_index, steps=8):
    """J-shaped handle: a half circle that continues the shaft end and curls toward +Y."""
    points = [end + Vector((0, radius * (1 - math.cos(math.pi * k / steps)), -radius * math.sin(math.pi * k / steps)))
              for k in range(steps + 1)]
    for a, b in zip(points, points[1:]):
        _tube(bm, a, b, r, r, material_index, segments=6)


def build_umbrella(p, rig):
    spec = p.umbrella
    canopy = make_material(f'felt_{p.key}_umbrella', hex_linear(spec.canopy), roughness=.92)
    handle = make_material(f'felt_{p.key}_handle', hex_linear(spec.handle), roughness=.55)
    hand = rig.data.bones['hand_r']
    grip = (hand.head_local + hand.tail_local) / 2

    # --- open: a ribbed scalloped dome on a slim pole, leaning outward (-X is B's right) ----------------
    bm = bmesh.new()
    up = Vector((0, 0, 1))
    top = Vector((0, 0, POLE))
    _tube(bm, Vector((0, 0, -.04)), top, .0065, .0065, 1)
    ribs, rings = 8, 5
    layers = [[bm.verts.new(top + Vector((0, 0, CANOPY_HEIGHT * .55)))]]
    for ring in range(1, rings + 1):
        t = ring / rings
        angle = t * math.pi / 2
        row = []
        for rib in range(ribs * 2):
            scallop = 1 - (.07 * t ** 2 if rib % 2 else 0)
            radius = CANOPY_RADIUS * math.sin(angle) * scallop
            height = CANOPY_HEIGHT * .55 * math.cos(angle) - (CANOPY_HEIGHT * .45 * t ** 3)
            phi = math.pi * rib / ribs
            row.append(bm.verts.new(top + Vector((radius * math.cos(phi), radius * math.sin(phi), height))))
        layers.append(row)
    for i in range(ribs * 2):
        j = (i + 1) % (ribs * 2)
        bm.faces.new([layers[0][0], layers[1][j], layers[1][i]]).material_index = 0
        for ring in range(1, rings):
            bm.faces.new([layers[ring][i], layers[ring][j], layers[ring + 1][j], layers[ring + 1][i]]).material_index = 0
    # ferrule on top and a thickness shell so the felt reads from underneath
    _tube(bm, top + Vector((0, 0, CANOPY_HEIGHT * .5)), top + Vector((0, 0, CANOPY_HEIGHT * .5 + .03)), .007, .002, 1)
    _hook(bm, Vector((0, 0, -.04)), .026, .0065, 1)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    opened = _object('umbrella_open', bm, (canopy, handle))
    solid = opened.modifiers.new('Felt thickness', 'SOLIDIFY')
    solid.thickness = -.004
    solid.use_even_offset = True
    activate(opened)
    bpy.ops.object.modifier_apply(modifier=solid.name)
    opened.data.transform(Matrix.Rotation(-TILT, 4, 'Y'))        # lean toward -X
    opened.location = grip
    parent_to_bone(opened, rig, 'hand_r')
    opened.scale = (0, 0, 0)

    # --- closed: a cane-like furled umbrella pointing forward and down ------------------------------------
    bm = bmesh.new()
    _tube(bm, Vector((0, 0, -.05)), Vector((0, 0, .32)), .006, .006, 1)
    _tube(bm, Vector((0, 0, .06)), Vector((0, 0, .21)), .027, .024, 0, segments=10)
    _tube(bm, Vector((0, 0, .21)), Vector((0, 0, .31)), .024, .003, 0, segments=10)
    _tube(bm, Vector((0, 0, .31)), Vector((0, 0, .335)), .005, .005, 1, segments=6)
    _hook(bm, Vector((0, 0, -.05)), .026, .0065, 1)
    closed = _object('umbrella_closed', bm, (canopy, handle))
    aim = Vector((-.12, -.62, -.78)).normalized()
    closed.data.transform(Vector((0, 0, 1)).rotation_difference(aim).to_matrix().to_4x4())
    closed.location = grip
    parent_to_bone(closed, rig, 'hand_r')
    return {'umbrella_open': opened, 'umbrella_closed': closed}
