import React, { useState, useEffect } from 'react';
import { api, useApi } from '../hooks/useApi';

const STEP_LABELS = ['Welcome', 'Connect Tools', 'Add Projects', 'Set Schedule', 'Ready'];

export default function Setup({ onComplete }) {
  const [step, setStep] = useState(0);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex gap-1 mb-3">
            {STEP_LABELS.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-border'}`} />
            ))}
          </div>
          <p className="text-xs text-vmuted font-mono text-center">
            Step {step + 1} of {STEP_LABELS.length} — {STEP_LABELS[step]}
          </p>
        </div>

        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
        {step === 1 && <ProvidersStep onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <ProjectsStep onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <ScheduleStep onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && <DoneStep onComplete={onComplete} />}
      </div>
    </div>
  );
}

/* ─── Step 0: Welcome ─── */
function WelcomeStep({ onNext }) {
  return (
    <div className="text-center">
      <h1 className="text-3xl font-bold mb-3">
        <span className="text-accent font-mono">Dev</span>Shift
      </h1>
      <p className="text-muted mb-2 leading-relaxed">
        You pay for AI coding tools. Use all your credits — even when you're not coding.
      </p>
      <p className="text-vmuted text-sm mb-6">
        DevShift runs your AI tools (Claude Code, Cursor, etc.) on your projects
        during off-hours — fixing bugs, writing tests, and shipping features while you sleep.
      </p>
      <div className="bg-card border border-border rounded-lg p-5 mb-8 text-left space-y-4">
        <p className="text-xs font-mono text-vmuted uppercase tracking-wider">Quick setup</p>
        <div className="flex gap-3">
          <span className="text-accent font-mono text-lg mt-0.5">1</span>
          <div>
            <p className="text-sm font-medium">Detect your AI tools</p>
            <p className="text-xs text-muted">We check which CLI tools are installed on your machine (nothing is launched)</p>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="text-accent font-mono text-lg mt-0.5">2</span>
          <div>
            <p className="text-sm font-medium">Pick your projects</p>
            <p className="text-xs text-muted">Choose which codebases the agent can work on — we scan your Mac to find them</p>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="text-accent font-mono text-lg mt-0.5">3</span>
          <div>
            <p className="text-sm font-medium">Set your schedule</p>
            <p className="text-xs text-muted">Tell us when you're coding so the agent only runs during your off-hours</p>
          </div>
        </div>
      </div>
      <button
        onClick={onNext}
        className="w-full py-3.5 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors text-base"
      >
        Get started
      </button>
      <p className="text-[11px] text-vmuted mt-4">Everything runs locally. No accounts needed. Takes ~2 minutes.</p>
    </div>
  );
}

/* ─── Step 1: Connect AI Tools ─── */
function ProvidersStep({ onNext, onBack }) {
  const { data: status } = useApi('/setup/status');
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

  // Auto-test installed providers on mount
  useEffect(() => {
    if (status?.detectedProviders) {
      for (const p of status.detectedProviders) {
        if (p.installed && !testResults[p.id] && !testing[p.id]) {
          testProvider(p.id);
        }
      }
    }
  }, [status]);

  const testProvider = async (id) => {
    setTesting(t => ({ ...t, [id]: true }));
    try {
      const result = await api(`/setup/providers/${id}/test`, { method: 'POST' });
      setTestResults(r => ({ ...r, [id]: result }));
    } catch (e) {
      setTestResults(r => ({ ...r, [id]: { connected: false, error: e.message } }));
    } finally {
      setTesting(t => ({ ...t, [id]: false }));
    }
  };

  const providers = status?.detectedProviders || [];
  const installedCount = providers.filter(p => p.installed).length;
  const connectedCount = Object.values(testResults).filter(r => r.connected).length;
  const anyTesting = Object.values(testing).some(Boolean);

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Detecting your AI tools</h2>
      <p className="text-muted text-sm mb-6">
        DevShift uses the AI coding tools already on your Mac. We're checking which are installed — nothing is launched or modified.
      </p>

      <div className="space-y-3 mb-6">
        {providers.map(p => {
          const result = testResults[p.id];
          const isTesting = testing[p.id];

          return (
            <div key={p.id} className={`p-4 bg-card border rounded-lg transition-colors ${
              result?.connected ? 'border-success/30' :
              result && !result.connected ? 'border-error/30' :
              'border-border'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full shrink-0 transition-colors ${
                  isTesting ? 'bg-warning animate-pulse' :
                  result?.connected ? 'bg-success' :
                  result && !result.connected ? 'bg-error' :
                  p.installed ? 'bg-vmuted' : 'bg-border'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-[10px] font-mono text-vmuted px-1.5 py-0.5 bg-bg rounded">{p.id === 'claude_code' ? 'claude' : p.id === 'antigravity' ? 'agy' : 'cursor'}</span>
                  </div>
                  <div className="text-xs mt-0.5">
                    {isTesting && <span className="text-warning">Testing connection...</span>}
                    {!isTesting && result?.connected && (
                      <span className="text-success">
                        Connected{result.account ? ` · ${result.account}` : ' and authenticated'}
                      </span>
                    )}
                    {!isTesting && result && !result.connected && (
                      <span className="text-error">Not connected — {result.error?.includes('not found') ? 'not installed' : 'run the CLI once to authenticate'}</span>
                    )}
                    {!isTesting && !result && !p.installed && <span className="text-vmuted">Not installed</span>}
                    {!isTesting && !result && p.installed && <span className="text-vmuted">Checking...</span>}
                  </div>
                </div>
                {p.installed && result && !result.connected && !isTesting && (
                  <button
                    onClick={() => testProvider(p.id)}
                    className="px-3 py-1.5 text-xs bg-accent/10 text-accent rounded-lg hover:bg-accent/20 transition-colors"
                  >
                    Retry
                  </button>
                )}
                {result?.connected && (
                  <span className="text-success text-lg">&#10003;</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="p-3 bg-card border border-border rounded-lg mb-6">
        {anyTesting ? (
          <p className="text-xs text-muted text-center">Testing your connections...</p>
        ) : connectedCount > 0 ? (
          <p className="text-xs text-success text-center">
            {connectedCount} tool{connectedCount > 1 ? 's' : ''} connected — you're good to go!
          </p>
        ) : installedCount > 0 ? (
          <p className="text-xs text-warning text-center">
            Tools found but not authenticated. Open each tool's CLI once to log in, then retry.
          </p>
        ) : (
          <p className="text-xs text-error text-center">
            No AI tools detected. Install at least one: Claude Code, Google Antigravity, or Cursor.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={onBack}
          className="px-4 py-3 text-sm text-muted hover:text-text transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          disabled={anyTesting}
          className="flex-1 py-3 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors"
        >
          {connectedCount > 0 ? 'Continue' : 'Continue anyway'}
        </button>
      </div>
    </div>
  );
}

/* ─── Step 2: Add Projects ─── */
function ProjectsStep({ onNext, onBack }) {
  const [pathInput, setPathInput] = useState('');
  const [added, setAdded] = useState([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [autoFound, setAutoFound] = useState(null);
  const [autoScanning, setAutoScanning] = useState(false);
  const [autoSelected, setAutoSelected] = useState(new Set());
  const [addingBulk, setAddingBulk] = useState(false);

  const handlePickFolder = async () => {
    setPicking(true);
    setError('');
    try {
      const result = await api('/projects/pick-folder', { method: 'POST' });
      if (result.cancelled || !result.path) { setPicking(false); return; }
      const project = await api('/projects/from-path', { method: 'POST', body: { path: result.path } });
      setAdded(a => [...a, project]);
    } catch (e) {
      setError(e.message);
    } finally {
      setPicking(false);
    }
  };

  const handleAddPath = async () => {
    if (!pathInput.trim()) return;
    setAdding(true);
    setError('');
    try {
      const project = await api('/projects/from-path', { method: 'POST', body: { path: pathInput.trim() } });
      setAdded(a => [...a, project]);
      setPathInput('');
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleAutoFind = async () => {
    setAutoScanning(true);
    setError('');
    try {
      const result = await api('/setup/scan-local');
      setAutoFound(result.repos);
      // Pre-select first 5 (most recently modified)
      setAutoSelected(new Set(result.repos.slice(0, 5).map(r => r.path)));
    } catch (e) {
      setError(e.message);
    } finally {
      setAutoScanning(false);
    }
  };

  const handleAddSelected = async () => {
    setAddingBulk(true);
    const toAdd = autoFound.filter(r => autoSelected.has(r.path));
    for (const repo of toAdd) {
      try {
        const project = await api('/projects/from-path', { method: 'POST', body: { path: repo.path } });
        setAdded(a => [...a, project]);
      } catch { /* skip already added */ }
    }
    setAutoFound(null);
    setAutoSelected(new Set());
    setAddingBulk(false);
  };

  const toggleAutoSelect = (p) => {
    setAutoSelected(s => {
      const next = new Set(s);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Which projects should the agent work on?</h2>
      <p className="text-muted text-sm mb-6">
        Add the codebases you want the agent to handle. It will only read and modify code in these folders.
      </p>

      {/* Primary actions */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={handlePickFolder}
          disabled={picking}
          className="flex-1 py-2.5 border border-dashed border-border rounded-lg text-sm text-accent hover:border-accent hover:bg-accent/5 transition-colors disabled:opacity-50"
        >
          {picking ? 'Opening Finder...' : 'Choose folder...'}
        </button>
        <button
          onClick={handleAutoFind}
          disabled={autoScanning}
          className="flex-1 py-2.5 border border-border rounded-lg text-sm text-muted hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-50"
        >
          {autoScanning ? 'Scanning...' : 'Find projects on my Mac'}
        </button>
      </div>

      {/* Paste path fallback */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={pathInput}
          onChange={e => { setPathInput(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleAddPath()}
          placeholder="or paste a path: /Users/you/code/my-project"
          className="flex-1 bg-card border border-border rounded-lg px-4 py-2 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent font-mono"
        />
        <button
          onClick={handleAddPath}
          disabled={!pathInput.trim() || adding}
          className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors text-sm font-medium"
        >
          {adding ? '...' : 'Add'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-lg mb-4 text-xs text-error">{error}</div>
      )}

      {/* Auto-found repos list */}
      {autoFound && (
        <div className="bg-card border border-border rounded-lg mb-4 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <p className="text-xs text-muted">
              Found {autoFound.length} git repo{autoFound.length !== 1 ? 's' : ''} on your Mac
              <span className="text-vmuted"> (sorted by recent activity)</span>
            </p>
            <button onClick={() => setAutoFound(null)} className="text-xs text-vmuted hover:text-text">✕</button>
          </div>
          {autoFound.length === 0 ? (
            <p className="px-4 py-3 text-xs text-vmuted">
              No git repos found. Try using "Choose folder" or paste a path instead.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {autoFound.map(r => (
                <label key={r.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover cursor-pointer border-b border-border last:border-0">
                  <input
                    type="checkbox"
                    checked={autoSelected.has(r.path)}
                    onChange={() => toggleAutoSelect(r.path)}
                    className="accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className="text-[11px] text-vmuted font-mono truncate">{r.path}</p>
                  </div>
                  {r.stack?.length > 0 && (
                    <div className="flex gap-1 shrink-0">
                      {r.stack.slice(0, 2).map(s => (
                        <span key={s} className="text-[10px] text-accent px-1.5 py-0.5 bg-accent/10 rounded">{s}</span>
                      ))}
                    </div>
                  )}
                </label>
              ))}
            </div>
          )}
          {autoFound.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={handleAddSelected}
                disabled={autoSelected.size === 0 || addingBulk}
                className="w-full py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors"
              >
                {addingBulk ? 'Adding...' : `Add ${autoSelected.size} selected project${autoSelected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Added projects */}
      {added.length > 0 && (
        <div className="space-y-1.5 mb-4">
          <p className="text-[10px] text-success uppercase tracking-wider font-medium">Added ({added.length})</p>
          {added.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 bg-card border border-success/20 rounded-lg">
              <span className="text-success text-sm">✓</span>
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-[11px] text-vmuted font-mono ml-auto truncate max-w-48">{p.repo_path}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-6">
        <button onClick={onBack} className="px-4 py-3 text-sm text-muted hover:text-text transition-colors">
          Back
        </button>
        <button onClick={onNext}
          className="flex-1 py-3 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors">
          {added.length > 0 ? `Continue with ${added.length} project${added.length > 1 ? 's' : ''}` : 'Skip — add later'}
        </button>
      </div>
    </div>
  );
}

/* ─── Step 3: Schedule ─── */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = [
  { id: 'morning',   label: 'Morning',   time: '6am–12pm' },
  { id: 'afternoon', label: 'Afternoon', time: '12pm–6pm' },
  { id: 'evening',   label: 'Evening',   time: '6pm–11pm' },
  { id: 'night',     label: 'Night',     time: '11pm–6am' },
];

/**
 * Build the default blocked set: Mon–Fri Morning + Afternoon are blocked (you're coding).
 * Evenings, nights, and all day Sat/Sun are available (agent can work).
 */
function buildDefaultBlocked() {
  const blocked = [];
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    blocked.push({ day, slot: 'morning' });
    blocked.push({ day, slot: 'afternoon' });
  }
  return blocked;
}

function isBlocked(blockedList, day, slot) {
  return blockedList.some(b => b.day === day && b.slot === slot);
}

function toggleBlock(blockedList, day, slot) {
  if (isBlocked(blockedList, day, slot)) {
    return blockedList.filter(b => !(b.day === day && b.slot === slot));
  }
  return [...blockedList, { day, slot }];
}

function ScheduleStep({ onNext, onBack }) {
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: schedule } = useApi('/schedule');
  const [tz, setTz] = useState(detectedTz);
  const [showTzInput, setShowTzInput] = useState(false);
  const [blocked, setBlocked] = useState(buildDefaultBlocked());
  const [initialized, setInitialized] = useState(false);
  const [alwaysOn, setAlwaysOn] = useState(false);

  // Auto-save timezone on mount
  useEffect(() => {
    api('/schedule', { method: 'PATCH', body: { timezone: detectedTz } }).catch(() => {});
  }, []);

  useEffect(() => {
    if (schedule && !initialized) {
      setInitialized(true);
      if (schedule.timezone) setTz(schedule.timezone);
      if (schedule.always_on) setAlwaysOn(!!schedule.always_on);
      // Try to parse existing active_days as JSON blocked list
      if (schedule.active_days) {
        try {
          const parsed = JSON.parse(schedule.active_days);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].day) {
            setBlocked(parsed);
          }
        } catch { /* use default */ }
      }
    }
  }, [schedule, initialized]);

  const handleToggle = (day, slot) => {
    setBlocked(prev => toggleBlock(prev, day, slot));
  };

  const handleSave = async () => {
    await api('/schedule', {
      method: 'PATCH',
      body: {
        timezone: tz,
        active_hours_start: '00:00',
        active_hours_end: '23:59',
        active_days: JSON.stringify(blocked),
        always_on: alwaysOn ? 1 : 0,
      },
    });
    onNext();
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">When can the agent work?</h2>
      <p className="text-muted text-sm mb-6">
        Filled = agent can work. Empty = you're coding (blocked).
        Default: evenings, nights, and weekends.
      </p>

      {/* Always On toggle */}
      <div className="bg-card border border-border rounded-lg p-4 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text">Proactive Mode</p>
            <p className="text-xs text-muted mt-1">
              {alwaysOn
                ? 'Agent continuously works through your backlog and proactively improves your projects whenever credits are available.'
                : 'When enabled, the agent continuously works through your backlog and proactively improves your projects whenever credits are available.'}
            </p>
          </div>
          <button
            onClick={() => setAlwaysOn(v => !v)}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${alwaysOn ? 'bg-accent' : 'bg-border'}`}
            role="switch"
            aria-checked={alwaysOn}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${alwaysOn ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>

      {/* Timezone */}
      <div className={`mb-5 flex items-center gap-2 text-sm ${alwaysOn ? 'opacity-50 pointer-events-none' : ''}`}>
        <span className="text-vmuted text-xs">Detected:</span>
        {showTzInput ? (
          <input
            autoFocus
            value={tz}
            onChange={e => setTz(e.target.value)}
            onBlur={() => setShowTzInput(false)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-accent"
          />
        ) : (
          <>
            <span className="font-mono text-xs text-text">{tz}</span>
            <button
              onClick={() => setShowTzInput(true)}
              className="text-[10px] text-accent hover:underline"
            >
              change
            </button>
          </>
        )}
      </div>

      {/* Grid */}
      <div className={`bg-card border border-border rounded-lg p-4 overflow-x-auto ${alwaysOn ? 'opacity-50 pointer-events-none' : ''}`}>
        {alwaysOn && (
          <p className="text-[10px] text-vmuted font-mono mb-3">Your typical hours (informational only)</p>
        )}
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-mono text-vmuted pb-2 w-24"></th>
              {DAYS.map(d => (
                <th key={d} className="text-[10px] font-mono text-vmuted pb-2 text-center px-1">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map(slot => (
              <tr key={slot.id}>
                <td className="py-1.5 pr-3">
                  <div>
                    <p className="text-xs text-text">{slot.label}</p>
                    <p className="text-[10px] text-vmuted font-mono">{slot.time}</p>
                  </div>
                </td>
                {DAYS.map(day => {
                  const blocked_ = isBlocked(blocked, day, slot.id);
                  return (
                    <td key={day} className="text-center py-1.5 px-1">
                      <button
                        onClick={() => handleToggle(day, slot.id)}
                        title={blocked_ ? 'Blocked (you\'re coding)' : 'Agent can work'}
                        className="w-5 h-5 rounded-full transition-colors inline-flex items-center justify-center"
                      >
                        {blocked_ ? (
                          // Empty circle = blocked
                          <span className="w-4 h-4 rounded-full border-2 border-vmuted/60 inline-block" />
                        ) : (
                          // Filled circle = agent can work
                          <span className="w-4 h-4 rounded-full bg-accent inline-block" />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-accent inline-block" />
            <span className="text-[10px] text-muted">Agent works</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full border-2 border-vmuted/60 inline-block" />
            <span className="text-[10px] text-muted">Blocked (you're coding)</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-6">
        <button onClick={onBack}
          className="px-4 py-3 text-sm text-muted hover:text-text transition-colors">
          Back
        </button>
        <button onClick={handleSave}
          className="flex-1 py-3 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors">
          Looks good
        </button>
      </div>
    </div>
  );
}

/* ─── Step 4: Done ─── */
function DoneStep({ onComplete }) {
  const handleFinish = async () => {
    await api('/setup/complete', { method: 'POST' });
    onComplete();
  };

  return (
    <div className="text-center py-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 border border-success/20 mb-6">
        <span className="text-success text-3xl">&#10003;</span>
      </div>
      <h2 className="text-2xl font-bold mb-3">You're all set!</h2>

      <div className="bg-card border border-border rounded-lg p-5 mb-8 text-left space-y-4">
        <p className="text-sm font-medium text-text">How it works:</p>
        <div className="flex gap-3">
          <span className="text-accent font-mono">1</span>
          <p className="text-sm text-muted"><span className="text-text">Add tasks</span> — describe what you need done in plain English ("fix the login bug", "add dark mode")</p>
        </div>
        <div className="flex gap-3">
          <span className="text-accent font-mono">2</span>
          <p className="text-sm text-muted"><span className="text-text">Turn on auto-pilot</span> — the agent will work through tasks using your AI tools during off-hours</p>
        </div>
        <div className="flex gap-3">
          <span className="text-accent font-mono">3</span>
          <p className="text-sm text-muted"><span className="text-text">Review the results</span> — approve PRs, merge changes, or reject and retry</p>
        </div>
      </div>

      <button onClick={handleFinish}
        className="w-full py-3.5 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors text-base">
        Open Dashboard
      </button>
    </div>
  );
}
