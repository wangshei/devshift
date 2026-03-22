import React, { useState } from 'react';
import { useApi, api } from '../hooks/useApi';
import AgentStatusBar from '../components/AgentStatusBar';
import CreditGauge from '../components/CreditGauge';
import HumanTaskCard from '../components/HumanTaskCard';
import TimelineEntry from '../components/TimelineEntry';
import TaskInput from '../components/TaskInput';

export default function Timeline() {
  const { data: timeline, refetch } = useApi('/timeline');
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-accent font-mono font-bold">Dev</span>Shift
        </h1>
        <CreditGauge />
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={handleOffToday}
          className="px-3 py-1.5 text-xs bg-accent/10 text-accent border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors font-medium">
          I'm done for today
        </button>
        <div className="flex gap-1">
          <input type="date" value={offUntilDate} onChange={e => setOffUntilDate(e.target.value)}
            className="px-2 py-1 text-xs bg-card border border-border rounded-lg text-text focus:outline-none focus:border-accent" />
          <button onClick={handleOffUntil} disabled={!offUntilDate}
            className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text disabled:opacity-40 transition-colors">
            I'm off until...
          </button>
        </div>
        {timeline?.schedule?.vacation_mode ? (
          <button onClick={handleImBack}
            className="px-3 py-1.5 text-xs bg-success/10 text-success border border-success/20 rounded-lg hover:bg-success/20 transition-colors font-medium">
            I'm back
          </button>
        ) : null}
      </div>

      {/* Agent status */}
      <div className="mb-6">
        <AgentStatusBar />
      </div>

      {/* Human tasks */}
      {timeline?.humanTasks?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-mono text-muted uppercase tracking-wider mb-2">Needs your attention</h2>
          <div className="flex flex-col gap-2">
            {timeline.humanTasks.map(t => <HumanTaskCard key={t.id} task={t} />)}
          </div>
        </div>
      )}

      {/* Today divider */}
      <div className="flex items-center gap-2 mb-3 mt-4">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-mono text-muted">{today}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* In-progress tasks */}
      {timeline?.inProgress?.map(t => <TimelineEntry key={t.id} task={t} />)}

      {/* Completed tasks */}
      {timeline?.completed?.map(t => <TimelineEntry key={t.id} task={t} />)}

      {/* Planned divider */}
      {timeline?.planned?.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3 mt-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-mono text-vmuted">Planned</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {timeline.planned.map(t => <TimelineEntry key={t.id} task={t} />)}
        </>
      )}

      {/* Empty state */}
      {!timeline?.humanTasks?.length && !timeline?.inProgress?.length &&
       !timeline?.completed?.length && !timeline?.planned?.length && (
        <div className="text-center py-12">
          <p className="text-muted text-sm">No tasks yet. Add one below.</p>
        </div>
      )}

      {/* Task input */}
      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:relative md:mt-6 bg-bg p-4 md:p-0 border-t md:border-0 border-border">
        <div className="max-w-2xl mx-auto">
          <TaskInput onTaskAdded={refetch} />
        </div>
      </div>
    </div>
  );
}
