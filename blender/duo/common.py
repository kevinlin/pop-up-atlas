"""Small helpers shared by the build, the inspector and the sheet renderer."""
import json
import math
import struct
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector


def require(condition, message):
    if not condition:
        raise ValueError(message)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def smooth(start, end, value):
    t = min(1., max(0., (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def ease(t):
    t = min(1., max(0., t))
    return t * t * (3 - 2 * t)


def read_gltf(path):
    """Return (json, binary chunk or None) of a GLB."""
    data = Path(path).read_bytes()
    magic, version, size = struct.unpack('<4sII', data[:12])
    require(magic == b'glTF' and version == 2 and size == len(data), 'Invalid glTF 2.0 binary header')
    length, kind = struct.unpack('<I4s', data[12:20])
    require(kind == b'JSON', 'Missing glTF JSON chunk')
    document = json.loads(data[20:20 + length])
    rest = data[20 + length:]
    binary = None
    if len(rest) >= 8:
        blength, bkind = struct.unpack('<I4s', rest[:8])
        if bkind == b'BIN\x00':
            binary = rest[8:8 + blength]
    return document, binary


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=float).reshape(4, 4).T
    x, y, z, w = node.get('rotation', (0, 0, 0, 1))
    sx, sy, sz = node.get('scale', (1, 1, 1))
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = rot * np.array([sx, sy, sz])
    m[:3, 3] = node.get('translation', (0, 0, 0))
    return m


class NodeTree:
    """The glTF node graph with rest-pose world matrices: what three.js sees before any clip plays."""

    def __init__(self, document):
        self.nodes = document['nodes']
        self.parent = {}
        for index, node in enumerate(self.nodes):
            for child in node.get('children', ()):
                self.parent[child] = index
        self.by_name = {}
        for index, node in enumerate(self.nodes):
            self.by_name.setdefault(node.get('name'), index)

    def world(self, index):
        matrix = node_matrix(self.nodes[index])
        parent = self.parent.get(index)
        while parent is not None:
            matrix = node_matrix(self.nodes[parent]) @ matrix
            parent = self.parent.get(parent)
        return matrix

    def named(self, name):
        require(name in self.by_name, f'GLB has no node named {name}')
        return self.by_name[name]

    def ancestors(self, index):
        parent = self.parent.get(index)
        while parent is not None:
            yield self.nodes[parent].get('name')
            parent = self.parent.get(parent)


def blender_to_gltf(point):
    """Blender (Z up, front -Y) to glTF (Y up, front +Z)."""
    return np.array((point[0], point[2], -point[1]))


def points(obj, *, posed=False):
    """World-space vertex array (n, 3) of a mesh object, optionally evaluated with modifiers/pose."""
    if posed:
        obj = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    coords = np.empty(3 * len(obj.data.vertices), dtype=np.float32)
    obj.data.vertices.foreach_get('co', coords)
    transform = np.array(obj.matrix_world)
    return coords.reshape(-1, 3) @ transform[:3, :3].T + transform[:3, 3]


def set_clip(rig, clip):
    rig.animation_data.action, rig.animation_data.action_slot = clip


def action_bag(action):
    return action.layers[0].strips[0].channelbag(action.slots[0])


def frame_at(scene, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)


def identity_pose(rig):
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)


def lerp(a, b, t):
    return a + (b - a) * t


def vec(values):
    return Vector(values)


def mat_rotation(angle, axis):
    return Matrix.Rotation(angle, 4, axis)


def parent_to_bone(obj, rig, bone_name):
    """Rigidly parent `obj` (unparented, placed by location/rotation/scale) to a bone without moving it.
    Blender measures bone children from the bone tail, so the parent inverse cancels head-to-tail."""
    bpy.context.view_layer.update()
    bone = rig.pose.bones[bone_name]
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    tail = Matrix.Translation((0, bone.bone.length, 0))
    obj.matrix_parent_inverse = (rig.matrix_world @ bone.matrix @ tail).inverted()
