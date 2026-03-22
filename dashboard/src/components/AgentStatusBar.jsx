import React from 'react';
import { useApi, api } from '../hooks/useApi';

export default function AgentStatusBar() {
  const { data: status, refetch } = useApi('/agent/status');

  if (!status) return null;

  const handleStart = async () => { await api('/agent/start', { method: 'POST' }); refetch(); };
  const handlePause = async () => { await api('/agent/pause', { method: 'POST' }); refetch(); };
  const handleResume = async () => { await api('/agent/resume', { method: 'POST' }); refetch(); };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-card rounded-lg border border-border">
      <div className={`w-2 h-2 rounded-full ${status.running && !status.paused ? 'bg-success animate-pulse' : status.paused ? 'bg-warning' : 'bg-vmuted'}`} />
      <span className="text-sm font-mono">
        {status.running && !status.paused ? 'Agent running' : status.paused ? 'Agent paused' : 'Agent idle'}
      </span>
      {status.currentTask && (
        <span className="text-xs text-muted truncate max-w-48">
          — {status.currentTask.title}
        </span>
      )}
      <span className="text-xs text-muted ml-auto font-mono">
        {status.queuedTasks} queued
      </span>
      <div className="flex gap-1">
        {!status.running && (
          <button onClick={handleStart} className="px-2 py-1 text-xs bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors">Start</button>
        )}
        {status.running && !status.paused && (
          <button onClick={handlePause} className="px-2 py-1 text-xs bg-warning/20 text-warning rounded hover:bg-warning/30 transition-colors">Pause</button>
        )}
        {status.paused && (
          <button onClick={handleResume} className="px-2 py-1 text-xs bg-success/20 text-success rounded hover:bg-success/30 transition-colors">Resume</button>
        )}
      </div>
    </div>
  );
}
