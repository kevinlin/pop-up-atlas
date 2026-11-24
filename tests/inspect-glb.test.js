import { Document } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import {
  AREA_RATIO, BASELINE, domeCards, domeProblems, layerCoverage, motifProblems, motifShares, namingProblems,
  pieceStats, secProblems, tileMotifs,
} from '../scripts/inspect-glb.mjs'

// Synthetic tiles for the round-6 inspector checks (TIL6): the real GLBs are built by Blender on the host.
function scene() {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const materials = new Map()
  const material = (name) => {
    if (!materials.has(name)) materials.set(name, doc.createMaterial(name))
    return materials.get(name)
  }
  const root = doc.createNode('tile')
  const base = doc.createNode('base')
  root.addChild(base)
  const mesh = (node, name, triangles) => {
    const positions = []
    const indices = []
    for (const triangle of triangles) {
      indices.push(...triangle.map((_, i) => positions.length / 3 + i))
      for (const point of triangle) positions.push(...point)
    }
    const primitive = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
      .setMaterial(material(name))
    node.setMesh(doc.createMesh().addPrimitive(primitive))
    return node
  }
  // A flat, up-facing rectangle on the page (x0, z0)-(x1, z1) at height y.
  const quad = (x0, z0, x1, z1, y = 0.002) => [
    [[x0, y, z0], [x1, y, z1], [x1, y, z0]],
    [[x0, y, z0], [x0, y, z1], [x1, y, z1]],
  ]
  // A vertical card of width w and height h whose front normal points at `degrees` around the vertical.
  const card = (degrees, w = 0.4, h = 0.5) => {
    const a = degrees * Math.PI / 180
    const u = [Math.cos(a), 0, -Math.sin(a)]
    const p = (s, t) => [u[0] * s, t, u[2] * s]
    return [[p(0, 0), p(w, 0), p(w, h)], [p(0, 0), p(w, h), p(0, h)]]
  }
  const named = (name, parent = base, extras) => {
    const node = doc.createNode(name)
    if (extras) node.setExtras(extras)
    parent.addChild(node)
    return node
  }
  return { doc, root, base, mesh, quad, card, named, material }
}

describe('pieceStats', () => {
  it('measures welded islands of felt and card under base and leaves out tabs, fringe and yarn', () => {
    const s = scene()
    s.mesh(s.named('a'), 'felt_sage', s.quad(-0.9, -0.9, -0.1, -0.1))
    s.mesh(s.named('b'), 'card_cream', s.quad(0.1, 0.1, 0.5, 0.9))
    s.mesh(s.named('fringe'), 'felt_fringe_sage', s.quad(-1, 0.2, 1, 0.9))
    s.mesh(s.named('yarn'), 'yarn_cream', s.quad(-1, 0.2, 1, 0.9))
    s.mesh(s.named('tab'), 'card_cream', s.quad(0.6, -0.9, 0.7, -0.8))
    const stats = pieceStats(s.root)
    expect(stats.count).toBe(2)
    expect(stats.areas[0]).toBeCloseTo(0.64, 5)
    expect(stats.areas[1]).toBeCloseTo(0.32, 5)
    expect(stats.mean).toBeCloseTo(0.48, 5)
  })

  it('ignores geometry outside base', () => {
    const s = scene()
    s.mesh(s.named('sprig', s.root), 'felt_mint', s.quad(0, 0, 0.9, 0.9))
    expect(pieceStats(s.root)).toMatchObject({ count: 0, mean: 0 })
  })

  it('welds split vertices into one island and counts only up-facing faces', () => {
    const s = scene()
    const top = s.quad(0, 0, 1, 1, 0.003)
    const underside = top.map(([a, b, c]) => [a, c, b])
    s.mesh(s.named('slab'), 'felt_sage', [...top, ...underside])
    const stats = pieceStats(s.root)
    expect(stats.count).toBe(1)
    expect(stats.areas[0]).toBeCloseTo(1, 5)
  })

  it('keeps the fa6d96b baseline means and a 1.5x ratio', () => {
    expect(AREA_RATIO).toBe(1.5)
    expect(BASELINE.commit).toBe('fa6d96b')
    expect(BASELINE.meadow).toBeGreaterThan(0.7)
    expect(BASELINE.meadow).toBeLessThan(0.9)
    expect(BASELINE.pageDeco).toBeGreaterThan(0.05)
    expect(BASELINE.pageDeco).toBeLessThan(0.12)
  })
})

describe('layerCoverage', () => {
  const stack = (innerSize) => {
    const s = scene()
    s.mesh(s.named('appl_0', s.base, { layer: 1 }), 'felt_sage', s.quad(-0.8, -0.8, 0.8, 0.8))
    s.mesh(s.named('appl_1', s.base, { layer: 2 }), 'felt_fern', s.quad(-innerSize, -innerSize, innerSize, innerSize, 0.003))
    return s
  }

  it('counts distinct layers per sample point, for each footprint', () => {
    const { pieces, layers } = layerCoverage(stack(0.4).root)
    const [bottom, top] = pieces
    expect([...layers].sort()).toEqual([1, 2])
    expect(bottom.footprint).toBeGreaterThan(0)
    expect(top.share).toBeCloseTo(1, 5)
    // The 0.8 x 0.8 inner square covers a quarter of the 1.6 x 1.6 piece below it.
    expect(bottom.share).toBeCloseTo(0.25, 1)
  })

  it('reaches 40 % once the upper piece covers 40 % or more', () => {
    const { pieces } = layerCoverage(stack(0.52).root)
    expect(pieces[0].share).toBeGreaterThan(0.4)
  })

  it('counts layers, never faces: two pieces on the same layer are one layer', () => {
    const s = scene()
    s.mesh(s.named('appl_0', s.base, { layer: 2 }), 'felt_sage', s.quad(-0.8, -0.8, 0.8, 0.8))
    s.mesh(s.named('appl_1', s.base, { layer: 2 }), 'felt_fern', s.quad(-0.5, -0.5, 0.5, 0.5, 0.003))
    const { pieces, layers } = layerCoverage(s.root)
    expect(layers.size).toBe(1)
    expect(pieces.every((piece) => piece.share === 0)).toBe(true)
  })

  it('ignores fringe faces and down-facing faces', () => {
    const s = scene()
    s.mesh(s.named('appl_0', s.base, { layer: 1 }), 'felt_fringe_sage', s.quad(-0.8, -0.8, 0.8, 0.8))
    expect(layerCoverage(s.root).pieces[0].footprint).toBe(0)
  })
})

describe('domeProblems', () => {
  const fan = (degrees, top = 0.5) => {
    const s = scene()
    const hinge = s.named('hinge_0', s.root)
    degrees.forEach((angle, k) => {
      const dome = s.named(`dome_${k}`, hinge)
      s.mesh(s.named('felt', dome), 'felt_tomato', s.card(angle, 0.4, top))
    })
    return s
  }

  it('accepts three cards whose normals span at least 60° around the vertical', () => {
    expect(domeProblems(fan([-36, 0, 36]).root, 0.5)).toEqual([])
  })

  it('reads the outward azimuth from the felt faces, flipped to the front half', () => {
    const azimuths = domeCards(fan([-36, 0, 190]).root).map((card) => Math.round(card.azimuth))
    expect(azimuths).toEqual([-36, 0, 10])
  })

  it('rejects a flat card, two cards, and a fan under 60°', () => {
    expect(domeProblems(fan([0]).root, 0.5)[0]).toMatch(/needs >= 3 cards/)
    expect(domeProblems(fan([-36, 36]).root, 0.5)[0]).toMatch(/needs >= 3 cards/)
    expect(domeProblems(fan([-25, 0, 25]).root, 0.5)[0]).toMatch(/needs >= 3 cards/)
    expect(domeProblems(fan([-36, 0, 36]).root, 0.9).join()).toMatch(/tallest geometry/)
  })

  it('accepts one stuffed mesh deeper than 40 % of its width and rejects a shallow one', () => {
    const stuffed = (depth) => {
      const s = scene()
      const dome = s.named('dome_0', s.root)
      const w = 1
      s.mesh(s.named('felt', dome), 'felt_tomato', [
        [[0, 0, 0], [w, 0, 0], [w / 2, 0.5, depth]],
        [[0, 0, 0], [w / 2, 0.5, depth], [w / 2, 0, depth]],
      ])
      return s
    }
    expect(domeProblems(stuffed(0.5).root, 0.5)).toEqual([])
    expect(domeProblems(stuffed(0.2).root, 0.5).join()).toMatch(/needs >= 3 cards/)
  })

  it('fails when the cap has no dome cards at all', () => {
    expect(domeProblems(scene().root, 1)).toEqual(['upright cap/crown has no dome_<k> cards'])
  })
})

describe('secProblems and namingProblems', () => {
  const tile = (build) => {
    const s = scene()
    const hinge = s.named('hinge_0', s.root)
    build(s, hinge)
    return s
  }
  const pivot = (s, parent, name = 'sec_0') => {
    const sec = s.named(name, parent)
    s.mesh(s.named('felt_part', sec), 'felt_pink', s.card(0))
    return sec
  }

  it('accepts sec_<k> empties nested in a hinge, authored at rest', () => {
    const s = tile((x, hinge) => { pivot(x, hinge, 'sec_0'); pivot(x, hinge, 'sec_1'); pivot(x, hinge, 'sec_2') })
    expect(secProblems('flower', s.root)).toEqual({ secs: 3, problems: [] })
  })

  it('requires the mushroom door and three flower petals', () => {
    expect(secProblems('mushroom_house', scene().root).problems[0]).toMatch(/expected >= 1/)
    const s = tile((x, hinge) => { pivot(x, hinge, 'sec_0'); pivot(x, hinge, 'sec_1') })
    expect(secProblems('flower', s.root).problems[0]).toMatch(/expected >= 3/)
    expect(secProblems('meadow_a', scene().root).problems).toEqual([])
  })

  it('rejects a pivot outside a hinge, with a rotation, or without geometry', () => {
    const outside = scene()
    pivot(outside, outside.root)
    expect(secProblems('mushroom_house', outside.root).problems.join()).toMatch(/nested directly in a hinge/)

    const turned = tile((x, hinge) => { pivot(x, hinge).setRotation([0.2, 0, 0, Math.sqrt(1 - 0.04)]) })
    expect(secProblems('mushroom_house', turned.root).problems.join()).toMatch(/authored at rest/)

    const empty = tile((x, hinge) => { x.named('sec_0', hinge).addChild(x.doc.createNode('nothing')) })
    expect(secProblems('mushroom_house', empty.root).problems.join()).toMatch(/carries no geometry/)

    const nested = tile((x, hinge) => { const outer = pivot(x, hinge); outer.addChild(x.doc.createNode('sec_1')) })
    expect(secProblems('mushroom_house', nested.root).problems.join()).toMatch(/must not contain/)
  })

  it('checks appl_ layers, deco_ names and dome_ names', () => {
    const s = scene()
    s.mesh(s.named('appl_0', s.base, { layer: 3 }), 'felt_sage', s.quad(0, 0, 1, 1))
    s.mesh(s.named('deco_knot_1', s.base), 'yarn_pink', s.card(0))
    s.named('dome_0', s.root)
    expect(namingProblems(s.root)).toEqual([])

    const bad = scene()
    bad.mesh(bad.named('appl_0', bad.base, { layer: 4 }), 'felt_sage', bad.quad(0, 0, 1, 1))
    bad.mesh(bad.named('appl_x', bad.base, { layer: 1 }), 'felt_sage', bad.quad(0, 0, 1, 1))
    bad.named('appl_2', bad.base, { layer: 1 })
    bad.mesh(bad.named('deco_knot', bad.base), 'yarn_pink', bad.card(0))
    bad.named('dome_front', bad.root)
    const problems = namingProblems(bad.root).join('\n')
    expect(problems).toMatch(/appl_0 needs extras.layer 1-3/)
    expect(problems).toMatch(/"appl_x" must be appl_<k>/)
    expect(problems).toMatch(/appl_2 must be a mesh node/)
    expect(problems).toMatch(/"deco_knot" must be deco_<motif>_<k>/)
    expect(problems).toMatch(/"dome_front" must be dome_<k>/)
  })
})

describe('decoration motifs', () => {
  const sets = (entries) => new Map(Object.entries(entries).map(([id, motifs]) => [id, { base: new Set(motifs), hinge: new Set() }]))
  const small = { seeds: 3, side: 24 }

  it('reads the motif of every deco_<motif>_<k> node, split by base and hinge parts', () => {
    const s = scene()
    s.mesh(s.named('deco_knot_0', s.base), 'yarn_pink', s.card(0))
    const hinge = s.named('hinge_0', s.root)
    s.mesh(s.named('deco_button_1', hinge), 'felt_pink', s.card(0))
    const found = tileMotifs(s.root)
    expect([...found.base]).toEqual(['knot'])
    expect([...found.hinge]).toEqual(['button'])
  })

  it('needs at least four motifs', () => {
    const three = sets(Object.fromEntries(['flower', 'cupcake_tree', 'mushroom_house', 'meadow_a', 'meadow_b', 'meadow_c',
      'path_straight', 'path_corner', 'river_straight', 'river_corner', 'yarn_bridge', 'page_deco_a', 'page_deco_b', 'page_deco_c']
      .map((id, i) => [id, [['knot', 'button', 'sequin'][i % 3]]])))
    expect(motifProblems(three, small).problems.join()).toMatch(/only \d decoration motifs placed/)
  })

  it('rejects a motif on more than 40 % of decorated cells and accepts a balanced mix', () => {
    const ids = ['flower', 'cupcake_tree', 'mushroom_house', 'meadow_a', 'meadow_b', 'meadow_c', 'path_straight',
      'path_corner', 'river_straight', 'river_corner', 'yarn_bridge', 'page_deco_a', 'page_deco_b', 'page_deco_c']
    const everywhere = sets(Object.fromEntries(ids.map((id, i) => [id, i % 2 ? ['knot', 'pom'] : ['knot', 'button', 'sequin']])))
    expect(motifProblems(everywhere, small).problems.join()).toMatch(/motif "knot" is on 100\.0% of decorated cells/)

    const motifs = ['knot', 'sequin', 'button', 'stitch', 'pom', 'cross', 'bead']
    const balanced = sets(Object.fromEntries(ids.map((id, i) => [id, [motifs[i % motifs.length], motifs[(i + 3) % motifs.length]]])))
    const result = motifProblems(balanced, small)
    expect(result.motifs.length).toBeGreaterThanOrEqual(4)
    expect(result.worst).toBeGreaterThan(0)
  })

  it('replays the runtime placement: clearing meadows keep only a quarter of their base and no hinge parts', () => {
    const meadows = (part) => new Map(['meadow_a', 'meadow_b', 'meadow_c'].map((id) => [id,
      { base: new Set(part === 'base' ? ['knot'] : []), hinge: new Set(part === 'hinge' ? ['knot'] : []) }]))
    const decorated = (map) => motifShares(map, small).perSeed.reduce((sum, entry) => sum + entry.decorated, 0)
    expect(decorated(meadows('hinge'))).toBeGreaterThan(0)
    expect(decorated(meadows('hinge'))).toBeLessThanOrEqual(decorated(meadows('base')))
  })
})
