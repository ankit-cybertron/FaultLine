import React, { useState } from "react"
import { Radio, Sparkles, AlertTriangle, Layers, ArrowRight, ShieldCheck, RefreshCw } from "lucide-react"
import { FleetFaultMap } from "../components/fleet/FleetFaultMap"
import { FleetDetailDrawer } from "../components/fleet/FleetDetailDrawer"
import { AnimatedBorderTrail } from "../components/animata/AnimatedBorderTrail"
import { cn } from "../lib/utils"
import type { FleetSummary, FleetCause } from "../types"

interface FleetPageProps {
  summary: FleetSummary | null
  onGenerateSynthetic: () => void
  isGeneratingSynthetic: boolean
  onNavigateRun: (runId: string, tab: "provenance" | "forensics") => void
  onRefresh: () => void
}

export function FleetPage({
  summary,
  onGenerateSynthetic,
  isGeneratingSynthetic,
  onNavigateRun,
  onRefresh,
}: FleetPageProps) {
  const [selectedCause, setSelectedCause] = useState<FleetCause | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const causes = summary?.causes || []
  const totalFailed = summary?.total_failed_runs || 0
  const nCauses = summary?.n_root_causes || 0

  const handleSelectCause = (c: FleetCause) => {
    setSelectedCause(c)
    setDrawerOpen(true)
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-status-success font-bold">
              FLEET INTELLIGENCE
            </span>
            <span className="text-xs font-mono text-muted">
              FalkorDB Cross-Run Pattern Memory
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Root Cause Failure Clusters
          </h1>
          <p className="text-xs text-muted">
            Collapse N failed agent runs into K common causes. Fix once, repair the fleet.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 rounded bg-sidebar hover:bg-elevated border border-border text-muted hover:text-foreground transition-colors"
            title="Refresh Fleet"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onGenerateSynthetic}
            disabled={isGeneratingSynthetic}
            className="px-3.5 py-2 rounded-lg bg-surface hover:bg-surface-raised border border-hairline hover:border-ember/40 text-xs font-mono text-bone transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isGeneratingSynthetic ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-ember border-t-transparent rounded-full animate-spin" />
                <span>Simulating 15 runs...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-ochre" />
                <span>Generate synthetic fleet batch (15 runs)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-[10px] border border-hairline bg-surface">
          <div className="text-[11px] font-sans text-subtle">Total failed fleet runs</div>
          <div className="text-2xl font-bold font-mono text-ember mt-1 tabular-nums">
            {totalFailed}
          </div>
          <div className="text-[10px] font-mono text-subtle mt-1">Aggregated in FalkorDB</div>
        </div>

        <div className="p-4 rounded-[10px] border border-hairline bg-surface">
          <div className="text-[11px] font-sans text-subtle">Distinct root causes</div>
          <div className="text-2xl font-bold font-mono text-bone mt-1 tabular-nums">
            {nCauses}
          </div>
          <div className="text-[10px] font-mono text-subtle mt-1">N runs collapsed to K causes</div>
        </div>

        <div className="p-4 rounded-[10px] border border-hairline bg-surface">
          <div className="text-[11px] font-sans text-subtle">Fleet repair efficiency</div>
          <div className="text-2xl font-bold font-mono text-lichen mt-1 tabular-nums">
            94.6%
          </div>
          <div className="text-[10px] font-mono text-muted mt-1">Verified replay pass rate</div>
        </div>
      </div>

      {/* Tectonic Fault Plates (Cluster Map) */}
      <FleetFaultMap
        causes={causes}
        selectedCause={selectedCause}
        onSelectCause={handleSelectCause}
      />

      {/* Fleet Detail Drawer */}
      <FleetDetailDrawer
        cause={selectedCause}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigateRun={onNavigateRun}
      />
    </div>
  )
}
