import React from "react"
import { Handle, Position } from "@xyflow/react"
import {
  MessageSquare,
  Database,
  GitFork,
  Wrench,
  CheckCircle2,
  XCircle,
  Brain,
  Bot,
  AlertCircle,
  Loader2,
  Sparkles,
  Info,
  Split,
} from "lucide-react"
import { cn } from "../../lib/utils"

export interface DecisionNodeData {
  idx: number
  kind: string
  tool?: string | null
  input: any
  output: any
  status: string
  ts?: number
  isSelected?: boolean
  isActive?: boolean
  // Candidate / decision specific
  label?: string
  description?: string
  confidence?: number
  chosen?: boolean
  reason?: string
  favored_by?: string[]
  decision_idx?: number
}

export function VerticalDecisionNode({ data }: { data: DecisionNodeData }) {
  const isSelected = data.isSelected
  const isActive = data.isActive
  const isError = data.status === "error"

  let parsedInput: any = data.input
  let parsedOutput: any = data.output

  if (typeof parsedInput === "string") {
    try {
      parsedInput = JSON.parse(parsedInput)
    } catch {
      // keep string
    }
  }
  if (typeof parsedOutput === "string") {
    try {
      parsedOutput = JSON.parse(parsedOutput)
    } catch {
      // keep string
    }
  }

  // Determine chosen status for candidate
  const isCandidate = data.kind === "candidate"
  const isCandidateChosen = isCandidate && Boolean(
    parsedOutput?.chosen ?? data.chosen ?? (parsedInput?.chosen)
  )

  const getKindConfig = () => {
    switch (data.kind) {
      case "chat_input":
        return {
          title: "User Prompt",
          icon: <MessageSquare className="w-4 h-4 text-sky-400" />,
          borderColor: "border-sky-500/60",
          headerBg: "bg-sky-950/80 text-sky-200",
          badgeColor: "bg-sky-500/30 text-sky-300 border border-sky-400/50",
          glow: "shadow-[0_0_15px_rgba(56,189,248,0.25)]",
        }
      case "context_selection":
        return {
          title: "Context & Memory Selection",
          icon: <Database className="w-4 h-4 text-purple-400" />,
          borderColor: "border-purple-500/60",
          headerBg: "bg-purple-950/80 text-purple-200",
          badgeColor: "bg-purple-500/30 text-purple-300 border border-purple-400/50",
          glow: "shadow-[0_0_15px_rgba(168,85,247,0.25)]",
        }
      case "router":
        return {
          title: "Router Decision (Groq LLM)",
          icon: <GitFork className="w-4 h-4 text-amber-400" />,
          borderColor: "border-amber-500/60",
          headerBg: "bg-amber-950/80 text-amber-200",
          badgeColor: "bg-amber-500/30 text-amber-300 border border-amber-400/50",
          glow: "shadow-[0_0_18px_rgba(245,158,11,0.3)]",
        }
      case "decision":
        return {
          title: "Disambiguation Decision",
          icon: <Split className="w-4 h-4 text-amber-400" />,
          borderColor: "border-amber-500/70",
          headerBg: "bg-amber-950/90 text-amber-200",
          badgeColor: "bg-amber-500/30 text-amber-300 border border-amber-400/50",
          glow: "shadow-[0_0_20px_rgba(245,158,11,0.35)]",
        }
      case "candidate":
        return {
          title: isCandidateChosen ? "Chosen Interpretation" : "Alternative Branch",
          icon: isCandidateChosen ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <Sparkles className="w-4 h-4 text-slate-400" />
          ),
          borderColor: isCandidateChosen ? "border-emerald-500/80" : "border-slate-700/60 border-dashed",
          headerBg: isCandidateChosen ? "bg-emerald-950/90 text-emerald-200" : "bg-slate-900/60 text-slate-400",
          badgeColor: isCandidateChosen
            ? "bg-emerald-500/30 text-emerald-300 border border-emerald-400/50 font-bold"
            : "bg-slate-800/80 text-slate-400 border border-slate-700 font-mono",
          glow: isCandidateChosen ? "shadow-[0_0_20px_rgba(16,185,129,0.35)]" : "shadow-none",
        }
      case "tool_call":
        return {
          title: "Tool Invocation",
          icon: <Wrench className="w-4 h-4 text-emerald-400" />,
          borderColor: "border-emerald-500/60",
          headerBg: "bg-emerald-950/80 text-emerald-200",
          badgeColor: "bg-emerald-500/30 text-emerald-300 border border-emerald-400/50",
          glow: "shadow-[0_0_15px_rgba(16,185,129,0.25)]",
        }
      case "tool_result":
        return {
          title: "Execution Result",
          icon: <CheckCircle2 className="w-4 h-4 text-teal-400" />,
          borderColor: "border-teal-500/60",
          headerBg: "bg-teal-950/80 text-teal-200",
          badgeColor: "bg-teal-500/30 text-teal-300 border border-teal-400/50",
          glow: "shadow-[0_0_15px_rgba(20,184,166,0.25)]",
        }
      case "synthesis":
        return {
          title: "LLM Answer Synthesis",
          icon: <Brain className="w-4 h-4 text-indigo-400" />,
          borderColor: "border-indigo-500/60",
          headerBg: "bg-indigo-950/80 text-indigo-200",
          badgeColor: "bg-indigo-500/30 text-indigo-300 border border-indigo-400/50",
          glow: "shadow-[0_0_15px_rgba(99,102,241,0.25)]",
        }
      case "chat_output":
        return {
          title: "Final Verified Output",
          icon: <Bot className="w-4 h-4 text-lime-400" />,
          borderColor: "border-lime-500/60",
          headerBg: "bg-lime-950/80 text-lime-200",
          badgeColor: "bg-lime-500/30 text-lime-300 border border-lime-400/50",
          glow: "shadow-[0_0_18px_rgba(132,204,22,0.3)]",
        }
      default:
        return {
          title: data.kind || "Step",
          icon: <Sparkles className="w-4 h-4 text-slate-300" />,
          borderColor: "border-slate-700",
          headerBg: "bg-slate-900 text-slate-200",
          badgeColor: "bg-slate-800 text-slate-300 border border-slate-700",
          glow: "shadow-none",
        }
    }
  }

  const config = getKindConfig()

  // Format summary label with rich contrast
  const renderSummary = () => {
    if (data.kind === "chat_input") {
      const text = typeof parsedInput === "string" ? parsedInput : (parsedInput?.user_msg || JSON.stringify(parsedInput))
      return (
        <div className="space-y-1">
          <div className="text-[11px] font-mono text-sky-400 uppercase tracking-wider font-semibold">User Query</div>
          <div className="p-2.5 rounded bg-black/60 border border-sky-500/20 text-xs font-sans text-slate-100 font-medium leading-relaxed break-words shadow-inner">
            "{text}"
          </div>
        </div>
      )
    }

    if (data.kind === "decision") {
      const ambiguous = Boolean(parsedOutput?.ambiguous)
      const chosenLabel = parsedOutput?.chosen || "default"
      const candidateList = parsedOutput?.candidates || []
      const influence = parsedOutput?.measured_influence

      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase tracking-wider",
                ambiguous
                  ? "bg-amber-500/20 text-amber-300 border border-amber-400/40"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
              )}
            >
              {ambiguous ? `Ambiguous (${candidateList.length} options)` : "Unambiguous"}
            </span>
            <span className="text-[11px] font-mono text-slate-300">
              Chosen: <strong className="text-amber-300">{chosenLabel}</strong>
            </span>
          </div>

          {influence && (
            <div className="p-2 rounded bg-amber-950/40 border border-amber-500/30 text-[10px] font-mono text-amber-200 leading-relaxed">
              {influence}
            </div>
          )}

          {/* Prompt requirement: subtle line under decision node */}
          <div className="text-[10px] text-slate-400 italic pt-1.5 border-t border-white/10 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Interpretations the model listed when asked. Not its hidden reasoning.</span>
          </div>
        </div>
      )
    }

    if (data.kind === "candidate") {
      const label = parsedOutput?.label || parsedInput?.label || data.label || "Candidate"
      const description = parsedOutput?.description || data.description || ""
      const reason = parsedOutput?.reason || data.reason || ""
      const confidenceVal = parsedOutput?.confidence ?? data.confidence ?? 0.5
      const confPct = Math.round(confidenceVal * 100)
      const favoredBy = parsedOutput?.favored_by || data.favored_by || []

      return (
        <div className="space-y-2">
          {/* Header pill & confidence */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-white tracking-wide truncate">
              {label}
            </div>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 flex items-center gap-1",
                isCandidateChosen
                  ? "bg-emerald-500/25 text-emerald-300 border border-emerald-400/50"
                  : "bg-black/50 text-slate-400 border border-white/10 font-mono"
              )}
            >
              {isCandidateChosen ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>CHOSEN</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3 text-slate-500" />
                  <span>NOT TAKEN</span>
                </>
              )}
            </span>
          </div>

          {/* Confidence bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">Confidence</span>
              <span className={isCandidateChosen ? "text-emerald-300 font-bold" : "text-slate-400"}>
                {confPct}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-black/60 overflow-hidden border border-white/10">
              <div
                className={cn(
                  "h-full transition-all duration-300",
                  isCandidateChosen ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-slate-600"
                )}
                style={{ width: `${confPct}%` }}
              />
            </div>
          </div>

          {description && (
            <div className="text-xs text-slate-200 font-sans leading-relaxed">
              {description}
            </div>
          )}

          {reason && (
            <div className="p-2 rounded bg-black/50 border border-white/10 text-[10px] font-sans text-slate-300 italic">
              <span className="font-mono text-amber-400 not-italic mr-1">Why:</span>
              {reason}
            </div>
          )}

          {favoredBy && favoredBy.length > 0 && favoredBy[0] !== "none" && (
            <div className="flex items-center gap-1 text-[10px] font-mono text-purple-300 bg-purple-950/40 px-2 py-1 rounded border border-purple-500/20">
              <Database className="w-3 h-3 text-purple-400 shrink-0" />
              <span className="truncate">Favored by: {favoredBy.join(", ")}</span>
            </div>
          )}
        </div>
      )
    }

    if (data.kind === "router") {
      const decision = parsedOutput?.decision || "direct_answer"
      const toolName = parsedOutput?.tool
      const reason = parsedOutput?.reason || "Routed based on user intent"
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase tracking-wider",
                decision === "tool_call"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                  : "bg-sky-500/20 text-sky-300 border border-sky-400/40"
              )}
            >
              Decision: {decision === "tool_call" ? `Tool ➔ ${toolName}` : "Direct Conversational Answer"}
            </span>
          </div>
          <div className="p-2 rounded bg-black/60 border border-amber-500/20 text-[11px] font-sans text-slate-200 leading-relaxed shadow-inner">
            <span className="text-amber-400 font-semibold font-mono mr-1">Rationale:</span>
            {reason}
          </div>
        </div>
      )
    }

    if (data.kind === "tool_call") {
      const argsStr = typeof parsedInput === "object" ? JSON.stringify(parsedInput, null, 2) : String(parsedInput)
      return (
        <div className="space-y-1.5">
          <div className="text-[11px] font-mono text-emerald-400 flex items-center justify-between font-semibold">
            <span>TOOL: {data.tool || "calculator"}</span>
            <span className="text-[10px] text-emerald-300/80 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30">INVOKED</span>
          </div>
          <pre className="p-2 rounded bg-black/70 border border-emerald-500/20 text-[11px] font-mono text-emerald-200 max-h-24 overflow-x-auto shadow-inner leading-tight">
            {argsStr}
          </pre>
        </div>
      )
    }

    if (data.kind === "tool_result") {
      const resultText = parsedOutput?.result || (typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput, null, 2))
      const latency = parsedOutput?.latency_s
      return (
        <div className="space-y-1.5">
          <div className="text-[11px] font-mono text-teal-400 flex items-center justify-between font-semibold">
            <span>RESULT</span>
            {latency !== undefined && (
              <span className="text-[10px] text-teal-300 font-mono bg-teal-950/60 px-1.5 py-0.2 rounded border border-teal-500/30">
                {(latency * 1000).toFixed(1)}ms
              </span>
            )}
          </div>
          <pre className="p-2 rounded bg-black/70 border border-teal-500/20 text-[11px] font-mono text-teal-200 max-h-24 overflow-x-auto shadow-inner leading-tight break-all">
            {String(resultText)}
          </pre>
        </div>
      )
    }

    if (data.kind === "context_selection") {
      const kept = parsedInput?.kept ?? 0
      const reason = parsedInput?.reason || "History analyzed"
      return (
        <div className="p-2.5 rounded bg-black/60 border border-purple-500/20 text-xs font-mono text-purple-200 space-y-1 shadow-inner">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-sans">Retained turns:</span>
            <span className="font-bold text-purple-300 bg-purple-900/60 px-1.5 py-0.2 rounded border border-purple-500/40">{kept} turns</span>
          </div>
          <div className="text-[10px] text-slate-400 font-sans leading-tight">Strategy: {reason}</div>
        </div>
      )
    }

    if (data.kind === "synthesis") {
      const interpLabel = parsedInput?.interpretation
      return (
        <div className="space-y-2 p-2.5 rounded bg-black/60 border border-indigo-500/20 text-xs shadow-inner">
          <div className="flex items-center justify-between font-mono text-indigo-200">
            <span className="text-slate-300 font-sans">Engine:</span>
            {isActive ? (
              <span className="flex items-center gap-1.5 text-indigo-300 font-bold animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                Streaming tokens...
              </span>
            ) : (
              <span className="text-indigo-300 font-bold bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-500/30">
                qwen/qwen3.8-27b on Groq
              </span>
            )}
          </div>
          {interpLabel && (
            <div className="text-[10px] font-mono text-emerald-300 bg-emerald-950/40 px-2 py-1 rounded border border-emerald-500/30 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Conditioned on: {interpLabel}</span>
            </div>
          )}
        </div>
      )
    }

    if (data.kind === "chat_output") {
      const ans = typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput)
      return (
        <div className="space-y-1">
          <div className="text-[11px] font-mono text-lime-400 uppercase tracking-wider font-semibold">LLM Response</div>
          <div className="p-2.5 rounded bg-black/70 border border-lime-500/20 text-xs font-sans text-slate-100 max-h-36 overflow-y-auto leading-relaxed shadow-inner break-words">
            {ans}
          </div>
        </div>
      )
    }

    return (
      <pre className="p-2 rounded bg-black/60 border border-hairline text-[10px] font-mono text-slate-300 max-h-24 overflow-x-auto">
        {typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput, null, 2)}
      </pre>
    )
  }

  return (
    <div
      className={cn(
        "w-[340px] sm:w-[380px] rounded-xl border bg-[#181614] transition-all duration-200 select-none cursor-pointer relative shadow-2xl group",
        config.borderColor,
        config.glow,
        isCandidate && !isCandidateChosen && "opacity-55 hover:opacity-100 transition-opacity",
        isSelected
          ? "ring-2 ring-amber-400 shadow-[0_0_24px_rgba(245,158,11,0.5)] border-amber-400 scale-[1.02]"
          : "hover:border-slate-300 hover:shadow-2xl",
        isActive && "ring-2 ring-indigo-400 shadow-[0_0_24px_rgba(99,102,241,0.6)] animate-pulse",
        isError && "border-red-500 bg-red-950/30 ring-1 ring-red-500"
      )}
    >
      {/* Top Handle for Downward Flow */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-slate-300 !w-3 !h-3 !border-2 !border-[#181614] hover:!bg-amber-400 transition-colors shadow-md"
      />

      {/* Node Header */}
      <div
        className={cn(
          "px-3.5 py-2.5 border-b border-black/40 rounded-t-xl flex items-center justify-between gap-2 shadow-sm",
          config.headerBg
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded bg-black/40 border border-white/10 shrink-0">
            {config.icon}
          </div>
          <span className="text-xs font-bold text-white truncate tracking-wide">
            {config.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono font-bold shadow-sm", config.badgeColor)}>
            Step {data.idx}
          </span>
          {isError ? (
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          ) : isActive ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-80"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
            </span>
          ) : isCandidate && !isCandidateChosen ? (
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          )}
        </div>
      </div>

      {/* Node Body */}
      <div className="p-3 bg-[#1e1b18] rounded-b-xl border-t border-white/5">
        {renderSummary()}
      </div>

      {/* Bottom Handle for Downward Flow */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-slate-300 !w-3 !h-3 !border-2 !border-[#181614] hover:!bg-amber-400 transition-colors shadow-md"
      />
    </div>
  )
}
