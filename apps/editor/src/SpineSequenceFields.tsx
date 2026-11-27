import { useState } from 'react';
import { readSpineSequence, type SpineAttachment, type SpineSequence } from '@olivestudio/engine/spine-format';
import { t } from './i18n';
import { validationMessage } from './scene';

const fields = ['start', 'digits', 'count', 'setup'] as const;

export function SpineSequenceFields({ attachment, name, disabled, change, report }: {
  attachment: SpineAttachment; name: string; disabled: boolean;
  change: (prefix?: string, sequence?: SpineSequence) => boolean; report: (message: string) => void;
}) {
  const path = String(attachment.path ?? attachment.name ?? name);
  const [open, setOpen] = useState(attachment.sequence !== undefined);
  const suffix = path.match(/\d+$/)?.[0];
  let sequence: SpineSequence | undefined;
  try { if (attachment.sequence !== undefined) sequence = readSpineSequence(attachment.sequence); }
  catch { /* Keep the form available to repair an invalid sequence. */ }
  const defaults = sequence ?? { start: suffix ? Number(suffix) : 1, digits: suffix?.length ?? 0, count: 1, setup: 0 };
  const prefix = attachment.sequence !== undefined ? path : suffix ? path.slice(0, -suffix.length) : path;
  if (!open) return <button type="button" className="bundle-command" disabled={disabled}
    onClick={() => setOpen(true)}>{t('spineAddSequence')}</button>;
  return <form className="spine-key" key={JSON.stringify([path, sequence])} onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const next = readSpineSequence({ ...sequence, ...Object.fromEntries(fields.map(key => [key, Number(form.get(key))])) });
      change(String(form.get('prefix')), next);
    } catch (error) { report(validationMessage(error)); }
  }}>
    <fieldset className="spine-key" disabled={disabled}>
      <legend>{t('spineImageSequence')}</legend>
      <label>{t('spineSequencePrefix')}<input name="prefix" defaultValue={prefix} /></label>
      {fields.map(key => <label key={key}>{t(`spineSequence_${key}`)}
        <input type="number" step={1} min={key === 'count' ? 1 : 0} required name={key} defaultValue={defaults[key]} />
      </label>)}
      <button type="submit" className="bundle-command">{t('spineApplySequence')}</button>
      {sequence ? <button type="button" className="bundle-command" onClick={() => {
        if (change()) setOpen(false);
      }}>{t('spineRemoveSequence')}</button> : <button type="button" className="bundle-command"
        onClick={() => setOpen(false)}>{t('cancel')}</button>}
    </fieldset>
  </form>;
}
