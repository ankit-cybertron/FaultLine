import React from "react"
import { motion, AnimatePresence } from "motion/react"
import { X, Copy, Check, Terminal, Clock, ShieldAlert } from "lucide-react"
import { cn, formatDuration, formatTime } from "../../lib/utils"
import type { Step } from "../../types"

interface InspectorDrawerProps {
  step: Step | null
  isOpen: boolean
  onClose: () => void
  isRootCause?: boolean
}

export function InspectorDrawer({ step, isOpen, onClose, isRootCause = false }: InspectorDrawerProps) {
  const [copied, setCopied] = React.useState(false)

  if (!isOpen || !step) return null

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(step, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: "100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ type: "spring", stiffness: 350, damping: 30 }}
        className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-sidebar/95 backdrop-blur-md border-l border-border z-50 flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-hairline bg-surface-raised">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-bone">
              Step #{step.idx}
            </span>
            <span className="text-xs font-sans font-medium text-subtle">{step.agent}</span>
            {isRootCause && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-ember/20 text-ember border border-ember/50">
                ⚡ Root cause
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyJson}
              className="p-1.5 rounded hover:bg-elevated text-muted hover:text-foreground text-xs font-mono flex items-center gap-1 border border-transparent hover:border-border"
              title="Copy JSON"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied" : "JSON"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-elevated text-muted hover:text-foreground border border-transparent hover:border-border"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metadata summary bar */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-panel/40 border-b border-border text-[11px] font-mono">
          <div>
            <div className="text-muted text-[10px]">TOOL / KIND</div>
            <div className="text-foreground truncate">{step.tool || step.kind}</div>
          </div>
          <div>
            <div className="text-muted text-[10px]">STATUS</div>
            <div className={cn(step.status === "error" ? "text-status-failure" : "text-status-success")}>
              {step.status}
            </div>
          </div>
          <div>
            <div className="text-muted text-[10px]">LATENCY</div>
            <div className="text-foreground tabular-nums">{formatDuration(step.duration_ms)}</div>
          </div>
        </div>

        {/* Content Viewers */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Step Inputs */}
          <div>
            <div className="text-[11px] font-sans font-medium text-subtle mb-1.5 flex items-center gap-1">
              <Terminal className="w-3 h-3 text-subtle" />
              <span>Step inputs</span>
            </div>
            <pre className="p-3 rounded-lg bg-surface border border-hairline text-[11px] font-mono text-bone overflow-x-auto whitespace-pre-wrap select-text">
              {typeof step.input === "string"
                ? step.input
                : JSON.stringify(step.input, null, 2)}
            </pre>
          </div>

          {/* Step Outputs */}
          <div>
            <div className="text-[11px] font-mono font-semibold text-muted mb-1.5 flex items-center gap-1">
              <Terminal className="w-3 h-3 text-status-success" />
              <span>STEP OUTPUTS</span>
            </div>
            <pre className="p-3 rounded-lg bg-background border border-border text-[11px] font-mono text-foreground/90 overflow-x-auto whitespace-pre-wrap select-text">
              {typeof step.output === "string"
                ? step.output
                : JSON.stringify(step.output, null, 2)}
            </pre>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
