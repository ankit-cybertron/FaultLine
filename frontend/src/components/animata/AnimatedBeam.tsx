import React, { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Database, Wrench, Cpu, ShieldCheck, FileCheck } from "lucide-react"
import { cn } from "../../lib/utils"

interface Stage {
  id: string
  label: string
  sub: string
  detail: string
  icon: React.ReactNode
}

interface PipelineBeamsProps {
  currentOutcome?: "success" | "failure" | null
  activeStage?: number
  className?: string
}

export function AnimatedBeamPipeline({
  currentOutcome = "success",
  activeStage = 4,
  className,
}: PipelineBeamsProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const stages: Stage[] = [
    {
      id: "source",
      label: "Source",
      sub: "sales_q3_apac",
      detail: "Warehouse records & schema validation",
      icon: <Database className="w-3.5 h-3.5" />,
    },
    {
      id: "tool",
      label: "Tool",
      sub: "query_warehouse",
      detail: "Fetcher agent database execution",
      icon: <Wrench className="w-3.5 h-3.5" />,
    },
    {
      id: "model",
      label: "Model",
      sub: "fx_aggregation",
      detail: "Transformer currency conversion",
      icon: <Cpu className="w-3.5 h-3.5" />,
    },
    {
      id: "verifier",
      label: "Verifier",
      sub: "sanity_checks",
      detail: "Row count & arithmetic assertion",
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
    },
    {
      id: "answer",
      label: "Answer",
      sub: "graph_provenance",
      detail: "Final synthesized summary delivery",
      icon: <FileCheck className="w-3.5 h-3.5" />,
    },
  ]

  const isFailure = currentOutcome === "failure"
  // If failure, stop at activeStage (or verifier stage 3 if not set)
  const targetStageIdx = isFailure ? Math.min(stages.length - 1, Math.max(0, activeStage)) : stages.length - 1
  const beamProgress = ((targetStageIdx) / (stages.length - 1)) * 100

  return (
    <div className={cn("relative py-6 px-4 bg-surface/60 rounded-[10px] border border-hairline select-none", className)}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-sans text-subtle tracking-wide">Pipeline verification flow</span>
        <span className="text-[11px] font-mono text-subtle">
          {isFailure ? `Fault isolated at ${stages[targetStageIdx].label}` : "All 5 stages verified"}
        </span>
      </div>

      {/* Single thin pipeline track */}
      <div className="relative flex items-center justify-between px-6 pt-3 pb-2">
        {/* Baseline connecting rail */}
        <div className="absolute left-6 right-6 top-[22px] h-[1px] bg-hairline" />

        {/* Traveling Animated Beam */}
        <motion.div
          className={cn(
            "absolute left-6 top-[22px] h-[2px] rounded-full",
            isFailure ? "bg-ember shadow-[0_0_8px_var(--signal-ember)]" : "bg-lichen shadow-[0_0_8px_var(--signal-lichen)]"
          )}
          initial={{ width: "0%" }}
          animate={{ width: `${beamProgress}%` }}
          transition={{ duration: 1.1, ease: "easeInOut" }}
        />

        {stages.map((stage, idx) => {
          const isFailingNode = isFailure && idx === targetStageIdx
          const isPassedNode = !isFailure || idx < targetStageIdx
          const isFutureNode = isFailure && idx > targetStageIdx

          return (
            <div
              key={stage.id}
              className="relative flex flex-col items-center group cursor-pointer z-10"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Node Pip */}
              <motion.div
                whileHover={{ y: -2 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  "relative w-7 h-7 rounded-full flex items-center justify-center transition-colors border",
                  isFailingNode
                    ? "bg-basalt border-ember text-ember shadow-[0_0_10px_var(--signal-ember-glow)]"
                    : isPassedNode
                    ? "bg-basalt border-lichen text-lichen"
                    : "bg-surface border-hairline text-subtle/50"
                )}
              >
                {stage.icon}

                {/* Ripple ring on failing stage when beam stops */}
                {isFailingNode && (
                  <motion.span
                    initial={{ scale: 0.9, opacity: 0.9 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    transition={{ duration: 1.5, repeat: 0, ease: "easeOut" }}
                    className="absolute inset-0 rounded-full border border-ember pointer-events-none"
                  />
                )}
              </motion.div>

              {/* Stage Name */}
              <span
                className={cn(
                  "mt-2 text-xs font-sans font-medium transition-colors",
                  isFailingNode ? "text-ember" : isPassedNode ? "text-bone" : "text-subtle/60"
                )}
              >
                {stage.label}
              </span>

              {/* Detail Tooltip on Hover */}
              <AnimatePresence>
                {hoveredIdx === idx && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 2, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full mb-3 w-48 p-2.5 rounded-[8px] bg-surface-raised border border-hairline shadow-xl text-left pointer-events-none z-30"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-xs font-semibold text-bone">{stage.label}</span>
                      <span
                        className={cn(
                          "text-[10px] font-mono",
                          isFailingNode ? "text-ember" : isPassedNode ? "text-lichen" : "text-subtle"
                        )}
                      >
                        {isFailingNode ? "failed" : isPassedNode ? "verified" : "skipped"}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-subtle truncate">{stage.sub}</div>
                    <div className="text-[11px] font-sans text-muted mt-1 leading-tight">{stage.detail}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
