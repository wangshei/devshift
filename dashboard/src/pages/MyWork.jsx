import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import ChatPanel from '../components/ChatPanel';
import { useToast } from '../components/Toast';

function humanizeError(error) {
  if (!error) return 'Unknown error';
  if (error.includes('rate_limited')) return 'Rate limited — will auto-retry when credits reset';
  if (error.includes('crashed') || error.includes('auto-recovered')) return 'Agent crashed mid-task — can retry safely';
  if (error.includes('ETIMEDOUT') || error.includes('timed out')) return 'Timed out — task may be too complex, try breaking it down';
  if (error.includes('stdin')) return 'Environment issue — try running manually via Chat';
  if (error.includes('No available provider')) return 'No AI provider available — check Settings';
  if (error.includes('Repo is busy')) return 'Another task was running on this repo — will retry automatically';
  return error.slice(0, 150);
}

export default function MyWork() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, refetch } = useApi('/my-work', [], 5000);
  const [chatTask, setChatTask] = useState(null);

  if (!data) return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
      <div className="h-6 w-24 bg-border/50 rounded animate-pulse" />
      <div className="space-y-4">
        <div className="h-3 w-32 bg-border/50 rounded animate-pulse" />
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-card border border-border rounded-lg px-4 py-3 space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-border/50 animate-pulse" />
              <div className="h-4 bg-border/50 rounded animate-pulse flex-1 max-w-[250px]" />
              <div className="h-3 w-16 bg-border/50 rounded animate-pulse" />
            </div>
            <div className="h-3 bg-border/50 rounded animate-pulse max-w-[180px]" />
          </div>
        ))}
      </div>
    </div>
  );

  const { activeWork, planReviews, codeReviews, analyses, humanTasks, failed, recentlyCompleted, counts } = data;

  // Merge all reviewable items into one queue
  const reviewQueue = [
    ...planReviews.map(t => ({ ...t, _kind: 'plan' })),
    ...codeReviews.map(t => ({ ...t, _kind: 'code' })),
    ...analyses.map(t => ({ ...t, _kind: 'analysis' })),
    ...failed.map(t => ({ ...t, _kind: 'failed' })),
  ];

  // Suggested = human tasks the PM thinks you should work on
  const suggested = humanTasks;

  // Compact recently-done summary
  const agentDone = recentlyCompleted.filter(t => !t.worker?.startsWith('human'));
  const humanDone = recentlyCompleted.filter(t => t.worker?.startsWith('human'));

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
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

      {/* 1. Active sessions */}
      <section>
        <SectionHeader label="Your active sessions" count={activeWork.length} />
        {activeWork.length === 0 ? (
          <p className="text-xs text-vmuted py-3">Nothing active right now.</p>
        ) : (
          <div className="space-y-2">
            {activeWork.map(t => (
              <ActiveSessionCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} toast={toast} />
            ))}
          </div>
        )}
      </section>

      {/* 2. Review queue */}
      {reviewQueue.length > 0 && (
        <section>
          <SectionHeader label="Review queue" count={reviewQueue.length} accent />
          <div className="space-y-2">
            {reviewQueue.map(t => (
              <ReviewCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} navigate={navigate} toast={toast} />
            ))}
          </div>
        </section>
      )}

      {/* 3. Suggested */}
      {suggested.length > 0 && (
        <section>
          <SectionHeader label="Suggested" count={suggested.length} />
          <div className="space-y-1.5">
            {suggested.map(t => (
              <SuggestedCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} toast={toast} />
            ))}
          </div>
        </section>
      )}

      {/* 4. Recently done */}
      {recentlyCompleted.length > 0 && (
        <section>
          <SectionHeader label="Recently done" />
          <div className="px-3 py-2.5 bg-card border border-border rounded-lg">
            <p className="text-xs text-muted">
              {agentDone.length > 0 && (
                <span><span className="text-text font-medium">{agentDone.length}</span> task{agentDone.length !== 1 ? 's' : ''} completed by agent</span>
              )}
              {agentDone.length > 0 && humanDone.length > 0 && <span>, </span>}
              {humanDone.length > 0 && (
                <span><span className="text-text font-medium">{humanDone.length}</span> by you</span>
              )}
              <span className="text-vmuted"> — today</span>
            </p>
            {recentlyCompleted.length <= 8 && (
              <div className="mt-2 space-y-0.5">
                {recentlyCompleted.map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-xs text-vmuted">
                    <span className="text-success text-[10px]">✓</span>
                    <span className="truncate flex-1">{t.title}</span>
                    <span className="font-mono text-[10px] shrink-0">{t.worker?.startsWith('human') ? 'you' : 'agent'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Empty state */}
      {activeWork.length === 0 && reviewQueue.length === 0 && suggested.length === 0 && recentlyCompleted.length === 0 && (
        <div className="text-center py-12 text-vmuted text-sm">
          Nothing needs your attention. All clear.
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label, count, accent }) {
  return (
    <h2 className={`text-xs font-mono uppercase tracking-wider mb-2 ${accent ? 'text-warning' : 'text-vmuted'}`}>
      {label}{count != null ? ` (${count})` : ''}
    </h2>
  );
}

function ActiveSessionCard({ task, onAction, onChat, toast }) {
  const [handoffNote, setHandoffNote] = useState('');
  const [acting, setActing] = useState(false);

  const handleContinue = async () => {
    try {
      await api(`/tasks/${task.id}/takeover`, { method: 'POST' });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleHandoff = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/handoff`, { method: 'POST', body: { note: handoffNote, done: false } });
      onAction?.();
    } catch {}
    finally { setActing(false); }
  };

  return (
    <div className="bg-card border border-accent/30 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        <span className="text-sm text-text flex-1 truncate">{task.title}</span>
        <span className="text-[10px] font-mono text-vmuted">{task.project_name}</span>
      </div>
      {task.branch_name && (
        <p className="text-[10px] font-mono text-vmuted mb-2">branch: {task.branch_name}</p>
      )}
      <div className="flex items-center gap-2">
        <button onClick={handleContinue}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium">
          Continue
        </button>
        <button onClick={handleHandoff} disabled={acting}
          className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
          Hand off
        </button>
        {onChat && (
          <button onClick={() => onChat(task)}
            className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
            Chat
          </button>
        )}
        <input value={handoffNote} onChange={e => setHandoffNote(e.target.value)}
          placeholder="Note for agent..."
          className="flex-1 bg-bg border border-border rounded px-2 py-1.5 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent" />
      </div>
    </div>
  );
}

function ReviewCard({ task, onAction, onChat, navigate, toast }) {
  const [acting, setActing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const kind = task._kind;
  const summary = task.result_summary
    ? task.result_summary.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim().slice(0, 120)
    : null;
  const failedError = kind === 'failed' && task.execution_log ? humanizeError(task.execution_log) : null;

  const handleViewChanges = async () => {
    if (kind === 'plan') {
      navigate(`/project/${task.project_id}`);
      return;
    }
    if (diff) { setShowDiff(!showDiff); return; }
    if (!task.branch_name) {
      navigate(`/project/${task.project_id}`);
      return;
    }
    setLoadingDiff(true);
    try {
      const d = await api(`/tasks/${task.id}/diff`);
      setDiff(d);
      setShowDiff(true);
    } catch {}
    finally { setLoadingDiff(false); }
  };

  const handleApprove = async () => {
    setActing(true);
    try {
      if (kind === 'plan') {
        await api(`/tasks/${task.id}/approve-plan`, { method: 'POST' });
      } else {
        await api(`/tasks/${task.id}/approve`, { method: 'POST' });
      }
      toast.success('Approved');
      onAction?.();
    } catch (e) {
      toast.error(e.message);
    } finally { setActing(false); }
  };

  const handleRetry = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'queued' } });
      onAction?.();
    } catch {}
    finally { setActing(false); }
  };

  const handleDismiss = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/dismiss`, { method: 'POST' });
      onAction?.();
    } catch {}
    finally { setActing(false); }
  };

  const kindLabel = { plan: 'Plan', code: 'Code review', analysis: 'Analysis', failed: 'Failed' }[kind];
  const kindColor = { plan: 'text-accent', code: 'text-warning', analysis: 'text-research', failed: 'text-error' }[kind];
  const borderColor = { plan: 'border-accent/20', code: 'border-warning/20', analysis: 'border-research/20', failed: 'border-error/20' }[kind];

  // Try to show a clean feature-level name
  const displayName = task.feature_name || task.title;
  const changeSummary = failedError
    ? failedError
    : summary && !summary.startsWith('[') && !summary.startsWith('{')
      ? summary
      : task.review_instructions?.slice(0, 120) || null;

  return (
    <div className={`bg-card border ${borderColor} rounded-lg px-4 py-3`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-mono uppercase ${kindColor}`}>{kindLabel}</span>
            <span className="text-[10px] font-mono text-vmuted">{task.project_name}</span>
          </div>
          <p className="text-sm text-text truncate">{displayName}</p>
          {changeSummary && (
            <p className="text-xs text-muted mt-0.5 truncate">{changeSummary}</p>
          )}
        </div>

        {/* Primary actions — always visible, no expanding */}
        <div className="flex items-center gap-1.5 shrink-0">
          {kind === 'failed' ? (
            <>
              <button onClick={handleRetry} disabled={acting}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
                Retry
              </button>
              <button onClick={handleDismiss} disabled={acting}
                className="px-3 py-1.5 text-xs text-error/70 hover:text-error border border-error/20 rounded-lg transition-colors">
                Dismiss
              </button>
            </>
          ) : (
            <>
              <button onClick={handleViewChanges} disabled={loadingDiff}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
                {loadingDiff ? '...' : showDiff ? 'Hide' : 'View changes'}
              </button>
              <button onClick={handleApprove} disabled={acting}
                className="px-3 py-1.5 text-xs bg-success text-white rounded-lg hover:bg-success/80 disabled:opacity-50 transition-colors font-medium">
                {acting ? '...' : 'Approve'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline diff */}
      {showDiff && diff && (
        <div className="mt-3 pt-3 border-t border-border">
          <pre className="text-[11px] font-mono text-muted overflow-x-auto max-h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap">{diff.stat}</pre>
          <pre className="mt-2 text-[11px] font-mono text-muted overflow-x-auto max-h-96 overflow-y-auto leading-relaxed whitespace-pre-wrap">{diff.diff}</pre>
        </div>
      )}
    </div>
  );
}

function SuggestedCard({ task, onAction, onChat, toast }) {
  const [acting, setActing] = useState(false);

  const handleStartWork = async () => {
    setActing(true);
    try {
      const result = await api(`/tasks/${task.id}/start-work`, { method: 'POST' });
      if (result.error) toast.error(result.error);
      onAction?.();
    } catch (e) {
      toast.error(e.message);
    } finally { setActing(false); }
  };

  return (
    <div className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-2.5 hover:border-accent/20 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text truncate">{task.title}</p>
        <span className="text-[10px] font-mono text-vmuted">{task.project_name}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {onChat && (
          <button onClick={() => onChat(task)}
            className="px-2.5 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
            Chat
          </button>
        )}
        <button onClick={handleStartWork} disabled={acting}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors font-medium">
          Work on this
        </button>
      </div>
    </div>
  );
}
