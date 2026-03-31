import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { PageSkeleton } from '../components/Skeleton';
import ChatPanel from '../components/ChatPanel';

export default function MyWork() {
  const navigate = useNavigate();
  const { data, refetch } = useApi('/my-work', [], 5000);
  const [chatTask, setChatTask] = useState(null);
  const toast = useToast();

  useEffect(() => {
    const handleEscape = () => setChatTask(null);
    window.addEventListener('devshift:escape', handleEscape);
    return () => window.removeEventListener('devshift:escape', handleEscape);
  }, []);

  if (!data) return <PageSkeleton cards={4} />;

  const { activeWork, planReviews, codeReviews, analyses, humanTasks, failed, recentlyCompleted, counts } = data;

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      {/* Chat panel overlay */}
      {chatTask && (
        <div className="fixed inset-y-0 right-0 w-96 z-50 shadow-xl">
          <ChatPanel
            taskId={chatTask.id}
            projectId={chatTask.project_id}
            taskTitle={chatTask.title}
            onClose={() => setChatTask(null)}
            onPushed={() => { setChatTask(null); refetch(); }}
          />
        </div>
      )}

      <h1 className="text-lg font-semibold">My Work</h1>

      {/* Active work */}
      <section>
        <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-2">
          Your active work ({counts.activeWork})
        </h2>
        {activeWork.length === 0 ? (
          <p className="text-xs text-vmuted py-4">No active work. Pick a task below to start.</p>
        ) : (
          <div className="space-y-2">
            {activeWork.map(t => (
              <ActiveWorkCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} toast={toast} />
            ))}
          </div>
        )}
      </section>

      {/* Needs attention */}
      {counts.needsAttention > 0 && (
        <section>
          <h2 className="text-xs font-mono text-warning uppercase tracking-wider mb-2">
            Needs your attention ({counts.needsAttention})
          </h2>
          <div className="space-y-1.5">
            {planReviews.length > 0 && (
              <AttentionGroup label="Plans to approve" items={planReviews} type="plan" navigate={navigate} onChat={setChatTask} />
            )}
            {codeReviews.length > 0 && (
              <AttentionGroup label="Code to review" items={codeReviews} type="review" navigate={navigate} onChat={setChatTask} />
            )}
            {analyses.length > 0 && (
              <AttentionGroup label="Analysis results" items={analyses} type="analysis" navigate={navigate} onChat={setChatTask} />
            )}
            {humanTasks.length > 0 && (
              <AttentionGroup label="Tasks for you" items={humanTasks} type="human" navigate={navigate} onChat={setChatTask} />
            )}
            {failed.length > 0 && (
              <AttentionGroup label="Failed" items={failed} type="failed" navigate={navigate} onChat={setChatTask} />
            )}
          </div>
        </section>
      )}

      {/* Recently completed */}
      {recentlyCompleted.length > 0 && (
        <section>
          <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-2">
            Recently completed ({counts.recentlyCompleted})
          </h2>
          <div className="space-y-1">
            {recentlyCompleted.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 bg-card border border-border rounded-lg text-xs">
                <span className="text-success">✓</span>
                <span className="text-text flex-1 truncate">{t.title}</span>
                <span className="text-vmuted font-mono">{t.project_name}</span>
                <span className="text-vmuted font-mono">
                  {t.worker?.startsWith('human') ? 'you' : 'agent'}
                </span>
                {t.actual_minutes != null && (
                  <span className="text-vmuted font-mono">{t.actual_minutes}m</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ActiveWorkCard({ task, onAction, onChat, toast }) {
  const [handoffNote, setHandoffNote] = useState('');
  const [acting, setActing] = useState(false);

  const handleContinue = async () => {
    try {
      await api(`/tasks/${task.id}/takeover`, { method: 'POST' });
    } catch (e) {
      toast?.error(e.message);
    }
  };

  const handleHandoff = async (done) => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/handoff`, { method: 'POST', body: { note: handoffNote, done } });
      onAction?.();
    } catch {}
    finally { setActing(false); }
  };

  return (
    <div className="bg-card border border-accent/20 rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        <span className="text-sm text-text flex-1">{task.title}</span>
        <span className="text-[10px] font-mono text-vmuted">{task.project_name}</span>
      </div>
      {task.branch_name && (
        <p className="text-[10px] font-mono text-vmuted">branch: {task.branch_name}</p>
      )}
      <div className="flex items-center gap-2">
        <button onClick={handleContinue}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium">
          Continue in terminal
        </button>
        {onChat && (
          <button onClick={() => onChat(task)}
            className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
            Chat
          </button>
        )}
        <input value={handoffNote} onChange={e => setHandoffNote(e.target.value)}
          placeholder="Note for agent (optional)"
          className="flex-1 bg-bg border border-border rounded px-2 py-1.5 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent" />
        <button onClick={() => handleHandoff(false)} disabled={acting}
          className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
          Hand off
        </button>
        <button onClick={() => handleHandoff(true)} disabled={acting}
          className="px-3 py-1.5 text-xs bg-success text-white rounded-lg hover:bg-success/80 transition-colors">
          Done
        </button>
      </div>
    </div>
  );
}

function AttentionGroup({ label, items, type, navigate, onChat }) {
  const colors = {
    plan: 'text-accent',
    review: 'text-warning',
    analysis: 'text-research',
    human: 'text-muted',
    failed: 'text-error',
  };
  const icons = {
    plan: '◇',
    review: '▸',
    analysis: '◆',
    human: '○',
    failed: '✕',
  };

  return (
    <div>
      <p className={`text-[10px] font-mono ${colors[type]} mb-1`}>{label}</p>
      {items.map(t => (
        <div key={t.id} className="flex items-center gap-1 mb-1">
          <button
            onClick={() => navigate(`/project/${t.project_id}`)}
            className="flex-1 flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg hover:border-accent/20 transition-colors text-left">
            <span className={`text-xs ${colors[type]}`}>{icons[type]}</span>
            <span className="text-xs text-text flex-1 truncate">{t.title}</span>
            <span className="text-[10px] font-mono text-vmuted">{t.project_name}</span>
          </button>
          {onChat && (
            <button
              onClick={() => onChat(t)}
              className="px-2.5 py-2 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors shrink-0">
              Chat
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
