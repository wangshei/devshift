import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import HumanTaskCard from '../components/HumanTaskCard';
import TaskInput from '../components/TaskInput';

function formatTime(ts) {
  if (!ts) return null;
  try {
    // SQLite stores as "2026-03-25 14:23:00" without Z
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return null; }
}

function cleanSummary(text) {
  if (!text) return null;
  // Strip markdown code fences
  let s = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  // If it looks like a JSON array of tasks, extract just the count
  try {
    const parsed = JSON.parse(s.startsWith('[') ? s : s.match(/\[[\s\S]*\]/)?.[0] || '');
    if (Array.isArray(parsed) && parsed[0]?.title) {
      return `Generated ${parsed.length} task${parsed.length !== 1 ? 's' : ''}: ${parsed.slice(0, 2).map(t => t.title).join(', ')}${parsed.length > 2 ? '…' : ''}`;
    }
  } catch { /* not JSON */ }
  return s.slice(0, 300);
}

const STATUS_ICONS = {
  done: { icon: '✓', color: 'text-success' },
  in_progress: { icon: '●', color: 'text-accent animate-pulse' },
  backlog: { icon: '○', color: 'text-vmuted' },
  queued: { icon: '○', color: 'text-muted' },
  failed: { icon: '✕', color: 'text-error' },
  needs_review: { icon: '▸', color: 'text-warning' },
};

const TIER_LABELS = { 1: 'Auto', 2: 'Review', 3: 'Research' };

function LiveLog({ taskId }) {
  const { data } = useApi(`/tasks/${taskId}/log`, [], 2000);
  if (!data?.log) return <p className="text-xs text-vmuted font-mono">Waiting for output...</p>;
  return (
    <pre className="text-[10px] font-mono text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto bg-bg rounded p-2 border border-border">
      {data.log}
    </pre>
  );
}

/** Expandable completed/in-progress task card */
function TaskCard({ task, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [acting, setActing] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const s = STATUS_ICONS[task.status] || STATUS_ICONS.backlog;
  const time = task.completed_at || task.started_at;
  const timeStr = formatTime(time);
  const isReview = task.status === 'needs_review' && task.branch_name;
  const isInProgress = task.status === 'in_progress';
  const isDone = task.status === 'done';

  const handleShowDiff = async () => {
    if (diff) { setShowDiff(!showDiff); return; }
    setLoadingDiff(true);
    try {
      const d = await api(`/tasks/${task.id}/diff`);
      setDiff(d);
      setShowDiff(true);
    } catch { /* ignore */ }
    finally { setLoadingDiff(false); }
  };

  const handleApprove = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/approve`, { method: 'POST' });
      onAction?.();
    } catch (e) {
      alert('Merge failed: ' + e.message);
    } finally { setActing(false); }
  };

  const handleReject = async () => {
    setActing(true);
    try {
      await api(`/tasks/${task.id}/reject`, { method: 'POST' });
      onAction?.();
    } catch { /* ignore */ }
    finally { setActing(false); }
  };

  return (
    <div className={`bg-card border rounded-lg transition-colors ${
      isReview ? 'border-warning/30' :
      isInProgress ? 'border-accent/20' :
      'border-border'
    }`}>
      {/* Main row */}
      <div
        className={`flex items-start gap-3 px-4 py-3 ${isDone || isReview ? 'cursor-pointer' : ''}`}
        onClick={() => (isDone || isReview) && setExpanded(!expanded)}
      >
        <span className={`mt-0.5 text-sm shrink-0 ${s.color}`}>{s.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text">{task.title}</span>
            {isInProgress && (
              <span className="text-[10px] text-accent font-mono animate-pulse">working...</span>
            )}
          </div>
          {isInProgress && (
            <div className="mt-1.5 h-0.5 w-24 bg-accent/20 rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full animate-pulse w-1/2" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {timeStr && <span className="text-[10px] font-mono text-vmuted">{timeStr}</span>}
          {task.actual_minutes != null && (
            <span className="text-[10px] font-mono text-vmuted">{task.actual_minutes}m</span>
          )}
          {task.provider && (
            <span className="text-[10px] font-mono text-accent/70">
              {task.provider === 'claude_code' ? 'Claude' : task.provider === 'antigravity' ? 'Antigravity' : task.provider === 'cursor' ? 'Cursor' : task.provider}
            </span>
          )}
          {task.tier && (
            <span className={`text-[10px] font-mono ${task.tier === 3 ? 'text-research' : 'text-vmuted'}`}>
              {TIER_LABELS[task.tier]}
            </span>
          )}
          {(isDone || isReview) && (
            <span className="text-vmuted text-xs">{expanded ? '▴' : '▾'}</span>
          )}
        </div>
      </div>

      {/* Live log for in-progress tasks */}
      {isInProgress && (
        <div className="mt-0 border-t border-border px-4 pt-2 pb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-accent font-mono animate-pulse">● Live output</p>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try { await api(`/tasks/${task.id}/watch`, { method: 'POST' }); } catch {}
              }}
              className="text-[10px] text-vmuted hover:text-accent font-mono transition-colors"
              title="Open Terminal to watch live"
            >
              Open in Terminal
            </button>
          </div>
          <LiveLog taskId={task.id} />
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {cleanSummary(task.result_summary) && (
            <p className="text-xs text-muted leading-relaxed">{cleanSummary(task.result_summary)}</p>
          )}
          {task.debrief && (
            <div className="bg-accent/5 border border-accent/10 rounded px-2.5 py-2 mt-1">
              <p className="text-[10px] font-mono text-accent uppercase tracking-wider mb-1">Agent debrief</p>
              <p className="text-xs text-muted leading-relaxed">{task.debrief}</p>
            </div>
          )}
          {cleanSummary(task.review_instructions) && (
            <p className="text-xs text-muted italic leading-relaxed">{cleanSummary(task.review_instructions)}</p>
          )}
          {task.provider && (
            <p className="text-[10px] font-mono text-vmuted">via {task.provider}</p>
          )}
          {isDone && (
            <div>
              <button
                onClick={() => setShowOutput(!showOutput)}
                className="text-[10px] text-vmuted hover:text-muted font-mono transition-colors"
              >
                {showOutput ? 'Hide output' : 'View output'}
              </button>
              {showOutput && <LiveLog taskId={task.id} />}
            </div>
          )}

          {/* Review actions */}
          {isReview && (
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <button onClick={handleShowDiff} disabled={loadingDiff}
                className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-muted hover:text-text transition-colors">
                {loadingDiff ? 'Loading...' : showDiff ? 'Hide diff' : 'View diff'}
              </button>
              <div className="flex-1" />
              {task.pr_url && (
                <a href={task.pr_url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-accent hover:underline shrink-0">
                  PR #{task.pr_number}
                </a>
              )}
              <button onClick={handleReject} disabled={acting}
                className="px-3 py-1.5 text-xs text-error/70 hover:text-error border border-error/20 rounded-lg hover:bg-error/10 transition-colors">
                Reject
              </button>
              <button onClick={handleApprove} disabled={acting}
                className="px-3 py-1.5 text-xs bg-success text-white rounded-lg hover:bg-success/80 disabled:opacity-50 transition-colors font-medium">
                {acting ? 'Merging...' : 'Approve & Merge'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Diff viewer */}
      {expanded && showDiff && diff && (
        <div className="border-t border-border">
          {diff.stat && (
            <div className="px-4 py-2 bg-bg text-xs font-mono text-muted">{diff.stat}</div>
          )}
          {diff.diff ? (
            <pre className="px-4 py-3 text-[11px] font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
              {diff.diff.split('\n').map((line, i) => (
                <div key={i} className={
                  line.startsWith('+') && !line.startsWith('+++') ? 'text-success' :
                  line.startsWith('-') && !line.startsWith('---') ? 'text-error' :
                  line.startsWith('@@') ? 'text-accent' : 'text-muted'
                }>{line}</div>
              ))}
            </pre>
          ) : (
            <div className="px-4 py-3 text-xs text-vmuted">No changes found on this branch.</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Simple markdown to JSX renderer — handles headers, bold, lists, code, blockquotes */
function RenderMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  function inline(str) {
    // Bold, italic, inline code
    const parts = [];
    let last = 0;
    const re = /(\*\*(.+?)\*\*|`(.+?)`|_(.+?)_|\[(.+?)\]\((.+?)\))/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      if (m[2]) parts.push(<strong key={m.index} className="font-semibold text-text">{m[2]}</strong>);
      else if (m[3]) parts.push(<code key={m.index} className="px-1 py-0.5 bg-border rounded text-[10px] font-mono">{m[3]}</code>);
      else if (m[4]) parts.push(<em key={m.index}>{m[4]}</em>);
      else if (m[5]) parts.push(<a key={m.index} href={m[6]} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{m[5]}</a>);
      last = m.index + m[0].length;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts.length > 0 ? parts : str;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="text-base font-bold text-text mt-2 mb-1">{inline(line.slice(2))}</h2>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="text-sm font-semibold text-text mt-2 mb-0.5">{inline(line.slice(3))}</h3>);
    } else if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="text-xs font-semibold text-text mt-1.5 mb-0.5">{inline(line.slice(4))}</h4>);
    } else if (line.startsWith('> ')) {
      elements.push(<p key={i} className="text-xs text-muted italic border-l-2 border-accent/30 pl-2 my-1">{inline(line.slice(2))}</p>);
    } else if (/^[-*] \[[ x]\] /.test(line)) {
      const checked = line.includes('[x]');
      const content = line.replace(/^[-*] \[[ x]\] /, '');
      elements.push(
        <div key={i} className="flex items-start gap-1.5 text-xs text-muted">
          <span className={`mt-0.5 ${checked ? 'text-success' : 'text-vmuted'}`}>{checked ? '✓' : '○'}</span>
          <span className={checked ? 'line-through text-vmuted' : ''}>{inline(content)}</span>
        </div>
      );
    } else if (/^[-*] /.test(line)) {
      elements.push(
        <div key={i} className="flex items-start gap-1.5 text-xs text-muted">
          <span className="text-vmuted mt-0.5">·</span>
          <span>{inline(line.replace(/^[-*] /, ''))}</span>
        </div>
      );
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)[1];
      elements.push(
        <div key={i} className="flex items-start gap-1.5 text-xs text-muted">
          <span className="text-vmuted mt-0.5 font-mono">{num}.</span>
          <span>{inline(line.replace(/^\d+\. /, ''))}</span>
        </div>
      );
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} className="border-border my-2" />);
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />);
    } else {
      elements.push(<p key={i} className="text-xs text-muted leading-relaxed">{inline(line)}</p>);
    }
    i++;
  }
  return <div className="space-y-0.5">{elements}</div>;
}

function GoalSection({ projectId, goal, approved, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [editTab, setEditTab] = useState('preview'); // 'write' | 'preview'
  const [draft, setDraft] = useState(goal || '');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Sync draft when goal changes externally (e.g. after generate)
  React.useEffect(() => { if (goal && !editing) setDraft(goal); }, [goal]);

  const [genStatus, setGenStatus] = useState('');

  const handleGenerate = async () => {
    setGenerating(true);
    setGenStatus('Starting...');

    try {
      // Try SSE streaming first
      const response = await fetch(`/api/projects/${projectId}/generate-goal-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // keep incomplete line

          for (const line of lines) {
            if (line.startsWith('event: progress')) continue;
            if (line.startsWith('event: done')) continue;
            if (line.startsWith('event: error')) continue;
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.step) setGenStatus(data.step);
                if (data.goal_md) {
                  setDraft(data.goal_md);
                  onUpdate();
                  setEditing(false);
                  setGenStatus('');
                }
                if (data.message) {
                  setGenStatus(`Error: ${data.message}`);
                }
              } catch {}
            }
          }
        }
      } else {
        // Fallback to regular endpoint
        const result = await response.json();
        if (result.goal_md) {
          setDraft(result.goal_md);
          onUpdate();
          setEditing(false);
        }
      }
    } catch {
      // Fallback
      try {
        const result = await api(`/projects/${projectId}/generate-goal`, { method: 'POST' });
        if (result.goal_md) {
          setDraft(result.goal_md);
          onUpdate();
          setEditing(false);
        }
      } catch {}
    } finally {
      setGenerating(false);
      setGenStatus('');
    }
  };

  const handleSave = async (approve) => {
    setSaving(true);
    try {
      await api(`/projects/${projectId}/goal`, {
        method: 'POST',
        body: { goal_md: draft, approved: approve }
      });
      setEditing(false);
      onUpdate();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // No goal yet — show generate buttons
  if (!goal && !editing && !generating) {
    return (
      <div className="flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex-1 py-2.5 text-xs text-accent hover:bg-accent/5 border border-dashed border-accent/30 rounded-lg transition-colors disabled:opacity-50"
        >
          Generate goal from code
        </button>
        <button
          onClick={() => { setEditing(true); setEditTab('write'); }}
          className="py-2.5 px-3 text-xs text-vmuted hover:text-text border border-dashed border-border rounded-lg transition-colors"
        >
          Write manually
        </button>
      </div>
    );
  }

  // Generating state
  if (generating && !goal) {
    return (
      <div className="bg-bg rounded-lg px-4 py-6 border border-accent/20 text-center">
        <p className="text-sm text-accent animate-pulse font-mono">{genStatus || 'Starting...'}</p>
        <p className="text-[10px] text-vmuted mt-1">Claude is analyzing your project</p>
      </div>
    );
  }

  // Edit mode — write/preview tabs
  if (editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 bg-bg border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setEditTab('write')}
              className={`px-3 py-1 text-[11px] transition-colors ${editTab === 'write' ? 'bg-card text-text font-medium' : 'text-vmuted hover:text-muted'}`}
            >
              Write
            </button>
            <button
              onClick={() => setEditTab('preview')}
              className={`px-3 py-1 text-[11px] transition-colors ${editTab === 'preview' ? 'bg-card text-text font-medium' : 'text-vmuted hover:text-muted'}`}
            >
              Preview
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleGenerate} disabled={generating} className="text-[10px] text-accent hover:underline disabled:opacity-50">
              {generating ? genStatus || 'Reading code...' : 'Regenerate'}
            </button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-vmuted hover:text-text">Done</button>
          </div>
        </div>
        {editTab === 'write' ? (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="# Product Name\nDescribe what this product should be..."
            className="w-full h-56 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text font-mono placeholder:text-vmuted resize-y focus:outline-none focus:border-accent"
          />
        ) : (
          <div className="bg-bg rounded-lg px-4 py-3 border border-border min-h-[8rem] max-h-64 overflow-y-auto">
            {draft ? <RenderMarkdown text={draft} /> : <p className="text-xs text-vmuted">Nothing to preview yet</p>}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => handleSave(false)} disabled={saving}
            className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-text transition-colors disabled:opacity-50">
            Save draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || !draft.trim()}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Approve — agent follows this'}
          </button>
        </div>
      </div>
    );
  }

  // View mode — rendered markdown
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-mono text-vmuted uppercase tracking-wider">Product goal</p>
          {approved ? (
            <span className="text-[10px] px-1.5 py-0.5 bg-success/10 text-success rounded">Approved</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 bg-warning/20 text-warning rounded">Draft — not active yet</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleGenerate} disabled={generating} className="text-[10px] text-accent hover:underline disabled:opacity-50">
            {generating ? 'Updating...' : 'Regenerate'}
          </button>
          <button onClick={() => { setDraft(goal || ''); setEditing(true); setEditTab('write'); }} className="text-[10px] text-vmuted hover:text-accent transition-colors">
            Edit
          </button>
        </div>
      </div>
      <div className="bg-bg rounded-lg px-4 py-3 border border-border max-h-56 overflow-y-auto">
        <RenderMarkdown text={goal} />
      </div>
      {!approved && (
        <div className="flex items-center gap-2 mt-1.5">
          <button onClick={() => handleSave(true)} className="text-[11px] text-accent hover:underline font-medium">
            Approve this goal
          </button>
          <span className="text-[10px] text-vmuted">— agent will read this before every task</span>
        </div>
      )}
    </div>
  );
}

function StandardsSection({ projectId, preferences, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [importing, setImporting] = useState(false);

  // Parse existing preferences
  React.useEffect(() => {
    if (!initialized && preferences) {
      try {
        const parsed = JSON.parse(preferences);
        if (Array.isArray(parsed)) setRules(parsed);
      } catch { /* ignore */ }
      setInitialized(true);
    }
  }, [preferences, initialized]);

  const saveRules = async (newRules) => {
    setRules(newRules);
    await api(`/projects/${projectId}/preferences`, {
      method: 'POST',
      body: { preferences: newRules },
    });
    onUpdate();
  };

  const addRule = async () => {
    if (!newRule.trim()) return;
    await saveRules([...rules, newRule.trim()]);
    setNewRule('');
  };

  const removeRule = async (idx) => {
    await saveRules(rules.filter((_, i) => i !== idx));
  };

  const loadDefaults = async () => {
    try {
      const defaults = await api('/projects/standards/defaults');
      const newRules = defaults.map(d => d.rule).filter(r => !rules.includes(r));
      if (newRules.length > 0) await saveRules([...rules, ...newRules]);
    } catch { /* ignore */ }
  };

  // Import rules from CLAUDE.md, .eslintrc, tsconfig, etc.
  const importFromProject = async () => {
    setImporting(true);
    try {
      const knowledge = await api(`/projects/${projectId}/knowledge`);
      const imported = [];

      // Extract rules from CLAUDE.md
      if (knowledge.claudeMd) {
        const lines = knowledge.claudeMd.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          // Pick up bullet points that look like rules/instructions
          if (/^[-*] /.test(trimmed) && trimmed.length > 15 && trimmed.length < 200) {
            const rule = trimmed.replace(/^[-*] /, '').trim();
            if (!rules.includes(rule) && !imported.includes(rule)) imported.push(rule);
          }
        }
      }

      // Extract from package.json scripts (infer conventions)
      if (knowledge.packageInfo) {
        const scripts = knowledge.packageInfo.scripts || [];
        if (scripts.includes('lint')) imported.push('Run linter before committing (npm run lint)');
        if (scripts.includes('test')) imported.push('Run tests before committing (npm run test)');
        if (scripts.includes('typecheck')) imported.push('Ensure no TypeScript errors (npm run typecheck)');
        if (knowledge.packageInfo.devDependencies?.includes('prettier')) imported.push('Format code with Prettier');
        if (knowledge.packageInfo.devDependencies?.includes('eslint')) imported.push('Follow ESLint rules configured in this project');
      }

      // Deduplicate against existing rules
      const newRules = imported.filter(r => !rules.includes(r));
      if (newRules.length > 0) {
        await saveRules([...rules, ...newRules]);
      }
    } catch { /* ignore */ }
    finally { setImporting(false); }
  };

  if (!expanded && rules.length === 0) {
    return (
      <div className="flex gap-2">
        <button
          onClick={async () => { setExpanded(true); await importFromProject(); }}
          disabled={importing}
          className="flex-1 py-2 text-xs text-accent hover:bg-accent/5 border border-dashed border-accent/30 rounded-lg transition-colors disabled:opacity-50"
        >
          {importing ? 'Reading project config...' : 'Import standards from project'}
        </button>
        <button
          onClick={() => setExpanded(true)}
          className="py-2 px-3 text-xs text-vmuted hover:text-text border border-dashed border-border rounded-lg transition-colors"
        >
          Set manually
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1">
          <p className="text-xs font-mono text-vmuted uppercase tracking-wider">Standards</p>
          <span className="text-[10px] text-vmuted">{rules.length > 0 ? `(${rules.length})` : ''}</span>
          <span className="text-vmuted text-[10px]">{expanded ? '▴' : '▾'}</span>
        </button>
        <div className="flex items-center gap-2">
          {expanded && (
            <button onClick={importFromProject} disabled={importing} className="text-[10px] text-accent hover:underline disabled:opacity-50">
              {importing ? 'Importing...' : 'Import from project files'}
            </button>
          )}
          {expanded && rules.length === 0 && (
            <button onClick={loadDefaults} className="text-[10px] text-vmuted hover:text-accent">
              Load defaults
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="space-y-1.5">
          {rules.map((rule, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-muted group">
              <span className="text-vmuted mt-0.5 shrink-0">·</span>
              <span className="flex-1">{rule}</span>
              <button onClick={() => removeRule(i)} className="text-vmuted hover:text-error opacity-0 group-hover:opacity-100 shrink-0 text-[10px]">✕</button>
            </div>
          ))}
          <div className="flex gap-1 mt-1">
            <input
              type="text"
              value={newRule}
              onChange={e => setNewRule(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRule()}
              placeholder="Add a custom rule..."
              className="flex-1 bg-bg border border-border rounded px-2 py-1 text-[11px] text-text placeholder:text-vmuted focus:outline-none focus:border-accent"
            />
            <button onClick={addRule} disabled={!newRule.trim()} className="px-2 py-1 text-[11px] text-accent hover:underline disabled:opacity-40">Add</button>
          </div>
          {rules.length > 0 && (
            <button onClick={loadDefaults} className="text-[10px] text-vmuted hover:text-accent">
              + Add default rules
            </button>
          )}
        </div>
      )}
      {!expanded && rules.length > 0 && (
        <p className="text-[11px] text-vmuted truncate">{rules.slice(0, 3).join(' · ')}{rules.length > 3 ? ` + ${rules.length - 3} more` : ''}</p>
      )}
    </div>
  );
}

function CompletedSummary({ tasks, onAction }) {
  const [expanded, setExpanded] = React.useState(false);
  const count = tasks.length;
  const recentCount = tasks.filter(t => {
    const d = t.completed_at || '';
    return d.startsWith(new Date().toISOString().split('T')[0]);
  }).length;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 mb-2 w-full text-left"
      >
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-mono text-vmuted">
          {count} completed {recentCount > 0 ? `(${recentCount} today)` : ''} {expanded ? '▴' : '▾'}
        </span>
        <div className="h-px flex-1 bg-border" />
      </button>
      {expanded && (
        <div className="flex flex-col gap-2">
          {tasks.map(t => (
            <TaskCard key={t.id} task={t} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function MissionsPanel({ projectId, onComplete }) {
  const [running, setRunning] = useState(null);
  const [report, setReport] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const missions = [
    { id: 'comprehensive_review', name: 'Full Review', desc: 'Review everything, find issues', icon: '📋' },
    { id: 'ui_review', name: 'UI/UX Review', desc: 'Check design and usability', icon: '🎨' },
    { id: 'backend_review', name: 'Backend Review', desc: 'API, security, performance', icon: '⚙' },
    { id: 'quality_assessment', name: 'Quality Check', desc: 'Edge cases, tests, bugs', icon: '🛡' },
    { id: 'expansion_research', name: 'Expansion Plan', desc: 'Research next version', icon: '🚀' },
  ];

  const handleRun = async (missionId) => {
    setRunning(missionId);
    setReport(null);
    try {
      const result = await api('/agent/missions/run', {
        method: 'POST',
        body: { project_id: projectId, mission_type: missionId },
      });
      setReport(result);
      onComplete?.();
    } catch (e) {
      setReport({ report: `Mission failed: ${e.message}`, tasksCreated: 0 });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-mono text-vmuted hover:text-accent transition-colors"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="uppercase tracking-wider">Quick actions</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {missions.map(m => (
              <button
                key={m.id}
                onClick={() => handleRun(m.id)}
                disabled={!!running}
                className={`flex flex-col items-start px-3 py-2.5 bg-card border rounded-lg text-left transition-all ${
                  running === m.id ? 'border-accent/40 bg-accent/5' : 'border-border hover:border-accent/30 hover:bg-hover'
                } disabled:opacity-50`}
              >
                <span className="text-sm mb-0.5">{m.icon}</span>
                <span className="text-xs font-medium text-text">{m.name}</span>
                <span className="text-[10px] text-vmuted leading-tight mt-0.5">{m.desc}</span>
                {running === m.id && (
                  <span className="text-[10px] text-accent font-mono animate-pulse mt-1">Running...</span>
                )}
              </button>
            ))}
          </div>

          {/* Report display */}
          {report && (
            <div className="bg-bg border border-border rounded-lg p-4 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-mono text-accent uppercase tracking-wider">Report</p>
                {report.tasksCreated > 0 && (
                  <span className="text-[10px] font-mono text-success">{report.tasksCreated} tasks suggested</span>
                )}
              </div>
              <RenderMarkdown text={report.report} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentControls({ projectId, project, inProgress, planned, completed, suggested, onRefetch }) {
  const [showModes, setShowModes] = useState(false);
  const [startingMode, setStartingMode] = useState(null);

  const startModes = [
    {
      id: 'coding',
      name: 'Coding',
      desc: 'Work through task backlog — fix bugs, build features, write tests',
      action: async () => {
        await api(`/projects/${projectId}`, { method: 'PATCH', body: { paused: 0 } });
        try { await api('/agent/scan-project', { method: 'POST', body: { project_id: projectId } }); } catch {}
        await api('/agent/start', { method: 'POST' });
      },
    },
    {
      id: 'research',
      name: 'Research',
      desc: 'Competitive analysis, architecture review, UX research, implementation planning',
      action: async () => {
        await api(`/projects/${projectId}`, { method: 'PATCH', body: { paused: 0 } });
        // Run all research missions
        const researchMissions = ['research_competitive', 'research_architecture', 'research_user_experience', 'research_implementation'];
        for (const m of researchMissions) {
          try { await api('/agent/missions/run', { method: 'POST', body: { project_id: projectId, mission_type: m } }); } catch {}
        }
      },
    },
    {
      id: 'review',
      name: 'Full Review',
      desc: 'Comprehensive code review — find bugs, security issues, quality gaps',
      action: async () => {
        await api(`/projects/${projectId}`, { method: 'PATCH', body: { paused: 0 } });
        const missions = ['comprehensive_review', 'quality_assessment', 'backend_review', 'ui_review'];
        for (const m of missions) {
          try { await api('/agent/missions/run', { method: 'POST', body: { project_id: projectId, mission_type: m } }); } catch {}
        }
      },
    },
    {
      id: 'expand',
      name: 'Expand',
      desc: 'Research next version, plan features, then start building them',
      action: async () => {
        await api(`/projects/${projectId}`, { method: 'PATCH', body: { paused: 0 } });
        try { await api('/agent/missions/run', { method: 'POST', body: { project_id: projectId, mission_type: 'expansion_research' } }); } catch {}
        await api('/agent/start', { method: 'POST' });
      },
    },
  ];

  const handleStart = async (mode) => {
    setStartingMode(mode.id);
    try {
      await mode.action();
      onRefetch();
    } catch { /* ignore */ }
    finally {
      setStartingMode(null);
      setShowModes(false);
    }
  };

  // Paused state — show start options
  if (project.paused) {
    return (
      <div>
        {!showModes ? (
          <button
            onClick={() => setShowModes(true)}
            className="px-5 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors font-medium"
          >
            Start agent on this project
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-mono text-vmuted">Choose how the agent should start:</p>
              <button onClick={() => setShowModes(false)} className="text-[10px] text-vmuted hover:text-text">Cancel</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {startModes.map(mode => (
                <button
                  key={mode.id}
                  onClick={() => handleStart(mode)}
                  disabled={!!startingMode}
                  className={`flex flex-col items-start px-3 py-2.5 bg-card border rounded-lg text-left transition-all ${
                    startingMode === mode.id ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/30'
                  } disabled:opacity-60`}
                >
                  <span className="text-sm font-medium text-text">{mode.name}</span>
                  <span className="text-[10px] text-vmuted leading-tight mt-0.5">{mode.desc}</span>
                  {startingMode === mode.id && (
                    <span className="text-[10px] text-accent font-mono animate-pulse mt-1">Starting...</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Active — show working/standby status
  return (
    <div className="flex items-center gap-2">
      {inProgress?.length > 0 ? (
        <>
          <span className="flex items-center gap-1.5 text-sm text-success font-mono">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Agent working
          </span>
          <button
            onClick={async () => {
              await api(`/projects/${projectId}`, { method: 'PATCH', body: { paused: 1 } });
              onRefetch();
            }}
            className="px-3 py-1 text-xs text-vmuted hover:text-warning border border-border rounded-lg transition-colors"
          >
            Pause
          </button>
        </>
      ) : (
        <>
          <span className="text-sm text-vmuted font-mono">Standby</span>
          <button
            onClick={async () => {
              try { await api('/agent/scan-project', { method: 'POST', body: { project_id: projectId } }); } catch {}
              await api('/agent/start', { method: 'POST' });
              onRefetch();
            }}
            className="px-3 py-1 text-xs text-accent border border-accent/30 rounded-lg hover:bg-accent/5 transition-colors"
          >
            Scan for tasks
          </button>
        </>
      )}
      <div className="flex-1" />
      <span className="text-[10px] text-vmuted font-mono">
        {suggested?.length > 0 && <span className="text-accent">{suggested.length} suggested · </span>}
        {planned?.length || 0} queued · {completed?.length || 0} done
      </span>
    </div>
  );
}

export default function ProjectFeed() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, refetch } = useApi(`/timeline/project/${id}`, [], 5000);
  const [renamingName, setRenamingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  if (!data) return (
    <div className="px-6 py-6">
      <div className="text-muted animate-pulse text-sm">Loading...</div>
    </div>
  );

  const { project, humanTasks, completed, inProgress, planned, failed, suggested } = data;
  const isEmpty = !humanTasks?.length && !inProgress?.length && !completed?.length && !planned?.length && !failed?.length;

  const handleRenameStart = () => {
    setNameValue(project.name);
    setRenamingName(true);
  };

  const handleRenameCommit = async () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== project.name) {
      await api(`/projects/${id}`, { method: 'PATCH', body: { name: trimmed } });
      refetch();
    }
    setRenamingName(false);
  };

  const handleDeleteTask = async (taskId) => {
    await api(`/tasks/${taskId}`, { method: 'DELETE' });
    refetch();
  };

  const handleRetryTask = async (taskId) => {
    await api(`/tasks/${taskId}/execute`, { method: 'POST' });
    refetch();
  };

  const handleBumpTask = async (taskId) => {
    await api(`/tasks/${taskId}`, { method: 'PATCH', body: { priority: 1 } });
    refetch();
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.name}" and all its tasks?`)) return;
    await api(`/projects/${id}`, { method: 'DELETE' });
    navigate('/');
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {renamingName ? (
              <input
                autoFocus
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  if (e.key === 'Escape') setRenamingName(false);
                }}
                className="text-xl font-bold bg-transparent border-b border-accent outline-none w-full truncate"
              />
            ) : (
              <h1
                className="text-xl font-bold truncate cursor-pointer hover:opacity-70 transition-opacity"
                title="Click to rename"
                onClick={handleRenameStart}
              >
                {project.name}
              </h1>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {project.stack?.length > 0 && project.stack.map(s => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded font-mono">{s}</span>
              ))}
              {project.repo_path && (
                <span className="text-[10px] font-mono text-vmuted truncate max-w-xs">{project.repo_path}</span>
              )}
            </div>
            {/* Quick links to external services */}
            {(() => {
              const services = project.services ? (typeof project.services === 'string' ? JSON.parse(project.services) : project.services) : {};
              const links = [];
              if (services.github || project.github_remote) {
                const ghUrl = services.github || project.github_remote.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '');
                links.push({ name: 'GitHub', url: ghUrl, color: 'text-text' });
              }
              if (services.vercel) links.push({ name: 'Vercel', url: services.vercel, color: 'text-text' });
              if (services.supabase) links.push({ name: 'Supabase', url: services.supabase, color: 'text-success' });
              if (services.railway) links.push({ name: 'Railway', url: services.railway, color: 'text-research' });
              if (services.netlify) links.push({ name: 'Netlify', url: services.netlify, color: 'text-accent' });

              if (links.length === 0) return null;
              return (
                <div className="flex items-center gap-1.5 mt-1">
                  {links.map(l => (
                    <button
                      key={l.name}
                      onClick={() => api('/open-url', { method: 'POST', body: { url: l.url } }).catch(() => window.open(l.url))}
                      className={`text-[10px] px-1.5 py-0.5 bg-hover border border-border rounded font-mono hover:border-accent/30 transition-colors ${l.color}`}
                    >
                      {l.name}
                    </button>
                  ))}
                  <button
                    onClick={() => api('/open-file', { method: 'POST', body: { file_path: project.repo_path } }).catch(() => {})}
                    className="text-[10px] px-1.5 py-0.5 bg-hover border border-border rounded font-mono text-vmuted hover:border-accent/30 transition-colors"
                  >
                    Open folder
                  </button>
                </div>
              );
            })()}
          </div>
          <button
            onClick={handleDelete}
            className="text-xs text-vmuted hover:text-error transition-colors shrink-0"
            title="Delete project"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* Agent controls */}
      <div className="px-6 py-2 border-b border-border">
        <AgentControls projectId={id} project={data.project} inProgress={inProgress} planned={planned} completed={completed} suggested={suggested} onRefetch={refetch} />
      </div>

      {/* Goal & Standards */}
      <div className="px-6 py-3 border-b border-border space-y-3">
        {/* Goal */}
        <GoalSection projectId={id} goal={data.project.goal_md} approved={data.project.goal_approved} onUpdate={refetch} />

        {/* Standards */}
        <StandardsSection projectId={id} preferences={data.project.preferences} onUpdate={refetch} />

        <MissionsPanel projectId={id} onComplete={refetch} />
      </div>

      {/* Feed content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 pb-32">

        {/* Reviews banner */}
        {humanTasks?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-warning" />
              <h2 className="text-xs font-mono text-warning uppercase tracking-wider">
                Needs your attention ({humanTasks.length})
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {humanTasks.map(t => <HumanTaskCard key={t.id} task={t} onAction={refetch} />)}
            </div>
          </div>
        )}

        {/* In-progress tasks */}
        {inProgress?.length > 0 && (
          <div className="flex flex-col gap-2">
            {inProgress.map(t => (
              <TaskCard key={t.id} task={t} onAction={refetch} />
            ))}
          </div>
        )}

        {/* PM Suggestions — agent-recommended next steps */}
        {suggested?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <h2 className="text-xs font-mono text-accent uppercase tracking-wider">
                Agent recommends ({suggested.length})
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {suggested.map(t => (
                <div key={t.id} className="bg-card border border-accent/20 rounded-lg px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="text-accent text-sm mt-0.5 shrink-0">?</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text font-medium">{t.title}</p>
                      {t.description && (
                        <p className="text-xs text-muted mt-0.5 leading-relaxed">{t.description}</p>
                      )}
                      {t.parent_title && (
                        <p className="text-[10px] text-vmuted mt-1 font-mono">
                          After: {t.parent_title}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={async () => {
                          await api(`/tasks/${t.id}/approve-suggestion`, { method: 'POST' });
                          refetch();
                        }}
                        className="px-2.5 py-1 text-[11px] bg-accent text-white rounded hover:bg-accent/80 transition-colors font-medium"
                      >
                        Add to queue
                      </button>
                      <button
                        onClick={async () => {
                          await api(`/tasks/${t.id}/dismiss-suggestion`, { method: 'POST' });
                          refetch();
                        }}
                        className="px-2 py-1 text-[11px] text-vmuted hover:text-error transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed — collapsed by default with summary */}
        {completed?.length > 0 && (
          <CompletedSummary tasks={completed} onAction={refetch} />
        )}

        {/* Queued/planned */}
        {planned?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-mono text-vmuted">Up next ({planned.length})</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-1.5">
              {planned.map((t, idx) => (
                <div key={t.id} className="relative flex items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-lg group">
                  <span className="text-vmuted text-sm">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-muted">{t.title}</span>
                    {t.description && (
                      <span className="text-[10px] text-vmuted block truncate">{t.description}</span>
                    )}
                  </div>
                  {t.provider && (
                    <span className="text-[10px] font-mono text-accent/60 shrink-0">
                      {t.provider === 'claude_code' ? 'Claude' : t.provider === 'antigravity' ? 'Agy' : t.provider === 'cursor' ? 'Cursor' : t.provider}
                    </span>
                  )}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {idx > 0 && (
                      <button
                        onClick={() => handleBumpTask(t.id)}
                        title="Move to top"
                        className="p-1 text-vmuted hover:text-accent rounded transition-colors text-xs"
                      >
                        ↑ Top
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteTask(t.id)}
                      className="p-1 text-vmuted hover:text-error rounded transition-colors text-xs"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Failed tasks */}
        {failed?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-error" />
              <h2 className="text-xs font-mono text-error uppercase tracking-wider">
                Failed ({failed.length})
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {failed.map(t => (
                <div key={t.id} className="bg-card border border-error/30 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="text-error text-sm shrink-0 mt-0.5">✕</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text">{t.title}</span>
                      {t.execution_log && (
                        <p className="text-xs text-error/70 mt-1 font-mono leading-relaxed line-clamp-2">{t.execution_log}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRetryTask(t.id)}
                      className="shrink-0 text-xs text-muted hover:text-accent border border-border rounded-md px-2 py-1 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="text-center py-16">
            <p className="text-muted text-sm mb-1">No tasks for {project.name} yet.</p>
            <p className="text-vmuted text-xs">Add a task below to get started.</p>
          </div>
        )}
      </div>

      {/* Fixed task input at bottom */}
      <div className="sticky bottom-0 bg-bg border-t border-border px-6 py-3">
        <TaskInput fixedProjectId={id} onTaskAdded={refetch} />
      </div>
    </div>
  );
}
