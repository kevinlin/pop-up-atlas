import { expect, it } from 'vitest'
import { encodeWav } from '../src/audio/index.js'

it('encodes a little-endian stereo PCM WAV with interleaved, clamped 16-bit samples', () => {
  const channels = [new Float32Array([-2, -0.5, 0.25]), new Float32Array([2, 0, 0.5])]
  const wav = encodeWav({
    numberOfChannels: 2,
    length: 3,
    sampleRate: 48_000,
    getChannelData: (channel) => channels[channel],
  })
  const view = new DataView(wav)
  const fourCC = (offset) => new TextDecoder().decode(new Uint8Array(wav, offset, 4))

  expect(wav.byteLength).toBe(56)
  expect([fourCC(0), fourCC(8), fourCC(12), fourCC(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
  expect([4, 16, 24, 28, 40].map((offset) => view.getUint32(offset, true)))
    .toEqual([48, 16, 48_000, 192_000, 12])
  expect([20, 22, 32, 34].map((offset) => view.getUint16(offset, true))).toEqual([1, 2, 4, 16])
  expect(Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true)))
    .toEqual([-32768, 32767, -16384, 0, 8192, 16384])
})
