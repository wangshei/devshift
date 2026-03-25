import React, { useState } from 'react';
import { api } from '../hooks/useApi';

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

export default function HumanTaskCard({ task, onAction }) {
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const isReview = task.status === 'needs_review' && task.branch_name;

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
      </div>

      {/* Diff viewer */}
      {showDiff && diff && (
        <div className="border-t border-border">
          {diff.stat && (
            <div className="px-4 py-2 bg-bg text-xs font-mono text-muted">
              {diff.stat}
            </div>
          )}
          {diff.diff ? (
            <pre className="px-4 py-3 text-[11px] font-mono overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
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
