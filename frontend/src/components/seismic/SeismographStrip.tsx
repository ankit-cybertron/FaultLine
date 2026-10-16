import React from "react"
import { motion } from "motion/react"
import { cn } from "../../lib/utils"
import type { Step } from "../../types"

interface SeismographStripProps {
  steps: Step[]
  activeStepIdx?: number | null
  rootCauseIdx?: number | null
  failureIdx?: number | null
  onSelectStep: (idx: number) => void
  className?: string
}

export function SeismographStrip({
  steps,
  activeStepIdx,
  rootCauseIdx,
  failureIdx,
  onSelectStep,
  className,
}: SeismographStripProps) {
  if (!steps || steps.length === 0) {
    return (
      <div className={cn("h-7 px-3 flex items-center gap-1 bg-sidebar border border-border rounded font-mono text-[10px] text-muted", className)}>
        <span>SEISMOGRAPH: IDLE</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative h-8 px-2 flex items-center gap-1.5 bg-sidebar border border-border rounded-md select-none group",
        className
      )}
      title="Seismograph: step health & latency waveform. Click spike to focus step."
    >
      <span className="text-[10px] font-mono text-muted/70 tracking-wider hidden sm:inline">SEISMIC</span>

      {/* Baseline trace line */}
      <div className="absolute left-14 right-2 top-1/2 h-[1px] bg-border/80 pointer-events-none" />

      <div className="relative flex items-center gap-1 pl-1 pr-1 flex-1 h-full">
        {steps.map((step) => {
          const isSelected = activeStepIdx === step.idx
          const isRoot = rootCauseIdx === step.idx
          const isFailure = failureIdx === step.idx || step.status === "error"

          // Amplitude: errors spike high (100%), warnings medium (60%), normal (35-50%)
          let heightPercent = 40
          if (isRoot) heightPercent = 95
          else if (isFailure) heightPercent = 90
          else if (step.duration_ms) {
            heightPercent = Math.min(75, Math.max(30, (step.duration_ms / 300) * 60))
          }

          let barColor = "bg-lichen/70 hover:bg-lichen"
          if (isRoot) {
            barColor = "bg-ember shadow-[0_0_8px_var(--signal-ember)] animate-pulse"
          } else if (isFailure) {
            barColor = "bg-ember/80 shadow-[0_0_6px_var(--signal-ember)]"
          } else if (isSelected) {
            barColor = "bg-ochre shadow-[0_0_6px_var(--signal-ochre)]"
          }

          return (
            <button
              key={`${step.run_id}-${step.idx}`}
              type="button"
              onClick={() => onSelectStep(step.idx)}
              className="relative flex-1 h-full flex flex-col items-center justify-center focus:outline-none group/spike"
              title={`Step #${step.idx} (${step.agent}) - ${isRoot ? "⚡ Root Cause" : isFailure ? "✕ Failure" : "✓ Ok"}`}
            >
              {/* Vertical spike bar centered on baseline */}
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.2 }}
                style={{ height: `${heightPercent}%` }}
                className={cn(
                  "w-1.5 rounded-sm transition-all origin-center",
                  barColor,
                  isSelected && "w-2 scale-110"
                )}
              />

              {/* Spike label tooltip on hover */}
              <div className="absolute -top-6 hidden group-hover/spike:flex items-center px-1.5 py-0.5 rounded bg-elevated border border-border text-[9px] font-mono text-foreground whitespace-nowrap z-30 shadow-md">
                #{step.idx} {step.agent}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
