"""Export and render tile assets with Blender 5.2 and Cycles CPU.

Blender -b --factory-startup --python-exit-code 1 -P blender/build_tiles.py
"""
import argparse
from math import cos, pi, radians, sin, sqrt
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic

import bpy
from mathutils import Vector
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from craft import Craft, Materials, image_from_pixels, level, linear_rgb, rect
from tile_coverage import CAMERA_DISTANCE, CAMERA_FOV, GRID_RESOLUTION, GRID_TARGET, counts_as_cover, coverage
from tile_glb import package
from tiles import TILES, build


ROOT = Path(__file__).resolve().parents[1]
# Round 6: the contact sheet shows the upright and the flat pose of every tile that folds.
FLAT_VIEWS = {name for name in TILES if not name.startswith("page_") and name != "gutter"}
GRID = (
    (("mushroom_house", 0), ("meadow_c", 0), ("river_straight", 0), ("flower", 0)),
    (("path_corner", 2), ("cupcake_tree", 0), ("river_straight", 0), ("meadow_a", 0)),
    (("path_corner", 0), ("path_straight", 1), ("yarn_bridge", 0), ("path_straight", 1)),
    (("flower", 0), ("meadow_b", 0), ("river_corner", 0), ("river_straight", 1)),
)
DECORATIONS = {(0, 1): 'a', (1, 3): 'b', (2, 1): 'c', (3, 0): 'a'}


def clear_objects():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def model(name, materials):
    return build(name, materials)


def export(craft, scratch, destination, textures):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (craft.root, *craft.root.children_recursive):
        obj.select_set(True)
    work = scratch / destination.stem
    work.mkdir()
    gltf = work / (destination.stem + ".gltf")
    bpy.ops.export_scene.gltf(
        filepath=str(gltf), export_format='GLTF_SEPARATE', use_selection=True,
        export_animations=False, export_cameras=False, export_lights=False, export_extras=True,
        export_image_format='AUTO', export_yup=True,
    )
    package(gltf, destination, textures)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def set_stage(scene, materials, board=False):
    ground = Craft("render_stage", materials)
    ground.cut(ground.base, rect(-100, -100, 100, 100), -.112, -.109, "card_brown",
               bevel=.0006, place=level)
    if board:
        # The spread has one backing underneath its 16 independent page surfaces.
        ground.cut(ground.base, rect(-4.05, -4.05, 4.05, 4.05), -.093, -.008, "card_cream",
                   side="card_core", place=level)
    ground.finish()

    spread = 2.35 if board else 1

    def area(label, xyz, hex_color, energy, size):
        data = bpy.data.lights.new(label, 'AREA')
        data.color = linear_rgb(hex_color)
        data.energy = energy * spread**2
        data.shape = 'DISK'
        data.size = size * spread
        lamp = bpy.data.objects.new(label, data)
        scene.collection.objects.link(lamp)
        lamp.location = Vector(xyz) * spread
        point_at(lamp, (0, 0, .35))

    area("Warm window", (-3.6, -4.1, 6), "FFD9A0", 820, 4)
    area("Pink-violet fill", (4, 1.9, 4), "C58BFF", 155, 4)
    area("Soft front bounce", (0, -2.2, 4), "FFE8F0", 140, 3)
    background = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = (*linear_rgb("D9C7DF"), 1)
    background.inputs["Strength"].default_value = .24

    lens = bpy.data.cameras.new("Game camera")
    lens.type = 'PERSP'
    lens.lens_unit = 'FOV'
    lens.sensor_fit = 'VERTICAL'
    lens.angle_y = radians(CAMERA_FOV)
    camera = bpy.data.objects.new("Game camera", lens)
    scene.collection.objects.link(camera)
    scene.camera = camera
    # Crop singles from the 14-unit projection. The spread uses the full game frame.
    scene.render.resolution_x, scene.render.resolution_y = GRID_RESOLUTION if board else (2000, 2000)
    scene.render.resolution_percentage = 100
    scene.render.use_border = scene.render.use_crop_to_border = not board
    scene.render.border_min_x = scene.render.border_min_y = .321
    scene.render.border_max_x = scene.render.border_max_y = .679
    scene.render.image_settings.file_format = 'PNG'
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 42 if board else 28
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 5
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 8
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = -.12


def render(scene, destination, center=(0, 0, 0), yaw=0):
    center = Vector(center)
    yaw = radians(yaw)
    scene.camera.location = center + Vector((sin(yaw), -cos(yaw), 1)) * (CAMERA_DISTANCE / sqrt(2))
    point_at(scene.camera, center)
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    if not destination.is_file():
        raise RuntimeError(f"Cycles did not write {destination}")


def render_tile(craft, materials, name, evidence):
    scene = bpy.context.scene
    if name not in {"page_a", "page_b", "gutter"}:
        model("page_a", materials)
    set_stage(scene, materials)
    hero = name in {"flower", "mushroom_house", "cupcake_tree"}
    render(scene, evidence / f"{name}-upright.png", (0, 0, .38 if hero else 0), yaw=13)
    if name in FLAT_VIEWS:
        for hinge in craft.hinges:
            hinge.rotation_euler.x = -pi / 2
        render(scene, evidence / f"{name}-flat.png", yaw=13)


def grid_geometry(roots):
    for root in roots:
        for obj in root.children_recursive:
            if obj.type != 'MESH' or not counts_as_cover(obj.data.materials[0].name):
                continue
            mesh = obj.data
            mesh.calc_loop_triangles()
            if not mesh.loop_triangles:
                continue
            matrix = np.array(obj.matrix_world, dtype=float)
            vertices = np.array([tuple(vertex.co) for vertex in mesh.vertices])
            triangles = np.array([tuple(tri.vertices) for tri in mesh.loop_triangles], dtype=np.int32)
            yield vertices @ matrix[:3, :3].T + matrix[:3, 3], triangles


def render_grid(materials, evidence):
    clear_objects()

    def place(name, x, y, turn):
        craft = model(name, materials)
        craft.root.location = (x, y, 0)
        craft.root.rotation_euler.z = turn * pi / 2
        return craft.root

    roots = []
    for row, cells in enumerate(GRID):
        for col, (name, turn) in enumerate(cells):
            x, y = 2 * col - 3, 3 - 2 * row
            page = "page_a" if (row + col) % 2 == 0 else "page_b"
            place(page, x, y, (row + col * 2) % 4)
            roots.append(place(name, x, y, turn))
            if (row, col) in DECORATIONS:
                roots.append(place("page_deco_" + DECORATIONS[row, col], x, y, (col + row) % 4))
    scene = bpy.context.scene
    set_stage(scene, materials, board=True)
    bpy.context.view_layer.update()
    covered, page = coverage(grid_geometry(roots))
    ratio = covered / page
    report = (f"Mixed-grid above-page coverage: {ratio:.2%} ({covered:,} of {page:,} page pixels)\n"
              "Opaque felt and cardstock, including the glitter river. Transparent fringe and shadows are excluded.\n"
              "1600 × 900, 45° down, 30° vertical FOV, game camera distance 14.\n")
    (evidence / "coverage.txt").write_text(report)
    print(report, end="", flush=True)
    if ratio < .60:
        raise RuntimeError(f"Mixed-grid coverage {ratio:.2%} is below 60%")
    render(scene, evidence / "mixed-grid.png", GRID_TARGET)


def contact_sheet(evidence, names, mixed):
    columns, thumb, spacing = 6, 240, 12
    width = columns * thumb + (columns + 1) * spacing
    views = [evidence / f"{name}-upright.png" for name in names]
    views.extend(evidence / f"{name}-flat.png" for name in names if name in FLAT_VIEWS)
    rows = (len(views) + columns - 1) // columns
    top_width = (width - spacing * 3) // 2
    top_height = round(top_width * 9 / 16) if mixed else 0
    height = spacing + rows * (thumb + spacing) + (top_height + spacing if mixed else 0)
    sheet = np.broadcast_to(np.array([.16, .13, .128], dtype=np.float32), (height, width, 3)).copy()

    def paste(path, x, y, w, h):
        image = bpy.data.images.load(str(path), check_existing=False)
        image.scale(w, h)
        pixels = np.empty(h * w * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        sheet[y:y + h, x:x + w] = pixels.reshape(h, w, 4)[:, :, :3]
        bpy.data.images.remove(image)

    if mixed:
        paste(evidence / "mixed-grid.png", spacing, height - spacing - top_height, top_width, top_height)
        paste(ROOT / "reference/concept-claude/concept-claude-01-establishing.png",
              top_width + 2 * spacing, height - spacing - top_height, top_width, top_height)
    for i, path in enumerate(views):
        row, col = divmod(i, columns)
        y = (rows - row - 1) * (thumb + spacing) + spacing
        paste(path, col * (thumb + spacing) + spacing, y, thumb, thumb)
    image_from_pixels(evidence, "contact-sheet", sheet)


def publish(stage, output, source_evidence, evidence):
    output.mkdir(parents=True, exist_ok=True)
    (output / "textures").mkdir(exist_ok=True)
    for texture in (stage / "textures").iterdir():
        texture.replace(output / "textures" / texture.name)
    for glb in stage.glob("*.glb"):
        glb.replace(output / glb.name)
    evidence.mkdir(parents=True, exist_ok=True)
    for artifact in source_evidence.iterdir():
        artifact.replace(evidence / artifact.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "public/models/tiles")
    parser.add_argument("--evidence", type=Path, default=ROOT / ".handoff/evidence/T4/fix2")
    parser.add_argument("--only", nargs="+", choices=TILES, default=list(TILES))
    parser.add_argument("--skip-render", action="store_true",
                        help="export and inspect only (fast loop while editing geometry)")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    names = list(dict.fromkeys(args.only))
    full = set(names) == set(TILES)
    expected = [] if args.skip_render else [f"{name}-upright.png" for name in names]
    if not args.skip_render:
        expected.extend(f"{name}-flat.png" for name in names if name in FLAT_VIEWS)
        expected.append("contact-sheet.png")
    if full:
        expected.extend(("inspect.txt",) if args.skip_render else ("mixed-grid.png", "coverage.txt", "inspect.txt"))
    for path in (args.evidence / name for name in expected):
        if path.exists():
            raise FileExistsError(path)

    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    start = monotonic()
    print(f"Blender {bpy.app.version_string}: {len(names)} tiles", flush=True)
    with TemporaryDirectory(prefix="atlas-tiles-", dir=args.evidence.parent) as temporary:
        scratch = Path(temporary)
        stage, evidence = scratch / "tiles", scratch / "renders"
        sources = scratch / "source-textures"
        for directory in (stage, evidence, sources):
            directory.mkdir()
        materials = Materials(ROOT / "public/textures", sources)
        textures = {}
        for name in names:
            clear_objects()
            craft = model(name, materials)
            export(craft, scratch, stage / f"{name}.glb", textures)
            if not args.skip_render:
                render_tile(craft, materials, name, evidence)
            print(f"Finished {name} at {monotonic() - start:.1f}s", flush=True)
        if full and not args.skip_render:
            render_grid(materials, evidence)
            print(f"Finished 4x4 spread at {monotonic() - start:.1f}s", flush=True)
        if not args.skip_render:
            contact_sheet(evidence, names, full)
        if full:
            inspection = subprocess.run(
                ["node", str(ROOT / "scripts/inspect-glb.mjs"), str(stage)],
                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            print(inspection.stdout, end="", flush=True)
            inspection.check_returncode()
            heading = f"Inspecting {stage}"
            relative = args.output.resolve().relative_to(ROOT) if args.output.resolve().is_relative_to(ROOT) else args.output
            (evidence / "inspect.txt").write_text(
                inspection.stdout.replace(heading, f"Inspecting {relative}", 1))
        publish(stage, args.output, evidence, args.evidence)


if __name__ == "__main__":
    main()
