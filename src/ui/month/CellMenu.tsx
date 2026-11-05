import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { CODE_NAMES, Code, TWELVE_CODES, WEEKDAY_CODES } from '../../domain/codes';
import type { CodeInt } from '../../domain/codes';
import { MONTH_SCREEN } from '../text';

/** What an item of the menu asks for. */
export type MenuChoice =
  | { type: 'code'; code: CodeInt }
  | { type: 'clear' }
  | { type: 'pin' };

/** The codes that any day offers, after the shifts of its type. */
const OTHER_CODES: readonly CodeInt[] = [Code.DOV, Code.MD, Code.OP, Code.NEM, Code.X];

/** The space between the cell and its menu, and the space kept free at the edge of the window. */
const GAP = 4;
const MARGIN = 8;

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
  onChoose(choice: MenuChoice): void;
  /** `restoreFocus`: whether the cell is to take the focus again, as it is after the keyboard. */
  onClose(restoreFocus: boolean): void;
}

/**
 * The menu of a cell: the codes that its day takes, the absences and x, `Vymazat`, and `Připnout`
 * or `Odepnout` for a shift. It sits next to the cell, in the window, so that the scrolling box of
 * the grid does not cut it off, and it closes where the page would rather not have it: on Escape
 * and Tab, on a click outside it, and when the page is resized, or scrolled so that its cell moves.
 * The focus goes into it, and the arrow keys move it. It does not store anything: it says what was
 * chosen.
 */
export function CellMenu({ anchor, label, dayType, pin, onChoose, onClose }: CellMenuProps) {
  const box = useRef<HTMLDivElement>(null);
  /** Where the cell was when the menu was put beside it. */
  const placedAt = useRef<{ top: number; left: number } | null>(null);
  const shifts = dayType === 'weekday' ? WEEKDAY_CODES : TWELVE_CODES;

  // Before the page is painted, so that the menu is not seen where it would otherwise be.
  useLayoutEffect(() => {
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

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (box.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose(false);
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
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resized);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resized);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [anchor, onClose]);

  const choose = (choice: MenuChoice) => {
    onChoose(choice);
    onClose(true);
  };

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
