// Shipped accents (owner decision 2026-11-22): bokeh, motes, lanterns, fold-up response. Moss and fronds lost the
// scrapbook feel, so they are off unless asked for, e.g. ?effects=5,7,9,10,11,13 for the full round-4 stage.
export const DEFAULT_EFFECTS = '9,10,11,13'

export function stageFlags(search = '') {
  const selected = (new URLSearchParams(search).get('effects') ?? DEFAULT_EFFECTS).split(',')
  const on = (item) => selected.includes(item)
  return Object.freeze({
    moss: on('5'),
    fronds: on('7'),
    bokeh: on('9'),
    motes: on('10'),
    lanterns: on('11'),
    response: on('13'),
  })
}

export const stage = stageFlags(typeof window === 'undefined' ? '' : window.location.search)
