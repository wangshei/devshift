import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, api } from '../hooks/useApi';
import TaskInput from '../components/TaskInput';
import ChatPanel from '../components/ChatPanel';

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

  const toggleAlwaysOn = async () => {
    await api('/schedule', { method: 'PATCH', body: { always_on: isAlwaysOn ? 0 : 1 } });
    refetchSchedule();
  };

  const markReportRead = async (reportId) => {
    await api(`/product/reports/${reportId}/read`, { method: 'POST' });
    refetchReports();
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      {/* PM Inbox */}
      {unreadReports?.length > 0 && (
        <section>
          <h2 className="text-xs font-mono text-accent uppercase tracking-wider mb-2">
            PM Updates ({unreadReports.length})
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
            <ProjectCommandCard
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

      {/* Auto-pilot + Credits (compact) */}
      <section className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg">
        <div className={`w-2 h-2 rounded-full shrink-0 ${isAlwaysOn ? 'bg-success animate-pulse' : 'bg-vmuted'}`} />
        <div className="flex-1 min-w-0">
          <span className="text-xs text-text">{isAlwaysOn ? 'Auto-pilot on' : 'Auto-pilot off'}</span>
          {credits?.realCostUsd > 0 && (
            <span className="text-[10px] font-mono text-vmuted ml-2">${credits.realCostUsd.toFixed(2)} this week</span>
          )}
        </div>
        <button onClick={toggleAlwaysOn}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isAlwaysOn ? 'bg-success' : 'bg-border'}`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isAlwaysOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
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
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-[10px] font-bold text-accent">PM</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text">{report.title}</span>
              <span className="text-[10px] text-vmuted font-mono">{report.project_name}</span>
            </div>
            {!expanded && (
              <p className="text-xs text-muted mt-0.5 line-clamp-1">{report.content}</p>
            )}
          </div>
          <span className="text-vmuted text-xs shrink-0">{expanded ? '▴' : '▾'}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap pl-8">{report.content}</p>
          <div className="flex gap-2 pl-8">
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

function ProjectCommandCard({ data, onNavigate, onChat }) {
  const { project, activeTask, needsReview, completedToday, backlog } = data;

  // Build status line
  let statusLine = '';
  if (activeTask) {
    statusLine = `Working: ${activeTask.title}`;
  } else if (needsReview > 0) {
    statusLine = `${needsReview} item${needsReview > 1 ? 's' : ''} need your review`;
  } else if (completedToday > 0) {
    statusLine = `${completedToday} completed today`;
  } else if (backlog > 0) {
    statusLine = `${backlog} tasks queued`;
  } else {
    statusLine = 'No active work';
  }

  return (
    <div className={`bg-card border rounded-lg hover:border-accent/20 transition-colors ${needsReview > 0 ? 'border-warning/30' : 'border-border'}`}>
      <div className="px-4 py-3 cursor-pointer" onClick={onNavigate}>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            activeTask ? 'bg-success animate-pulse' :
            needsReview > 0 ? 'bg-warning' : 'bg-vmuted'
          }`} />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-text">{project.name}</span>
            <p className="text-[11px] text-muted mt-0.5">{statusLine}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={e => { e.stopPropagation(); onChat(); }}
              className="px-2 py-1 text-[10px] text-muted hover:text-accent border border-border rounded transition-colors"
              title="Chat with PM agent">
              Chat
            </button>
            <span className="text-vmuted text-xs">→</span>
          </div>
        </div>
      </div>
    </div>
  );
}
