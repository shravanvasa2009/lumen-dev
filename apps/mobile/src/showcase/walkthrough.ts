import { press } from './driver';
import { person } from './people';
import { Script, shown } from './script';

// The setup film from a fresh start: setup, the practice reading and the Lumen score, then Home. Seconds are
// raw film time; the editor speeds up the phone check and the practice reading.
export function setupSteps(script: Script): Script {
  const answer = (question: RegExp, yes: boolean) => script.tap(yes ? 'Yes' : 'No', { within: question });
  script
    // Welcome
    .hold(2)
    .tap('Get started')
    // What Lumen is and isn't: one line for what it can and can't do.
    .hold(1)
    .scrollThrough(2.5, 1.5)
    .tap('I understand Lumen is a screening tool, not a diagnosis.')
    .tap('Continue')
    // About you. The doctor's phone stays empty and the health notes stay off.
    .hold(1)
    .type('Your first name', person.name, 1)
    .type('Age', person.age, 0.6)
    .tap(/^Sex/)
    .tap('Male')
    .tap(/^Units/)
    .tap('in, lb')
    .type('Height', person.heightIn, 0.6)
    .type('Weight', person.weightLb, 0.6)
    .scrollThrough(2, 1.5)
    .tap('Continue');
  // Diabetes risk questions: Nitin exercises regularly and answers Yes to "physically active"; Shravan answers
  // No (owner, 2026-10-25).
  script.hold(1);
  answer(/parent, brother or sister/, person.familyHistory);
  answer(/blood pressure is high/, person.highBloodPressure);
  answer(/physically active/, person.active);
  script
    .tap('Continue')
    // Checking your phone: the probe takes about ten seconds.
    .hold(11)
    .tap('Next: finger placement')
    .hold(2.5)
    .tap("I'm ready, start practice");
  // Practice replays the person's recorded take (the carpet for 2–4 s, the finger landing, then steady seconds)
  // while the dial plays that take's camera video; it counts out about 40 s in and Continue appears.
  script
    .hold(40)
    .step('tap Continue after practice', async () => shown(await press('Continue')), 0, 10)
    .hold();
  script
    // How to sit
    .hold(2.5)
    .tap('Continue')
    // Your Lumen rating: the dial counts up, then the list of checks.
    .hold(3)
    .scrollThrough(2.5, 1.5)
    .tap('Continue')
    // Reminders are left off, so no notification lands in the scan film.
    .hold(2)
    .tap('Not now')
    // Home's first render with a month of readings can hold the JS thread for several seconds.
    .hold(5)
    .scrollThrough(3, 1.5)
    .scrollToTop()
    .hold(2);
  return script;
}
