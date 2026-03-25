import React from 'react';

function formatTime(ts) {
  if (!ts) return '~';
  try {
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '~';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return '~'; }
}

const STATUS_ICONS = {
  done: { icon: '\u2713', color: 'text-success' },
  in_progress: { icon: '\u25CF', color: 'text-accent animate-pulse' },
  backlog: { icon: '\u25CB', color: 'text-vmuted' },
  queued: { icon: '\u25CB', color: 'text-muted' },
  failed: { icon: '\u2717', color: 'text-error' },
  needs_review: { icon: '\u25B8', color: 'text-warning' },
};

const TIER_LABELS = { 1: 'Auto', 2: 'Review', 3: 'Research' };

export default function TimelineEntry({ task }) {
  const s = STATUS_ICONS[task.status] || STATUS_ICONS.backlog;
  const time = task.completed_at || task.started_at;
  const timeStr = formatTime(time);

  return (
    <div className="flex items-start gap-3 py-2 px-1 group">
      <span className="text-xs font-mono text-vmuted w-14 shrink-0 text-right mt-0.5">{timeStr}</span>
      <span className={`mt-0.5 ${s.color} text-sm`}>{s.icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-text">{task.title}</span>
        {task.project_name && (
          <span className="text-xs text-vmuted ml-2">({task.project_name})</span>
        )}
        {task.actual_minutes != null && (
          <span className="text-xs text-vmuted ml-2 font-mono">{task.actual_minutes}m</span>
        )}
      </div>
      <span className={`text-[10px] font-mono shrink-0 ${task.tier === 3 ? 'text-research' : 'text-vmuted'}`}>
        {TIER_LABELS[task.tier] || ''}
      </span>
    </div>
  );
}
