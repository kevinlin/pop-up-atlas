"""Small mesh-building tools for stitched felt, scored paper and thread."""
from collections import defaultdict
from math import cos, pi, sin, tau

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
import numpy as np


PALETTE = {
    "hot_pink": "E8478F", "pink": "F4A6C8", "lavender": "B79AE0",
    "violet": "7A52C7", "sky": "7EC8E8", "mint": "9EE0B8", "lime": "A7D84A",
    "butter": "F7DC6F", "orange": "F59A3C", "tomato": "D9453B",
    "cream": "F6EAD2", "core": "FFF8EC", "kraft": "B38B5C",
    "leaf": "659B50", "brown": "8A5A3B", "plum": "81395F",
    "sage": "BCD08A", "fern": "93B476", "moss": "AABF67",
    "seafoam": "ABCDB0", "lilac_ground": "BBACCB",
    "stream": "4669C8", "deep_stream": "5247AC", "white": "FFFFFF",
}


def linear_rgb(hex_color):
    srgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4 for c in srgb)


def image_from_pixels(directory, name, rgb, non_color=False, alpha=None):
    height, width, _ = rgb.shape
    image = bpy.data.images.new(name, width, height, alpha=alpha is not None)
    if non_color:
        image.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb
    if alpha is not None:
        rgba[:, :, 3] = alpha
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(directory / (name + ".png"))
    image.file_format = 'PNG'
    image.save()
    return bpy.data.images.load(image.filepath_raw)


def fibre_height(gray):
    half = gray[::2, ::2]
    smudges = sum(np.roll(half, (dx, dy), (0, 1)) for dx, dy in
                  ((-2, -1), (-1, 2), (0, 0), (1, -2), (2, 1))) / 5
    return .58 * half + .42 * smudges


def seamless_paper(gray):
    # Give every edge the same symmetric fibre profile. The colour wash starts inside it.
    size = gray.shape[0]
    symmetric = sum(np.rot90(gray, turn) + np.rot90(gray[:, ::-1], turn)
                    for turn in range(4)) / 8
    edge_equal = (symmetric + np.roll(symmetric, 1, 0) + np.roll(symmetric, 1, 1)
                  + np.roll(symmetric, (1, 1), (0, 1))) / 4
    profile = (edge_equal[0] + edge_equal[-1] + edge_equal[:, 0] + edge_equal[:, -1]) / 4
    profile = (profile + profile[::-1]) / 2
    xy = np.linspace(0, 1, size)
    x, y = np.meshgrid(xy, xy)
    fade = np.sin(pi * x)**2 * np.sin(pi * y)**2
    mottling = .029 * np.sin(2.1 * pi * x + .8) * np.cos(2.4 * pi * y - .5)
    paper = np.clip(.95 + (gray - .88) * .65 + fade * mottling, .76, 1)
    profile = .95 + (profile - .88) * .65
    for i in range(5, -1, -1):
        weight = (1 - i / 6)**2
        paper[i] = paper[i] * (1 - weight) + profile * weight
        paper[-1 - i] = paper[-1 - i] * (1 - weight) + profile * weight
        paper[:, i] = paper[:, i] * (1 - weight) + profile * weight
        paper[:, -1 - i] = paper[:, -1 - i] * (1 - weight) + profile * weight
    paper[0] = paper[-1] = paper[:, 0] = paper[:, -1] = profile
    return paper


def fringe_pixels(felt):
    # Broader clumps survive mipmapping at the walking camera's distance.
    rng = np.random.default_rng(722)
    u = np.linspace(0, 1, 128, endpoint=False)
    v = np.linspace(0, 1, 48)[:, None]
    clumps = rng.uniform(.47, .94, 24)
    clumps[::6] = [.99, .95, .98, .96]
    guides = np.arange(len(clumps) + 1) / len(clumps)
    curl = u + v * (.035 + .022 * np.sin(u * 14 * pi))
    length = np.interp(curl.ravel() % 1, guides, np.r_[clumps, clumps[0]]).reshape(curl.shape)
    threads = .06 * np.sin(curl * 43 * tau) + .045 * np.sin(curl * 57 * tau)
    alpha = np.clip(.45 + (length + threads - v) * 8, 0, 1)
    alpha[-1] = 0
    tint = np.clip(.96 + (felt[:48, :128] - .65) * .28 - v * .07, .76, 1)
    return np.repeat(tint[:, :, None], 3, axis=2), alpha


class Materials:
    def __init__(self, source, scratch):
        self.materials = {}
        self.textures = {}
        channels = {}
        for name in ("felt-base", "cardstock", "page", "cutpaper-edge", "glitter", "stitch"):
            original = bpy.data.images.load(str(source / (name + ".png")))
            width, height = original.size
            pixels = np.empty(width * height * 4, dtype=np.float32)
            original.pixels.foreach_get(pixels)
            channels[name] = pixels.reshape((height, width, 4))
            # Blender stores PNG bytes as sRGB values. Normalize them for palette tinting.
        for name, brightness, grain in (("felt-base", .67, 1.72), ("cardstock", .69, .96),
                                        ("cutpaper-edge", .72, .71), ("stitch", .60, .68)):
            pixels = channels[name]
            grayscale = pixels[:, :, :3].mean(axis=2)
            if name in ("cutpaper-edge", "stitch"):
                if name == "stitch":
                    # Use the floss itself to texture the raised, individually spaced stitches.
                    y, x = np.unravel_index(np.argmax(pixels[:, :, 3]), grayscale.shape)
                    grayscale = grayscale[y:y + 1, x:x + 1] * .20 + grayscale[max(0, y-3):y+4, max(0, x-18):x+19] * .80
                else:
                    center = grayscale.shape[0] // 2
                    grayscale = grayscale[center - 14:center + 14, :]
            if name == "stitch":
                grayscale = np.where(grayscale < .35, .70, grayscale)
            if name == "felt-base":
                # Widen the fibres from the source so they survive the game's mip levels.
                grayscale = fibre_height(grayscale)
            if name == "cardstock":
                grayscale = grayscale[::2, ::2]
            values = np.clip(.85 + (grayscale - brightness) * grain, .36, 1.)
            rgb = np.repeat(values[:, :, None], 3, axis=2)
            self.textures[name] = image_from_pixels(scratch, name + "_albedo", rgb)
        page = seamless_paper(channels["page"][::2, ::2, :3].mean(axis=2))
        self.textures["page"] = image_from_pixels(scratch, "page_fibres", np.repeat(page[:, :, None], 3, axis=2))
        felt = fibre_height(channels["felt-base"][:, :, :3].mean(axis=2))
        fringe, alpha = fringe_pixels(felt)
        self.textures["fringe"] = image_from_pixels(scratch, "felt_fringe", fringe, alpha=alpha)
        dy, dx = np.gradient(felt)
        normal = np.stack((-dx * 7.2, -dy * 7.2, np.ones_like(dx)), axis=2)
        normal /= np.linalg.norm(normal, axis=2, keepdims=True)
        self.textures["normal"] = image_from_pixels(scratch, "felt_fibre_normal", normal * .5 + .5, True)
        self.textures["normal"].colorspace_settings.name = 'Non-Color'

        mask = channels["glitter"][:, :, :3].max(axis=2)
        mask = mask.reshape(512, 2, 512, 2).max(axis=(1, 3))
        # Low contrast flakes remain visible between the rare, reflective points.
        fleck = np.clip((mask - np.quantile(mask, .993)) * 6, 0, 1)
        mottled = np.clip((mask - np.quantile(mask, .72)) * 2.1, 0, .40)
        scatter = .88 + .25 * mask[:, :, None]
        self.glitter = {}
        sky = np.asarray([0x7e, 0xc8, 0xe8]) / 255
        violet = np.asarray([0x7a, 0x52, 0xc7]) / 255
        cross = np.linspace(0, 1, mask.shape[1])[None, :, None]
        along = np.linspace(0, tau * 2, mask.shape[0])[:, None, None]
        t = np.clip(cross + .08 * np.sin(along + cross * 6), 0, 1)
        water = sky * (1 - t) + violet * t
        for name, color in (("river", water), ("rim", (.79, .53, .23)),
                            ("sugar", (.70, .38, .62))):
            tinted_flake = np.array([.90, .85, 1.]) + .10 * np.sin(mask[:, :, None] * 23)
            base = np.asarray(color) * scatter
            albedo = base * (1 - mottled[:, :, None]) + tinted_flake * mottled[:, :, None]
            albedo = albedo * (1 - fleck[:, :, None]) + .99 * fleck[:, :, None]
            self.glitter[name] = image_from_pixels(scratch, "glitter_" + name, albedo)
        roughness = np.repeat((.75 - fleck * .61)[:, :, None], 3, axis=2)
        self.textures["glitter_roughness"] = image_from_pixels(scratch, "glitter_roughness", roughness, True)
        self.textures["glitter_roughness"].colorspace_settings.name = 'Non-Color'

    def get(self, name):
        if name in self.materials:
            return self.materials[name]
        prefix, shade = name.split("_", 1)
        fringe = shade.startswith("fringe_")
        washi = shade.startswith("washi_")
        if fringe or washi:
            shade = shade.split("_", 1)[1]
        color = linear_rgb(PALETTE.get(shade, PALETTE["cream"]))
        if fringe:
            color = tuple(min(1, x * 1.21 + .031) for x in color)
        texture = {"felt": "felt-base", "card": "cardstock", "yarn": "stitch"}.get(prefix)
        if shade == "core" and prefix == "card":
            texture = "cutpaper-edge"
        if name == "card_page":
            texture = "page"
        if fringe:
            texture = "fringe"

        material = bpy.data.materials.new(name)
        self.materials[name] = material
        material.use_nodes = True
        material.diffuse_color = (*color, 1)
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Roughness"].default_value = .92
        bsdf.inputs["Specular IOR Level"].default_value = 0
        if prefix == "felt" and not fringe:
            bsdf.inputs["Sheen Weight"].default_value = .27
            bsdf.inputs["Sheen Tint"].default_value = (*color, 1)
            normal_image = nodes.new("ShaderNodeTexImage")
            normal_image.image = self.textures["normal"]
            normal = nodes.new("ShaderNodeNormalMap")
            normal.inputs["Strength"].default_value = .65
            links.new(normal_image.outputs["Color"], normal.inputs["Color"])
            links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
        albedo = nodes.new("ShaderNodeTexImage")
        if prefix == "glitter":
            albedo.image = self.glitter[shade]
            albedo.interpolation = 'Closest'
            bsdf.inputs["Metallic"].default_value = .34
            bsdf.inputs["Specular IOR Level"].default_value = .35
            roughness = nodes.new("ShaderNodeTexImage")
            roughness.image = self.textures["glitter_roughness"]
            roughness.interpolation = 'Closest'
            channels = nodes.new("ShaderNodeSeparateColor")
            links.new(roughness.outputs["Color"], channels.inputs["Color"])
            links.new(channels.outputs["Green"], bsdf.inputs["Roughness"])
            links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            albedo.image = self.textures[texture]
            tint = nodes.new("ShaderNodeMix")
            tint.data_type = 'RGBA'
            tint.blend_type = 'MULTIPLY'
            sockets = {socket.identifier: socket for socket in tint.inputs}
            sockets["Factor_Float"].default_value = 1
            sockets["B_Color"].default_value = (*color, 1)
            links.new(albedo.outputs["Color"], sockets["A_Color"])
            links.new(next(socket for socket in tint.outputs if socket.type == 'RGBA'),
                      bsdf.inputs["Base Color"])
        if fringe:
            threshold = nodes.new("ShaderNodeMath")
            threshold.operation = 'GREATER_THAN'
            threshold.inputs[1].default_value = .38
            links.new(albedo.outputs["Alpha"], threshold.inputs[0])
            links.new(threshold.outputs[0], bsdf.inputs["Alpha"])
        elif washi:
            bsdf.inputs["Alpha"].default_value = .71
        return material


def empty(name, parent=None, location=(0, 0, 0)):
    node = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(node)
    node.parent = parent
    node.location = location
    return node


def ccw(points):
    points = [Vector(p) for p in points]
    area = sum(a.x * b.y - a.y * b.x for a, b in zip(points, points[1:] + points[:1]))
    return points if area > 0 else points[::-1]


def inset(points, distance, miter=.42):
    inner = []
    for i, point in enumerate(points):
        before = point - points[i - 1]
        after = points[(i + 1) % len(points)] - point
        normal_a = Vector((-before.y, before.x)).normalized()
        normal_b = Vector((-after.y, after.x)).normalized()
        bisector = (normal_a + normal_b).normalized()
        amount = min(distance / max(miter, bisector.dot(normal_a)), before.length * .4, after.length * .4)
        inner.append(point + bisector * amount)
    return inner


def oval(x, y, rx, ry, steps=24, angle=0):
    points = []
    for i in range(steps):
        t = tau * i / steps
        wobble = 1 + .022 * sin(5 * t + 2 * x) + .012 * cos(7 * t - y)
        u, v = rx * cos(t) * wobble, ry * sin(t) * wobble
        points.append((x + u * cos(angle) - v * sin(angle), y + u * sin(angle) + v * cos(angle)))
    return points


def curves(start, sections, steps=6):
    points = [Vector(start)]
    for control1, control2, end in sections:
        a, b, c, d = points[-1], Vector(control1), Vector(control2), Vector(end)
        for i in range(1, steps + 1):
            t = i / steps
            points.append(a * (1 - t)**3 + b * (3 * (1 - t)**2 * t) + c * (3 * (1 - t) * t**2) + d * t**3)
    if (points[-1] - points[0]).length < 1e-6:
        points.pop()
    return points


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def skew_rect(x, y, w, h, angle):
    return [(x + u * cos(angle) - v * sin(angle), y + u * sin(angle) + v * cos(angle))
            for u, v in rect(-w / 2, -h / 2, w / 2, h / 2)]


def front(point, depth):
    return (point[0], -depth, point[1])


def level(point, height):
    return (point[0], point[1], height)


def sample_path(points, cycle, distance):
    segments = list(zip(points, points[1:] + (points[:1] if cycle else [])))
    for a, b in segments:
        length = (b - a).length
        if distance <= length:
            return a.lerp(b, max(0, distance) / length)
        distance -= length
    return points[0] if cycle else points[-1]


class Craft:
    def __init__(self, name, materials):
        self.root = empty(name)
        self.base = empty("base", self.root)
        self.hinges = []
        self.batches = defaultdict(lambda: ([], [], []))
        self.smooth = defaultdict(list)
        self.materials = materials

    def hinge(self, x, ground, heading=0):
        index = len(self.hinges)
        parent, location = self.root, (x, ground, 0)
        if heading:
            # One rotated mount keeps the V-fold's local hinge axes at identity in glTF.
            parent = empty(f"fold_axis_{index}", self.root, location)
            parent.rotation_euler.z = heading
            location = (0, 0, 0)
        node = empty(f"hinge_{index}", parent, location)
        self.hinges.append(node)
        return node

    def scale_card(self, hinge, width, height):
        for (parent, _), (vertices, _, _) in self.batches.items():
            if parent == hinge:
                vertices[:] = [(x * width, y, z * height) for x, y, z in vertices]

    def add(self, parent, material, coordinates, uv, faces, smooth=False):
        verts, uvs, polygons = self.batches[parent, material]
        self.smooth[parent, material].extend([smooth] * len(faces))
        polygons.extend(tuple(i + len(verts) for i in face) for face in faces)
        verts.extend(coordinates)
        uvs.extend(uv)

    def cut(self, parent, points, start, end, skin, *, side=None, bevel=.0018, place=front):
        points = ccw(points)
        n = len(points)
        rim = inset(points, bevel) if bevel else points
        levels = [(rim, start), (points, start + bevel), (points, end - bevel), (rim, end)]
        # Triangulate in the card plane, even when the paper is scored or bowed.
        triangles = tessellate_polygon([[Vector((p.x, p.y, 0)) for p in rim]])
        scale = 1.9 if skin.startswith("glitter_") else .64
        uv = [(p.x * scale, p.y * scale) for p in rim]
        self.add(parent, skin, [place(p, end) for p in rim], uv, triangles)
        self.add(parent, skin, [place(p, start) for p in rim], uv, [tri[::-1] for tri in triangles])
        wall = side or skin
        for (lower, low), (upper, high) in zip(levels, levels[1:]):
            if low == high:
                continue
            coords = [place(p, d) for ring, d in ((lower, low), (upper, high)) for p in ring]
            wall_uv = [(p.x * scale + p.y * .12, p.y * scale + d * 5) for ring, d in
                       ((lower, low), (upper, high)) for p in ring]
            self.add(parent, wall, coords, wall_uv,
                     [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)])

    def tube(self, parent, coords, radius, material, sides=5, *, caps=True, smooth=False):
        centers = [Vector(pos) for pos in coords]
        vertices, uv = [], []
        length = 0
        for i, center in enumerate(centers):
            tangent = (centers[min(i + 1, len(centers) - 1)] - centers[max(0, i - 1)]).normalized()
            guide = Vector((0, 0, 1)) if abs(tangent.z) < .85 else Vector((0, 1, 0))
            a = tangent.cross(guide).normalized()
            b = tangent.cross(a)
            if i:
                length += (center - centers[i - 1]).length
            for k in range(sides):
                angle = tau * k / sides
                local_radius = radius * (.74 if i in (0, len(centers) - 1) else 1.)
                vertices.append(center + local_radius * (a * cos(angle) + b * sin(angle)))
                uv.append((k / sides, length * 35))
        faces = [tuple(range(sides))[::-1]] if caps else []
        for j in range(len(centers) - 1):
            a, b = j * sides, (j + 1) * sides
            faces.extend((a+k, a+(k+1)%sides, b+(k+1)%sides, b+k) for k in range(sides))
        if caps:
            faces.append(tuple(range(len(vertices) - sides, len(vertices))))
        self.add(parent, material, vertices, uv, faces, smooth)

    def sew(self, parent, points, depth, material="yarn_butter", *, cycle=False, place=front,
            spacing=.053, radius=.0021, rise=None, sink=0., caps=True):
        # A positive sink pulls both ends of every stitch into the felt beneath the raised arc.
        rise = radius * .58 if rise is None else rise
        points = [Vector(p) for p in points]
        total = sum((a - b).length for a, b in zip(points, points[1:] + (points[:1] if cycle else [])))
        count = max(1, round(total / spacing))
        step = total / count
        for i in range(count):
            center = (i + .5) * step + .0025 * sin(i * 1.89)
            span = min(step * .32, .015) * (1 + .10 * cos(i * 3.21))
            a, b = [sample_path(points, cycle, center + offset) for offset in (-span, span)]
            self.tube(parent, [place(a, depth - sink), place(a.lerp(b, .50), depth + rise),
                               place(b, depth - sink)], radius, material, sides=3, caps=caps)

    def shell(self, parent, outline, middle, start, end, material, lift, *,
              rings=(.5, .78, .86, .93), place=front, fuzz=True):
        """Felt that bends out of the card: lift(p) and lift(p, False) offset its two faces."""
        outline = ccw(outline)
        middle = Vector(middle)
        n = len(outline)
        scale = .64

        def surface(fractions, depth, top):
            loops = [[middle.lerp(p, f) for p in outline] for f in fractions] + [outline]
            points = [middle] + [p for loop in loops for p in loop]
            faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
            for k in range(len(loops) - 1):
                a, b = 1 + k * n, 1 + (k + 1) * n
                faces.extend((a + i, b + i, b + (i + 1) % n, a + (i + 1) % n) for i in range(n))
            self.add(parent, material, [place(p, depth + lift(p, top)) for p in points],
                     [(p.x * scale, p.y * scale) for p in points],
                     faces if top else [face[::-1] for face in faces], smooth=True)

        surface(rings, end, True)
        surface((.6,), start, False)
        edge = [place(p, start + lift(p, False)) for p in outline]
        edge += [place(p, end + lift(p, True)) for p in outline]
        self.add(parent, material, edge,
                 [(p.x * scale + p.y * .12, p.y * scale + d * 5) for d in (start, end) for p in outline],
                 [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)])
        if fuzz:
            self.fringe(parent, outline, end - .001, "felt_fringe_" + material[5:],
                        lambda p, d: place(p, d + lift(p, True)))

    def felt(self, parent, points, material, *, start=.005, end=.0175, stitch=None,
             place=front, rim=None, fuzz=True):
        points = ccw(points)
        if rim:
            self.cut(parent, inset(points, -.010), max(.005, start - .004), start, rim, bevel=.0008, place=place)
        self.cut(parent, points, start, end, material, place=place)
        if fuzz:
            self.fringe(parent, points, end - .001, "felt_fringe_" + material[5:], place)
        if stitch:
            self.sew(parent, inset(points, .023), end, stitch, cycle=True, place=place)

    def fringe(self, parent, outline, depth, material, place):
        distances = [0.]
        for a, b in zip(outline, outline[1:] + outline[:1]):
            distances.append(distances[-1] + (b - a).length)
        width = min(.038, max(.010, distances[-1] * .024))
        outer = inset(outline, -width, miter=.79)
        if place is front:
            outer = [(p.x, max(0, p.y)) for p in outer]
        inner = inset(outline, .0035)
        points, uv, faces = [], [], []
        for i, u in enumerate(distances):
            j = i % len(outline)
            points.extend((place(inner[j], depth), place(outer[j], depth - .0024)))
            uv.extend(((u * 3.4, .017), (u * 3.4, .991)))
            if i:
                a = (i - 1) * 2
                faces.append((a + 1, a + 3, a + 2, a))
        self.add(parent, material, points, uv, faces)

    def finish(self):
        for (parent, material), (verts, uvs, polygons) in self.batches.items():
            mesh = bpy.data.meshes.new(parent.name + "_" + material)
            mesh.from_pydata(verts, [], polygons)
            mesh.update()
            layer = mesh.uv_layers.new()
            for loop in mesh.loops:
                layer.data[loop.index].uv = uvs[loop.vertex_index]
            flags = self.smooth[parent, material]
            if any(flags):
                sharp = mesh.attributes.get("sharp_face")
                if sharp is None:
                    sharp = mesh.attributes.new("sharp_face", 'BOOLEAN', 'FACE')
                sharp.data.foreach_set("value", [not flag for flag in flags])
                mesh.update()
            obj = bpy.data.objects.new(material, mesh)
            bpy.context.collection.objects.link(obj)
            obj.parent = parent
            obj.data.materials.append(self.materials.get(material))
        self.batches.clear()
        self.smooth.clear()
