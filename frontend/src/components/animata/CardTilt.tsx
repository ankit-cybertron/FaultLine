import React, { useRef, useState } from "react"
import { motion, useSpring } from "motion/react"
import { cn } from "../../lib/utils"

interface CardTiltProps {
  children: React.ReactNode
  maxTilt?: number
  glowColor?: string
  className?: string
  style?: React.CSSProperties
}

export function CardTilt({
  children,
  maxTilt = 7,
  glowColor = "rgba(255, 90, 54, 0.08)",
  className,
  style,
}: CardTiltProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [spotlightPos, setSpotlightPos] = useState({ x: 0, y: 0 })

  const springConfig = { damping: 20, stiffness: 200 }
  const rotateX = useSpring(0, springConfig)
  const rotateY = useSpring(0, springConfig)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const tiltX = ((y - centerY) / centerY) * -maxTilt
    const tiltY = ((x - centerX) / centerX) * maxTilt

    rotateX.set(tiltX)
    rotateY.set(tiltY)
    setSpotlightPos({ x, y })
  }

  const handleMouseEnter = () => {
    setIsHovered(true)
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transformStyle: "preserve-3d",
        rotateX,
        rotateY,
        ...style,
      }}
      className={cn("relative transition-shadow duration-300", className)}
    >
      {/* Specular glare overlay */}
      {isHovered && (
        <div
          className="pointer-events-none absolute -inset-px rounded-[inherit] opacity-100 transition-opacity duration-300 z-10"
          style={{
            background: `radial-gradient(400px circle at ${spotlightPos.x}px ${spotlightPos.y}px, ${glowColor}, transparent 70%)`,
          }}
        />
      )}
      {children}
    </motion.div>
  )
}
