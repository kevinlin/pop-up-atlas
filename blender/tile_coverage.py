"""Measure page pixels occupied by positive-height cut-outs from the game camera."""
from math import radians, sqrt, tan

import numpy as np


CAMERA_DISTANCE = 14
CAMERA_FOV = 30
GRID_TARGET = (0, -.42, .40)
GRID_RESOLUTION = (1600, 900)
INCLUDED = ("felt_", "card_")
EXCLUDED = ("felt_fringe_", "card_page", "card_washi_")


def counts_as_cover(material):
    return material == "glitter_river" or (
        material.startswith(INCLUDED) and not material.startswith(EXCLUDED))


def project(vertices):
    width, height = GRID_RESOLUTION
    x, y, z = (vertices - GRID_TARGET).T
    focal = height / (2 * tan(radians(CAMERA_FOV) / 2))
    depth = CAMERA_DISTANCE + (y - z) / sqrt(2)
    return np.stack((width / 2 + focal * x / depth,
                     height / 2 + focal * (y + z) / (sqrt(2) * depth)), axis=1)


def rasterize(mask, triangles):
    height, width = mask.shape
    for tri in triangles:
        (x0, y0), (x1, y1), (x2, y2) = tri
        area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
        if abs(area) < .0001:
            continue
        left = max(0, int(np.ceil(min(x0, x1, x2) - .5)))
        right = min(width, int(np.floor(max(x0, x1, x2) - .5)) + 1)
        bottom = max(0, int(np.ceil(min(y0, y1, y2) - .5)))
        top = min(height, int(np.floor(max(y0, y1, y2) - .5)) + 1)
        if left >= right or bottom >= top:
            continue
        region = mask[bottom:top, left:right]
        if region.all():
            continue

        x = np.arange(left, right)[None, :] + .5
        y = np.arange(bottom, top)[:, None] + .5
        sign = 1 if area > 0 else -1
        ab = sign * ((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0))
        bc = sign * ((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1))
        ca = sign * ((x0 - x2) * (y - y2) - (y0 - y2) * (x - x2))
        region |= (ab >= -1e-8) & (bc >= -1e-8) & (ca >= -1e-8)


def coverage(geometry):
    width, height = GRID_RESOLUTION
    page = np.zeros((height, width), dtype=bool)
    cutouts = np.zeros_like(page)
    corners = project(np.array([(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)]))
    if (corners < 0).any() or (corners > (width, height)).any():
        raise ValueError("The mixed-grid camera clips the page")
    rasterize(page, corners[[[0, 1, 2], [0, 2, 3]]])
    for vertices, triangles in geometry:
        # A triangle touching the page is omitted to keep the estimate conservative.
        triangles = triangles[(vertices[triangles, 2] > .0001).all(axis=1)]
        if triangles.size:
            rasterize(cutouts, project(vertices)[triangles])
    return int((page & cutouts).sum()), int(page.sum())
