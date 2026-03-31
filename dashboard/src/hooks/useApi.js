import { useState, useEffect, useCallback, useRef } from 'react';

const BASE = '/api';

export function useApi(path, deps, pollInterval = 0) {
  if (!Array.isArray(deps)) deps = [];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const dataRef = useRef(null);

  const refetch = useCallback(() => {
    setLoading(true);
    fetch(`${BASE}${path}`)
      .then(r => r.json())
      .then(d => { dataRef.current = d; setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, ...deps]);

  useEffect(() => { refetch(); }, [refetch]);

  // Silent poll (no loading flash)
  useEffect(() => {
    if (!pollInterval) return;
    const id = setInterval(() => {
      fetch(`${BASE}${path}`)
        .then(r => r.json())
        .then(d => { dataRef.current = d; setData(d); })
        .catch(() => {});
    }, pollInterval);
    return () => clearInterval(id);
  }, [path, pollInterval]);

  return { data, loading, error, refetch };
}

export async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}
