import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import HumanTaskCard from '../components/HumanTaskCard';
import TaskInput from '../components/TaskInput';

function formatTime(ts) {
  if (!ts) return null;
  try {
    // SQLite stores as "2026-03-25 14:23:00" without Z
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return null; }
}

function cleanSummary(text) {
  if (!text) return null;
  // Strip markdown code fences
  let s = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  // If it looks like a JSON array of tasks, extract just the count
  try {
    const parsed = JSON.parse(s.startsWith('[') ? s : s.match(/\[[\s\S]*\]/)?.[0] || '');
    if (Array.isArray(parsed) && parsed[0]?.title) {
      return `Generated ${parsed.length} task${parsed.length !== 1 ? 's' : ''}: ${parsed.slice(0, 2).map(t => t.title).join(', ')}${parsed.length > 2 ? '…' : ''}`;
    }
  } catch { /* not JSON */ }
  return s.slice(0, 300);
}

const STATUS_ICONS = {
  done: { icon: '✓', color: 'text-success' },
  in_progress: { icon: '●', color: 'text-accent animate-pulse' },
  backlog: { icon: '○', color: 'text-vmuted' },
  queued: { icon: '○', color: 'text-muted' },
  failed: { icon: '✕', color: 'text-error' },
  needs_review: { icon: '▸', color: 'text-warning' },
};

const TIER_LABELS = { 1: 'Auto', 2: 'Review', 3: 'Research' };

function LiveLog({ taskId }) {
  const { data } = useApi(`/tasks/${taskId}/log`, [], 2000);
  if (!data?.log) return <p className="text-xs text-vmuted font-mono">Waiting for output...</p>;
  return (
    <pre className="text-[10px] font-mono text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto bg-bg rounded p-2 border border-border">
      {data.log}
    </pre>
  );
}

/** Expandable completed/in-progress task card */
function TaskCard({ task, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [acting, setActing] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const s = STATUS_ICONS[task.status] || STATUS_ICONS.backlog;
  const time = task.completed_at || task.started_at;
  const timeStr = formatTime(time);
  const isReview = task.status === 'needs_review' && task.branch_name;
  const isInProgress = task.status === 'in_progress';
  const isDone = task.status === 'done';

  const handleShowDiff = async () => {
    if (diff) { setShowDiff(!showDiff); return; }
    setLoadingDiff(true);
    try {
      const d = await api(`/tasks/${task.id}/diff`);
      setDiff(d);
      setShowDiff(true);
    } catch { /* ignore */ }
    finally { setLoadingDiff(false); }
  };

  const handleApprove = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/approve`, { method: 'POST' });
      onAction?.();
    } catch (e) {
      alert('Merge failed: ' + e.message);
    } finally { setActing(false); }
  };

  const handleReject = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/reject`, { method: 'POST' });
      onAction?.();
    } catch { /* ignore */ }
    finally { setActing(false); }
  };

  return (
    <div className={`bg-card border rounded-lg transition-colors ${
      isReview ? 'border-warning/30' :
      isInProgress ? 'border-accent/20' :
      'border-border'
    }`}>
      {/* Main row */}
      <div
        className={`flex items-start gap-3 px-4 py-3 ${isDone || isReview ? 'cursor-pointer' : ''}`}
        onClick={() => (isDone || isReview) && setExpanded(!expanded)}
      >
        <span className={`mt-0.5 text-sm shrink-0 ${s.color}`}>{s.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text">{task.title}</span>
            {isInProgress && (
              <span className="text-[10px] text-accent font-mono animate-pulse">working...</span>
            )}
          </div>
          {isInProgress && (
            <div className="mt-1.5 h-0.5 w-24 bg-accent/20 rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full animate-pulse w-1/2" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {timeStr && <span className="text-[10px] font-mono text-vmuted">{timeStr}</span>}
          {task.actual_minutes != null && (
            <span className="text-[10px] font-mono text-vmuted">{task.actual_minutes}m</span>
          )}
          {task.tier && (
            <span className={`text-[10px] font-mono ${task.tier === 3 ? 'text-research' : 'text-vmuted'}`}>
              {TIER_LABELS[task.tier]}
            </span>
          )}
          {(isDone || isReview) && (
            <span className="text-vmuted text-xs">{expanded ? '▴' : '▾'}</span>
          )}
        </div>
      </div>

      {/* Live log for in-progress tasks */}
      {isInProgress && (
        <div className="mt-0 border-t border-border px-4 pt-2 pb-3">
          <p className="text-[10px] text-accent font-mono mb-1 animate-pulse">● Live output</p>
          <LiveLog taskId={task.id} />
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {cleanSummary(task.result_summary) && (
            <p className="text-xs text-muted leading-relaxed">{cleanSummary(task.result_summary)}</p>
          )}
          {cleanSummary(task.review_instructions) && (
            <p className="text-xs text-muted italic leading-relaxed">{cleanSummary(task.review_instructions)}</p>
          )}
          {task.provider && (
            <p className="text-[10px] font-mono text-vmuted">via {task.provider}</p>
          )}
          {isDone && (
            <div>
              <button
                onClick={() => setShowOutput(!showOutput)}
                className="text-[10px] text-vmuted hover:text-muted font-mono transition-colors"
              >
                {showOutput ? 'Hide output' : 'View output'}
              </button>
              {showOutput && <LiveLog taskId={task.id} />}
            </div>
          )}

          {/* Review actions */}
          {isReview && (
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <button onClick={handleShowDiff} disabled={loadingDiff}
                className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
                {loadingDiff ? 'Loading...' : showDiff ? 'Hide diff' : 'View diff'}
              </button>
              <div className="flex-1" />
              {task.pr_url && (
                <a href={task.pr_url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-accent hover:underline shrink-0">
                  PR #{task.pr_number}
                </a>
              )}
              <button onClick={handleReject} disabled={acting}
                className="px-3 py-1.5 text-xs text-error/70 hover:text-error border border-error/20 rounded-lg hover:bg-error/10 transition-colors">
                Reject
              </button>
              <button onClick={handleApprove} disabled={acting}
                className="px-3 py-1.5 text-xs bg-success text-white rounded-lg hover:bg-success/80 disabled:opacity-50 transition-colors font-medium">
                {acting ? 'Merging...' : 'Approve & Merge'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Diff viewer */}
      {expanded && showDiff && diff && (
        <div className="border-t border-border">
          {diff.stat && (
            <div className="px-4 py-2 bg-bg text-xs font-mono text-muted">{diff.stat}</div>
          )}
          {diff.diff ? (
            <pre className="px-4 py-3 text-[11px] font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
              {diff.diff.split('\n').map((line, i) => (
                <div key={i} className={
                  line.startsWith('+') && !line.startsWith('+++') ? 'text-success' :
                  line.startsWith('-') && !line.startsWith('---') ? 'text-error' :
                  line.startsWith('@@') ? 'text-accent' : 'text-muted'
                }>{line}</div>
              ))}
            </pre>
          ) : (
            <div className="px-4 py-3 text-xs text-vmuted">No changes found on this branch.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectFeed() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, refetch } = useApi(`/timeline/project/${id}`, [], 5000);
  const [renamingName, setRenamingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  if (!data) return (
    <div className="px-6 py-6">
      <div className="text-muted animate-pulse text-sm">Loading...</div>
    </div>
  );

  const { project, humanTasks, completed, inProgress, planned, failed } = data;
  const isEmpty = !humanTasks?.length && !inProgress?.length && !completed?.length && !planned?.length && !failed?.length;

  const handleRenameStart = () => {
    setNameValue(project.name);
    setRenamingName(true);
  };

  const handleRenameCommit = async () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== project.name) {
      await api(`/projects/${id}`, { method: 'PATCH', body: { name: trimmed } });
      refetch();
    }
    setRenamingName(false);
  };

  const handleDeleteTask = async (taskId) => {
    await api(`/tasks/${taskId}`, { method: 'DELETE' });
    refetch();
  };

  const handleRetryTask = async (taskId) => {
    await api(`/tasks/${taskId}/execute`, { method: 'POST' });
    refetch();
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}" and all its tasks?`)) return;
    await api(`/projects/${id}`, { method: 'DELETE' });
    navigate('/');
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {renamingName ? (
              <input
                autoFocus
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  if (e.key === 'Escape') setRenamingName(false);
                }}
                className="text-xl font-bold bg-transparent border-b border-accent outline-none w-full truncate"
              />
            ) : (
              <h1
                className="text-xl font-bold truncate cursor-pointer hover:opacity-70 transition-opacity"
                title="Click to rename"
                onClick={handleRenameStart}
              >
                {project.name}
              </h1>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {project.stack?.length > 0 && project.stack.map(s => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded font-mono">{s}</span>
              ))}
              {project.repo_path && (
                <span className="text-[10px] font-mono text-vmuted truncate max-w-xs">{project.repo_path}</span>
              )}
            </div>
          </div>
          <button
            onClick={handleDelete}
            className="text-xs text-vmuted hover:text-error transition-colors shrink-0"
            title="Delete project"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* Feed content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 pb-32">

        {/* Reviews banner */}
        {humanTasks?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-warning" />
              <h2 className="text-xs font-mono text-warning uppercase tracking-wider">
                Needs your attention ({humanTasks.length})
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {humanTasks.map(t => <HumanTaskCard key={t.id} task={t} onAction={refetch} />)}
            </div>
          </div>
        )}

        {/* In-progress tasks */}
        {inProgress?.length > 0 && (
          <div className="flex flex-col gap-2">
            {inProgress.map(t => (
              <TaskCard key={t.id} task={t} onAction={refetch} />
            ))}
          </div>
        )}

        {/* Completed tasks */}
        {completed?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-mono text-vmuted">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-2">
              {completed.map(t => (
                <TaskCard key={t.id} task={t} onAction={refetch} />
              ))}
            </div>
          </div>
        )}

        {/* Queued/planned */}
        {planned?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-mono text-vmuted">Up next ({planned.length})</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-1.5">
              {planned.map(t => (
                <div key={t.id} className="relative flex items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-lg group">
                  <span className="text-vmuted text-sm">○</span>
                  <span className="text-sm text-muted flex-1">{t.title}</span>
                  {t.tier && (
                    <span className={`text-[10px] font-mono ${t.tier === 3 ? 'text-research' : 'text-vmuted'}`}>
                      {TIER_LABELS[t.tier]}
                    </span>
                  )}
                  <button onClick={() => handleDeleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-vmuted hover:text-error text-xs transition-all ml-2">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Failed tasks */}
        {failed?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-error" />
              <h2 className="text-xs font-mono text-error uppercase tracking-wider">
                Failed ({failed.length})
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {failed.map(t => (
                <div key={t.id} className="bg-card border border-error/30 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="text-error text-sm shrink-0 mt-0.5">✕</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text">{t.title}</span>
                      {t.execution_log && (
                        <p className="text-xs text-error/70 mt-1 font-mono leading-relaxed line-clamp-2">{t.execution_log}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRetryTask(t.id)}
                      className="shrink-0 text-xs text-muted hover:text-accent border border-border rounded-md px-2 py-1 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="text-center py-16">
            <p className="text-muted text-sm mb-1">No tasks for {project.name} yet.</p>
            <p className="text-vmuted text-xs">Add a task below to get started.</p>
          </div>
        )}
      </div>

      {/* Fixed task input at bottom */}
      <div className="sticky bottom-0 bg-bg border-t border-border px-6 py-3">
        <TaskInput fixedProjectId={id} onTaskAdded={refetch} />
      </div>
    </div>
  );
}
