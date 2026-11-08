import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  FocusEvent as ReactFocusEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from 'react';
import { CODE_NAMES, Code, TWELVE_CODES, WEEKDAY_CODES } from '../../domain/codes';
import type { CodeInt } from '../../domain/codes';
import { clock } from '../../domain/format';
import type { DoctorNote } from '../../domain/types';
import { MONTH_SCREEN } from '../text';

/** What an item of the menu asks for. */
export type MenuChoice =
  | { type: 'code'; code: CodeInt }
  | { type: 'clear' }
  | { type: 'pin' }
  /** The doctor's note of the cell: a new one, or null to delete the one it has. */
  | { type: 'doctor'; note: DoctorNote | null };

/** The codes that any day offers, after the shifts of its type. */
const OTHER_CODES: readonly CodeInt[] = [Code.DOV, Code.MD, Code.OP, Code.NEM, Code.X];

/** The space between the cell and its menu, and the space kept free at the edge of the window. */
const GAP = 4;
const MARGIN = 8;

/**
 * Minutes from midnight as the `HH:MM` that a time box takes: `clock` with the hour padded to two
 * digits. The box has no 24:00, so the end of the day, which a note can have, is shown as 23:59.
 */
function inputTime(minutes: number): string {
  return clock(Math.min(minutes, 24 * 60 - 1)).padStart(5, '0');
}

/**
 * The minutes from midnight of the `HH:MM` in a time box, or null for a box with no time of the
 * day in it: nothing, an hour past 23, or minutes past 59. A browser gives nothing for a time
 * that is not one, but a note that the reducer would not store must not be sent to it either.
 */
export function minutesOf(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The item that the focus goes to on `key`, from item `at` (-1 if it is on none) of `count`: the
 * arrow keys step and go round, Home and End go to the first and the last. Null for any other key.
 */
function itemAfter(key: string, at: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return (at + 1) % count;
    case 'ArrowUp':
      return at < 0 ? count - 1 : (at - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

interface CellMenuProps {
  /** The button of the cell: a click on it is not one outside the menu, and the focus goes back. */
  anchor: RefObject<HTMLElement | null>;
  /** What the menu is called for the page's readers: the person and the day. */
  label: string;
  /** Which shifts the day takes: the weekday ones, or R12 and N12. */
  dayType: 'weekday' | 'twelve';
  /** Which item to put last: none for a cell that holds no shift. */
  pin: 'pin' | 'unpin' | null;
  /** The doctor's note of the cell, if it has one: it fills the form, and can be removed there. */
  doctor: DoctorNote | null;
  onChoose(choice: MenuChoice): void;
  /** `restoreFocus`: whether the cell is to take the focus again, as it is after the keyboard. */
  onClose(restoreFocus: boolean): void;
}

/**
 * The menu of a cell: the codes that its day takes, the absences and x, `Lékař…`, `Vymazat`, and
 * `Připnout` or `Odepnout` for a shift. `Lékař…` swaps the list for the form of the doctor's note
 * (two times, `Uložit lékaře`, and `Odebrat lékaře` for a cell that has a note). It sits next to
 * the cell, in the window, so that the scrolling box of the grid does not cut it off, and it
 * closes where the page would rather not have it: on Escape and Tab, on a click outside it, and
 * when the page is resized, or scrolled so that its cell moves; the form of the note also when the
 * focus goes to another element. The focus goes into it, and the arrow keys move it. It does not
 * store anything: it says what was chosen.
 */
export function CellMenu(props: CellMenuProps) {
  const { anchor, label, dayType, pin, doctor, onChoose, onClose } = props;
  const box = useRef<HTMLDivElement>(null);
  /** Where the cell was when the menu was put beside it. */
  const placedAt = useRef<{ top: number; left: number } | null>(null);
  /**
   * Whether a button of the mouse is down on the cell, from its press to its release. A button
   * takes the focus when it is pressed, and for the form that is no move out of it: the click on
   * the cell is the cell's own, and closes the menu (`onCell`). See `onDialogBlur`.
   */
  const pressingCell = useRef(false);
  /** Whether the form of the doctor's note has taken the place of the list. */
  const [editingNote, setEditingNote] = useState(false);
  const shifts = dayType === 'weekday' ? WEEKDAY_CODES : TWELVE_CODES;

  /**
   * Puts the menu beside its cell: below it, or above it when there is no room below, and in the
   * window at the sides. It measures the menu as it is now, so it is to be called again when the
   * menu changes its size.
   */
  const place = useCallback(() => {
    const menu = box.current;
    const cell = anchor.current;
    if (menu === null || cell === null) return;
    const at = cell.getBoundingClientRect();
    placedAt.current = { top: at.top, left: at.left };
    const size = menu.getBoundingClientRect();
    const below = at.bottom + GAP;
    const fits = below + size.height <= window.innerHeight - MARGIN;
    const top = fits ? below : Math.max(MARGIN, at.top - GAP - size.height);
    const left = Math.max(MARGIN, Math.min(at.left, window.innerWidth - size.width - MARGIN));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }, [anchor]);

  // Before the page is painted, so that the menu is not seen where it would otherwise be. The form
  // of the note is not the size of the list, and its message makes it taller: it places itself
  // again, as it appears and with each change of the message (`DoctorForm`).
  useLayoutEffect(place, [place]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (anchor.current?.contains(target)) {
        pressingCell.current = true;
        return;
      }
      if (box.current?.contains(target)) return;
      onClose(false);
    };
    const released = () => {
      pressingCell.current = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose(true);
    };
    const resized = () => onClose(false);
    // A scroll that leaves the cell where it was does not matter: one that began before the menu
    // opened is reported after it (a browser reports a scroll on its next frame), and the menu's
    // own scrolling is no reason to close it either.
    const scrolled = () => {
      const cell = anchor.current;
      const origin = placedAt.current;
      if (cell === null || origin === null) return;
      const at = cell.getBoundingClientRect();
      if (Math.abs(at.top - origin.top) > 0.5 || Math.abs(at.left - origin.left) > 0.5) {
        onClose(false);
      }
    };
    // The scroll of any box on the page reaches the window while it is captured.
    document.addEventListener('mousedown', outside);
    document.addEventListener('mouseup', released);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resized);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('mouseup', released);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resized);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [anchor, onClose]);

  const choose = (choice: MenuChoice) => {
    onChoose(choice);
    onClose(true);
  };

  // The focus moving to an element outside the form closes it, and stays where it went. Two moves
  // do not: one to no element, as when another window is switched to (the form is there when it is
  // back), and the one that a press of the mouse on the cell makes, for the click that follows is
  // the cell's own and closes the menu, and a menu closed here would be opened again by it.
  const onDialogBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    const goingTo = e.relatedTarget;
    if (!(goingTo instanceof Node) || e.currentTarget.contains(goingTo)) return;
    if (pressingCell.current && anchor.current?.contains(goingTo)) return;
    onClose(false);
  };

  if (editingNote) {
    return (
      <div ref={box} role="dialog" aria-label={label} className="month-menu" onBlur={onDialogBlur}>
        <DoctorForm
          note={doctor}
          onSave={(note) => choose({ type: 'doctor', note })}
          onRemove={() => choose({ type: 'doctor', note: null })}
          onLeave={() => onClose(true)}
          onResize={place}
        />
      </div>
    );
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault(); // the menu closes, and the focus is back on the cell to go on from
      onClose(true);
      return;
    }
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = itemAfter(e.key, at, items.length);
    if (to === null) return;
    e.preventDefault();
    items[to].focus();
  };

  const codeItem = (code: CodeInt) => (
    <button
      key={code}
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-code={CODE_NAMES[code]}
      onClick={() => choose({ type: 'code', code })}
    >
      {CODE_NAMES[code]}
    </button>
  );

  return (
    <div ref={box} role="menu" aria-label={label} className="month-menu" onKeyDown={onKeyDown}>
      {shifts.map(codeItem)}
      <div role="separator" className="month-menu-separator" />
      {OTHER_CODES.map(codeItem)}
      <div role="separator" className="month-menu-separator" />
      {/* No `choose`: this one opens the form, and the menu stays. */}
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => setEditingNote(true)}>
        {MONTH_SCREEN.menu.doctor}
      </button>
      <div role="separator" className="month-menu-separator" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={() => choose({ type: 'clear' })}
      >
        {MONTH_SCREEN.menu.clear}
      </button>
      {pin !== null && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => choose({ type: 'pin' })}
        >
          {pin === 'pin' ? MONTH_SCREEN.menu.pin : MONTH_SCREEN.menu.unpin}
        </button>
      )}
    </div>
  );
}

interface DoctorFormProps {
  /** The note the cell has now, or null. */
  note: DoctorNote | null;
  /** `Uložit lékaře`, with times that make a note. */
  onSave(note: DoctorNote): void;
  onRemove(): void;
  /** Tab past the last control: the form is to close, and the cell is to take the focus. */
  onLeave(): void;
  /** The form is a different size now, so it is to be put beside the cell again. */
  onResize(): void;
}

/**
 * The form of the doctor's note, in the place of the menu's list: the time the appointment starts
 * and the time it ends, as `<input type="time">`, then `Uložit lékaře` and, for a cell that has
 * a note, `Odebrat lékaře`. A note must start before it ends; if the times do not make one, the
 * form says why and stores nothing. The focus goes to the first box, and Enter in a box stores.
 */
function DoctorForm({ note, onSave, onRemove, onLeave, onResize }: DoctorFormProps) {
  const { doctor } = MONTH_SCREEN;
  const fromId = useId();
  const toId = useId();
  const first = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState(note === null ? '' : inputTime(note.from));
  const [to, setTo] = useState(note === null ? '' : inputTime(note.to));
  /** What is wrong with the times that were sent, until one of them is changed. */
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);

  // The form appears, and its message comes and goes: each changes its height, and a form that
  // was under the cell may no longer fit there (or one that was above it may fit under it).
  useLayoutEffect(() => {
    onResize();
  }, [problem, onResize]);

  const typed = (set: (value: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setProblem(null);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // first: the page has no form to send anywhere
    const start = minutesOf(from);
    const end = minutesOf(to);
    if (start === null || end === null) setProblem(doctor.missing);
    else if (start >= end) setProblem(doctor.order);
    else onSave({ from: start, to: end });
  };

  // Tab past the last control closes the form and gives the focus to the cell, as Tab does in the
  // list. The last control is a button, so the focus on it is the place to leave from. Shift+Tab
  // is the browser's: a time box has parts (the hour, the minute), and Tab and Shift+Tab move
  // between them with the focus staying on the box, so the focus on the first box does not mean
  // that it is on its first part. The move out of the form closes it (`onDialogBlur`).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    const controls = e.currentTarget.querySelectorAll<HTMLElement>('input, button');
    if (document.activeElement !== controls[controls.length - 1]) return;
    e.preventDefault();
    onLeave();
  };

  return (
    <form className="month-doctor-form" noValidate onSubmit={submit} onKeyDown={onKeyDown}>
      <label htmlFor={fromId}>{doctor.from}</label>
      <input id={fromId} ref={first} type="time" value={from} onChange={typed(setFrom)} />
      <label htmlFor={toId}>{doctor.to}</label>
      <input id={toId} type="time" value={to} onChange={typed(setTo)} />
      {problem !== null && (
        <p role="alert" className="month-doctor-problem">
          {problem}
        </p>
      )}
      <div className="month-doctor-actions">
        <button type="submit" className="button button-primary">
          {doctor.save}
        </button>
        {note !== null && (
          <button type="button" className="button" onClick={onRemove}>
            {doctor.remove}
          </button>
        )}
      </div>
    </form>
  );
}
