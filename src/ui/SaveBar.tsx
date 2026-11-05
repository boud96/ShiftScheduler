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

/** Always within reach: where the data is saved, and the buttons to save it and to open a file. */
export function SaveBar() {
  const { file, saveFile, openFile } = useApp();
  const { state, text } = status(file);

  // Opening switches the file at once, so the question has to come first.
  const open = () => {
    if (file.dirty && !window.confirm(SAVE_BAR.confirmOpen)) return;
    void openFile();
  };

  return (
    <div className="save-bar">
      <span className="save-status" data-state={state} role="status">
        {text}
      </span>
      <button type="button" className="button" onClick={() => void saveFile()}>
        {SAVE_BAR.save}
      </button>
      <button type="button" className="button" onClick={open}>
        {SAVE_BAR.open}
      </button>
    </div>
  );
}
