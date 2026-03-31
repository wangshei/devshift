import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';

const STATUS_COLORS = {
  done: { bg: 'bg-success/12', border: 'border-success/40', text: 'text-success', line: '#22c55e' },
  complete: { bg: 'bg-success/12', border: 'border-success/40', text: 'text-success', line: '#22c55e' },
  in_progress: { bg: 'bg-accent/12', border: 'border-accent/40', text: 'text-accent', line: '#3b82f6' },
  active: { bg: 'bg-accent/12', border: 'border-accent/40', text: 'text-accent', line: '#3b82f6' },
  needs_review: { bg: 'bg-warning/12', border: 'border-warning/40', text: 'text-warning', line: '#eab308' },
  review: { bg: 'bg-warning/12', border: 'border-warning/40', text: 'text-warning', line: '#eab308' },
  idea: { bg: 'bg-border/30', border: 'border-border', text: 'text-muted', line: '#6b6b80' },
  planned: { bg: 'bg-border/30', border: 'border-border', text: 'text-muted', line: '#6b6b80' },
};

function getColors(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.planned;
}

function statusLabel(status) {
  const labels = { done: 'Complete', complete: 'Complete', in_progress: 'In Progress', active: 'Active', needs_review: 'Needs Review', review: 'Review', idea: 'Planned', planned: 'Planned' };
  return labels[status] || status;
}

function GoalCard({ goal }) {
  const colors = getColors(goal.status);
  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-4 w-64 shrink-0`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-text leading-snug">{goal.title}</h3>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${colors.text} ${colors.bg} shrink-0`}>
          {statusLabel(goal.status)}
        </span>
      </div>
      {goal.description && (
        <p className="text-xs text-muted mb-2 line-clamp-2">{goal.description}</p>
      )}
      {(goal.metric || goal.target_value) && (
        <div className="flex items-center gap-2 text-xs">
          {goal.metric && <span className="text-vmuted font-mono">{goal.metric}</span>}
          {goal.target_value && (
            <span className={`font-mono ${colors.text}`}>
              {goal.current_value || '—'} / {goal.target_value}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function FeatureCard({ feature, onClick }) {
  const colors = getColors(feature.status);
  const progress = feature.tasks_total > 0 ? Math.round((feature.tasks_done / feature.tasks_total) * 100) : 0;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border ${colors.border} ${colors.bg} p-3 w-52 shrink-0 cursor-pointer hover:scale-[1.02] transition-transform`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-xs font-medium text-text leading-snug">{feature.title}</h4>
        <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${colors.text} shrink-0`}>
          {statusLabel(feature.status)}
        </span>
      </div>
      {feature.tasks_total > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-muted mb-1">
            <span>{feature.tasks_done}/{feature.tasks_total} tasks</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="h-1.5 bg-bg rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                backgroundColor: getColors(feature.status).line,
              }}
            />
          </div>
        </div>
      )}
      {feature.tasks_total === 0 && (
        <p className="text-[10px] text-vmuted mt-1">No tasks yet</p>
      )}
    </div>
  );
}

function ConnectorLines({ goalRefs, featureRefs, tree }) {
  const [lines, setLines] = useState([]);
  const containerRef = useRef(null);

  useEffect(() => {
    const draw = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newLines = [];

      for (const { goal, features } of tree) {
        const goalEl = goalRefs.current[goal.id];
        if (!goalEl) continue;
        const goalRect = goalEl.getBoundingClientRect();
        const gx = goalRect.left + goalRect.width / 2 - containerRect.left;
        const gy = goalRect.bottom - containerRect.top;

        for (const feat of features) {
          const featEl = featureRefs.current[feat.id];
          if (!featEl) continue;
          const featRect = featEl.getBoundingClientRect();
          const fx = featRect.left + featRect.width / 2 - containerRect.left;
          const fy = featRect.top - containerRect.top;
          newLines.push({ x1: gx, y1: gy, x2: fx, y2: fy, color: getColors(goal.status).line });
        }
      }
      setLines(newLines);
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [tree, goalRefs, featureRefs]);

  return (
    <svg
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      {lines.map((l, i) => {
        const midY = l.y1 + (l.y2 - l.y1) / 2;
        return (
          <path
            key={i}
            d={`M ${l.x1} ${l.y1} C ${l.x1} ${midY}, ${l.x2} ${midY}, ${l.x2} ${l.y2}`}
            fill="none"
            stroke={l.color}
            strokeWidth="1.5"
            opacity="0.4"
          />
        );
      })}
    </svg>
  );
}

export default function ProductMap() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: goals, loading: goalsLoading } = useApi(`/product/${id}/goals`, [id]);
  const { data: features, loading: featuresLoading } = useApi(`/product/${id}/features`, [id]);

  const goalRefs = useRef({});
  const featureRefs = useRef({});
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);

  const tree = useMemo(() => {
    if (!goals || !features) return [];
    const grouped = [];
    const usedFeatures = new Set();

    for (const goal of goals) {
      const goalFeatures = features.filter(f => f.goal_id === goal.id);
      goalFeatures.forEach(f => usedFeatures.add(f.id));
      grouped.push({ goal, features: goalFeatures });
    }

    // Features without a goal get a virtual "Ungrouped" node
    const ungrouped = features.filter(f => !usedFeatures.has(f.id));
    if (ungrouped.length > 0) {
      grouped.push({
        goal: { id: '__ungrouped', title: 'Ungrouped Features', status: 'planned', description: 'Features not linked to a goal' },
        features: ungrouped,
      });
    }
    return grouped;
  }, [goals, features]);

  useEffect(() => {
    if (tree.length > 0) {
      const timer = setTimeout(() => setReady(true), 50);
      return () => clearTimeout(timer);
    }
  }, [tree]);

  const loading = goalsLoading || featuresLoading;

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-border/30 rounded w-48" />
          <div className="h-40 bg-border/20 rounded-xl" />
        </div>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-text mb-4">Product Map</h1>
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-muted text-sm">No goals or features yet.</p>
          <p className="text-vmuted text-xs mt-1">Add goals and features from the project page to see them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-text">Product Map</h1>
        <div className="flex items-center gap-3 text-[10px] text-vmuted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Complete</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent" /> In Progress</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Review</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted" /> Planned</span>
        </div>
      </div>

      <div ref={containerRef} className="relative">
        {ready && (
          <ConnectorLines
            goalRefs={goalRefs}
            featureRefs={featureRefs}
            tree={tree}
          />
        )}

        <div className="space-y-10">
          {tree.map(({ goal, features: goalFeatures }) => (
            <div key={goal.id} className="flex flex-col items-center">
              {/* Goal card */}
              <div ref={el => { goalRefs.current[goal.id] = el; }}>
                <GoalCard goal={goal} />
              </div>

              {/* Connector gap */}
              <div className="h-8" />

              {/* Feature cards */}
              {goalFeatures.length > 0 && (
                <div className="flex flex-wrap justify-center gap-4">
                  {goalFeatures.map(feat => (
                    <div key={feat.id} ref={el => { featureRefs.current[feat.id] = el; }}>
                      <FeatureCard
                        feature={feat}
                        onClick={() => navigate(`/project/${id}?feature=${feat.id}`)}
                      />
                    </div>
                  ))}
                </div>
              )}

              {goalFeatures.length === 0 && (
                <p className="text-xs text-vmuted">No features linked</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
