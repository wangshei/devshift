import React, { useState, useRef, useEffect } from 'react';
import { api } from '../hooks/useApi';

function renderContent(content) {
  const parts = content.split(/(@\S+)/g);
  return parts.map((part, i) =>
    /^@\S+$/.test(part)
      ? <span key={i} className="font-mono text-accent font-semibold">{part}</span>
      : <span key={i}>{part}</span>
  );
}

export default function ChatPanel({ taskId, projectId, taskTitle, onClose, onPushed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [totalCost, setTotalCost] = useState(0);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    // Add placeholder for assistant
    setMessages(prev => [...prev, { role: 'assistant', content: '', loading: true, tools: [] }]);

    try {
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, message: text }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'text') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  last.content = event.content;
                  last.loading = false;
                }
                return updated;
              });
            } else if (event.type === 'tool_use') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  last.tools = [...(last.tools || []), { tool: event.tool, input: event.input }];
                }
                return updated;
              });
            } else if (event.type === 'done') {
              if (event.sessionId) setSessionId(event.sessionId);
              if (event.cost) setTotalCost(prev => prev + event.cost);
              if (event.result) {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    last.content = event.result;
                    last.loading = false;
                  }
                  return updated;
                });
              }
            } else if (event.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  last.content = `Error: ${event.error}`;
                  last.loading = false;
                  last.error = true;
                }
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          last.content = `Connection error: ${e.message}`;
          last.loading = false;
          last.error = true;
        }
        return updated;
      });
    } finally {
      setSending(false);
    }
  };

  const handlePushToAgent = async () => {
    if (!taskId) return;
    try {
      await api('/chat/push-to-agent', {
        method: 'POST',
        body: { taskId, sessionId, note: 'Continuing from chat conversation' },
      });
      onPushed?.();
    } catch (e) {
      alert('Push failed: ' + e.message);
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent" />
          <span className="text-sm font-medium text-text">
            {taskTitle ? `Chat: ${taskTitle}` : 'Chat with Claude'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {totalCost > 0 && (
            <span className="text-[10px] font-mono text-vmuted">${totalCost.toFixed(3)}</span>
          )}
          {taskId && sessionId && (
            <button onClick={handlePushToAgent}
              className="px-2 py-1 text-[10px] bg-accent text-white rounded hover:bg-accent/80 transition-colors">
              Push to agent
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="text-vmuted hover:text-muted text-sm">&#x2715;</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-vmuted">Start chatting with Claude.</p>
            <p className="text-[10px] text-vmuted mt-1">Claude can read and edit files in the project.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-accent text-white'
                : msg.error
                  ? 'bg-error/10 text-error border border-error/20'
                  : 'bg-bg border border-border text-text'
            }`}>
              {msg.loading && !msg.content && (
                <span className="text-xs text-muted animate-pulse">Thinking...</span>
              )}
              {msg.content && (
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{renderContent(msg.content)}</p>
              )}
              {msg.tools?.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {msg.tools.map((t, j) => (
                    <p key={j} className="text-[10px] font-mono text-vmuted">
                      {t.tool}: {t.input}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-3 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={sending ? 'Waiting for response...' : 'Type a message...'}
            disabled={sending}
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={sending || !input.trim()}
            className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
