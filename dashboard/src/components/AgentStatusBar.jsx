import React from 'react';
import { useApi, api } from '../hooks/useApi';

const MODE_LABELS = {
  work: { label: 'Work Mode', color: 'text-accent', desc: 'Processing backlog' },
  smart: { label: 'Smart Mode', color: 'text-research', desc: 'Proactive improvements' },
  idle: { label: 'Idle', color: 'text-vmuted', desc: '' },
};

export default function AgentStatusBar() {
  const { data: status, refetch } = useApi('/agent/status', [], 4000);

  if (!status) return null;

  const handleStart = async () => { await api('/agent/start', { method: 'POST' }); refetch(); };
  const handlePause = async () => { await api('/agent/pause', { method: 'POST' }); refetch(); };
  const handleResume = async () => { await api('/agent/resume', { method: 'POST' }); refetch(); };

  const mode = MODE_LABELS[status.mode] || MODE_LABELS.idle;
  const isRunning = status.running && !status.paused;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-card rounded-lg border border-border">
      <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-success animate-pulse' : status.paused ? 'bg-warning' : 'bg-vmuted'}`} />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-mono">
          {isRunning ? 'Agent running' : status.paused ? 'Agent paused' : 'Agent idle'}
        </span>
        {isRunning && (
          <span className={`text-[10px] ${mode.color} font-mono`}>
            {mode.label}{status.currentTask ? ` — ${status.currentTask.title}` : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 ml-auto shrink-0">
        <span className="text-xs text-muted font-mono">
          {status.backlogTasks || 0} backlog
        </span>
        <div className="flex gap-1">
          {!status.running && (
            <button onClick={handleStart} className="px-2 py-1 text-xs bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors">Start</button>
          )}
          {isRunning && (
            <button onClick={handlePause} className="px-2 py-1 text-xs bg-warning/20 text-warning rounded hover:bg-warning/30 transition-colors">Pause</button>
          )}
          {status.paused && (
            <button onClick={handleResume} className="px-2 py-1 text-xs bg-success/20 text-success rounded hover:bg-success/30 transition-colors">Resume</button>
          )}
        </div>
      </div>
    </div>
  );
}
