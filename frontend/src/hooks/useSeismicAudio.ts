import { useState, useEffect, useCallback } from "react"

// Pure client-side Web Audio API synthesizer for tactile "flight recorder" instrumentation
class SeismicAudioEngine {
  private ctx: AudioContext | null = null
  public enabled: boolean = false

  private initContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume()
    }
  }

  public playClick(freq = 900) {
    if (!this.enabled) return
    this.initContext()
    if (!this.ctx) return

    try {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = "sine"
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, this.ctx.currentTime + 0.04)

      gain.gain.setValueAtTime(0.04, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.04)

      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.05)
    } catch {
      // AudioContext policy safe
    }
  }

  public playSeismicPing(isError = false) {
    if (!this.enabled) return
    this.initContext()
    if (!this.ctx) return

    try {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      if (isError) {
        // Deep resonant seismic thud
        osc.type = "triangle"
        osc.frequency.setValueAtTime(140, this.ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(45, this.ctx.currentTime + 0.35)

        gain.gain.setValueAtTime(0.12, this.ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35)
      } else {
        // Delicate harmonic chime
        osc.type = "sine"
        osc.frequency.setValueAtTime(520, this.ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(780, this.ctx.currentTime + 0.15)

        gain.gain.setValueAtTime(0.06, this.ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.22)
      }

      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + (isError ? 0.38 : 0.24))
    } catch {
      // Audio policy safe
    }
  }
}

export const audioEngine = new SeismicAudioEngine()

export function useSeismicAudio() {
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("faultline_audio_fx") === "true"
    }
    return false
  })

  useEffect(() => {
    audioEngine.enabled = soundEnabled
    if (typeof window !== "undefined") {
      localStorage.setItem("faultline_audio_fx", String(soundEnabled))
    }
  }, [soundEnabled])

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev
      audioEngine.enabled = next
      if (next) audioEngine.playClick(800)
      return next
    })
  }, [])

  const playClick = useCallback((freq?: number) => {
    audioEngine.playClick(freq)
  }, [])

  const playSeismicPing = useCallback((isError?: boolean) => {
    audioEngine.playSeismicPing(isError)
  }, [])

  return { soundEnabled, toggleSound, playClick, playSeismicPing }
}
