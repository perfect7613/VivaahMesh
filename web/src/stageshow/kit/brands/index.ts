/**
 * VivaahMesh: the upstream kit ships product SVGs loaded via `new URL(..., import.meta.url)`.
 * We don't use BrandMark (we draw Telegram/WhatsApp marks from Simple Icons), so the map is empty.
 */
export type BrandAsset = {
  name: string
  category: 'Payments' | 'Banks' | 'Apps' | 'Crypto'
  light: string
  dark: string
  tileArtwork?: string
  tileBackground?: string
  proportion: number
  scale: number
}
export const brandMarks: Record<string, BrandAsset> = {}
export type BrandName = string
