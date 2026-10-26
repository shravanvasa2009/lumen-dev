import { router } from 'expo-router';
import { Platform } from 'react-native';

import cues from './cues.json';
import { press } from './driver';
import { lookAroundMap } from './mapLook';
import { person } from './people';
import { deliverDailyReminderNow } from './reminderBeat';
import { HOLD_S, Script, shown } from './script';
import { showTap } from './TapDots';

// The setup film from a fresh start, in the order of the demo script (owner, 2026-10-25): setup, the practice
// reading, the Lumen score and the reminders, then the tour. Seconds are raw film time; the editor speeds up the
// phone check and the practice reading.
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
    // Reminders: the daily check time is the minute the reminder arrives later in the film.
    .hold(1.5)
    .switchTo('Daily check', true)
    .tap(/^Reminder time/)
    .pick({ prop: 'mode', equals: 'time' }, null, new Date(2000, 0, 1, reminderAt.hour, reminderAt.minute));
  // iOS shows the wheel inline until the row is tapped again; Android closes its dialog on the pick and holds
  // as long, so both films stay on one timetable.
  if (Platform.OS === 'ios') script.tap(/^Reminder time/);
  else script.hold();
  // Home's first render with a month of readings can hold the JS thread for several seconds.
  script.hold(HOLD_S).tap('Turn on reminders').hold(5);
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

// After setup: Home and its trend summary, the scan modes, Trends, the widgets and the reminder from setup
// outside the app (driven by the A17's adb script and by hand on the iPhone, on the same cue seconds), Learn,
// the care map, and the doctor report.
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
    .scrollThrough(8, 2)
    .scrollToTop()
    .holdUntil(cues.reminder)
    .call('the daily reminder from setup arrives', deliverDailyReminderNow, 0, 3)
    // Outside the app until the widget opens it on the Quick Check; these seconds belong to the drivers.
    .holdUntil(cues.backInApp);
  back(script)
    .tap('Learn')
    .hold(1.5)
    .scrollThrough(3, 1)
    .scrollToTop()
    .tap(/How the rhythm check works/)
    .hold(1.5)
    .scrollThrough(7, 1.5);
  back(script)
    .tap(/^Care/)
    .hold(2)
    .type('ZIP code or city', '78681', 1)
    .tap('Search')
    .hold(3)
    .call('look around the map', lookAroundMap, 6.6, 3)
    .hold()
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
