import React, { useMemo, useEffect, useRef } from "react"
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { VerticalDecisionNode } from "./VerticalDecisionNode"
import type { ChatStep } from "../../types"
import { Sparkles, Maximize2, ShieldCheck, Clock, Zap } from "lucide-react"

interface VerticalLiveGraphProps {
  steps: ChatStep[]
  activeStepIdx: number | null
  onSelectStep: (idx: number | null) => void
  isStreaming: boolean
  turnId?: string
  latency_s?: number
  tokens?: number
}

const nodeTypes: NodeTypes = {
  decisionNode: VerticalDecisionNode,
}

function InnerVerticalGraph({
  steps,
  activeStepIdx,
  onSelectStep,
  isStreaming,
  turnId,
  latency_s,
  tokens,
}: VerticalLiveGraphProps) {
  const { fitView } = useReactFlow()
  const prevCountRef = useRef(steps.length)

  // Construct vertical nodes
  const nodes: Node[] = useMemo(() => {
    return steps.map((step, i) => {
      const isSelected = activeStepIdx === step.idx
      const isActive = isStreaming && i === steps.length - 1

      return {
        id: `step_${step.idx}`,
        type: "decisionNode",
        position: { x: 100, y: i * 145 + 30 },
        data: {
          ...step,
          isSelected,
          isActive,
        },
      }
    })
  }, [steps, activeStepIdx, isStreaming])

  // Construct downward edges
  const edges: Edge[] = useMemo(() => {
    const list: Edge[] = []
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1]
      const curr = steps[i]
      const isCurrentTransition = isStreaming && i === steps.length - 1

      list.push({
        id: `e_${prev.idx}_${curr.idx}`,
        source: `step_${prev.idx}`,
        target: `step_${curr.idx}`,
        animated: isCurrentTransition,
        style: {
          stroke: isCurrentTransition ? "#818cf8" : "#524b42",
          strokeWidth: isCurrentTransition ? 2.5 : 1.75,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: isCurrentTransition ? "#818cf8" : "#8c8273",
        },
      })
    }
    return list
  }, [steps, isStreaming])

  // Auto-scroll / fit view when new steps appear
  useEffect(() => {
    if (steps.length > 0 && steps.length !== prevCountRef.current) {
      prevCountRef.current = steps.length
      const timeout = setTimeout(() => {
        fitView({ padding: 0.2, duration: 400 })
      }, 50)
      return () => clearTimeout(timeout)
    }
  }, [steps.length, fitView])

  const selectedStep = activeStepIdx !== null ? steps.find((s) => s.idx === activeStepIdx) : null

  return (
    <div className="relative w-full h-full flex flex-col bg-basalt">
      {/* Top Status Bar */}
      <div className="px-4 py-2.5 border-b border-hairline/80 bg-surface/90 backdrop-blur-md flex items-center justify-between gap-3 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-bone">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Decision Graph Flow</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-raised border border-hairline text-muted">
            Direction: Top ➔ Bottom (Vertical)
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-muted">
          {latency_s !== undefined && (
            <span className="flex items-center gap-1 text-bone/80">
              <Clock className="w-3 h-3 text-sky-400" />
              <span>{latency_s.toFixed(2)}s</span>
            </span>
          )}
          {tokens !== undefined && (
            <span className="flex items-center gap-1 text-bone/80">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>{tokens} tok</span>
            </span>
          )}
          <span className="px-2 py-0.5 rounded bg-surface border border-hairline text-lichen font-medium">
            {steps.length} {steps.length === 1 ? "node" : "nodes"}
          </span>
          <button
            onClick={() => fitView({ padding: 0.2, duration: 300 })}
            className="p-1.5 rounded hover:bg-surface-raised hover:text-bone text-muted transition-colors"
            title="Fit Graph in View"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Flow Canvas */}
      <div className="flex-1 relative w-full h-full min-h-0">
        {steps.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-muted">
            <div className="w-12 h-12 rounded-2xl bg-surface border border-hairline flex items-center justify-center mb-3 text-subtle shadow-inner">
              <Zap className="w-6 h-6 text-amber-400/60" />
            </div>
            <h4 className="text-sm font-medium text-bone mb-1">Awaiting Turn</h4>
            <p className="text-xs max-w-xs text-muted leading-relaxed">
              Send a message in the chat box on the left. Each model decision, tool call, and synthesis step will stream here vertically downwards.
            </p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => {
              const idx = (node.data as any).idx
              onSelectStep(activeStepIdx === idx ? null : idx)
            }}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            className="chart-paper-grid"
          >
            <Background color="#342F29" gap={20} size={1} variant={BackgroundVariant.Dots} />
            <Controls className="!bg-surface !border-hairline !text-bone shadow-lg !rounded-lg overflow-hidden" />
            <MiniMap
              className="!bg-surface/90 !border-hairline !rounded-lg overflow-hidden shadow-lg hidden sm:block"
              nodeColor={(node) => {
                const k = (node.data as any)?.kind
                if (k === "chat_input") return "#38bdf8"
                if (k === "router") return "#fbbf24"
                if (k === "tool_call") return "#34d399"
                if (k === "tool_result") return "#2dd4bf"
                if (k === "synthesis") return "#818cf8"
                return "#a3e635"
              }}
              maskColor="rgba(20, 18, 16, 0.7)"
            />
          </ReactFlow>
        )}
      </div>

      {/* Step Inspector Drawer / Bottom Sheet */}
      {selectedStep && (
        <div className="p-3 bg-surface-raised border-t border-hairline text-xs max-h-56 overflow-y-auto shrink-0 shadow-2xl animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-hairline/60">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-amber-400 text-sm">
                Step #{selectedStep.idx}
              </span>
              <span className="px-2 py-0.5 rounded bg-surface border border-hairline font-mono text-[11px] text-bone">
                {selectedStep.kind}
              </span>
              {selectedStep.tool && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 font-mono text-[11px]">
                  tool: {selectedStep.tool}
                </span>
              )}
            </div>
            <button
              onClick={() => onSelectStep(null)}
              className="text-muted hover:text-bone text-[11px] px-2 py-0.5 rounded hover:bg-surface"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
            <div className="space-y-1">
              <span className="text-muted text-[10px] uppercase tracking-wider block">Input Payload</span>
              <pre className="p-2 rounded bg-basalt border border-hairline overflow-x-auto text-bone/90 max-h-32 text-[10px] leading-tight">
                {typeof selectedStep.input === "object"
                  ? JSON.stringify(selectedStep.input, null, 2)
                  : String(selectedStep.input)}
              </pre>
            </div>
            <div className="space-y-1">
              <span className="text-muted text-[10px] uppercase tracking-wider block">Output Payload</span>
              <pre className="p-2 rounded bg-basalt border border-hairline overflow-x-auto text-bone/90 max-h-32 text-[10px] leading-tight">
                {typeof selectedStep.output === "object"
                  ? JSON.stringify(selectedStep.output, null, 2)
                  : String(selectedStep.output)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function VerticalLiveGraph(props: VerticalLiveGraphProps) {
  return (
    <ReactFlowProvider>
      <InnerVerticalGraph {...props} />
    </ReactFlowProvider>
  )
}
