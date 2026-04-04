import React, { useState, useEffect } from 'react';
import { useApi, api } from '../hooks/useApi';

const PRIORITY_OPTIONS = [
  { value: 5, label: 'Low' },
  { value: 4, label: 'Medium-Low' },
  { value: 3, label: 'Medium' },
  { value: 2, label: 'High' },
  { value: 1, label: 'Critical' },
];

export default function TaskInput({ onTaskAdded, fixedProjectId = null }) {
  const { data: projects } = useApi('/projects');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(5);
  const [deadline, setDeadline] = useState('');
  const [projectId, setProjectId] = useState(fixedProjectId || '');
  const [showDetails, setShowDetails] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | submitting | optimizing | done
  const [optimizeWithAI, setOptimizeWithAI] = useState(true);
  const [isLogging, setIsLogging] = useState(false);

  // Persist preference in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('devshift_optimize_ai');
    if (saved !== null) setOptimizeWithAI(saved === 'true');
  }, []);

  const handleToggleOptimize = (val) => {
    setOptimizeWithAI(val);
    localStorage.setItem('devshift_optimize_ai', val);
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority(5);
    setDeadline('');
    setShowDetails(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const pid = fixedProjectId || projectId;
    if (!title.trim() || !pid) return;

    setPhase('submitting');

    if (isLogging) {
      try {
        await api('/tasks/log-work', {
          method: 'POST',
          body: { project_id: pid, title: title.trim(), description: description.trim() || undefined },
        });
        setTitle('');
        setDescription('');
        setPhase('done');
        onTaskAdded?.();
        setTimeout(() => setPhase('idle'), 1500);
      } catch {
        setPhase('idle');
      }
      return;
    }

    let taskId;
    try {
      const body = {
        project_id: pid,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        deadline: deadline || undefined,
      };
      const task = await api('/tasks', {
        method: 'POST',
        body,
      });
      taskId = task.id;
      resetForm();
    } catch (err) {
      setPhase('idle');
      return;
    }

    // Optimize the prompt in background using Work Mode (only if toggle is on)
    if (optimizeWithAI) {
      setPhase('optimizing');
      try {
        await api('/agent/improve-task', { method: 'POST', body: { task_id: taskId } });
      } catch {
        // Optimization is best-effort — task was already created
      }
    }

    setPhase('done');
    onTaskAdded?.();
    setTimeout(() => setPhase('idle'), 1500);
  };

  const isWorking = phase === 'submitting' || phase === 'optimizing';
  const hasDetails = description.trim() || priority !== 5 || deadline;

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
          data-shortcut="quick-add"
          className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!title.trim() || (!fixedProjectId && !projectId) || isWorking}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isLogging ? 'Log' : '+'}
        </button>
      </div>

      <div className="flex items-center gap-3 pl-1">
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          disabled={isWorking}
          className="text-[11px] text-vmuted hover:text-accent transition-colors disabled:opacity-50"
        >
          {showDetails ? '- Hide details' : '+ Details'}{hasDetails && !showDetails ? ' *' : ''}
        </button>
        {!isLogging && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={optimizeWithAI}
              onChange={e => handleToggleOptimize(e.target.checked)}
              className="accent-accent w-3 h-3"
            />
            <span className="text-[11px] text-vmuted">Optimize prompt with AI</span>
            {phase === 'optimizing' && <span className="text-[11px] text-accent animate-pulse">optimizing...</span>}
          </label>
        )}
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={isLogging} onChange={e => setIsLogging(e.target.checked)}
            className="accent-accent w-3 h-3" />
          <span className="text-[11px] text-vmuted">Log completed work</span>
        </label>
        {phase === 'submitting' && (
          <p className="text-[11px] text-muted font-mono">Adding task...</p>
        )}
        {phase === 'done' && (
          <p className="text-[11px] text-success font-mono">
            {isLogging ? 'Work logged' : `Task added${optimizeWithAI ? ' and optimized' : ''}`} ✓
          </p>
        )}
      </div>

      {showDetails && (
        <div className="flex flex-col gap-2 pl-1 pr-1 pb-1 border border-border rounded-lg p-3 bg-card/50">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Add details, file paths, acceptance criteria..."
            disabled={isWorking}
            rows={3}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent disabled:opacity-50 resize-y"
          />
          <div className="flex gap-3 items-center flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-vmuted">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(Number(e.target.value))}
                disabled={isWorking}
                className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-text focus:outline-none focus:border-accent disabled:opacity-50"
              >
                {PRIORITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-vmuted">Deadline</label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                disabled={isWorking}
                className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-text focus:outline-none focus:border-accent disabled:opacity-50"
              />
              {deadline && (
                <button
                  type="button"
                  onClick={() => setDeadline('')}
                  className="text-[11px] text-vmuted hover:text-accent"
                >
                  clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
