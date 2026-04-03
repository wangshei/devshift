import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import ChatPanel from '../components/ChatPanel';

export default function Chat() {
  const [searchParams] = useSearchParams();
  const { data: sessions, refetch: refetchSessions } = useApi('/chat/sessions', [], 5000);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [creating, setCreating] = useState(false);

  // Auto-select first session or create one
  useEffect(() => {
    if (sessions?.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions]);

  // Handle URL params (e.g., opening chat from a project)
  useEffect(() => {
    const projectId = searchParams.get('project');
    const title = searchParams.get('title');
    if (projectId && sessions && !activeSessionId) {
      handleNewSession(projectId, title || 'Chat');
    }
  }, [searchParams, sessions]);

  const handleNewSession = async (projectId, title) => {
    setCreating(true);
    try {
      const session = await api('/chat/sessions', {
        method: 'POST',
        body: { project_id: projectId || undefined, title: title || 'New chat' },
      });
      refetchSessions();
      setActiveSessionId(session.id);
    } catch {}
    finally { setCreating(false); }
  };

  const handleDeleteSession = async (id) => {
    await api(`/chat/sessions/${id}`, { method: 'DELETE' });
    if (activeSessionId === id) {
      setActiveSessionId(sessions?.find(s => s.id !== id)?.id || null);
    }
    refetchSessions();
  };

  const activeSession = sessions?.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Session sidebar */}
      <div className="w-56 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-3 py-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-mono text-vmuted uppercase tracking-wider">Sessions</span>
          <button onClick={() => handleNewSession()} disabled={creating}
            className="text-xs text-accent hover:text-text transition-colors">
            + New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {sessions?.map(s => (
            <div key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                activeSessionId === s.id ? 'bg-accent/10' : 'hover:bg-hover'
              }`}>
              <div className="flex-1 min-w-0">
                <p className={`text-xs truncate ${activeSessionId === s.id ? 'text-text font-medium' : 'text-muted'}`}>
                  {s.title}
                </p>
                {s.last_message && (
                  <p className="text-[10px] text-vmuted truncate">{s.last_message.slice(0, 40)}</p>
                )}
                {s.project_name && (
                  <p className="text-[9px] text-vmuted font-mono">{s.project_name}</p>
                )}
              </div>
              <button onClick={e => { e.stopPropagation(); handleDeleteSession(s.id); }}
                className="hidden group-hover:block text-vmuted hover:text-error text-xs">x</button>
            </div>
          ))}
          {(!sessions || sessions.length === 0) && (
            <p className="text-xs text-vmuted text-center py-8">No sessions yet</p>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1">
        {activeSession ? (
          <ChatPanel
            key={activeSessionId}
            taskId={activeSession.task_id}
            projectId={activeSession.project_id}
            taskTitle={activeSession.title}
            dbSessionId={activeSessionId}
            initialSessionId={activeSession.claude_session_id}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-muted text-sm">Start a conversation</p>
              <button onClick={() => handleNewSession()}
                className="mt-2 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/80">
                + New chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
