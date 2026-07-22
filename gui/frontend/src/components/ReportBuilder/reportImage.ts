export const REPORT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const MAX_REPORT_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_REPORT_IMAGE_PIXELS = 40_000_000

export interface ImportedReportImage {
  dataUrl: string
  mimeType: 'image/png' | 'image/jpeg'
  fileName: string
  width: number
  height: number
  sha256: string
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The image file could not be read.'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The selected file is not a readable image.'))
    image.src = dataUrl
  })
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function detectedMimeType(data: ArrayBuffer): string | null {
  const bytes = new Uint8Array(data)
  if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

/** Read a bounded local image and normalize WebP for reliable PDF export. */
export async function importReportImage(file: File): Promise<ImportedReportImage> {
  if (!REPORT_IMAGE_TYPES.includes(file.type as typeof REPORT_IMAGE_TYPES[number])) {
    throw new Error('Choose a PNG, JPEG, or WebP image.')
  }
  if (file.size <= 0 || file.size > MAX_REPORT_IMAGE_BYTES) {
    throw new Error('Report images must be no larger than 10 MiB.')
  }
  const bytes = await file.arrayBuffer()
  if (detectedMimeType(bytes) !== file.type) {
    throw new Error('The image contents do not match the declared PNG, JPEG, or WebP format.')
  }
  const originalDataUrl = await fileDataUrl(file)
  const image = await loadImage(originalDataUrl)
  if (!image.naturalWidth || !image.naturalHeight
      || image.naturalWidth * image.naturalHeight > MAX_REPORT_IMAGE_PIXELS) {
    throw new Error('Report images are limited to 40 megapixels.')
  }

  let dataUrl = originalDataUrl
  let mimeType: ImportedReportImage['mimeType'] = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  if (file.type === 'image/webp') {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser could not convert this WebP image.')
    context.drawImage(image, 0, 0)
    dataUrl = canvas.toDataURL('image/png')
    mimeType = 'image/png'
  }

  return {
    dataUrl,
    mimeType,
    fileName: file.name.slice(0, 300),
    width: image.naturalWidth,
    height: image.naturalHeight,
    sha256: await sha256(bytes),
  }
}

export function isSafeReportImageDataUrl(value: string, mimeType?: string): boolean {
  const expected = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return value.startsWith(`data:${expected};base64,`)
}
