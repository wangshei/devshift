import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import HumanTaskCard from '../components/HumanTaskCard';
import SplitDiffViewer from '../components/SplitDiffViewer';
import TaskInput from '../components/TaskInput';

function CommentThread({ taskId }) {
  const { data: comments, refetch } = useApi(`/comments/${taskId}/comments`, []);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      await api(`/comments/${taskId}/comments`, { method: 'POST', body: { content: text } });
      setText('');
      refetch();
    } catch {}
    finally { setPosting(false); }
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      {comments?.length > 0 && (
        <div className="space-y-1.5">
          {comments.map(c => (
            <div key={c.id} className="text-xs text-muted">
              <span className="text-vmuted font-mono">{c.author}</span>
              {' '}{c.content}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handlePost()}
          placeholder="Add feedback for the agent..."
          className="flex-1 bg-bg border border-border rounded px-2 py-1 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent"
        />
        <button onClick={handlePost} disabled={posting || !text.trim()}
          className="px-2 py-1 text-xs text-accent hover:text-text disabled:opacity-40 transition-colors">
          Send
        </button>
      </div>
    </div>
  );
}

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

/** Try to parse result_summary as a JSON array of generated tasks */
function parseGeneratedTasks(text) {
  if (!text) return null;
  let s = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(s.startsWith('[') ? s : s.match(/\[[\s\S]*\]/)?.[0] || '');
    if (Array.isArray(parsed) && parsed[0]?.title) return parsed;
  } catch { /* not JSON */ }
  return null;
}

/** Format result_summary for display — full text, not truncated */
function formatResultSummary(text) {
  if (!text) return null;
  let s = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(s.startsWith('[') ? s : s.match(/\[[\s\S]*\]/)?.[0] || '');
    if (Array.isArray(parsed) && parsed[0]?.title) return null;
  } catch { /* not JSON */ }
  return s;
}

/** Expandable completed/in-progress task card */
function TaskCard({ task, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [acting, setActing] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [handoffNote, setHandoffNote] = useState('');

  const s = STATUS_ICONS[task.status] || STATUS_ICONS.backlog;
  const time = task.completed_at || task.started_at;
  const timeStr = formatTime(time);
  const isReview = task.status === 'needs_review' && task.branch_name;
  const isInProgress = task.status === 'in_progress';
  const isDone = task.status === 'done';
  const isAnalysis = task.tier === 3 || task.title?.startsWith('Smart Mode:');
  const isAnalysisReview = isAnalysis && task.status === 'needs_review';

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

  const handleDismiss = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/dismiss`, { method: 'POST' });
      onAction?.();
    } catch { /* ignore */ }
    finally { setActing(false); }
  };

  const handleTakeover = async () => {
    try {
      const result = await api(`/tasks/${task.id}/takeover`, { method: 'POST' });
      if (result.error) {
        alert(result.error);
      }
    } catch (e) {
      alert('Could not open terminal: ' + e.message);
    }
  };

  const handleHandoff = async (done = false) => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/handoff`, {
        method: 'POST',
        body: { note: handoffNote, done }
      });
      onAction?.();
    } catch {}
    finally { setActing(false); }
  };

  return (
    <div className={`bg-card border rounded-lg transition-colors ${
      isAnalysisReview ? 'border-research/30' :
      isReview ? 'border-warning/30' :
      isInProgress ? 'border-accent/20' :
      'border-border'
    }`}>
      {/* Main row */}
      <div
        className={`flex items-start gap-3 px-4 py-3 ${isDone || isReview ? 'cursor-pointer' : ''}`}
        onClick={() => (isDone || isReview) && setExpanded(!expanded)}
      >
        <span className={`mt-0.5 text-sm shrink-0 ${isAnalysisReview ? 'text-research' : s.color}`}>
          {isAnalysisReview ? '\u25C6' : s.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isAnalysisReview && (
              <span className="text-[10px] font-mono uppercase text-research">Analysis</span>
            )}
            <span className="text-sm text-text">{task.title}</span>
            {isInProgress && task.worker?.startsWith('human') && (
              <span className="text-[10px] text-accent font-mono">you're on this</span>
            )}
            {isInProgress && !task.worker?.startsWith('human') && (
              <span className="text-[10px] text-accent font-mono animate-pulse">working...</span>
            )}
          </div>
          {isInProgress && !task.worker?.startsWith('human') && (
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
          {task.actual_cost_usd != null && task.actual_cost_usd > 0 && (
            <span className="text-[10px] font-mono text-vmuted">${task.actual_cost_usd.toFixed(2)}</span>
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

      {/* Human working — show handoff UI */}
      {isInProgress && task.worker?.startsWith('human') && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          <p className="text-[10px] text-accent font-mono">You're working on this</p>
          <input value={handoffNote} onChange={e => setHandoffNote(e.target.value)}
            placeholder="Leave a note for the agent (optional)"
            className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent" />
          <div className="flex gap-2">
            <button onClick={() => handleHandoff(false)} disabled={acting}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors font-medium">
              Hand off to agent
            </button>
            <button onClick={() => handleHandoff(true)} disabled={acting}
              className="px-3 py-1.5 text-xs bg-success text-white rounded-lg hover:bg-success/80 disabled:opacity-50 transition-colors font-medium">
              Mark done
            </button>
          </div>
        </div>
      )}

      {/* Live log for in-progress tasks (agent only) */}
      {isInProgress && !task.worker?.startsWith('human') && (
        <div className="mt-0 border-t border-border px-4 pt-2 pb-3">
          <p className="text-[10px] text-accent font-mono mb-1 animate-pulse">● Live output</p>
          <LiveLog taskId={task.id} />
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {/* Analysis tasks: show results prominently */}
          {isAnalysisReview ? (
            <>
              {formatResultSummary(task.result_summary) && (
                <div className="p-3 bg-bg rounded-lg border border-border">
                  <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap">
                    {formatResultSummary(task.result_summary)}
                  </p>
                </div>
              )}
              {parseGeneratedTasks(task.result_summary) && (
                <div className="p-3 bg-bg rounded-lg border border-border">
                  <p className="text-[10px] font-mono text-research mb-1.5">
                    Generated {parseGeneratedTasks(task.result_summary).length} task{parseGeneratedTasks(task.result_summary).length !== 1 ? 's' : ''}
                  </p>
                  <ul className="space-y-1">
                    {parseGeneratedTasks(task.result_summary).map((t, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                        <span className="text-vmuted shrink-0">{'\u25CB'}</span>
                        <span>{t.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cleanSummary(task.review_instructions) && (
                <p className="text-xs text-muted italic leading-relaxed">{cleanSummary(task.review_instructions)}</p>
              )}
              {task.provider && (
                <p className="text-[10px] font-mono text-vmuted">via {task.provider}</p>
              )}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                {task.branch_name && (
                  <button onClick={handleShowDiff} disabled={loadingDiff}
                    className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
                    {loadingDiff ? 'Loading...' : showDiff ? 'Hide changes' : 'View changes'}
                  </button>
                )}
                <button onClick={handleTakeover}
                  className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors"
                  title="Open this session in Terminal to continue manually">
                  Take over
                </button>
                <div className="flex-1" />
                <button onClick={handleDismiss} disabled={acting}
                  className="px-3 py-1.5 text-xs bg-research/90 text-white rounded-lg hover:bg-research/70 disabled:opacity-50 transition-colors font-medium">
                  {acting ? 'Dismissing...' : 'Dismiss'}
                </button>
              </div>
              <CommentThread taskId={task.id} />
            </>
          ) : (
            <>
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

              {/* Review actions for code changes (non-analysis) */}
              {isReview && (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <button onClick={handleShowDiff} disabled={loadingDiff}
                    className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
                    {loadingDiff ? 'Loading...' : showDiff ? 'Hide diff' : 'View diff'}
                  </button>
                  <button onClick={handleTakeover}
                    className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors"
                    title="Open this session in Terminal to continue manually">
                    Take over
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

              <CommentThread taskId={task.id} />
            </>
          )}
        </div>
      )}

      {/* Diff viewer */}
      {expanded && showDiff && diff && (
        <SplitDiffViewer diff={diff.diff} stat={diff.stat} />
      )}
    </div>
  );
}

function FailedTaskCard({ task, onRetry, onDelete, onTakeover }) {
  const [showFull, setShowFull] = useState(false);

  return (
    <div className="bg-card border border-error/30 rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-start gap-3">
        <span className="text-error text-sm shrink-0 mt-0.5">✕</span>
        <div className="flex-1 min-w-0">
          <span className="text-sm text-text">{task.title}</span>
          {task.execution_log && (
            <div className="mt-1">
              <p className={`text-xs text-error/70 font-mono leading-relaxed ${showFull ? '' : 'line-clamp-2'}`}>
                {task.execution_log}
              </p>
              {task.execution_log.length > 100 && (
                <button onClick={() => setShowFull(!showFull)}
                  className="text-[10px] text-vmuted hover:text-muted mt-0.5">
                  {showFull ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
          {showFull && task.review_instructions && (
            <p className="text-xs text-muted mt-1 leading-relaxed whitespace-pre-wrap">
              {task.review_instructions}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onTakeover(task.id)}
            className="text-xs text-muted hover:text-accent border border-border rounded-md px-2 py-1 transition-colors"
            title="Open in terminal">
            Take over
          </button>
          <button onClick={() => onRetry(task.id)}
            className="text-xs text-muted hover:text-accent border border-border rounded-md px-2 py-1 transition-colors">
            Retry
          </button>
          <button onClick={() => onDelete(task.id)}
            className="text-xs text-vmuted hover:text-error transition-colors px-1"
            title="Delete task">
            ✕
          </button>
        </div>
      </div>
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

  const handleTakeoverTask = async (taskId) => {
    try {
      const result = await api(`/tasks/${taskId}/takeover`, { method: 'POST' });
      if (result.error) {
        alert(result.error);
      }
    } catch (e) {
      alert('Could not open terminal: ' + e.message);
    }
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
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — {completed.length} completed
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
                <FailedTaskCard
                  key={t.id}
                  task={t}
                  onRetry={handleRetryTask}
                  onDelete={handleDeleteTask}
                  onTakeover={handleTakeoverTask}
                />
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
