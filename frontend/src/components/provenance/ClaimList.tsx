import React, { useRef } from "react"
import { Check, X, HelpCircle, ArrowUpRight } from "lucide-react"
import { cn } from "../../lib/utils"
import type { Claim } from "../../types"

interface ClaimListProps {
  claims: Claim[]
  onVerify?: () => void
  isVerifying?: boolean
  onSelectStep?: (idx: number) => void
  onHoverClaim?: (claim: Claim | null, el: HTMLElement | null) => void
  className?: string
}

export function ClaimList({
  claims,
  onVerify,
  isVerifying = false,
  onSelectStep,
  onHoverClaim,
  className,
}: ClaimListProps) {
  return (
    <div className={cn("p-4 rounded-xl border border-border bg-panel space-y-3", className)}>
      <div className="flex items-center justify-between pb-2 border-b border-border/80">
        <div>
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider font-mono">
            Atomic Claim Verification
          </h3>
          <p className="text-[11px] text-muted">
            Ground truth validation against upstream graph outputs
          </p>
        </div>

        {onVerify && (
          <button
            type="button"
            onClick={onVerify}
            disabled={isVerifying}
            className="px-2.5 py-1 rounded-[6px] bg-surface hover:bg-surface-raised border border-hairline hover:border-ember/40 text-[11px] font-mono text-bone transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isVerifying ? "Verifying..." : "Run Checker"}
          </button>
        )}
      </div>

      {claims.length === 0 ? (
        <div className="py-6 text-center text-xs font-mono text-muted">
          No claims checked yet. Click "Run Checker" to extract and verify atomic claims.
        </div>
      ) : (
        <div className="space-y-2">
          {claims.map((claim, idx) => {
            const isSupported = claim.supported
            const badgeClass = isSupported
              ? "text-status-success bg-status-success/10 border-status-success/30"
              : "text-status-failure bg-status-failure/10 border-status-failure/40"

            const glyph = isSupported ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />

            return (
              <div
                key={`claim-${idx}`}
                onMouseEnter={(e) => onHoverClaim?.(claim, e.currentTarget)}
                onMouseLeave={() => onHoverClaim?.(null, null)}
                onFocus={(e) => onHoverClaim?.(claim, e.currentTarget)}
                onBlur={() => onHoverClaim?.(null, null)}
                tabIndex={0}
                className={cn(
                  "p-3 rounded-lg border transition-all text-xs focus:outline-none select-none",
                  isSupported
                    ? "border-border bg-sidebar/80 hover:border-status-success/40"
                    : "border-status-failure/40 bg-status-failure/5 hover:border-status-failure"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1 shrink-0", badgeClass)}>
                    {glyph}
                    <span>{isSupported ? "SUPPORTED IN FLOW" : "UNGROUNDED / HALLUCINATED"}</span>
                  </span>

                  {claim.supported_by && claim.supported_by.length > 0 && (
                    <div className="flex items-center gap-1">
                      {claim.supported_by.map((stepIdx) => (
                        <button
                          key={stepIdx}
                          type="button"
                          onClick={() => onSelectStep?.(stepIdx)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface hover:bg-surface-raised border border-hairline text-lichen flex items-center gap-0.5"
                        >
                          <span>Step #{stepIdx}</span>
                          <ArrowUpRight className="w-2.5 h-2.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-foreground/90 font-medium leading-normal">
                  {claim.text}
                </div>

                {claim.unsupported_reason && (
                  <div className="mt-1.5 text-[11px] font-mono text-status-failure/90">
                    Reason: {claim.unsupported_reason}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
