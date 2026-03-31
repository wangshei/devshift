import React, { useState } from 'react';
import { useApi, api } from '../hooks/useApi';
import SplitDiffViewer from './SplitDiffViewer';

const TIER_LABELS = { 1: 'Auto', 2: 'Review', 3: 'Research' };

function cleanSummary(text) {
  if (!text) return null;
  let s = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(s.startsWith('[') ? s : s.match(/\[[\s\S]*\]/)?.[0] || '');
    if (Array.isArray(parsed) && parsed[0]?.title) {
      return `Generated ${parsed.length} task${parsed.length !== 1 ? 's' : ''}: ${parsed.slice(0, 2).map(t => t.title).join(', ')}${parsed.length > 2 ? '\u2026' : ''}`;
    }
  } catch { /* not JSON */ }
  return s.slice(0, 300);
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

/** Format result_summary for display — returns the full text, not truncated */
function formatResultSummary(text) {
  if (!text) return null;
  let s = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(s.startsWith('[') ? s : s.match(/\[[\s\S]*\]/)?.[0] || '');
    if (Array.isArray(parsed) && parsed[0]?.title) return null;
  } catch { /* not JSON */ }
  return s;
}

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

/** Editable subtask row for the plan review UI */
function SubtaskRow({ subtask, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(subtask.title);
  const [saving, setSaving] = useState(false);

  const handleRenameCommit = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === subtask.title) {
      setTitle(subtask.title);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api(`/tasks/${subtask.id}`, { method: 'PATCH', body: { title: trimmed } });
      onRename?.(subtask.id, trimmed);
    } catch { setTitle(subtask.title); }
    finally { setSaving(false); setEditing(false); }
  };

  return (
    <div className="flex items-start gap-2 p-2.5 bg-bg rounded-lg border border-border group">
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') { setTitle(subtask.title); setEditing(false); }
            }}
            disabled={saving}
            className="w-full bg-transparent border-b border-accent outline-none text-xs text-text"
          />
        ) : (
          <p
            className="text-xs text-text cursor-pointer hover:text-accent transition-colors"
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            {title}
          </p>
        )}
        {subtask.description && (
          <p className="text-[10px] text-vmuted mt-0.5 line-clamp-2 leading-relaxed">
            {subtask.description.slice(0, 120)}{subtask.description.length > 120 ? '…' : ''}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {subtask.tier && (
          <span className={`text-[10px] font-mono ${subtask.tier === 3 ? 'text-research' : 'text-vmuted'}`}>
            {TIER_LABELS[subtask.tier]}
          </span>
        )}
        <button
          onClick={() => onDelete?.(subtask.id)}
          className="opacity-0 group-hover:opacity-100 text-vmuted hover:text-error text-xs transition-all"
          title="Remove subtask"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Plan review card for tasks with plan_status === 'pending_review' */
function PlanReviewCard({ task, onAction }) {
  const { data: subtasksData, refetch: refetchSubtasks } = useApi(`/tasks?parent_task_id=${task.id}`, [task.id]);
  const [subtasks, setSubtasks] = useState(null);
  const [approving, setApproving] = useState(false);

  // Sync local subtasks from fetched data
  const currentSubtasks = subtasks ?? (Array.isArray(subtasksData) ? subtasksData : subtasksData?.tasks ?? []);

  const handleDelete = async (subtaskId) => {
    try {
      await api(`/tasks/${subtaskId}`, { method: 'DELETE' });
      setSubtasks(prev => (prev ?? currentSubtasks).filter(s => s.id !== subtaskId));
    } catch (e) {
      alert('Could not remove subtask: ' + e.message);
    }
  };

  const handleRename = (subtaskId, newTitle) => {
    setSubtasks(prev => (prev ?? currentSubtasks).map(s => s.id === subtaskId ? { ...s, title: newTitle } : s));
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await api(`/tasks/${task.id}/approve-plan`, { method: 'POST' });
      onAction?.();
    } catch (e) {
      alert('Could not approve plan: ' + e.message);
    } finally { setApproving(false); }
  };

  return (
    <div className="bg-card rounded-lg border border-accent/30 transition-colors">
      <div className="px-4 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-accent text-sm">◆</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase text-accent">Plan</span>
              {task.project_name && (
                <span className="text-[10px] text-vmuted font-mono">({task.project_name})</span>
              )}
            </div>
            <p className="text-sm mt-0.5 text-text">{task.title}</p>
            <p className="text-[10px] text-vmuted mt-0.5">
              Review the subtasks below, remove any you don't want, then approve to start execution.
            </p>
          </div>
        </div>

        {/* Subtask list */}
        <div className="mt-3 space-y-1.5">
          {currentSubtasks.length === 0 ? (
            <p className="text-xs text-vmuted italic">No subtasks — all were removed.</p>
          ) : (
            currentSubtasks.map(s => (
              <SubtaskRow
                key={s.id}
                subtask={s}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
          <span className="text-[10px] text-vmuted font-mono">
            {currentSubtasks.length} subtask{currentSubtasks.length !== 1 ? 's' : ''}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleApprove}
            disabled={approving || currentSubtasks.length === 0}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors font-medium"
          >
            {approving ? 'Approving...' : 'Approve Plan'}
          </button>
        </div>

        {/* Comment thread */}
        <div className="mt-3">
          <CommentThread taskId={task.id} />
        </div>
      </div>
    </div>
  );
}

export default function HumanTaskCard({ task, onAction, onChat }) {
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [workNote, setWorkNote] = useState('');

  const handleComplete = async () => {
    setActing(true);
    try {
      if (workNote.trim()) {
        await api(`/comments/${task.id}/comments`, { method: 'POST', body: { content: workNote, author: 'user' } });
      }
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'done', result_summary: workNote || 'Completed manually by user' } });
      onAction?.();
    } catch {}
    finally { setActing(false); }
  };

  const handleStartWork = async () => {
    setActing(true);
    try {
      const result = await api(`/tasks/${task.id}/start-work`, { method: 'POST' });
      if (result.error) alert(result.error);
      if (result.manualCommand) alert('Run manually: ' + result.manualCommand);
      onAction?.();
    } catch (e) {
      alert('Could not start: ' + e.message);
    } finally { setActing(false); }
  };

  // Plan review gate — intercept before other checks
  const isPlanReview = task.plan_status === 'pending_review';
  if (isPlanReview) {
    return <PlanReviewCard task={task} onAction={onAction} />;
  }

  const isReview = task.status === 'needs_review' && task.branch_name;
  const isAnalysis = task.tier === 3 || task.title?.startsWith('Smart Mode:');

  const handleShowDiff = async () => {
    if (diff) { setShowDiff(!showDiff); return; }
    setLoading(true);
    try {
      const d = await api(`/tasks/${task.id}/diff`);
      setDiff(d);
      setShowDiff(true);
    } catch { /* ignore */ }
    finally { setLoading(false); }
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

  // Analysis card for Tier 3 / Smart Mode tasks
  if (isAnalysis && task.status === 'needs_review') {
    const generatedTasks = parseGeneratedTasks(task.result_summary);
    const resultText = formatResultSummary(task.result_summary);

    return (
      <div className="bg-card rounded-lg border border-research/30 transition-colors">
        <div className="px-4 py-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-research">{'\u25C6'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono uppercase text-research">Analysis</span>
                {task.project_name && (
                  <span className="text-[10px] text-vmuted font-mono">({task.project_name})</span>
                )}
              </div>
              <p className="text-sm mt-0.5 text-text">{task.title}</p>

              {/* Show result summary prominently */}
              {resultText ? (
                <div className="mt-2 p-3 bg-bg rounded-lg border border-border">
                  <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap">{resultText}</p>
                </div>
              ) : generatedTasks ? (
                <div className="mt-2 p-3 bg-bg rounded-lg border border-border">
                  <p className="text-xs text-muted leading-relaxed">
                    Found {generatedTasks.length} improvement{generatedTasks.length !== 1 ? 's' : ''} for this project.
                    {generatedTasks.filter(t => t.priority <= 2).length > 0 &&
                      ` ${generatedTasks.filter(t => t.priority <= 2).length} are high priority.`}
                  </p>
                </div>
              ) : null}

              {/* Show generated tasks as a checklist */}
              {generatedTasks && (
                <div className="mt-2 p-3 bg-bg rounded-lg border border-border">
                  <p className="text-[10px] font-mono text-research mb-1.5">
                    Generated {generatedTasks.length} task{generatedTasks.length !== 1 ? 's' : ''}
                  </p>
                  <ul className="space-y-1">
                    {generatedTasks.map((t, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                        <span className="text-vmuted shrink-0">{'\u25CB'}</span>
                        <div>
                          <span>{t.title}</span>
                          {t.description && (
                            <p className="text-[10px] text-vmuted mt-0.5">{t.description.slice(0, 100)}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {cleanSummary(task.review_instructions) && (
                <p className="text-xs text-muted mt-2 italic">{cleanSummary(task.review_instructions)}</p>
              )}
            </div>
          </div>

          {/* Actions for analysis tasks */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            {task.branch_name && (
              <button onClick={handleShowDiff} disabled={loading}
                className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
                {loading ? 'Loading...' : showDiff ? 'Hide changes' : 'View changes'}
              </button>
            )}
            <button onClick={handleTakeover}
              className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors"
              title="Open this session in Terminal to continue manually">
              Take over
            </button>
            {onChat && (
              <button onClick={() => onChat(task)}
                className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
                Chat
              </button>
            )}
            <div className="flex-1" />
            <button onClick={handleDismiss} disabled={acting}
              className="px-3 py-1.5 text-xs bg-research/90 text-white rounded-lg hover:bg-research/70 disabled:opacity-50 transition-colors font-medium">
              {acting ? 'Dismissing...' : 'Dismiss'}
            </button>
          </div>

          <div className="mt-3">
            <CommentThread taskId={task.id} />
          </div>
        </div>

        {/* Diff viewer */}
        {showDiff && diff && (
          <SplitDiffViewer diff={diff.diff} stat={diff.stat} />
        )}
      </div>
    );
  }

  // Standard review card for code changes (Tier 1/2)
  return (
    <div className={`bg-card rounded-lg border transition-colors ${isReview ? 'border-warning/30' : 'border-border'}`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 ${isReview ? 'text-warning' : 'text-accent'}`}>
            {isReview ? '\u25B8' : '\u25C6'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-mono uppercase ${isReview ? 'text-warning' : 'text-accent'}`}>
                {isReview ? 'Review' : task.task_type === 'human' ? 'Human task' : 'Blocked'}
              </span>
              {task.project_name && (
                <span className="text-[10px] text-vmuted font-mono">({task.project_name})</span>
              )}
            </div>
            <p className="text-sm mt-0.5 text-text">{task.title}</p>
            {cleanSummary(task.result_summary) && (
              <p className="text-xs text-muted mt-1">{cleanSummary(task.result_summary)}</p>
            )}
            {cleanSummary(task.review_instructions) && (
              <p className="text-xs text-muted mt-1 italic">{cleanSummary(task.review_instructions)}</p>
            )}
          </div>
          {task.pr_url && (
            <a href={task.pr_url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-accent hover:underline shrink-0">
              PR #{task.pr_number}
            </a>
          )}
        </div>

        {/* Review actions */}
        {isReview && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <button onClick={handleShowDiff} disabled={loading}
              className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
              {loading ? 'Loading...' : showDiff ? 'Hide diff' : 'View diff'}
            </button>
            <button onClick={handleTakeover}
              className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors"
              title="Open this session in Terminal to continue manually">
              Take over
            </button>
            {onChat && (
              <button onClick={() => onChat(task)}
                className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
                Chat
              </button>
            )}
            <div className="flex-1" />
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

        {/* Human task completion */}
        {task.task_type === 'human' && !isReview && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <button onClick={handleStartWork} disabled={acting}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors font-medium">
              Work on this
            </button>
            <div className="flex-1" />
            <input value={workNote} onChange={e => setWorkNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleComplete()}
              placeholder="or note what you did"
              className="flex-1 bg-bg border border-border rounded px-2 py-1.5 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent" />
            <button onClick={handleComplete} disabled={acting}
              className="px-3 py-1.5 text-xs bg-success/80 text-white rounded-lg hover:bg-success disabled:opacity-50 transition-colors">
              Done
            </button>
          </div>
        )}

        <div className="mt-3">
          <CommentThread taskId={task.id} />
        </div>
      </div>

      {/* Diff viewer */}
      {showDiff && diff && (
        <SplitDiffViewer diff={diff.diff} stat={diff.stat} />
      )}
    </div>
  );
}
