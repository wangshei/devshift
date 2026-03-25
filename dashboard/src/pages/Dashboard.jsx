import React, { useState } from 'react';
import { useApi, api } from '../hooks/useApi';
import AgentStatusBar from '../components/AgentStatusBar';
import CreditGauge from '../components/CreditGauge';
import ProjectStatusCard from '../components/ProjectStatusCard';
import TaskInput from '../components/TaskInput';

export default function Dashboard() {
  const { data, refetch } = useApi('/timeline/dashboard', [], 5000);
  const [showAddProject, setShowAddProject] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const handleOffToday = async () => {
    await api('/schedule/off-today', { method: 'POST' });
    refetch();
  };

  const handleImBack = async () => {
    await api('/schedule/im-back', { method: 'POST' });
    refetch();
  };

  const handleAddProject = async () => {
    if (!pathInput.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await api('/projects/from-path', { method: 'POST', body: { path: pathInput.trim() } });
      setPathInput('');
      setShowAddProject(false);
      refetch();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const isVacation = data?.schedule?.vacation_mode;
  const isOffToday = data?.schedule?.off_today;
  const totalReviews = data?.projects?.reduce((sum, p) => sum + p.needsReview, 0) || 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-accent font-mono font-bold">Dev</span>Shift
        </h1>
        <CreditGauge />
      </div>

      {/* Agent status */}
      <div className="mb-4">
        <AgentStatusBar />
      </div>

      {/* Main action */}
      <div className="mb-6">
        {isVacation ? (
          <button onClick={handleImBack}
            className="w-full py-3 text-sm bg-success/10 text-success border border-success/20 rounded-lg hover:bg-success/20 transition-colors font-medium">
            I'm back — pause the agent
          </button>
        ) : isOffToday ? (
          <div className="w-full py-3 text-sm bg-accent/5 border border-accent/10 rounded-lg text-center text-muted">
            Agent is working your off-hours tasks
          </div>
        ) : (
          <button onClick={handleOffToday}
            className="w-full py-3 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium">
            I'm done for today — let the agent work
          </button>
        )}
      </div>

      {/* Reviews banner */}
      {totalReviews > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-warning/10 border border-warning/20 rounded-lg mb-4">
          <div className="w-2 h-2 rounded-full bg-warning" />
          <span className="text-sm text-warning font-medium">
            {totalReviews} task{totalReviews > 1 ? 's' : ''} need{totalReviews === 1 ? 's' : ''} your review
          </span>
        </div>
      )}

      {/* Project cards */}
      <div className="space-y-3 mb-6">
        <h2 className="text-xs font-mono text-muted uppercase tracking-wider">
          Your projects ({data?.projects?.length || 0})
        </h2>
        {data?.projects?.map(p => (
          <ProjectStatusCard key={p.project.id} data={p} />
        ))}

        {/* Add project */}
        {showAddProject ? (
          <div className="p-4 bg-card border border-border rounded-lg">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={pathInput}
                onChange={e => { setPathInput(e.target.value); setAddError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleAddProject()}
                placeholder="/Users/you/code/my-project"
                className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text font-mono placeholder:text-vmuted focus:outline-none focus:border-accent"
                autoFocus
              />
              <button onClick={handleAddProject} disabled={!pathInput.trim() || adding}
                className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors">
                {adding ? '...' : 'Add'}
              </button>
            </div>
            {addError && <p className="text-xs text-error">{addError}</p>}
            <button onClick={() => setShowAddProject(false)} className="text-xs text-muted hover:text-text mt-1">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddProject(true)}
            className="w-full p-4 border border-dashed border-border rounded-lg text-sm text-muted hover:text-accent hover:border-accent/30 transition-colors text-center"
          >
            + Add a project
          </button>
        )}
      </div>

      {/* Task input */}
      {data?.projects?.length > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:relative md:mt-4 bg-bg p-4 md:p-0 border-t md:border-0 border-border">
          <div className="max-w-2xl mx-auto">
            <TaskInput onTaskAdded={refetch} />
          </div>
        </div>
      )}
    </div>
  );
}
