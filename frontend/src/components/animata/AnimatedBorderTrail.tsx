import React from "react"
import { cn } from "../../lib/utils"

interface AnimatedBorderTrailProps extends React.HTMLAttributes<HTMLDivElement> {
  duration?: string
  trailColor?: "ember" | "lichen" | "neutral" | "red" | "blue"
  contentClassName?: string
  active?: boolean
}

export function AnimatedBorderTrail({
  children,
  className,
  duration = "5s",
  trailColor = "ember",
  contentClassName,
  active = true,
  ...props
}: AnimatedBorderTrailProps) {
  if (!active) {
    return (
      <div className={cn("relative rounded-[10px] border border-hairline bg-surface", className)} {...props}>
        <div className={cn("relative z-10", contentClassName)}>{children}</div>
      </div>
    )
  }

  const gradientClass =
    trailColor === "lichen"
      ? "from-lichen via-lime-500 to-transparent"
      : trailColor === "neutral"
      ? "from-bone/50 via-bone/20 to-transparent"
      : "from-ember via-[#FF8A65] to-transparent"

  return (
    <div
      className={cn(
        "relative rounded-[10px] p-[1px] overflow-hidden border border-hairline/80 group",
        className
      )}
      {...props}
    >
      {/* Rotating border trail */}
      <div
        className={cn(
          "absolute inset-[-150%] bg-gradient-to-r opacity-90 transition-opacity",
          gradientClass
        )}
        style={{
          animation: `trailRotate ${duration} linear infinite`,
        }}
      />
      <div className={cn("relative z-10 rounded-[9px] bg-surface", contentClassName)}>
        {children}
      </div>
    </div>
  )
}
