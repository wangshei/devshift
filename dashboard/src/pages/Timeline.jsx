import React, { useState } from 'react';
import { useApi, api } from '../hooks/useApi';
import AgentStatusBar from '../components/AgentStatusBar';
import CreditGauge from '../components/CreditGauge';
import HumanTaskCard from '../components/HumanTaskCard';
import TimelineEntry from '../components/TimelineEntry';
import TaskInput from '../components/TaskInput';

export default function Timeline() {
  const { data: timeline, refetch } = useApi('/timeline');
  const { data: agentStatus } = useApi('/agent/status');
  const [offUntilDate, setOffUntilDate] = useState('');

  const handleOffToday = async () => {
    await api('/schedule/off-today', { method: 'POST' });
    refetch();
  };

  const handleOffUntil = async () => {
    if (!offUntilDate) return;
    await api('/schedule/off-until', { method: 'POST', body: { until: offUntilDate } });
    setOffUntilDate('');
    refetch();
  };

  const handleImBack = async () => {
    await api('/schedule/im-back', { method: 'POST' });
    refetch();
  };

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isEmpty = !timeline?.humanTasks?.length && !timeline?.inProgress?.length &&
    !timeline?.completed?.length && !timeline?.planned?.length;
  const isVacation = timeline?.schedule?.vacation_mode;
  const isOffToday = timeline?.schedule?.off_today;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-accent font-mono font-bold">Dev</span>Shift
        </h1>
        <CreditGauge />
      </div>

      {/* Agent status */}
      <div className="mb-4">
        <AgentStatusBar />
      </div>

      {/* Main action button */}
      <div className="flex gap-2 mb-6">
        {isVacation ? (
          <button onClick={handleImBack}
            className="flex-1 py-3 text-sm bg-success/10 text-success border border-success/20 rounded-lg hover:bg-success/20 transition-colors font-medium">
            I'm back — pause the agent
          </button>
        ) : isOffToday ? (
          <button onClick={handleImBack}
            className="flex-1 py-3 text-sm bg-card border border-border rounded-lg text-muted transition-colors">
            Agent is working your off-hours tasks
          </button>
        ) : (
          <button onClick={handleOffToday}
            className="flex-1 py-3 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium">
            I'm done for today — let the agent work
          </button>
        )}
        {!isVacation && (
          <div className="flex items-center gap-1">
            <input type="date" value={offUntilDate} onChange={e => setOffUntilDate(e.target.value)}
              className="h-full px-2 text-xs bg-card border border-border rounded-lg text-text focus:outline-none focus:border-accent w-32" />
            {offUntilDate && (
              <button onClick={handleOffUntil}
                className="h-full px-3 text-xs bg-card border border-border rounded-lg text-accent hover:bg-accent/10 transition-colors whitespace-nowrap">
                Go
              </button>
            )}
          </div>
        )}
      </div>

      {/* Human tasks — most important, always on top */}
      {timeline?.humanTasks?.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full bg-warning" />
            <h2 className="text-xs font-mono text-warning uppercase tracking-wider">Needs your attention ({timeline.humanTasks.length})</h2>
          </div>
          <div className="flex flex-col gap-2">
            {timeline.humanTasks.map(t => <HumanTaskCard key={t.id} task={t} />)}
          </div>
        </div>
      )}

      {/* Today section */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-mono text-muted">{today}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* In-progress */}
      {timeline?.inProgress?.length > 0 && (
        <div className="mb-2">
          {timeline.inProgress.map(t => <TimelineEntry key={t.id} task={t} />)}
        </div>
      )}

      {/* Completed */}
      {timeline?.completed?.length > 0 && (
        <div className="mb-2">
          {timeline.completed.map(t => <TimelineEntry key={t.id} task={t} />)}
        </div>
      )}

      {/* Planned */}
      {timeline?.planned?.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3 mt-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-mono text-vmuted">Up next ({timeline.planned.length})</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {timeline.planned.map(t => <TimelineEntry key={t.id} task={t} />)}
        </>
      )}

      {/* Empty state — helpful guidance */}
      {isEmpty && (
        <div className="text-center py-12 px-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-4">
            <span className="text-accent text-xl">+</span>
          </div>
          <h3 className="font-medium mb-2">Add your first task</h3>
          <p className="text-muted text-sm mb-1">Type what you need done below.</p>
          <p className="text-vmuted text-xs">
            Examples: "add dark mode to settings", "fix the login bug", "write tests for auth"
          </p>
        </div>
      )}

      {/* Task input — always visible at bottom */}
      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:relative md:mt-6 bg-bg p-4 md:p-0 border-t md:border-0 border-border">
        <div className="max-w-2xl mx-auto">
          <TaskInput onTaskAdded={refetch} />
        </div>
      </div>
    </div>
  );
}
