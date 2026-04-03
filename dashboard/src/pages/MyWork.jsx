import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import ChatPanel from '../components/ChatPanel';

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
  const { data, refetch } = useApi('/my-work', [], 5000);
  const [chatTask, setChatTask] = useState(null);

  if (!data) return <div className="px-6 py-10 text-muted animate-pulse text-sm">Loading...</div>;

  const { activeWork, planReviews, codeReviews, analyses, humanTasks, failed, recentlyCompleted } = data;

  const reviewQueue = [
    ...planReviews.map(t => ({ ...t, _kind: 'plan' })),
    ...codeReviews.map(t => ({ ...t, _kind: 'code' })),
    ...analyses.map(t => ({ ...t, _kind: 'analysis' })),
    ...failed.map(t => ({ ...t, _kind: 'failed' })),
  ];

  const suggested = humanTasks;
  const agentDone = recentlyCompleted.filter(t => !t.worker?.startsWith('human'));
  const humanDone = recentlyCompleted.filter(t => t.worker?.startsWith('human'));
  const isEmpty = activeWork.length === 0 && reviewQueue.length === 0 && suggested.length === 0 && recentlyCompleted.length === 0;

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
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

      <div className="mb-8">
        <h1 className="text-lg font-semibold text-text">My Work</h1>
        {!isEmpty && (
          <p className="text-xs text-muted mt-1">
            {reviewQueue.length > 0 && <span>{reviewQueue.length} to review</span>}
            {reviewQueue.length > 0 && activeWork.length > 0 && <span> · </span>}
            {activeWork.length > 0 && <span>{activeWork.length} active</span>}
            {(reviewQueue.length > 0 || activeWork.length > 0) && suggested.length > 0 && <span> · </span>}
            {suggested.length > 0 && <span>{suggested.length} suggested</span>}
          </p>
        )}
      </div>

      <div className="space-y-10">
        {/* 1. Active sessions */}
        {activeWork.length > 0 && (
          <section>
            <SectionHeader label="Active sessions" count={activeWork.length} />
            <div className="space-y-3">
              {activeWork.map(t => (
                <ActiveSessionCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} />
              ))}
            </div>
          </section>
        )}

        {/* 2. Review queue */}
        {reviewQueue.length > 0 && (
          <section>
            <SectionHeader label="Needs review" count={reviewQueue.length} accent />
            <div className="space-y-3">
              {reviewQueue.map(t => (
                <ReviewCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} navigate={navigate} />
              ))}
            </div>
          </section>
        )}

        {/* 3. Suggested */}
        {suggested.length > 0 && (
          <section>
            <SectionHeader label="Suggested next" count={suggested.length} />
            <div className="space-y-2">
              {suggested.map(t => (
                <SuggestedCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} />
              ))}
            </div>
          </section>
        )}

        {/* 4. Recently done */}
        {recentlyCompleted.length > 0 && (
          <section>
            <SectionHeader label="Recently done" />
            <div className="bg-card border border-border rounded-lg px-4 py-3">
              <p className="text-xs text-muted leading-relaxed">
                {agentDone.length > 0 && (
                  <span><span className="text-text font-medium">{agentDone.length}</span> completed by agent</span>
                )}
                {agentDone.length > 0 && humanDone.length > 0 && <span>, </span>}
                {humanDone.length > 0 && (
                  <span><span className="text-text font-medium">{humanDone.length}</span> by you</span>
                )}
                <span className="text-vmuted"> — today</span>
              </p>
              {recentlyCompleted.length <= 8 && (
                <div className="mt-2.5 space-y-1">
                  {recentlyCompleted.map(t => (
                    <div key={t.id} className="flex items-center gap-2.5 text-xs text-vmuted py-0.5">
                      <span className="text-success text-[10px]">&#10003;</span>
                      <span className="truncate flex-1">{t.title}</span>
                      <span className="font-mono text-[10px] shrink-0 opacity-60">{t.worker?.startsWith('human') ? 'you' : 'agent'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="text-center py-16">
            <p className="text-sm text-muted">Nothing needs your attention.</p>
            <p className="text-xs text-vmuted mt-1">All clear — the agent is handling things.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, count, accent }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className={`text-[11px] font-mono uppercase tracking-wider ${accent ? 'text-warning' : 'text-vmuted'}`}>
        {label}
      </h2>
      {count != null && (
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${accent ? 'bg-warning/10 text-warning' : 'bg-border/50 text-vmuted'}`}>
          {count}
        </span>
      )}
    </div>
  );
}

function ActiveSessionCard({ task, onAction, onChat }) {
  const [handoffNote, setHandoffNote] = useState('');
  const [acting, setActing] = useState(false);

  const handleContinue = async () => {
    try {
      await api(`/tasks/${task.id}/takeover`, { method: 'POST' });
    } catch (e) {
      alert(e.message);
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
    <div className="bg-card border border-accent/30 rounded-lg p-4">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
        <span className="text-sm font-medium text-text flex-1 truncate">{task.title}</span>
      </div>
      <div className="flex items-center gap-2 ml-4.5 mb-3">
        <span className="text-[10px] font-mono text-vmuted">{task.project_name}</span>
        {task.branch_name && (
          <span className="text-[10px] font-mono text-vmuted">· {task.branch_name}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={handleContinue}
          className="px-4 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium">
          Continue
        </button>
        <button onClick={handleHandoff} disabled={acting}
          className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text hover:border-border transition-colors">
          Hand off
        </button>
        {onChat && (
          <button onClick={() => onChat(task)}
            className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text hover:border-border transition-colors">
            Chat
          </button>
        )}
        <input value={handoffNote} onChange={e => setHandoffNote(e.target.value)}
          placeholder="Note for agent..."
          className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent/50 transition-colors" />
      </div>
    </div>
  );
}

function ReviewCard({ task, onAction, onChat, navigate }) {
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
      onAction?.();
    } catch (e) {
      alert(e.message);
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

  const kindLabel = { plan: 'Plan', code: 'Code', analysis: 'Analysis', failed: 'Failed' }[kind];
  const kindColor = { plan: 'text-accent', code: 'text-warning', analysis: 'text-research', failed: 'text-error' }[kind];
  const kindBg = { plan: 'bg-accent/10', code: 'bg-warning/10', analysis: 'bg-research/10', failed: 'bg-error/10' }[kind];
  const borderColor = { plan: 'border-accent/20', code: 'border-warning/20', analysis: 'border-research/20', failed: 'border-error/20' }[kind];

  const displayName = task.feature_name || task.title;
  const changeSummary = failedError
    ? failedError
    : summary && !summary.startsWith('[') && !summary.startsWith('{')
      ? summary
      : task.review_instructions?.slice(0, 120) || null;

  return (
    <div className={`bg-card border ${borderColor} rounded-lg p-4`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${kindBg} ${kindColor}`}>{kindLabel}</span>
            <span className="text-[10px] font-mono text-vmuted">{task.project_name}</span>
          </div>
          <p className="text-sm font-medium text-text truncate">{displayName}</p>
          {changeSummary && (
            <p className="text-xs text-muted mt-1 line-clamp-2 leading-relaxed">{changeSummary}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {kind === 'failed' ? (
            <>
              <button onClick={handleRetry} disabled={acting}
                className="px-3.5 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
                Retry
              </button>
              <button onClick={handleDismiss} disabled={acting}
                className="px-3.5 py-1.5 text-xs text-error/80 hover:text-error border border-error/20 hover:border-error/40 rounded-lg transition-colors">
                Dismiss
              </button>
            </>
          ) : (
            <>
              <button onClick={handleViewChanges} disabled={loadingDiff}
                className="px-3.5 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
                {loadingDiff ? '...' : showDiff ? 'Hide' : 'View changes'}
              </button>
              <button onClick={handleApprove} disabled={acting}
                className="px-4 py-1.5 text-xs bg-success text-white rounded-lg hover:bg-success/80 disabled:opacity-50 transition-colors font-medium">
                {acting ? '...' : 'Approve'}
              </button>
            </>
          )}
        </div>
      </div>

      {showDiff && diff && (
        <div className="mt-4 pt-3 border-t border-border">
          <pre className="text-[11px] font-mono text-muted overflow-x-auto max-h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap">{diff.stat}</pre>
          <pre className="mt-2 text-[11px] font-mono text-muted overflow-x-auto max-h-96 overflow-y-auto leading-relaxed whitespace-pre-wrap">{diff.diff}</pre>
        </div>
      )}
    </div>
  );
}

function SuggestedCard({ task, onAction, onChat }) {
  const [acting, setActing] = useState(false);

  const handleStartWork = async () => {
    setActing(true);
    try {
      const result = await api(`/tasks/${task.id}/start-work`, { method: 'POST' });
      if (result.error) alert(result.error);
      onAction?.();
    } catch (e) {
      alert(e.message);
    } finally { setActing(false); }
  };

  return (
    <div className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 hover:border-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text truncate">{task.title}</p>
        <span className="text-[10px] font-mono text-vmuted">{task.project_name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onChat && (
          <button onClick={() => onChat(task)}
            className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors">
            Chat
          </button>
        )}
        <button onClick={handleStartWork} disabled={acting}
          className="px-4 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors font-medium">
          Work on this
        </button>
      </div>
    </div>
  );
}
