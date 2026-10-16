import React from "react"
import { CheckCircle2, AlertTriangle, FileText, Sparkles } from "lucide-react"
import { cn } from "../../lib/utils"
import type { Claim } from "../../types"

interface AnnotatedAnswerProps {
  runId: string
  answerText: string
  claims: Claim[]
  onHoverClaim?: (claim: Claim | null, el: HTMLElement | null) => void
  onSelectStep?: (idx: number) => void
  className?: string
}

export function AnnotatedAnswer({
  runId,
  answerText,
  claims = [],
  onHoverClaim,
  onSelectStep,
  className,
}: AnnotatedAnswerProps) {
  // Identify key sentences or segments matching claims to underline inline
  const hasUnsupported = claims.some((c) => !c.supported)

  return (
    <div className={cn("p-4 rounded-xl border border-border bg-panel relative overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-hairline text-xs font-sans">
        <div className="flex items-center gap-1.5 text-bone">
          <FileText className="w-3.5 h-3.5" />
          <span className="font-medium text-bone">Delivered answer receipt</span>
        </div>
        <span className="font-mono text-subtle text-[11px]">{runId}</span>
      </div>

      {/* Answer Body with Claim Annotation */}
      <div className="p-3.5 rounded-lg bg-sidebar/80 border border-border/60 text-sm text-foreground/95 leading-relaxed font-sans relative">
        <p className="mb-2">
          {answerText || "No text summary emitted by reporter."}
        </p>

        {/* Inline Claim Underline Legend */}
        <div className="pt-2 border-t border-border/40 flex items-center gap-3 text-[10px] font-mono text-muted">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-status-success rounded" /> Supported
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-status-failure border-b border-dashed border-status-failure rounded" /> Unsupported
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-muted/50 border-b border-dotted rounded" /> Unverified
          </span>
        </div>
      </div>

      {/* Verified Claim Badges Overview */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasUnsupported ? (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-status-failure/15 text-status-failure border border-status-failure/30 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> UNGROUNDED CLAIM DETECTED
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-status-success/15 text-status-success border border-status-success/30 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> ALL CLAIMS GROUNDED IN FLOW
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono text-muted">
          {claims.filter((c) => c.supported).length}/{claims.length} verified
        </span>
      </div>
    </div>
  )
}
