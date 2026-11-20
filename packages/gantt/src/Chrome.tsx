/** Context menu and legend. */
import { useEffect, useRef } from 'react';
import type { Translate } from './i18n.js';

export interface MenuItem { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1e4) - 220);
  const top = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 1e4) - items.length * 32 - 16);
  return (
    <div ref={ref} className="nm-menu" role="menu" style={{ left, top }}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" disabled={it.disabled} className={it.danger ? 'danger' : ''}
          onClick={() => { onClose(); it.onSelect(); }}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Legend({ t, showBaseline }: { t: Translate; showBaseline: boolean }) {
  const sw = (cls: string, shape: 'bar' | 'diamond' | 'summary' | 'thin' | 'line' = 'bar') => (
    <svg width="28" height="14" aria-hidden="true">
      {shape === 'bar' && <rect x="1" y="2" width="26" height="10" rx="2" className={cls} />}
      {shape === 'thin' && <rect x="1" y="5" width="26" height="5" className={cls} />}
      {shape === 'line' && <line x1="1" y1="7" x2="27" y2="7" className={cls} />}
      {shape === 'diamond' && <path d="M14 1 L20 7 L14 13 L8 7 Z" className={cls} />}
      {shape === 'summary' && <path d="M1 3 H27 V8 L24 12 L21 8 H7 L4 12 L1 8 Z" className={cls} />}
    </svg>
  );
  return (
    <div className="nm-legend" aria-label="Legend">
      <span>{sw('nm-bar')}{t('legendTask')}</span>
      <span>{sw('nm-bar critical')}<svg width="0" height="0" />{t('legendCritical')}</span>
      <span>{sw('nm-progress')}{t('legendProgress')}</span>
      <span>{sw('nm-summary', 'summary')}{t('legendSummary')}</span>
      <span>{sw('nm-milestone', 'diamond')}{t('legendMilestone')}</span>
      <span>{sw('nm-loe', 'thin')}{t('legendLoe')}</span>
      <span>{sw('nm-float-line', 'line')}{t('legendFloat')}</span>
      {showBaseline && <span>{sw('nm-baseline', 'thin')}{t('legendBaseline')}</span>}
    </div>
  );
}
