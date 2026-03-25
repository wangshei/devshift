import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import HumanTaskCard from '../components/HumanTaskCard';
import TimelineEntry from '../components/TimelineEntry';
import TaskInput from '../components/TaskInput';

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, refetch } = useApi(`/timeline/project/${id}`, [], 5000);
  const [editing, setEditing] = useState(false);
  const [context, setContext] = useState('');
  const [renamingName, setRenamingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  if (!data) return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="text-muted animate-pulse">Loading...</div>
    </div>
  );

  const { project, humanTasks, completed, inProgress, planned } = data;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isEmpty = !humanTasks?.length && !inProgress?.length && !completed?.length && !planned?.length;

  const handleSaveContext = async () => {
    await api(`/projects/${id}`, { method: 'PATCH', body: { context } });
    setEditing(false);
    refetch();
  };

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

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') { setRenamingName(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}" and all its tasks?`)) return;
    await api(`/projects/${id}`, { method: 'DELETE' });
    navigate('/');
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')}
          className="text-muted hover:text-text transition-colors text-sm">
          &#8592; Back
        </button>
        <div className="flex-1 min-w-0">
          {renamingName ? (
            <input
              autoFocus
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              onBlur={handleRenameCommit}
              onKeyDown={handleRenameKeyDown}
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
        </div>
      </div>

      {/* Human tasks */}
      {humanTasks?.length > 0 && (
        <div className="mb-6">
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

      {/* Today */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-mono text-muted">{today}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {inProgress?.map(t => <TimelineEntry key={t.id} task={t} />)}
      {completed?.map(t => <TimelineEntry key={t.id} task={t} />)}

      {/* Planned */}
      {planned?.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3 mt-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-mono text-vmuted">Up next ({planned.length})</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {planned.map(t => <TimelineEntry key={t.id} task={t} />)}
        </>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-10">
          <p className="text-muted text-sm mb-1">No tasks for {project.name} yet.</p>
          <p className="text-vmuted text-xs">Add a task below to get started.</p>
        </div>
      )}

      {/* Project info */}
      <div className="mt-8 p-4 bg-card border border-border rounded-lg">
        <h3 className="text-xs font-mono text-muted uppercase tracking-wider mb-3">Project info</h3>
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-vmuted w-16 shrink-0">Path</span>
            <span className="font-mono text-xs text-muted truncate">{project.repo_path}</span>
          </div>
          {project.github_remote && (
            <div className="flex gap-2">
              <span className="text-vmuted w-16 shrink-0">Remote</span>
              <span className="font-mono text-xs text-muted truncate">{project.github_remote}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-vmuted w-16 shrink-0">Context</span>
            {editing ? (
              <div className="flex-1">
                <textarea value={context} onChange={e => setContext(e.target.value)} rows={3}
                  className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent resize-none" />
                <div className="flex gap-2 mt-1">
                  <button onClick={handleSaveContext} className="text-xs text-accent hover:underline">Save</button>
                  <button onClick={() => setEditing(false)} className="text-xs text-muted hover:text-text">Cancel</button>
                </div>
              </div>
            ) : (
              <span className="text-xs text-muted flex-1">
                {project.context || 'No context set'}
                <button onClick={() => { setContext(project.context || ''); setEditing(true); }}
                  className="text-accent hover:underline ml-2">edit</button>
              </span>
            )}
          </div>
        </div>
        <button onClick={handleDelete}
          className="mt-4 text-xs text-error/60 hover:text-error transition-colors">
          Delete project
        </button>
      </div>

      {/* Task input */}
      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:relative md:mt-4 bg-bg p-4 md:p-0 border-t md:border-0 border-border">
        <div className="max-w-2xl mx-auto">
          <TaskInput fixedProjectId={id} onTaskAdded={refetch} />
        </div>
      </div>
    </div>
  );
}
