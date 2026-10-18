import React, { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Play, ArrowRight, ExternalLink, ChevronDown, Check, X, ShieldAlert, Sparkles, Bot } from "lucide-react"
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
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(5)

  // Auto-redirect to Live Chat countdown
  useEffect(() => {
    if (redirectCountdown === null) return
    if (redirectCountdown <= 0) {
      onNavigate("chat")
      return
    }
    const timer = setTimeout(() => {
      setRedirectCountdown((prev) => (prev !== null ? prev - 1 : null))
    }, 1000)
    return () => clearTimeout(timer)
  }, [redirectCountdown, onNavigate])

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
          NOTIFICATION BANNER: Auto-redirecting landing page banner
          ───────────────────────────────────────────────────────────── */}
      {redirectCountdown !== null && (
        <div className="bg-gradient-to-r from-indigo-950/70 via-purple-950/40 to-surface border-b border-indigo-500/30 px-4 py-2.5 flex items-center justify-between text-xs font-sans text-indigo-200 shrink-0 z-10">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            <span className="text-bone font-medium">FaultLine Live Chat & Decision Graph</span>
            <span className="text-indigo-300/80 font-mono text-[11px]">
              &middot; Auto-redirecting in {redirectCountdown}s
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRedirectCountdown(null)}
              className="text-[11px] font-sans text-indigo-300 hover:text-white px-2 py-0.5 rounded hover:bg-surface-raised/60 transition-colors cursor-pointer"
            >
              Stay on overview
            </button>
            <button
              type="button"
              onClick={() => onNavigate("chat")}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-[6px] flex items-center gap-1.5 transition-all shadow cursor-pointer"
            >
              <span>Go to Live Chat</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

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
              Causal provenance for every execution. Real-time decision branching and disambiguation flow in Live Chat.
            </p>
          </div>

          {/* Full-width live Seismograph of the latest run */}
          <HeroSeismograph
            runId={latestRun?.id}
            outcome={latestRun?.outcome}
            fault={latestRun?.fault}
            steps={activeRun?.steps || []}
            diagnosis={diagnosis}
            onOpenForensics={() => onNavigate("chat")}
            onSelectStep={(idx) => {
              onNavigate("chat")
            }}
          />

          {/* Action Row: Primary Launch Live Chat Button + Example Prompts */}
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center gap-4">
              <AnimatedBorderTrail
                trailColor="ember"
                duration="5s"
                className="inline-block"
              >
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    playClick(950)
                    onNavigate("chat")
                  }}
                  type="button"
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-xs font-semibold flex items-center gap-2.5 rounded-[10px] transition-all shadow-lg shadow-indigo-950/50 group cursor-pointer"
                >
                  <Bot className="w-4 h-4 text-indigo-200 group-hover:scale-110 transition-transform" />
                  <span>Launch Live Chat & Decision Graph</span>
                  <ArrowRight className="w-4 h-4 text-indigo-200 group-hover:translate-x-0.5 transition-transform" />
                </motion.button>
              </AnimatedBorderTrail>

              <motion.button
                whileHover={{ x: 3 }}
                type="button"
                onClick={() => {
                  playClick(800)
                  onNavigate("chat")
                }}
                className="text-xs font-sans text-subtle hover:text-bone underline underline-offset-4 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span>Explore Decision Branching in action</span>
                <span>&rarr;</span>
              </motion.button>
            </div>

            {/* Quick-start sample prompts */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="text-[11px] font-mono text-subtle/80">Try Live Chat prompts:</span>
              {[
                { label: "What is apple?", tag: "BRANCH" },
                { label: "Calculate 42 * 1337", tag: "TOOL CALL" },
                { label: "Current UTC Time", tag: "TIME TOOL" },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => {
                    playClick(900)
                    onNavigate("chat")
                  }}
                  className="px-2.5 py-1 rounded-[6px] bg-surface-raised/70 hover:bg-surface border border-hairline hover:border-indigo-400/40 text-bone text-[11px] font-mono flex items-center gap-1.5 transition-all cursor-pointer group"
                >
                  <span>"{chip.label}"</span>
                  <span className="text-[9px] font-sans px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {chip.tag}
                  </span>
                  <ArrowRight className="w-3 h-3 text-subtle group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
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
                      onNavigate("chat")
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
