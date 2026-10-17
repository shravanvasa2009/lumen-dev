import { router } from 'expo-router';
import { Platform } from 'react-native';

import cues from './cues.json';
import { deliverDailyReminderNow } from './reminderBeat';
import { showTap } from './TapDots';

import { person } from './people';
import { REHEARSAL } from './flag';
import { HOLD_S, Script } from './script';

// The full walkthrough from a fresh start: setup, Home, the scan modes, Trends, the reminder and widgets,
// Learn, and the care map with the doctor report. Seconds are raw film time; the editor speeds up the
// practice scan and the waits.
export function setupSteps(script: Script, reminderAt: { hour: number; minute: number }): Script {
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
  // Diabetes risk questions
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
  // Practice is a real finger scan: 30 steady seconds, with room for the finger to settle.
  if (REHEARSAL) script.hold(3).tap('Skip practice');
  else
    script
      .hold(42)
      .step('tap Continue after practice', async () => true)
      .tap('Continue');
  script
    // How to sit
    .hold(2.5)
    .tap('Continue')
    // Your Lumen rating: the dial counts up, then the list of checks.
    .hold(3)
    .scrollThrough(2.5, 1.5)
    .tap('Continue')
    // Reminders: the daily check time is the minute the reminder arrives later in the film.
    .hold(1.5)
    .switchTo('Daily check', true)
    .tap(/^Reminder time/)
    .pick({ prop: 'mode', equals: 'time' }, null, new Date(2000, 0, 1, reminderAt.hour, reminderAt.minute));
  // iOS shows the wheel inline until the row is tapped again; Android closes its dialog on the pick.
  if (Platform.OS === 'ios') script.tap(/^Reminder time/);
  script.hold(HOLD_S).tap('Turn on reminders').hold(2);
  return script;
}

// The native header's back chevron is not a React control; it is pressed the way it would be by a finger,
// with the dot drawn over it.
const HEADER_BACK = { x: 8, y: Platform.OS === 'ios' ? 54 : 36, width: 44, height: 44 };
function back(script: Script): Script {
  return script
    .call('back', () => {
      showTap(HEADER_BACK);
      router.back();
      return true;
    })
    .hold();
}

// After setup: Home, the scan modes, Trends, the reminder from setup arriving on time, the widgets outside
// the app (driven by the A17's adb script and by hand on the iPhone, on the same cue seconds), Learn, the care
// map, and the doctor report.
export function tourSteps(script: Script): Script {
  script
    // Home with a month of mornings behind it.
    .hold(2.5)
    .scrollThrough(3, 1.5)
    .scrollToTop()
    // The scan modes, glanced at; the scanning film shows a full scan.
    .tap('Measure')
    .hold(1)
    .scrollThrough(2, 1.5);
  back(script)
    .tap('Trends')
    .hold(2)
    .scrollThrough(4, 2)
    .holdUntil(cues.reminder)
    .call('the daily reminder from setup arrives', deliverDailyReminderNow, 0, 3)
    // Outside the app until the widget is tapped; these seconds belong to the drivers.
    .holdUntil(cues.backInApp)
    .tap('Learn')
    .hold(1.5)
    .tap(/How the rhythm check works/)
    .hold(1.5)
    .scrollThrough(7, 1.5);
  back(script)
    .tap(/^Care/)
    .hold(2)
    .type('ZIP code or city', '78681', 1)
    .tap('Search')
    .hold(3)
    .scrollThrough(3, 1.5)
    .tap('Home')
    .hold(1)
    .tap(/^AFib/)
    .hold(2)
    .scrollThrough(3, 1)
    .tap('Doctor report')
    .hold(2)
    .scrollThrough(3, 1.5)
    .tap('Share PDF')
    .hold(4);
  return script;
}
