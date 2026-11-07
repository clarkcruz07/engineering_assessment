import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const ICON: Record<Tone, string> = { success: '✓', warning: '!', danger: '✕', info: 'i', neutral: '•' };

/** Status is always conveyed by text; colour and icon only reinforce it. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}><span className="pill-icon" aria-hidden="true">{ICON[tone]}</span>{children}</span>;
}

export function Notice({ tone, title, children, action }: { tone: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">{ICON[tone]}</span>
      <div className="notice-body">
        <strong>{title}</strong>
        {children && <div className="notice-text">{children}</div>}
        {action && <div className="notice-action">{action}</div>}
      </div>
    </div>
  );
}

export function Section({ title, description, actions, children, id }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card" aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="card-header">
        <div>
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          {description && <p className="card-description">{description}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Spinner({ label }: { label: string }) {
  return <span className="spinner-wrap" role="status"><span className="spinner" aria-hidden="true" />{label}</span>;
}
