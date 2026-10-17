import React from "react"
import { Handle, Position } from "@xyflow/react"
import {
  MessageSquare,
  Database,
  GitFork,
  Wrench,
  CheckCircle2,
  Brain,
  Bot,
  AlertCircle,
  Loader2,
  Sparkles,
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
}

export function VerticalDecisionNode({ data }: { data: DecisionNodeData }) {
  const isSelected = data.isSelected
  const isActive = data.isActive
  const isError = data.status === "error"

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
      return (
        <div className="p-2.5 rounded bg-black/60 border border-indigo-500/20 text-xs font-mono text-indigo-200 flex items-center justify-between shadow-inner">
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
