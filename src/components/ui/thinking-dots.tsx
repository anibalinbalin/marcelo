"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

type Glyph = [number[], number[]]

const GLYPHS: Glyph[] = [
  [[1], [1]],
  [[1], [0]],
  [[0], [1]],
  [[1, 1], [1, 1]],
  [[1, 0], [0, 1]],
  [[0, 1], [1, 0]],
  [[1, 1], [1, 0]],
  [[1, 1], [0, 1]],
  [[1, 0], [1, 1]],
  [[0, 1], [1, 1]],
  [[1, 1, 1], [1, 1, 1]],
  [[1, 0, 1], [0, 1, 0]],
  [[1, 1, 0], [0, 1, 1]],
  [[1, 0, 1], [1, 0, 1]],
  [[1, 1, 1], [1, 0, 1]],
  [[1, 1, 1, 1], [1, 0, 1, 1]],
  [[1, 0, 1, 1], [1, 1, 0, 1]],
  [[1, 1, 1, 1, 1], [1, 0, 1, 0, 1]],
]

function pickGlyphs(count: number): { glyph: Glyph; opacities: number[] }[] {
  const result: { glyph: Glyph; opacities: number[] }[] = []
  for (let i = 0; i < count; i++) {
    const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
    const cols = glyph[0].length
    const opacities = Array.from({ length: cols * 2 }, () => 0.4 + Math.random() * 0.6)
    result.push({ glyph, opacities })
  }
  return result
}

function ThinkingDots({ className, count = 7 }: { className?: string; count?: number }) {
  const [items, setItems] = useState(() => pickGlyphs(count))
  const [visible, setVisible] = useState(true)

  const cycle = useCallback(() => {
    setVisible(false)
    setTimeout(() => {
      setItems(pickGlyphs(count))
      setVisible(true)
    }, 300)
  }, [count])

  useEffect(() => {
    const id = setInterval(cycle, 900)
    return () => clearInterval(id)
  }, [cycle])

  return (
    <div
      data-slot="thinking-dots"
      className={cn("inline-flex items-center gap-[10px]", className)}
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms ease-in-out",
      }}
    >
      {items.map((item, gi) => {
        const cols = item.glyph[0].length
        return (
          <div
            key={gi}
            className="inline-grid gap-[3px]"
            style={{
              gridTemplateColumns: `repeat(${cols}, 4px)`,
              gridTemplateRows: "4px 4px",
            }}
          >
            {item.glyph.flat().map((on, di) =>
              on ? (
                <span
                  key={di}
                  className="rounded-full bg-info"
                  style={{ opacity: item.opacities[di] }}
                />
              ) : (
                <span key={di} />
              )
            )}
          </div>
        )
      })}
    </div>
  )
}

export { ThinkingDots }
