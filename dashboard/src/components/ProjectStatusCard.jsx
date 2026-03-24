import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function ProjectStatusCard({ data }) {
  const navigate = useNavigate();
  const { project, activeTask, completedToday, needsReview, backlog, nextTask } = data;
  const hasAttention = needsReview > 0;

  return (
    <div
      onClick={() => navigate(`/project/${project.id}`)}
      className={`p-4 bg-card border rounded-lg cursor-pointer transition-all hover:border-accent/40 hover:bg-hover ${
        hasAttention ? 'border-warning/30' : 'border-border'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-text truncate">{project.name}</h3>
        {activeTask && (
          <span className="flex items-center gap-1.5 text-[10px] text-accent font-mono shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            running
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex gap-4 mb-3 text-xs font-mono">
        {activeTask ? (
          <span className="text-accent">1 running</span>
        ) : (
          <span className="text-vmuted">idle</span>
        )}
        <span className={completedToday > 0 ? 'text-success' : 'text-vmuted'}>
          {completedToday} done today
        </span>
        {needsReview > 0 && (
          <span className="text-warning">{needsReview} review{needsReview > 1 ? 's' : ''}</span>
        )}
        {backlog > 0 && (
          <span className="text-vmuted">{backlog} queued</span>
        )}
      </div>

      {/* Current/next task */}
      <div className="text-xs text-muted truncate">
        {activeTask ? (
          <span>Working on: <span className="text-text">{activeTask.title}</span></span>
        ) : nextTask ? (
          <span>Next: <span className="text-text">{nextTask}</span></span>
        ) : backlog === 0 && completedToday === 0 ? (
          <span className="text-vmuted">No tasks yet — add one from here or the detail view</span>
        ) : backlog === 0 ? (
          <span className="text-vmuted">Backlog empty</span>
        ) : null}
      </div>
    </div>
  );
}
