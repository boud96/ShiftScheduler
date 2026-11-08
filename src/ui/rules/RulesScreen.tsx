import { useId } from 'react';
import type { ReactNode } from 'react';
import type { Settings, WishId } from '../../domain/types';
import { ChoiceSelect, NumberField } from '../form';
import { useApp } from '../store';
import { LEVEL_CHOICES, RULES_SCREEN, WISH_LABELS } from '../text';

/**
 * The wishes in the order of the screen: the order of `WISH_LABELS`. The list is made from the
 * labels, so that a wish which has a label cannot be left off the screen.
 */
const WISH_IDS = Object.keys(WISH_LABELS) as readonly WishId[];

/** A group of controls, named for the page's readers by its heading. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="rules-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <div className="rules-fields">{children}</div>
    </section>
  );
}

/**
 * The rules that the team lead can change: the numbers of the musts and of the generator, and how
 * much each wish matters. The checks of the Měsíc tab and the generator read what is chosen here.
 * Nothing is checked across the fields, so the target of 12-hour shifts may be above the maximum;
 * the checks and the generator cope with that.
 */
export function RulesScreen() {
  const { data, dispatch } = useApp();
  if (data === null) return null;
  const { settings } = data;

  // A patch holds only the setting that changed. Its entries replace those of the settings, so any
  // other entry would put the value that this screen last saw over one that changed since.
  const update = (patch: Partial<Settings>) => dispatch({ type: 'updateSettings', patch });

  return (
    <div className="rules-screen">
      <Section title={RULES_SCREEN.settings}>
        <NumberField
          label={RULES_SCREEN.minRest}
          min={8}
          max={24}
          step={0.5}
          value={settings.minRestHours}
          onChange={(minRestHours) => update({ minRestHours })}
        />
        <NumberField
          label={RULES_SCREEN.weeklyRest}
          min={24}
          max={48}
          step={0.5}
          value={settings.weeklyRestHours}
          onChange={(weeklyRestHours) => update({ weeklyRestHours })}
        />
        <NumberField
          label={RULES_SCREEN.maxDaysInRow}
          min={4}
          max={7}
          value={settings.maxDaysInRow}
          onChange={(maxDaysInRow) => update({ maxDaysInRow })}
        />
        <NumberField
          label={RULES_SCREEN.maxTwelve}
          min={1}
          max={10}
          value={settings.maxTwelvePerMonth}
          onChange={(maxTwelvePerMonth) => update({ maxTwelvePerMonth })}
        />
        <NumberField
          label={RULES_SCREEN.minWeekendShifts}
          min={0}
          max={5}
          value={settings.minWeekendShifts}
          onChange={(minWeekendShifts) => update({ minWeekendShifts })}
        />
        <NumberField
          label={RULES_SCREEN.twelveTarget}
          min={0}
          max={10}
          value={settings.twelveTarget}
          onChange={(twelveTarget) => update({ twelveTarget })}
        />
        <NumberField
          label={RULES_SCREEN.timeBudget}
          min={3}
          max={120}
          value={settings.generatorTimeBudgetSec}
          onChange={(generatorTimeBudgetSec) => update({ generatorTimeBudgetSec })}
        />
      </Section>

      <Section title={RULES_SCREEN.wishes}>
        {WISH_IDS.map((id) => (
          <ChoiceSelect
            key={id}
            label={WISH_LABELS[id]}
            value={settings.wishLevels[id]}
            choices={LEVEL_CHOICES}
            // The levels are one entry of the settings, which a patch replaces whole.
            onChange={(level) => update({ wishLevels: { ...settings.wishLevels, [id]: level } })}
          />
        ))}
      </Section>
    </div>
  );
}
