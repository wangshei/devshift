import React, { useState, useEffect } from 'react';
import { useApi, api } from '../hooks/useApi';
import ProviderStatus from '../components/ProviderStatus';

function ProviderRouting() {
  const { data: providers, refetch } = useApi('/providers', [], 0);

  const updateProvider = async (id, updates) => {
    await api(`/providers/${id}`, { method: 'PATCH', body: updates });
    refetch();
  };

  const tierLabels = { 1: 'Simple fixes', 2: 'Features', 3: 'Research' };

  if (!providers?.length) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-text">Agent routing</h3>
        <p className="text-xs text-muted mt-0.5">Control which AI tool handles which type of task</p>
      </div>
      {providers.map(p => (
        <div key={p.id} className={`bg-card border rounded-lg p-4 ${p.enabled ? 'border-border' : 'border-border opacity-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">{p.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                p.auth_status === 'authenticated' ? 'bg-success/10 text-success' : 'bg-border text-vmuted'
              }`}>
                {p.auth_status === 'authenticated' ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <button
              onClick={() => updateProvider(p.id, { enabled: p.enabled ? 0 : 1 })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${p.enabled ? 'bg-success' : 'bg-border'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${p.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
            </button>
          </div>
          {p.enabled && (
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-[10px] text-vmuted mr-1">Use for:</span>
              {[1, 2, 3].map(tier => {
                const tiers = (p.use_for_tiers || '1,2,3').split(',').map(Number);
                const isOn = tiers.includes(tier);
                return (
                  <label key={tier} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => {
                        const next = isOn ? tiers.filter(t => t !== tier) : [...tiers, tier].sort();
                        updateProvider(p.id, { use_for_tiers: next.join(',') });
                      }}
                      className="accent-accent w-3 h-3"
                    />
                    <span className={`text-[11px] ${isOn ? 'text-text' : 'text-vmuted'}`}>{tierLabels[tier]}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Settings() {
  const { data: schedule, refetch: refetchSchedule } = useApi('/schedule');
  const { data: providers, refetch: refetchProviders } = useApi('/providers');
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (schedule && !form) {
      setForm({
        timezone: schedule.timezone,
        active_hours_start: schedule.active_hours_start,
        active_hours_end: schedule.active_hours_end,
        active_days: schedule.active_days,
        max_tasks_per_window: schedule.max_tasks_per_window,
        reserve_percent: schedule.reserve_percent,
      });
    }
  }, [schedule]);

  const handleSave = async () => {
    await api('/schedule', { method: 'PATCH', body: form });
    refetchSchedule();
  };

  const handleDetect = async () => {
    await api('/providers/detect', { method: 'POST' });
    refetchProviders();
  };

  const handleToggleProvider = async (id, currentEnabled) => {
    await api(`/providers/${id}`, { method: 'PATCH', body: { enabled: currentEnabled ? 0 : 1 } });
    refetchProviders();
  };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      <h1 className="text-lg font-semibold mb-6">Settings</h1>

      {/* Schedule */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-muted mb-3">Schedule</h2>
        {form && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <div>
              <label className="text-xs text-vmuted block mb-1">Timezone</label>
              <input value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-vmuted block mb-1">Active hours start</label>
                <input type="time" value={form.active_hours_start}
                  onChange={e => setForm({ ...form, active_hours_start: e.target.value })}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-vmuted block mb-1">Active hours end</label>
                <input type="time" value={form.active_hours_end}
                  onChange={e => setForm({ ...form, active_hours_end: e.target.value })}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
              </div>
            </div>
            <div>
              <label className="text-xs text-vmuted block mb-1">Active days</label>
              <div className="flex gap-1">
                {dayNames.map((name, i) => {
                  const active = (form.active_days || '').split(',').map(Number).includes(i);
                  return (
                    <button key={i} onClick={() => {
                      const days = (form.active_days || '').split(',').map(Number);
                      const next = active ? days.filter(d => d !== i) : [...days, i].sort();
                      setForm({ ...form, active_days: next.join(',') });
                    }}
                      className={`px-2 py-1 text-xs rounded ${active ? 'bg-accent/20 text-accent' : 'bg-bg text-vmuted'} transition-colors`}>
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-vmuted block mb-1">Max tasks per window</label>
                <input type="number" value={form.max_tasks_per_window}
                  onChange={e => setForm({ ...form, max_tasks_per_window: parseInt(e.target.value) || 6 })}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-vmuted block mb-1">Reserve % for your coding</label>
                <input type="number" min="0" max="90" value={form.reserve_percent}
                  onChange={e => setForm({ ...form, reserve_percent: parseInt(e.target.value) || 40 })}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
              </div>
            </div>
            <button onClick={handleSave}
              className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/80 transition-colors">
              Save Schedule
            </button>
          </div>
        )}
      </section>

      {/* Providers */}
      <section className="mb-8">
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

      {/* Provider Routing */}
      <section>
        <ProviderRouting />
      </section>
    </div>
  );
}
