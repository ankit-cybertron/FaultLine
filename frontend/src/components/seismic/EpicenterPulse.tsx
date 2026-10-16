import React, { useEffect, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { cn } from "../../lib/utils"

interface EpicenterPulseProps {
  active?: boolean
  className?: string
  children?: React.ReactNode
}

export function EpicenterPulse({ active = true, className, children }: EpicenterPulseProps) {
  const [hasFired, setHasFired] = useState(false)

  useEffect(() => {
    if (active && !hasFired) {
      setHasFired(true)
    }
  }, [active, hasFired])

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      <AnimatePresence>
        {active && (
          <>
            {/* Inner shock ring 1 */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0.8 }}
              animate={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="absolute -inset-2 rounded-xl border border-status-failure/80 pointer-events-none"
            />
            {/* Outer shock ring 2 */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0.9 }}
              animate={{ scale: 2.3, opacity: 0 }}
              transition={{ duration: 1.8, ease: "easeOut", delay: 0.15 }}
              className="absolute -inset-3 rounded-2xl border-2 border-status-failure/60 pointer-events-none shadow-[0_0_20px_rgba(248,113,113,0.4)]"
            />
            {/* Glow halo */}
            <div className="absolute inset-0 rounded-xl bg-epicenter blur-md pointer-events-none" />
          </>
        )}
      </AnimatePresence>

      <div className="relative z-10 w-full">{children}</div>
    </div>
  )
}
