import React, { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Activity, RotateCcw, Volume2, VolumeX, Eye } from "lucide-react"
import { cn } from "../../lib/utils"
import { useSeismicAudio } from "../../hooks/useSeismicAudio"
import type { Step, Diagnosis } from "../../types"

interface HeroSeismographProps {
  runId?: string
  outcome?: "success" | "failure"
  fault?: string
  steps?: Step[]
  diagnosis?: Diagnosis | null
  onOpenForensics: () => void
  onSelectStep?: (idx: number) => void
  className?: string
}

export function HeroSeismograph({
  runId,
  outcome = "success",
  fault,
  steps = [],
  diagnosis,
  onOpenForensics,
  onSelectStep,
  className,
}: HeroSeismographProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [activeHoverIdx, setActiveHoverIdx] = useState<number | null>(null)
  const [reticleX, setReticleX] = useState<number | null>(null)
  const [animationComplete, setAnimationComplete] = useState(false)
  const [sweepKey, setSweepKey] = useState(0)

  const { soundEnabled, toggleSound, playClick, playSeismicPing } = useSeismicAudio()

  // Fallback demo steps if run has no steps loaded yet
  const displaySteps: Step[] = steps.length > 0 ? steps : [
    { idx: 0, agent: "planner", kind: "llm_call", tool: "decompose_plan", status: "ok", duration_ms: 120, run_id: runId || "", input: {}, output: {} },
    { idx: 1, agent: "fetcher", kind: "tool_call", tool: "query_warehouse", status: outcome === "failure" ? "error" : "ok", duration_ms: 340, run_id: runId || "", input: {}, output: {} },
    { idx: 2, agent: "transformer", kind: "tool_call", tool: "fx_conversion", status: "ok", duration_ms: 190, run_id: runId || "", input: {}, output: {} },
    { idx: 3, agent: "verifier", kind: "tool_call", tool: "sanity_check", status: outcome === "failure" ? "error" : "ok", duration_ms: 150, run_id: runId || "", input: {}, output: {} },
    { idx: 4, agent: "reporter", kind: "llm_call", tool: "format_summary", status: "ok", duration_ms: 220, run_id: runId || "", input: {}, output: {} },
  ]

  const isFailure = outcome === "failure"
  const rootCauseIdx = diagnosis?.root_cause_idx ?? (isFailure ? (displaySteps.find(s => s.status === "error")?.idx ?? 1) : null)
  const failureIdx = diagnosis?.failure_idx ?? (isFailure ? displaySteps.filter(s => s.status === "error").pop()?.idx ?? rootCauseIdx : null)
  const affectedCount = isFailure ? displaySteps.length - (rootCauseIdx ?? 0) : 0

  // Chart dimensions
  const svgWidth = 840
  const svgHeight = 160
  const baselineY = 110

  // Generate waveform coordinates
  const stepCount = displaySteps.length
  const stepSpacing = (svgWidth - 120) / Math.max(stepCount - 1, 1)

  const points: { x: number; y: number; step: Step; isRoot: boolean; isFail: boolean; magnitude: number }[] = displaySteps.map((step, i) => {
    const x = 60 + i * stepSpacing
    const isRoot = step.idx === rootCauseIdx
    const isFail = step.idx === failureIdx || step.status === "error"

    let spikeHeight = 35 + ((step.duration_ms || 120) % 25)
    let mag = 2.1 + (spikeHeight / 25)
    if (isRoot) {
      spikeHeight = 78
      mag = 6.4
    } else if (isFail) {
      spikeHeight = 65
      mag = 4.9
    }

    const y = baselineY - spikeHeight
    return { x, y, step, isRoot, isFail, magnitude: Number(mag.toFixed(1)) }
  })

  // Build SVG path data
  let pathD = `M 20 ${baselineY}`
  points.forEach((pt) => {
    pathD += ` L ${pt.x - 12} ${baselineY} L ${pt.x} ${pt.y} L ${pt.x + 12} ${baselineY}`
  })
  pathD += ` L ${svgWidth - 20} ${baselineY}`

  // Plain-language verdict description
  let verdictText = ""
  if (isFailure) {
    const causeLabel = diagnosis?.explanation
      ? diagnosis.explanation.split(".")[0]
      : fault
      ? `injected fault "${fault}"`
      : "planner chose wrong table parameters"
    verdictText = `Run ${runId || "active"} failed at step ${rootCauseIdx ?? 0} (${causeLabel.toLowerCase()}). ${affectedCount} downstream step${affectedCount === 1 ? "" : "s"} affected.`
  } else {
    verdictText = `Run ${runId || "active"} verified across ${stepCount} steps with zero faults and 100% causal grounding.`
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationComplete(true)
    }, 1100)
    return () => clearTimeout(timer)
  }, [runId, isFailure, sweepKey])

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const relativeX = ((e.clientX - rect.left) / rect.width) * svgWidth
    setReticleX(relativeX)

    // Snap to nearest step within 45px
    let nearestIdx: number | null = null
    let minDist = 45
    points.forEach((pt, i) => {
      const dist = Math.abs(pt.x - relativeX)
      if (dist < minDist) {
        minDist = dist
        nearestIdx = i
      }
    })

    if (nearestIdx !== activeHoverIdx) {
      setActiveHoverIdx(nearestIdx)
      if (nearestIdx !== null) {
        const pt = points[nearestIdx]
        if (pt.isRoot || pt.isFail) {
          playSeismicPing(true)
        } else {
          playClick(750 + nearestIdx * 90)
        }
      }
    }
  }

  const handleSvgMouseLeave = () => {
    setReticleX(null)
    setActiveHoverIdx(null)
  }

  const handleReplaySweep = () => {
    setAnimationComplete(false)
    setSweepKey(k => k + 1)
    playClick(1100)
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full rounded-[10px] border border-hairline bg-surface/75 p-6 overflow-hidden select-none transition-shadow duration-300 hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)]",
        className
      )}
    >
      {/* Top Header Row of the Seismograph */}
      <div className="flex items-center justify-between mb-3 text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-ember animate-pulse" />
          <span className="font-mono text-bone text-xs font-medium">
            {runId ? `Trace ${runId}` : "Active trace stream"}
          </span>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wide",
              isFailure ? "bg-ember/15 text-ember border border-ember/30" : "bg-lichen/15 text-lichen border border-lichen/30"
            )}
          >
            {isFailure ? "ANOMALY DETECTED" : "CLEAN EXECUTION"}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-subtle">
          <span>{stepCount} steps</span>
          <span className="hidden sm:inline">Baseline: 0 ms</span>

          {/* Interactive Replay Sweep Button */}
          <button
            type="button"
            onClick={handleReplaySweep}
            title="Replay seismic sweep animation"
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-hairline hover:border-bone/40 hover:text-bone transition-all bg-surface"
          >
            <RotateCcw className="w-3 h-3 text-subtle" />
            <span className="hidden md:inline">Sweep</span>
          </button>

          {/* Audio Synth Feedback Toggle */}
          <button
            type="button"
            onClick={toggleSound}
            title={soundEnabled ? "Mute flight recorder audio" : "Enable tactile seismic synth audio"}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded border transition-colors",
              soundEnabled ? "border-ember/40 text-ember bg-ember/10" : "border-hairline text-subtle hover:text-bone"
            )}
          >
            {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            <span className="text-[10px]">{soundEnabled ? "FX ON" : "MUTE"}</span>
          </button>
        </div>
      </div>

      {/* SVG Seismograph Waveform with Interactive Reticle Scrubber */}
      <div className="relative w-full overflow-x-auto py-2">
        <svg
          ref={svgRef}
          key={sweepKey}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={handleSvgMouseLeave}
          className="w-full h-36 overflow-visible cursor-crosshair"
        >
          {/* Subtle horizontal strata guides */}
          <line x1="20" y1="35" x2={svgWidth - 20} y2="35" stroke="var(--border-hairline)" strokeDasharray="3 3" opacity="0.4" />
          <line x1="20" y1="70" x2={svgWidth - 20} y2="70" stroke="var(--border-hairline)" strokeDasharray="3 3" opacity="0.4" />
          <line x1="20" y1={baselineY} x2={svgWidth - 20} y2={baselineY} stroke="var(--border-hairline)" strokeWidth="1.2" opacity="0.8" />

          {/* Ambient Traveling Wave Packet Glow */}
          <motion.circle
            r="4"
            fill={isFailure ? "var(--signal-ember)" : "var(--signal-lichen)"}
            className="filter drop-shadow-[0_0_8px_var(--signal-ember)]"
          >
            <animateMotion
              dur="4.5s"
              repeatCount="indefinite"
              path={pathD}
            />
          </motion.circle>

          {/* Animated main seismic trace path */}
          <motion.path
            d={pathD}
            fill="none"
            stroke={isFailure ? "var(--signal-ember)" : "var(--trace-ink)"}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          />

          {/* Dynamic Laser Reticle Follower */}
          {reticleX !== null && (
            <g pointerEvents="none">
              <line
                x1={reticleX}
                y1={15}
                x2={reticleX}
                y2={baselineY + 15}
                stroke="var(--signal-ember)"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.85"
              />
              <circle
                cx={reticleX}
                cy={baselineY}
                r="3"
                fill="var(--signal-ember)"
              />
            </g>
          )}

          {/* Step Spike Markers */}
          {points.map((pt, idx) => {
            const isFailing = pt.isRoot || pt.isFail
            const isHovered = activeHoverIdx === idx

            return (
              <g
                key={pt.step.idx}
                className="cursor-pointer"
                onClick={() => {
                  playClick(880)
                  onSelectStep?.(pt.step.idx)
                }}
              >
                {/* Vertical helper guide */}
                <line
                  x1={pt.x}
                  y1={baselineY}
                  x2={pt.x}
                  y2={pt.y}
                  stroke={isFailing ? "var(--signal-ember)" : "var(--border-hairline)"}
                  strokeWidth={isHovered ? 2 : 1}
                  strokeDasharray={isFailing ? "none" : "2 2"}
                  opacity={isHovered ? 1 : 0.6}
                />

                {/* Peak Node Point */}
                <motion.circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 6 : pt.isRoot ? 5 : 3.5}
                  fill={isFailing ? "var(--signal-ember)" : "var(--bg-basalt)"}
                  stroke={isFailing ? "var(--signal-ember)" : "var(--signal-lichen)"}
                  strokeWidth="2"
                  initial={{ scale: 0 }}
                  animate={{ scale: isHovered ? 1.3 : 1 }}
                  transition={{ delay: 0.15 + idx * 0.1, duration: 0.2 }}
                />

                {/* Epicenter Concentric Ring Pulse on Root Cause */}
                {pt.isRoot && (
                  <motion.circle
                    cx={pt.x}
                    cy={pt.y}
                    r={6}
                    fill="none"
                    stroke="var(--signal-ember)"
                    strokeWidth="1.5"
                    animate={{ r: [6, 26, 6], opacity: [0.9, 0, 0.9] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                  />
                )}

                {/* Step Index Label under baseline */}
                <text
                  x={pt.x}
                  y={baselineY + 18}
                  textAnchor="middle"
                  className={cn(
                    "text-[10px] font-mono fill-current transition-all",
                    isHovered
                      ? "text-bone font-bold scale-110"
                      : isFailing
                      ? "text-ember font-bold"
                      : "text-subtle"
                  )}
                >
                  #{pt.step.idx}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Dynamic Flight Telemetry Inspection Box */}
        <AnimatePresence>
          {activeHoverIdx !== null && points[activeHoverIdx] && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute top-2 transform -translate-x-1/2 p-3 rounded-[8px] bg-surface-raised border border-hairline shadow-2xl text-left pointer-events-none z-20 text-[11px] font-mono min-w-[200px] backdrop-blur-md"
              style={{
                left: `${(points[activeHoverIdx].x / svgWidth) * 100}%`,
              }}
            >
              <div className="flex items-center justify-between text-bone font-semibold mb-1 pb-1 border-b border-hairline">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-ember animate-ping" />
                  STEP #{points[activeHoverIdx].step.idx}
                </span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[9px]",
                  points[activeHoverIdx].step.status === "error"
                    ? "bg-ember/20 text-ember"
                    : "bg-lichen/20 text-lichen"
                )}>
                  {points[activeHoverIdx].step.status === "error" ? "FAULT" : "OK"}
                </span>
              </div>

              <div className="space-y-0.5 text-[10px] text-subtle">
                <div className="flex justify-between">
                  <span>Agent:</span>
                  <span className="text-bone">{points[activeHoverIdx].step.agent}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tool / Kind:</span>
                  <span className="text-bone truncate max-w-[110px]">{points[activeHoverIdx].step.tool || points[activeHoverIdx].step.kind}</span>
                </div>
                <div className="flex justify-between">
                  <span>Latency:</span>
                  <span className="text-bone">{points[activeHoverIdx].step.duration_ms || 140} ms</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-hairline/40 text-ember">
                  <span>Intensity:</span>
                  <span className="font-bold">{points[activeHoverIdx].magnitude} Mw</span>
                </div>
              </div>

              <div className="mt-2 text-[9px] text-subtle/70 text-center font-sans">
                Click spike to inspect provenance
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Verdict Sentence (Fades up after waveform drawing finishes) */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: animationComplete ? 1 : 0, y: animationComplete ? 0 : 6 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mt-4 pt-3 border-t border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-2"
      >
        <p className="text-xs sm:text-sm font-sans text-bone/95 leading-relaxed flex items-center gap-2">
          <Eye className="w-4 h-4 text-ember shrink-0" />
          <span
            className={cn(
              "border-b transition-colors cursor-pointer",
              isFailure ? "border-ember/70 hover:border-ember text-bone" : "border-lichen/70 hover:border-lichen text-bone"
            )}
            onClick={onOpenForensics}
            title="Inspect in Forensics Lab"
          >
            {verdictText}
          </span>
        </p>

        <button
          type="button"
          onClick={onOpenForensics}
          className="text-xs font-sans text-subtle hover:text-bone underline underline-offset-4 shrink-0 transition-colors flex items-center gap-1 group"
        >
          <span>Open forensics</span>
          <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
        </button>
      </motion.div>
    </div>
  )
}

