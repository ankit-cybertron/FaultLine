import React from "react"
import { FileDiff, CheckCircle, Wrench, Sparkles } from "lucide-react"
import { cn } from "../../lib/utils"
import type { Patch } from "../../types"

interface PatchDiffViewerProps {
  patch: Patch | null
  rootCauseIdx: number | null
  className?: string
}

export function PatchDiffViewer({ patch, rootCauseIdx, className }: PatchDiffViewerProps) {
  if (!patch) {
    return (
      <div className={cn("p-6 rounded-xl border border-dashed border-border bg-panel text-center text-xs font-mono text-muted", className)}>
        No patch proposed yet. Run the Origin Test to generate a structured fix.
      </div>
    )
  }

  return (
    <div className={cn("p-4 rounded-xl border border-border bg-panel space-y-3", className)}>
      <div className="flex items-center justify-between pb-2 border-b border-hairline">
        <div className="flex items-center gap-2">
          <FileDiff className="w-4 h-4 text-bone" />
          <span className="text-xs font-sans font-medium text-bone">Structured patch proposal</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface border border-hairline text-subtle">
            {patch.kind}
          </span>
        </div>
        <span className="text-[11px] font-mono text-ochre">Target: Step #{patch.target_idx ?? rootCauseIdx}</span>
      </div>

      {/* Description Diff */}
      <div className="p-3 rounded-lg bg-surface/80 border border-hairline text-xs">
        <div className="text-[10px] font-sans text-subtle mb-1">Proposed intervention</div>
        <div className="text-bone font-medium flex items-center gap-1.5 font-mono">
          <span className="text-lichen font-bold">+</span>
          <span>{patch.diff}</span>
        </div>
      </div>

      {/* Patched Input JSON Viewer */}
      {patch.patched_input && (
        <div>
          <div className="text-[11px] font-mono text-muted mb-1 flex items-center justify-between">
            <span>Patched Replacement Input</span>
            <span className="text-[10px] text-status-success">✓ Validated Schema</span>
          </div>
          <pre className="p-3 rounded-lg bg-background border border-border text-[11px] font-mono text-status-success/90 overflow-x-auto whitespace-pre-wrap">
            {typeof patch.patched_input === "string"
              ? patch.patched_input
              : JSON.stringify(patch.patched_input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
