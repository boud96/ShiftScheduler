import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useApp } from './store';
import type { FileStatus } from './store';
import { SAVE_BAR } from './text';

/** An ISO time as the local time of day, 24 hours, `H:MM` (9:05, 14:30). */
function clock(iso: string): string {
  const time = new Date(iso);
  return `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`;
}

/** What to tell the user about the file. Unsaved changes come first: they are what can be lost. */
function status(file: FileStatus): { state: 'unsaved' | 'auto' | 'saved'; text: string } {
  if (file.dirty) return { state: 'unsaved', text: SAVE_BAR.unsaved };
  if (file.auto) return { state: 'auto', text: SAVE_BAR.auto(file.name) };
  if (file.savedAt !== null) return { state: 'saved', text: SAVE_BAR.saved(clock(file.savedAt)) };
  return { state: 'unsaved', text: SAVE_BAR.unsaved };
}

/**
 * The question that comes before another file replaces changes that are not in a file. It is a
 * dialog on the page and not `window.confirm`: a browser opens a file picker only for a click that
 * is fresh, about five seconds, and a box that waits for an answer uses that click up. The click on
 * the button that says yes is a new one.
 */
function OpenQuestion({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  const titleId = useId();
  const textId = useId();
  const yes = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') onNo();
    // There are two buttons, so Tab and Shift+Tab both go to the other one: the focus stays here.
    if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === no.current ? yes : no).current?.focus();
    }
  };

  // A click on the page behind or on the text must not take the focus out of the dialog.
  const keepFocus = (e: MouseEvent<HTMLElement>) => {
    if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
  };

  return (
    <div className="dialog-backdrop" onKeyDown={onKeyDown} onMouseDown={keepFocus}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        className="dialog"
      >
        <h2 id={titleId}>{SAVE_BAR.confirmTitle}</h2>
        <p id={textId}>{SAVE_BAR.confirmOpen}</p>
        <div className="dialog-actions">
          <button type="button" className="button" ref={yes} onClick={onYes}>
            {SAVE_BAR.confirmYes}
          </button>
          <button type="button" className="button button-primary" ref={no} autoFocus onClick={onNo}>
            {SAVE_BAR.confirmNo}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Always within reach: where the data is saved, and the buttons to save it, to save it into another
 * file, and to open a file.
 */
export function SaveBar() {
  const { file, saveFile, saveFileAs, openFile } = useApp();
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const { state, text } = status(file);

  const open = () => {
    if (file.dirty) setAsking(true); // changes that are not in a file would be lost: ask first
    else void openFile();
  };

  const answer = (yes: boolean) => {
    // The picker has to open from this very click, so the store is called first, and at once.
    if (yes) void openFile();
    setAsking(false);
    opener.current?.focus();
  };

  return (
    <div className="save-bar">
      <span className="save-status" data-state={state} role="status">
        {text}
      </span>
      <button type="button" className="button" onClick={() => void saveFile()}>
        {SAVE_BAR.save}
      </button>
      <button type="button" className="button" onClick={() => void saveFileAs()}>
        {SAVE_BAR.saveAs}
      </button>
      <button type="button" className="button" ref={opener} onClick={open}>
        {SAVE_BAR.open}
      </button>
      {asking && <OpenQuestion onYes={() => answer(true)} onNo={() => answer(false)} />}
    </div>
  );
}
