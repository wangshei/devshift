import React from 'react';

export default function ProviderStatus({ provider, onToggle }) {
  const isRateLimited = provider.rate_limited_until && new Date(provider.rate_limited_until) > new Date();

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-lg">
      <div className={`w-2 h-2 rounded-full ${
        isRateLimited ? 'bg-error' :
        provider.enabled ? 'bg-success' : 'bg-vmuted'
      }`} />
      <div className="flex-1">
        <span className="text-sm text-text">{provider.name}</span>
        <span className="text-xs text-vmuted ml-2 font-mono">{provider.cli_command}</span>
        {provider.plan_tier && (
          <span className="text-xs text-muted ml-2">({provider.plan_tier})</span>
        )}
        {provider.id === 'cursor' && (
          <span className="text-xs text-error ml-2">(not yet supported)</span>
        )}
        {isRateLimited && (
          <span className="text-xs text-error ml-2">Rate limited</span>
        )}
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={!!provider.enabled}
          onChange={onToggle}
          className="sr-only peer"
        />
        <div className="w-8 h-4 bg-border peer-checked:bg-accent rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-3 after:h-3 after:bg-text after:rounded-full after:transition-all peer-checked:after:translate-x-4" />
      </label>
    </div>
  );
}
