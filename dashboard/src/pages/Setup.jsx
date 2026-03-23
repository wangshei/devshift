import React, { useState, useEffect } from 'react';
import { api, useApi } from '../hooks/useApi';

const STEPS = ['providers', 'projects', 'schedule', 'done'];

export default function Setup({ onComplete }) {
  const [step, setStep] = useState(0);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="flex gap-1 mb-8">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-border'}`} />
          ))}
        </div>

        {step === 0 && <ProvidersStep onNext={() => setStep(1)} />}
        {step === 1 && <ProjectsStep onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <ScheduleStep onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <DoneStep onComplete={onComplete} />}
      </div>
    </div>
  );
}

function ProvidersStep({ onNext }) {
  const { data: status } = useApi('/setup/status');
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

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
  const hasAnyConnected = Object.values(testResults).some(r => r.connected);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">
        <span className="text-accent font-mono">Dev</span>Shift
      </h1>
      <p className="text-muted mb-6">Let's connect your AI coding tools.</p>

      <div className="space-y-3 mb-8">
        {providers.map(p => {
          const result = testResults[p.id];
          const isTesting = testing[p.id];

          return (
            <div key={p.id} className="flex items-center gap-3 p-4 bg-card border border-border rounded-lg">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                result?.connected ? 'bg-success' :
                result && !result.connected ? 'bg-error' :
                p.installed ? 'bg-warning' : 'bg-vmuted'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-vmuted font-mono">{p.installed ? 'Installed' : 'Not installed'}</div>
                {result?.connected && (
                  <div className="text-xs text-success mt-1">Connected and working</div>
                )}
                {result && !result.connected && (
                  <div className="text-xs text-error mt-1">{result.error?.slice(0, 100) || 'Connection failed'}</div>
                )}
              </div>
              {p.installed && !result?.connected && (
                <button
                  onClick={() => testProvider(p.id)}
                  disabled={isTesting}
                  className="px-3 py-1.5 text-xs bg-accent/10 text-accent border border-accent/20 rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>
              )}
              {result?.connected && (
                <span className="text-success text-sm">&#10003;</span>
              )}
            </div>
          );
        })}
      </div>

      {providers.every(p => !p.installed) && (
        <div className="p-4 bg-error/10 border border-error/20 rounded-lg mb-4 text-sm text-error">
          No AI coding tools detected. Install Claude Code, Google Antigravity, or Cursor first.
        </div>
      )}

      <button
        onClick={onNext}
        disabled={!providers.some(p => p.installed)}
        className="w-full py-3 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors"
      >
        {hasAnyConnected ? 'Continue' : 'Skip for now'}
      </button>
    </div>
  );
}

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
      <h2 className="text-xl font-bold mb-2">Add your projects</h2>
      <p className="text-muted text-sm mb-6">Drag a folder from Finder into the field below, or paste a path.</p>

      {/* Path input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={pathInput}
          onChange={e => { setPathInput(e.target.value); setError(''); setScanned(null); }}
          onKeyDown={handleKeyDown}
          placeholder="Drop folder here or paste path..."
          className="flex-1 bg-card border border-border rounded-lg px-4 py-3 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent transition-colors"
        />
        <button
          onClick={handleScan}
          disabled={!pathInput.trim() || scanning}
          className="px-4 py-3 bg-accent/10 text-accent border border-accent/20 rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap"
        >
          {scanning ? 'Scanning...' : 'Scan'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-error mb-4">{error}</div>
      )}

      {/* Scanned preview */}
      {scanned && (
        <div className="bg-card border border-accent/30 rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-medium">{scanned.name}</h3>
              <p className="text-xs font-mono text-vmuted mt-1">{scanned.path}</p>
              {scanned.stack?.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {scanned.stack.map(s => (
                    <span key={s} className="text-[10px] px-2 py-0.5 bg-accent/10 text-accent rounded-full">{s}</span>
                  ))}
                </div>
              )}
              {scanned.github_remote && (
                <p className="text-xs text-muted mt-2">Remote: {scanned.github_remote}</p>
              )}
              {scanned.context && (
                <p className="text-xs text-muted mt-1">{scanned.context}</p>
              )}
            </div>
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 transition-colors shrink-0"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Added projects */}
      {added.length > 0 && (
        <div className="space-y-2 mb-6">
          <p className="text-xs text-muted uppercase tracking-wider">Added</p>
          {added.map(p => (
            <div key={p.id} className="flex items-center gap-2 p-3 bg-card border border-success/20 rounded-lg">
              <span className="text-success text-sm">&#10003;</span>
              <span className="text-sm">{p.name}</span>
              <span className="text-xs text-vmuted font-mono ml-auto truncate max-w-40">{p.repo_path}</span>
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
          {added.length > 0 ? 'Continue' : 'Skip for now'}
        </button>
      </div>
    </div>
  );
}

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

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleSave = async () => {
    await api('/schedule', { method: 'PATCH', body: {
      timezone: tz, active_hours_start: start, active_hours_end: end,
    }});
    onNext();
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Your schedule</h2>
      <p className="text-muted text-sm mb-6">
        DevShift runs your AI tools when you're <span className="text-text">not</span> coding.
        Tell us your active hours so the agent knows when to work.
      </p>

      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <div>
          <label className="text-xs text-vmuted block mb-1">Timezone</label>
          <div className="flex items-center gap-2">
            <input value={tz} onChange={e => setTz(e.target.value)}
              className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
            {tz !== detectedTz && (
              <button onClick={() => setTz(detectedTz)}
                className="text-xs text-accent hover:underline whitespace-nowrap">Use detected</button>
            )}
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs text-vmuted block mb-1">You start coding at</label>
            <input type="time" value={start} onChange={e => setStart(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-vmuted block mb-1">You stop coding at</label>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent" />
          </div>
        </div>

        <div className="p-3 bg-bg rounded-lg">
          <p className="text-xs text-muted">
            Agent will run tasks between <span className="text-text font-mono">{end}</span> and <span className="text-text font-mono">{start}</span> — your off-hours.
            You can always override this with "I'm done for today".
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

function DoneStep({ onComplete }) {
  const handleFinish = async () => {
    await api('/setup/complete', { method: 'POST' });
    onComplete();
  };

  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-4">&#10003;</div>
      <h2 className="text-xl font-bold mb-2">You're all set</h2>
      <p className="text-muted text-sm mb-2">
        DevShift will run your AI tools during off-hours.
      </p>
      <p className="text-muted text-sm mb-8">
        Add tasks from the timeline, or text them via Telegram.
        Hit "I'm done for today" anytime to let the agent start early.
      </p>
      <button onClick={handleFinish}
        className="px-8 py-3 bg-accent text-white font-medium rounded-lg hover:bg-accent/80 transition-colors">
        Open Dashboard
      </button>
    </div>
  );
}
