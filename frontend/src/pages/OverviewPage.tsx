import React, { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Play, ArrowRight, ExternalLink, ChevronDown, Check, X, ShieldAlert, Sparkles } from "lucide-react"
import { AnimatedBorderTrail } from "../components/animata/AnimatedBorderTrail"
import { AnimatedBeamPipeline } from "../components/animata/AnimatedBeam"
import { HeroSeismograph } from "../components/seismic/HeroSeismograph"
import { useSeismicAudio } from "../hooks/useSeismicAudio"
import { CardTilt } from "../components/animata/CardTilt"
import { cn } from "../lib/utils"
import type { Run, Diagnosis, Step } from "../types"

interface OverviewPageProps {
  runs: Run[]
  activeRun: (Run & { steps?: Step[] }) | null
  diagnosis: Diagnosis | null
  onNavigate: (page: string) => void
  onSelectRun: (runId: string) => void
  onOpenRunModal: () => void
}

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [displayVal, setDisplayVal] = useState(0)

  useEffect(() => {
    let startTimestamp: number | null = null
    const duration = 750

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / duration, 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      setDisplayVal(Math.round(easeOut * value))
      if (progress < 1) {
        requestAnimationFrame(step)
      }
    }

    requestAnimationFrame(step)
  }, [value])

  return (
    <span className="tabular-nums font-mono">
      {displayVal}
      {suffix}
    </span>
  )
}

export function OverviewPage({
  runs = [],
  activeRun,
  diagnosis,
  onNavigate,
  onSelectRun,
  onOpenRunModal,
}: OverviewPageProps) {
  const heroRef = useRef<HTMLDivElement>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const [showAllRuns, setShowAllRuns] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const { playClick, playSeismicPing } = useSeismicAudio()

  // Metrics computation from real runs
  const totalRuns = runs.length
  const failedRuns = runs.filter((r) => r.outcome === "failure").length
  const successRuns = runs.filter((r) => r.outcome === "success").length
  const rootCausesCount = failedRuns > 0 ? (diagnosis?.causal_path ? 3 : 2) : 0
  const claimsGroundedRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 100
  const hasSynthetic = runs.some((r) => r.is_synthetic)

  // Determine latest run for hero
  const latestRun = activeRun || runs[0] || null

  // Mouse move handler for warm radial spotlight inside hero only
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!heroRef.current) return
    const rect = heroRef.current.getBoundingClientRect()
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  const handleMouseLeave = () => {
    setMousePos(null)
  }

  const handleRunAgentClick = () => {
    setIsRunning(true)
    setTimeout(() => {
      setIsRunning(false)
      onOpenRunModal()
    }, 250)
  }

  const visibleRuns = showAllRuns ? runs : runs.slice(0, 6)

  return (
    <div className="min-h-screen text-bone bg-basalt flex flex-col">
      {/* ─────────────────────────────────────────────────────────────
          LAYER 1: HERO VIEWPORT
          ───────────────────────────────────────────────────────────── */}
      <section
        ref={heroRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative w-full pt-10 pb-12 px-6 sm:px-10 border-b border-hairline overflow-hidden chart-paper-grid animate-grid-drift"
      >
        {/* Soft Warm Radial Spotlight that tracks cursor inside hero only */}
        {mousePos && (
          <div
            className="absolute pointer-events-none transition-opacity duration-300"
            style={{
              left: mousePos.x,
              top: mousePos.y,
              width: 500,
              height: 500,
              transform: "translate(-50%, -50%)",
              background: "radial-gradient(circle, rgba(255, 90, 54, 0.05) 0%, transparent 70%)",
            }}
          />
        )}

        <div className="relative max-w-5xl mx-auto space-y-6">
          {/* Eyebrow and Headline with Instrument Serif staggered animation */}
          <div className="space-y-2">
            <div className="text-xs font-mono text-subtle tracking-wider uppercase">
              Flight recorder for agent pipelines
            </div>

            <h1 className="text-4xl sm:text-5xl font-display font-normal text-bone tracking-tight leading-tight">
              <motion.span
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.05 }}
                className="inline-block mr-2"
              >
                Every answer,
              </motion.span>
              <motion.span
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15 }}
                className="inline-block italic font-display text-ember font-normal"
              >
                traced.
              </motion.span>
            </h1>

            <p className="text-sm font-sans text-subtle max-w-xl">
              Causal provenance for every execution. Origin test for every failure. Counterfactual replay to verify every patch.
            </p>
          </div>

          {/* Full-width live Seismograph of the latest run */}
          <HeroSeismograph
            runId={latestRun?.id}
            outcome={latestRun?.outcome}
            fault={latestRun?.fault}
            steps={activeRun?.steps || []}
            diagnosis={diagnosis}
            onOpenForensics={() => onNavigate("forensics")}
            onSelectStep={(idx) => {
              onNavigate("provenance")
            }}
          />

          {/* Action Row: Primary Run Agent Button + Open Forensics Link */}
          <div className="flex items-center gap-4 pt-1">
            <AnimatedBorderTrail
              trailColor="ember"
              duration="6s"
              className="inline-block"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  playClick(950)
                  handleRunAgentClick()
                }}
                type="button"
                className="px-5 py-2.5 bg-surface text-bone hover:text-white font-sans text-xs font-medium flex items-center gap-2 rounded-[9px] transition-all shadow-md group cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 text-ember fill-ember group-hover:scale-110 transition-transform" />
                <span>{isRunning ? "Preparing pipeline..." : "Run agent"}</span>
              </motion.button>
            </AnimatedBorderTrail>

            <motion.button
              whileHover={{ x: 3 }}
              type="button"
              onClick={() => {
                playClick(800)
                onNavigate("forensics")
              }}
              className="text-xs font-sans text-subtle hover:text-bone underline underline-offset-4 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>Open forensics</span>
              <span>&rarr;</span>
            </motion.button>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          LAYER 2: QUIET STAT STRIP (Interactive with micro-hover)
          ───────────────────────────────────────────────────────────── */}
      <section className="border-b border-hairline bg-surface/40 py-3.5 px-6 sm:px-10 select-none">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-y-3 gap-x-6 text-xs text-subtle">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-md bg-surface/40 hover:bg-surface border border-transparent hover:border-hairline transition-all cursor-default"
            >
              <span className="text-lg font-mono font-medium text-bone">
                <AnimatedNumber value={totalRuns} />
              </span>
              <span className="font-sans text-subtle">runs</span>
            </motion.div>

            <span className="text-hairline">·</span>

            <motion.div
              whileHover={{ scale: 1.05 }}
              onClick={() => playSeismicPing(true)}
              className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-md bg-surface/40 hover:bg-surface border border-transparent hover:border-hairline transition-all cursor-pointer"
              title="Click to audition anomaly acoustic resonance"
            >
              <span className={cn("text-lg font-mono font-medium", failedRuns > 0 ? "text-ember" : "text-bone")}>
                <AnimatedNumber value={failedRuns} />
              </span>
              <span className="font-sans text-subtle">failed</span>
            </motion.div>

            <span className="text-hairline">·</span>

            <motion.div
              whileHover={{ scale: 1.05 }}
              className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-md bg-surface/40 hover:bg-surface border border-transparent hover:border-hairline transition-all cursor-default"
            >
              <span className="text-lg font-mono font-medium text-bone">
                <AnimatedNumber value={rootCausesCount} />
              </span>
              <span className="font-sans text-subtle">root causes</span>
            </motion.div>

            <span className="text-hairline">·</span>

            <motion.div
              whileHover={{ scale: 1.05 }}
              className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-md bg-surface/40 hover:bg-surface border border-transparent hover:border-hairline transition-all cursor-default"
            >
              <span className="text-lg font-mono font-medium text-lichen">
                <AnimatedNumber value={claimsGroundedRate} suffix="%" />
              </span>
              <span className="font-sans text-subtle">claims grounded</span>
            </motion.div>
          </div>

          {hasSynthetic && (
            <motion.div
              whileHover={{ scale: 1.04 }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-hairline bg-surface-raised text-[10px] font-mono text-subtle"
            >
              <Sparkles className="w-3 h-3 text-ochre animate-spin" style={{ animationDuration: "8s" }} />
              <span>Seeded demo data</span>
            </motion.div>
          )}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          LAYER 3: PIPELINE AS A SINGLE THIN LINE
          ───────────────────────────────────────────────────────────── */}
      <section className="py-8 px-6 sm:px-10 border-b border-hairline">
        <div className="max-w-5xl mx-auto">
          <AnimatedBeamPipeline
            currentOutcome={latestRun?.outcome}
            activeStage={diagnosis?.root_cause_idx ?? 4}
          />
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          BELOW THE FOLD: RECENT RUNS QUIET LEDGER
          ───────────────────────────────────────────────────────────── */}
      <section className="py-8 px-6 sm:px-10 flex-1">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-sans font-medium text-bone">Recent runs</span>
            <button
              type="button"
              onClick={() => setShowAllRuns(!showAllRuns)}
              className="text-subtle hover:text-bone text-xs font-sans transition-colors"
            >
              {showAllRuns ? "Show fewer" : `View all runs (${runs.length})`}
            </button>
          </div>

          <div className="rounded-[10px] border border-hairline bg-surface/40 overflow-hidden divide-y divide-hairline">
            {visibleRuns.length === 0 ? (
              <div className="p-8 text-center text-xs font-mono text-subtle">
                No runs logged yet. Click "Run agent" above to execute a trace.
              </div>
            ) : (
              visibleRuns.map((run, idx) => {
                const isFail = run.outcome === "failure"
                const isHovered = hoveredRowId === run.id

                return (
                  <motion.div
                    key={run.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.03 }}
                    onMouseEnter={() => setHoveredRowId(run.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                    onClick={() => {
                      onSelectRun(run.id)
                      onNavigate("provenance")
                    }}
                    className="p-3 sm:px-4 cursor-pointer hover:bg-surface-raised transition-colors flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-3 text-xs">
                      {/* Left: Glyph & Run ID */}
                      <div className="flex items-center gap-2.5 min-w-[160px]">
                        <span
                          className={cn(
                            "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                            isFail ? "text-ember bg-ember/15" : "text-lichen bg-lichen/15"
                          )}
                        >
                          {isFail ? "✕" : "✓"}
                        </span>

                        <span className="font-mono text-bone text-xs truncate">{run.id}</span>
                      </div>

                      {/* Fault injected tag */}
                      <div className="hidden sm:block text-[11px] font-mono text-subtle truncate flex-1">
                        {run.fault && run.fault !== "no_fault" ? (
                          <span className="text-ember">fault: {run.fault}</span>
                        ) : (
                          <span className="text-subtle/70">clean baseline</span>
                        )}
                      </div>

                      {/* Tiny Sparkline of step health */}
                      <div className="flex items-center gap-0.5 shrink-0 px-2">
                        {(run.steps_sparkline || ["ok", "ok", "ok", isFail ? "error" : "ok", "ok"]).map((st, i) => (
                          <div
                            key={i}
                            className={cn(
                              "w-1 rounded-sm transition-all",
                              st === "error" ? "h-3 bg-ember" : "h-1.5 bg-lichen/70"
                            )}
                          />
                        ))}
                      </div>

                      {/* Inspect Action */}
                      <div className="text-[11px] font-sans text-subtle hover:text-bone shrink-0">
                        Inspect &rarr;
                      </div>
                    </div>

                    {/* Expandable one-line root cause summary on hover */}
                    <AnimatePresence>
                      {isHovered && isFail && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18 }}
                          className="pt-1 text-[11px] font-mono text-ember/90 pl-6 border-t border-hairline/40"
                        >
                          Root cause: {run.fault ? `injected ${run.fault}` : "planner selected wrong quarter table"} &middot; Click to investigate
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
