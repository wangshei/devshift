import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import TaskInput from '../components/TaskInput';

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, refetch } = useApi('/timeline/dashboard', [], 5000);
  const { data: schedule, refetch: refetchSchedule } = useApi('/schedule', [], 5000);
  const { data: agentStatus } = useApi('/agent/status', [], 4000);
  const { data: planStatus } = useApi('/plan-status', [], 30000);
  const { data: providers, refetch: refetchProviders } = useApi('/providers', [], 10000);

  const isAlwaysOn = !!schedule?.always_on;
  const isOffToday = !!schedule?.off_today;
  const isVacation = !!schedule?.vacation_mode;
  const agentCanWork = isAlwaysOn || isOffToday || isVacation;

  const projects = data?.projects || [];
  const hasProjects = projects.length > 0;
  const loading = !data;
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

  const handleStartProject = async (e, projectId) => {
    e.stopPropagation();
    await api(`/projects/${projectId}`, { method: 'PATCH', body: { paused: 0 } });
    // Scan for tasks to do
    try {
      await api('/agent/scan-project', { method: 'POST', body: { project_id: projectId } });
    } catch { /* scan is best-effort */ }
    await api('/agent/start', { method: 'POST' });
    refetch();
  };

  // Capacity estimates
  const maxTasksPerDay = schedule?.max_tasks_per_window || 6;
  const totalBacklog = projects.reduce((s, p) => s + (p.backlog || 0), 0);
  const totalReviews = projects.reduce((s, p) => s + (p.needsReview || 0), 0);

  // Provider plan info (from /plan-status which checks CLI status)
  const planProviders = planStatus?.providers?.filter(p => p.status !== 'not_installed') || [];

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      {loading && (
        <div className="flex items-center justify-center py-16">
          <span className="text-accent font-mono text-sm animate-pulse">Loading dashboard...</span>
        </div>
      )}

      {!loading && !hasProjects && (
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

      {!loading && hasProjects && (
        <>
          {/* Auto-pilot control */}
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
                <button onClick={handleOffToday} className="text-[11px] text-accent hover:underline ml-auto">
                  or just run for today
                </button>
              )}
              {isAlwaysOn && (
                <span className="text-[10px] text-success ml-auto">Uses credits when you're not coding</span>
              )}
            </div>
          </div>

          {/* Runtime notice */}
          {agentCanWork && (
            <p className="text-[10px] text-vmuted text-center -mt-3">
              Keep your Mac open for the agent to work. Tasks run locally on this machine.
            </p>
          )}

          {/* Coding agents */}
          {providers?.length > 0 && (
            <div className="bg-card border border-border rounded-lg px-4 py-3">
              <p className="text-xs font-mono text-vmuted uppercase tracking-wider mb-2">Coding agents</p>
              <div className="space-y-2">
                {providers.map(p => (
                  <div key={p.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${p.enabled ? 'bg-success' : 'bg-vmuted'}`} />
                      <span className="text-sm text-text">{p.name.replace('Google ', '')}</span>
                      {p.auth_status === 'authenticated' ? (
                        <span className="text-[10px] text-success font-mono">connected</span>
                      ) : p.auth_status === 'detected' ? (
                        <span className="text-[10px] text-warning font-mono">detected</span>
                      ) : (
                        <span className="text-[10px] text-vmuted font-mono">not found</span>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        await api(`/providers/${p.id}`, { method: 'PATCH', body: { enabled: p.enabled ? 0 : 1 } });
                        refetchProviders();
                      }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${p.enabled ? 'bg-success' : 'bg-border'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${p.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Capacity — tasks + provider credits */}
          <div className="bg-card border border-border rounded-lg px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-vmuted uppercase tracking-wider">Capacity</span>
              <button onClick={() => navigate('/usage')} className="text-[10px] text-accent hover:underline">Details</button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-xl font-bold font-mono text-text">{totalBacklog}</p>
                <p className="text-[10px] text-vmuted">Tasks queued</p>
              </div>
              <div>
                <p className="text-xl font-bold font-mono text-text">~{maxTasksPerDay}/day</p>
                <p className="text-[10px] text-vmuted">Agent capacity</p>
              </div>
              <div>
                <p className={`text-xl font-bold font-mono ${totalReviews > 0 ? 'text-warning' : 'text-text'}`}>{totalReviews}</p>
                <p className="text-[10px] text-vmuted">Need review</p>
              </div>
            </div>
            {/* Per-provider credit bars */}
            {planProviders.length > 0 && (
              <div className="pt-2 border-t border-border space-y-3">
                {planProviders.map(p => {
                  const used = p.usedPercent || 0;
                  const remaining = p.remainingPercent ?? (100 - used);
                  const barColor = remaining > 50 ? 'bg-success' : remaining > 20 ? 'bg-warning' : 'bg-error';
                  return (
                    <div key={p.id}>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-text font-medium">{p.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-vmuted font-mono">{p.plan}</span>
                          {p.status === 'rate_limited' ? (
                            <span className="text-error font-mono">Rate limited</span>
                          ) : (
                            <span className={`font-mono ${remaining > 50 ? 'text-success' : remaining > 20 ? 'text-warning' : 'text-error'}`}>
                              ~{remaining}% left
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${remaining}%` }}
                        />
                      </div>
                      {p.detail && (
                        <p className="text-[10px] text-vmuted mt-0.5 font-mono">{p.detail}</p>
                      )}
                    </div>
                  );
                })}
                {planProviders.some(p => p.refresh) && (
                  <p className="text-[10px] text-vmuted">
                    {planProviders.filter(p => p.refresh).map(p => `${p.name}: resets ${p.refresh.toLowerCase()}`).join(' · ')}
                  </p>
                )}
                {planProviders.some(p => p.estimated) && (
                  <p className="text-[9px] text-vmuted italic">Estimated from DevShift + CLI activity</p>
                )}
              </div>
            )}
            {totalBacklog > 0 && (
              <p className="text-[10px] text-muted font-mono mt-2 pt-2 border-t border-border">
                ~{Math.ceil(totalBacklog / maxTasksPerDay)} day{Math.ceil(totalBacklog / maxTasksPerDay) !== 1 ? 's' : ''} to clear backlog
              </p>
            )}
          </div>

          {/* Projects */}
          <div>
            <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-2">Your projects</h2>
            <div className="space-y-1.5">
              {projects.map(p => {
                const isPaused = !!p.project.paused;
                const isActive = !!p.activeTask && !isPaused;
                return (
                  <div
                    key={p.project.id}
                    className={`w-full flex items-center gap-3 px-4 py-3 bg-card border rounded-lg transition-all text-left cursor-pointer ${
                      isPaused ? 'border-border' :
                      p.needsReview > 0 ? 'border-warning/30 hover:border-warning/50' :
                      'border-border hover:border-accent/30'
                    } hover:bg-hover`}
                    onClick={() => navigate(`/project/${p.project.id}`)}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      isPaused ? 'bg-vmuted' :
                      isActive ? 'bg-success animate-pulse' :
                      p.needsReview > 0 ? 'bg-warning' :
                      'bg-vmuted'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium truncate block ${isPaused ? 'text-muted' : 'text-text'}`}>
                        {p.project.name}
                      </span>
                      {isActive && (
                        <span className="text-[11px] text-muted truncate block">Working: {p.activeTask.title}</span>
                      )}
                      {isPaused && (
                        <span className="text-[11px] text-vmuted">Agent paused on this project</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isPaused && p.completedToday > 0 && (
                        <span className="text-[11px] font-mono text-success">{p.completedToday} done</span>
                      )}
                      {!isPaused && p.needsReview > 0 && (
                        <span className="text-[11px] font-mono text-warning">{p.needsReview} review</span>
                      )}
                      {!isPaused && p.backlog > 0 && (
                        <span className="text-[11px] font-mono text-vmuted">{p.backlog} queued</span>
                      )}
                      {isPaused ? (
                        <button
                          onClick={(e) => handleStartProject(e, p.project.id)}
                          className="px-4 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium shadow-sm"
                        >
                          Start
                        </button>
                      ) : isActive ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-success font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                          Working
                        </span>
                      ) : (
                        <span className="text-[11px] text-vmuted font-mono">Standby</span>
                      )}
                      <span className="text-vmuted text-xs">→</span>
                    </div>
                  </div>
                );
              })}
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
