import React from "react"
import { motion } from "motion/react"
import { cn } from "../../lib/utils"

interface FaultLineDividerProps {
  xPosition?: number
  height?: number
  className?: string
  label?: string
}

export function FaultLineDivider({
  xPosition = 240,
  height = 420,
  className,
  label = "FAULT LINE — CORRUPTION BOUNDARY",
}: FaultLineDividerProps) {
  // Generate a restrained, jagged seismic fault line path
  const points = [
    `M ${xPosition} 0`,
    `L ${xPosition - 3} 40`,
    `L ${xPosition + 4} 90`,
    `L ${xPosition - 5} 150`,
    `L ${xPosition + 6} 210`,
    `L ${xPosition - 4} 270`,
    `L ${xPosition + 3} 330`,
    `L ${xPosition - 2} 380`,
    `L ${xPosition} ${height}`,
  ].join(" ")

  return (
    <div
      className={cn("pointer-events-none absolute top-0 bottom-0 z-20 flex flex-col items-center", className)}
      style={{ left: `${xPosition - 10}px` }}
    >
      {/* Top Tag Badge */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-2 py-0.5 rounded-sm bg-status-failure/20 border border-status-failure/60 text-[9px] font-mono text-status-failure tracking-wider shadow-sm"
      >
        ⚡ {label}
      </motion.div>

      {/* Jagged SVG line */}
      <svg
        width="24"
        height={height}
        className="overflow-visible mt-1"
        style={{ filter: "drop-shadow(0 0 6px rgba(255, 90, 54, 0.45))" }}
      >
        <path
          d={points}
          fill="none"
          stroke="var(--signal-ember)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          strokeOpacity="0.85"
        />
      </svg>
    </div>
  )
}
