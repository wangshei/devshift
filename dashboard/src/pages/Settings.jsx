import React, { useState, useEffect } from 'react';
import { useApi, api } from '../hooks/useApi';
import ProviderStatus from '../components/ProviderStatus';

export default function Settings() {
  const { data: schedule, refetch: refetchSchedule } = useApi('/schedule');
  const { data: providers, refetch: refetchProviders } = useApi('/providers');
  const { data: memoryStats } = useApi('/memory/stats');
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

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

  const handleSaveApiKey = async (id, key) => {
    await api(`/providers/${id}`, { method: 'PATCH', body: { api_key: key, enabled: key ? 1 : 0 } });
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
              className={`px-4 py-2 text-white text-sm rounded-lg transition-colors ${saved ? 'bg-success hover:bg-success/80' : 'bg-accent hover:bg-accent/80'}`}>
              {saved ? 'Saved \u2713' : 'Save Schedule'}
            </button>
          </div>
        )}
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

      {/* API Keys */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted mb-3">API Keys (Fallback Providers)</h2>
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <p className="text-xs text-vmuted">GPT and Gemini handle chat, reviews, and planning when Claude is rate limited. They cannot edit files.</p>
          {[
            { id: 'openai', label: 'OpenAI API Key', placeholder: 'sk-...' },
            { id: 'gemini', label: 'Gemini API Key', placeholder: 'AIza...' },
          ].map(({ id, label, placeholder }) => {
            const provider = providers?.find(p => p.id === id);
            const hasKey = !!provider?.api_key;
            return (
              <div key={id}>
                <label className="text-xs text-vmuted block mb-1">{label}</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder={hasKey ? '••••••••••••••••' : placeholder}
                    onBlur={e => { if (e.target.value) handleSaveApiKey(id, e.target.value); }}
                    onKeyDown={e => { if (e.key === 'Enter' && e.target.value) handleSaveApiKey(id, e.target.value); }}
                    className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent font-mono"
                  />
                  {hasKey && (
                    <button onClick={() => handleSaveApiKey(id, '')}
                      className="px-2 py-1 text-xs text-error hover:underline">Clear</button>
                  )}
                </div>
                {hasKey && <span className="text-xs text-success mt-1 inline-block">Configured</span>}
              </div>
            );
          })}
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
