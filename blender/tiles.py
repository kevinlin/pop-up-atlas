"""The nine socket tiles and the three pieces of the scrapbook substrate."""
from contextlib import contextmanager
from math import atan2, cos, hypot, pi, radians, sin, tau
from random import Random

import bpy
from mathutils import Vector

from craft import Craft, ccw, curves, empty, front, inset, level, oval, rect, sample_path, skew_rect


RIVER_HALF = .36
PATH_HALF = .235
BRIDGE_HALF = .32
# Cupped petals: depth of the bowl at the tip, across the width, the curled rim and the stitch groove.
PETAL_CORE, PETAL_BOWL, PETAL_ACROSS, PETAL_ROLL, PETAL_GROOVE = .12, .030, .009, .008, .003
# The front row of petals rides above the back row by more than felt + rim, so it shades it.
PETAL_FRONT_ROW = .022


class TileCraft(Craft):
    """Craft plus the round-6 export features (contract "Round 6" → Light, ground and props).

    - `piece` collects everything built inside it into one mesh node with its own name (`appl_<k>`,
      `deco_<motif>_<k>`), one material slot per material and optional `extras` (the appliqué layer).
    - `pivot` makes a `sec_<k>` empty nested in a hinge; parts built with that empty as parent keep their
      hinge-space coordinates, and `finish` moves the mesh nodes back by the pivot's offset, so the pivot sits
      at the part's joint with identity rotation (authored at rest, local X = the hinge's fold axis).
    - `dome` makes a `dome_<k>` empty for one card of a hero cap.
    """

    def __init__(self, name, materials):
        super().__init__(name, materials)
        self.pieces = []
        self.current = None
        self.pivots = {}
        self.counts = {"appl": 0, "deco": 0, "dome": 0}
        self.motifs = ()
        self.lean = False
        self.detail = 3
        self.spots = 0

    def add(self, parent, material, coordinates, uv, faces, smooth=False):
        piece = self.current
        if piece is None:
            return super().add(parent, material, coordinates, uv, faces, smooth)
        if parent is not piece["parent"]:
            raise ValueError(f"{piece['name']} was opened on {piece['parent'].name}, not {parent.name}")
        verts, uvs, polygons = piece["batches"].setdefault(material, ([], [], []))
        piece["smooth"].setdefault(material, []).extend([smooth] * len(faces))
        polygons.extend(tuple(i + len(verts) for i in face) for face in faces)
        verts.extend(coordinates)
        uvs.extend(uv)

    @contextmanager
    def piece(self, parent, kind, motif=None, **extras):
        if self.current is not None:
            raise RuntimeError("pieces do not nest")
        index = self.counts[kind]
        self.counts[kind] += 1
        name = f"appl_{index}" if kind == "appl" else f"deco_{motif}_{index}"
        self.current = {"parent": parent, "name": name, "extras": extras, "batches": {}, "smooth": {}}
        try:
            yield name
        finally:
            piece, self.current = self.current, None
            if piece["batches"]:
                self.pieces.append(piece)

    def pivot(self, hinge, x, y):
        sec = empty(f"sec_{len(self.pivots)}", hinge)
        self.pivots[sec] = [hinge, x, y]
        return sec

    def dome(self, hinge):
        index = self.counts["dome"]
        self.counts["dome"] += 1
        return empty(f"dome_{index}", hinge)

    def scale_card(self, hinge, width, height):
        owners = {hinge, *(sec for sec, (parent, _, _) in self.pivots.items() if parent == hinge)}
        for (parent, _), (vertices, _, _) in self.batches.items():
            if parent in owners:
                vertices[:] = [(x * width, y, z * height) for x, y, z in vertices]
        for sec, joint in self.pivots.items():
            if joint[0] == hinge:
                joint[1] *= width
                joint[2] *= height

    def running(self, parent, points, depth, material="yarn_butter", *, cycle=False, place=front,
                spacing=.056, radius=.0022):
        """A running stitch of flat three-sided strands: 6 triangles a stitch instead of sew's 14."""
        points = [Vector(p) for p in points]
        total = sum((a - b).length for a, b in zip(points, points[1:] + (points[:1] if cycle else [])))
        count = max(1, round(total / spacing))
        step = total / count
        rise = radius * .58
        for i in range(count):
            center = (i + .5) * step
            a, b = (sample_path(points, cycle, center + offset) for offset in (-step * .31, step * .31))
            self.tube(parent, [place(a, depth + rise), place(b, depth + rise)], radius, material,
                      sides=3, caps=False)

    def emit(self, parent, name, mesh_name, entries):
        verts, uvs, polygons, flags, slots, indices = [], [], [], [], [], []
        for material, v, u, p, f in entries:
            base = len(verts)
            verts.extend(v)
            uvs.extend(u)
            polygons.extend(tuple(i + base for i in face) for face in p)
            flags.extend(f)
            indices.extend([len(slots)] * len(p))
            slots.append(material)
        mesh = bpy.data.meshes.new(mesh_name)
        mesh.from_pydata(verts, [], polygons)
        mesh.update()
        layer = mesh.uv_layers.new()
        for loop in mesh.loops:
            layer.data[loop.index].uv = uvs[loop.vertex_index]
        if any(flags):
            sharp = mesh.attributes.get("sharp_face")
            if sharp is None:
                sharp = mesh.attributes.new("sharp_face", 'BOOLEAN', 'FACE')
            sharp.data.foreach_set("value", [not flag for flag in flags])
            mesh.update()
        if len(slots) > 1:
            mesh.polygons.foreach_set("material_index", indices)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        for material in slots:
            obj.data.materials.append(self.materials.get(material))
        if parent in self.pivots:
            _, x, y = self.pivots[parent]
            obj.location = (-x, 0, -y)
        return obj

    def finish(self):
        for (parent, material), (verts, uvs, polygons) in self.batches.items():
            self.emit(parent, material, parent.name + "_" + material,
                      [(material, verts, uvs, polygons, self.smooth[parent, material])])
        for piece in self.pieces:
            entries = [(material, *piece["batches"][material], piece["smooth"][material])
                       for material in piece["batches"]]
            obj = self.emit(piece["parent"], piece["name"], piece["name"] + "_mesh", entries)
            for key, value in piece["extras"].items():
                obj[key] = value
        for sec, (_, x, y) in self.pivots.items():
            sec.location = (x, 0, y)
        self.batches.clear()
        self.smooth.clear()
        self.pieces.clear()


# Decoration motifs (review L4): small, sparse details that replace the old pink glue rectangles. Each one is
# a `deco_<motif>_<k>` mesh node. All heights are above the page; `z` lifts them onto a taller surface.
YARN = ("hot_pink", "orange", "butter", "tomato", "violet", "sky", "lime", "pink", "lavender", "mint")
FELT = ("hot_pink", "butter", "violet", "orange", "sky", "pink", "lime", "tomato")


def tone(c, palette, shift=0):
    return palette[(c.spots * 3 + shift) % len(palette)]


def ring(c, x, y, i, spread, phase=0):
    a = i * 2.3 + phase
    return x + spread * cos(a) * (i > 0), y + spread * sin(a) * (i > 0)


def knot(c, x, y, s, z):
    """French knots: a few small coils of yarn."""
    with c.piece(c.base, "deco", "knot"):
        for i in range(c.detail):
            px, py = ring(c, x, y, i, .027 * s, .4)
            r = .012 * s
            path = [(px + r * cos(1.7 * tau * k / 7) * (1 - .3 * k / 7),
                     py + r * sin(1.7 * tau * k / 7) * (1 - .3 * k / 7),
                     z + .0035 + .007 * k / 7) for k in range(8)]
            c.tube(c.base, path, .0048 * s, "yarn_" + tone(c, YARN, 2 * i), 4, smooth=True)


def sequin(c, x, y, s, z):
    """Sequins: glitter discs, overlapped like a spilled pile, each held by a tiny bead."""
    with c.piece(c.base, "deco", "sequin"):
        for i in range(c.detail):
            px, py = ring(c, x, y, i, .034 * s, .6)
            r = .028 * s
            low = z + i * .0012
            c.cut(c.base, oval(px, py, r, r, 9, i), low, low + .0032, "glitter_" + ("rim", "sugar", "rim")[i],
                  bevel=.0005, place=level)
            if c.detail > 1:
                c.cut(c.base, oval(px, py, r * .3, r * .3, 6), low + .0032, low + .0058,
                      "felt_" + tone(c, FELT, i), bevel=.0004, place=level)


def bead(c, x, y, s, z):
    """A short strand of glass seed beads."""
    count = c.detail + 1
    with c.piece(c.base, "deco", "bead"):
        for i in range(count):
            t = i / (count - 1)
            px, py = x + s * (-.05 + .10 * t), y + s * .016 * sin(pi * t)
            c.tube(c.base, [(px, py, z + .002), (px, py, z + .0075), (px, py, z + .013)],
                   .0105 * s, "glitter_sugar", 5)


def button(c, x, y, s, z):
    """A small sewn felt button: dish and cross of thread."""
    r = .05 * s
    with c.piece(c.base, "deco", "button"):
        c.cut(c.base, oval(x, y, r, r, 11), z, z + .0075, "felt_" + tone(c, FELT), bevel=.001, place=level)
        top = z + .0075
        if c.detail > 1:
            c.cut(c.base, oval(x, y, r * .66, r * .66, 11), top, top + .0017, "felt_" + tone(c, FELT, 3),
                  bevel=.0005, place=level)
            top += .0017
        for side in (-1, 1):
            c.tube(c.base, [(x - .016 * s, y - side * .016 * s, top + .0014),
                            (x + .016 * s, y + side * .016 * s, top + .0014)], .0026 * s, "yarn_cream", 4)


def heart(x, y, r, angle=0):
    points = []
    for i in range(16):
        t = tau * i / 16
        u = 16 * sin(t)**3
        v = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t) + 2
        points.append((x + r * (u * cos(angle) - v * sin(angle)) / 16, y + r * (u * sin(angle) + v * cos(angle)) / 16))
    return points


def star(x, y, r, angle=0):
    return [(x + r * (1 if i % 2 == 0 else .52) * cos(angle + pi / 2 + pi * i / 5),
             y + r * (1 if i % 2 == 0 else .52) * sin(angle + pi / 2 + pi * i / 5)) for i in range(10)]


def stitched(c, x, y, s, z):
    """A stitched felt shape: heart, star or scalloped blossom with a running stitch inside its edge."""
    kind = c.spots % 3
    r = .075 * s
    angle = .5 * sin(c.spots)
    points = (heart(x, y, r, angle), star(x, y, r * 1.1, angle), flower_shape(x, y, r * .9, 6, angle))[kind]
    with c.piece(c.base, "deco", "stitch"):
        c.felt(c.base, points, "felt_" + tone(c, FELT), start=z, end=z + .0065, place=level, fuzz=c.detail > 1)
        c.running(c.base, inset(ccw(points), .014 * s), z + .0065, "yarn_" + tone(c, YARN, 4), cycle=True,
                  place=level, spacing=.05, radius=.0018)


def pom(c, x, y, s, z):
    """Little felt pom-poms."""
    with c.piece(c.base, "deco", "pom"):
        for i in range(c.detail):
            px, py = ring(c, x, y, i, .034 * s, .3)
            c.tube(c.base, [(px, py, z + .0015), (px, py, z + .0085), (px, py, z + .0155)],
                   (.0135 - .002 * i) * s, "felt_" + tone(c, FELT, 3 * i), 6)


def cross(c, x, y, s, z):
    """Cross-stitches: a short row of X marks."""
    count = c.detail
    with c.piece(c.base, "deco", "cross"):
        for i in range(count):
            px, py = x + s * .045 * (i - (count - 1) / 2), y + s * .012 * (-1)**i
            h = .019 * s
            color = "yarn_" + tone(c, YARN, i)
            c.tube(c.base, [(px - h, py - h, z + .003), (px + h, py + h, z + .003)], .0024 * s, color, 3, caps=False)
            c.tube(c.base, [(px - h, py + h, z + .0055), (px + h, py - h, z + .0055)], .0024 * s, color, 3, caps=False)


MOTIFS = {"knot": knot, "sequin": sequin, "bead": bead, "button": button, "stitch": stitched, "pom": pom,
          "cross": cross}


def spot(c, x, ground, width, heading=0, z=.0015):
    """A decoration where a part meets the page (was a cream glue rectangle, review L4).

    The motif comes from the tile's own set, in turn, so a tile mixes its motifs; lean tiles (the river and
    the bridge sit near the triangle budget) decorate every second spot with the lean version.
    """
    if not c.motifs:
        return
    index = c.spots
    c.spots += 1
    if c.lean and index % 2:
        return
    MOTIFS[c.motifs[index % len(c.motifs)]](
        c, x + .043 * sin(heading), ground - .043 * cos(heading), max(.75, min(1.35, width / .15)), z)


def mapped(points, x, y, sx, sy):
    return [(x + u * sx, y + v * sy) for u, v in points]


def fold(c, rear, forward, height):
    """Score a triangular easel and angle its paper hinge across the page."""
    dx, dy = forward[0] - rear[0], forward[1] - rear[1]
    length = hypot(dx, dy)
    heading = atan2(dy, dx)
    hinge = c.hinge(*rear, heading)
    left, crease, right = (0, .008), (length * .51, .005), (length, .007)
    tip = (length, height)
    knee = (length * .76, height * .60)

    def scored(p, depth):
        crease_x = length * (.51 + .49 * p[1] / height)
        ridge = max(0, 1 - abs(p[0] - crease_x) / (length * .3))
        return front(p, depth + ridge * .006)

    c.cut(hinge, [left, crease, tip, knee], .005, .009, "card_cream", side="card_core",
          bevel=.0007, place=scored)
    c.cut(hinge, [crease, right, tip], .005, .009, "card_cream", side="card_core",
          bevel=.0007, place=scored)
    c.tube(hinge, [scored(crease, .0091), scored(tip, .0091)], .00075, "card_core", 4)
    x, y = rear[0] + dx * .46, rear[1] + dy * .46
    c.cut(c.base, skew_rect(x, y, length * .88, .091, heading), 0, .004,
          "card_cream", side="card_core", bevel=.0007, place=level)


def brace(c, foot, toe, height, outward, layer=0):
    """A cream paper wedge standing in front of a facade, glued to the page by a scored tab.

    The tall edge rests against the facade at foot; the slope runs down to toe on the page.
    Its hinge lies along the base so it folds flat beside its tab, away from the facade.
    """
    dx, dy = toe[0] - foot[0], toe[1] - foot[1]
    length = hypot(dx, dy)
    # Hinge at whichever end makes the wedge's flat side (local +Y) face outward.
    tall_first = dx * outward[1] - dy * outward[0] >= 0
    start, end = (foot, toe) if tall_first else (toe, foot)
    heading = atan2(end[1] - start[1], end[0] - start[0])
    hinge = c.hinge(*start, heading)
    drop = height * .028 / length
    if tall_first:
        outline = [(0, .003), (length, .003), (.028, height - drop), (0, height)]
    else:
        outline = [(0, .003), (length, .003), (length, height), (length - .028, height - drop)]
    # Thinner than the facade's card so the two never share a plane when both lie flat.
    c.cut(hinge, outline, .0012, .0046, "card_cream", side="card_core", bevel=.0006)
    c.tube(hinge, [front((.012, .0045), .0029), front((length - .012, .0045), .0029)],
           .0011, "card_core", 4)
    ux, uy = cos(heading), sin(heading)
    rx, ry = uy, -ux
    inner = .08 / length
    a = (start[0] + ux * length * (inner if tall_first else .04),
         start[1] + uy * length * (inner if tall_first else .04))
    b = (start[0] + ux * length * (.96 if tall_first else 1 - inner),
         start[1] + uy * length * (.96 if tall_first else 1 - inner))
    mid = ((a[0] + b[0]) / 2 + rx * .036, (a[1] + b[1]) / 2 + ry * .036)
    low = .0045 + layer * .0006
    span = hypot(b[0] - a[0], b[1] - a[1])
    c.cut(c.base, skew_rect(*mid, span, .068, heading), low, low + .0032,
          "card_cream", side="card_core", bevel=.0006, place=level)
    c.tube(c.base, [level((a[0] + rx * .004, a[1] + ry * .004), low + .0033),
                    level((b[0] + rx * .004, b[1] + ry * .004), low + .0033)],
           .001, "card_core", 4)


def v_brace(c, apex, height, length, splay):
    """Two wedges meeting under a narrow stem, opening toward the reader like a V-fold."""
    for layer, side in enumerate((-1, 1)):
        toe = (apex[0] + side * length * sin(splay), apex[1] - length * cos(splay))
        brace(c, apex, toe, height, (side, 0), layer)


def side_braces(c, feet, height, length, splay):
    """A wedge under each side of a wide facade, splayed outward."""
    for layer, (side, foot) in enumerate(zip((-1, 1), feet)):
        toe = (foot[0] + side * length * sin(splay), foot[1] - length * cos(splay))
        brace(c, foot, toe, height, (side, 0), layer)


def leaf_outline(x, y, dx, dy, width):
    side = Vector((dy, -dx)).normalized() * width
    p = Vector((x, y))
    direction = Vector((dx, dy))
    return curves(p, [(p + direction * .18 + side * .67, p + direction * .65 + side, p + direction),
                      (p + direction * .73 - side, p + direction * .23 - side * .57, p)], 8)


def leaf(c, hinge, x, y, dx, dy, width, shade, *, layer=.005, stitch=True):
    c.felt(hinge, leaf_outline(x, y, dx, dy, width), "felt_" + shade,
           start=layer, end=layer + .012, stitch="yarn_butter" if stitch else None)
    c.sew(hinge, [(x + dx * .19, y + dy * .19), (x + dx * .76, y + dy * .76)],
          layer + .0125, "yarn_cream", spacing=.058, radius=.00125)


GRASS = curves((-.52, .018), [
    ((-.48, .065), (-.47, .185), (-.33, .265)),
    ((-.35, .19), (-.30, .093), (-.245, .116)),
    ((-.26, .233), (-.194, .33), (-.141, .362)),
    ((-.127, .281), (-.105, .214), (-.045, .171)),
    ((-.001, .229), (.013, .318), (.145, .391)),
    ((.106, .291), (.147, .234), (.163, .168)),
    ((.22, .194), (.257, .277), (.347, .294)),
    ((.31, .226), (.337, .166), (.342, .123)),
    ((.401, .156), (.461, .181), (.502, .177)),
    ((.451, .1), (.472, .062), (.471, .018)),
    ((.238, .003), (-.201, .001), (-.52, .018)),
], 4)


def grass(c, x, ground, scale, height, material, heading=0):
    hinge = c.hinge(x, ground, heading)
    outline = mapped(GRASS, 0, 0, scale, height)
    c.cut(hinge, mapped(GRASS, 0, -.003, scale * 1.025, height * 1.033),
          .005, .009, "card_cream", side="card_core", bevel=.00065)
    c.felt(hinge, outline, "felt_" + material, start=.006, end=.018, stitch="yarn_cream")
    for u in (-.21, .22):
        spot(c, x + u * scale * cos(heading), ground + u * scale * sin(heading),
            scale * .23, heading)


def bud(c, x, ground, height, shade, scale=1):
    hinge = c.hinge(x, ground)
    spot(c, x, ground, .108 * scale)
    stem = leaf_outline(0, 0, .024, height, .052 * scale)
    c.cut(hinge, stem, .005, .009, "card_cream", side="card_core", bevel=.0006)
    c.felt(hinge, stem, "felt_leaf", start=.006, end=.018)
    leaf(c, hinge, .012, height * .29, -.133 * scale, .105 * scale, .045 * scale, "lime",
         stitch=False)
    radius = .095 * scale
    blossom = [(radius * (1 + .21 * cos(5 * t)) * cos(t) + .024,
                radius * (1 + .21 * cos(5 * t)) * sin(t) + height)
               for t in (tau * i / 30 for i in range(30))]
    c.felt(hinge, blossom, "felt_" + shade, start=.007, end=.019)
    c.felt(hinge, oval(.027, height, .032 * scale, .033 * scale, 13), "felt_butter",
           start=.013, end=.025)


def hill(c, x, ground, width, height, shade, seed, heading=0):
    hinge = c.hinge(x, ground, heading)
    rng = Random(seed)
    points = [(-width * .50, .008)]
    for i in range(1, 16):
        t = i / 15
        dome = sin(pi * t)**.74
        points.append((width * (t - .5), .009 + height * dome * rng.uniform(.91, 1.05)))
    points.extend(((width * .25, .002), (-width * .26, .004)))
    backing = mapped(points, 0, -.002, 1.035, 1.026)
    c.cut(hinge, backing, .005, .009, "card_cream", side="card_core", bevel=.00065)
    thread = "yarn_butter" if shade in {"violet", "lavender", "leaf"} else "yarn_plum"
    c.felt(hinge, points, "felt_" + shade, start=.008, end=.020, stitch=thread)
    spot(c, x, ground, min(width * .34, .145), heading)


def flower_shape(x, y, radius, lobes=5, spin=0):
    points = []
    for i in range(20):
        t = tau * i / 20
        r = radius * (1 + .25 * cos(lobes * t + spin) + .034 * sin(3 * t + spin))
        points.append((x + r * cos(t), y + r * sin(t)))
    return points


def petal_lift(center, angle, reach, rx, ry, layer):
    """Depth above the card for a cupped petal: bowl to the tip, curled rim, stitch groove."""
    px, py = center[0] + cos(angle) * reach, center[1] + sin(angle) * reach
    ux, uy = cos(angle), sin(angle)
    tip = reach + rx

    def frame(p):
        dx, dy = p[0] - px, p[1] - py
        return (dx * ux + dy * uy) / rx, (dy * ux - dx * uy) / ry

    def lift(p, top=True):
        a, b = frame(p)
        rho = min(1, hypot(a, b))
        s = min(1, max(0, (reach + a * rx - PETAL_CORE) / (tip - PETAL_CORE)))
        rim = max(0, (rho - .8) / .2) ** 2
        depth = layer + PETAL_BOWL * s ** 1.5 + PETAL_ACROSS * min(1, b * b) * s
        if not top:
            return depth + PETAL_ROLL * .7 * rim
        return depth + PETAL_ROLL * rim - PETAL_GROOVE * max(0, 1 - abs(rho - .86) / .05)

    return (px, py), frame, lift


def cupped_petal(c, hinge, center, angle, reach, rx, ry, shade, front_row):
    middle, frame, lift = petal_lift(center, angle, reach, rx, ry,
                                     PETAL_FRONT_ROW if front_row else 0)
    # Follow-through (round 6): each petal hangs from a `sec_<k>` pivot at its inner end, authored at rest.
    pivot = c.pivot(hinge, middle[0] - cos(angle) * rx * .85, middle[1] - sin(angle) * rx * .85)
    outline = oval(*middle, rx, ry, 22, angle)
    c.shell(pivot, outline, middle, .007, .017, shade, lift)
    # Stitch only the rim that stays visible: the whole outer arc of the front row,
    # the tip of the back row.
    groove = [Vector(middle).lerp(Vector(p), .86) for p in outline]
    shown = -.38 if front_row else .12
    arc = [groove[j] for j in range(-len(groove) // 2, len(groove) // 2) if frame(groove[j])[0] > shown]
    c.sew(pivot, arc, .017, "yarn_cream", place=lambda p, d: front(p, d + lift(p)),
          spacing=.05, radius=.0026, rise=.0046, sink=.0026, caps=False)


def cluster(c, x, ground, size, shifts, heading=0):
    """Three blossoms cut as a single page plane, with their own stems and petals."""
    hinge = c.hinge(x, ground, heading)
    spot(c, x, ground, .115 * size, heading)
    for i, (u, v, shade) in enumerate(shifts):
        dx, dy = u * size, v * size
        stem = [(u * .22 * size - .012, .006), (u * .22 * size + .012, .006),
                (dx + .012, dy), (dx - .012, dy)]
        c.cut(hinge, stem, .006, .018, "felt_leaf", bevel=.0012)
        leaves = leaf_outline(u * .52 * size, dy * .43, (.079 if i % 2 else -.081) * size,
                              .068 * size, .031 * size)
        c.cut(hinge, leaves, .008, .020, "felt_mint", bevel=.0009)
        radius = (.062, .093, .073)[i] * size
        c.felt(hinge, flower_shape(dx, dy, radius, spin=i * .61),
               "felt_" + shade, start=.007, end=.019)
        c.cut(hinge, oval(dx, dy, .022 * size, .022 * size, steps=10),
              .015, .026, "felt_butter", bevel=.0011)


def ground_sprigs(c, x, y, size, seed):
    rng = Random(seed)
    for i in range(6):
        dx, dy = rng.uniform(-.21, .21) * size, rng.uniform(-.11, .11) * size
        radius = rng.uniform(.022, .048) * size
        if i % 3 == 0:
            c.cut(c.base, flower_shape(x + dx, y + dy, radius, spin=i * .3),
                  .002, .006, "felt_" + ("hot_pink" if i == 0 else "lavender"),
                  bevel=.0006, place=level)
            c.cut(c.base, oval(x + dx, y + dy, radius * .33, radius * .34, 8),
                  .006, .010, "felt_butter", bevel=.0007, place=level)
        else:
            color = ("mint", "leaf", "sky", "cream")[i % 4]
            c.cut(c.base, oval(x + dx, y + dy, radius, radius * .58, 9, rng.random() * pi),
                  .001, .006, "felt_" + color, bevel=.0008, place=level)


def applique(c, x, y, rx, ry, shade, seed, layer=0, stitched=False, steps=25):
    rng = Random(seed)
    phase = rng.uniform(0, tau)
    rx = min(rx, (.992 - abs(x)) / 1.062)
    ry = min(ry, (.992 - abs(y)) / 1.062)
    points = []
    for i in range(steps):
        t = tau * i / steps
        r = .94 + .066 * sin(3 * t + phase) + .055 * cos(5 * t - phase)
        points.append((x + rx * r * cos(t), y + ry * r * sin(t)))
    low = .00045 + layer * .00070
    high = low + .00185
    c.cut(c.base, points, low, high, "felt_" + shade, bevel=.00055, place=level)
    if stitched:
        c.sew(c.base, [(x + (u - x) * .88, y + (v - y) * .88) for u, v in points],
              high, "yarn_cream", cycle=True, place=level, radius=.0025, spacing=.059)


def appl_piece(c, x, y, rx, ry, shade, seed, layer, stitched=False, steps=28):
    """One appliqué shape as an `appl_<k>` mesh node on layer 1-3 (review L4)."""
    rng = Random(seed)
    phase = rng.uniform(0, tau)
    rx = min(rx, (.992 - abs(x)) / 1.062)
    ry = min(ry, (.992 - abs(y)) / 1.062)
    points = []
    for i in range(steps):
        t = tau * i / steps
        r = .94 + .066 * sin(3 * t + phase) + .055 * cos(5 * t - phase)
        points.append((x + rx * r * cos(t), y + ry * r * sin(t)))
    low = .0004 + (layer - 1) * .001
    high = low + .0019
    with c.piece(c.base, "appl", layer=layer):
        c.cut(c.base, points, low, high, "felt_" + shade, bevel=.0006, place=level)
        if stitched:
            c.running(c.base, [(x + (u - x) * .9, y + (v - y) * .9) for u, v in points], high, "yarn_cream",
                      cycle=True, place=level, spacing=.056, radius=.0024)


def felt_ground(c, seed, shades):
    """Three big felt shapes, stacked on three layers and overlapping, the upper two stitched down."""
    rng = Random(seed)
    jx, jy = rng.uniform(-.04, .04), rng.uniform(-.04, .04)
    appl_piece(c, -.12 + jx, .16 + jy, .86, .80, shades[0], seed, 1)
    appl_piece(c, .22 - jx, -.22 + jy, .82, .74, shades[1], seed + 1, 2, stitched=True)
    appl_piece(c, .16 + jy, .40 - jx, .70, .56, shades[2], seed + 2, 3, stitched=True)


def band(points, lo, hi):
    """Clip a closed polygon to the vertical band lo <= x <= hi."""
    def clip(polygon, keep, cross):
        out = []
        for a, b in zip(polygon, polygon[1:] + polygon[:1]):
            if keep(a):
                out.append(a)
            if keep(a) != keep(b):
                out.append(cross(a, b))
        return out

    def at(x):
        return lambda a, b: a.lerp(b, (x - a.x) / (b.x - a.x))

    polygon = [Vector(p) for p in points]
    polygon = clip(polygon, lambda p: p.x >= lo, at(lo))
    return clip(polygon, lambda p: p.x <= hi, at(hi))


def centroid(points):
    area = cx = cy = 0
    for a, b in zip(points, points[1:] + points[:1]):
        cross_ = a.x * b.y - b.x * a.y
        area += cross_
        cx += (a.x + b.x) * cross_
        cy += (a.y + b.y) * cross_
    return Vector((cx / (3 * area), cy / (3 * area)))


def inside(points, p, margin=0):
    """Point in polygon, with a margin from every edge."""
    q = Vector((p[0], p[1]))
    hit = False
    for a, b in zip(points, points[1:] + points[:1]):
        if (a.y > q.y) != (b.y > q.y) and q.x < a.x + (q.y - a.y) / (b.y - a.y) * (b.x - a.x):
            hit = not hit
        ab = b - a
        t = max(0, min(1, (q - a).dot(ab) / ab.length_squared))
        if (q - (a + ab * t)).length < margin:
            return False
    return hit


def pillow(outline, bulge, reach=.15):
    """Stuffed felt: the front rises to `bulge` over `reach` from the edge, the back stays flat."""
    pairs = list(zip(outline, outline[1:] + outline[:1]))

    def lift(p, top=True):
        if not top:
            return 0
        q = Vector((p[0], p[1]))
        edge = min((q - (a + (b - a) * max(0, min(1, (q - a).dot(b - a) / (b - a).length_squared)))).length
                   for a, b in pairs)
        return bulge * sin(min(1, edge / reach) * pi / 2)
    return lift


def domed(lift):
    return lambda p, d: front(p, d + lift(p))


class Card:
    def __init__(self, parent, lift, shift, low, high, outline):
        self.parent, self.lift, self.shift, self.low, self.high = parent, lift, shift, low, high
        self.place = domed(lift)
        self.outline = outline

    def local(self, p):
        return (p[0] - self.shift, p[1])

    def holds(self, x, margin=0):
        return self.low + margin <= x <= self.high - margin


def dome_cap(c, x0, ground, outline, seams, felt, *, rim, tilt=radians(37), bulge=.035, decorate=None):
    """A felt cap as three stuffed cards fanned around the vertical (review L5, contract "Round 6").

    The outline is in the hinge frame of x0, already scaled. The centre card faces the front; the side
    cards hang from their own yawed hinges at the seams, so the normals span 2 x tilt (74° here) upright, and
    every card folds flat on its own hinge (no part stands up when flat). Each card gets a paper stalk to the
    page, behind the felt, where the old cap hung from the runtime's tie.
    """
    lo, hi = seams
    xs = [p[0] for p in outline]
    edges = (min(xs) - .001, lo, hi, max(xs) + .001)
    depth = -ground
    cards = []
    for k, (a, b) in enumerate(zip(edges, edges[1:])):
        if k == 1:
            hinge, shift = c.hinge(x0 + lo, ground), lo
        elif k == 2:
            hinge, shift = c.hinge(x0 + hi, ground, tilt), hi
        else:
            run = lo - edges[0]
            hinge, shift = c.hinge(x0 + lo - run * cos(tilt), -(depth - run * sin(tilt)), -tilt), edges[0]
        local = ccw([Vector((p.x - shift, p.y)) for p in band(outline, a, b)])
        card = Card(c.dome(hinge), pillow(local, bulge), shift, a, b, local)
        middle = centroid(local)
        if rim:
            c.cut(card.parent, inset(local, -.010), .005, .0078, rim, bevel=.0006)
        c.shell(card.parent, local, middle, .008, .020, felt, card.lift, rings=(.4, .68, .85, .94))
        c.running(card.parent, inset(local, .022), .020, "yarn_cream", cycle=True, place=card.place,
                  spacing=.05, radius=.0022)
        mid = (min(p.x for p in local) + max(p.x for p in local)) / 2
        top = min(p.y for p in local) + .15
        c.cut(card.parent, [(mid - .075, 0), (mid + .075, 0), (mid + .065, top), (mid - .065, top)],
              .0035, .0075, "card_cream", side="card_core", bevel=.0007)
        if decorate:
            decorate(card)
        cards.append(card)
    return cards


def bells(c, x, ground, height, shade, heading, direction=1):
    hinge = c.hinge(x, ground, heading)
    spot(c, x, ground, .16, heading)

    def shape(points):
        return mapped(points, 0, 0, .88 * direction, height)

    stalk = curves((-.035, .005), [
        ((-.022, .27), (-.08, .73), (.068, .93)),
        ((.19, 1.09), (.33, .96), (.43, .74)),
        ((.44, .69), (.40, .68), (.38, .73)),
        ((.25, .95), (.134, .96), (.085, .82)),
        ((.013, .62), (.060, .27), (.031, .005)),
        ((.011, .002), (-.015, .001), (-.035, .005)),
    ], 4)
    c.felt(hinge, shape(stalk), "felt_leaf", start=.005, end=.017)
    leaf(c, hinge, 0, .013, -.28 * direction, height * .72, .105, "leaf")
    leaf(c, hinge, 0, .022, .25 * direction, height * .54, .086, "lime", layer=.007)
    droop = curves((-.041, .025), [
        ((-.061, -.041), (-.072, -.102), (-.101, -.121)),
        ((-.078, -.169), (.084, -.156), (.100, -.117)),
        ((.068, -.091), (.053, -.030), (.044, .025)),
        ((.024, .048), (-.021, .046), (-.041, .025)),
    ], 4)
    for i, (u, v, scale) in enumerate(((.405, .735, 1.0), (.274, .826, .79))):
        blossom = shape(mapped(droop, u, v, scale, scale))
        c.felt(hinge, blossom, "felt_" + (shade if i == 0 else "pink"),
               start=.009, end=.021, stitch="yarn_butter")


def meadow(c, variant):
    shades = {
        'a': ("sage", "fern", "mint"),
        'b': ("sage", "moss", "seafoam"),
        'c': ("seafoam", "fern", "lilac_ground"),
    }[variant]
    felt_ground(c, ord(variant), shades)
    if variant == 'a':
        hill(c, -.47, .43, .89, .46, "lavender", 87, .24)
        hill(c, -.50, .20, .82, .30, "lime", 61, .16)
        grass(c, .55, -.48, .67, .78, "mint", -.47)
        cluster(c, .49, .39, 1.13, [(-.17, .23, "pink"), (.02, .33, "tomato"), (.17, .23, "lavender")], .4)
        bud(c, -.35, -.55, .27, "butter", 1.0)
        bells(c, .60, -.14, .68, "lavender", -.34, -1)
    elif variant == 'b':
        hill(c, -.41, .46, .97, .52, "mint", 90, .25)
        hill(c, -.48, .22, .91, .35, "sky", 12, .36)
        hill(c, -.42, -.027, .78, .27, "lime", 29, -.21)
        grass(c, .47, -.46, .80, .88, "lime", -.39)
        cluster(c, .47, .32, 1.18, [(-.20, .22, "lavender"), (.01, .39, "hot_pink"), (.19, .24, "pink")], -.4)
        bud(c, -.22, -.57, .29, "butter", .8)
        bells(c, .65, -.12, .83, "violet", .35, -1)
    else:
        hill(c, -.35, .44, 1.13, .55, "violet", 68, .25)
        hill(c, -.39, .18, .97, .40, "sky", 31, .31)
        hill(c, -.43, -.055, .88, .29, "mint", 58, .25)
        hill(c, .53, .12, .77, .41, "lime", 38, -.44)
        grass(c, .47, -.58, .83, .90, "leaf", -.38)
        cluster(c, .46, .40, 1.17, [(-.22, .26, "butter"), (-.02, .37, "hot_pink"), (.19, .27, "pink")], .28)
        cluster(c, -.45, -.51, 1.05, [(-.18, .20, "lavender"), (.01, .33, "orange"), (.17, .22, "pink")], -.23)
        bells(c, .65, -.22, .85, "lavender", -.30, -1)
    ground_sprigs(c, .19, -.42, .9, ord(variant))


def flower(c):
    front_y = -.595
    fold(c, (-.50, .13), (-.09, front_y), 1.04)
    fold(c, (.48, .06), (.035, front_y), .93)
    display = c.hinge(-.035, front_y)
    spot(c, -.13, front_y, .17)
    spot(c, .095, front_y, .17)
    stem = curves((-.084, .007), [
        ((-.075, .35), (-.16, .61), (-.049, 1.16)),
        ((-.021, 1.22), (.055, 1.2), (.063, 1.15)),
        ((-.039, .77), (.034, .41), (.096, .014)),
        ((.045, .002), (-.029, -.002), (-.084, .007)),
    ], 8)
    c.cut(display, mapped(stem, 0, 0, 1.30, 1.02), .005, .009, "card_cream",
          side="card_core", bevel=.00065)
    c.felt(display, stem, "felt_leaf")
    c.sew(display, [(.012, .11), (-.015, .42), (-.043, .75), (.01, 1.09)],
          .018, "yarn_lime", radius=.0016)
    # Stem leaves sit just above the V-fold brace, below the lowest petal.
    leaf(c, display, -.058, .435, -.29, .155, .088, "lime", layer=.012)
    leaf(c, display, -.026, .468, .25, .175, .074, "mint", layer=.013, stitch=False)
    center = (.02, 1.073)
    c.cut(display, oval(*center, .165, .156), .005, .009, "card_pink", bevel=.0007)
    # Three back petals, then three smaller front petals that overlap and shade them.
    for front_row in (False, True):
        for i in range(int(front_row), 6, 2):
            angle = i * tau / 6 + .25
            reach = (.222 if front_row else .246) + .012 * sin(i * 3.9)
            rx = (.232 if front_row else .262) + .012 * cos(i * 3.17)
            ry = (.150 if front_row else .170) + .004 * (i % 3)
            cupped_petal(c, display, center, angle, reach, rx, ry,
                         "felt_pink" if i == 3 else "felt_hot_pink", front_row)
    c.felt(display, oval(*center, .131, .125), "felt_orange", start=.037, end=.049,
           rim="glitter_rim")
    for i in range(7):
        t = tau * i / 7
        c.felt(display, oval(center[0] + .072 * cos(t), center[1] + .071 * sin(t), .035, .035, 12),
               "felt_butter", start=.047, end=.059)
    c.felt(display, oval(*center, .042, .042, 14), "felt_butter", start=.049, end=.061)
    c.scale_card(display, 1.36, 1.115)
    # The bloom stands on a V-fold whose base is about a quarter of its height.
    v_brace(c, (-.027, front_y - .019), .46, .43, .79)
    felt_ground(c, 31, ("sage", "seafoam", "mint"))
    hill(c, .59, -.73, .73, .24, "mint", 43, -.32)
    cluster(c, -.72, -.36, .91, [(-.15, .14, "lavender"), (.01, .26, "tomato"), (.17, .18, "pink")], .30)
    hill(c, -.50, .38, .92, .46, "lavender", 84, .30)
    hill(c, .52, .21, .91, .35, "lime", 72, -.39)
    bells(c, .68, -.16, .71, "violet", -.33, -1)


def mushroom_house(c):
    front_y = -.53
    fold(c, (.59, .13), (.181, front_y), 1.02)
    fold(c, (-.52, .05), (-.255, front_y), .82)
    h = c.hinge(-.045, front_y)
    spot(c, -.31, front_y, .18)
    spot(c, .25, front_y, .18)
    stem = curves((-.385, .014), [
        ((-.35, .27), (-.22, .56), (-.27, .92)),
        ((-.17, 1.04), (.19, 1.03), (.27, .88)),
        ((.226, .56), (.268, .28), (.372, .012)),
        ((.212, -.001), (-.231, .002), (-.385, .014)),
    ], 8)
    c.cut(h, mapped(stem, 0, -.004, 1.07, 1.015), .005, .009, "card_cream",
          side="card_core", bevel=.0008)
    c.felt(h, stem, "felt_cream", stitch="yarn_orange")
    # Follow-through (round 6): the door swings on its own pivot at its base, authored at rest.
    swing = c.pivot(h, -.01, .04)
    door = curves((-.183, .035), [
        ((-.183, .148), (-.162, .354), (-.123, .414)),
        ((-.071, .505), (.067, .494), (.105, .398)),
        ((.157, .295), (.149, .115), (.162, .039)),
        ((.075, .020), (-.076, .025), (-.183, .035)),
    ], 7)
    c.felt(swing, door, "felt_violet", start=.013, end=.025, stitch="yarn_butter")
    c.tube(swing, [front((-.005, .047), .0252), front((-.011, .365), .0252)], .0017,
           "yarn_lavender", 4)
    c.felt(swing, oval(.092, .219, .024, .024, 12), "felt_orange", start=.015, end=.027)
    c.felt(h, oval(.158, .588, .098, .102, 22, -.12), "felt_tomato", start=.012, end=.024)
    c.cut(h, oval(.158, .588, .074, .077, 20), .024, .026, "card_butter", bevel=.00045)
    for a, b in [((.087, .592), (.224, .578)), ((.153, .515), (.168, .658))]:
        c.tube(h, [front(a, .0264), front(b, .0264)], .0025, "yarn_cream")

    c.scale_card(h, 1.11, 1.18)
    # A wedge under each wall of the wide house, splayed outward on the page.
    side_braces(c, [(-.42, front_y - .025), (.32, front_y - .025)], .42, .43, .52)
    cap = curves((-.588, .758), [
        ((-.558, .938), (-.332, 1.23), (-.152, 1.331)),
        ((.003, 1.448), (.239, 1.485), (.373, 1.318)),
        ((.472, 1.207), (.562, 1.001), (.635, .844)),
        ((.692, .713), (.601, .736), (.444, .797)),
        ((.142, .927), (-.214, .867), (-.429, .741)),
        ((-.521, .681), (-.608, .683), (-.588, .758)),
    ], 8)
    cap = [Vector((p.x * 1.19, p.y * 1.18)) for p in cap]
    # Cream dots, laid out per card so none crosses a seam (x, y, rx, ry in the scaled hinge frame).
    dots = [(-.50, 1.02, .068, .058), (-.40, 1.22, .075, .066), (-.12, 1.40, .074, .068), (.12, 1.52, .062, .058),
            (.14, 1.17, .05, .052), (.46, 1.36, .088, .082), (.62, 1.14, .06, .056)]

    def decorate(card):
        for x, y, rx, ry in dots:
            if not card.holds(x, rx + .02):
                continue
            where = card.local((x, y))
            if not inside(card.outline, where, min(rx, ry) * .6):
                raise ValueError(f"cap dot ({x}, {y}) is not inside its card")
            c.felt(card.parent, oval(*where, rx, ry, 12, -.2), "felt_cream", start=.014, end=.026,
                   place=card.place)

    dome_cap(c, -.045, -.60, cap, (-.28, .30), "felt_tomato", rim="glitter_rim", decorate=decorate)
    felt_ground(c, 19, ("seafoam", "fern", "lilac_ground"))
    grass(c, .75, -.47, .36, .52, "mint", -.31)
    bud(c, -.69, -.14, .31, "lavender", 1.0)
    hill(c, .53, .24, .89, .49, "violet", 80, -.35)
    hill(c, -.51, .19, .84, .35, "lime", 29, .38)
    cluster(c, -.80, -.46, .80, [(-.17, .14, "pink"), (.025, .236, "tomato"), (.18, .13, "hot_pink")], .27)
    bells(c, .72, -.19, .69, "lavender", -.26, -1)


def densify(points, step=.04):
    out = [Vector(points[0])]
    for a, b in zip(points, points[1:]):
        a, b = Vector(a), Vector(b)
        n = max(1, round((b - a).length / step))
        out.extend(a.lerp(b, i / n) for i in range(1, n + 1))
    return out


def cupcake_tree(c):
    front_y = -.515
    fold(c, (-.54, .12), (-.105, front_y), 1.01)
    fold(c, (.52, .11), (.14, front_y), .92)
    h = c.hinge(.025, front_y)
    spot(c, -.12, front_y, .16)
    spot(c, .17, front_y, .17)
    trunk = curves((-.129, .009), [
        ((-.127, .232), (-.062, .56), (-.144, .81)),
        ((-.088, .907), (.123, .892), (.158, .81)),
        ((.063, .555), (.047, .213), (.144, .008)),
        ((.055, .024), (-.039, -.002), (-.129, .009)),
    ], 7)
    c.cut(h, mapped(trunk, 0, -.003, 1.21, 1.01), .005, .009, "card_cream",
          side="card_core", bevel=.0007)
    c.felt(h, trunk, "felt_brown", stitch="yarn_butter")
    c.sew(h, [(-.023, .083), (.018, .29), (.029, .55), (.006, .76)], .018, "yarn_orange")
    wrap = curves((-.316, .574), [
        ((-.351, .654), (-.419, .819), (-.457, .918)),
        ((-.249, .989), (.218, .995), (.477, .905)),
        ((.413, .804), (.394, .674), (.304, .575)),
        ((.108, .54), (-.131, .552), (-.316, .574)),
    ], 6)
    c.felt(h, wrap, "felt_orange", start=.008, end=.020, stitch="yarn_cream")
    for i in range(-4, 5):
        c.cut(h, [(i * .066 - .017, .583), (i * .066 + .008, .583),
                  (i * .090 + .019, .90), (i * .090 - .025, .904)],
              .020, .023, "card_butter", side="card_core", bevel=.0006)
    c.scale_card(h, 1.16, 1.10)
    v_brace(c, (.033, front_y - .02), .44, .43, .79)
    frosting = curves((-.487, .881), [
        ((-.569, .95), (-.474, 1.067), (-.407, 1.067)),
        ((-.49, 1.17), (-.329, 1.253), (-.281, 1.206)),
        ((-.306, 1.320), (-.163, 1.359), (-.108, 1.325)),
        ((-.118, 1.443), (.095, 1.482), (.160, 1.372)),
        ((.236, 1.402), (.333, 1.343), (.329, 1.247)),
        ((.450, 1.241), (.463, 1.164), (.45, 1.105)),
        ((.549, 1.079), (.585, .96), (.499, .898)),
        ((.407, .819), (.354, .902), (.291, .884)),
        ((.239, .868), (.194, .809), (.121, .855)),
        ((.035, .924), (-.016, .821), (-.105, .849)),
        ((-.164, .865), (-.247, .918), (-.304, .861)),
        ((-.372, .811), (-.448, .851), (-.487, .881)),
    ], 5)
    scaled = lambda p: Vector((p[0] * 1.29, p[1] * 1.075))
    frosting = [scaled(p) for p in frosting]
    seams = [densify([scaled(p) for p in line]) for line in (
        [(-.32, 1.113), (-.229, 1.073), (-.063, 1.06), (.087, 1.083), (.253, 1.118)],
        [(-.173, 1.265), (-.051, 1.218), (.083, 1.215), (.231, 1.247)])]
    # The same 27 sprinkles as before (same random draws), placed on whichever card holds them.
    rng = Random(75)
    sprinkles = []
    for i in range(27):
        y = rng.uniform(.925, 1.405)
        x = rng.uniform(-1, 1) * (.42 - .28 * (y - .94) / .46)
        angle = rng.uniform(-pi, pi)
        mat = ("felt_butter", "felt_mint", "felt_violet", "glitter_rim", "felt_tomato")[i % 5]
        sprinkles.append((scaled((x, y)), angle, mat))
    cherry = (scaled((.055, 1.497)), .075 * 1.29, .080 * 1.075)

    def decorate(card):
        for line in seams:
            part = [p for p in line if card.holds(p.x, .03)]
            if len(part) > 2:
                c.running(card.parent, [card.local(p) for p in part], .021, "yarn_hot_pink",
                          place=card.place, spacing=.05, radius=.0029)
        for where, angle, mat in sprinkles:
            local = card.local(where)
            if card.holds(where.x, .045) and inside(card.outline, local, .02):
                c.cut(card.parent, oval(*local, .023 * 1.29, .008 * 1.075, 9, angle), .019, .024, mat, bevel=0,
                      place=card.place)
        (cx, cy), rx, ry = cherry
        if card.holds(cx, rx):
            c.felt(card.parent, oval(*card.local((cx, cy)), rx, ry, 21), "felt_tomato", start=.008, end=.020,
                   place=card.place)
            stem = [((.06, 1.55), .011), ((.072, 1.583), .012), ((.111, 1.602), .012)]
            c.tube(card.parent, [card.place(card.local(scaled(p)), d) for p, d in stem], .006, "yarn_leaf", 5)

    dome_cap(c, .025, -.63, frosting, (-.28, .30), "felt_pink", rim="glitter_sugar", decorate=decorate)
    felt_ground(c, 27, ("sage", "moss", "seafoam"))
    grass(c, -.72, -.63, .46, .56, "lime", -.31)
    bud(c, .66, -.68, .31, "hot_pink", 1.0)
    hill(c, .48, .37, .92, .49, "violet", 88, .35)
    hill(c, .53, .06, .89, .33, "sky", 23, -.31)
    cluster(c, -.55, .29, 1.17, [(-.17, .155, "orange"), (.02, .31, "hot_pink"), (.19, .23, "pink")], .33)
    bells(c, -.70, -.25, .72, "lavender", .36)


def ribbon(corner):
    if not corner:
        return [(Vector((0, 1 - i / 15)), Vector((1, 0))) for i in range(31)]
    radius = .43
    line = [(Vector((0, 1 - i * (1 - radius) / 9)), Vector((1, 0))) for i in range(9)]
    for i in range(19):
        a = pi + i * pi / 36
        line.append((Vector((radius + radius * cos(a), radius + radius * sin(a))),
                     Vector((-cos(a), -sin(a)))))
    line.extend((Vector((radius + i * (1 - radius) / 9, 0)), Vector((0, 1))) for i in range(1, 10))
    return line


def offset(line, side, width, wobble=0):
    return [p + normal * side * (width + min(i, len(line) - 1 - i, 2) * .5 * wobble
                                 * (sin(i * 2.31 + side) + .48 * cos(i * 1.57)))
            for i, (p, normal) in enumerate(line)]


def strip(c, sides, low, high, mat, edge=None):
    c.cut(c.base, sides[0] + sides[1][::-1], low, high, mat, side=edge, bevel=.0007, place=level)


def bank_applique(c, corner, water, bridge=False):
    if corner:
        plots = [(-.66, .48, .33, .47), (-.49, -.50, .49, .45),
                 (.48, -.66, .49, .30), (.67, .67, .31, .31)]
    elif bridge:
        plots = [(-.70, .61, .29, .35), (-.72, -.62, .27, .35),
                 (.72, .62, .27, .34), (.69, -.61, .30, .33)]
    else:
        side = .69 if water else .63
        width = .30 if water else .36
        plots = [(-side, .46, width, .49), (-side, -.48, width, .47),
                 (side, .48, width, .49), (side, -.47, width, .49)]
    colors = ("sage", "seafoam", "fern", "moss") if water else ("fern", "sage", "seafoam", "moss")
    for i, (x, y, rx, ry) in enumerate(plots):
        applique(c, x, y, rx, ry, colors[i], 726 + i * 4, layer=i % 2, steps=22)


def path(c, corner):
    bank_applique(c, corner, False)
    line = ribbon(corner)
    borders = [offset(line, side, PATH_HALF, .011) for side in (-1, 1)]
    strip(c, borders, .0004, .013, "felt_butter")
    for side in (-1, 1):
        seam = offset(line, side, PATH_HALF - .037, .009)
        seam[0] = seam[0].lerp(seam[1], .52)
        seam[-1] = seam[-1].lerp(seam[-2], .52)
        c.sew(c.base, seam, .013, "yarn_orange", place=level, radius=.0031)
    if corner:
        grass(c, -.62, .44, .66, .79, "mint", .54)
        grass(c, .58, -.65, .73, .65, "lime", -.45)
        bud(c, -.46, -.37, .30, "pink", .94)
        cluster(c, .65, .67, .73, [(-.17, .20, "butter"), (.02, .29, "pink"), (.16, .16, "lavender")], .49)
        hill(c, -.55, -.22, .84, .38, "lavender", 72, -.46)
        hill(c, .57, -.39, .80, .31, "sky", 10, .45)
        bells(c, -.58, -.56, .70, "violet", .52)
        ground_sprigs(c, -.36, -.70, .83, 72)
    else:
        grass(c, -.61, -.42, .65, .73, "mint", .52)
        grass(c, .63, .43, .70, .74, "lime", -.60)
        cluster(c, -.60, .53, .95, [(-.17, .20, "pink"), (.02, .29, "tomato"), (.16, .16, "lavender")], -.58)
        bud(c, .61, -.45, .32, "lavender", .94)
        hill(c, -.62, .03, .72, .35, "sky", 69, -.67)
        hill(c, .63, -.05, .73, .38, "violet", 40, .63)
        bells(c, .62, -.58, .73, "lavender", -.60, -1)
        ground_sprigs(c, -.62, -.65, .90, 70)


def river(c, corner, bridge=False):
    bank_applique(c, corner, True, bridge)
    line = ribbon(corner)
    bank_line = line[::2] if bridge else line
    for side in (-1, 1):
        top = .406 if corner and side == 1 else RIVER_HALF + .054
        lower = .419 if corner and side == 1 else RIVER_HALF + .108
        strip(c, [offset(bank_line, side, RIVER_HALF - .026, .005),
                  offset(bank_line, side, lower, .006)],
              .0003, .0046, "card_mint", "card_core")
        strip(c, [offset(bank_line, side, RIVER_HALF - .013, .005),
                  offset(bank_line, side, top, .008)],
              .0046, .0091, "card_cream", "card_core")
        strip(c, [offset(bank_line, side, top - .011, .008), offset(bank_line, side, top + .011, .008)],
              .0045, .0088, "card_core")

    left, right = [offset(line, side, RIVER_HALF, .007) for side in (-1, 1)]
    row_width = 10
    vertices, uv, faces = [], [], []
    distance = 0
    for i, (center, _) in enumerate(line):
        if i:
            distance += (center - line[i - 1][0]).length
        for j in range(row_width):
            t = j / (row_width - 1)
            p = left[i].lerp(right[i], t)
            ripple = (.54 + .28 * sin(18 * distance + t * 5) +
                      .18 * sin(35 * distance - t * 7))
            window = sin(pi * t) * min(1, i / 3, (len(line) - 1 - i) / 3)
            vertices.append(level(p, .008 + .010 * window * ripple))
            uv.append((.008 + .984 * t, distance * .71))
            if i and j:
                k = i * row_width + j
                faces.append((k - row_width - 1, k - 1, k, k - row_width))
    c.add(c.base, "glitter_river", vertices, uv, faces)

    if corner:
        locations = [(-.65, .47, .61, .68, .53), (.63, .72, .71, .67, -.52),
                     (.54, -.63, .74, .70, .56)]
        cluster(c, -.56, -.04, .92, [(-.14, .20, "pink"), (.04, .29, "lavender"), (.18, .15, "orange")], -.59)
        hill(c, -.50, -.38, .86, .37, "mint", 48, .53)
        bells(c, -.58, -.56, .68, "violet", .52)
        ground_sprigs(c, .46, -.69, .75, 39)
    elif bridge:
        locations = [(-.64, .69, .61, .68, .42), (.68, -.68, .61, .68, -.51)]
        bud(c, .65, .58, .33, "hot_pink", .91)
        hill(c, -.67, -.58, .60, .38, "mint", 45, -.59)
        ground_sprigs(c, .67, .60, .65, 64)
    else:
        locations = [(-.66, .55, .62, .70, .56), (-.65, -.46, .63, .66, -.50),
                     (.65, -.30, .62, .77, .51), (.65, .66, .60, .60, -.47)]
        cluster(c, .66, .33, .91, [(-.16, .18, "tomato"), (.03, .32, "butter"), (.14, .17, "pink")], .61)
        hill(c, -.64, .02, .71, .37, "violet", 14, -.54)
        bells(c, .56, -.65, .72, "lavender", -.42)
        ground_sprigs(c, -.62, -.68, .72, 79)
    for i, (x, y, sx, sy, heading) in enumerate(locations):
        grass(c, x, y, sx, sy, ("mint", "lime", "sky")[i % 3], heading)


def bridge(c):
    river(c, False, bridge=True)

    def arch(x):
        return .198 * max(0, 1 - (x / .79)**2)**1.36

    def deck(point, thickness):
        x, y = point
        return (x, y, thickness + arch(x))

    for side in (-1, 1):
        rail_y = side * (BRIDGE_HALF - .021)
        profile = [(x, arch(x) + .006) for x in (-.75 + .075 * i for i in range(21))]
        under = [(x, max(.01, z - .072)) for x, z in profile]
        c.cut(c.base, profile + under[::-1], -.012, .012, "card_kraft", side="card_core",
              bevel=.001, place=lambda p, d: (p[0], rail_y - d, p[1]))
    for i in range(21):
        x = -.95 + i * .095
        last = i in (0, 20)
        angle = 0 if last else .032 * sin(i * 3.5)
        half = BRIDGE_HALF - (BRIDGE_HALF - PATH_HALF) * max(0, (abs(x) - .68) / .27)
        plank = skew_rect(x, 0 if last else .004 * cos(i * 1.7),
                          .100 if last else .088, half * 2, angle)
        mat = ("hot_pink", "pink", "orange", "butter", "lime", "mint", "sky",
               "lavender", "violet", "pink", "tomato")[i % 11]
        c.felt(c.base, plank, "felt_" + mat, start=.003, end=.016, place=deck, fuzz=False)
        if i not in (0, 20):
            for y in (-.235, .235):
                c.sew(c.base, [(x - .025, y), (x + .026, y)], .016, "yarn_cream",
                      spacing=.062, radius=.0022, place=deck)
    # Near arch edge: a raised felt lip, stitched along its length, proud of the kraft side.
    near = -(BRIDGE_HALF - .021) - .012

    def lip(p, d):
        return (p[0], near - d, max(.0006, p[1]))

    edge = [(x, max(.01, arch(x) + .006 - .072)) for x in (-.62 + .062 * i for i in range(21))]
    band = [(x, z - .008) for x, z in edge] + [(x, z + .028) for x, z in edge[::-1]]
    c.cut(c.base, band, -.002, .010, "felt_lime", bevel=0, place=lip)
    c.fringe(c.base, ccw(band), .009, "felt_fringe_lime", lip)
    c.sew(c.base, [(x, z + .010) for x, z in edge], .010, "yarn_hot_pink", place=lip,
          spacing=.05, radius=.0026, rise=.004, sink=.002, caps=False)
    # Chunky two-strand yarn rails; they lie flat inside a 0.08-unit envelope.
    rail_depth = .038
    for side in (-1, 1):
        y = side * (BRIDGE_HALF - .03) + rail_depth
        rail = c.hinge(0, y)
        for x in (-.66, -.33, .33, .66):
            spot(c, x, y, .095)
            bottom = arch(x) - .006
            top = arch(x) + .205
            end_post = abs(x) > .5
            c.tube(rail, [(x, -rail_depth, bottom), (x, -rail_depth, top)],
                   .012 if end_post else .0105, "yarn_violet", 7)
            z = arch(x) + .150
            if end_post:
                # Three full turns of yarn bind both strands to each end post.
                wrap = [(x + .029 * cos(tau * k / 12), -rail_depth + .029 * sin(tau * k / 12),
                         z - .042 + .084 * k / 36) for k in range(37)]
                c.tube(rail, wrap, .008, "yarn_hot_pink", 5, smooth=True)
            else:
                tie = [(x + .028 * cos(tau * k / 9), -rail_depth + .028 * sin(tau * k / 9),
                        z + .004 * k / 9) for k in range(10)]
                c.tube(rail, tie, .006, "yarn_pink", 4, smooth=True)
        for strand, color in enumerate(("yarn_hot_pink", "yarn_orange")):
            phase = strand * pi
            braid = [(x, -(rail_depth + .016 * cos(30 * x + phase)),
                      arch(x) + .150 + .016 * sin(30 * x + phase))
                     for x in (-.66 + k * (1.32 / 56) for k in range(57))]
            c.tube(rail, braid, .017, color, 5, smooth=True)


def page(c, alternate):
    points = rect(-1, -1, 1, 1)
    uv = rect(0, 0, 1, 1)
    if alternate:
        uv = uv[1:] + uv[:1]
    c.add(c.base, "card_page", [level(p, 0) for p in points], uv, [(0, 1, 2, 3)])


def page_decor(c, variant):
    # A corner of torn paper, a hand-sewn appliqué and one skewed piece of tape: layered `appl_<k>` pieces
    # (review L4, 1.28x linear, 1.64x the area), then two small decorations on the paper.
    x, y, angle, felt, tape = {
        'a': (-.55, -.54, .36, "mint", "pink"),
        'b': (.55, -.56, -.59, "lavender", "sky"),
        'c': (-.47, .55, -.29, "lime", "lavender"),
    }[variant]
    grow = 1.28
    rng = Random(ord(variant))
    paper = []
    for i in range(28):
        t = i * tau / 28
        wobble = rng.uniform(.92, 1.05)
        paper.append((x + .268 * grow * wobble * cos(t), y + .17 * grow * wobble * sin(t)))
    top = [(x + .045 * grow + (u - x) * .83, y - .016 * grow + (v - y) * .84) for u, v in paper]
    patch = oval(x + .065 * grow, y + .018 * grow, .148 * grow, .095 * grow, 20, angle)
    with c.piece(c.base, "appl", layer=1):
        c.cut(c.base, paper, .0007, .0049, "card_core", bevel=.00062, place=level)
    with c.piece(c.base, "appl", layer=2):
        c.cut(c.base, top, .0048, .0088, "card_cream", side="card_core", bevel=.00065, place=level)
    with c.piece(c.base, "appl", layer=3):
        c.felt(c.base, patch, "felt_" + felt, start=.006, end=.018, stitch="yarn_plum", place=level)
    tape_x, tape_y = x - .08 * grow, y - .086 * grow
    with c.piece(c.base, "appl", layer=3):
        c.cut(c.base, skew_rect(tape_x, tape_y, .33 * grow, .15 * grow, angle + .44), .009, .012,
              "card_washi_" + tape, bevel=.00055, place=level)
        for i in (-3, -1, 1, 3):
            a = angle + .44
            dx = i * .038 * grow
            thread = [(tape_x + dx * cos(a) - dy * sin(a), tape_y + dx * sin(a) + dy * cos(a))
                      for dy in (-.061 * grow, .061 * grow)]
            c.tube(c.base, [level(p, .0121) for p in thread], .00085, "card_core", sides=4)
    for dx, dy in ((-.19, .06), (.22, -.075)):
        c.spots += 1
        MOTIFS[c.motifs[c.spots % len(c.motifs)]](c, x + dx, y + dy, .9, .0092)


def gutter(c):
    def valley(x):
        return -.069 * max(0, 1 - (x / .22)**2)**2

    def paper(p, d):
        return (p[0], p[1], d + valley(p[0]))

    x_marks = [-1, -.26, -.22, -.18, -.14, -.10, -.06, -.025, 0,
               .025, .06, .10, .14, .18, .22, .26, 1]
    for a, b in zip(x_marks, x_marks[1:]):
        mat = "card_kraft" if abs(a + b) < .10 else "card_page"
        # Each narrow panel follows the cross-section without triangulating across the valley.
        c.add(c.base, mat, [paper(p, 0) for p in rect(a, -1, b, 1)],
              rect((a + 1) / 2, 0, (b + 1) / 2, 1), [(0, 1, 2, 3)])
    for x in (-.148, .152):
        c.sew(c.base, [(x, -.976), (x, .976)], .001, "yarn_pink", place=paper, radius=.0026)
    for i in range(9):
        y = -.86 + i * .215
        line = [paper((x, y + .017 * cos(j * pi / (len(x_marks) - 1))), .0021)
                for j, x in enumerate(x_marks[3:-3])]
        c.tube(c.base, line, .002, "yarn_cream", sides=4)


TILES = {
    "meadow": lambda c: meadow(c, 'b'),
    "meadow_a": lambda c: meadow(c, 'a'),
    "meadow_b": lambda c: meadow(c, 'b'),
    "meadow_c": lambda c: meadow(c, 'c'),
    "flower": flower,
    "mushroom_house": mushroom_house,
    "cupcake_tree": cupcake_tree,
    "path_straight": lambda c: path(c, False),
    "path_corner": lambda c: path(c, True),
    "river_straight": lambda c: river(c, False),
    "river_corner": lambda c: river(c, True),
    "yarn_bridge": bridge,
    "page_a": lambda c: page(c, False),
    "page_b": lambda c: page(c, True),
    "page_deco_a": lambda c: page_decor(c, 'a'),
    "page_deco_b": lambda c: page_decor(c, 'b'),
    "page_deco_c": lambda c: page_decor(c, 'c'),
    "gutter": gutter,
}


# Decoration motifs per tile (review L4). The sets are chosen so that, with the runtime's placement rules, no
# motif lands on more than 40 % of decorated cells (the inspector replays the placement on 20 seeds).
TILE_MOTIFS = {
    "flower": ("sequin", "bead"),
    "cupcake_tree": ("pom", "cross"),
    "mushroom_house": ("knot", "cross"),
    "meadow": ("bead", "sequin"),
    "meadow_a": ("button", "knot"),
    "meadow_b": ("bead", "sequin"),
    "meadow_c": ("pom", "stitch"),
    "path_straight": ("stitch",),
    "path_corner": ("knot",),
    "river_straight": ("pom",),
    "river_corner": ("sequin",),
    "yarn_bridge": ("bead",),
    "page_deco_a": ("button",),
    "page_deco_b": ("button",),
    "page_deco_c": ("stitch",),
}
# Tiles near the 15k triangle budget decorate every second spot, with the smallest version of each motif.
LEAN = {"river_straight", "river_corner", "yarn_bridge"}
# Detail 3 draws every element of a motif; props and the busier tiles draw fewer.
DETAIL = {"flower": 2, "mushroom_house": 2, "cupcake_tree": 2}


def build(name, materials):
    craft = TileCraft(name, materials)
    craft.motifs = TILE_MOTIFS.get(name, ())
    craft.lean = name in LEAN
    craft.detail = 1 if craft.lean else DETAIL.get(name, 3)
    TILES[name](craft)
    craft.finish()
    return craft
