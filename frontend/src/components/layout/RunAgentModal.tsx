import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  X,
  Play,
  Dice5,
  Upload,
  FolderOpen,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Table,
  Clock,
  DollarSign,
  Filter,
  EyeOff,
  Hash,
  Globe,
} from "lucide-react"
import { FluidTabs } from "../animata/FluidTabs"
import { AnimatedBorderTrail } from "../animata/AnimatedBorderTrail"
import { cn } from "../../lib/utils"
import { api } from "../../api/client"
import type { FaultDef } from "../../types"

interface RunAgentModalProps {
  isOpen: boolean
  onClose: () => void
  tenant: string
  onRunComplete: (runId: string) => void
}

export function RunAgentModal({
  isOpen,
  onClose,
  tenant,
  onRunComplete,
}: RunAgentModalProps) {
  const [sourceTab, setSourceTab] = useState<string>("fresh")
  const [selectedFault, setSelectedFault] = useState<string>("no_fault")
  const [seed, setSeed] = useState<number>(42)
  const [selectedTenant, setSelectedTenant] = useState<string>(tenant)
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Saved traces & upload state
  const [savedTraces, setSavedTraces] = useState<string[]>([])
  const [selectedSavedTrace, setSelectedSavedTrace] = useState<string>("")
  const [uploadJsonText, setUploadJsonText] = useState<string>("")

  useEffect(() => {
    if (isOpen) {
      setSelectedTenant(tenant)
      api.getSavedTraces().then((traces) => {
        setSavedTraces(traces)
        if (traces.length > 0) setSelectedSavedTrace(traces[0])
      }).catch(() => {})
    }
  }, [isOpen, tenant])

  if (!isOpen) return null

  const faults: FaultDef[] = [
    {
      id: "no_fault",
      name: "no_fault",
      agent: "clean baseline",
      description: "Clean execution pass with verified warehouse data and assertions.",
      severity: "low",
      root_cause_idx: null,
      example: "Baseline run",
    },
    {
      id: "wrong_table",
      name: "wrong_table",
      agent: "planner",
      description: "Planner queries sales_q2_apac instead of Q3 → empty rows caught by verifier.",
      severity: "high",
      root_cause_idx: 0,
      example: "sales_q2_apac",
    },
    {
      id: "stale_cache",
      name: "stale_cache",
      agent: "fetcher",
      description: "Fetcher returns stale cross-quarter cache payload.",
      severity: "medium",
      root_cause_idx: 1,
      example: "cache_ttl breach",
    },
    {
      id: "skip_currency",
      name: "skip_currency",
      agent: "transformer",
      description: "Transformer skips AUD/JPY→USD conversion; sums mixed currencies.",
      severity: "high",
      root_cause_idx: 2,
      example: "mixed AUD & USD",
    },
    {
      id: "bad_filter",
      name: "bad_filter",
      agent: "transformer",
      description: "Transformer date range includes Q4 data → revenue overcounted.",
      severity: "medium",
      root_cause_idx: 3,
      example: "date filter overflow",
    },
    {
      id: "verifier_blind",
      name: "verifier_blind",
      agent: "verifier",
      description: "Verifier blind-passes bad data without performing assertions.",
      severity: "high",
      root_cause_idx: 4,
      example: "blind_pass=true",
    },
    {
      id: "hallucinate_numbers",
      name: "hallucinate_numbers",
      agent: "reporter",
      description: "Reporter invents unlogged $350k bonus revenue out of thin air.",
      severity: "high",
      root_cause_idx: 5,
      example: "+$350,000 unverified",
    },
    {
      id: "hallucinate_facts",
      name: "hallucinate_facts",
      agent: "reporter",
      description: "Reporter fabricates EMEA division datacenter expansion facts.",
      severity: "medium",
      root_cause_idx: 5,
      example: "EMEA 12 enterprise accounts",
    },
  ]

  const getFaultIcon = (id: string) => {
    switch (id) {
      case "no_fault": return <CheckCircle2 className="w-4 h-4 text-status-success" />
      case "wrong_table": return <Table className="w-4 h-4 text-status-failure" />
      case "stale_cache": return <Clock className="w-4 h-4 text-amber-400" />
      case "skip_currency": return <DollarSign className="w-4 h-4 text-status-failure" />
      case "bad_filter": return <Filter className="w-4 h-4 text-amber-400" />
      case "verifier_blind": return <EyeOff className="w-4 h-4 text-status-failure" />
      case "hallucinate_numbers": return <Hash className="w-4 h-4 text-status-failure" />
      case "hallucinate_facts": return <Globe className="w-4 h-4 text-indigo-400" />
      default: return <AlertTriangle className="w-4 h-4 text-status-failure" />
    }
  }

  const handleRandomizeSeed = () => {
    setSeed(Math.floor(Math.random() * 9000) + 100)
  }

  const handleExecute = async () => {
    setIsRunning(true)
    setErrorMsg(null)

    try {
      if (sourceTab === "fresh") {
        const res = await api.runAgent({
          fault: selectedFault,
          seed,
          tenant: selectedTenant,
        })
        onRunComplete(res.run_id)
        onClose()
      } else if (sourceTab === "saved") {
        if (!selectedSavedTrace) throw new Error("Please select a saved trace file.")
        const runId = selectedSavedTrace.replace(".json", "")
        onRunComplete(runId)
        onClose()
      } else if (sourceTab === "upload") {
        if (!uploadJsonText.trim()) throw new Error("Please paste valid OTel JSON spans.")
        const parsed = JSON.parse(uploadJsonText)
        const spans = Array.isArray(parsed) ? parsed : parsed.spans
        if (!spans || !Array.isArray(spans)) throw new Error("Expected JSON array of spans or { spans: [...] }")
        const res = await api.uploadTrace(spans, undefined, selectedTenant)
        onRunComplete(res.run_id)
        onClose()
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to execute pipeline")
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-end bg-background/80 backdrop-blur-sm">
        <div className="fixed inset-0" onClick={onClose} />

        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
          className="relative z-10 w-full max-w-xl h-full bg-sidebar border-l border-border flex flex-col shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 border-b border-border bg-panel flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent-blue/15 border border-accent-blue/40 flex items-center justify-center text-accent-blue">
                <Play className="w-4 h-4 fill-accent-blue" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">EXECUTE AGENT RUN</h2>
                <p className="text-[11px] font-mono text-muted">
                  Instrumented Pipeline · Multi-Agent Data Warehouse
                </p>
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

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Source Mode Fluid Tabs */}
            <FluidTabs
              tabs={[
                { id: "fresh", label: "Fresh Run" },
                { id: "saved", label: "Saved Trace", badge: savedTraces.length },
                { id: "upload", label: "Upload JSON" },
              ]}
              activeId={sourceTab}
              onChange={setSourceTab}
            />

            {/* Tenant Selection & Seed */}
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-panel/60">
              <div>
                <label className="text-[10px] font-mono text-muted uppercase block mb-1">
                  Tenant Graph
                </label>
                <select
                  value={selectedTenant}
                  onChange={(e) => setSelectedTenant(e.target.value)}
                  className="w-full bg-sidebar border border-border text-foreground text-xs rounded px-2.5 py-1.5 font-mono focus:outline-none focus:border-accent-blue"
                >
                  <option value="demo_agent">demo_agent</option>
                  <option value="fleet">fleet</option>
                  <option value="trail">trail</option>
                  <option value="whowhen">whowhen</option>
                </select>
              </div>

              {sourceTab === "fresh" && (
                <div>
                  <label className="text-[10px] font-mono text-muted uppercase block mb-1">
                    RNG Seed
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(Number(e.target.value))}
                      className="w-full bg-sidebar border border-border text-foreground text-xs rounded px-2.5 py-1.5 font-mono focus:outline-none focus:border-accent-blue"
                    />
                    <button
                      type="button"
                      onClick={handleRandomizeSeed}
                      className="p-1.5 rounded bg-sidebar hover:bg-elevated border border-border text-muted hover:text-foreground"
                      title="Randomize seed"
                    >
                      <Dice5 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* TAB 1: Fresh Run with Fault Injection Cards */}
            {sourceTab === "fresh" && (
              <div className="space-y-2">
                <div className="text-[11px] font-mono text-muted uppercase flex items-center justify-between">
                  <span>Select Fault Injection ({faults.length})</span>
                  <span>{selectedFault === "no_fault" ? "Clean Run" : "Fault Seeded"}</span>
                </div>

                <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto pr-1">
                  {faults.map((f) => {
                    const isSelected = selectedFault === f.id
                    const isClean = f.id === "no_fault"

                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedFault(f.id)}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all select-none flex items-start gap-3",
                          isSelected
                            ? isClean
                              ? "border-status-success bg-status-success/10 shadow-sm"
                              : "border-status-failure bg-status-failure/10 shadow-[0_0_10px_rgba(248,113,113,0.2)]"
                            : "border-border bg-panel hover:bg-elevated hover:border-border/80"
                        )}
                      >
                        <div className="p-1.5 rounded border border-border bg-sidebar mt-0.5 shrink-0">
                          {getFaultIcon(f.id)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="font-mono text-xs font-bold text-foreground">
                              {f.name}
                            </span>
                            <span
                              className={cn(
                                "text-[9px] font-mono px-1.5 py-0.2 rounded border uppercase",
                                f.severity === "high"
                                  ? "text-status-failure border-status-failure/40 bg-status-failure/10"
                                  : f.severity === "medium"
                                  ? "text-amber-400 border-amber-400/40 bg-amber-400/10"
                                  : "text-status-success border-status-success/40 bg-status-success/10"
                              )}
                            >
                              {f.severity}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted leading-tight">{f.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: Saved Trace Picker */}
            {sourceTab === "saved" && (
              <div className="space-y-3">
                <div className="text-[11px] font-mono text-muted uppercase">
                  Select Existing OTel Trace File
                </div>
                {savedTraces.length === 0 ? (
                  <div className="p-6 rounded-lg border border-dashed border-border text-center text-xs font-mono text-muted">
                    No traces found in data/otel/. Generate a fresh run above first.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {savedTraces.map((traceFile) => {
                      const isSelected = selectedSavedTrace === traceFile
                      return (
                        <button
                          key={traceFile}
                          type="button"
                          onClick={() => setSelectedSavedTrace(traceFile)}
                          className={cn(
                            "w-full p-2.5 rounded-lg border text-left font-mono text-xs flex items-center justify-between",
                            isSelected
                              ? "border-accent-blue bg-elevated text-foreground"
                              : "border-border bg-panel text-muted hover:text-foreground"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <FolderOpen className="w-3.5 h-3.5 text-accent-blue" />
                            <span>{traceFile}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Upload JSON */}
            {sourceTab === "upload" && (
              <div className="space-y-2">
                <div className="text-[11px] font-mono text-muted uppercase">
                  Paste Raw OpenTelemetry Span Array
                </div>
                <textarea
                  rows={8}
                  value={uploadJsonText}
                  onChange={(e) => setUploadJsonText(e.target.value)}
                  placeholder="[{ 'traceId': '...', 'name': 'fetcher/tool_call', 'status': { 'code': 'STATUS_CODE_OK' } }]"
                  className="w-full p-3 rounded-lg bg-background border border-border text-xs font-mono text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent-blue"
                />
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-status-failure/15 border border-status-failure/40 text-xs font-mono text-status-failure">
                ✕ Error: {errorMsg}
              </div>
            )}
          </div>

          {/* Footer Action */}
          <div className="p-4 border-t border-border bg-panel flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md hover:bg-elevated border border-border text-xs font-mono text-muted"
            >
              Cancel
            </button>

            <AnimatedBorderTrail
              trailColor="ember"
              duration="3s"
              active={!isRunning}
            >
              <button
                type="button"
                onClick={handleExecute}
                disabled={isRunning}
                className="px-5 py-2 rounded-md bg-ember text-basalt font-medium text-xs transition-opacity hover:opacity-95 disabled:opacity-50 flex items-center gap-2"
              >
                {isRunning ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-basalt border-t-transparent rounded-full animate-spin" />
                    <span>Executing pipeline...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-basalt" />
                    <span>Execute run</span>
                  </>
                )}
              </button>
            </AnimatedBorderTrail>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
