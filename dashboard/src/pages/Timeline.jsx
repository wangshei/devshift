import React, { useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import TimelineEntry from '../components/TimelineEntry';

/**
 * Returns a human-readable date heading for a given date string (YYYY-MM-DD).
 */
function dateLabel(dateStr) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const fmt = d => d.toISOString().slice(0, 10);

  if (dateStr === fmt(today)) return 'Today';
  if (dateStr === fmt(yesterday)) return 'Yesterday';

  // e.g. "Monday, March 25"
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * Extract the best date string (YYYY-MM-DD) from a task for grouping.
 */
function taskDateKey(task) {
  const raw = task.completed_at || task.started_at || task.created_at;
  if (!raw) return 'Unknown';
  try {
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    return d.toISOString().slice(0, 10);
  } catch {
    return 'Unknown';
  }
}

export default function Timeline() {
  const { data, loading, error } = useApi('/timeline/dashboard');

  // Flatten all tasks from all projects into one array, adding project_name if missing
  const allTasks = useMemo(() => {
    if (!data?.projects) return [];
    const tasks = [];
    for (const p of data.projects) {
      const projectName = p.project?.name || '';
      const projectTasks = [
        ...(p.inProgress || []),
        ...(p.completed || []),
        ...(p.planned || []),
        ...(p.humanTasks || []),
      ].map(t => ({ ...t, project_name: t.project_name || projectName }));
      tasks.push(...projectTasks);
    }
    // Sort newest first: prefer completed_at, then started_at, then created_at
    tasks.sort((a, b) => {
      const tsA = a.completed_at || a.started_at || a.created_at || '';
      const tsB = b.completed_at || b.started_at || b.created_at || '';
      return tsB.localeCompare(tsA);
    });
    return tasks;
  }, [data]);

  // Group tasks by date key, preserving sort order
  const groups = useMemo(() => {
    const map = new Map();
    for (const task of allTasks) {
      const key = taskDateKey(task);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    }
    return Array.from(map.entries());
  }, [allTasks]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-accent shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h1 className="text-lg font-semibold tracking-tight">Timeline</h1>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4 py-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <div className="h-3 w-20 bg-border/50 rounded animate-pulse" />
                <div className="h-px flex-1 bg-border" />
              </div>
              {[1, 2].map(j => (
                <div key={j} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-border/50 animate-pulse" />
                  <div className="h-3 bg-border/50 rounded animate-pulse flex-1 max-w-[200px]" />
                  <div className="h-3 w-16 bg-border/50 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="text-center py-12 text-error text-sm">
          Failed to load timeline: {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && allTasks.length === 0 && (
        <div className="text-center py-12 px-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-accent">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="font-medium mb-2">No activity yet</h3>
          <p className="text-muted text-sm">Tasks will appear here as they are created and completed.</p>
        </div>
      )}

      {/* Date groups */}
      {!loading && !error && groups.map(([dateKey, tasks]) => (
        <div key={dateKey} className="mb-6">
          {/* Date separator */}
          <div className="flex items-center gap-2 mb-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-mono text-muted shrink-0">{dateLabel(dateKey)}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Tasks for this date */}
          <div className="flex flex-col">
            {tasks.map(t => (
              <TimelineEntry key={t.id} task={t} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
