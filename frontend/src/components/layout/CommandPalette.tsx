import React, { useEffect } from "react"
import { Command } from "cmdk"
import {
  Activity,
  Layers,
  Search,
  Radio,
  Play,
  FileCode,
  Zap,
} from "lucide-react"
import type { Run } from "../../types"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (page: string) => void
  onSelectRun: (runId: string) => void
  onOpenRunModal: () => void
  runs: Run[]
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onSelectRun,
  onOpenRunModal,
  runs = [],
}: CommandPaletteProps) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-background/80 backdrop-blur-sm p-4">
      <div className="fixed inset-0" onClick={() => onOpenChange(false)} />

      <Command
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-sidebar shadow-2xl overflow-hidden font-sans"
        loop
      >
        <div className="flex items-center border-b border-border px-3">
          <Command.Input
            placeholder="Type a command, jump to run, or search..."
            className="w-full h-11 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none font-mono"
            autoFocus
          />
        </div>

        <Command.List className="max-h-72 overflow-y-auto p-2 space-y-1 text-xs">
          <Command.Empty className="p-4 text-center text-xs font-mono text-muted">
            No matching actions or runs found.
          </Command.Empty>

          <Command.Group heading="Navigation" className="text-[10px] font-sans text-subtle px-2 py-1">
            <Command.Item
              onSelect={() => {
                onNavigate("overview")
                onOpenChange(false)
              }}
              className="flex items-center gap-2.5 p-2 rounded-md hover:bg-surface-raised cursor-pointer text-bone font-sans text-xs"
            >
              <Activity className="w-4 h-4 text-bone" />
              <span>Go to Overview</span>
            </Command.Item>
            <Command.Item
              onSelect={() => {
                onNavigate("provenance")
                onOpenChange(false)
              }}
              className="flex items-center gap-2.5 p-2 rounded-md hover:bg-surface-raised cursor-pointer text-bone font-sans text-xs"
            >
              <Layers className="w-4 h-4 text-bone" />
              <span>Go to Provenance Explorer</span>
            </Command.Item>
            <Command.Item
              onSelect={() => {
                onNavigate("forensics")
                onOpenChange(false)
              }}
              className="flex items-center gap-2.5 p-2 rounded-md hover:bg-surface-raised cursor-pointer text-bone font-sans text-xs"
            >
              <Search className="w-4 h-4 text-ember" />
              <span>Go to Forensics Lab</span>
            </Command.Item>
            <Command.Item
              onSelect={() => {
                onNavigate("fleet")
                onOpenChange(false)
              }}
              className="flex items-center gap-2.5 p-2 rounded-md hover:bg-surface-raised cursor-pointer text-bone font-sans text-xs"
            >
              <Radio className="w-4 h-4 text-lichen" />
              <span>Go to Fleet Intelligence</span>
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Execution & forensics" className="text-[10px] font-sans text-subtle px-2 py-1">
            <Command.Item
              onSelect={() => {
                onOpenRunModal()
                onOpenChange(false)
              }}
              className="flex items-center gap-2.5 p-2 rounded-md hover:bg-surface-raised cursor-pointer text-bone font-sans text-xs"
            >
              <Play className="w-4 h-4 text-ember fill-ember" />
              <span>Start agent run (Select fault injection)</span>
            </Command.Item>
          </Command.Group>

          {runs.length > 0 && (
            <Command.Group heading="Recent Runs" className="text-[10px] font-mono text-muted uppercase px-2 py-1">
              {runs.slice(0, 6).map((run) => (
                <Command.Item
                  key={run.id}
                  onSelect={() => {
                    onSelectRun(run.id)
                    onOpenChange(false)
                  }}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-elevated cursor-pointer text-foreground"
                >
                  <div className="flex items-center gap-2">
                    <span className={run.outcome === "failure" ? "text-status-failure" : "text-status-success"}>
                      {run.outcome === "failure" ? "✕" : "✓"}
                    </span>
                    <span className="font-mono">{run.id}</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted">{run.tenant}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  )
}
