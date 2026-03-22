import React from 'react';

const TYPE_STYLES = {
  needs_review: { icon: '▸', label: 'Review', color: 'text-warning' },
  waiting_human: { icon: '▸', label: 'Action needed', color: 'text-error' },
  human: { icon: '▸', label: 'Human task', color: 'text-accent' },
  blocked: { icon: '◆', label: 'Blocked', color: 'text-error' },
};

export default function HumanTaskCard({ task }) {
  const style = TYPE_STYLES[task.status] || TYPE_STYLES[task.task_type] || TYPE_STYLES.human;

  return (
    <div className="px-4 py-3 bg-card rounded-lg border border-border hover:border-accent/30 transition-colors cursor-pointer">
      <div className="flex items-start gap-2">
        <span className={`${style.color} mt-0.5`}>{style.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-mono uppercase ${style.color}`}>{style.label}</span>
            {task.project_name && (
              <span className="text-[10px] text-vmuted font-mono">({task.project_name})</span>
            )}
          </div>
          <p className="text-sm mt-0.5 text-text">{task.title}</p>
          {task.review_instructions && (
            <p className="text-xs text-muted mt-1">{task.review_instructions}</p>
          )}
        </div>
        {task.pr_url && (
          <a href={task.pr_url} target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-accent hover:underline shrink-0">
            PR #{task.pr_number}
          </a>
        )}
      </div>
    </div>
  );
}
