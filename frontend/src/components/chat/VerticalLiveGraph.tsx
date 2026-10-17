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
import { Sparkles, Maximize2, Zap, Clock, ArrowDown, Info } from "lucide-react"

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

  // Construct vertical nodes with comfortable spacing
  const nodes: Node[] = useMemo(() => {
    return steps.map((step, i) => {
      const isSelected = activeStepIdx === step.idx
      const isActive = isStreaming && i === steps.length - 1

      return {
        id: `step_${step.idx}`,
        type: "decisionNode",
        position: { x: 60, y: i * 210 + 40 },
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
          stroke: isCurrentTransition ? "#818cf8" : "#d97706",
          strokeWidth: isCurrentTransition ? 3 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: isCurrentTransition ? "#818cf8" : "#d97706",
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
        fitView({ padding: 0.25, duration: 400 })
      }, 60)
      return () => clearTimeout(timeout)
    }
  }, [steps.length, fitView])

  const selectedStep = activeStepIdx !== null ? steps.find((s) => s.idx === activeStepIdx) : null

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0f0e0d] text-slate-100 select-none">
      {/* Top Status Bar */}
      <div className="px-4 py-3 border-b border-white/10 bg-[#161412]/95 backdrop-blur-md flex items-center justify-between gap-3 z-10 shrink-0 shadow-md">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-white tracking-wide">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>DECISION FLOW FORENSICS</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/40 border border-white/10 text-slate-300 flex items-center gap-1">
            <ArrowDown className="w-3 h-3 text-amber-400" />
            <span>Vertical Flow (Downwards)</span>
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          {latency_s !== undefined && (
            <span className="flex items-center gap-1 text-slate-300 bg-black/40 px-2 py-0.5 rounded border border-white/10">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              <span>{latency_s.toFixed(2)}s</span>
            </span>
          )}
          {tokens !== undefined && (
            <span className="flex items-center gap-1 text-slate-300 bg-black/40 px-2 py-0.5 rounded border border-white/10">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>{tokens} tok</span>
            </span>
          )}
          <span className="px-2.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold">
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
          <button
            onClick={() => fitView({ padding: 0.25, duration: 300 })}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-white transition-colors border border-white/10"
            title="Fit Graph in View"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Flow Canvas with Dark Engineering Grid */}
      <div className="flex-1 relative w-full h-full min-h-0 bg-[#0f0e0d]">
        {steps.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-[#1a1715] border border-white/10 flex items-center justify-center mb-3 text-amber-400 shadow-xl">
              <Zap className="w-7 h-7" />
            </div>
            <h4 className="text-sm font-bold text-white mb-1.5 tracking-wide">Awaiting Agent Turn</h4>
            <p className="text-xs max-w-sm text-slate-400 leading-relaxed font-sans">
              Type a prompt on the left. The live execution trace (user input, context selection, Groq routing, tool executions, and answer synthesis) will render here vertically downwards in real time.
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
            className="bg-[#0f0e0d]"
          >
            <Background color="#38332c" gap={24} size={1.2} variant={BackgroundVariant.Dots} />
            <Controls className="!bg-[#1c1917] !border-white/10 !text-slate-200 shadow-2xl !rounded-lg overflow-hidden" />
            <MiniMap
              className="!bg-[#181614]/90 !border !border-white/15 !rounded-lg overflow-hidden shadow-2xl hidden md:block"
              nodeColor={(node) => {
                const k = (node.data as any)?.kind
                if (k === "chat_input") return "#38bdf8"
                if (k === "router") return "#fbbf24"
                if (k === "tool_call") return "#34d399"
                if (k === "tool_result") return "#2dd4bf"
                if (k === "synthesis") return "#818cf8"
                return "#a3e635"
              }}
              maskColor="rgba(15, 14, 13, 0.75)"
            />
          </ReactFlow>
        )}
      </div>

      {/* Step Inspector Drawer / Bottom Sheet */}
      {selectedStep && (
        <div className="p-4 bg-[#181614] border-t-2 border-amber-500/50 text-xs max-h-64 overflow-y-auto shrink-0 shadow-2xl animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <span className="font-mono font-bold text-amber-400 text-sm">
                Step #{selectedStep.idx} Detailed Telemetry
              </span>
              <span className="px-2 py-0.5 rounded bg-black/50 border border-white/10 font-mono text-xs text-white">
                {selectedStep.kind}
              </span>
              {selectedStep.tool && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-xs border border-emerald-500/30">
                  tool: {selectedStep.tool}
                </span>
              )}
            </div>
            <button
              onClick={() => onSelectStep(null)}
              className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded bg-black/40 hover:bg-black/60 border border-white/10 transition-colors"
            >
              Close Inspector ✕
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
            <div className="space-y-1">
              <span className="text-sky-400 font-semibold text-[10px] uppercase tracking-wider block">Raw Input Payload</span>
              <pre className="p-3 rounded-lg bg-black/70 border border-sky-500/20 overflow-x-auto text-slate-200 max-h-36 text-[11px] leading-relaxed shadow-inner">
                {typeof selectedStep.input === "object"
                  ? JSON.stringify(selectedStep.input, null, 2)
                  : String(selectedStep.input)}
              </pre>
            </div>
            <div className="space-y-1">
              <span className="text-emerald-400 font-semibold text-[10px] uppercase tracking-wider block">Raw Output Payload</span>
              <pre className="p-3 rounded-lg bg-black/70 border border-emerald-500/20 overflow-x-auto text-slate-200 max-h-36 text-[11px] leading-relaxed shadow-inner">
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
