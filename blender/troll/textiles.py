"""Bake repeatable wool, yarn and knit swatches into embedded PBR images."""
import bpy
import numpy as np


def srgb(rgb):
    rgb = np.asarray(rgb)
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def rgb(hex_color):
    return np.array([int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def image(name, pixels, data=False):
    height, width, _ = pixels.shape
    img = bpy.data.images.new(name, width, height, alpha=pixels.shape[2] == 4)
    if data:
        img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :pixels.shape[2]] = pixels
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    img.pack()
    return img


def cloth_fields(size, seed, kind):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size] / size
    height = np.zeros_like(x)
    for count, amount in ((8, .14), (24, .21), (64, .19), (113, .13)):
        lattice = rng.uniform(-1, 1, (count, count))
        xx, yy = x * count, y * count
        ix, iy = xx.astype(int), yy.astype(int)
        fx, fy = xx % 1, yy % 1
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        height += amount * (
            (1 - fx) * ((1 - fy) * lattice[iy, ix] + fy * lattice[(iy + 1) % count, ix])
            + fx * ((1 - fy) * lattice[iy, (ix + 1) % count]
                    + fy * lattice[(iy + 1) % count, (ix + 1) % count])
        )
    fibres = rng.normal(0, .035, height.shape)
    for _ in range(size * 9):
        start = rng.uniform(0, size, 2)
        length = rng.uniform(3, 23)
        angle = rng.uniform(-np.pi, np.pi) if kind != 'yarn' else rng.normal(np.pi / 2, .18)
        t = np.linspace(0, 1, int(length * 1.4))
        offsets = length * t
        bow = length * rng.uniform(-.32, .32) * t * (1 - t)
        sx = (start[0] + offsets * np.cos(angle) + bow * np.sin(angle)).astype(int) % size
        sy = (start[1] + offsets * np.sin(angle) - bow * np.cos(angle)).astype(int) % size
        np.add.at(fibres, (sy, sx), rng.uniform(-.34, .43) * np.sin(np.pi * t))
    fibres = .5 * fibres + .125 * sum(np.roll(fibres, sign, axis)
                                     for axis in (0, 1) for sign in (-1, 1))
    if kind == 'knit':
        # Two plaited rows with each pair of wool strands alternating over and under.
        column = x * 2
        turns = y * 16 + .25 * np.floor(column)
        cross = column % 1 - .5
        angle = 2 * np.pi * turns
        weave = .208 * np.sin(angle)
        lift = .16 * np.cos(angle)
        a = np.exp(-((cross - weave) / .139)**2) * (.86 + lift)
        b = np.exp(-((cross + weave) / .139)**2) * (.86 - lift)
        braid = np.maximum(a, b)
        grain = .96 + .04 * np.cos(2 * np.pi * (turns * 8 + cross * 2))
        relief = 1.18 * braid * grain + .13 * height + .24 * fibres
        tone = np.clip(.07 + .93 * braid + .18 * height + .19 * fibres, 0, 1)
    elif kind == 'yarn':
        strand = .13 * np.cos(2 * np.pi * (x * 9 + y * 6 + .3 * height))
        relief = .32 * height + .55 * fibres + strand
        tone = .96 + .34 * height + .25 * fibres + .26 * strand
    else:
        relief = .38 * height + 1.39 * fibres
        tone = .97 + .16 * height + .34 * fibres
    dy = np.roll(relief, -1, 0) - np.roll(relief, 1, 0)
    dx = np.roll(relief, -1, 1) - np.roll(relief, 1, 1)
    normal = np.stack((-2.5 * dx, -2.5 * dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return tone, normal * .5 + .5


def paint(name, color, roughness=.91, sheen=.26, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*srgb(rgb(color)), 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Specular IOR Level'].default_value = .38 if name.startswith('button_') else 0
    shader.inputs['Sheen Weight'].default_value = sheen
    shader.inputs['Sheen Roughness'].default_value = .74
    shader.inputs['Sheen Tint'].default_value = (*srgb(rgb(color)), 1)
    mat.diffuse_color = (*srgb(rgb(color)), 1)
    return mat


def textured(mat, color_map, normal_map=None, normal_strength=1):
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    color = nodes.new('ShaderNodeTexImage')
    color.image = color_map
    links.new(color.outputs['Color'], shader.inputs['Base Color'])
    if normal_map is None:
        cutoff = nodes.new('ShaderNodeMath')
        cutoff.operation = 'GREATER_THAN'
        cutoff.inputs[1].default_value = .31
        links.new(color.outputs['Alpha'], cutoff.inputs[0])
        links.new(cutoff.outputs[0], shader.inputs['Alpha'])
        return
    normal_tex = nodes.new('ShaderNodeTexImage')
    normal_tex.image = normal_map
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = normal_strength
    links.new(normal_tex.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])


def sunset(height):
    # Orange roots run well up the plume before the hot pink and violet tips.
    stops = (0, .30, .46, .68, .86, 1)
    colors = np.array([rgb(c) for c in
                       ('FF8C1A', 'F7922E', 'E8478F', 'E8478F', '7A52C7', '7A52C7')])
    return np.stack([np.interp(height, stops, channel) for channel in colors.T], axis=-1)


def scarf_pixels():
    tone, normal = cloth_fields(512, 41, 'knit')
    mustard, gold = rgb('E3B23C'), rgb('F7DC6F')
    return mustard + tone[:, :, None] * (gold - mustard), normal


def yarn_pixels():
    tone, normal = cloth_fields(512, 73, 'yarn')
    t = np.linspace(0, 1, len(tone))
    ramp = sunset(t)
    root_blend = np.clip((.34 - t) / .13, 0, 1)[:, None]
    tone = tone * (1 - .55 * root_blend) + .58 * root_blend
    return np.clip(tone[:, :, None] * ramp[:, None, :], 0, 1), normal


def ply_pixels(size=256):
    # Two twisted plies: bright crests and dark grooves spiral around each tube.
    y, x = np.mgrid[0:size, 0:size] / size
    rng = np.random.default_rng(57)
    noise = rng.normal(0, .04, (size, size))
    noise = .5 * noise + .125 * sum(np.roll(noise, s, a) for a in (0, 1) for s in (-1, 1))
    ply = np.abs(np.sin(np.pi * (2 * x + 6 * y))) ** .55
    fuzz = .5 + .5 * np.sin(2 * np.pi * (24 * x - 9 * y) + 6 * noise)
    relief = .9 * ply + .10 * fuzz + noise
    dy = np.roll(relief, -1, 0) - np.roll(relief, 1, 0)
    dx = np.roll(relief, -1, 1) - np.roll(relief, 1, 1)
    normal = np.stack((-1.6 * dx, -1.6 * dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return np.clip(.74 + .30 * ply + .06 * fuzz + noise, 0, 1.08), normal * .5 + .5


def flyaway_swatch(rng, t, x, phase):
    # A few backlit fibres of different lengths, each tapering and curling at its end.
    alpha = np.zeros((t.shape[0], x.shape[1]))
    relief = np.ones_like(alpha)
    for fibre in range(int(rng.integers(3, 6))):
        start, end = rng.uniform(-.05, .25), rng.uniform(.45, 1.02)
        active = np.clip((t - start) * 12, 0, 1) * np.clip((end - t) * 9, 0, 1)
        along = np.clip((t - start) / (end - start), 0, 1)
        base = rng.uniform(.25, .75)
        curl = rng.uniform(-.30, .30) * along**2
        drift = rng.uniform(.02, .07) * np.sin(along * rng.uniform(5, 14) + phase + fibre)
        w = rng.uniform(.045, .085) * (1 - .55 * along)
        stroke = np.exp(-((x - (base + curl + drift)) / w)**2) * active
        alpha = np.maximum(alpha, stroke * rng.uniform(.75, 1))
        relief += stroke * rng.uniform(.05, .22)
    return alpha, relief


def fibre_pixels():
    # Swatches 0-3 vary the curl and loose fibres along each lock; 4-7 are tip flyaways.
    rng = np.random.default_rng(806)
    rows, cols = 1024, 1024
    swatch_width = cols // 8
    t = np.linspace(0, 1, rows)[:, None]
    x = np.linspace(0, 1, swatch_width)[None, :]
    rgba = np.empty((rows, cols, 4))
    for index in range(4):
        section = slice(index * swatch_width, (index + 1) * swatch_width)
        phase = rng.uniform(0, 6.28)
        center = .5 + .066 * np.sin(13 * t + phase) + .026 * np.sin(35 * t + phase)
        half = (.225 + .077 * np.sin(np.pi * t)) * (1 - .80 * t**4)
        width = .015 + .014 * (1 - t)
        alpha = np.clip(1.1 - np.abs(x - center) / half, 0, 1)
        relief = rng.uniform(.93, 1.08, (rows, swatch_width))
        for fibre in range(48):
            strand = rng.uniform(-1, 1)
            start, end = rng.uniform(-.29, .31), rng.uniform(.67, 1.14)
            active = np.clip((t - start) * 9, 0, 1) * np.clip((end - t) * 13, 0, 1)
            drift = rng.uniform(.012, .09) * np.sin(t * rng.uniform(9, 31) + phase + fibre)
            curl = rng.uniform(-.24, .24) * np.maximum(t - .56, 0) * 2.5
            trace = center + strand * (half + .048) + drift + curl
            w = width * rng.uniform(.20, .55)
            stroke = np.exp(-((x - trace) / w)**2) * active
            alpha = np.maximum(alpha, stroke * rng.uniform(.44, 1))
            relief += stroke * rng.uniform(-.13, .15)
        alpha *= np.clip((1 - t) * 15, 0, 1) * np.clip((.48 - np.abs(x - .5)) * 40, 0, 1)
        tint = sunset(t[:, 0])[:, None, :]
        rgba[:, section, :3] = np.clip(tint * relief[:, :, None], 0, 1)
        rgba[:, section, 3] = alpha
    for index in range(4, 8):
        section = slice(index * swatch_width, (index + 1) * swatch_width)
        alpha, relief = flyaway_swatch(rng, t, x, rng.uniform(0, 6.28))
        alpha *= np.clip((.49 - np.abs(x - .5)) * 40, 0, 1)
        tint = sunset(t[:, 0])[:, None, :]
        rgba[:, section, :3] = np.clip(tint * relief[:, :, None] * 1.06, 0, 1)
        rgba[:, section, 3] = alpha
    return rgba


def materials():
    mats = {}
    tone, normal = cloth_fields(512, 19, 'felt')
    wool_normal = image('needlework-normal', normal, data=True)
    for name, tint in {
        'felt_mint': '9EDDB4', 'felt_peach': 'F6AE8B', 'felt_tomato': 'D9453B',
        'felt_flap': 'EA5547', 'felt_strap': 'BD3734',
    }.items():
        mats[name] = paint(name, tint)
        field = np.clip(tone[:, :, None] * rgb(tint), 0, 1)
        textured(mats[name], image(name + '-baked', srgb(field)), wool_normal, .78)
    knit, normal = scarf_pixels()
    mats['yarn_mustard'] = paint('yarn_mustard', 'E3B23C')
    textured(mats['yarn_mustard'], image('mustard-knit-baked', srgb(knit)),
             image('mustard-knit-normal', normal, data=True), 1.15)

    yarn, normal = yarn_pixels()
    # A lighter sheen keeps the orange roots from washing pink under the rim light.
    mats['yarn_sunset'] = paint('yarn_sunset', 'E8478F', sheen=.26)
    textured(mats['yarn_sunset'], image('sunset-yarn-baked', srgb(yarn)),
             image('sunset-yarn-normal', normal, data=True), .7)
    fibres = fibre_pixels()
    fibres[:, :, :3] = srgb(fibres[:, :, :3])
    mats['yarn_sunset_fibres'] = paint('yarn_sunset_fibres', 'E8478F', sheen=.20)
    textured(mats['yarn_sunset_fibres'], image('sunset-fibre-cutouts', fibres))

    for name, tint in {
        'felt_fibre_mint': 'A4D9B5', 'felt_fibre_green': '75B491',
        'felt_fibre_light': 'BCE7CA', 'felt_fibre_peach': 'F8BF9F',
        'felt_fibre_red': 'D95849',
        'yarn_gold': 'F7DC6F', 'yarn_floss': 'F9B479',
        'yarn_button_thread': '554351',
    }.items():
        mats[name] = paint(name, tint)
    # Plied mustard yarn for the knitted loops and the thick fringe ends.
    ply, ply_normal = ply_pixels()
    ply_map = image('yarn-ply-normal', ply_normal, data=True)
    for name, tint, sheen in (('yarn_fringe', 'E9BB47', .34), ('yarn_loops', 'EDBE45', .34)):
        mats[name] = paint(name, tint, sheen=sheen)
        field = np.clip(ply[:, :, None] * rgb(tint), 0, 1)
        textured(mats[name], image(name + '-ply-baked', srgb(field)), ply_map, 1.0)
    mats['felt_eye_socket'] = paint('felt_eye_socket', '739B82', sheen=.08)
    mats['button_charcoal'] = paint('button_charcoal', '201924', .30, 0)
    mats['button_ochre'] = paint('button_ochre', 'E7A546', .42, 0)
    return mats
