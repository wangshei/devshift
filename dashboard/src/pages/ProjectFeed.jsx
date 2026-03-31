import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import HumanTaskCard from '../components/HumanTaskCard';
import SplitDiffViewer from '../components/SplitDiffViewer';
import TaskInput from '../components/TaskInput';
import ChatPanel from '../components/ChatPanel';

// ---------------------------------------------------------------------------
// Shared helpers kept from original
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// FeatureCard — the main building block of the new view
// ---------------------------------------------------------------------------

function FeatureCard({ feature, tasks, onAction, onChat }) {
  const [expanded, setExpanded] = useState(false);
  const [actingTask, setActingTask] = useState(null);
  const [diff, setDiff] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [reviewTask, setReviewTask] = useState(null);

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

  const isComplete = done === total && total > 0 && needsReview === 0;

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

  return (
    <div className={`bg-card border rounded-lg overflow-hidden transition-opacity ${isComplete ? 'opacity-60' : ''} ${
      needsReview > 0 ? 'border-warning/30' : inProgress > 0 ? 'border-accent/20' : 'border-border'
    }`}>
      {/* Summary row */}
      <div className="px-4 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-medium ${isComplete ? 'text-muted' : 'text-text'}`}>
                {feature.title}
              </span>
              <span className={`text-[10px] font-mono ${statusColor}`}>{statusLabel}</span>
              {needsReview > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
              )}
            </div>
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
                className="px-2.5 py-1 text-[10px] font-mono bg-warning/10 text-warning border border-warning/20 rounded-md hover:bg-warning/20 transition-colors"
              >
                Review ({needsReview})
              </button>
            )}
            <span className="text-vmuted text-xs">{expanded ? '▴' : '▾'}</span>
          </div>
        </div>
      </div>

      {/* Expanded: individual tasks */}
      {expanded && (
        <div className="border-t border-border">
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
                      {t.actual_minutes && (
                        <span className="text-[10px] font-mono text-vmuted">{t.actual_minutes}m</span>
                      )}
                    </div>

                    {/* Review actions inline */}
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
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IdeasSection
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
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-mono text-vmuted uppercase tracking-wider">Ideas</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-1 mb-2">
        {list.length === 0 && (
          <p className="text-xs text-vmuted italic px-1">No ideas yet — capture something below.</p>
        )}
        {list.map(idea => (
          <div key={idea.id} className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg group">
            <span className="text-vmuted text-xs">◌</span>
            <span className="flex-1 text-xs text-muted">{idea.title}</span>
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
  );
}

// ---------------------------------------------------------------------------
// StatusSummary — "What's happening" section
// ---------------------------------------------------------------------------

function StatusSummary({ features, tasks, goals }) {
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

  const completedFeatures = features.filter(f => {
    const fTasks = tasks.filter(t => t.feature_id === f.id);
    return fTasks.length > 0 && fTasks.every(t => t.status === 'done');
  });

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
    primary = `All caught up.`;
    secondary = `${completedThisWeek.length} task${completedThisWeek.length !== 1 ? 's' : ''} completed this week.`;
  } else {
    primary = 'No active work.';
    secondary = 'Add a task below to get started.';
  }

  if (!secondary && needsReviewTasks.length > 0 && inProgressTasks.length > 0) {
    secondary = `${needsReviewTasks.length} item${needsReviewTasks.length !== 1 ? 's' : ''} need your review.`;
  }

  const goalList = Array.isArray(goals) ? goals : [];

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 space-y-2">
      <div>
        <p className="text-sm text-text font-medium">{primary}</p>
        {secondary && <p className="text-xs text-muted mt-0.5">{secondary}</p>}
      </div>
      {goalList.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
          {goalList.map(g => (
            <span key={g.id} className="text-[10px] px-2 py-0.5 bg-accent/10 text-accent rounded-full font-mono">
              {g.title || g.text || g.description}
            </span>
          ))}
        </div>
      )}
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

  const refetch = () => { refetchTimeline(); refetchFeatures(); };

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
  // Human tasks: task_type === 'human'
  const humanTaskItems = (humanTasks || []).filter(t => t.task_type === 'human' || t.plan_status === 'pending_review');

  // Attention items: humanTaskItems + orphanReviews not already in humanTasks
  const humanTaskIds = new Set((humanTasks || []).map(t => t.id));
  const attentionItems = [
    ...(humanTasks || []),
    ...orphanReviews.filter(t => !humanTaskIds.has(t.id)),
  ];

  // Sort features: incomplete/in-progress first, complete last
  const sortedFeatures = [...featureList].sort((a, b) => {
    const aTasks = tasksByFeature[a.id] || [];
    const bTasks = tasksByFeature[b.id] || [];
    const aDone = aTasks.length > 0 && aTasks.every(t => t.status === 'done');
    const bDone = bTasks.length > 0 && bTasks.every(t => t.status === 'done');
    if (aDone && !bDone) return 1;
    if (!aDone && bDone) return -1;
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

        {/* Section 1: What's happening */}
        <StatusSummary
          features={featureList}
          tasks={allTasks}
          goals={goalList}
        />

        {/* Section 2: Features */}
        {hasFeatures && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-mono text-vmuted uppercase tracking-wider">Features</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-2">
              {sortedFeatures.map(feature => (
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
            </div>
          </div>
        )}

        {/* Section 3: Needs your attention */}
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

        {/* Section 4: Ideas */}
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
