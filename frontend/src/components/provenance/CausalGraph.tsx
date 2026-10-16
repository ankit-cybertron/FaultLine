import React, { useMemo } from "react"
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import {
  SourceNode,
  ToolNode,
  LlmNode,
  TransformNode,
  FailureNode,
} from "./nodes/CustomNodes"
import { ShockwaveEdge } from "../seismic/ShockwaveEdge"
import { FaultLineDivider } from "../seismic/FaultLineDivider"
import { EpicenterPulse } from "../seismic/EpicenterPulse"
import { useSeismicAudio } from "../../hooks/useSeismicAudio"
import type { GraphElements } from "../../types"

interface CausalGraphProps {
  graphData?: GraphElements | null
  activeStepIdx?: number | null
  rootCauseIdx?: number | null
  failureIdx?: number | null
  causalPath?: number[]
  onSelectStep: (idx: number) => void
  className?: string
}

export function CausalGraph({
  graphData,
  activeStepIdx,
  rootCauseIdx,
  failureIdx,
  causalPath = [],
  onSelectStep,
  className,
}: CausalGraphProps) {
  const { playClick, playSeismicPing } = useSeismicAudio()
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      sourceNode: SourceNode,
      toolNode: ToolNode,
      llmNode: LlmNode,
      transformNode: TransformNode,
      failureNode: FailureNode,
    }),
    []
  )

  const edgeTypes: EdgeTypes = useMemo(
    () => ({
      shockwaveEdge: ShockwaveEdge,
    }),
    []
  )

  // Map nodes with selection, root-cause, and path highlights
  const nodes: Node[] = useMemo(() => {
    if (!graphData?.nodes) return []
    return graphData.nodes.map((node) => {
      const idx = Number(node.data.idx)
      const isSelected = activeStepIdx === idx
      const isRoot = rootCauseIdx === idx
      const isSymptom = failureIdx === idx
      const isOnPath = causalPath.includes(idx)

      return {
        ...node,
        data: {
          ...node.data,
          is_selected: isSelected,
          is_root_cause: isRoot,
          is_symptom: isSymptom,
          is_on_path: isOnPath,
        },
      }
    })
  }, [graphData, activeStepIdx, rootCauseIdx, failureIdx, causalPath])

  // Map edges with causal shockwave path data
  const edges: Edge[] = useMemo(() => {
    if (!graphData?.edges) return []
    return graphData.edges.map((edge) => {
      const s = Number(edge.source)
      const t = Number(edge.target)
      const isCausal = causalPath.includes(s) && causalPath.includes(t)

      return {
        ...edge,
        type: isCausal ? "shockwaveEdge" : "default",
        data: {
          ...edge.data,
          is_causal_path: isCausal,
          is_shockwave: isCausal,
        },
      }
    })
  }, [graphData, causalPath])

  // Calculate divider position based on fault step or first error
  const faultDividerX = useMemo(() => {
    if (graphData?.fault_line_idx != null) {
      const targetNode = nodes.find((n) => Number(n.data.idx) === graphData.fault_line_idx)
      if (targetNode) return targetNode.position.x - 20
    }
    if (rootCauseIdx != null) {
      const targetNode = nodes.find((n) => Number(n.data.idx) === rootCauseIdx)
      if (targetNode) return targetNode.position.x - 20
    }
    return null
  }, [graphData, rootCauseIdx, nodes])

  return (
    <div className="relative w-full h-full min-h-[420px] rounded-[10px] border border-hairline bg-surface overflow-hidden chart-paper-grid">
      {/* Top indicator bar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-surface-raised/90 border border-hairline text-[11px] font-mono text-subtle backdrop-blur-sm">
          Causal provenance graph
        </span>
        {rootCauseIdx != null && (
          <span className="px-2 py-0.5 rounded bg-ember/20 border border-ember/60 text-[11px] font-mono text-ember flex items-center gap-1 backdrop-blur-sm">
            ⚡ Epicenter: step #{rootCauseIdx}
          </span>
        )}
      </div>

      {/* Fault Line Divider if fault detected */}
      {faultDividerX != null && (
        <FaultLineDivider xPosition={faultDividerX} height={420} />
      )}

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          const idx = Number(node.data.idx)
          if (!isNaN(idx)) {
            if (node.data.is_root_cause || node.data.status === "error") {
              playSeismicPing(true)
            } else {
              playClick(750 + idx * 80)
            }
            onSelectStep(idx)
          }
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(217, 205, 182, 0.08)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          position="bottom-left"
          nodeColor={(n) => {
            if (n.data.status === "error" || n.data.is_root_cause) return "#FF5A36"
            if (n.type === "sourceNode") return "#D9CDB6"
            return "#C6E36B"
          }}
          maskColor="rgba(20, 18, 16, 0.7)"
        />
      </ReactFlow>
    </div>
  )
}
