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
      <div className="mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
          <span className="text-accent font-mono font-bold text-2xl">S</span>
        </div>
      </div>
      <h1 className="text-3xl font-bold mb-3">
        Welcome to <span className="text-accent font-mono">Dev</span>Shift
      </h1>
      <p className="text-muted mb-3 leading-relaxed">
        Your AI coding tools work while you sleep.
      </p>
      <div className="bg-card border border-border rounded-lg p-5 mb-8 text-left space-y-4">
        <div className="flex gap-3">
          <span className="text-accent font-mono text-lg mt-0.5">1</span>
          <div>
            <p className="text-sm font-medium">Connect your AI tools</p>
            <p className="text-xs text-muted">We'll detect Claude Code, Antigravity, and Cursor on your machine</p>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="text-accent font-mono text-lg mt-0.5">2</span>
          <div>
            <p className="text-sm font-medium">Add your project folders</p>
            <p className="text-xs text-muted">Drop a folder or paste a path — we auto-detect everything</p>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="text-accent font-mono text-lg mt-0.5">3</span>
          <div>
            <p className="text-sm font-medium">Set your coding hours</p>
            <p className="text-xs text-muted">The agent works when you're not — during off-hours and weekends</p>
          </div>
        </div>
      </div>
      <button
        onClick={onNext}
        className="w-full py-3.5 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors text-base"
      >
        Let's get started
      </button>
      <p className="text-[11px] text-vmuted mt-4">Takes about 2 minutes. No accounts or API keys needed.</p>
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
      <h2 className="text-xl font-bold mb-1">Connect your AI tools</h2>
      <p className="text-muted text-sm mb-6">
        DevShift uses your existing CLI tools. We're checking which ones are installed and authenticated.
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
                    {!isTesting && result?.connected && <span className="text-success">Connected and authenticated</span>}
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
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(null);
  const [added, setAdded] = useState([]);
  const [error, setError] = useState('');

  const handleScan = async () => {
    if (!pathInput.trim()) return;
    setScanning(true);
    setError('');
    setScanned(null);
    try {
      const info = await api('/setup/projects/scan', { method: 'POST', body: { path: pathInput.trim() } });
      if (info.alreadyAdded) {
        setError(`Already added as "${info.alreadyAdded}"`);
      } else {
        setScanned(info);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  };

  const handleAdd = async () => {
    if (!scanned) return;
    try {
      const project = await api('/projects/from-path', { method: 'POST', body: { path: scanned.path } });
      setAdded(a => [...a, project]);
      setScanned(null);
      setPathInput('');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleScan();
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Add your projects</h2>
      <p className="text-muted text-sm mb-2">
        Tell DevShift which codebases to work on.
      </p>
      <p className="text-xs text-vmuted mb-6">
        Drag a folder from Finder into the field, or paste the full path (e.g. /Users/you/code/my-app).
      </p>

      {/* Path input */}
      <div className="relative mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={pathInput}
            onChange={e => { setPathInput(e.target.value); setError(''); setScanned(null); }}
            onKeyDown={handleKeyDown}
            placeholder="/Users/you/code/my-project"
            className="flex-1 bg-card border border-border rounded-lg px-4 py-3 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent font-mono transition-colors"
          />
          <button
            onClick={handleScan}
            disabled={!pathInput.trim() || scanning}
            className="px-5 py-3 bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap"
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
        {!pathInput && !added.length && (
          <p className="text-[11px] text-vmuted mt-2">Tip: In Finder, drag the folder here to paste its path automatically</p>
        )}
      </div>

      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-lg mb-4 text-xs text-error">{error}</div>
      )}

      {/* Scanned preview */}
      {scanned && (
        <div className="bg-card border-2 border-accent/40 rounded-lg p-4 mb-4">
          <p className="text-[10px] text-accent uppercase tracking-wider mb-2 font-medium">Found project</p>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-base">{scanned.name}</h3>
              <p className="text-xs font-mono text-vmuted mt-1 truncate">{scanned.path}</p>
              {scanned.stack?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {scanned.stack.map(s => (
                    <span key={s} className="text-[10px] px-2 py-0.5 bg-accent/10 text-accent rounded-full font-medium">{s}</span>
                  ))}
                </div>
              )}
              {scanned.github_remote && (
                <p className="text-[11px] text-muted mt-2">Git: {scanned.github_remote}</p>
              )}
              {scanned.context && (
                <p className="text-xs text-muted mt-1 italic">"{scanned.context}"</p>
              )}
            </div>
            <button
              onClick={handleAdd}
              className="px-5 py-2.5 bg-success text-white text-sm font-medium rounded-lg hover:bg-success/80 transition-colors shrink-0"
            >
              Add project
            </button>
          </div>
        </div>
      )}

      {/* Added projects */}
      {added.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-[10px] text-success uppercase tracking-wider font-medium">Added ({added.length})</p>
          {added.map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 bg-card border border-success/20 rounded-lg">
              <span className="text-success">&#10003;</span>
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-[11px] text-vmuted font-mono ml-auto truncate max-w-48">{p.repo_path}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-6">
        <button onClick={onBack}
          className="px-4 py-3 text-sm text-muted hover:text-text transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-3 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors"
        >
          {added.length > 0 ? `Continue with ${added.length} project${added.length > 1 ? 's' : ''}` : 'Skip — add later'}
        </button>
      </div>
    </div>
  );
}

/* ─── Step 3: Schedule ─── */
function ScheduleStep({ onNext, onBack }) {
  const { data: schedule } = useApi('/schedule');
  const [tz, setTz] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');

  useEffect(() => {
    if (schedule) {
      setTz(schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      setStart(schedule.active_hours_start || '09:00');
      setEnd(schedule.active_hours_end || '18:00');
    }
  }, [schedule]);

  const handleSave = async () => {
    await api('/schedule', { method: 'PATCH', body: {
      timezone: tz, active_hours_start: start, active_hours_end: end,
    }});
    onNext();
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">When do you code?</h2>
      <p className="text-muted text-sm mb-6">
        The AI agent works when you're <span className="text-text font-medium">not</span> coding —
        evenings, nights, and weekends. Tell us your typical schedule.
      </p>

      <div className="space-y-5 bg-card border border-border rounded-lg p-5">
        <div>
          <label className="text-xs text-vmuted block mb-1.5">Your timezone</label>
          <input value={tz} onChange={e => setTz(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text font-mono focus:outline-none focus:border-accent" />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs text-vmuted block mb-1.5">You start coding at</label>
            <input type="time" value={start} onChange={e => setStart(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-vmuted block mb-1.5">You stop coding at</label>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent" />
          </div>
        </div>

        <div className="p-4 bg-accent/5 border border-accent/10 rounded-lg">
          <p className="text-sm text-text mb-1 font-medium">How it works:</p>
          <p className="text-xs text-muted leading-relaxed">
            Between <span className="text-text font-mono">{start}</span> and <span className="text-text font-mono">{end}</span>,
            the agent stays paused so it doesn't use your credits.
            After <span className="text-text font-mono">{end}</span>, it starts working through your task backlog.
            You can also tap <span className="text-accent">"I'm done for today"</span> anytime to let it start early.
          </p>
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

      <div className="bg-card border border-border rounded-lg p-5 mb-8 text-left space-y-3">
        <p className="text-sm font-medium text-text mb-2">Here's what you can do now:</p>
        <div className="flex gap-3">
          <span className="text-accent">&#8226;</span>
          <p className="text-sm text-muted"><span className="text-text">Add tasks</span> from the timeline — type what you need done</p>
        </div>
        <div className="flex gap-3">
          <span className="text-accent">&#8226;</span>
          <p className="text-sm text-muted"><span className="text-text">Hit "I'm done for today"</span> to let the agent start working now</p>
        </div>
        <div className="flex gap-3">
          <span className="text-accent">&#8226;</span>
          <p className="text-sm text-muted"><span className="text-text">Check back later</span> — you'll see what the agent built while you were away</p>
        </div>
      </div>

      <button onClick={handleFinish}
        className="w-full py-3.5 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors text-base">
        Open Dashboard
      </button>
    </div>
  );
}
