export function createCharacterState() {
  let idleTime = 0
  let state = 'idle'

  return (dt, moving, hasInput, danceFinished) => {
    if (moving || hasInput) {
      idleTime = 0
      state = moving ? 'walk' : 'idle'
    } else if (state === 'dance') {
      if (danceFinished) state = 'idle'
    } else {
      idleTime += dt
      state = idleTime >= 4 ? 'dance' : 'idle'
      if (state === 'dance') idleTime = 0
    }

    return state
  }
}
