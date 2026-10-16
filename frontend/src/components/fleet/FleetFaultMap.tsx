import React from "react"
import { motion } from "motion/react"
import { ClusterGlyph } from "../seismic/ClusterGlyph"
import { CardTilt } from "../animata/CardTilt"
import { useSeismicAudio } from "../../hooks/useSeismicAudio"
import { cn } from "../../lib/utils"
import type { FleetCause } from "../../types"

interface FleetFaultMapProps {
  causes: FleetCause[]
  selectedCause: FleetCause | null
  onSelectCause: (cause: FleetCause) => void
  className?: string
}

export function FleetFaultMap({
  causes,
  selectedCause,
  onSelectCause,
  className,
}: FleetFaultMapProps) {
  const totalRuns = causes.reduce((acc, c) => acc + c.runs, 0) || 1
  const { playClick, playSeismicPing } = useSeismicAudio()

  return (
    <div className={cn("p-5 rounded-[12px] border border-hairline bg-surface/60 space-y-4 chart-paper-grid", className)}>
      <div className="flex items-center justify-between pb-3 border-b border-hairline">
        <div>
          <h3 className="text-xs font-semibold text-bone uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-ember animate-ping" />
            Tectonic Fault Plates (Cluster Map)
          </h3>
          <p className="text-[11px] text-subtle mt-0.5">
            FalkorDB graph queries grouping agent failure paths into common seismic signatures
          </p>
        </div>
        <span className="text-[11px] font-mono text-subtle px-2.5 py-1 rounded bg-surface border border-hairline">
          {causes.length} Plates · {totalRuns} Runs
        </span>
      </div>

      {/* Grid of Tectonic Plates with 3D Tilt */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
        {causes.map((c) => {
          const isSelected = selectedCause?.cause === c.cause
          const percentage = Math.round((c.runs / totalRuns) * 100)

          return (
            <CardTilt
              key={c.cause}
              maxTilt={6}
              glowColor="rgba(255, 90, 54, 0.12)"
              className="rounded-[10px]"
            >
              <motion.button
                type="button"
                onClick={() => {
                  playSeismicPing(true)
                  onSelectCause(c)
                }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "w-full h-full p-4 rounded-[10px] border text-left transition-all relative flex flex-col justify-between overflow-hidden cursor-pointer",
                  isSelected
                    ? "border-ember bg-surface-raised shadow-[0_0_20px_rgba(255,90,54,0.18)] ring-1 ring-ember"
                    : "border-hairline bg-surface hover:border-bone/30 hover:bg-surface-raised/70 shadow-sm"
                )}
              >
                {/* Background percentage fill representation */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 bg-ember/10 pointer-events-none"
                />

                <div className="relative z-10 w-full">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="transition-transform group-hover:rotate-12 duration-300">
                        <ClusterGlyph signature={c.cause} size={32} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-bone font-mono truncate max-w-[170px]">
                          {c.cause}
                        </div>
                        <div className="text-[10px] font-mono text-subtle">
                          {percentage}% of fleet ({c.runs} runs)
                        </div>
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-ember/15 text-ember border border-ember/30 shrink-0">
                      {c.runs} runs
                    </span>
                  </div>

                  <p className="text-xs text-bone/90 line-clamp-2 font-sans mt-2.5 leading-relaxed">
                    {c.fix_summary}
                  </p>
                </div>

                <div className="mt-3.5 pt-2.5 border-t border-hairline flex items-center justify-between text-[10px] font-mono text-subtle relative z-10 w-full">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-lichen" />
                    <span>Fix Rate: {Math.round((c.success_rate ?? 1) * 100)}%</span>
                  </span>
                  {c.is_synthetic && (
                    <span className="px-1.5 py-0.5 rounded bg-ochre/15 text-ochre border border-ochre/30">
                      Synthetic
                    </span>
                  )}
                </div>
              </motion.button>
            </CardTilt>
          )
        })}
      </div>
    </div>
  )
}

