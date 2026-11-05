import { useState } from 'react';
import type { PersonId } from '../../domain/types';
import { useApp } from '../store';
import { TEAM_SCREEN } from '../text';
import { PersonCard } from './PersonCard';

/**
 * One card per person, in the order of the team, using the wording of the survey the team
 * answered: the team lead copies the answers over from it. The generator reads what is chosen here.
 */
export function TeamScreen() {
  const { data, dispatch } = useApp();
  // The person added last: their card takes the cursor. It comes at the end of a long list, and
  // the page scrolls to it that way, so that it is not added out of sight.
  const [added, setAdded] = useState<PersonId | null>(null);
  if (data === null) return null;

  const add = () => {
    const id = crypto.randomUUID();
    setAdded(id);
    dispatch({ type: 'addPerson', id });
  };

  return (
    <div className="team-screen">
      <div className="team-toolbar">
        <button type="button" className="button button-primary" onClick={add}>
          {TEAM_SCREEN.add}
        </button>
      </div>
      <div className="team-cards">
        {data.people.map((person, i) => (
          <PersonCard
            key={person.id}
            person={person}
            first={i === 0}
            last={i === data.people.length - 1}
            autoFocus={person.id === added}
          />
        ))}
      </div>
    </div>
  );
}
