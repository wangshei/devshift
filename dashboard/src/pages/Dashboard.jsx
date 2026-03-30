import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import TaskInput from '../components/TaskInput';

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, refetch } = useApi('/timeline/dashboard', [], 5000);
  const { data: schedule, refetch: refetchSchedule } = useApi('/schedule', [], 5000);
  const { data: agentStatus } = useApi('/agent/status', [], 4000);
  const { data: credits } = useApi('/credits', [], 10000);

  const isAlwaysOn = !!schedule?.always_on;
  const isOffToday = !!schedule?.off_today;
  const isVacation = !!schedule?.vacation_mode;
  const agentCanWork = isAlwaysOn || isOffToday || isVacation;

  const projects = data?.projects || [];
  const hasProjects = projects.length > 0;
  const isRunning = agentStatus?.running && !agentStatus?.paused;
  const backlogCount = agentStatus?.backlogTasks || 0;

  const toggleAlwaysOn = async () => {
    await api('/schedule', { method: 'PATCH', body: { always_on: isAlwaysOn ? 0 : 1 } });
    refetchSchedule();
  };

  const handleOffToday = async () => {
    await api('/schedule/off-today', { method: 'POST' });
    refetchSchedule();
    refetch();
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      {/* Welcome state when no projects */}
      {!hasProjects && (
        <div className="text-center py-16">
          <h2 className="text-xl font-bold mb-2">Welcome to DevShift</h2>
          <p className="text-muted text-sm mb-1 max-w-sm mx-auto">
            Add a project from the sidebar to get started.
          </p>
          <p className="text-vmuted text-xs max-w-sm mx-auto">
            The agent will work through your tasks while you're away.
          </p>
        </div>
      )}

      {hasProjects && (
        <>
          {/* Auto-pilot control — the main thing */}
          <div className={`rounded-lg border p-4 ${agentCanWork ? 'bg-success/5 border-success/20' : 'bg-card border-border'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-success animate-pulse' : agentCanWork ? 'bg-success' : 'bg-vmuted'}`} />
                <div>
                  <p className="text-sm font-medium text-text">
                    {isRunning ? 'Agent is working' : agentCanWork ? 'Agent ready' : 'Agent paused'}
                  </p>
                  <p className="text-[11px] text-muted">
                    {isRunning && agentStatus?.currentTask
                      ? agentStatus.currentTask.title
                      : agentCanWork
                        ? `${backlogCount} task${backlogCount !== 1 ? 's' : ''} in queue`
                        : backlogCount > 0
                          ? `${backlogCount} task${backlogCount !== 1 ? 's' : ''} waiting — turn on auto-pilot or click 'run for today' to start`
                          : 'Turn on auto-pilot to use your unused credits'
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={toggleAlwaysOn}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isAlwaysOn ? 'bg-success' : 'bg-border'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isAlwaysOn ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-vmuted">Auto-pilot</span>
              {!isAlwaysOn && !agentCanWork && (
                <button
                  onClick={handleOffToday}
                  className="text-[11px] text-accent hover:underline ml-auto"
                >
                  or just run for today
                </button>
              )}
              {isAlwaysOn && (
                <span className="text-[10px] text-success ml-auto">Uses credits when you're not coding</span>
              )}
            </div>
          </div>

          {/* Credits & Usage */}
          {credits && (
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider">Usage this week</h2>
                {credits.realCostUsd > 0 && (
                  <span className="text-sm font-mono font-medium text-text">${credits.realCostUsd.toFixed(2)}</span>
                )}
              </div>

              {/* Budget bar */}
              <div>
                <div className="flex justify-between text-[10px] font-mono text-vmuted mb-1">
                  <span>Agent: {credits.usedPercent}%</span>
                  <span>Reserved for you: {credits.reservedPercent}%</span>
                  <span>Available: {credits.availablePercent}%</span>
                </div>
                <div className="h-2 bg-bg rounded-full overflow-hidden flex">
                  <div className="bg-accent h-full" style={{ width: `${credits.usedPercent}%` }} />
                  <div className="bg-warning/30 h-full" style={{ width: `${credits.reservedPercent}%` }} />
                  <div className="bg-success/20 h-full" style={{ width: `${credits.availablePercent}%` }} />
                </div>
              </div>

              {/* Stats row */}
              <div className="flex gap-4 text-[11px] font-mono">
                <div>
                  <span className="text-vmuted">Agent tasks: </span>
                  <span className="text-text">{credits.agentTasksDone}</span>
                </div>
                <div>
                  <span className="text-vmuted">Human tasks: </span>
                  <span className="text-text">{credits.humanTasksDone}</span>
                </div>
                <div>
                  <span className="text-vmuted">Executions: </span>
                  <span className="text-text">{credits.executionCount || 0}</span>
                </div>
              </div>

              {/* Provider breakdown */}
              {credits.providerBreakdown?.length > 0 && (
                <div className="flex gap-3 text-[10px] font-mono text-vmuted pt-1 border-t border-border">
                  {credits.providerBreakdown.map(p => (
                    <span key={p.id}>
                      {p.name}: {p.tasksDone} tasks
                      {p.rateLimitedUntil && new Date(p.rateLimitedUntil) > new Date() && (
                        <span className="text-warning ml-1">(rate limited)</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Projects */}
          <div>
            <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-2">Your projects</h2>
            <div className="space-y-1.5">
              {projects.map(p => (
                <button
                  key={p.project.id}
                  onClick={() => navigate(`/project/${p.project.id}`)}
                  className={`w-full flex items-center gap-3 px-4 py-3 bg-card border rounded-lg hover:border-accent/30 hover:bg-hover transition-all text-left ${
                    p.needsReview > 0 ? 'border-warning/30' : 'border-border'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    p.activeTask ? 'bg-success animate-pulse' :
                    p.needsReview > 0 ? 'bg-warning' :
                    'bg-vmuted'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-text truncate block">{p.project.name}</span>
                    {p.activeTask && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted truncate">Working: {p.activeTask.title}</span>
                        <span className="text-[10px] text-accent animate-pulse">live</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {p.completedToday > 0 && (
                      <span className="text-[11px] font-mono text-success">{p.completedToday} done</span>
                    )}
                    {p.needsReview > 0 && (
                      <span className="text-[11px] font-mono text-warning">{p.needsReview} to review</span>
                    )}
                    {p.backlog > 0 && (
                      <span className="text-[11px] font-mono text-vmuted">{p.backlog} queued</span>
                    )}
                    <span className="text-vmuted text-xs">→</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick add task */}
          <div>
            <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-2">Add a task</h2>
            <TaskInput onTaskAdded={refetch} />
          </div>
        </>
      )}
    </div>
  );
}
