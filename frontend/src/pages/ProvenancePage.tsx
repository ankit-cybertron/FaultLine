import React, { useState, useRef } from "react"
import { AnnotatedAnswer } from "../components/provenance/AnnotatedAnswer"
import { ClaimList } from "../components/provenance/ClaimList"
import { CausalGraph } from "../components/provenance/CausalGraph"
import { InspectorDrawer } from "../components/provenance/InspectorDrawer"
import { TraceScrubber } from "../components/provenance/TraceScrubber"
import { AnimatedTimeline } from "../components/animata/AnimatedTimeline"
import { EvidenceThread } from "../components/seismic/EvidenceThread"
import type { ProvenanceFlow, GraphElements, Step, Claim, Diagnosis } from "../types"

interface ProvenancePageProps {
  runId: string
  provenance: ProvenanceFlow | null
  graphData: GraphElements | null
  diagnosis: Diagnosis | null
  activeStepIdx: number
  onSelectStep: (idx: number) => void
  onVerifyClaims: () => void
  isVerifyingClaims: boolean
}

export function ProvenancePage({
  runId,
  provenance,
  graphData,
  diagnosis,
  activeStepIdx,
  onSelectStep,
  onVerifyClaims,
  isVerifyingClaims,
}: ProvenancePageProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [hoveredClaim, setHoveredClaim] = useState<Claim | null>(null)
  const [claimSourcePos, setClaimSourcePos] = useState<{ x: number; y: number } | null>(null)

  const steps = provenance?.flow || []
  const claims = provenance?.claims || []
  const activeStep = steps.find((s) => s.idx === activeStepIdx) || steps[0] || null

  const handleSelectStep = (idx: number) => {
    onSelectStep(idx)
    setInspectorOpen(true)
  }

  const handleHoverClaim = (claim: Claim | null, el: HTMLElement | null) => {
    setHoveredClaim(claim)
    if (claim && el) {
      const rect = el.getBoundingClientRect()
      setClaimSourcePos({
        x: rect.right,
        y: rect.top + rect.height / 2,
      })
    } else {
      setClaimSourcePos(null)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto relative">
      {/* Evidence Thread Overlay */}
      <EvidenceThread
        sourcePos={claimSourcePos}
        targetPos={claimSourcePos ? { x: window.innerWidth * 0.65, y: 280 } : null}
        isSupported={hoveredClaim?.supported ?? true}
        active={hoveredClaim != null}
      />

      {/* Page Heading */}
      <div className="flex items-center justify-between pb-2 border-b border-hairline">
        <div>
          <h2 className="text-2xl font-display font-normal text-bone">Provenance explorer</h2>
          <p className="text-xs font-sans text-subtle">
            Ordered runtime causal graph flow and claim receipts
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-subtle">Run:</span>
          <span className="font-medium text-bone">{runId}</span>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Answer & Claims (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <AnnotatedAnswer
            runId={runId}
            answerText={provenance?.answer_text || ""}
            claims={claims}
            onSelectStep={handleSelectStep}
          />

          <ClaimList
            claims={claims}
            onVerify={onVerifyClaims}
            isVerifying={isVerifyingClaims}
            onSelectStep={handleSelectStep}
            onHoverClaim={handleHoverClaim}
          />

          {/* Animated Timeline */}
          <AnimatedTimeline
            steps={steps}
            activeStepIdx={activeStepIdx}
            rootCauseIdx={diagnosis?.root_cause_idx}
            failureIdx={diagnosis?.failure_idx}
            onSelectStep={handleSelectStep}
          />
        </div>

        {/* Right Column: Interactive Causal Graph (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="h-[520px]">
            <CausalGraph
              graphData={graphData}
              activeStepIdx={activeStepIdx}
              rootCauseIdx={diagnosis?.root_cause_idx}
              failureIdx={diagnosis?.failure_idx}
              causalPath={diagnosis?.causal_path}
              onSelectStep={handleSelectStep}
            />
          </div>

          {/* Trace Scrubber (Time Travel) */}
          <TraceScrubber
            steps={steps}
            currentStepIdx={activeStepIdx}
            onStepChange={handleSelectStep}
          />
        </div>
      </div>

      {/* Inspector Slide-Over Drawer */}
      <InspectorDrawer
        step={activeStep}
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        isRootCause={diagnosis?.root_cause_idx === activeStep?.idx}
      />
    </div>
  )
}
