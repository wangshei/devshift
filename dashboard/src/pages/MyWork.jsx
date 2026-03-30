import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';

export default function MyWork() {
  const navigate = useNavigate();
  const { data, refetch } = useApi('/my-work', null, 5000);

  if (!data) return <div className="px-6 py-6 text-muted animate-pulse text-sm">Loading...</div>;

  const { activeWork, planReviews, codeReviews, analyses, humanTasks, failed, recentlyCompleted, counts } = data;

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
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
              <ActiveWorkCard key={t.id} task={t} onAction={refetch} />
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
              <AttentionGroup label="Plans to approve" items={planReviews} type="plan" navigate={navigate} />
            )}
            {codeReviews.length > 0 && (
              <AttentionGroup label="Code to review" items={codeReviews} type="review" navigate={navigate} />
            )}
            {analyses.length > 0 && (
              <AttentionGroup label="Analysis results" items={analyses} type="analysis" navigate={navigate} />
            )}
            {humanTasks.length > 0 && (
              <AttentionGroup label="Tasks for you" items={humanTasks} type="human" navigate={navigate} />
            )}
            {failed.length > 0 && (
              <AttentionGroup label="Failed" items={failed} type="failed" navigate={navigate} />
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

function ActiveWorkCard({ task, onAction }) {
  const [handoffNote, setHandoffNote] = useState('');
  const [acting, setActing] = useState(false);

  const handleContinue = async () => {
    try {
      await api(`/tasks/${task.id}/takeover`, { method: 'POST' });
    } catch (e) {
      alert(e.message);
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

function AttentionGroup({ label, items, type, navigate }) {
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
        <button key={t.id}
          onClick={() => navigate(`/project/${t.project_id}`)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg hover:border-accent/20 transition-colors text-left mb-1">
          <span className={`text-xs ${colors[type]}`}>{icons[type]}</span>
          <span className="text-xs text-text flex-1 truncate">{t.title}</span>
          <span className="text-[10px] font-mono text-vmuted">{t.project_name}</span>
        </button>
      ))}
    </div>
  );
}
