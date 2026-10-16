import React, { useState, useEffect, useRef } from "react"
import { motion } from "motion/react"
import { Play, Pause, RotateCcw, FastForward, Sparkles } from "lucide-react"
import { cn } from "../../lib/utils"
import { useSeismicAudio } from "../../hooks/useSeismicAudio"
import type { Step } from "../../types"

interface TraceScrubberProps {
  steps: Step[]
  currentStepIdx: number
  onStepChange: (idx: number) => void
  className?: string
}

export function TraceScrubber({
  steps,
  currentStepIdx,
  onStepChange,
  className,
}: TraceScrubberProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const timerRef = useRef<number | null>(null)

  const { playClick } = useSeismicAudio()
  const maxIdx = Math.max(0, steps.length - 1)

  useEffect(() => {
    if (isPlaying) {
      const interval = Math.max(300, 1000 / speed)
      timerRef.current = window.setInterval(() => {
        onStepChange(currentStepIdx >= maxIdx ? 0 : currentStepIdx + 1)
        playClick(700 + currentStepIdx * 60)
      }, interval)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPlaying, currentStepIdx, maxIdx, speed, onStepChange, playClick])

  const cycleSpeed = () => {
    const nextSpeed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1
    setSpeed(nextSpeed)
    playClick(1100)
  }

  const handleSliderChange = (newVal: number) => {
    if (newVal !== currentStepIdx) {
      playClick(650 + newVal * 50)
      onStepChange(newVal)
    }
  }

  return (
    <div className={cn("p-3 rounded-lg border border-hairline bg-surface/90 backdrop-blur-sm flex items-center gap-4 text-xs font-mono shadow-md", className)}>
      {/* Controls */}
      <div className="flex items-center gap-1.5">
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          type="button"
          onClick={() => {
            playClick(900)
            setIsPlaying(!isPlaying)
          }}
          className={cn(
            "p-2 rounded-md border transition-all cursor-pointer",
            isPlaying
              ? "bg-ember/20 border-ember/60 text-ember shadow-[0_0_10px_rgba(255,90,54,0.3)]"
              : "bg-surface-raised hover:bg-surface border-hairline text-bone"
          )}
          title={isPlaying ? "Pause scrub" : "Play step-by-step"}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          type="button"
          onClick={() => {
            playClick(600)
            onStepChange(0)
          }}
          className="p-2 rounded-md bg-surface-raised hover:bg-surface border border-hairline text-subtle hover:text-bone transition-colors cursor-pointer"
          title="Reset to step 0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </motion.button>

        <button
          type="button"
          onClick={cycleSpeed}
          className="px-2 py-1 rounded-md bg-surface-raised hover:bg-surface border border-hairline text-[10px] text-subtle hover:text-bone font-mono transition-colors"
          title="Toggle playback speed (0.5x, 1x, 2x)"
        >
          {speed}x
        </button>
      </div>

      {/* Progress Slider */}
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px] text-subtle font-sans">
          <span className="flex items-center gap-1.5">
            <span className={cn("w-1.5 h-1.5 rounded-full", isPlaying ? "bg-ember animate-ping" : "bg-lichen")} />
            <span>Time-travel scrubber</span>
          </span>
          <span className="text-bone font-mono font-medium">
            Step {currentStepIdx} of {maxIdx}
          </span>
        </div>

        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={maxIdx}
            value={currentStepIdx}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            className="w-full h-1.5 bg-surface-raised rounded-lg appearance-none cursor-pointer accent-ember transition-all"
          />
        </div>
      </div>

      {/* Step Indicator Badge */}
      <motion.div
        key={currentStepIdx}
        initial={{ scale: 0.9, opacity: 0.8 }}
        animate={{ scale: 1, opacity: 1 }}
        className="px-2.5 py-1 rounded-[6px] bg-surface-raised border border-hairline font-mono font-medium text-bone tabular-nums shadow-sm shrink-0"
      >
        #{currentStepIdx}
      </motion.div>
    </div>
  )
}

