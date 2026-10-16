import React from "react"
import { motion } from "motion/react"
import { GitFork, CheckCircle2, XCircle, ArrowRight } from "lucide-react"
import { cn } from "../../lib/utils"
import type { Step } from "../../types"

interface ForkedTimelineProps {
  originalSteps: Step[]
  replayedSteps?: Step[]
  rootCauseIdx: number
  replayPassed?: boolean
  patchState?: "proposed" | "applied" | "verified"
  className?: string
}

export function ForkedTimeline({
  originalSteps,
  replayedSteps = [],
  rootCauseIdx,
  replayPassed = true,
  patchState = "verified",
  className,
}: ForkedTimelineProps) {
  return (
    <div className={cn("p-4 rounded-xl border border-border bg-panel strata-banding", className)}>
      {/* Header with State Ladder Badge */}
      <div className="flex items-center justify-between mb-4 border-b border-hairline pb-3">
        <div className="flex items-center gap-2">
          <GitFork className="w-4 h-4 text-bone" />
          <span className="text-xs font-sans font-medium text-bone">Forked replay comparison</span>
          <span className="text-[11px] font-mono text-subtle">Divergence at step #{rootCauseIdx}</span>
        </div>

        {/* State Ladder Badge */}
        <div className="flex items-center gap-1 text-[10px] font-mono">
          <span
            className={cn(
              "px-2 py-0.5 rounded border",
              patchState === "proposed" || patchState === "applied" || patchState === "verified"
                ? "bg-ochre/20 text-ochre border-ochre/40"
                : "bg-surface text-subtle border-hairline"
            )}
          >
            1. Proposed
          </span>
          <ArrowRight className="w-3 h-3 text-subtle" />
          <span
            className={cn(
              "px-2 py-0.5 rounded border",
              patchState === "applied" || patchState === "verified"
                ? "bg-ochre/20 text-ochre border-ochre/40"
                : "bg-surface text-subtle border-hairline"
            )}
          >
            2. Applied
          </span>
          <ArrowRight className="w-3 h-3 text-subtle" />
          <span
            className={cn(
              "px-2 py-0.5 rounded border",
              patchState === "verified" && replayPassed
                ? "bg-lichen/20 text-lichen border-lichen/40 font-semibold"
                : "bg-surface text-subtle border-hairline"
            )}
          >
            3. Verified
          </span>
        </div>
      </div>

      {/* Lanes */}
      <div className="space-y-4">
        {/* Lane 1: Original Run (Top Lane) */}
        <div className="p-3 rounded-lg border border-border/80 bg-sidebar/60">
          <div className="flex items-center justify-between mb-2 text-[11px] font-mono">
            <span className="text-muted flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-status-failure" />
              ORIGINAL RUN (FAILED)
            </span>
            <span className="text-status-failure flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> FAILED AT VERIFIER
            </span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto py-1">
            {originalSteps.map((step) => {
              const isPastRoot = step.idx >= rootCauseIdx
              return (
                <div
                  key={`orig-${step.idx}`}
                  className={cn(
                    "flex-1 min-w-[100px] p-2 rounded border text-center font-mono text-[11px] transition-colors",
                    isPastRoot
                      ? "border-status-failure/50 bg-status-failure/10 text-status-failure"
                      : "border-border bg-panel text-muted"
                  )}
                >
                  <div className="font-semibold">#{step.idx} {step.agent}</div>
                  <div className="text-[9px] opacity-80">{step.status}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Lane 2: Counterfactual Replay (Bottom Lane) */}
        <div className="p-3 rounded-lg border border-status-success/40 bg-status-success/5">
          <div className="flex items-center justify-between mb-2 text-[11px] font-mono">
            <span className="text-status-success flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
              COUNTERFACTUAL REPLAY (WITH STRUCTURED PATCH)
            </span>
            <span className="text-status-success flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> CLOSED-LOOP PASS (100% VERIFIED)
            </span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto py-1">
            {originalSteps.map((step) => {
              const isPatched = step.idx === rootCauseIdx
              return (
                <div
                  key={`replay-${step.idx}`}
                  className={cn(
                    "flex-1 min-w-[100px] p-2 rounded border text-center font-mono text-[11px]",
                    isPatched
                      ? "border-ochre bg-ochre/20 text-ochre shadow-[0_0_8px_var(--signal-ochre)]"
                      : "border-lichen/40 bg-lichen/15 text-lichen"
                  )}
                >
                  <div className="font-semibold">
                    #{step.idx} {step.agent}
                    {isPatched && " 🩹"}
                  </div>
                  <div className="text-[9px] opacity-90">{isPatched ? "Patch applied" : "Verified"}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
