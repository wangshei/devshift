import React, { useState } from 'react';
import { useApi, api } from '../hooks/useApi';
import ProjectCard from '../components/ProjectCard';

export default function Projects() {
  const { data: projects, refetch } = useApi('/projects');
  const { data: tasks } = useApi('/tasks');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', repo_path: '', github_remote: '', context: '' });

  const taskCounts = {};
  if (tasks) {
    for (const t of tasks) {
      if (!taskCounts[t.project_id]) taskCounts[t.project_id] = {};
      taskCounts[t.project_id][t.status] = (taskCounts[t.project_id][t.status] || 0) + 1;
    }
  }

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.name || !form.repo_path) return;
    await api('/projects', { method: 'POST', body: form });
    setForm({ name: '', repo_path: '', github_remote: '', context: '' });
    setShowAdd(false);
    refetch();
  };

  const handleDelete = async (id) => {
    await api(`/projects/${id}`, { method: 'DELETE' });
    refetch();
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Projects</h1>
        <button onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-xs bg-accent/10 text-accent border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors">
          {showAdd ? 'Cancel' : '+ Add Project'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
          <input placeholder="Project name" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
          <input placeholder="Repo path (e.g. /Users/you/code/project)" value={form.repo_path}
            onChange={e => setForm({ ...form, repo_path: e.target.value })}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
          <input placeholder="GitHub remote (optional)" value={form.github_remote}
            onChange={e => setForm({ ...form, github_remote: e.target.value })}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent" />
          <textarea placeholder="Project context (what it is, stack, notes for AI)" value={form.context}
            onChange={e => setForm({ ...form, context: e.target.value })} rows={2}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent resize-none" />
          <button type="submit"
            className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/80 transition-colors">
            Create Project
          </button>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {projects?.map(p => (
          <ProjectCard key={p.id} project={p} taskCounts={taskCounts[p.id]}
            onEdit={() => {}} onDelete={() => handleDelete(p.id)} />
        ))}
      </div>

      {projects?.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted text-sm">No projects yet. Add your first project to get started.</p>
        </div>
      )}
    </div>
  );
}
