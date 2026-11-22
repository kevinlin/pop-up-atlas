// On-screen controls guide. Collapses to a small "H" button after the first input; H or the button toggles it.
const rows = [
  ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows', 'walk'],
  ['click / tap the page', 'walk there'],
  ['<kbd>Space</kbd> / click the friend', 'swap the lead'],
  ['stand still', 'they dance'],
  ['<kbd>H</kbd>', 'hide / show this'],
]

export function createGuide(canvas) {
  // Browser scripts (capture, sbs, look-stats) screenshot the page; keep the guide out of their frames.
  if (navigator.webdriver) return

  const guide = document.createElement('aside')
  guide.className = 'guide'
  guide.setAttribute('aria-label', 'Controls')
  guide.innerHTML = `<dl>${rows.map(([keys, what]) => `<dt>${keys}</dt><dd>${what}</dd>`).join('')}</dl>
    <button type="button" aria-label="Show controls">H · controls</button>`
  document.body.append(guide)

  const setOpen = (open) => guide.classList.toggle('collapsed', !open)
  guide.querySelector('button').addEventListener('click', () => setOpen(true))
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyH' && !event.repeat) setOpen(guide.classList.contains('collapsed'))
  })
  const collapseOnce = () => setOpen(false)
  window.addEventListener('keydown', (event) => { if (event.code !== 'KeyH') collapseOnce() }, { once: true })
  canvas.addEventListener('pointerdown', collapseOnce, { once: true })
}
