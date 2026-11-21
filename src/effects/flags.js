// Pass ?effects=5,7,9,10,11,13 with any number omitted to isolate a layer.
export function stageFlags(search = '') {
  const selected = new URLSearchParams(search).get('effects')?.split(',')
  const on = (item) => !selected || selected.includes(item)
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
