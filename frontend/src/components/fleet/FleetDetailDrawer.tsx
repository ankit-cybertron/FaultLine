import React from "react"
import { motion, AnimatePresence } from "motion/react"
import { X, ArrowRight, ExternalLink, ShieldCheck, Activity } from "lucide-react"
import { ClusterGlyph } from "../seismic/ClusterGlyph"
import { cn } from "../../lib/utils"
import type { FleetCause } from "../../types"

interface FleetDetailDrawerProps {
  cause: FleetCause | null
  isOpen: boolean
  onClose: () => void
  onNavigateRun: (runId: string, tab: "provenance" | "forensics") => void
}

export function FleetDetailDrawer({
  cause,
  isOpen,
  onClose,
  onNavigateRun,
}: FleetDetailDrawerProps) {
  if (!isOpen || !cause) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: "100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ type: "spring", stiffness: 350, damping: 30 }}
        className="fixed top-0 right-0 bottom-0 w-full max-w-lg bg-sidebar/95 backdrop-blur-md border-l border-border z-50 flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-panel">
          <div className="flex items-center gap-2.5">
            <ClusterGlyph signature={cause.cause} size={32} />
            <div>
              <div className="font-mono text-xs font-bold text-foreground truncate max-w-[280px]">
                {cause.cause}
              </div>
              <div className="text-[10px] font-mono text-muted">
                {cause.runs} affected runs grouped in FalkorDB
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-elevated text-muted hover:text-foreground border border-transparent hover:border-border"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Fix Summary Card */}
          <div className="p-3.5 rounded-lg border border-border bg-panel/80 space-y-2">
            <div className="text-[10px] font-mono text-muted uppercase">Recommended Fleet Fix</div>
            <div className="text-sm font-medium text-foreground">{cause.fix_summary}</div>
            <div className="flex items-center gap-2 pt-2 border-t border-border/40 text-[11px] font-mono text-status-success">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Historical Replay Pass Rate: {Math.round((cause.success_rate ?? 1) * 100)}%</span>
            </div>
          </div>

          {/* Affected Run IDs Ledger */}
          <div>
            <div className="flex items-center justify-between mb-2 text-xs font-mono text-muted">
              <span>Affected Runs ({cause.run_ids.length})</span>
              <span>Inspect Run</span>
            </div>

            <div className="space-y-1.5">
              {cause.run_ids.map((runId) => (
                <div
                  key={runId}
                  className="p-2.5 rounded-[8px] border border-hairline bg-surface flex items-center justify-between gap-2 hover:border-bone/30 transition-colors"
                >
                  <div className="flex items-center gap-2 font-mono text-xs text-bone">
                    <Activity className="w-3.5 h-3.5 text-ember" />
                    <span>{runId}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onNavigateRun(runId, "provenance")}
                      className="px-2 py-0.5 rounded bg-surface-raised hover:bg-surface border border-hairline hover:border-bone/30 text-[10px] font-mono text-bone transition-colors flex items-center gap-1"
                    >
                      <span>Provenance</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateRun(runId, "forensics")}
                      className="px-2 py-0.5 rounded bg-ember/10 hover:bg-ember/20 border border-ember/30 text-[10px] font-mono text-ember transition-colors flex items-center gap-1"
                    >
                      <span>Forensics</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
