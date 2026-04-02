import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';

function AddProjectPanel({ onClose, onAdded }) {
  const [pathInput, setPathInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [picking, setPicking] = useState(false);

  const handlePickFolder = async () => {
    setPicking(true);
    setAddError('');
    try {
      const result = await api('/projects/pick-folder', { method: 'POST' });
      if (result.cancelled || !result.path) {
        setPicking(false);
        return;
      }
      await api('/projects/from-path', { method: 'POST', body: { path: result.path } });
      onAdded();
      onClose();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setPicking(false);
    }
  };

  const handleAddPath = async () => {
    if (!pathInput.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await api('/projects/from-path', { method: 'POST', body: { path: pathInput.trim() } });
      setPathInput('');
      onAdded();
      onClose();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mt-2 mx-1 bg-bg border border-border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text">Add project</span>
        <button onClick={onClose} className="text-vmuted hover:text-muted text-xs leading-none">✕</button>
      </div>

      <button
        onClick={handlePickFolder}
        disabled={picking}
        className="w-full py-2.5 border border-dashed border-border rounded-md text-[11px] text-accent hover:border-accent hover:bg-accent/5 transition-colors disabled:opacity-50"
      >
        {picking ? 'Opening Finder...' : 'Choose folder...'}
      </button>

      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] text-vmuted font-mono">or paste path</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="flex gap-1">
          <input
            type="text"
            value={pathInput}
            onChange={e => { setPathInput(e.target.value); setAddError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleAddPath(); }}
            placeholder="/path/to/project"
            className="flex-1 bg-card border border-border rounded-md px-2 py-1 text-[11px] text-text font-mono placeholder:text-vmuted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleAddPath}
            disabled={!pathInput.trim() || adding}
            className="px-2 py-1 bg-accent text-white text-[11px] rounded-md hover:bg-accent/80 disabled:opacity-40 transition-colors"
          >
            {adding ? '...' : 'Add'}
          </button>
        </div>
      </div>

      {addError && <p className="text-[10px] text-error mt-1">{addError}</p>}
    </div>
  );
}

const navItems = [
  {
    path: '/',
    label: 'Home',
    exact: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    path: '/my-work',
    label: 'My Work',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    path: '/timeline',
    label: 'Timeline',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: dashData, refetch: refetchDash } = useApi('/timeline/dashboard', [], 8000);
  const { data: myWorkData } = useApi('/my-work', [], 10000);
  const attentionCount = myWorkData?.counts?.needsAttention || 0;

  const [showAddProject, setShowAddProject] = useState(false);

  const projects = dashData?.projects || [];

  const getProjectDot = (p) => {
    if (p.activeTask) return 'bg-success animate-pulse';
    if (p.needsReview > 0) return 'bg-warning';
    return 'bg-vmuted';
  };

  const isNavActive = (item) => {
    if (item.exact) return location.pathname === item.path;
    return location.pathname.startsWith(item.path);
  };

  const handleRemoveProject = async (id, name) => {
    if (!confirm(`Remove "${name}" from DevShift? This deletes all its tasks.`)) return;
    await api(`/projects/${id}`, { method: 'DELETE' });
    if (location.pathname === `/project/${id}`) navigate('/');
    refetchDash();
  };

  return (
    <aside className="w-56 shrink-0 bg-card border-r border-border flex flex-col h-screen overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span
          className="font-bold text-base cursor-pointer select-none"
          onClick={() => navigate('/')}
        >
          <span className="text-accent font-mono">Dev</span>
          <span className="text-text">Shift</span>
        </span>
      </div>

      {/* Main nav */}
      <nav className="px-1 pb-4 flex flex-col gap-0.5">
        {navItems.map(item => {
          const active = isNavActive(item);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`relative flex items-center gap-2.5 px-4 py-2 w-full transition-colors ${
                active
                  ? 'text-accent bg-accent/8'
                  : 'text-muted hover:text-text hover:bg-hover'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-r" />
              )}
              {item.icon}
              <span className="text-sm flex-1 text-left">{item.label}</span>
              {item.path === '/my-work' && attentionCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 bg-warning text-bg text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {attentionCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Projects section */}
      <div className="px-3 flex-1">
        <p className="text-[10px] font-mono text-vmuted uppercase tracking-wider px-1 mb-2">Projects</p>
        <div className="flex flex-col gap-0.5">
          {projects.map(p => {
            const isActive = location.pathname === `/project/${p.project.id}`;
            return (
              <div
                key={p.project.id}
                className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                  isActive ? 'bg-accent/8' : 'hover:bg-hover'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-r" />
                )}
                <div
                  className="flex items-center gap-2 flex-1 min-w-0"
                  onClick={() => navigate(`/project/${p.project.id}`)}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getProjectDot(p)}`} />
                  <span className={`text-sm truncate flex-1 ${isActive ? 'text-text font-medium' : 'text-muted group-hover:text-text'}`}>
                    {p.project.name}
                  </span>
                  {p.needsReview > 0 && (
                    <span className="text-[10px] font-mono text-warning shrink-0">{p.needsReview}</span>
                  )}
                </div>
                <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); navigate(`/project/${p.project.id}`); }}
                    title="Open project"
                    className="text-vmuted hover:text-accent text-xs transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                    </svg>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleRemoveProject(p.project.id, p.project.name); }}
                    title="Remove project"
                    className="text-vmuted hover:text-error text-xs transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {showAddProject ? (
          <AddProjectPanel
            onClose={() => setShowAddProject(false)}
            onAdded={refetchDash}
          />
        ) : (
          <button
            onClick={() => setShowAddProject(true)}
            className="flex items-center gap-2 px-2 py-1.5 mt-1 w-full text-sm text-vmuted hover:text-accent transition-colors rounded-md"
          >
            <span className="text-base leading-none">+</span>
            <span className="text-xs">Add project</span>
          </button>
        )}
      </div>
    </aside>
  );
}
