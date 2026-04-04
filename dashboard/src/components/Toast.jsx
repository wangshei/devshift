import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    timers.current[id] = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      delete timers.current[id];
    }, 3000);
    return id;
  }, []);

  const toast = useCallback((message) => addToast(message, 'info'), [addToast]);
  toast.success = useCallback((message) => addToast(message, 'success'), [addToast]);
  toast.error = useCallback((message) => addToast(message, 'error'), [addToast]);
  toast.warning = useCallback((message) => addToast(message, 'warning'), [addToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg animate-toast-in ${
              t.type === 'success' ? 'bg-success text-white' :
              t.type === 'error' ? 'bg-error text-white' :
              t.type === 'warning' ? 'bg-warning text-bg' :
              'bg-card text-text border border-border'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
