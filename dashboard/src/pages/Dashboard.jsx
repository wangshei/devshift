import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import TaskInput from '../components/TaskInput';
import ChatPanel from '../components/ChatPanel';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, refetch } = useApi('/timeline/dashboard', [], 5000);
  const { data: schedule, refetch: refetchSchedule } = useApi('/schedule', [], 5000);
  const { data: agentStatus } = useApi('/agent/status', [], 4000);
  const { data: credits } = useApi('/credits', [], 10000);
  const { data: unreadReports, refetch: refetchReports } = useApi('/product/reports/unread', [], 10000);
  const [chatProject, setChatProject] = useState(null);

  const isAlwaysOn = !!schedule?.always_on;
  const projects = data?.projects || [];

  // Aggregate stats for greeting
  const totalCompleted = projects.reduce((sum, p) => sum + (p.completedToday || 0), 0);
  const totalNeedsReview = projects.reduce((sum, p) => sum + (p.needsReview || 0), 0);
  const totalQueued = agentStatus?.queuedTasks || 0;

  const toggleAlwaysOn = async () => {
    await api('/schedule', { method: 'PATCH', body: { always_on: isAlwaysOn ? 0 : 1 } });
    refetchSchedule();
  };

  const markReportRead = async (reportId) => {
    await api(`/product/reports/${reportId}/read`, { method: 'POST' });
    refetchReports();
  };

  // Build greeting summary
  let summaryParts = [];
  if (totalCompleted > 0) summaryParts.push(`Agent completed ${totalCompleted} task${totalCompleted !== 1 ? 's' : ''}`);
  if (totalNeedsReview > 0) summaryParts.push(`${totalNeedsReview} need${totalNeedsReview === 1 ? 's' : ''} your review`);
  const summaryText = summaryParts.length > 0 ? summaryParts.join('. ') + '.' : 'All caught up.';

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      {/* Greeting + status bar */}
      <section>
        <h1 className="text-lg font-medium text-text">{getGreeting()}.</h1>
        <p className="text-sm text-muted mt-0.5">{summaryText}</p>
        <div className="flex items-center gap-4 mt-3">
          <button onClick={toggleAlwaysOn} className="flex items-center gap-2 group">
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isAlwaysOn ? 'bg-success' : 'bg-border'}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isAlwaysOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </span>
            <span className="text-xs text-muted group-hover:text-text transition-colors">
              {isAlwaysOn ? 'Auto-pilot on' : 'Auto-pilot off'}
            </span>
          </button>
          {credits?.realCostUsd > 0 && (
            <span className="text-xs font-mono text-vmuted">${credits.realCostUsd.toFixed(2)} this week</span>
          )}
          {totalQueued > 0 && (
            <span className="text-xs font-mono text-vmuted">{totalQueued} queued</span>
          )}
          {credits?.status === 'critical' && (
            <span className="text-[10px] text-error font-mono animate-pulse">{credits.message}</span>
          )}
          {credits?.status === 'low' && (
            <span className="text-[10px] text-warning font-mono">{credits.message}</span>
          )}
          {credits?.status === 'exhausted' && (
            <span className="text-[10px] text-error font-bold">Budget exhausted — agent paused</span>
          )}
          {credits?.providerBreakdown?.some(p => p.rateLimitedUntil && new Date(p.rateLimitedUntil) > new Date()) && (
            <span className="text-[10px] text-warning font-mono">
              Rate limited — resets {(() => {
                const rl = credits.providerBreakdown.find(p => p.rateLimitedUntil && new Date(p.rateLimitedUntil) > new Date());
                const mins = Math.max(1, Math.round((new Date(rl.rateLimitedUntil) - new Date()) / 60000));
                return mins < 60 ? `in ${mins}min` : `at ${new Date(rl.rateLimitedUntil).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
              })()}
            </span>
          )}
        </div>
      </section>

      {/* PM Inbox */}
      {unreadReports?.length > 0 && (
        <section>
          <h2 className="text-xs font-mono text-accent uppercase tracking-wider mb-2">
            PM Inbox ({unreadReports.length})
          </h2>
          <div className="space-y-2">
            {unreadReports.map(report => (
              <PMReportCard key={report.id} report={report} onRead={markReportRead} navigate={navigate} />
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      <section>
        <h2 className="text-xs font-mono text-vmuted uppercase tracking-wider mb-2">Projects</h2>
        <div className="space-y-2">
          {projects.map(p => (
            <ProjectCard
              key={p.project.id}
              data={p}
              onNavigate={() => navigate(`/project/${p.project.id}`)}
              onChat={() => setChatProject(p.project)}
            />
          ))}
        </div>
        {projects.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted text-sm mb-1">No projects yet.</p>
            <p className="text-vmuted text-xs">Add a project from the sidebar.</p>
          </div>
        )}
      </section>

      {/* Quick add */}
      <section>
        <TaskInput onTaskAdded={refetch} />
      </section>

      {/* Chat overlay */}
      {chatProject && (
        <div className="fixed inset-y-0 right-0 w-96 z-50 shadow-xl">
          <ChatPanel
            projectId={chatProject.id}
            taskTitle={chatProject.name}
            onClose={() => setChatProject(null)}
          />
        </div>
      )}
    </div>
  );
}

function PMReportCard({ report, onRead, navigate }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-card border rounded-lg transition-colors ${report.type === 'attention' ? 'border-warning/30' : 'border-border'}`}>
      <div className="px-4 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-[10px] font-bold text-accent">PM</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">{report.project_name}</span>
            </div>
            {!expanded && (
              <p className="text-xs text-muted mt-0.5 line-clamp-2">{report.content}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={e => { e.stopPropagation(); onRead(report.id); }}
              className="text-[10px] text-vmuted hover:text-muted transition-colors"
              title="Mark read"
            >
              ✓
            </button>
            <span className="text-vmuted text-xs">{expanded ? '▴' : '▾'}</span>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap pl-9">{report.content}</p>
          <div className="flex gap-3 pl-9">
            <button onClick={() => navigate(`/project/${report.project_id}`)}
              className="text-[10px] text-accent hover:underline">Open project</button>
            <button onClick={() => onRead(report.id)}
              className="text-[10px] text-vmuted hover:text-muted">Mark read</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ data, onNavigate, onChat }) {
  const { project, activeTask, needsReview, completedToday, backlog } = data;

  // Status dot color
  let dotColor = 'bg-vmuted'; // gray = idle
  if (needsReview > 0) dotColor = 'bg-warning'; // yellow = review needed
  if (activeTask) dotColor = 'bg-success animate-pulse'; // green = active

  // One-liner summary
  let summary = 'All caught up';
  const parts = [];
  if (activeTask) parts.push('1 in progress');
  if (backlog > 0) parts.push(`${backlog} queued`);
  if (needsReview > 0) parts.push(`${needsReview} need${needsReview === 1 ? 's' : ''} review`);
  if (completedToday > 0) parts.push(`${completedToday} done today`);
  if (parts.length > 0) summary = parts.join(', ');

  return (
    <div className={`bg-card border rounded-lg hover:border-accent/20 transition-colors ${needsReview > 0 ? 'border-warning/30' : 'border-border'}`}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-text">{project.name}</span>
            <p className="text-[11px] text-muted mt-0.5">{summary}</p>
            {project.active_goal && (
              <p className="text-[10px] text-vmuted mt-0.5 truncate">{project.active_goal}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={e => { e.stopPropagation(); onChat(); }}
              className="px-2 py-1 text-[10px] text-muted hover:text-accent border border-border rounded transition-colors"
            >
              Chat
            </button>
            <button
              onClick={onNavigate}
              className="px-2 py-1 text-[10px] text-muted hover:text-accent border border-border rounded transition-colors"
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
