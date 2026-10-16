import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Copy, Check, RefreshCw, Command, Play, Sun, Moon, Volume2, VolumeX, Sparkles } from "lucide-react"
import { cn } from "../../lib/utils"
import { useSeismicAudio } from "../../hooks/useSeismicAudio"

interface TopBarProps {
  pageTitle: string
  activeRunId: string | null
  onRefresh: () => void
  onOpenCommandPalette: () => void
  onOpenRunModal: () => void
  className?: string
}

export function TopBar({
  pageTitle,
  activeRunId,
  onRefresh,
  onOpenCommandPalette,
  onOpenRunModal,
  className,
}: TopBarProps) {
  const [copied, setCopied] = useState(false)
  const [isLightMode, setIsLightMode] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { soundEnabled, toggleSound, playClick } = useSeismicAudio()

  useEffect(() => {
    const saved = localStorage.getItem("faultline-theme")
    if (saved === "light") {
      setIsLightMode(true)
      document.body.classList.add("light")
    }
  }, [])

  const toggleTheme = () => {
    playClick(1000)
    if (isLightMode) {
      document.body.classList.remove("light")
      localStorage.setItem("faultline-theme", "dark")
      setIsLightMode(false)
    } else {
      document.body.classList.add("light")
      localStorage.setItem("faultline-theme", "light")
      setIsLightMode(true)
    }
  }

  const handleCopyRunId = () => {
    if (activeRunId) {
      navigator.clipboard.writeText(activeRunId)
      playClick(1200)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleRefreshClick = () => {
    playClick(800)
    setIsRefreshing(true)
    onRefresh()
    setTimeout(() => setIsRefreshing(false), 600)
  }

  return (
    <header
      className={cn(
        "h-14 border-b border-hairline bg-surface/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 select-none",
        className
      )}
    >
      {/* Breadcrumb & Active Run Chip */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 text-xs font-sans">
          <span className="text-subtle">FaultLine</span>
          <span className="text-hairline">/</span>
          <motion.span
            key={pageTitle}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-bone font-medium"
          >
            {pageTitle}
          </motion.span>
        </div>

        {activeRunId && (
          <div className="flex items-center gap-1.5 pl-3 border-l border-hairline">
            <button
              type="button"
              onClick={handleCopyRunId}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] bg-surface-raised border border-hairline font-mono text-[11px] text-bone hover:border-ember/40 hover:bg-surface transition-all group"
              title="Click to copy active run ID"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-ember animate-pulse" />
              <span className="truncate max-w-[130px]">{activeRunId}</span>
              {copied ? (
                <Check className="w-3 h-3 text-lichen" />
              ) : (
                <Copy className="w-3 h-3 text-subtle group-hover:text-bone transition-transform group-hover:scale-110" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Right Actions: Sound Synthesizer, Run Agent trigger, Refresh, Theme Toggle, Command Palette */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Tactile Audio Synth Equalizer Visualizer */}
        <button
          type="button"
          onClick={toggleSound}
          title={soundEnabled ? "Flight recorder audio active (click to mute)" : "Enable tactile seismic synth audio"}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-[6px] border text-xs font-mono transition-all",
            soundEnabled
              ? "border-ember/50 text-ember bg-ember/10 shadow-[0_0_10px_rgba(255,90,54,0.15)]"
              : "border-hairline text-subtle hover:text-bone hover:bg-surface-raised"
          )}
        >
          {soundEnabled ? (
            <>
              <Volume2 className="w-3.5 h-3.5" />
              {/* Dancing mini EQ bars */}
              <div className="flex items-end gap-0.5 h-2.5">
                <span className="w-0.5 bg-ember rounded-full animate-[pulse_0.6s_ease-in-out_infinite] h-2" />
                <span className="w-0.5 bg-ember rounded-full animate-[pulse_0.4s_ease-in-out_infinite_0.1s] h-2.5" />
                <span className="w-0.5 bg-ember rounded-full animate-[pulse_0.7s_ease-in-out_infinite_0.2s] h-1.5" />
              </div>
            </>
          ) : (
            <>
              <VolumeX className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[10px]">MUTE</span>
            </>
          )}
        </button>

        {/* Primary Run Agent Trigger Button with Ripple */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          type="button"
          onClick={() => {
            playClick(900)
            onOpenRunModal()
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-surface-raised hover:bg-surface border border-hairline hover:border-ember/60 text-bone text-xs font-sans transition-colors group shadow-sm"
          title="Run agent pipeline"
        >
          <Play className="w-3 h-3 text-ember fill-ember group-hover:scale-110 transition-transform" />
          <span className="hidden sm:inline font-medium text-[11px]">Run Agent</span>
        </motion.button>

        {/* Command Palette Trigger */}
        <button
          type="button"
          onClick={() => {
            playClick(850)
            onOpenCommandPalette()
          }}
          className="flex items-center gap-2 px-2.5 py-1 rounded-[6px] bg-surface-raised border border-hairline text-subtle hover:text-bone hover:border-bone/30 text-xs font-mono transition-all"
          title="Open command palette (⌘K)"
        >
          <Command className="w-3 h-3" />
          <span className="hidden sm:inline text-[11px]">⌘K</span>
        </button>

        {/* Refresh Action with Spin Animation */}
        <button
          type="button"
          onClick={handleRefreshClick}
          className="p-1.5 rounded-[6px] text-subtle hover:text-bone hover:bg-surface-raised transition-colors"
          title="Refresh active state"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 transition-transform duration-500", isRefreshing && "rotate-180 text-ember")} />
        </button>

        {/* Chart Paper Light/Dark Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 rounded-[6px] text-subtle hover:text-bone hover:bg-surface-raised transition-colors"
          title={isLightMode ? "Switch to Basalt dark mode" : "Switch to Chart Paper light mode"}
        >
          {isLightMode ? <Moon className="w-3.5 h-3.5 text-bone" /> : <Sun className="w-3.5 h-3.5 text-ochre" />}
        </button>
      </div>
    </header>
  )
}

