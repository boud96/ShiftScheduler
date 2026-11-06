import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { planPaste } from '../../clipboard/tsv';
import type { PastePlan } from '../../clipboard/tsv';
import { shortDate } from '../../domain/format';
import type { AppData, ISODate, MonthKey, PersonId } from '../../domain/types';
import { MONTH_SCREEN } from '../text';

/** Where the first pasted cell goes: a person of the month grid, and a day. */
export interface PasteStart {
  personId: PersonId;
  /** The name of that person, as the grid shows it. */
  name: string;
  date: ISODate;
}

interface PasteDialogProps {
  data: AppData;
  month: MonthKey;
  start: PasteStart;
  /** Použít: `plan` is what the text comes to, and has something to store. */
  onApply(plan: PastePlan): void;
  /** Zrušit or Escape: nothing is stored. */
  onClose(): void;
}

/**
 * The dialog that takes cells copied from Excel. A preview under the field tells how many cells
 * are recognised and lists the values that are not, so the user sees what Použít would do before
 * it does it. It stores nothing itself: `onApply` is given the plan.
 *
 * It is a dialog on the page, like the question of the save bar: the focus goes into the field and
 * stays within the dialog, a click on the page behind or on the text does not take it away, and
 * Escape and Zrušit close it.
 */
export function PasteDialog({ data, month, start, onApply, onClose }: PasteDialogProps) {
  const { paste } = MONTH_SCREEN;
  const titleId = useId();
  const startId = useId();
  const areaId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  const { personId, date } = start;
  const plan = useMemo(
    () => planPaste(data, month, { personId, date }, text),
    [data, month, personId, date, text],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') onClose();
    if (e.key !== 'Tab') return;
    // Tab goes round the dialog: from the last control to the first, and with Shift from the first
    // to the last. The stops in between are the browser's, and Použít is one only while it is on.
    const edge = e.shiftKey ? area : cancel;
    if (document.activeElement !== edge.current) return;
    e.preventDefault();
    (e.shiftKey ? cancel : area).current?.focus();
  };

  // A click on the page behind or on the text must not take the focus out of the dialog. The field
  // and the buttons are left alone: a click on them is how they get the focus.
  const keepFocus = (e: MouseEvent<HTMLElement>) => {
    if (!(e.target instanceof HTMLButtonElement || e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
    }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={onKeyDown} onMouseDown={keepFocus}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={startId}
        className="dialog paste-dialog"
      >
        <h2 id={titleId}>{paste.title}</h2>
        <p id={startId}>{paste.start(start.name, shortDate(start.date))}</p>
        <label htmlFor={areaId}>{paste.area}</label>
        <textarea
          id={areaId}
          ref={area}
          autoFocus
          className="paste-area"
          rows={8}
          wrap="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {/* A live region, so that the count is read out when the text changes. */}
        <div role="status">
          <p>{paste.summary(plan.writes.length, plan.ignored.length)}</p>
          {plan.namesColumn && <p>{paste.namesColumn}</p>}
        </div>
        {plan.ignored.length > 0 && (
          <ul className="paste-ignored">
            {plan.ignored.map(({ row, col, value }) => (
              <li key={`${row}-${col}`}>{paste.ignoredValue(value, row + 1, col + 1)}</li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={plan.writes.length === 0}
            onClick={() => onApply(plan)}
          >
            {paste.apply}
          </button>
          <button type="button" className="button" ref={cancel} onClick={onClose}>
            {paste.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
