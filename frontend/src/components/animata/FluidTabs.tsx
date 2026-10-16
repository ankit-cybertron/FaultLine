import React, { useRef, useEffect } from "react"
import { motion } from "motion/react"
import { cn } from "../../lib/utils"

export interface TabItem {
  id: string
  label: string
  icon?: React.ReactNode
  badge?: string | number
}

interface FluidTabsProps {
  tabs: TabItem[]
  activeId: string
  onChange: (id: string) => void
  className?: string
  tabClassName?: string
  layoutId?: string
}

export function FluidTabs({
  tabs,
  activeId,
  onChange,
  className,
  tabClassName,
  layoutId = "fluid-tab-indicator",
}: FluidTabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1
    if (e.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length
    } else if (e.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length
    } else if (e.key === "Home") {
      nextIndex = 0
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1
    }

    if (nextIndex !== -1) {
      e.preventDefault()
      const nextTab = tabs[nextIndex]
      onChange(nextTab.id)
      tabRefs.current[nextIndex]?.focus()
    }
  }

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        "relative flex items-center p-1 bg-sidebar/80 border border-border rounded-lg gap-1 backdrop-blur-sm",
        className
      )}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeId
        return (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[idx] = el }}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              "relative z-10 flex items-center gap-2 px-3.5 py-1.5 text-xs font-sans font-medium rounded-[8px] transition-colors select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline",
              isActive ? "text-bone" : "text-subtle hover:text-bone",
              tabClassName
            )}
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 32,
                  mass: 0.8,
                }}
                className="absolute inset-0 bg-surface-raised border border-hairline rounded-[8px] shadow-sm"
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge != null && (
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] tabular-nums font-mono",
                    isActive ? "bg-surface text-bone border border-hairline" : "bg-surface-raised text-subtle"
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
