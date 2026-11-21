import { Vector3 } from 'three'

export function parseFocusPoint(value) {
  const parts = value?.split(',')
  if (parts?.length !== 2 || parts.some((part) => !part.trim())) return null
  const [x, z] = parts.map(Number)
  return Number.isFinite(x) && Number.isFinite(z) ? new Vector3(x, 0, z) : null
}
