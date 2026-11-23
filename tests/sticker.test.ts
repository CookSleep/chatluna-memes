import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadPhoton } from '../src/photon'
import { stickerImage } from '../src/sticker'

const large = fs.readFileSync(new URL('./fixtures/sticker-400x200.png', import.meta.url))
const small = fs.readFileSync(new URL('./fixtures/sticker-100x50.png', import.meta.url))

function sizeOf(buffer: Buffer) {
  const photon = loadPhoton()
  const image = photon.PhotonImage.new_from_byteslice(new Uint8Array(buffer))
  try {
    return [image.get_width(), image.get_height()]
  } finally {
    image.free?.()
  }
}

describe('stickerImage', () => {
  it('长边缩到 160px 并保持比例', () => {
    const out = stickerImage({ buffer: large, mime: 'image/png' }, 'test/large.png')
    expect(out.mime).toBe('image/png')
    expect(sizeOf(out.buffer)).toEqual([160, 80])
  })

  it('同一张图复用缓存的缩略图', () => {
    const first = stickerImage({ buffer: large, mime: 'image/png' }, 'test/cache.png')
    const second = stickerImage({ buffer: large, mime: 'image/png' }, 'test/cache.png')
    expect(second).toBe(first)
  })

  it('不超过上限时原样返回', () => {
    const image = { buffer: small, mime: 'image/png' }
    expect(stickerImage(image, 'test/small.png')).toBe(image)
  })

  it('GIF 不缩放以保留动效', () => {
    const image = { buffer: large, mime: 'image/gif' }
    expect(stickerImage(image, 'test/anim.gif')).toBe(image)
  })

  it('解码失败时退回原图', () => {
    const image = { buffer: Buffer.from('not an image'), mime: 'image/png' }
    expect(stickerImage(image, 'test/broken.png')).toBe(image)
  })
})
