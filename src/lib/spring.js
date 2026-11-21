// Analytic step for a constant target and underdamped or critically damped motion.
export function stepSpring(spring, target, dt, frequency, damping) {
  const offset = spring.value - target
  const decayRate = frequency * damping
  const decay = Math.exp(-decayRate * dt)
  const dampedFrequency = frequency * Math.sqrt(1 - damping * damping)
  const phase = dampedFrequency * dt
  const cosine = Math.cos(phase)
  const sineOverFrequency = dampedFrequency ? Math.sin(phase) / dampedFrequency : dt
  const velocity = spring.velocity

  spring.value = target + decay * (offset * cosine
    + (velocity + decayRate * offset) * sineOverFrequency)
  spring.velocity = decay * (velocity * cosine
    - (decayRate * velocity + frequency * frequency * offset) * sineOverFrequency)
}
