import type {
  Diagnosis,
  FleetSummary,
  GraphElements,
  HealthStatus,
  ProvenanceFlow,
  ReplayVerification,
  Run,
  Step,
  Claim,
} from "../types"

const BASE_URL = "/api"

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  })

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}: ${res.statusText}`
    try {
      const err = await res.json()
      if (err.detail) errorDetail = err.detail
    } catch {
      // ignore
    }
    throw new Error(errorDetail)
  }

  return res.json()
}

export const api = {
  async getHealth(): Promise<HealthStatus> {
    try {
      return await fetchJson<HealthStatus>(`${BASE_URL}/health`)
    } catch {
      return {
        status: "error",
        version: "0.2.0",
        falkordb: "disconnected",
        groq: "missing_key",
        graphs: ["demo_agent", "fleet", "trail", "whowhen"],
      }
    }
  },

  async getRuns(tenant: string = "demo_agent", outcome?: string): Promise<Run[]> {
    const params = new URLSearchParams({ graph_name: tenant })
    if (outcome) params.set("outcome", outcome)
    return fetchJson<Run[]>(`${BASE_URL}/runs?${params}`)
  },

  async getRun(runId: string, tenant: string = "demo_agent"): Promise<Run & { steps: Step[] }> {
    return fetchJson<Run & { steps: Step[] }>(`${BASE_URL}/runs/${encodeURIComponent(runId)}?graph_name=${tenant}`)
  },

  async runAgent(payload: { fault: string; seed: number; tenant: string }): Promise<{
    run_id: string
    outcome: "success" | "failure"
    fault_name: string
    trace: any
  }> {
    return fetchJson(`${BASE_URL}/runs`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  async getProvenance(runId: string, tenant: string = "demo_agent"): Promise<ProvenanceFlow> {
    return fetchJson<ProvenanceFlow>(`${BASE_URL}/runs/${encodeURIComponent(runId)}/provenance?graph_name=${tenant}`)
  },

  async getClaims(runId: string, tenant: string = "demo_agent"): Promise<Claim[]> {
    return fetchJson<Claim[]>(`${BASE_URL}/runs/${encodeURIComponent(runId)}/claims?graph_name=${tenant}`)
  },

  async verifyClaims(runId: string, tenant: string = "demo_agent"): Promise<Claim[]> {
    return fetchJson<Claim[]>(`${BASE_URL}/runs/${encodeURIComponent(runId)}/claims/verify?graph_name=${tenant}`, {
      method: "POST",
    })
  },

  async getGraph(runId: string, tenant: string = "demo_agent"): Promise<GraphElements> {
    return fetchJson<GraphElements>(`${BASE_URL}/runs/${encodeURIComponent(runId)}/graph?graph_name=${tenant}`)
  },

  async investigate(runId: string, tenant: string = "demo_agent"): Promise<Diagnosis> {
    return fetchJson<Diagnosis>(`${BASE_URL}/runs/${encodeURIComponent(runId)}/investigate?graph_name=${tenant}`, {
      method: "POST",
    })
  },

  async replay(runId: string, patch: any, tenant: string = "demo_agent"): Promise<ReplayVerification> {
    return fetchJson<ReplayVerification>(`${BASE_URL}/runs/${encodeURIComponent(runId)}/replay?graph_name=${tenant}`, {
      method: "POST",
      body: JSON.stringify({ patch }),
    })
  },

  async getFleetSummary(tenant: string = ""): Promise<FleetSummary> {
    const params = new URLSearchParams()
    if (tenant) params.set("tenant", tenant)
    return fetchJson<FleetSummary>(`${BASE_URL}/fleet/summary?${params}`)
  },

  async generateFleetBatch(tenant: string = "fleet"): Promise<{ created_runs: number; summary: FleetSummary }> {
    return fetchJson(`${BASE_URL}/fleet/generate?tenant=${tenant}`, {
      method: "POST",
    })
  },

  async getSavedTraces(): Promise<string[]> {
    return fetchJson<string[]>(`${BASE_URL}/traces/saved`)
  },

  async uploadTrace(spans: any[], runId?: string, tenant: string = "demo_agent"): Promise<{ run_id: string; outcome: string }> {
    return fetchJson(`${BASE_URL}/traces/upload`, {
      method: "POST",
      body: JSON.stringify({ spans, run_id: runId, graph_name: tenant }),
    })
  },
}
