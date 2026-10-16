import React from "react"
import { motion } from "motion/react"
import { cn } from "../../lib/utils"
import type { Step } from "../../types"

interface AnimatedTimelineProps {
  steps: Step[]
  activeStepIdx?: number | null
  rootCauseIdx?: number | null
  failureIdx?: number | null
  onSelectStep: (idx: number) => void
  className?: string
}

export function AnimatedTimeline({
  steps,
  activeStepIdx,
  rootCauseIdx,
  failureIdx,
  onSelectStep,
  className,
}: AnimatedTimelineProps) {
  return (
    <div className={cn("relative space-y-1.5 strata-banding p-3 rounded-lg border border-border bg-panel/60", className)}>
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border text-[11px] font-mono text-muted uppercase tracking-wider">
        <span>Trace Steps ({steps.length})</span>
        <span>Status</span>
      </div>

      <div className="relative">
        {/* Continuous background guide line */}
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/80" />

        <div className="space-y-1">
          {steps.map((step, index) => {
            const isSelected = activeStepIdx === step.idx
            const isRoot = rootCauseIdx === step.idx
            const isFailure = failureIdx === step.idx || step.status === "error"
            const isLast = index === steps.length - 1

            let dotColor = "border-border bg-sidebar"
            let badgeColor = "text-muted border-border bg-panel"
            let glyph = "✓"

            if (step.status === "error") {
              dotColor = "border-status-failure bg-status-failure/20 shadow-[0_0_8px_rgba(248,113,113,0.4)]"
              badgeColor = "text-status-failure border-status-failure/40 bg-status-failure/10"
              glyph = "✕"
            } else if (step.status === "source") {
              dotColor = "border-accent-violet bg-accent-violet/20"
              badgeColor = "text-accent-violet border-accent-violet/30 bg-accent-violet/10"
              glyph = "📦"
            } else if (isRoot) {
              dotColor = "border-status-failure bg-status-failure shadow-[0_0_12px_rgba(248,113,113,0.6)]"
              badgeColor = "text-status-failure border-status-failure/60 bg-status-failure/20"
              glyph = "⚡"
            } else {
              dotColor = "border-status-success bg-status-success/20"
              badgeColor = "text-status-success border-status-success/30 bg-status-success/10"
              glyph = "✓"
            }

            return (
              <motion.button
                key={`${step.run_id}-${step.idx}`}
                type="button"
                onClick={() => onSelectStep(step.idx)}
                whileHover={{ x: 2 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  "relative w-full text-left flex items-start gap-3 p-2 rounded-md transition-all select-none border group",
                  isSelected
                    ? "bg-surface-raised border-hairline shadow-sm"
                    : isRoot
                    ? "bg-ember/5 border-ember/40"
                    : "border-transparent hover:bg-surface-raised/50 hover:border-hairline/60"
                )}
              >
                {/* Node dot with connection line */}
                <div className="relative flex flex-col items-center justify-center shrink-0 w-8 pt-0.5">
                  <div
                    className={cn(
                      "w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[8px] transition-transform",
                      dotColor,
                      isSelected && "scale-125"
                    )}
                  >
                    {isRoot && <span className="absolute -inset-1 rounded-full animate-ping bg-status-failure/30" />}
                  </div>
                  {!isLast && (
                    <div
                      className={cn(
                        "w-px h-6 my-1 transition-colors",
                        isFailure ? "bg-status-failure/50" : "bg-border/60"
                      )}
                    />
                  )}
                </div>

                {/* Step Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-mono text-xs text-muted font-medium">#{step.idx}</span>
                      <span className="font-medium text-xs text-foreground truncate">{step.agent}</span>
                      {step.tool && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-sidebar border border-border text-muted truncate">
                          {step.tool}
                        </span>
                      )}
                    </div>
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono border shrink-0 flex items-center gap-1", badgeColor)}>
                      <span>{glyph}</span>
                      <span>{isRoot ? "ROOT CAUSE" : isFailure ? "SYMPTOM" : step.status}</span>
                    </span>
                  </div>

                  {step.output && (
                    <div className="text-[11px] text-muted truncate mt-0.5 font-mono">
                      {typeof step.output === "string" ? step.output : JSON.stringify(step.output)}
                    </div>
                  )}
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
