import { codeFromName } from '../domain/codes';
import { buildMonthGrid } from '../domain/context';
import type { MonthContext } from '../domain/context';
import { newAppData, newPerson } from '../domain/defaults';
import { evaluateMonth } from '../domain/rules/evaluate';
import type { MonthEval } from '../domain/rules/evaluate';
import type { Finding, RuleId } from '../domain/rules/types';
import type {
  FairnessCounts,
  ISODate,
  MonthKey,
  Preferences,
  Settings,
  WishId,
} from '../domain/types';

/** What to change on a default person (see `newPerson`). */
export interface PersonPatch {
  prefs?: Partial<Preferences>;
  activeFrom?: ISODate | null;
  activeTo?: ISODate | null;
  startingCounts?: Partial<FairnessCounts>;
}

/**
 * A month context for rule tests: `people` default people (or one per patch), on top of the
 * default settings with `settings` laid over them. Person i gets the id `p${i + 1}`.
 */
export function ctxFor(
  month: MonthKey,
  people: number | PersonPatch[],
  settings: Partial<Settings> = {},
): MonthContext {
  const patches: PersonPatch[] =
    typeof people === 'number' ? Array.from({ length: people }, () => ({})) : people;
  const data = newAppData();
  data.settings = { ...data.settings, ...settings };
  data.people = patches.map((patch, i) => {
    const person = newPerson(`p${i + 1}`, `Operátor ${i + 1}`);
    person.prefs = { ...person.prefs, ...patch.prefs };
    person.activeFrom = patch.activeFrom ?? null;
    person.activeTo = patch.activeTo ?? null;
    person.startingCounts = { ...person.startingCounts, ...patch.startingCounts };
    return person;
  });
  return buildMonthGrid(data, month).ctx;
}

/** Writes the codes of a strip into `row` from index `from`; the strip may hold `room` codes. */
function fillRow(row: Uint8Array, strip: string, from: number, room: number): void {
  const tokens = strip.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length > room) {
    throw new Error(`Strip "${strip}" has ${tokens.length} codes, but there is room for ${room}`);
  }
  tokens.forEach((token, k) => {
    if (token === '-') return;
    const code = codeFromName(token);
    if (code === null) throw new Error(`Unknown code "${token}" in strip "${strip}"`);
    row[from + k] = code;
  });
}

/**
 * Rows for a context from text strips, one strip per person: codes separated by spaces, `-` for an
 * empty cell, `|` ignored (use it to mark weeks). A `month` strip starts at day 1 of the month, a
 * `tail` strip at the first of the 7 days before it. Whatever a strip leaves out stays empty.
 */
export function rowsOf(ctx: MonthContext, month: string[], tail: string[] = []): Uint8Array[] {
  if (month.length > ctx.people.length || tail.length > ctx.people.length) {
    throw new Error(`More strips than the ${ctx.people.length} people in the context`);
  }
  return ctx.people.map((_, p) => {
    const row = new Uint8Array(ctx.days.length);
    fillRow(row, tail[p] ?? '', 0, ctx.first);
    fillRow(row, month[p] ?? '', ctx.first, ctx.days.length - ctx.first);
    return row;
  });
}

/** Evaluates a month with every finding listed. */
export function run(ctx: MonthContext, rows: Uint8Array[]): MonthEval {
  return evaluateMonth(ctx, rows, true);
}

/** The findings of one rule. */
export function rules(ev: MonthEval, id: RuleId): Finding[] {
  return ev.findings.filter((f) => f.rule === id);
}

/**
 * How much of a rule there is in an evaluation: the number of findings for a must (M1 to M8), and
 * for a wish its penalties divided by its weight in `ctx`, so that the number does not depend on
 * the level of the wish. A wish switched off (weight 0) has no units.
 */
export function units(ev: MonthEval, ctx: MonthContext, id: RuleId): number {
  const found = rules(ev, id);
  if (id.startsWith('M')) return found.length;
  const weight = ctx.weights[id as WishId];
  return weight === 0 ? 0 : found.reduce((sum, f) => sum + f.penalty, 0) / weight;
}
