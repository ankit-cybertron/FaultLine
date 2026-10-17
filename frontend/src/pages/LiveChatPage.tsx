import React, { useState, useRef, useCallback } from "react"
import { ChatBox } from "../components/chat/ChatBox"
import { VerticalLiveGraph } from "../components/chat/VerticalLiveGraph"
import { useSeismicAudio } from "../hooks/useSeismicAudio"
import type { ChatMessage, ChatStep } from "../types"

export function LiveChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [liveSteps, setLiveSteps] = useState<ChatStep[]>([])
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const [activeStepIdx, setActiveStepIdx] = useState<number | null>(null)
  const [isStreaming, setIsStreaming] = useState<boolean>(false)
  const [currentTokens, setCurrentTokens] = useState<string>("")
  const [sessionId] = useState<string>(() => "sess_" + Math.random().toString(36).substring(2, 9))
  
  // Stats
  const [turnLatency, setTurnLatency] = useState<number | undefined>(undefined)
  const [turnTokens, setTurnTokens] = useState<number | undefined>(undefined)

  const abortControllerRef = useRef<AbortController | null>(null)
  const { playClick, playSeismicPing } = useSeismicAudio()

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return

    const userMsgId = "msg_user_" + Date.now()
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMsg])
    setIsStreaming(true)
    setCurrentTokens("")
    setLiveSteps([])
    setActiveStepIdx(null)
    setTurnLatency(undefined)
    setTurnTokens(undefined)

    const controller = new AbortController()
    abortControllerRef.current = controller

    let accumulatedTokens = ""
    const accumulatedSteps: ChatStep[] = []
    let currentTurnId = ""

    try {
      // POST to /chat/turn endpoint
      const response = await fetch("/chat/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`Chat error HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n\n")
        buffer = lines.pop() || ""

        for (const block of lines) {
          if (!block.trim()) continue

          let eventType = "message"
          let dataStr = ""

          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6).trim()
            }
          }

          if (!dataStr) continue

          try {
            const parsed = JSON.parse(dataStr)

            if (parsed.turn_id && !currentTurnId) {
              currentTurnId = parsed.turn_id
              setActiveTurnId(parsed.turn_id)
            }

            if (eventType === "step") {
              const stepObj = parsed.step as ChatStep
              accumulatedSteps.push(stepObj)
              setLiveSteps([...accumulatedSteps])
              try {
                playClick()
              } catch {}
            } else if (eventType === "token") {
              const token = parsed.token || ""
              accumulatedTokens += token
              setCurrentTokens(accumulatedTokens)
            } else if (eventType === "done") {
              setTurnLatency(parsed.latency_s)
              setTurnTokens(parsed.tokens)
              try {
                playSeismicPing()
              } catch {}
            }
          } catch (err) {
            console.error("Error parsing SSE block:", err, block)
          }
        }
      }

      // Add final assistant message
      const assistantMsg: ChatMessage = {
        id: "msg_ast_" + Date.now(),
        role: "assistant",
        content: accumulatedTokens || "Done.",
        steps: [...accumulatedSteps],
        turnId: currentTurnId,
        latency_s: turnLatency,
        tokens: turnTokens,
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, assistantMsg])
    } catch (err: any) {
      if (err.name === "AbortError") {
        const abortedMsg: ChatMessage = {
          id: "msg_ast_" + Date.now(),
          role: "assistant",
          content: accumulatedTokens + " [Stopped by user]",
          steps: [...accumulatedSteps],
          turnId: currentTurnId,
          timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, abortedMsg])
      } else {
        console.error("Chat request failed:", err)
        const errorMsg: ChatMessage = {
          id: "msg_err_" + Date.now(),
          role: "assistant",
          content: `Error: ${err.message || "Failed to generate response."}`,
          steps: [...accumulatedSteps],
          turnId: currentTurnId,
          timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, errorMsg])
      }
    } finally {
      setIsStreaming(false)
      setCurrentTokens("")
      abortControllerRef.current = null
    }
  }, [isStreaming, sessionId, playClick, playSeismicPing, turnLatency, turnTokens])

  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  const handleClearChat = useCallback(() => {
    setMessages([])
    setLiveSteps([])
    setActiveTurnId(null)
    setActiveStepIdx(null)
    setCurrentTokens("")
    setTurnLatency(undefined)
    setTurnTokens(undefined)
  }, [])

  const handleSelectMessageTurn = useCallback((turnId: string) => {
    const targetMsg = messages.find((m) => m.turnId === turnId)
    if (targetMsg && targetMsg.steps) {
      setActiveTurnId(turnId)
      setLiveSteps(targetMsg.steps)
      setActiveStepIdx(null)
      setTurnLatency(targetMsg.latency_s)
      setTurnTokens(targetMsg.tokens)
    }
  }, [messages])

  return (
    <div className="flex w-full h-[calc(100vh-3.5rem)] overflow-hidden bg-basalt">
      {/* Left Column: Chat Box */}
      <div className="w-[380px] sm:w-[420px] md:w-[480px] lg:w-[520px] h-full shrink-0 flex flex-col">
        <ChatBox
          messages={messages}
          isStreaming={isStreaming}
          currentTokens={currentTokens}
          activeTurnId={activeTurnId}
          onSendMessage={handleSendMessage}
          onStopStreaming={handleStopStreaming}
          onClearChat={handleClearChat}
          onSelectMessageTurn={handleSelectMessageTurn}
        />
      </div>

      {/* Right Column: Vertical Decision Graph Flow Downwards */}
      <div className="flex-1 h-full min-w-0 flex flex-col bg-basalt">
        <VerticalLiveGraph
          steps={liveSteps}
          activeStepIdx={activeStepIdx}
          onSelectStep={setActiveStepIdx}
          isStreaming={isStreaming}
          turnId={activeTurnId || undefined}
          latency_s={turnLatency}
          tokens={turnTokens}
        />
      </div>
    </div>
  )
}
