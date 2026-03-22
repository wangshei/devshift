import React from 'react';
import { useApi } from '../hooks/useApi';

export default function CreditGauge() {
  const { data: credits } = useApi('/credits');

  if (!credits) return null;

  const used = credits.usedPercent || 0;
  const reserved = credits.reservedPercent || 0;
  const available = credits.availablePercent || 0;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted font-mono">Credits</span>
      <div className="flex-1 h-2 bg-border rounded-full overflow-hidden flex">
        <div className="bg-accent h-full transition-all" style={{ width: `${used}%` }} />
        <div className="bg-vmuted h-full transition-all" style={{ width: `${reserved}%` }} />
        <div className="bg-success/40 h-full transition-all" style={{ width: `${available}%` }} />
      </div>
      <span className="text-xs font-mono text-muted">{100 - used}%</span>
    </div>
  );
}
