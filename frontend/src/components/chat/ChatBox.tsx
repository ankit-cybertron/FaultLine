import React, { useState, useRef, useEffect } from "react"
import { Send, Square, Trash2, Bot, User, Sparkles, HelpCircle, ArrowRight, CheckCircle2 } from "lucide-react"
import { cn } from "../../lib/utils"
import type { ChatMessage } from "../../types"

interface ChatBoxProps {
  messages: ChatMessage[]
  isStreaming: boolean
  currentTokens: string
  activeTurnId: string | null
  onSendMessage: (msg: string, forcedInterpretation?: string) => void
  onStopStreaming: () => void
  onClearChat: () => void
  onSelectMessageTurn: (turnId: string) => void
  onSelectCandidate?: (candidateLabel: string) => void
}

const SAMPLE_PROMPTS = [
  "What is apple?",
  "What is 15 * 8?",
  "What is the current UTC time?",
  "Remember that our mission is zero silent LLM failures",
]

export function ChatBox({
  messages,
  isStreaming,
  currentTokens,
  activeTurnId,
  onSendMessage,
  onStopStreaming,
  onClearChat,
  onSelectMessageTurn,
  onSelectCandidate,
}: ChatBoxProps) {
  const [input, setInput] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto scroll to bottom as messages or tokens arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, currentTokens])

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSendMessage(trimmed)
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-full bg-surface border-r border-hairline/80">
      {/* Header */}
      <div className="px-4 py-3 border-b border-hairline flex items-center justify-between shrink-0 bg-surface/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-bone flex items-center gap-1.5">
              <span>FaultLine Live Chat</span>
              <span className="w-2 h-2 rounded-full bg-lichen animate-pulse" />
            </h3>
            <p className="text-[10px] text-muted font-mono">Model: qwen/qwen3.8-27b on Groq</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={onClearChat}
              disabled={isStreaming}
              className="p-1.5 rounded text-muted hover:text-ember hover:bg-surface-raised transition-colors text-[11px] flex items-center gap-1"
              title="Clear Conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-surface-raised border border-hairline flex items-center justify-center mb-3 text-muted shadow-sm">
              <Sparkles className="w-6 h-6 text-indigo-400" />
            </div>
            <h4 className="text-sm font-semibold text-bone mb-1">Live Decision Forensics</h4>
            <p className="text-xs text-muted max-w-sm mb-6 leading-relaxed">
              Chat with the agent. Every disambiguation branch, routing choice, and tool execution builds a vertical decision graph on the right in real time.
            </p>

            <div className="w-full max-w-sm space-y-2 text-left">
              <span className="text-[10px] uppercase font-mono tracking-wider text-muted block mb-1">
                Try a prompt
              </span>
              {SAMPLE_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => onSendMessage(prompt)}
                  className="w-full text-left p-2.5 rounded-lg bg-surface-raised hover:bg-surface-raised/80 border border-hairline hover:border-bone/40 text-xs text-bone/90 transition-all flex items-center justify-between group shadow-sm"
                >
                  <span className="flex items-center gap-2">
                    {prompt === "What is apple?" && (
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                        BRANCH
                      </span>
                    )}
                    <span>{prompt}</span>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-bone group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user"
            const isTurnActive = msg.turnId && msg.turnId === activeTurnId

            return (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-1 max-w-[88%]",
                  isUser ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                <div className="flex items-center gap-1.5 px-1 text-[10px] font-mono text-muted">
                  {isUser ? (
                    <>
                      <span>You</span>
                      <User className="w-3 h-3 text-bone/60" />
                    </>
                  ) : (
                    <>
                      <Bot className="w-3 h-3 text-indigo-400" />
                      <span>FaultLine Agent</span>
                      {msg.latency_s && (
                        <span className="text-[9px] bg-surface-raised px-1.5 py-0.2 rounded border border-hairline">
                          {msg.latency_s.toFixed(2)}s
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div
                  className={cn(
                    "p-3.5 rounded-xl text-xs leading-relaxed shadow-md break-words font-sans",
                    isUser
                      ? "bg-amber-400 text-slate-950 font-semibold rounded-tr-none shadow-amber-400/10"
                      : "bg-[#221f1c] border border-white/15 text-slate-100 rounded-tl-none shadow-lg"
                  )}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>

                  {/* Clarification prompt & interactive candidate selection chips */}
                  {msg.clarify_question && msg.candidates && msg.candidates.length > 0 && (
                    <div className="mt-3 p-3 rounded-xl bg-amber-950/60 border border-amber-500/50 space-y-2.5 w-full shadow-lg">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                        <HelpCircle className="w-4 h-4 text-amber-400" />
                        <span>Clarification Needed:</span>
                      </div>
                      <p className="text-xs text-amber-100 font-sans">
                        {msg.clarify_question}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {msg.candidates.map((c, cIdx) => (
                          <button
                            key={cIdx}
                            disabled={isStreaming}
                            onClick={() => onSelectCandidate?.(c.label)}
                            className="text-left px-3 py-2 rounded-lg bg-black/70 hover:bg-amber-500/20 border border-amber-500/40 hover:border-amber-400 text-xs transition-all flex flex-col gap-0.5 group shadow-sm disabled:opacity-50"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold text-white group-hover:text-amber-300">{c.label}</span>
                              <span className="text-[10px] font-mono text-amber-400/90 bg-amber-950/80 px-1.5 py-0.2 rounded border border-amber-500/30">
                                {Math.round(c.confidence * 100)}%
                              </span>
                            </div>
                            {c.description && (
                              <span className="text-[10px] text-slate-300 line-clamp-1">{c.description}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Turn trace badge button */}
                {!isUser && msg.steps && msg.steps.length > 0 && msg.turnId && (
                  <button
                    onClick={() => onSelectMessageTurn(msg.turnId!)}
                    className={cn(
                      "mt-1 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1.5 transition-all border",
                      isTurnActive
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm"
                        : "bg-surface text-muted border-hairline hover:border-bone/40 hover:text-bone"
                    )}
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span>View Graph ({msg.steps.length} steps)</span>
                  </button>
                )}
              </div>
            )
          })
        )}

        {/* Streaming Assistant Message */}
        {isStreaming && (
          <div className="flex flex-col gap-1 max-w-[88%] mr-auto items-start animate-in fade-in duration-200">
            <div className="flex items-center gap-1.5 px-1 text-[10px] font-mono text-indigo-400">
              <Bot className="w-3 h-3" />
              <span>Generating response...</span>
            </div>
            <div className="p-3.5 rounded-xl rounded-tl-none bg-[#221f1c] border border-indigo-500/50 text-slate-100 text-xs leading-relaxed shadow-lg font-sans">
              <p className="whitespace-pre-wrap">
                {currentTokens || (
                  <span className="text-slate-400 italic flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping inline-block" />
                    Evaluating decision flow and streaming tokens...
                  </span>
                )}

                {currentTokens && <span className="inline-block w-1.5 h-3 ml-0.5 bg-indigo-400 animate-pulse" />}
              </p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div className="p-3 border-t border-hairline bg-surface/95 backdrop-blur-md shrink-0">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="relative flex items-end rounded-xl border border-hairline bg-basalt/60 focus-within:border-bone/60 focus-within:ring-1 focus-within:ring-bone/40 transition-all p-1.5">
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything or request a tool (e.g. math calculation, UTC time, memory)..."
              disabled={isStreaming}
              className="w-full bg-transparent px-2.5 py-1 text-xs text-bone placeholder:text-muted/60 focus:outline-none resize-none font-sans"
            />
            <div className="pb-1 pr-1 shrink-0">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStopStreaming}
                  className="p-2 rounded-lg bg-ember/20 hover:bg-ember/30 text-ember border border-ember/30 transition-all shadow-sm"
                  title="Stop generation"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2 rounded-lg bg-bone text-basalt hover:bg-white disabled:opacity-30 disabled:hover:bg-bone transition-all shadow-sm"
                  title="Send message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between px-1 text-[10px] text-muted">
            <span>Press <kbd className="font-mono bg-surface-raised px-1 py-0.2 rounded border border-hairline">Enter</kbd> to send, <kbd className="font-mono bg-surface-raised px-1 py-0.2 rounded border border-hairline">Shift+Enter</kbd> for newline</span>
            <span>Real-time Groq SSE</span>
          </div>
        </form>
      </div>
    </div>
  )
}
