import React from "react"
import { motion } from "motion/react"
import { cn } from "../../lib/utils"

interface EvidenceThreadProps {
  sourcePos?: { x: number; y: number } | null
  targetPos?: { x: number; y: number } | null
  isSupported?: boolean
  active?: boolean
  className?: string
}

export function EvidenceThread({
  sourcePos,
  targetPos,
  isSupported = true,
  active = false,
  className,
}: EvidenceThreadProps) {
  if (!active || !sourcePos) return null

  // If unsupported: draw a severed thread ending midway with "no anchor"
  const endX = targetPos ? targetPos.x : sourcePos.x + 120
  const endY = targetPos ? targetPos.y : sourcePos.y + 40

  const midX = (sourcePos.x + endX) / 2
  const pathD = `M ${sourcePos.x} ${sourcePos.y} C ${midX} ${sourcePos.y}, ${midX} ${endY}, ${endX} ${endY}`

  const strokeColor = isSupported ? "var(--signal-lichen)" : "var(--signal-ember)"

  return (
    <svg
      className={cn("pointer-events-none fixed inset-0 z-50 overflow-visible", className)}
      style={{ width: "100vw", height: "100vh" }}
    >
      <defs>
        <filter id="thread-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="glow" />
          <feComposite in="SourceGraphic" in2="glow" operator="over" />
        </filter>
      </defs>

      {/* Main Evidence Thread */}
      <motion.path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={isSupported ? 2 : 1.8}
        strokeDasharray={isSupported ? "none" : "5 4"}
        filter="url(#thread-glow)"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.9 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />

      {/* Anchor End Pin */}
      {isSupported && targetPos && (
        <circle
          cx={targetPos.x}
          cy={targetPos.y}
          r={4}
          fill="var(--signal-lichen)"
          className="shadow-[0_0_8px_var(--signal-lichen)]"
        />
      )}

      {/* Severed thread indicator */}
      {!isSupported && (
        <g transform={`translate(${endX}, ${endY})`}>
          <circle cx="0" cy="0" r="3" fill="var(--signal-ember)" />
          <rect x="6" y="-10" width="70" height="18" rx="3" fill="var(--bg-surface-raised)" stroke="var(--signal-ember)" strokeWidth="1" />
          <text x="12" y="3" fill="var(--signal-ember)" fontSize="9" fontFamily="JetBrains Mono, monospace">
            NO ANCHOR
          </text>
        </g>
      )}
    </svg>
  )
}
