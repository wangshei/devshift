import React, { useState, useRef, useEffect } from 'react';
import { api, useApi } from '../hooks/useApi';

export default function ChatPanel({ taskId, projectId, taskTitle, onClose, onPushed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [totalCost, setTotalCost] = useState(0);
  const [chatMode, setChatMode] = useState('think'); // think | plan | agent
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskDraft, setTaskDraft] = useState({ title: '', description: '' });
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const { data: credits } = useApi('/credits', [], 30000);

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
        body: JSON.stringify({ taskId, message: text, mode: chatMode, model: chatMode === 'think' ? 'sonnet' : undefined }),
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

  const handleCreateTask = (content) => {
    setTaskDraft({
      title: content.split('\n')[0].slice(0, 100),
      description: content,
    });
    setShowTaskForm(true);
  };

  const handleCreateIdea = async (content) => {
    if (!projectId) return;
    try {
      await api(`/product/${projectId}/ideas`, {
        method: 'POST',
        body: { title: content.split('\n')[0].slice(0, 100), description: content, source: 'chat' },
      });
      setMessages(prev => [...prev, { role: 'system', content: 'Idea saved.' }]);
    } catch {}
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
          {credits && (
            <span className={`text-[9px] font-mono ${
              credits.available <= 0 ? 'text-error' :
              credits.available < 0.5 ? 'text-error animate-pulse' :
              credits.available < 1.5 ? 'text-warning' : 'text-vmuted'
            }`}>
              {credits.available <= 0 ? 'No credits' : `$${credits.available?.toFixed(2) || '?'} left`}
            </span>
          )}
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
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-accent text-white'
                : msg.role === 'system'
                  ? 'bg-transparent text-vmuted italic text-[10px]'
                  : msg.error
                    ? 'bg-error/10 text-error border border-error/20'
                    : 'bg-bg border border-border text-text'
            }`}>
              {msg.loading && !msg.content && (
                <span className="text-xs text-muted animate-pulse">Thinking...</span>
              )}
              {msg.content && (
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
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
            {msg.role === 'assistant' && !msg.loading && !msg.error && (
              <div className="flex gap-1 mt-1">
                <button onClick={() => handleCreateTask(msg.content)}
                  className="text-[9px] text-vmuted hover:text-accent transition-colors">
                  → Create task
                </button>
                <button onClick={() => handleCreateIdea(msg.content)}
                  className="text-[9px] text-vmuted hover:text-accent transition-colors">
                  → Save as idea
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Inline task creation form */}
      {showTaskForm && (
        <div className="border-t border-border px-4 py-3 bg-bg space-y-2 shrink-0">
          <input value={taskDraft.title} onChange={e => setTaskDraft(p => ({...p, title: e.target.value}))}
            placeholder="Task title"
            className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent" />
          <textarea value={taskDraft.description} onChange={e => setTaskDraft(p => ({...p, description: e.target.value}))}
            rows={3} className="w-full bg-card border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent" />
          <div className="flex gap-2">
            <button onClick={async () => {
              await api('/tasks', { method: 'POST', body: { project_id: projectId, title: taskDraft.title, description: taskDraft.description } });
              setShowTaskForm(false);
              setMessages(prev => [...prev, { role: 'system', content: `Task created: ${taskDraft.title}` }]);
            }} className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/80">Create task</button>
            <button onClick={() => setShowTaskForm(false)} className="px-3 py-1.5 text-xs text-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border px-4 py-3 shrink-0 space-y-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={sending ? 'Waiting for response...' : chatMode === 'think' ? 'Brainstorm an idea...' : chatMode === 'plan' ? 'Ask about the codebase...' : 'Tell the agent what to build...'}
            disabled={sending}
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={sending || !input.trim()}
            className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors">
            Send
          </button>
        </div>
        {/* Mode selector */}
        <div className="flex items-center gap-1">
          {[
            { id: 'think', label: 'Think', desc: 'Brainstorm (cheapest)', color: 'text-success' },
            { id: 'plan', label: 'Plan', desc: 'Can read files', color: 'text-accent' },
            { id: 'agent', label: 'Agent', desc: 'Can edit & run', color: 'text-warning' },
          ].map(m => (
            <button key={m.id} onClick={() => setChatMode(m.id)}
              className={`px-2 py-1 text-[10px] rounded transition-colors ${
                chatMode === m.id ? `${m.color} bg-bg border border-border font-medium` : 'text-vmuted hover:text-muted'
              }`}
              title={m.desc}>
              {m.label}
            </button>
          ))}
          <span className="text-[9px] text-vmuted ml-auto">
            {chatMode === 'think' ? '~$0.01/msg' : chatMode === 'plan' ? '~$0.03/msg' : '~$0.08/msg'}
          </span>
        </div>
      </div>
    </div>
  );
}
