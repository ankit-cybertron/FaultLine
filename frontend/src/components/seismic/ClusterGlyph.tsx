import React from "react"
import { stringHash } from "../../lib/utils"

interface ClusterGlyphProps {
  signature: string
  size?: number
  className?: string
}

export function ClusterGlyph({ signature, size = 28, className }: ClusterGlyphProps) {
  const hash = stringHash(signature)

  // Derive 4 deterministic geometric coordinates from the hash
  const p1 = (hash % 10) + 4
  const p2 = ((hash >> 3) % 10) + 4
  const p3 = ((hash >> 6) % 10) + 4
  const p4 = ((hash >> 9) % 10) + 4

  // Choose stroke color deterministically from the seismic palette
  const colors = ["#FF5A36", "#C6E36B", "#E8B04A", "#D9CDB6", "#F2EBDD"]
  const strokeColor = colors[hash % colors.length]

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      title={`Cluster signature hash: ${hash}`}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="rounded border border-border/80 bg-sidebar/90 p-0.5"
      >
        {/* Generative geometric matrix representation */}
        <polygon
          points={`12,${p1} ${24 - p2},12 12,${24 - p3} ${p4},12`}
          fill={strokeColor}
          fillOpacity="0.2"
          stroke={strokeColor}
          strokeWidth="1.5"
        />
        <circle cx="12" cy="12" r="2.5" fill={strokeColor} />
      </svg>
    </div>
  )
}
