import { Handle, Position } from "@xyflow/react"
import { Database, Wrench, Brain, AlertTriangle, Layers } from "lucide-react"
import { cn, formatDuration } from "../../../lib/utils"

export function SourceNode(props: any) {
  const data = props.data || {}
  const isSelected = data.is_selected
  return (
    <div
      className={cn(
        "px-3.5 py-2.5 rounded-[10px] border bg-surface transition-all duration-200 hover:scale-105 min-w-[150px] shadow-sm select-none cursor-pointer",
        isSelected ? "border-ink ring-2 ring-ink/50 shadow-md" : "border-hairline hover:border-ink/60"
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-bone font-semibold mb-1">
        <Database className="w-3.5 h-3.5 text-ink" />
        <span className="font-mono text-[11px] truncate">{data.label}</span>
      </div>
      <div className="text-[10px] font-mono text-subtle flex items-center justify-between">
        <span>source</span>
        <span>📦 {formatDuration(data.duration_ms || 30)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-ink !w-2 !h-2" />
    </div>
  )
}

export function ToolNode(props: any) {
  const data = props.data || {}
  const isSelected = data.is_selected
  const isRoot = data.is_root_cause
  return (
    <div
      className={cn(
        "px-3.5 py-2.5 rounded-[8px] border bg-surface transition-all duration-200 hover:scale-105 min-w-[160px] shadow-sm select-none relative cursor-pointer",
        isRoot
          ? "border-ember bg-ember/10 shadow-[0_0_14px_var(--signal-ember-glow)]"
          : isSelected
          ? "border-ochre ring-2 ring-ochre/60"
          : "border-hairline hover:border-bone/40"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-hairline !w-2 !h-2" />
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-bone truncate">
          <Wrench className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono text-[11px] truncate">{data.label}</span>
        </div>
        <span className="text-[9px] font-mono text-lichen">✓</span>
      </div>

      <div className="text-[10px] font-mono text-subtle flex items-center justify-between">
        <span className="truncate max-w-[90px]">{data.tool || "tool"}</span>
        <span className="tabular-nums">{formatDuration(data.duration_ms)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-hairline !w-2 !h-2" />
    </div>
  )
}

export function LlmNode(props: any) {
  const data = props.data || {}
  const isSelected = data.is_selected
  const isRoot = data.is_root_cause
  return (
    <div
      className={cn(
        "px-3.5 py-2.5 rounded-[8px] border bg-surface transition-all duration-200 hover:scale-105 min-w-[160px] shadow-sm select-none relative cursor-pointer",
        isRoot
          ? "border-ember bg-ember/10 shadow-[0_0_14px_var(--signal-ember-glow)]"
          : isSelected
          ? "border-lichen ring-2 ring-lichen/60"
          : "border-hairline hover:border-lichen/50"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-hairline !w-2 !h-2" />
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-bone truncate">
          <Brain className="w-3.5 h-3.5 shrink-0 text-lichen" />
          <span className="font-mono text-[11px] truncate">{data.label}</span>
        </div>
        <span className="text-[9px] font-mono text-lichen">✓</span>
      </div>

      <div className="text-[10px] font-mono text-subtle flex items-center justify-between">
        <span>llm_step</span>
        <span className="tabular-nums">{formatDuration(data.duration_ms)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-lichen !w-2 !h-2" />
    </div>
  )
}

export function TransformNode(props: any) {
  const data = props.data || {}
  const isSelected = data.is_selected
  const isRoot = data.is_root_cause
  return (
    <div
      className={cn(
        "px-3.5 py-2.5 rounded-[8px] border bg-surface transition-all duration-200 hover:scale-105 min-w-[160px] shadow-sm select-none relative cursor-pointer",
        isRoot
          ? "border-ember bg-ember/10 shadow-[0_0_14px_var(--signal-ember-glow)]"
          : isSelected
          ? "border-ochre ring-2 ring-ochre/60"
          : "border-hairline hover:border-ochre/50"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-hairline !w-2 !h-2" />
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-bone truncate">
          <Layers className="w-3.5 h-3.5 shrink-0 text-ochre" />
          <span className="font-mono text-[11px] truncate">{data.label}</span>
        </div>
        <span className="text-[9px] font-mono text-lichen">✓</span>
      </div>

      <div className="text-[10px] font-mono text-subtle flex items-center justify-between">
        <span>transform</span>
        <span className="tabular-nums">{formatDuration(data.duration_ms)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-ochre !w-2 !h-2" />
    </div>
  )
}

export function FailureNode(props: any) {
  const data = props.data || {}
  const isSelected = data.is_selected
  const isRoot = data.is_root_cause
  return (
    <div
      className={cn(
        "px-3.5 py-2.5 rounded-[8px] border bg-ember/10 transition-all duration-200 hover:scale-105 min-w-[160px] shadow-sm select-none relative cursor-pointer",
        "border-ember shadow-[0_0_16px_var(--signal-ember-glow)]",
        isSelected && "ring-2 ring-ember"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-ember !w-2 !h-2" />
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ember truncate">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-bounce" />
          <span className="font-mono text-[11px] truncate">{data.label}</span>
        </div>
        <span className="text-[9px] font-mono text-ember">✕</span>
      </div>

      <div className="text-[10px] font-mono text-ember/90 flex items-center justify-between">
        <span>{isRoot ? "Root cause" : "Failure symptom"}</span>
        <span className="tabular-nums">{formatDuration(data.duration_ms)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-ember !w-2 !h-2" />
    </div>
  )
}
