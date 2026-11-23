/** photon 的 wasm 绑定没有类型声明，这里只声明仓库用到的部分。 */
export interface PhotonImage {
  get_width(): number
  get_height(): number
  get_bytes(): Uint8Array
  get_bytes_jpeg(quality: number): Uint8Array
  get_raw_pixels(): Uint8Array
  free(): void
}

export interface PhotonModule {
  PhotonImage: { new_from_byteslice(bytes: Uint8Array): PhotonImage }
  resize(image: PhotonImage, width: number, height: number, filter: number): PhotonImage
  SamplingFilter: { Nearest: number; Lanczos3: number }
}

let cachedPhoton: PhotonModule | null | undefined = undefined

export function loadPhoton(): PhotonModule | null {
  if (cachedPhoton !== undefined) return cachedPhoton
  try {
    // wasm 绑定没有类型声明，函数边界按 PhotonModule 收窄。
    cachedPhoton = require('@cf-wasm/photon/node') as PhotonModule
  } catch {
    cachedPhoton = null
  }
  return cachedPhoton
}
