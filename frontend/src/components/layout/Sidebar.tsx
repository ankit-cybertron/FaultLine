import React, { useState } from "react"
import {
  Activity,
  ChevronLeft,
  Bot,
} from "lucide-react"
import { motion } from "motion/react"
import { useSeismicAudio } from "../../hooks/useSeismicAudio"
import { cn } from "../../lib/utils"
import type { Run, HealthStatus } from "../../types"

interface SidebarProps {
  activePage: string
  onNavigate: (page: string) => void
  tenant: string
  onTenantChange: (tenant: string) => void
  runs: Run[]
  activeRunId: string | null
  onSelectRun: (runId: string) => void
  health: HealthStatus | null
  collapsed: boolean
  onToggleCollapse: () => void
}

export function Sidebar({
  activePage,
  onNavigate,
  tenant,
  onTenantChange,
  runs = [],
  activeRunId,
  onSelectRun,
  health,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [runsPopoverOpen, setRunsPopoverOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const { playClick } = useSeismicAudio()

  const isExpanded = !collapsed || isHovered

  const navItems = [
    { id: "overview", label: "Overview", icon: <Activity className="w-4 h-4 text-ember" /> },
    { id: "chat", label: "Live Chat", icon: <Bot className="w-4 h-4 text-indigo-400" /> },
  ]

  const falkorConnected = health?.falkordb === "connected"
  const backendHealthy = health?.status === "ok"

  return (
    <aside
      onMouseEnter={() => collapsed && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "h-screen sticky top-0 flex flex-col bg-surface border-r border-hairline transition-all duration-200 z-30 select-none",
        isExpanded ? "w-60 shadow-2xl" : "w-16"
      )}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-hairline shrink-0">
        <div className="flex items-center gap-3 overflow-hidden">
          {/* Seismograph Wavemark */}
          <div className="w-7 h-7 rounded-[8px] bg-surface-raised border border-hairline flex items-center justify-center shrink-0 text-ember shadow-sm">
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none stroke-2">
              <path d="M2 12h4l2-6 4 12 3-8 3 4h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {isExpanded && (
            <div className="flex items-baseline gap-1.5 overflow-hidden">
              <span className="font-display text-lg font-normal text-bone tracking-tight">FaultLine</span>
              <span className="text-[10px] font-mono text-subtle">v0.2</span>
            </div>
          )}
        </div>

        {isExpanded && (
          <button
            type="button"
            onClick={() => {
              playClick(700)
              onToggleCollapse()
            }}
            className="p-1 rounded text-subtle hover:text-bone hover:bg-surface-raised transition-colors cursor-pointer"
            title="Toggle sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Navigation: Focused on Overview & Live Chat */}
      <div className="p-2 space-y-1">
        {navItems.map((item) => {
          const isActive = activePage === item.id
          return (
            <motion.button
              whileTap={{ scale: 0.97 }}
              key={item.id}
              type="button"
              onClick={() => {
                playClick(900)
                onNavigate(item.id)
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-xs font-sans transition-all cursor-pointer relative",
                isActive
                  ? "bg-surface-raised text-bone font-medium border border-hairline shadow-sm"
                  : "text-subtle hover:text-bone hover:bg-surface-raised/50"
              )}
              title={item.label}
            >
              <span className={cn(isActive ? "text-ember" : "text-subtle")}>{item.icon}</span>
              {isExpanded && <span className="truncate">{item.label}</span>}
              {isActive && (
                <motion.div
                  layoutId="activeNavIndicator"
                  className="absolute left-0 w-1 h-4 bg-ember rounded-r-full"
                />
              )}
            </motion.button>
          )
        })}
      </div>

      {/* Footer: Single small connection dot with tooltip */}
      <div className="p-3 border-t border-hairline mt-auto flex items-center justify-center">
        <div className="relative group">
          <div
            className={cn(
              "w-2.5 h-2.5 rounded-full transition-colors",
              falkorConnected
                ? "bg-lichen shadow-[0_0_6px_var(--signal-lichen)]"
                : backendHealthy
                ? "bg-ochre shadow-[0_0_6px_var(--signal-ochre)]"
                : "bg-ember"
            )}
          />

          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-[6px] bg-surface-raised border border-hairline text-[11px] font-mono text-bone shadow-xl whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50">
            <div>FalkorDB: {falkorConnected ? "Connected" : "Offline (Disk mode)"}</div>
            <div className="text-[10px] text-subtle">API: {backendHealthy ? "Healthy" : "Error"}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
