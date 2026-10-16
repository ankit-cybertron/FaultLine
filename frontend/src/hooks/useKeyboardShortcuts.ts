import { useEffect } from "react"

interface ShortcutHandlers {
  onNextStep?: () => void
  onPrevStep?: () => void
  onFocusClaims?: () => void
  onToggleInspector?: () => void
  onOpenCommandPalette?: () => void
  onShowShortcutsHelp?: () => void
}

export function useKeyboardShortcuts({
  onNextStep,
  onPrevStep,
  onFocusClaims,
  onToggleInspector,
  onOpenCommandPalette,
  onShowShortcutsHelp,
}: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input or textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return
      }

      if (e.key === "j") {
        e.preventDefault()
        onNextStep?.()
      } else if (e.key === "k") {
        e.preventDefault()
        onPrevStep?.()
      } else if (e.key === "c") {
        e.preventDefault()
        onFocusClaims?.()
      } else if (e.key === "i") {
        e.preventDefault()
        onToggleInspector?.()
      } else if (e.key === "?") {
        e.preventDefault()
        onShowShortcutsHelp?.()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    onNextStep,
    onPrevStep,
    onFocusClaims,
    onToggleInspector,
    onOpenCommandPalette,
    onShowShortcutsHelp,
  ])
}
