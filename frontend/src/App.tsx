import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Sidebar } from "./components/layout/Sidebar"
import { TopBar } from "./components/layout/TopBar"
import { CommandPalette } from "./components/layout/CommandPalette"
import { RunAgentModal } from "./components/layout/RunAgentModal"
import { OverviewPage } from "./pages/OverviewPage"
import { ProvenancePage } from "./pages/ProvenancePage"
import { ForensicsPage } from "./pages/ForensicsPage"
import { FleetPage } from "./pages/FleetPage"
import { LiveChatPage } from "./pages/LiveChatPage"
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts"
import { api } from "./api/client"
import type { Run, RunDetail, Diagnosis, ProvenanceFlow, GraphElements, FleetSummary, Step } from "./types"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function FaultLineApp() {
  const qc = useQueryClient()

  // App Navigation & Tenant State - Default to Live Chat for interactive decision flow
  const [activePage, setActivePage] = useState<string>("chat")
  const [tenant, setTenant] = useState<string>("demo_agent")
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(true)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0)

  // Modals & Drawers
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false)
  const [runModalOpen, setRunModalOpen] = useState<boolean>(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState<boolean>(false)

  // 1. Health Query
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.getHealth(),
    refetchInterval: 10000,
  })

  // 2. Runs List Query
  const { data: runs = [], refetch: refetchRuns } = useQuery<Run[]>({
    queryKey: ["runs", tenant],
    queryFn: () => api.getRuns(tenant),
  })

  // Set default active run when list arrives
  useEffect(() => {
    if (!activeRunId && runs.length > 0) {
      // Pick first failing run if available, else first run
      const failRun = runs.find((r) => r.outcome === "failure")
      setActiveRunId(failRun ? failRun.id : runs[0].id)
    }
  }, [runs, activeRunId])

  // 3. Active Run Detail Query
  const { data: activeRun } = useQuery<RunDetail | null>({
    queryKey: ["run", activeRunId, tenant],
    queryFn: () => (activeRunId ? api.getRun(activeRunId, tenant) : Promise.resolve(null)),
    enabled: Boolean(activeRunId),
  })

  // 4. Provenance Query
  const { data: provenance } = useQuery<ProvenanceFlow | null>({
    queryKey: ["provenance", activeRunId, tenant],
    queryFn: () => (activeRunId ? api.getProvenance(activeRunId, tenant) : Promise.resolve(null)),
    enabled: Boolean(activeRunId),
  })

  // 5. Graph Elements Query
  const { data: graphData } = useQuery<GraphElements | null>({
    queryKey: ["graph", activeRunId, tenant],
    queryFn: () => (activeRunId ? api.getGraph(activeRunId, tenant) : Promise.resolve(null)),
    enabled: Boolean(activeRunId),
  })

  // 6. Diagnosis Query (Auto-run or cached)
  const { data: diagnosis, refetch: refetchDiagnosis, isFetching: isInvestigating } = useQuery<Diagnosis | null>({
    queryKey: ["diagnosis", activeRunId, tenant],
    queryFn: () => (activeRunId ? api.investigate(activeRunId, tenant) : Promise.resolve(null)),
    enabled: Boolean(activeRunId && (activeRun?.outcome === "failure" || activePage === "forensics")),
  })

  // 7. Fleet Summary Query
  const { data: fleetSummary, refetch: refetchFleet } = useQuery<FleetSummary>({
    queryKey: ["fleet", tenant],
    queryFn: () => api.getFleetSummary(tenant),
  })

  // Mutations
  const verifyClaimsMutation = useMutation({
    mutationFn: () => (activeRunId ? api.verifyClaims(activeRunId, tenant) : Promise.resolve([])),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provenance", activeRunId, tenant] })
    },
  })

  const replayMutation = useMutation({
    mutationFn: () =>
      activeRunId && diagnosis?.patch
        ? api.replay(activeRunId, diagnosis.patch, tenant)
        : Promise.reject(new Error("No patch available")),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["diagnosis", activeRunId, tenant] })
    },
  })

  const syntheticFleetMutation = useMutation({
    mutationFn: () => api.generateFleetBatch(tenant),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet", tenant] })
      qc.invalidateQueries({ queryKey: ["runs", tenant] })
    },
  })

  // Active steps list
  const steps: Step[] = provenance?.flow || activeRun?.steps || []

  // Keyboard navigation
  useKeyboardShortcuts({
    onNextStep: () => {
      if (steps.length > 0) {
        setActiveStepIdx((prev) => Math.min(steps.length - 1, prev + 1))
      }
    },
    onPrevStep: () => {
      setActiveStepIdx((prev) => Math.max(0, prev - 1))
    },
    onFocusClaims: () => {
      setActivePage("provenance")
    },
    onToggleInspector: () => {
      setActivePage("provenance")
    },
    onOpenCommandPalette: () => {
      setCommandPaletteOpen(true)
    },
    onShowShortcutsHelp: () => {
      setShortcutsHelpOpen(true)
    },
  })

  const handleRefresh = () => {
    refetchRuns()
    qc.invalidateQueries({ queryKey: ["run", activeRunId, tenant] })
    qc.invalidateQueries({ queryKey: ["provenance", activeRunId, tenant] })
    qc.invalidateQueries({ queryKey: ["graph", activeRunId, tenant] })
    refetchDiagnosis()
    refetchFleet()
  }

  const handleSelectRun = (runId: string) => {
    setActiveRunId(runId)
    setActiveStepIdx(0)
  }

  const handleNavigateRun = (runId: string, page: "provenance" | "forensics") => {
    setActiveRunId(runId)
    setActiveStepIdx(0)
    setActivePage(page)
  }

  const getPageTitle = () => {
    switch (activePage) {
      case "overview": return "Agent Observability"
      case "provenance": return "Provenance Explorer"
      case "forensics": return "Forensics Lab"
      case "fleet": return "Fleet Intelligence"
      default: return "FaultLine"
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        tenant={tenant}
        onTenantChange={(t) => {
          setTenant(t)
          setActiveRunId(null)
        }}
        runs={runs}
        activeRunId={activeRunId}
        onSelectRun={handleSelectRun}
        health={health || null}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* TopBar */}
        <TopBar
          pageTitle={getPageTitle()}
          activeRunId={activeRunId}
          onRefresh={handleRefresh}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenRunModal={() => setRunModalOpen(true)}
        />

        {/* Page Views with 180ms fade-and-rise between routes */}
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="w-full h-full"
            >
              {activePage === "chat" && <LiveChatPage />}

              {activePage === "overview" && (
                <OverviewPage
                  runs={runs}
                  activeRun={activeRun || null}
                  diagnosis={diagnosis || null}
                  onNavigate={setActivePage}
                  onSelectRun={handleSelectRun}
                  onOpenRunModal={() => setRunModalOpen(true)}
                />
              )}


              {activePage === "provenance" && (
                <ProvenancePage
                  runId={activeRunId || ""}
                  provenance={provenance || null}
                  graphData={graphData || null}
                  diagnosis={diagnosis || null}
                  activeStepIdx={activeStepIdx}
                  onSelectStep={setActiveStepIdx}
                  onVerifyClaims={() => verifyClaimsMutation.mutate()}
                  isVerifyingClaims={verifyClaimsMutation.isPending}
                />
              )}

              {activePage === "forensics" && (
                <ForensicsPage
                  runId={activeRunId || ""}
                  diagnosis={diagnosis || null}
                  steps={steps}
                  runs={runs}
                  onSelectRun={handleSelectRun}
                  onRunInvestigate={() => refetchDiagnosis()}
                  isInvestigating={isInvestigating}
                  onRunReplay={() => replayMutation.mutate()}
                  isReplaying={replayMutation.isPending}
                />
              )}

              {activePage === "fleet" && (
                <FleetPage
                  summary={fleetSummary || null}
                  onGenerateSynthetic={() => syntheticFleetMutation.mutate()}
                  isGeneratingSynthetic={syntheticFleetMutation.isPending}
                  onNavigateRun={handleNavigateRun}
                  onRefresh={refetchFleet}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Modals & Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onNavigate={setActivePage}
        onSelectRun={handleSelectRun}
        onOpenRunModal={() => setRunModalOpen(true)}
        runs={runs}
      />

      <RunAgentModal
        isOpen={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        tenant={tenant}
        onRunComplete={(newRunId) => {
          handleSelectRun(newRunId)
          refetchRuns()
          setActivePage("provenance")
        }}
      />

      {/* Keyboard Shortcuts Cheatsheet Modal */}
      {shortcutsHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="fixed inset-0" onClick={() => setShortcutsHelpOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-sidebar p-5 space-y-4 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="font-bold text-foreground">KEYBOARD SHORTCUTS</span>
              <button
                type="button"
                onClick={() => setShortcutsHelpOpen(false)}
                className="text-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-foreground/90">
              <div className="flex justify-between">
                <span>Next step</span>
                <kbd className="px-1.5 py-0.5 rounded bg-panel border border-border text-muted">j</kbd>
              </div>
              <div className="flex justify-between">
                <span>Previous step</span>
                <kbd className="px-1.5 py-0.5 rounded bg-panel border border-border text-muted">k</kbd>
              </div>
              <div className="flex justify-between">
                <span>Focus claims</span>
                <kbd className="px-1.5 py-0.5 rounded bg-panel border border-border text-muted">c</kbd>
              </div>
              <div className="flex justify-between">
                <span>Toggle inspector</span>
                <kbd className="px-1.5 py-0.5 rounded bg-panel border border-border text-muted">i</kbd>
              </div>
              <div className="flex justify-between">
                <span>Command palette</span>
                <kbd className="px-1.5 py-0.5 rounded bg-panel border border-border text-muted">⌘K / Ctrl+K</kbd>
              </div>
              <div className="flex justify-between">
                <span>Show shortcuts help</span>
                <kbd className="px-1.5 py-0.5 rounded bg-panel border border-border text-muted">?</kbd>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FaultLineApp />
    </QueryClientProvider>
  )
}
