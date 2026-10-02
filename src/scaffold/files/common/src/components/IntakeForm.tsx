'use client';

/* THE INTAKE FORM, built from the pack's own field list. Both views mount this one form, so a
 * typed draft, a chosen file and the answer to every question survive a view switch.
 *
 * A file sent earlier stays attached to its row as { upload: <id> }. Removing a row moves its file
 * with it. A newly chosen file goes up as upload:<slot>:<row>. */
import { useState, type ReactNode } from 'react';
import type { PublicOrder } from 'complyrail';
import { MIME_NAMES, sentenceCase, type FieldInfo, type PackInfo } from '@/lib/pack-types';
import { useViewState } from './state';

type Row = Record<string, unknown>;
type Kept = { upload: string; name?: string };

function emptyRow(fields: FieldInfo[]): Row {
  const row: Row = {};
  for (const f of fields) if (f.type === 'list') row[f.name] = Array.from({ length: Math.max(1, f.min ?? 0) }, () => emptyRow(f.of ?? []));
  return row;
}

/* The form as the buyer last sent it, with each earlier upload attached to the row that holds it. */
function initialValues(info: PackInfo, order: PublicOrder): Row {
  const base: Row = order.form ? JSON.parse(JSON.stringify(order.form)) : emptyRow(info.fields);
  const attach = (fields: FieldInfo[], row: Row, item: number) => {
    for (const f of fields) {
      if (f.type === 'list' && Array.isArray(row[f.name])) (row[f.name] as Row[]).forEach((r, i) => attach(f.of ?? [], r, i));
      if (f.type === 'file') {
        const u = order.uploads.find((x) => x.slot === f.slot && x.item === item);
        if (u) row[f.name] = { upload: u.id, name: u.name } satisfies Kept;
      }
    }
  };
  attach(info.fields, base, 0);
  return base;
}

const label = (f: FieldInfo) => sentenceCase(f.label || f.name);

export default function IntakeForm({
  info,
  order,
  variant,
  onSent,
}: {
  info: PackInfo;
  order: PublicOrder;
  variant: 'console' | 'simple';
  onSent: (o: PublicOrder) => void;
}) {
  const [values, setValues] = useViewState<Row>(`form:${order.token}`, initialValues(info, order));
  const [files, setFiles] = useViewState<Record<string, File>>(`files:${order.token}`, {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cls = variant === 'console' ? 'cx' : 'sx';

  const setAt = (path: Array<string | number>, value: unknown) => {
    setValues((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Row;
      let cur: Record<string | number, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] as Record<string | number, unknown>;
      cur[path[path.length - 1]] = value;
      return next;
    });
  };

  function renderField(f: FieldInfo, row: Row, path: Array<string | number>, item: number): ReactNode {
    const id = `f-${[...path, f.name].join('-')}`;
    const v = row[f.name];
    const help = f.help ? <span className={`${cls}-help`}>{f.help}</span> : null;
    switch (f.type) {
      case 'list': {
        const rows = (Array.isArray(v) ? v : []) as Row[];
        return (
          <fieldset key={id} className={`${cls}-group`}>
            <legend>{label(f)}</legend>
            {help}
            {rows.map((r, i) => (
              <div key={i} className={`${cls}-row`}>
                <div className={`${cls}-row-head`}>
                  <span>
                    {label(f)} {i + 1}
                  </span>
                  {rows.length > (f.min ?? 0) ? (
                    <button type="button" onClick={() => setAt([...path, f.name], rows.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  ) : null}
                </div>
                {(f.of ?? []).map((sub) => renderField(sub, r, [...path, f.name, i], i))}
              </div>
            ))}
            {rows.length < (f.max ?? 50) ? (
              <button type="button" className={`${cls}-add`} onClick={() => setAt([...path, f.name], [...rows, emptyRow(f.of ?? [])])}>
                Add another
              </button>
            ) : null}
          </fieldset>
        );
      }
      case 'file': {
        const key = `${f.slot}:${item}`;
        const kept = v && typeof v === 'object' && 'upload' in (v as Kept) ? (v as Kept) : null;
        const accept = info.documents.find((d) => d.slot === f.slot)?.mime ?? [];
        return (
          <div key={id} className={`${cls}-field`}>
            <label htmlFor={id}>
              {label(f)}
              {f.required ? '' : ' (optional)'}
            </label>
            {help}
            {kept && !files[key] ? <span className={`${cls}-kept`}>On file: {kept.name}. Choose a file only to replace it.</span> : null}
            <input
              id={id}
              type="file"
              accept={accept.join(',')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                setFiles((prev) => {
                  const next = { ...prev };
                  if (file) next[key] = file;
                  else delete next[key];
                  return next;
                });
              }}
            />
            <span className={`${cls}-help`}>{accept.map((m) => MIME_NAMES[m] ?? m).join(', ')}</span>
          </div>
        );
      }
      case 'checkbox':
        return (
          <label key={id} className={`${cls}-check`}>
            <input type="checkbox" checked={v === true} onChange={(e) => setAt([...path, f.name], e.target.checked)} />
            <span>{label(f)}</span>
          </label>
        );
      case 'select':
        return (
          <fieldset key={id} className={`${cls}-choice`}>
            <legend>{label(f)}</legend>
            {(f.options ?? []).map((o) => {
              const value = typeof o === 'string' ? o : o.value;
              const text = typeof o === 'string' ? o : o.label;
              return (
                <label key={value}>
                  <input type="radio" name={id} value={value} checked={v === value} onChange={() => setAt([...path, f.name], value)} />
                  <span>{text}</span>
                </label>
              );
            })}
          </fieldset>
        );
      case 'textarea':
        return (
          <div key={id} className={`${cls}-field`}>
            <label htmlFor={id}>
              {label(f)}
              {f.required ? '' : ' (optional)'}
            </label>
            {help}
            <textarea id={id} rows={4} maxLength={f.max} value={String(v ?? '')} onChange={(e) => setAt([...path, f.name], e.target.value)} />
          </div>
        );
      default:
        return (
          <div key={id} className={`${cls}-field`}>
            <label htmlFor={id}>
              {label(f)}
              {f.required ? '' : ' (optional)'}
            </label>
            {help}
            <input
              id={id}
              type={f.type === 'email' ? 'email' : 'text'}
              inputMode={f.type === 'number' || f.type === 'integer' ? 'numeric' : undefined}
              maxLength={f.max}
              value={String(v ?? '')}
              onChange={(e) => setAt([...path, f.name], e.target.value)}
            />
          </div>
        );
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('answers', JSON.stringify(values));
      for (const [key, file] of Object.entries(files)) body.append(`upload:${key}`, file);
      const r = await fetch(`/api/order/${order.token}/intake`, { method: 'POST', body });
      const d = (await r.json().catch(() => ({}))) as { order?: PublicOrder; error?: string };
      if (!r.ok || !d.order) throw new Error(d.error || 'Your answers could not be saved. Send the form again.');
      setFiles({});
      onSent(d.order);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`${cls}-form`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit();
      }}
    >
      {info.fields.map((f) => renderField(f, values, [], 0))}
      {error ? (
        <p className={`${cls}-error`} role="alert">
          {error}
        </p>
      ) : null}
      <button className={`${cls}-primary`} type="submit" disabled={busy}>
        {busy ? 'Sending' : order.form ? 'Send the corrected form' : 'Send the form'}
      </button>
    </form>
  );
}
