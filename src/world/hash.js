export function hash(seed, x, z, salt = 0) {
  let value = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d)
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return (value ^ (value >>> 16)) >>> 0
}
