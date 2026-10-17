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
          icon: <MessageSquare className="w-3.5 h-3.5 text-sky-400" />,
          borderColor: "border-sky-500/40",
          headerBg: "bg-sky-500/10",
          badgeColor: "bg-sky-500/20 text-sky-300",
        }
      case "context_selection":
        return {
          title: "Context Selection",
          icon: <Database className="w-3.5 h-3.5 text-purple-400" />,
          borderColor: "border-purple-500/40",
          headerBg: "bg-purple-500/10",
          badgeColor: "bg-purple-500/20 text-purple-300",
        }
      case "router":
        return {
          title: "Router Decision",
          icon: <GitFork className="w-3.5 h-3.5 text-amber-400" />,
          borderColor: "border-amber-500/40",
          headerBg: "bg-amber-500/10",
          badgeColor: "bg-amber-500/20 text-amber-300",
        }
      case "tool_call":
        return {
          title: "Tool Call",
          icon: <Wrench className="w-3.5 h-3.5 text-emerald-400" />,
          borderColor: "border-emerald-500/40",
          headerBg: "bg-emerald-500/10",
          badgeColor: "bg-emerald-500/20 text-emerald-300",
        }
      case "tool_result":
        return {
          title: "Tool Result",
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />,
          borderColor: "border-teal-500/40",
          headerBg: "bg-teal-500/10",
          badgeColor: "bg-teal-500/20 text-teal-300",
        }
      case "synthesis":
        return {
          title: "LLM Synthesis",
          icon: <Brain className="w-3.5 h-3.5 text-indigo-400" />,
          borderColor: "border-indigo-500/40",
          headerBg: "bg-indigo-500/10",
          badgeColor: "bg-indigo-500/20 text-indigo-300",
        }
      case "chat_output":
        return {
          title: "Final Answer",
          icon: <Bot className="w-3.5 h-3.5 text-lichen" />,
          borderColor: "border-lichen/40",
          headerBg: "bg-lichen/10",
          badgeColor: "bg-lichen/20 text-lichen",
        }
      default:
        return {
          title: data.kind || "Step",
          icon: <Brain className="w-3.5 h-3.5 text-bone" />,
          borderColor: "border-hairline",
          headerBg: "bg-surface-raised",
          badgeColor: "bg-hairline text-bone",
        }
    }
  }

  const config = getKindConfig()

  // Format summary label
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
      const text = typeof parsedInput === "string" ? parsedInput : JSON.stringify(parsedInput)
      return (
        <p className="text-[11px] font-sans text-bone/90 line-clamp-2 italic">
          "{text}"
        </p>
      )
    }

    if (data.kind === "router") {
      const decision = parsedOutput?.decision || "direct_answer"
      const toolName = parsedOutput?.tool
      const reason = parsedOutput?.reason
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
                decision === "tool_call"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-sky-500/20 text-sky-300 border border-sky-500/30"
              )}
            >
              {decision === "tool_call" ? `tool: ${toolName}` : "direct answer"}
            </span>
          </div>
          {reason && (
            <p className="text-[10px] text-muted line-clamp-2 leading-relaxed">
              {reason}
            </p>
          )}
        </div>
      )
    }

    if (data.kind === "tool_call") {
      const argsStr = typeof parsedInput === "object" ? JSON.stringify(parsedInput) : String(parsedInput)
      return (
        <div className="text-[10px] font-mono text-bone/80 truncate">
          <span className="text-emerald-400 font-semibold">{data.tool || "tool"}</span>
          <span className="text-muted ml-1 truncate">{argsStr}</span>
        </div>
      )
    }

    if (data.kind === "tool_result") {
      const resultText = parsedOutput?.result || (typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput))
      const latency = parsedOutput?.latency_s
      return (
        <div className="space-y-0.5 text-[10px] font-mono">
          <div className="text-teal-300 truncate">{String(resultText)}</div>
          {latency !== undefined && (
            <div className="text-muted text-[9px]">latency: {(latency * 1000).toFixed(0)}ms</div>
          )}
        </div>
      )
    }

    if (data.kind === "context_selection") {
      const kept = parsedInput?.kept ?? 0
      const reason = parsedInput?.reason || "history analyzed"
      return (
        <div className="text-[10px] text-muted leading-tight">
          <span className="text-purple-300 font-mono font-medium">{kept}</span> turns retained ({reason})
        </div>
      )
    }

    if (data.kind === "synthesis") {
      return (
        <div className="text-[10px] text-muted flex items-center gap-1">
          {isActive ? (
            <>
              <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
              <span className="text-indigo-300">Streaming tokens via Groq...</span>
            </>
          ) : (
            <span className="text-indigo-200">Synthesis complete</span>
          )}
        </div>
      )
    }

    if (data.kind === "chat_output") {
      const ans = typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput)
      return (
        <p className="text-[10px] text-bone/90 line-clamp-2">
          {ans}
        </p>
      )
    }

    return (
      <p className="text-[10px] text-muted truncate">
        {typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput)}
      </p>
    )
  }

  return (
    <div
      className={cn(
        "w-[260px] rounded-lg border bg-surface/95 backdrop-blur-sm transition-all duration-200 select-none cursor-pointer relative shadow-lg group",
        config.borderColor,
        isSelected
          ? "ring-2 ring-ochre shadow-[0_0_15px_rgba(232,176,74,0.3)] border-ochre"
          : "hover:border-bone/60 hover:shadow-xl",
        isActive && "ring-2 ring-indigo-400 shadow-[0_0_18px_rgba(99,102,241,0.4)]",
        isError && "border-ember bg-ember/10 ring-1 ring-ember"
      )}
    >
      {/* Input handle at Top (Vertical Flow) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-bone/40 !w-2.5 !h-2.5 !border-surface hover:!bg-ochre transition-colors"
      />

      {/* Node Header */}
      <div
        className={cn(
          "px-3 py-1.5 border-b border-hairline/60 rounded-t-lg flex items-center justify-between gap-1.5",
          config.headerBg
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {config.icon}
          <span className="text-[11px] font-semibold text-bone truncate tracking-wide">
            {config.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("px-1.5 py-0.2 rounded text-[9px] font-mono font-bold", config.badgeColor)}>
            #{data.idx}
          </span>
          {isError ? (
            <AlertCircle className="w-3 h-3 text-ember" />
          ) : isActive ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Node Body */}
      <div className="p-2.5 bg-surface-raised/40 rounded-b-lg">
        {renderSummary()}
      </div>

      {/* Output handle at Bottom (Vertical Flow) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-bone/40 !w-2.5 !h-2.5 !border-surface hover:!bg-ochre transition-colors"
      />
    </div>
  )
}
