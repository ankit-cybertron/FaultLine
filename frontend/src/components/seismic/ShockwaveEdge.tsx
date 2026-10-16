import React from "react"
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react"
import { motion } from "motion/react"

export function ShockwaveEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const isShockwave = Boolean(data?.is_shockwave)
  const isCausalPath = Boolean(data?.is_causal_path)

  return (
    <>
      {/* Base Edge Path */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: isCausalPath ? "var(--signal-ember)" : isShockwave ? "var(--signal-ember)" : "var(--border-hairline)",
          strokeWidth: isCausalPath || isShockwave ? 2.5 : 1.5,
          opacity: isCausalPath ? 0.95 : 0.6,
        }}
      />

      {/* Shockwave Traveling Glow (one-time / active transition) */}
      {isShockwave && (
        <circle r="4" fill="var(--signal-ember)" className="shadow-[0_0_10px_var(--signal-ember)]">
          <animateMotion
            dur="0.9s"
            repeatCount="1"
            path={edgePath}
            fill="freeze"
          />
        </circle>
      )}

      {/* Causal path subtle pulsing glow */}
      {isCausalPath && !isShockwave && (
        <path
          d={edgePath}
          fill="none"
          stroke="var(--signal-ember)"
          strokeWidth="3"
          strokeOpacity="0.35"
          className="blur-[2px]"
        />
      )}
    </>
  )
}
