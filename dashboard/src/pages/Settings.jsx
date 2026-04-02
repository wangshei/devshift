import React, { useState, useEffect } from 'react';
import { useApi, api } from '../hooks/useApi';
import ProviderStatus from '../components/ProviderStatus';

function TimeGrid({ activity, blockedSlots, onToggleSlot, timezone }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Find max activity for color scaling
  const maxCount = Math.max(1, ...Object.values(activity || {}).flatMap(d => Object.values(d).map(h => h.count)));

  const isBlocked = (day, hour) => {
    return (blockedSlots || []).some(s => s.day === day && s.hour === hour);
  };

  const getColor = (day, hour) => {
    if (isBlocked(day, hour)) return 'bg-error/30 border-error/30';
    const count = activity?.[day]?.[hour]?.count || 0;
    if (count === 0) return 'bg-bg border-border';
    const intensity = Math.min(count / maxCount, 1);
    if (intensity > 0.6) return 'bg-success/40 border-success/30';
    if (intensity > 0.3) return 'bg-success/20 border-success/20';
    return 'bg-success/10 border-success/10';
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour labels */}
        <div className="flex items-center gap-0.5 mb-1 pl-10">
          {hours.map(h => (
            <div key={h} className="w-5 text-center text-[8px] font-mono text-vmuted">
              {h % 6 === 0 ? `${h}` : ''}
            </div>
          ))}
        </div>

        {/* Grid rows */}
        {days.map((day, dayIdx) => (
          <div key={day} className="flex items-center gap-0.5 mb-0.5">
            <div className="w-8 text-[10px] font-mono text-vmuted text-right mr-1">{day}</div>
            {hours.map(hour => (
              <button
                key={hour}
                onClick={() => onToggleSlot(dayIdx, hour)}
                className={`w-5 h-4 rounded-sm border transition-colors hover:opacity-80 ${getColor(dayIdx, hour)}`}
                title={`${day} ${hour}:00 — ${activity?.[dayIdx]?.[hour]?.count || 0} tasks${isBlocked(dayIdx, hour) ? ' (BLOCKED)' : ''}`}
              />
            ))}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-3 mt-2 pl-10 text-[9px] text-vmuted">
          <span className="flex items-center gap-1"><span className="w-3 h-2 bg-bg border border-border rounded-sm inline-block" /> No activity</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 bg-success/20 border border-success/20 rounded-sm inline-block" /> Active</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 bg-success/40 border border-success/30 rounded-sm inline-block" /> Busy</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 bg-error/30 border border-error/30 rounded-sm inline-block" /> Blocked</span>
          <span className="ml-2">Click to block/unblock</span>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { data: schedule, refetch: refetchSchedule } = useApi('/schedule');
  const { data: providers, refetch: refetchProviders } = useApi('/providers');
  const { data: memoryStats } = useApi('/memory/stats');
  const { data: activityData } = useApi('/schedule/activity');
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [blockedSlots, setBlockedSlots] = useState([]);

  useEffect(() => {
    if (schedule && !form) {
      setForm({
        timezone: schedule.timezone,
        active_hours_start: schedule.active_hours_start,
        active_hours_end: schedule.active_hours_end,
        active_days: schedule.active_days,
        max_tasks_per_window: schedule.max_tasks_per_window,
        reserve_percent: schedule.reserve_percent,
        memory_per_category: schedule.memory_per_category,
        memory_system_max: schedule.memory_system_max,
        log_retention_days: schedule.log_retention_days,
      });
    }
  }, [schedule]);

  // Load blocked slots from schedule
  useEffect(() => {
    if (schedule?.blocked_slots) {
      try { setBlockedSlots(JSON.parse(schedule.blocked_slots)); } catch {}
    }
  }, [schedule]);

  const handleSave = async () => {
    await api('/schedule', { method: 'PATCH', body: form });
    refetchSchedule();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDetect = async () => {
    await api('/providers/detect', { method: 'POST' });
    refetchProviders();
  };

  const handleToggleProvider = async (id, currentEnabled) => {
    await api(`/providers/${id}`, { method: 'PATCH', body: { enabled: currentEnabled ? 0 : 1 } });
    refetchProviders();
  };

  const handleToggleSlot = async (day, hour) => {
    const existing = blockedSlots.findIndex(s => s.day === day && s.hour === hour);
    let newSlots;
    if (existing >= 0) {
      newSlots = blockedSlots.filter((_, i) => i !== existing);
    } else {
      newSlots = [...blockedSlots, { day, hour }];
    }
    setBlockedSlots(newSlots);
    await api('/schedule', { method: 'PATCH', body: { blocked_slots: JSON.stringify(newSlots) } });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      <h1 className="text-lg font-semibold mb-6">Settings</h1>

      {/* Agent Schedule */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-muted mb-3">Agent Schedule</h2>
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-vmuted">
              Green = when agents worked this week. Click any slot to block agent activity.
            </p>
            <span className="text-[10px] font-mono text-vmuted">{activityData?.timezone || form?.timezone}</span>
          </div>
          <TimeGrid
            activity={activityData?.grid}
            blockedSlots={blockedSlots}
            onToggleSlot={handleToggleSlot}
            timezone={activityData?.timezone}
          />

          {/* Keep timezone and max tasks settings below the grid */}
          <div className="flex gap-4 pt-3 border-t border-border">
            <div className="flex-1">
              <label className="text-xs text-vmuted block mb-1">Timezone</label>
              <input value={form?.timezone || ''} onChange={e => setForm({ ...form, timezone: e.target.value })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-vmuted block mb-1">Max tasks per day</label>
              <input type="number" value={form?.max_tasks_per_window || 6}
                onChange={e => setForm({ ...form, max_tasks_per_window: parseInt(e.target.value) || 6 })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-vmuted block mb-1">Reserve % for your coding</label>
              <input type="number" min="0" max="90" value={form?.reserve_percent || 40}
                onChange={e => setForm({ ...form, reserve_percent: parseInt(e.target.value) || 40 })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            </div>
          </div>
          <button onClick={handleSave}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${saved ? 'bg-success text-white' : 'bg-accent text-white hover:bg-accent/80'}`}>
            {saved ? 'Saved \u2713' : 'Save'}
          </button>
        </div>
      </section>

      {/* Providers */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted">AI Providers</h2>
          <button onClick={handleDetect}
            className="px-2 py-1 text-xs text-accent hover:underline">
            Re-detect
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {providers?.map(p => (
            <ProviderStatus key={p.id} provider={p}
              onToggle={() => handleToggleProvider(p.id, p.enabled)} />
          ))}
        </div>
      </section>

      {/* Memory & Storage */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted mb-3">Memory & Storage</h2>
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          {memoryStats && (
            <div className="flex gap-4 text-xs text-vmuted font-mono">
              <span>{memoryStats.projectMemories} project memories</span>
              <span>{memoryStats.systemMemories} system memories</span>
            </div>
          )}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-vmuted block mb-1">Max memories per category</label>
              <input type="number" min="5" max="100" value={form?.memory_per_category || 20}
                onChange={e => setForm({ ...form, memory_per_category: parseInt(e.target.value) || 20 })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-vmuted block mb-1">Max system memories</label>
              <input type="number" min="10" max="200" value={form?.memory_system_max || 30}
                onChange={e => setForm({ ...form, memory_system_max: parseInt(e.target.value) || 30 })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-vmuted block mb-1">Log retention (days)</label>
              <input type="number" min="1" max="90" value={form?.log_retention_days || 7}
                onChange={e => setForm({ ...form, log_retention_days: parseInt(e.target.value) || 7 })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
