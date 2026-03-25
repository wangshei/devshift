import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';

export default function ProjectKnowledge() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, refetch } = useApi(`/projects/${id}/knowledge`);

  const [editingContext, setEditingContext] = useState(false);
  const [contextValue, setContextValue] = useState('');
  const [editingRules, setEditingRules] = useState(false);
  const [rulesValue, setRulesValue] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [saving, setSaving] = useState(false);

  if (loading || !data) {
    return (
      <div className="px-6 py-6">
        <div className="text-muted animate-pulse text-sm">Loading...</div>
      </div>
    );
  }

  const { project, claudeMd, packageInfo, git, preferences, stats, recentWork } = data;

  // Context editing
  const handleEditContext = () => {
    setContextValue(project.context || '');
    setEditingContext(true);
  };

  const handleSaveContext = async () => {
    setSaving(true);
    try {
      await api(`/projects/${id}`, { method: 'PATCH', body: { context: contextValue } });
      refetch();
    } catch { /* ignore */ }
    setSaving(false);
    setEditingContext(false);
  };

  // Preferences editing
  const handleEditRules = () => {
    setRulesValue([...(preferences || [])]);
    setEditingRules(true);
  };

  const handleAddRule = () => {
    const trimmed = newRule.trim();
    if (!trimmed) return;
    setRulesValue([...rulesValue, trimmed]);
    setNewRule('');
  };

  const handleRemoveRule = (index) => {
    setRulesValue(rulesValue.filter((_, i) => i !== index));
  };

  const handleSaveRules = async () => {
    setSaving(true);
    try {
      await api(`/projects/${id}/preferences`, { method: 'POST', body: { preferences: rulesValue } });
      refetch();
    } catch { /* ignore */ }
    setSaving(false);
    setEditingRules(false);
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-border">
        <button
          onClick={() => navigate(`/project/${id}`)}
          className="text-xs text-muted hover:text-accent transition-colors mb-2 inline-flex items-center gap-1"
        >
          <span>&larr;</span> Back to {project.name}
        </button>
        <h1 className="text-xl font-bold">What the agent knows about {project.name}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 pb-16">

        {/* Project Context */}
        <section>
          <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span>Project Context</span>
            <div className="h-px flex-1 bg-border" />
          </h2>
          {editingContext ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={contextValue}
                onChange={e => setContextValue(e.target.value)}
                rows={4}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-vmuted focus:outline-none focus:border-accent resize-y"
                placeholder="Describe what this project is..."
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveContext}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingContext(false)}
                  className="px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:text-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted italic leading-relaxed">
                {project.context || 'No context set for this project.'}
              </p>
              <button
                onClick={handleEditContext}
                className="mt-2 text-xs text-vmuted hover:text-accent transition-colors"
              >
                Edit context
              </button>
            </div>
          )}
        </section>

        {/* Rules & Preferences */}
        <section>
          <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span>Rules & Preferences</span>
            <div className="h-px flex-1 bg-border" />
          </h2>
          {editingRules ? (
            <div className="space-y-2">
              {rulesValue.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
                  <span className="text-sm text-text flex-1">{rule}</span>
                  <button
                    onClick={() => handleRemoveRule(i)}
                    className="text-xs text-vmuted hover:text-error transition-colors shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newRule}
                  onChange={e => setNewRule(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddRule(); }}
                  placeholder="Add a rule..."
                  className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-vmuted focus:outline-none focus:border-accent"
                />
                <button
                  onClick={handleAddRule}
                  className="px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:text-accent transition-colors"
                >
                  + Add
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveRules}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save rules'}
                </button>
                <button
                  onClick={() => setEditingRules(false)}
                  className="px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:text-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              {preferences && preferences.length > 0 ? (
                <ul className="space-y-1.5">
                  {preferences.map((rule, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted">
                      <span className="text-vmuted shrink-0 mt-0.5">&bull;</span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-vmuted italic">No rules set.</p>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    setRulesValue([...(preferences || [])]);
                    setNewRule('');
                    setEditingRules(true);
                  }}
                  className="text-xs text-vmuted hover:text-accent transition-colors"
                >
                  + Add rule
                </button>
                {preferences && preferences.length > 0 && (
                  <button
                    onClick={handleEditRules}
                    className="text-xs text-vmuted hover:text-accent transition-colors"
                  >
                    Edit rules
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* CLAUDE.md */}
        <section>
          <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span>CLAUDE.md</span>
            <div className="h-px flex-1 bg-border" />
          </h2>
          {claudeMd ? (
            <pre className="text-xs font-mono text-muted leading-relaxed whitespace-pre-wrap bg-card border border-border rounded-lg p-4 max-h-64 overflow-y-auto">
              {claudeMd}
            </pre>
          ) : (
            <p className="text-sm text-vmuted italic">No CLAUDE.md found in this project.</p>
          )}
        </section>

        {/* Tech Stack */}
        {packageInfo && (
          <section>
            <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span>Tech Stack</span>
              <div className="h-px flex-1 bg-border" />
            </h2>
            <div className="space-y-3">
              {packageInfo.dependencies.length > 0 && (
                <div>
                  <span className="text-xs font-mono text-vmuted">Dependencies: </span>
                  <span className="text-sm text-muted">{packageInfo.dependencies.join(', ')}</span>
                </div>
              )}
              {packageInfo.devDependencies.length > 0 && (
                <div>
                  <span className="text-xs font-mono text-vmuted">Dev deps: </span>
                  <span className="text-sm text-muted">{packageInfo.devDependencies.join(', ')}</span>
                </div>
              )}
              {packageInfo.scripts.length > 0 && (
                <div>
                  <span className="text-xs font-mono text-vmuted">Scripts: </span>
                  <span className="text-sm text-muted">{packageInfo.scripts.join(', ')}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Git Status */}
        {git && (
          <section>
            <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span>Git Status</span>
              <div className="h-px flex-1 bg-border" />
            </h2>
            <div className="space-y-2">
              <p className="text-sm text-muted">
                <span className="font-mono text-xs text-vmuted">Branch:</span>{' '}
                <span className="font-mono">{git.branch}</span>
                <span className="text-vmuted mx-1">&middot;</span>
                <span>{git.fileCount} files</span>
              </p>
              {git.recentCommits && git.recentCommits.length > 0 && (
                <div>
                  <p className="text-xs font-mono text-vmuted mb-1">Recent commits:</p>
                  <div className="space-y-0.5">
                    {git.recentCommits.map((commit, i) => (
                      <p key={i} className="text-xs font-mono text-muted leading-relaxed">{commit}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Agent Track Record */}
        <section>
          <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span>Agent Track Record</span>
            <div className="h-px flex-1 bg-border" />
          </h2>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span><span className="text-success font-mono">{stats.done}</span> done</span>
              <span><span className="text-error font-mono">{stats.failed}</span> failed</span>
              <span><span className="font-mono">{stats.backlog}</span> in backlog</span>
              <span><span className="text-warning font-mono">{stats.needsReview}</span> review</span>
            </div>

            {recentWork && recentWork.length > 0 && (
              <div>
                <p className="text-xs font-mono text-vmuted mb-1.5">Recent work:</p>
                <div className="space-y-1">
                  {recentWork.map((task, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-success shrink-0">&#10003;</span>
                      <span className="text-muted flex-1 truncate">{task.title}</span>
                      {task.actual_minutes != null && (
                        <span className="text-[10px] font-mono text-vmuted shrink-0">{task.actual_minutes}min</span>
                      )}
                      {task.provider && (
                        <span className="text-[10px] font-mono text-vmuted shrink-0">{task.provider}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!recentWork || recentWork.length === 0) && stats.total === 0 && (
              <p className="text-sm text-vmuted italic">No tasks have been run for this project yet.</p>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
