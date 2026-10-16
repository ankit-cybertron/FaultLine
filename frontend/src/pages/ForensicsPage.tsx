import React, { useState } from "react"
import { motion } from "motion/react"
import {
  Search,
  AlertTriangle,
  Play,
  RotateCcw,
  CheckCircle2,
  FileDiff,
  ShieldCheck,
  ArrowRight,
  Flame,
  Zap,
} from "lucide-react"
import { PatchDiffViewer } from "../components/forensics/PatchDiffViewer"
import { ForkedTimeline } from "../components/seismic/ForkedTimeline"
import { EpicenterPulse } from "../components/seismic/EpicenterPulse"
import { AnimatedBorderTrail } from "../components/animata/AnimatedBorderTrail"
import { CardTilt } from "../components/animata/CardTilt"
import { useSeismicAudio } from "../hooks/useSeismicAudio"
import { cn } from "../lib/utils"
import type { Diagnosis, Step, Run } from "../types"

interface ForensicsPageProps {
  runId: string
  diagnosis: Diagnosis | null
  steps: Step[]
  runs: Run[]
  onSelectRun: (runId: string) => void
  onRunInvestigate: () => void
  isInvestigating: boolean
  onRunReplay: () => void
  isReplaying: boolean
}

export function ForensicsPage({
  runId,
  diagnosis,
  steps = [],
  runs = [],
  onSelectRun,
  onRunInvestigate,
  isInvestigating,
  onRunReplay,
  isReplaying,
}: ForensicsPageProps) {
  const currentRun = runs.find((r) => r.id === runId)
  const isFailed = currentRun?.outcome === "failure" || Boolean(diagnosis?.root_cause_idx != null)

  const { playClick, playSeismicPing } = useSeismicAudio()

  const rootCauseStep = steps.find((s) => s.idx === diagnosis?.root_cause_idx) || null
  const symptomStep = steps.find((s) => s.idx === diagnosis?.failure_idx) || null

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Header & Run Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-hairline">
        <div>
          <h1 className="text-2xl font-display font-normal text-bone tracking-tight">
            Forensics lab
          </h1>
          <p className="text-xs font-sans text-subtle">
            Origin test, causal shockwave backtracking, and counterfactual replay
          </p>
        </div>

        {/* Run Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-mono text-subtle">Run:</label>
          <select
            value={runId}
            onChange={(e) => {
              playClick(900)
              onSelectRun(e.target.value)
            }}
            className="bg-surface border border-hairline text-bone text-xs rounded px-3 py-1.5 font-mono focus:outline-none focus:border-ember cursor-pointer"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} ({r.outcome === "failure" ? "FAIL" : "PASS"} - {r.fault || "clean"})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Act 1: Origin Test Action Bar */}
      <div className="p-4 rounded-[10px] border border-hairline bg-surface flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[8px] bg-ember/15 border border-ember/30 flex items-center justify-center text-ember shrink-0">
            <Zap className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-sans font-medium text-bone">
              Act 1: Origin test (FalkorDB backward slice)
            </div>
            <div className="text-xs text-subtle font-sans">
              Judges topological ancestors to isolate the exact step that broke first while its parents were correct.
            </div>
          </div>
        </div>

        <AnimatedBorderTrail trailColor="ember" duration="4s" active={!isInvestigating}>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={() => {
              playSeismicPing(true)
              onRunInvestigate()
            }}
            disabled={isInvestigating}
            className="px-4 py-2 bg-ember hover:bg-ember/90 text-basalt font-sans font-medium text-xs rounded-[8px] transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-md"
          >
            {isInvestigating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-basalt border-t-transparent rounded-full animate-spin" />
                <span>Judging slice steps...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Run origin test</span>
              </>
            )}
          </motion.button>
        </AnimatedBorderTrail>
      </div>

      {/* Act 2: Diagnosis Metrics & Causal Chain */}
      {diagnosis ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CardTilt maxTilt={8} glowColor="rgba(255, 90, 54, 0.2)">
              <EpicenterPulse active={Boolean(diagnosis.root_cause_idx != null)}>
                <div
                  onClick={() => playSeismicPing(true)}
                  className="p-4 rounded-[10px] border border-ember/60 bg-ember/10 cursor-pointer shadow-sm"
                  title="Audition seismic epicenter resonance"
                >
                  <div className="text-[10px] font-mono text-ember uppercase font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-ember animate-ping" />
                    Root cause
                  </div>
                  <div className="text-2xl font-bold font-mono text-ember mt-1">
                    #{diagnosis.root_cause_idx}
                  </div>
                  <div className="text-[10px] font-mono text-subtle mt-1 truncate">
                    {rootCauseStep?.agent || "planner"}
                  </div>
                </div>
              </EpicenterPulse>
            </CardTilt>

            <CardTilt maxTilt={8} glowColor="rgba(232, 176, 74, 0.15)">
              <div className="p-4 rounded-[10px] border border-hairline bg-surface">
                <div className="text-[10px] font-mono text-ochre uppercase font-bold">
                  ✕ Symptom step
                </div>
                <div className="text-2xl font-bold font-mono text-ochre mt-1">
                  #{diagnosis.failure_idx}
                </div>
                <div className="text-[10px] font-mono text-subtle mt-1 truncate">
                  {symptomStep?.agent || "verifier"}
                </div>
              </div>
            </CardTilt>

            <CardTilt maxTilt={8} glowColor="rgba(217, 205, 182, 0.1)">
              <div className="p-4 rounded-[10px] border border-hairline bg-surface">
                <div className="text-[11px] font-sans text-subtle">
                  Slice steps judged
                </div>
                <div className="text-2xl font-bold font-mono text-bone mt-1 tabular-nums">
                  {diagnosis.steps_checked?.length || 5}
                </div>
                <div className="text-[10px] font-mono text-subtle mt-1">
                  Topological traversal
                </div>
              </div>
            </CardTilt>

            <CardTilt maxTilt={8} glowColor={diagnosis.replay_passed ? "rgba(198, 227, 107, 0.2)" : "rgba(255, 90, 54, 0.2)"}>
              <div className="p-4 rounded-[10px] border border-hairline bg-surface">
                <div className="text-[11px] font-sans text-subtle">
                  Closed-loop replay
                </div>
                <div
                  className={cn(
                    "text-2xl font-bold font-mono mt-1",
                    diagnosis.replay_passed ? "text-lichen" : "text-ember"
                  )}
                >
                  {diagnosis.replay_passed ? "VERIFIED" : "FAILED"}
                </div>
                <div className="text-[10px] font-mono text-subtle mt-1">
                  Counterfactual proof
                </div>
              </div>
            </CardTilt>
          </div>

          {/* Causal Chain Path */}
          <div className="p-3.5 rounded-[8px] border border-hairline bg-surface flex items-center justify-between text-xs font-mono">
            <span className="text-subtle">Causal shockwave path:</span>
            <div className="flex items-center gap-2 text-ember font-bold">
              {diagnosis.causal_path.map((idx, i) => (
                <React.Fragment key={idx}>
                  <span className="px-2 py-0.5 rounded bg-ember/15 border border-ember/40">
                    Step #{idx}
                  </span>
                  {i < diagnosis.causal_path.length - 1 && (
                    <ArrowRight className="w-3.5 h-3.5 text-ember/70" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Plain-Language Explanation */}
          <div className="p-4 rounded-[10px] border border-hairline bg-surface space-y-2">
            <div className="text-xs font-sans font-medium text-subtle">
              Act 2: Analytical root-cause diagnosis
            </div>
            <p className="text-sm text-bone leading-relaxed font-sans">
              {diagnosis.explanation}
            </p>
          </div>

          {/* Act 3: Structured Patch & Forked Timeline */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans font-medium text-bone">
                Act 3: Counterfactual verification &amp; repair
              </span>

              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => {
                  playClick(1000)
                  onRunReplay()
                }}
                disabled={isReplaying}
                className="px-4 py-2 rounded-[8px] bg-lichen hover:bg-lichen/90 text-basalt font-sans font-medium text-xs transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md"
              >
                {isReplaying ? (
                  <>
                    <span className="w-3 h-3 border-2 border-basalt border-t-transparent rounded-full animate-spin" />
                    <span>Verifying replay...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Verify replay</span>
                  </>
                )}
              </motion.button>
            </div>

            <PatchDiffViewer
              patch={diagnosis.patch}
              rootCauseIdx={diagnosis.root_cause_idx}
            />

            <ForkedTimeline
              originalSteps={steps}
              rootCauseIdx={diagnosis.root_cause_idx ?? 0}
              replayPassed={diagnosis.replay_passed}
              patchState={diagnosis.replay_passed ? "verified" : "applied"}
            />
          </div>
        </div>
      ) : (
        <div className="p-12 rounded-xl border border-dashed border-border bg-panel text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-sidebar border border-border mx-auto flex items-center justify-center text-muted">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            No Active Diagnosis for Run {runId}
          </h3>
          <p className="text-xs text-muted max-w-md mx-auto">
            Click "Run Origin Test" above to walk backward from failure assertions and compute causal paths.
          </p>
        </div>
      )}
    </div>
  )
}
