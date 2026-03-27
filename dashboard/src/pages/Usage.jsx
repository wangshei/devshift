import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import ActivityGrid from '../components/ActivityGrid';

const RANGES = [
  { label: 'Week', value: 'week', days: 7 },
  { label: 'Month', value: 'month', days: 30 },
  { label: 'Year', value: 'year', days: 365 },
];

export default function Usage() {
  const [range, setRange] = useState('month');
  const current = RANGES.find(r => r.value === range);
  const { data } = useApi(`/timeline/usage?range=${range}`, [range], 0);
  const { data: credits } = useApi('/credits', [], 10000);
  const cli = credits?.cliUsage;

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Usage</h1>
        <div className="flex bg-card border border-border rounded-lg overflow-hidden">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 text-xs font-mono transition-colors ${
                range === r.value ? 'bg-accent text-white' : 'text-muted hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* CLI Usage */}
      {cli && (
        <div className="bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3">Your CLI activity (this week)</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold font-mono text-text">{cli.weekSessions}</p>
              <p className="text-[10px] text-vmuted">Sessions</p>
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-text">{cli.weekMessages}</p>
              <p className="text-[10px] text-vmuted">Messages sent</p>
            </div>
          </div>
          {cli.todayMessages > 0 && (
            <p className="text-[10px] text-muted font-mono mt-2 pt-2 border-t border-border">
              Today: {cli.todaySessions} session{cli.todaySessions !== 1 ? 's' : ''}, {cli.todayMessages} message{cli.todayMessages !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Agent vs Human collaboration */}
      {credits?.collaboration && (credits.collaboration.agentTasks > 0 || credits.collaboration.humanSessions > 0) && (
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3">Agent vs Human (this week)</p>
          <div className="flex items-center gap-3 mb-3">
            {/* Bar */}
            <div className="flex-1 h-4 bg-border rounded-full overflow-hidden flex">
              {credits.collaboration.agentPercent > 0 && (
                <div className="bg-accent h-full transition-all" style={{ width: `${credits.collaboration.agentPercent}%` }} />
              )}
              {credits.collaboration.humanPercent > 0 && (
                <div className="bg-success h-full transition-all" style={{ width: `${credits.collaboration.humanPercent}%` }} />
              )}
            </div>
          </div>
          <div className="flex justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-accent" />
              <span className="text-muted">Agent: {credits.collaboration.agentTasks} tasks ({credits.collaboration.agentPercent}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-success" />
              <span className="text-muted">You: {credits.collaboration.humanSessions} sessions ({credits.collaboration.humanPercent}%)</span>
            </div>
          </div>
        </div>
      )}

      {/* Activity grid */}
      {data && (
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3">Agent activity</p>
          <ActivityGrid data={data.dailyActivity} days={current.days} />
          {data.totals && (
            <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-border">
              <div>
                <p className="text-lg font-bold font-mono text-text">{data.totals.succeeded || 0}</p>
                <p className="text-[10px] text-vmuted">Completed</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono text-error">{data.totals.failed || 0}</p>
                <p className="text-[10px] text-vmuted">Failed</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono text-accent">{Math.round(data.totals.credits || 0)}</p>
                <p className="text-[10px] text-vmuted">Credits used</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-project breakdown */}
      {data?.perProject?.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <p className="text-xs font-mono text-vmuted uppercase tracking-wider px-4 pt-3 pb-2">By project</p>
          {data.perProject.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-border">
              <span className="text-sm font-medium text-text flex-1 truncate">{p.name}</span>
              <span className="text-[11px] font-mono text-success">{p.succeeded} done</span>
              {p.failed > 0 && <span className="text-[11px] font-mono text-error">{p.failed} failed</span>}
              <span className="text-[11px] font-mono text-vmuted">{Math.round(p.credits || 0)} cr</span>
            </div>
          ))}
        </div>
      )}

      {/* Provider breakdown */}
      {credits?.providerBreakdown?.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3">Providers</p>
          <div className="space-y-2">
            {credits.providerBreakdown.map(p => (
              <div key={p.id} className="flex items-center justify-between">
                <span className="text-sm text-text">{p.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-muted">{p.agentTasks} agent tasks</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    p.authStatus === 'authenticated' ? 'bg-success/10 text-success' : 'bg-border text-vmuted'
                  }`}>
                    {p.authStatus === 'authenticated' ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
