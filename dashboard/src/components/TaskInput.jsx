import React, { useState } from 'react';
import { useApi, api } from '../hooks/useApi';

export default function TaskInput({ onTaskAdded, fixedProjectId = null }) {
  const { data: projects } = useApi('/projects');
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(fixedProjectId || '');
  const [phase, setPhase] = useState('idle'); // idle | submitting | optimizing | done

  const handleSubmit = async (e) => {
    e.preventDefault();
    const pid = fixedProjectId || projectId;
    if (!title.trim() || !pid) return;

    setPhase('submitting');
    let taskId;
    try {
      const task = await api('/tasks', {
        method: 'POST',
        body: { project_id: pid, title: title.trim() },
      });
      taskId = task.id;
      setTitle('');
    } catch (err) {
      setPhase('idle');
      return;
    }

    // Optimize the prompt in background using Work Mode
    setPhase('optimizing');
    try {
      await api('/agent/improve-task', { method: 'POST', body: { task_id: taskId } });
    } catch {
      // Optimization is best-effort — task was already created
    }

    setPhase('done');
    onTaskAdded?.();
    setTimeout(() => setPhase('idle'), 1500);
  };

  const isWorking = phase === 'submitting' || phase === 'optimizing';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        {!fixedProjectId && (
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            disabled={isWorking}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">Project...</option>
            {projects?.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={isWorking ? '' : 'Describe a task in plain English...'}
          disabled={isWorking}
          className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!title.trim() || (!fixedProjectId && !projectId) || isWorking}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
      {phase === 'submitting' && (
        <p className="text-[11px] text-muted font-mono pl-1">Adding task...</p>
      )}
      {phase === 'optimizing' && (
        <p className="text-[11px] text-accent font-mono pl-1 animate-pulse">
          Optimizing prompt with AI...
        </p>
      )}
      {phase === 'done' && (
        <p className="text-[11px] text-success font-mono pl-1">
          Task added and optimized ✓
        </p>
      )}
    </form>
  );
}
