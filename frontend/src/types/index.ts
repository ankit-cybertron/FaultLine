export type RunOutcome = "success" | "failure"

export interface Run {
  id: string
  task: string
  outcome: RunOutcome
  source: string
  tenant: string
  fault?: string
  step_count: number
  duration_ms?: number
  created_at?: string
  steps_sparkline?: Array<"ok" | "error" | "warn" | "neutral">
  is_synthetic?: boolean
}

export type RunDetail = Run & { steps: Step[] }

export interface Step {
  run_id: string
  idx: number
  agent: string
  kind: string
  tool?: string | null
  input: any
  output: any
  status: "ok" | "error" | "source" | "claim" | string
  tokens?: number
  ts?: number
  duration_ms?: number
  dist?: number
}

export interface Claim {
  text: string
  supported: boolean
  supported_by?: number[]
  unsupported_reason?: string
}

export interface Patch {
  kind: "arg_fix" | "prompt_edit" | "tool_config" | string
  diff: string
  patched_input: any
  target_idx?: number
}

export interface Diagnosis {
  run_id: string
  root_cause_idx: number | null
  failure_idx: number | null
  causal_path: number[]
  explanation: string
  patch: Patch | null
  patch_applied: boolean
  replay_passed: boolean
  tokens_used: number
  latency_s: number
  steps_checked?: number[]
  replayed_steps?: Step[]
}

export interface ReplayVerification {
  run_id: string
  patched_from_idx: number
  original_outcome: RunOutcome
  replay_outcome: RunOutcome
  passed: boolean
  patch_state: "proposed" | "applied" | "verified"
  original_steps: Step[]
  replayed_steps: Step[]
  explanation: string
}

export interface FleetCause {
  cause: string
  fix_summary: string
  runs: number
  run_ids: string[]
  success_rate?: number
  is_synthetic?: boolean
}

export interface FleetSummary {
  tenant: string
  total_failed_runs: number
  n_root_causes: number
  causes: FleetCause[]
}

export interface HealthStatus {
  status: string
  version: string
  falkordb: "connected" | "disconnected"
  groq: "configured" | "missing_key"
  graphs: string[]
}

export interface FaultDef {
  id: string
  name: string
  agent: string
  description: string
  severity: "low" | "medium" | "high"
  root_cause_idx: number | null
  example: string
}

export interface ProvenanceFlow {
  run_id: string
  answer_text: string
  flow: Step[]
  claims: Claim[]
  sources?: Array<{ id: string; kind: string; version?: string }>
}

export interface GraphNodeData {
  idx: number | string
  label: string
  agent: string
  kind: string
  tool?: string
  status: string
  input?: any
  output?: any
  duration_ms?: number
  is_root_cause?: boolean
  is_symptom?: boolean
  is_on_path?: boolean
  is_selected?: boolean
}

export interface GraphNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: GraphNodeData
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  animated?: boolean
  label?: string
  data?: {
    kind?: string
    is_shockwave?: boolean
    is_causal_path?: boolean
  }
}

export interface GraphElements {
  nodes: GraphNode[]
  edges: GraphEdge[]
  fault_line_idx?: number | null
}

export interface ChatStep {
  idx: number
  kind: "chat_input" | "context_selection" | "router" | "tool_call" | "tool_result" | "synthesis" | "chat_output" | string
  tool?: string | null
  input: any
  output: any
  status: "ok" | "error" | string
  ts?: number
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  steps?: ChatStep[]
  turnId?: string
  runId?: string
  latency_s?: number
  tokens?: number
  timestamp?: number
  isStreaming?: boolean
}

