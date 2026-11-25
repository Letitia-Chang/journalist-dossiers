import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CompanyProfile, NewsworthyItem, PressCoverageLink, Spokesperson } from '../types';

type Errors = Record<string, string>;

interface Props {
  value: CompanyProfile;
  onChange: (next: CompanyProfile) => void;
  errors?: Errors;
  readOnly?: boolean;
}

/** Drop blank rows/entries before saving so the server's strict validation only sees real data. */
export function cleanProfile(p: CompanyProfile): CompanyProfile {
  const list = (xs: string[]) => xs.map(x => x.trim()).filter(Boolean);
  return {
    ...p,
    regions: list(p.regions),
    key_messages: list(p.key_messages),
    competitors: list(p.competitors),
    newsworthy_items: p.newsworthy_items.filter(n => n.title.trim()),
    press_coverage: p.press_coverage.filter(c => c.url.trim()),
    spokespeople: p.spokespeople
      .filter(s => s.name.trim())
      .map(s => ({ ...s, topics: list(s.topics) })),
  };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {hint && <p className="text-xs text-slate-500 mt-0.5 mb-3">{hint}</p>}
      <div className={`space-y-4 ${hint ? '' : 'mt-3'}`}>{children}</div>
    </section>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function StringList({ items, onChange, placeholder, readOnly, addLabel }: {
  items: string[]; onChange: (next: string[]) => void; placeholder: string; readOnly?: boolean; addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <input
            className="form-input"
            value={item}
            placeholder={placeholder}
            disabled={readOnly}
            onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {!readOnly && (
            <button type="button" className="p-2 text-slate-400 hover:text-red-500" title="Remove"
              onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="btn-secondary py-1 px-2.5 text-xs" onClick={() => onChange([...items, ''])}>
          <Plus className="w-3 h-3" /> {addLabel}
        </button>
      )}
    </div>
  );
}

const ITEM_TYPES: NewsworthyItem['type'][] = ['launch', 'funding', 'research', 'hire', 'other'];

export default function CompanyProfileForm({ value: p, onChange, errors = {}, readOnly }: Props) {
  const set = <K extends keyof CompanyProfile>(key: K, v: CompanyProfile[K]) => onChange({ ...p, [key]: v });
  const text = (key: keyof CompanyProfile, extra?: { rows?: number; placeholder?: string }) => {
    const common = {
      value: p[key] as string,
      disabled: readOnly,
      placeholder: extra?.placeholder,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value as never),
    };
    return extra?.rows
      ? <textarea className="form-input" rows={extra.rows} {...common} />
      : <input className="form-input" {...common} />;
  };

  const updateAt = <T,>(key: 'newsworthy_items' | 'press_coverage' | 'spokespeople', i: number, patch: Partial<T>) =>
    set(key, (p[key] as unknown as T[]).map((x, j) => (j === i ? { ...x, ...patch } : x)) as never);
  const removeAt = (key: 'newsworthy_items' | 'press_coverage' | 'spokespeople', i: number) =>
    set(key, (p[key] as unknown[]).filter((_, j) => j !== i) as never);

  return (
    <div className="space-y-5">
      <Section title="The basics" hint="Everything the AI knows about your company comes from this profile.">
        <Field label="Company name *" error={errors.name}>{text('name', { placeholder: 'Acme Robotics' })}</Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Website" error={errors.website}>{text('website', { placeholder: 'https://example.com' })}</Field>
          <Field label="Industry" error={errors.industry}>{text('industry', { placeholder: 'Climate tech, fintech, health…' })}</Field>
        </div>
        <Field label="One-liner" hint="One sentence a journalist would understand." error={errors.one_liner}>
          {text('one_liner', { placeholder: 'We build …' })}
        </Field>
      </Section>

      <Section title="What you offer and who it's for">
        <Field label="Products and services" error={errors.products}>{text('products', { rows: 3 })}</Field>
        <Field label="Target audience" hint="Who benefits? Who do you want to reach through the press?" error={errors.target_audience}>
          {text('target_audience', { rows: 2 })}
        </Field>
        <Field label="Regions" hint="Where you operate or want coverage.">
          <StringList items={p.regions} onChange={v => set('regions', v)} placeholder="e.g. Pacific Northwest, EU" readOnly={readOnly} addLabel="Add region" />
        </Field>
      </Section>

      <Section title="Your story" hint="Pitches are built from these angles and news items.">
        <Field label="Key messages and story angles">
          <StringList items={p.key_messages} onChange={v => set('key_messages', v)} placeholder="e.g. Cuts grid-connection wait times from years to months" readOnly={readOnly} addLabel="Add angle" />
        </Field>

        <Field label="Recent newsworthy items" hint="Launches, funding, research, hires.">
          <div className="space-y-3">
            {p.newsworthy_items.map((n, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <select className="form-input sm:col-span-3" value={n.type} disabled={readOnly}
                    onChange={e => updateAt<NewsworthyItem>('newsworthy_items', i, { type: e.target.value as NewsworthyItem['type'] })}>
                    {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input className="form-input sm:col-span-6" placeholder="Title" value={n.title} disabled={readOnly}
                    onChange={e => updateAt<NewsworthyItem>('newsworthy_items', i, { title: e.target.value })} />
                  <input className="form-input sm:col-span-3" placeholder="Date" value={n.date} disabled={readOnly}
                    onChange={e => updateAt<NewsworthyItem>('newsworthy_items', i, { date: e.target.value })} />
                </div>
                <input className="form-input" placeholder="Description" value={n.description} disabled={readOnly}
                  onChange={e => updateAt<NewsworthyItem>('newsworthy_items', i, { description: e.target.value })} />
                <div className="flex gap-2">
                  <input className="form-input" placeholder="Link (optional)" value={n.url} disabled={readOnly}
                    onChange={e => updateAt<NewsworthyItem>('newsworthy_items', i, { url: e.target.value })} />
                  {!readOnly && (
                    <button type="button" className="p-2 text-slate-400 hover:text-red-500" title="Remove" onClick={() => removeAt('newsworthy_items', i)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {errors[`newsworthy_items.${i}.url`] && <p className="text-xs text-red-600">{errors[`newsworthy_items.${i}.url`]}</p>}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="btn-secondary py-1 px-2.5 text-xs"
                onClick={() => set('newsworthy_items', [...p.newsworthy_items, { type: 'launch', title: '', date: '', description: '', url: '' }])}>
                <Plus className="w-3 h-3" /> Add item
              </button>
            )}
          </div>
        </Field>

        <Field label="Competitors / similar companies" hint="Used to spot journalists who already cover your space.">
          <StringList items={p.competitors} onChange={v => set('competitors', v)} placeholder="Company name" readOnly={readOnly} addLabel="Add competitor" />
        </Field>
      </Section>

      <Section title="Press and people">
        <Field label="Existing press coverage">
          <div className="space-y-2">
            {p.press_coverage.map((c: PressCoverageLink, i) => (
              <div key={i}>
                <div className="flex gap-2">
                  <input className="form-input w-1/3" placeholder="Title (optional)" value={c.title} disabled={readOnly}
                    onChange={e => updateAt<PressCoverageLink>('press_coverage', i, { title: e.target.value })} />
                  <input className="form-input" placeholder="https://…" value={c.url} disabled={readOnly}
                    onChange={e => updateAt<PressCoverageLink>('press_coverage', i, { url: e.target.value })} />
                  {!readOnly && (
                    <button type="button" className="p-2 text-slate-400 hover:text-red-500" title="Remove" onClick={() => removeAt('press_coverage', i)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {errors[`press_coverage.${i}.url`] && <p className="text-xs text-red-600 mt-1">{errors[`press_coverage.${i}.url`]}</p>}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="btn-secondary py-1 px-2.5 text-xs"
                onClick={() => set('press_coverage', [...p.press_coverage, { title: '', url: '' }])}>
                <Plus className="w-3 h-3" /> Add link
              </button>
            )}
          </div>
        </Field>

        <Field label="Spokespeople" hint="The pitch names the one whose topics best match the journalist.">
          <div className="space-y-2">
            {p.spokespeople.map((s: Spokesperson, i) => (
              <div key={i}>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input className="form-input sm:col-span-3" placeholder="Name" value={s.name} disabled={readOnly}
                    onChange={e => updateAt<Spokesperson>('spokespeople', i, { name: e.target.value })} />
                  <input className="form-input sm:col-span-3" placeholder="Title" value={s.title} disabled={readOnly}
                    onChange={e => updateAt<Spokesperson>('spokespeople', i, { title: e.target.value })} />
                  <input className="form-input sm:col-span-5" placeholder="Topics, comma separated" value={s.topics.join(', ')} disabled={readOnly}
                    onChange={e => updateAt<Spokesperson>('spokespeople', i, { topics: e.target.value.split(',').map(t => t.trimStart()) })} />
                  {!readOnly && (
                    <button type="button" className="sm:col-span-1 text-slate-400 hover:text-red-500" title="Remove" onClick={() => removeAt('spokespeople', i)}>
                      <Trash2 className="w-4 h-4 mx-auto" />
                    </button>
                  )}
                </div>
                {errors[`spokespeople.${i}.name`] && <p className="text-xs text-red-600 mt-1">{errors[`spokespeople.${i}.name`]}</p>}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="btn-secondary py-1 px-2.5 text-xs"
                onClick={() => set('spokespeople', [...p.spokespeople, { name: '', title: '', topics: [] }])}>
                <Plus className="w-3 h-3" /> Add spokesperson
              </button>
            )}
          </div>
        </Field>
      </Section>

      <Section title="Voice">
        <Field label="Pitch tone" hint="e.g. warm and concise, no buzzwords." error={errors.pitch_tone}>{text('pitch_tone', { rows: 2 })}</Field>
        <Field label="Email signature" hint="Added to the end of every pitch draft." error={errors.email_signature}>{text('email_signature', { rows: 3 })}</Field>
      </Section>

      <Section title="Branding" hint="Shown in the sidebar, login screen and browser tab.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="App name" error={errors.app_name}>{text('app_name', { placeholder: 'Press Dossier' })}</Field>
          <Field label="Logo URL" error={errors.logo_url}>{text('logo_url', { placeholder: 'https://…/logo.png' })}</Field>
          <Field label="Brand color" error={errors.brand_color}>
            <div className="flex gap-2">
              <input type="color" className="h-9 w-12 rounded border border-slate-200 bg-white p-1" value={/^#[0-9a-f]{6}$/i.test(p.brand_color) ? p.brand_color : '#4f46e5'}
                disabled={readOnly} onChange={e => set('brand_color', e.target.value)} />
              <input className="form-input" value={p.brand_color} disabled={readOnly} onChange={e => set('brand_color', e.target.value)} />
            </div>
          </Field>
        </div>
      </Section>
    </div>
  );
}
