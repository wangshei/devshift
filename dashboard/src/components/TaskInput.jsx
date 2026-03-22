import React, { useState } from 'react';
import { useApi, api } from '../hooks/useApi';

export default function TaskInput({ onTaskAdded }) {
  const { data: projects } = useApi('/projects');
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;

    setSubmitting(true);
    try {
      await api('/tasks', {
        method: 'POST',
        body: { project_id: projectId, title: title.trim() },
      });
      setTitle('');
      onTaskAdded?.();
    } catch (err) {
      console.error('Failed to add task:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <select
        value={projectId}
        onChange={e => setProjectId(e.target.value)}
        className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
      >
        <option value="">Project...</option>
        {projects?.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Add a task..."
        className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-vmuted focus:outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={!title.trim() || !projectId || submitting}
        className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        +
      </button>
    </form>
  );
}
