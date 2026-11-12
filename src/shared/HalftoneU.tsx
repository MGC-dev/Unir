import { useEffect, useRef } from 'react'

/** A field of dots that draws the UNIR "U" mark, breathing slowly. Still when the person prefers less motion. */
export function HalftoneU({ className, rgb = '15,35,71', alpha = [0.1, 0.42] }: { className?: string; rgb?: string; alpha?: [number, number] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0, w = 0, h = 0
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const size = () => { w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0) }
    // distance from a point to the U stroke (two uprights joined by a half circle), in units of the mark's height
    const uDist = (x: number, y: number) => {
      const r = 0.36, top = -0.5, joint = 0.14
      const dSide = (cx: number) => (y < joint ? Math.hypot(x - cx, Math.max(top - y, 0)) : Infinity)
      const dArc = y >= joint ? Math.abs(Math.hypot(x, y - joint) - r) : Infinity
      return Math.min(dSide(-r), dSide(r), dArc)
    }
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      const gap = w < 640 ? 8 : 10, mark = Math.min(h * 0.82, w * 0.62), cx = w / 2, cy = h * 0.53
      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          const ux = (x - cx) / mark, uy = (y - cy) / mark
          const d = uDist(ux, uy)
          const ring = Math.exp(-(d * d) / 0.0035)                     // the stroke itself
          const glow = Math.exp(-(d * d) / 0.06) * 0.3                 // soft falloff around it
          const wave = still ? 0 : Math.sin(ux * 6 + uy * 4 - t / 1100) * 0.18
          const v = Math.min(1, ring + glow + wave * (ring + glow))
          const rad = (gap / 2) * (0.18 + v * 0.62)
          ctx.fillStyle = `rgba(${rgb},${alpha[0] + v * alpha[1]})`
          ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
        }
      }
      if (!still) raf = requestAnimationFrame(draw)
    }
    size(); draw(0)
    const ro = new ResizeObserver(() => { size(); if (still) draw(0) }); ro.observe(cv)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [rgb, alpha[0], alpha[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className={className} aria-hidden="true" />
}

