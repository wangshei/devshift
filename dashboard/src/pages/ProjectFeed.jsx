import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import HumanTaskCard from '../components/HumanTaskCard';
import SplitDiffViewer from '../components/SplitDiffViewer';
import TaskInput from '../components/TaskInput';
import ChatPanel from '../components/ChatPanel';
import Markdown from '../components/Markdown';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function CommentThread({ taskId }) {
  const { data: comments, refetch } = useApi(`/comments/${taskId}/comments`, []);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [agentReplying, setAgentReplying] = useState(false);

  const handlePost = async () => {
    if (!text.trim() && !imagePreview) return;
    setPosting(true);
    try {
      await api(`/comments/${taskId}/comments`, {
        method: 'POST',
        body: { content: text, image: imagePreview || undefined },
      });
      setText('');
      setImagePreview(null);
      refetch();

      // Poll for agent auto-reply (fires within a few seconds)
      setAgentReplying(true);
      let polls = 0;
      const pollInterval = setInterval(() => {
        refetch();
        polls++;
        if (polls >= 5) { clearInterval(pollInterval); setAgentReplying(false); }
      }, 2000);
    } catch {}
    finally { setPosting(false); }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => setImagePreview(reader.result);
        reader.readAsDataURL(file);
        break;
      }
    }
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      {comments?.length > 0 && (
        <div className="space-y-1.5">
          {comments.map(c => (
            <div key={c.id} className="text-xs text-muted">
              <span className={`font-mono ${c.author === 'agent' ? 'text-accent' : 'text-vmuted'}`}>{c.author}</span>
              {' '}
              <Markdown text={c.content} className="inline text-xs text-muted leading-relaxed" />
              {c.image_url && (
                <img src={c.image_url} alt="" className="mt-1 max-w-xs rounded border border-border" />
              )}
            </div>
          ))}
        </div>
      )}
      {agentReplying && (
        <p className="text-[10px] text-vmuted italic animate-pulse">Agent is replying...</p>
      )}
      {imagePreview && (
        <div className="relative inline-block">
          <img src={imagePreview} alt="preview" className="max-w-xs rounded border border-border" />
          <button
            onClick={() => setImagePreview(null)}
            className="absolute top-1 right-1 bg-bg/80 text-vmuted hover:text-error rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handlePost()}
          onPaste={handlePaste}
          placeholder="Add feedback… paste an image too"
          className="flex-1 bg-bg border border-border rounded px-2 py-1 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent"
        />
        <button onClick={handlePost} disabled={posting || (!text.trim() && !imagePreview)}
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
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return null; }
}

function cleanSummary(text) {
  if (!text) return null;
  let s = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    const parsed = JSON.parse(s.startsWith('[') ? s : s.match(/\[[\s\S]*\]/)?.[0] || '');
    if (Array.isArray(parsed) && parsed[0]?.title) {
      return `Generated ${parsed.length} task${parsed.length !== 1 ? 's' : ''}: ${parsed.slice(0, 2).map(t => t.title).join(', ')}${parsed.length > 2 ? '…' : ''}`;
    }
  } catch { /* not JSON */ }
  return s.slice(0, 300);
}

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

function featureSummaryText(feature, tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const needsReview = tasks.filter(t => t.status === 'needs_review').length;

  if (needsReview > 0) return `${needsReview} task${needsReview !== 1 ? 's' : ''} ready for review`;
  if (inProgress > 0) return `Agent is working on this — ${done} of ${total} done`;
  if (done === total && total > 0) return `All ${total} tasks complete`;
  if (done > 0) return `${done} of ${total} tasks done`;
  if (total > 0) return `${total} task${total !== 1 ? 's' : ''} planned`;
  return 'No tasks yet';
}

// ---------------------------------------------------------------------------
// ChangesDigest — "What changed" summary card with bulk approve
// ---------------------------------------------------------------------------

function ChangesDigest({ tasks, projectId, onMergeAll, mergingAll }) {
  const recent = tasks.filter(t =>
    t.status === 'done' && t.completed_at &&
    new Date(t.completed_at.includes('T') ? t.completed_at : t.completed_at.replace(' ', 'T') + 'Z') > new Date(Date.now() - 24 * 60 * 60 * 1000)
  );
  const needsReview = tasks.filter(t => t.status === 'needs_review');

  if (recent.length === 0 && needsReview.length === 0) return null;

  const agentDone = recent.filter(t => !t.worker?.startsWith('human'));
  const humanDone = recent.filter(t => t.worker?.startsWith('human'));
  const totalMinutes = agentDone.reduce((s, t) => s + (t.actual_minutes || 0), 0);

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">What changed</h3>
        {needsReview.length > 0 && (
          <button onClick={onMergeAll} disabled={mergingAll}
            className="px-3 py-1.5 text-xs bg-success text-white rounded-lg hover:bg-success/80 disabled:opacity-50 transition-colors font-medium">
            {mergingAll ? 'Merging...' : `Approve all (${needsReview.length})`}
          </button>
        )}
      </div>

      {/* Summary line */}
      <p className="text-xs text-muted">
        {agentDone.length > 0 && (
          <span>Agent completed <strong className="text-text">{agentDone.length} tasks</strong> ({totalMinutes}min)</span>
        )}
        {humanDone.length > 0 && (
          <span>{agentDone.length > 0 ? '. ' : ''}You completed <strong className="text-text">{humanDone.length} tasks</strong></span>
        )}
        {needsReview.length > 0 && (
          <span>. <strong className="text-warning">{needsReview.length} pending review</strong></span>
        )}
      </p>

      {/* List of changes — compact */}
      <div className="space-y-0.5">
        {[...needsReview, ...recent.slice(0, 5)].map(t => (
          <div key={t.id} className="flex items-center gap-2 text-xs">
            <span className={t.status === 'needs_review' ? 'text-warning' : 'text-success'}>
              {t.status === 'needs_review' ? '▸' : '✓'}
            </span>
            <span className={`flex-1 truncate ${t.status === 'done' ? 'text-muted' : 'text-text'}`}>{t.title}</span>
            {t.actual_minutes && <span className="text-vmuted font-mono text-[10px]">{t.actual_minutes}m</span>}
          </div>
        ))}
        {recent.length > 5 && (
          <p className="text-[10px] text-vmuted ml-4">+{recent.length - 5} more</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeatureCard — the main building block of the feature-centric view
// ---------------------------------------------------------------------------

function FeatureCard({ feature, tasks, onAction, onChat }) {
  const [expanded, setExpanded] = useState(false);
  const [actingTask, setActingTask] = useState(null);
  const [diff, setDiff] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [reviewTask, setReviewTask] = useState(null);
  const [deletingFeature, setDeletingFeature] = useState(false);

  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const needsReview = tasks.filter(t => t.status === 'needs_review').length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const statusLabel = needsReview > 0 ? 'Needs review'
    : inProgress > 0 ? 'In progress'
    : done === total && total > 0 ? 'Complete'
    : 'Planned';

  const statusColor = needsReview > 0 ? 'text-warning'
    : inProgress > 0 ? 'text-accent'
    : done === total && total > 0 ? 'text-success'
    : 'text-vmuted';

  const handleShowDiff = async (task) => {
    if (diff && reviewTask?.id === task.id) { setShowDiff(!showDiff); return; }
    setLoadingDiff(true);
    setReviewTask(task);
    try {
      const d = await api(`/tasks/${task.id}/diff`);
      setDiff(d);
      setShowDiff(true);
    } catch { /* ignore */ }
    finally { setLoadingDiff(false); }
  };

  const handleApprove = async (taskId) => {
    setActingTask(taskId);
    try {
      await api(`/tasks/${taskId}/approve`, { method: 'POST' });
      onAction?.();
    } catch (e) {
      alert('Merge failed: ' + e.message);
    } finally { setActingTask(null); }
  };

  const handleReject = async (taskId) => {
    setActingTask(taskId);
    try {
      await api(`/tasks/${taskId}/reject`, { method: 'POST' });
      onAction?.();
    } catch { /* ignore */ }
    finally { setActingTask(null); }
  };

  const handleDeleteFeature = async () => {
    if (!confirm(`Delete feature "${feature.title}" and its task links?`)) return;
    setDeletingFeature(true);
    try {
      await api(`/product/features/${feature.id}`, { method: 'DELETE' });
      onAction?.();
    } catch { /* ignore */ }
    finally { setDeletingFeature(false); }
  };

  return (
    <div className={`bg-card border rounded-lg overflow-hidden ${
      needsReview > 0 ? 'border-warning/30' : inProgress > 0 ? 'border-accent/20' : 'border-border'
    }`}>
      {/* Summary row */}
      <div className="px-4 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text">
                {feature.title}
              </span>
              <span className={`text-[10px] font-mono ${statusColor}`}>{statusLabel}</span>
              {needsReview > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">{featureSummaryText(feature, tasks)}</p>
            {/* Progress bar */}
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 bg-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-success rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-vmuted shrink-0">{done}/{total}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {needsReview > 0 && !expanded && (
              <button
                onClick={e => { e.stopPropagation(); setExpanded(true); }}
                className="px-3 py-1.5 text-xs font-medium bg-warning/10 text-warning border border-warning/20 rounded-md hover:bg-warning/20 transition-colors"
              >
                Review ({needsReview})
              </button>
            )}
            <span className="text-vmuted text-xs">{expanded ? '▴' : '▾'}</span>
          </div>
        </div>
      </div>

      {/* Expanded: description, tasks checklist, comments, chat */}
      {expanded && (
        <div className="border-t border-border">
          {/* Description & assumptions */}
          {(feature.description || feature.assumptions) && (
            <div className="px-4 py-2.5 bg-bg/50 border-b border-border">
              {feature.description && (
                <p className="text-xs text-muted leading-relaxed">{feature.description}</p>
              )}
              {feature.assumptions && (
                <p className="text-[10px] text-vmuted mt-1 italic">Assumptions: {feature.assumptions}</p>
              )}
            </div>
          )}

          {/* Tasks as mini checklist */}
          {tasks.length === 0 ? (
            <div className="px-4 py-3 text-xs text-vmuted italic">No tasks yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {tasks.map(t => {
                const isReview = t.status === 'needs_review' && t.branch_name;
                const isWorking = t.status === 'in_progress';
                return (
                  <div key={t.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={
                        t.status === 'done' ? 'text-success text-xs' :
                        t.status === 'in_progress' ? 'text-accent text-xs' :
                        t.status === 'needs_review' ? 'text-warning text-xs' :
                        t.status === 'failed' ? 'text-error text-xs' : 'text-vmuted text-xs'
                      }>
                        {t.status === 'done' ? '✓' :
                         t.status === 'in_progress' ? '●' :
                         t.status === 'needs_review' ? '▸' :
                         t.status === 'failed' ? '✕' : '○'}
                      </span>
                      <span className={`flex-1 text-xs truncate ${t.status === 'done' ? 'text-muted' : 'text-text'}`}>
                        {t.title}
                      </span>
                      {isWorking && (
                        <span className="text-[10px] font-mono text-accent animate-pulse">working...</span>
                      )}
                      {t.status === 'failed' && t.execution_log && (
                        <span className="text-[10px] text-error/80 truncate max-w-[200px]" title={t.execution_log}>
                          {humanizeError(t.execution_log)}
                        </span>
                      )}
                      {t.actual_minutes && (
                        <span className="text-[10px] font-mono text-vmuted">{t.actual_minutes}m</span>
                      )}
                      {/* View how agent did it — opens chat with session context */}
                      {t.status === 'done' && t.session_id && (
                        <button
                          onClick={() => navigate(`/chat/${id}?session=${t.session_id}&title=${encodeURIComponent(t.title)}`)}
                          className="text-[10px] text-vmuted hover:text-accent transition-colors"
                          title="View how the agent completed this task"
                        >
                          View session
                        </button>
                      )}
                    </div>

                    {/* Review actions inline for needs_review tasks */}
                    {isReview && (
                      <div className="flex items-center gap-2 mt-2 ml-4">
                        <button
                          onClick={() => handleShowDiff(t)}
                          disabled={loadingDiff}
                          className="px-2.5 py-1 text-[10px] bg-card border border-border rounded text-muted hover:text-text transition-colors"
                        >
                          {loadingDiff && reviewTask?.id === t.id ? 'Loading...' : showDiff && reviewTask?.id === t.id ? 'Hide diff' : 'View diff'}
                        </button>
                        {onChat && (
                          <button
                            onClick={() => onChat(t)}
                            className="px-2.5 py-1 text-[10px] bg-card border border-border rounded text-muted hover:text-text transition-colors"
                          >
                            Chat
                          </button>
                        )}
                        <div className="flex-1" />
                        {t.pr_url && (
                          <a href={t.pr_url} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-accent hover:underline">
                            PR #{t.pr_number}
                          </a>
                        )}
                        <button
                          onClick={() => handleReject(t.id)}
                          disabled={actingTask === t.id}
                          className="px-2.5 py-1 text-[10px] text-error/70 hover:text-error border border-error/20 rounded hover:bg-error/10 transition-colors"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleApprove(t.id)}
                          disabled={actingTask === t.id}
                          className="px-2.5 py-1 text-[10px] bg-success text-white rounded hover:bg-success/80 disabled:opacity-50 transition-colors font-medium"
                        >
                          {actingTask === t.id ? 'Merging...' : 'Approve & Merge'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Diff viewer */}
          {showDiff && diff && reviewTask && (
            <SplitDiffViewer diff={diff.diff} stat={diff.stat} />
          )}

          {/* Comment thread for the feature (use feature task id) */}
          <div className="px-4 py-2.5 border-t border-border">
            <CommentThread taskId={feature.id} />
          </div>

          {/* Chat about this feature + delete */}
          <div className="px-4 pb-3 flex items-center gap-2">
            {onChat && (
              <button
                onClick={() => onChat({ id: feature.id, title: feature.title })}
                className="px-3 py-1.5 text-xs bg-accent/10 text-accent border border-accent/20 rounded-md hover:bg-accent/20 transition-colors"
              >
                Chat about this
              </button>
            )}
            {feature.id !== '__other__' && (
              <button
                onClick={handleDeleteFeature}
                disabled={deletingFeature}
                className="px-3 py-1.5 text-xs text-error/60 hover:text-error border border-error/20 rounded-md hover:bg-error/10 transition-colors disabled:opacity-40 ml-auto"
              >
                {deletingFeature ? 'Deleting...' : 'Delete feature'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompletedFeaturesSummary — collapses completed features into one line
// ---------------------------------------------------------------------------

function CompletedFeaturesSummary({ features, tasksByFeature }) {
  const [expanded, setExpanded] = useState(false);
  const count = features.length;

  if (count === 0) return null;

  const totalTasks = features.reduce((sum, f) => sum + (tasksByFeature[f.id]?.length || 0), 0);
  const totalMinutes = features.reduce((sum, f) => {
    return sum + (tasksByFeature[f.id] || []).reduce((s, t) => s + (t.actual_minutes || 0), 0);
  }, 0);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-bg/50 transition-colors"
      >
        <span className="text-success text-xs">✓</span>
        <span className="text-xs text-muted flex-1">
          {count} feature{count !== 1 ? 's' : ''} completed
          {totalTasks > 0 && <span className="text-vmuted"> — {totalTasks} tasks</span>}
          {totalMinutes > 0 && <span className="text-vmuted"> — {totalMinutes}m</span>}
        </span>
        <span className="text-vmuted text-xs">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {features.map(f => {
            const fTasks = tasksByFeature[f.id] || [];
            return (
              <div key={f.id} className="px-4 py-2 flex items-center gap-2">
                <span className="text-success text-xs">✓</span>
                <span className="text-xs text-muted flex-1">{f.title}</span>
                <span className="text-[10px] font-mono text-vmuted">{fTasks.length} tasks</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IdeasSection — better styled
// ---------------------------------------------------------------------------

function IdeasSection({ projectId, onPromoted }) {
  const { data: ideas, refetch } = useApi(`/product/${projectId}/ideas`, []);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [promoting, setPromoting] = useState(null);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await api(`/product/${projectId}/ideas`, { method: 'POST', body: { title: text.trim() } });
      setText('');
      refetch();
    } catch { /* ignore */ }
    finally { setSubmitting(false); }
  };

  const handlePromote = async (ideaId) => {
    setPromoting(ideaId);
    try {
      await api(`/product/ideas/${ideaId}/promote`, { method: 'POST' });
      refetch();
      onPromoted?.();
    } catch (e) {
      alert('Could not promote idea: ' + e.message);
    } finally { setPromoting(null); }
  };

  const handleDelete = async (ideaId) => {
    try {
      await api(`/product/ideas/${ideaId}`, { method: 'DELETE' });
      refetch();
    } catch { /* ignore */ }
  };

  const list = Array.isArray(ideas) ? ideas : [];

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-accent text-sm">+</span>
        <h3 className="text-sm font-medium text-text">Ideas</h3>
        <span className="text-[10px] font-mono text-vmuted">{list.length}</span>
      </div>

      <div className="divide-y divide-border">
        {list.length === 0 && (
          <p className="text-xs text-vmuted italic px-4 py-3">No ideas yet — capture something below.</p>
        )}
        {list.map(idea => (
          <div key={idea.id} className="flex items-center gap-2 px-4 py-2.5 group">
            <span className="text-vmuted text-xs">◌</span>
            <span className="flex-1 text-xs text-text">{idea.title}</span>
            <button
              onClick={() => handlePromote(idea.id)}
              disabled={promoting === idea.id}
              className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[10px] font-mono text-accent border border-accent/30 rounded hover:bg-accent/10 transition-all disabled:opacity-40"
              title="Promote to feature"
            >
              {promoting === idea.id ? '...' : '+ feature'}
            </button>
            <button
              onClick={() => handleDelete(idea.id)}
              className="opacity-0 group-hover:opacity-100 text-vmuted hover:text-error text-xs transition-all"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Quick add */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Capture an idea..."
            className="flex-1 bg-bg border border-border rounded px-3 py-1.5 text-xs text-text placeholder:text-vmuted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !text.trim()}
            className="px-3 py-1.5 text-xs text-accent hover:text-text disabled:opacity-40 transition-colors border border-border rounded"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalsDisplay — shows project goals at top
// ---------------------------------------------------------------------------

function GoalsDisplay({ goals }) {
  const list = Array.isArray(goals) ? goals : [];
  if (list.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {list.map(g => (
        <div key={g.id} className="flex items-center gap-2 px-3 py-1.5 bg-accent/5 border border-accent/15 rounded-lg">
          <span className="text-xs text-text font-medium">{g.title || g.text || g.description}</span>
          {(g.metric || g.target) && (
            <span className="text-[10px] font-mono text-accent">
              {g.metric && g.target ? `${g.metric}: ${g.target}` : g.metric || g.target}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentActivitySummary — one-line summary of agent work
// ---------------------------------------------------------------------------

function AgentActivitySummary({ tasks }) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const completedToday = tasks.filter(t => {
    if (t.status !== 'done' || !t.completed_at) return false;
    try {
      const d = new Date(t.completed_at.includes('T') ? t.completed_at : t.completed_at.replace(' ', 'T') + 'Z');
      return d.getTime() > dayAgo;
    } catch { return false; }
  });

  if (completedToday.length === 0) return null;

  const totalMinutes = completedToday.reduce((sum, t) => sum + (t.actual_minutes || 0), 0);
  const totalCost = completedToday.reduce((sum, t) => sum + (t.actual_cost || 0), 0);

  let detail = '';
  if (totalMinutes > 0) detail += `${totalMinutes} min`;
  if (totalCost > 0) detail += `${detail ? ', ' : ''}$${totalCost.toFixed(2)}`;

  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="text-success">●</span>
      <span>
        Agent completed {completedToday.length} task{completedToday.length !== 1 ? 's' : ''} today
        {detail && <span className="text-vmuted"> ({detail})</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusSummary — "What's happening" section (prominent)
// ---------------------------------------------------------------------------

function StatusSummary({ features, tasks }) {
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const needsReviewTasks = tasks.filter(t => t.status === 'needs_review');
  const completedThisWeek = (() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return tasks.filter(t => {
      if (t.status !== 'done' || !t.completed_at) return false;
      try {
        const d = new Date(t.completed_at.includes('T') ? t.completed_at : t.completed_at.replace(' ', 'T') + 'Z');
        return d.getTime() > weekAgo;
      } catch { return false; }
    });
  })();

  let primary = '';
  let secondary = '';

  if (inProgressTasks.length > 0) {
    const activeFeature = features.find(f => inProgressTasks.some(t => t.feature_id === f.id));
    primary = activeFeature
      ? `Agent is working on ${activeFeature.title}.`
      : `Agent is running ${inProgressTasks.length} task${inProgressTasks.length !== 1 ? 's' : ''}.`;
  } else if (needsReviewTasks.length > 0) {
    primary = `${needsReviewTasks.length} item${needsReviewTasks.length !== 1 ? 's' : ''} waiting for your review.`;
  } else if (completedThisWeek.length > 0) {
    primary = 'All caught up.';
    secondary = `${completedThisWeek.length} task${completedThisWeek.length !== 1 ? 's' : ''} completed this week.`;
  } else {
    primary = 'No active work.';
    secondary = 'Add a task below to get started.';
  }

  if (!secondary && needsReviewTasks.length > 0 && inProgressTasks.length > 0) {
    secondary = `${needsReviewTasks.length} item${needsReviewTasks.length !== 1 ? 's' : ''} need your review.`;
  }

  return (
    <div>
      <p className="text-lg font-semibold text-text leading-snug">{primary}</p>
      {secondary && <p className="text-sm text-muted mt-1">{secondary}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function ProjectFeed() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Core data
  const { data: timelineData, refetch: refetchTimeline } = useApi(`/timeline/project/${id}`, [], 5000);
  const { data: features, refetch: refetchFeatures } = useApi(`/product/${id}/features`, []);
  const { data: goals } = useApi(`/product/${id}/goals`, []);

  const [renamingName, setRenamingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [chatTask, setChatTask] = useState(null);
  const [mergingAll, setMergingAll] = useState(false);

  const refetch = () => { refetchTimeline(); refetchFeatures(); };

  const handleMergeAll = async () => {
    setMergingAll(true);
    try {
      const result = await api('/tasks/bulk-approve', { method: 'POST', body: { project_id: id } });
      if (result.errors?.length > 0) {
        alert(`Merged ${result.merged}. ${result.errors.length} failed.`);
      }
      refetch();
    } catch (e) { alert(e.message); }
    finally { setMergingAll(false); }
  };

  if (!timelineData) return (
    <div className="px-6 py-6">
      <div className="text-muted animate-pulse text-sm">Loading...</div>
    </div>
  );

  const { project, humanTasks } = timelineData;

  // Flatten all tasks from timeline into a single array
  const allTasks = [
    ...(timelineData.inProgress || []),
    ...(timelineData.completed || []),
    ...(timelineData.planned || []),
    ...(timelineData.failed || []),
    ...(timelineData.humanTasks || []),
  ];

  const featureList = Array.isArray(features) ? features : (features?.features ?? []);
  const goalList = Array.isArray(goals) ? goals : (goals?.goals ?? []);

  // Group tasks by feature
  const tasksByFeature = {};
  const orphanTasks = [];
  for (const task of allTasks) {
    if (task.feature_id) {
      if (!tasksByFeature[task.feature_id]) tasksByFeature[task.feature_id] = [];
      tasksByFeature[task.feature_id].push(task);
    } else {
      orphanTasks.push(task);
    }
  }

  // Orphaned reviews: needs_review tasks with no feature
  const orphanReviews = orphanTasks.filter(t => t.status === 'needs_review');
  // Human tasks
  const humanTaskIds = new Set((humanTasks || []).map(t => t.id));
  const attentionItems = [
    ...(humanTasks || []),
    ...orphanReviews.filter(t => !humanTaskIds.has(t.id)),
  ];

  // Separate completed vs active features
  const completedFeatures = featureList.filter(f => {
    const fTasks = tasksByFeature[f.id] || [];
    return fTasks.length > 0 && fTasks.every(t => t.status === 'done');
  });
  const activeFeatures = featureList.filter(f => {
    const fTasks = tasksByFeature[f.id] || [];
    return !(fTasks.length > 0 && fTasks.every(t => t.status === 'done'));
  });

  // Sort active features: needs_review first, then in_progress, then planned
  const sortedActiveFeatures = [...activeFeatures].sort((a, b) => {
    const aTasks = tasksByFeature[a.id] || [];
    const bTasks = tasksByFeature[b.id] || [];
    const aReview = aTasks.some(t => t.status === 'needs_review');
    const bReview = bTasks.some(t => t.status === 'needs_review');
    const aActive = aTasks.some(t => t.status === 'in_progress');
    const bActive = bTasks.some(t => t.status === 'in_progress');
    if (aReview && !bReview) return -1;
    if (!aReview && bReview) return 1;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return 0;
  });

  const hasFeatures = featureList.length > 0 || Object.keys(tasksByFeature).length > 0;

  // Handle rename
  const handleRenameStart = () => { setNameValue(project.name); setRenamingName(true); };
  const handleRenameCommit = async () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== project.name) {
      await api(`/projects/${id}`, { method: 'PATCH', body: { name: trimmed } });
      refetch();
    }
    setRenamingName(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}" and all its tasks?`)) return;
    await api(`/projects/${id}`, { method: 'DELETE' });
    navigate('/');
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Chat panel overlay */}
      {chatTask && (
        <div className="fixed inset-y-0 right-0 w-96 z-50 shadow-xl">
          <ChatPanel
            taskId={chatTask.id}
            projectId={id}
            taskTitle={chatTask.title}
            onClose={() => setChatTask(null)}
            onPushed={() => { setChatTask(null); refetch(); }}
          />
        </div>
      )}

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

      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 pb-32">

        {/* Section 1: Goals */}
        <GoalsDisplay goals={goalList} />

        {/* Section 2: What's happening — large & prominent */}
        <div className="space-y-2">
          <StatusSummary features={featureList} tasks={allTasks} />
          <AgentActivitySummary tasks={allTasks} />
        </div>

        {/* Section 3: Changes digest */}
        <ChangesDigest
          tasks={allTasks}
          projectId={id}
          onMergeAll={handleMergeAll}
          mergingAll={mergingAll}
        />

        {/* Section 4: Features */}
        {hasFeatures && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-mono text-vmuted uppercase tracking-wider">Features</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-2">
              {sortedActiveFeatures.map(feature => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  tasks={tasksByFeature[feature.id] || []}
                  onAction={refetch}
                  onChat={setChatTask}
                />
              ))}

              {/* "Other tasks" — tasks with no feature_id, excluding reviews/human tasks shown below */}
              {orphanTasks.filter(t => t.status !== 'needs_review' && t.task_type !== 'human').length > 0 && (
                <FeatureCard
                  key="__other__"
                  feature={{ id: '__other__', title: 'Other tasks' }}
                  tasks={orphanTasks.filter(t => t.status !== 'needs_review' && t.task_type !== 'human')}
                  onAction={refetch}
                  onChat={setChatTask}
                />
              )}

              {/* Completed features collapsed into summary */}
              <CompletedFeaturesSummary features={completedFeatures} tasksByFeature={tasksByFeature} />
            </div>
          </div>
        )}

        {/* Section 5: Needs your attention */}
        {attentionItems.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
              <h2 className="text-xs font-mono text-warning uppercase tracking-wider">
                Needs your attention ({attentionItems.length})
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {attentionItems.map(t => (
                <HumanTaskCard key={t.id} task={t} onAction={refetch} onChat={setChatTask} />
              ))}
            </div>
          </div>
        )}

        {/* Section 6: Ideas */}
        <IdeasSection projectId={id} onPromoted={refetch} />

        {/* Empty state (no features and no tasks) */}
        {!hasFeatures && allTasks.length === 0 && attentionItems.length === 0 && (
          <div className="text-center py-12">
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
