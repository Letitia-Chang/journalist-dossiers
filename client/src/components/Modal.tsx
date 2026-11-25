import { useEffect, useRef, type ReactNode } from 'react';

/** A dialog over the page: Escape or a click outside closes it, and focus goes in and comes back. */
export default function Modal({ label, onClose, className = '', children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, select, textarea') ?? [])];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab') return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className={`bg-white rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden focus:outline-none ${className}`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
