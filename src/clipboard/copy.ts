/**
 * Puts `text` on the clipboard, and resolves to whether it got there. It never rejects.
 *
 * It asks the Clipboard API first. A page that is not a secure context has no
 * `navigator.clipboard`, and a browser may refuse a write, so then the text is put in a textarea
 * that is out of sight, selected there, and copied with the copy command. Both ways need a fresh
 * click, so call it from the click itself. The Clipboard API is asked before anything is awaited.
 * The copy command runs after the refusal of the API has been awaited, so it relies on the click
 * still counting as fresh by then: in Chromium it does for about 5 s after the click, in Firefox
 * for less.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyThroughField(text);
  }
}

/** The old way: select the text in a field and run the copy command. The field does not stay. */
function copyThroughField(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true; // no keyboard comes up on a touch screen
  field.style.position = 'fixed'; // out of the flow, so that the page does not move
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  const focused = document.activeElement;
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
