import React from 'react';

export default function ProjectCard({ project, taskCounts, onEdit, onDelete }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:border-accent/30 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-text">{project.name}</h3>
          <p className="text-xs font-mono text-vmuted mt-1 truncate max-w-64">{project.repo_path}</p>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="text-xs text-muted hover:text-text transition-colors px-2 py-1">Edit</button>
          <button onClick={onDelete} className="text-xs text-muted hover:text-error transition-colors px-2 py-1">Delete</button>
        </div>
      </div>
      {project.context && (
        <p className="text-xs text-muted mt-2">{project.context}</p>
      )}
      {taskCounts && (
        <div className="flex gap-3 mt-3 text-[10px] font-mono">
          <span className="text-vmuted">{taskCounts.backlog || 0} backlog</span>
          <span className="text-accent">{taskCounts.in_progress || 0} active</span>
          <span className="text-success">{taskCounts.done || 0} done</span>
          <span className="text-warning">{taskCounts.needs_review || 0} review</span>
        </div>
      )}
    </div>
  );
}
