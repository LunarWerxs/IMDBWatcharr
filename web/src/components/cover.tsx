import { useState } from 'react'

// Behind every cover, and in place of one IMDb does not have: a dark duotone
// picked from the title's id, so the same title always gets the same one.
const DUOTONES = [
  ['rgba(245,158,11,0.45)', '#b45309', '#2a1205'],
  ['rgba(20,184,166,0.45)', '#0f766e', '#042f2e'],
  ['rgba(244,63,94,0.40)', '#be123c', '#4c0519'],
  ['rgba(234,179,8,0.40)', '#a16207', '#3f1508'],
  ['rgba(249,115,22,0.45)', '#c2410c', '#301006'],
  ['rgba(163,163,163,0.35)', '#525252', '#171717'],
  ['rgba(132,204,22,0.40)', '#4d7c0f', '#1a2e05'],
  ['rgba(217,70,239,0.35)', '#86198f', '#2e0633'],
] as const

function duotone(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const [glow, top, bottom] = DUOTONES[hash % DUOTONES.length]
  return `radial-gradient(circle at 65% 25%, ${glow}, transparent 60%), linear-gradient(160deg, ${top} 0%, ${bottom} 70%, #070707 100%)`
}

/**
 * A title's cover from IMDb's image host, sharpening in from a blur once it
 * has loaded, over its duotone so the space is never empty while it arrives
 * (or when IMDb has no cover for the title, or the image fails).
 */
export function Cover({
  seed,
  src,
  className = '',
  eager = false,
}: {
  seed: string
  src: string | null | undefined
  className?: string
  eager?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: duotone(seed) }}>
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // A cached image can finish before React attaches onLoad.
          ref={(image) => {
            if (image?.complete && image.naturalWidth > 0) setLoaded(true)
          }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-full object-cover transition-[opacity,filter,scale] duration-700 ease-out ${
            loaded ? 'blur-0 scale-100 opacity-100' : 'scale-110 opacity-0 blur-md'
          }`}
        />
      )}
    </div>
  )
}
