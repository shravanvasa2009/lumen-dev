# Filming the iPhone side of the Lumen demo (Nitin's Mac + iPhone 17 Pro)

Shravan filmed the Galaxy A17 side on 2026-10-25 with this branch. Do exactly the same on the iPhone. Everything
person-specific is already in the code for the iPhone: Nitin, 17, 74 in, 150 lb, family history No, high blood
pressure No, physically active **Yes**, pulse about **62 bpm** (Shravan's is 74; Nitin's must be lower).

Two films, each a recording of the iPhone screen made by the Mac. They follow the demo script in its order:

1. **Setup film** (about 3 min 25 s of app time): Welcome → What Lumen is and isn't → About you → diabetes questions
   → checking your phone → finger placement → practice reading (dial shows Nitin's real finger video) → **Your Lumen
   rating with a number** → Reminders: **Daily check turned on** at the minute the reminder will arrive → Home and its
   trend summary → the scan modes → Trends → **the reminder arrives** → Home screen with the **Lumen widget** →
   **lock screen** with the **Lumen lock-screen widget** and the reminder → unlock → tap the Lumen widget → Learn (the
   8-chapter guide, one lesson scrolled) → Care near you (ZIP 78681, clinics incl. low-cost ones, map looked around)
   → Home → AFib result → **Doctor report** → **Share PDF** (the share sheet stays open). That is the end.
2. **Scan film** (about 5 min): Measure → Full Scan → 2-minute rest ring → the scan (carpet, finger lands, count;
   at about 44 s the finger visibly slides half off and Lumen shows **"Cover the lens and the flash."**, the count
   pauses, the finger goes back, counting resumes) → a normal result → scrolls → "Show me why" → scrolls.

The app taps through by itself (grey touch dots). The **scan film** starts on the next whole minute at least 15 s
after Lumen opens. The **setup film** starts at **:50 past a minute** (so its reminder lands on a whole minute right
after Trends): open Lumen between :05 and :35 and it starts at :50 of that minute.

**Hands off the iPhone during a film, except the five widget-beat moves the Mac speaks** (section 6). The app can't
press Home, lock or unlock the iPhone; on the A17 Shravan's PC does those over USB on the same seconds.

## Rules

- Free tools only. No EAS cloud builds, no paid Apple account. Keep `LUMEN_IOS_PERSONAL_TEAM=1` set (bundle ID
  `io.github.shravanvasa2009.heartcheck.dev`).
- Never commit or push Nitin's take files (`apps/mobile/src/showcase/recordings/nitin-*`): leave them unstaged.
- Don't push. If code must change to build, commit on a local branch `track/showcase-ios`, then
  `git format-patch track/showcase..track/showcase-ios -o ~/Desktop/lumen-ios-patches`, and explain each change.
- Never enter or ask for passwords in chat; tell Nitin which window to open and let him type.
- Rear camera only.
- **Don't change the film's timing** (`apps/mobile/src/showcase/script.ts`, `walkthrough.ts`, `scan.ts`,
  `runner.ts`, `people.ts`, `cues.json`). Shravan's A17 films are final; every tap lands at a fixed second after the
  start on both phones, so the editor lines the two films up on the first tap and they stay in step to the end. A
  timing change on the Mac would break that. If something seems to need one, ask Shravan first.

## 1. Get the latest code (must include commit "A17 film driver unlocks past the reminder card" or later)

```sh
cd ~/lumen && git fetch && git checkout track/showcase && git pull
git log --oneline -5
npm ci
```

## 2. Set up the iPhone (once)

1. Settings → Camera: Formats → **Most Compatible**; Record Video → **HDR Video off**; **Macro Control off**.
2. **Widgets** (after the build in step 5 is installed and Lumen has been opened once):
   - Home screen, **first page**: long-press an empty spot → Edit → Add Widget → **Lumen** → the **medium** size →
     Add Widget, drag it to the **top** of the first page, Done.
   - Lock screen: lock, wake, long-press the lock screen → Customize → Lock Screen → tap the widget row under the
     clock → **Lumen** → add one Lumen widget → Done.
   - If Lumen is missing from either list, the widget extension didn't install: report it (don't remove it).
3. **Notifications** shown on the lock screen: Settings → Notifications → Display As → **List**; Show Previews →
   **Always**.
4. **Focus / Do Not Disturb OFF for the setup film** (Focus would hide the reminder). For the scan film Focus may be
   on. Before each film clear all notifications (Notification Center → ✕ → Clear).

## 3. Record Nitin's two takes (each about 1–2 min; skip if they are done and checked)

iPhone Camera app → **Video**, flash **On** (the light stays on while recording), rear camera at the carpet,
elbow on the table. The Mac speaks the cues:

```sh
node tools/showcase/take-cues.mjs nitin-practice   # 50 s
node tools/showcase/take-cues.mjs nitin-scan       # 120 s
```

- On **"Go"** tap record. Carpet until **"Finger on"** (3 s): fingertip flat over the main lens and the flash,
  light pressure, hold still.
- **Scan take only:** at **41 s** "Slide your finger half off the lens" → slide it half off (the flash should
  shine past it); at **45 s** "Back on, flat. Hold still" → put it back flat and hold still.
- On **"Stop"** stop recording. AirDrop both videos to the Mac (Downloads).

## 4. Turn the videos into take files and check them

```sh
node tools/showcase/video-take.mjs ~/Downloads/<practice video>.MOV --name nitin-practice --bpm 62
node tools/showcase/video-take.mjs ~/Downloads/<scan video>.MOV --name nitin-scan --bpm 62
```

**All of these must hold, or redo that take:**

- practice: `clean 30 s at capture time` **under 40 s**
- scan: `clean 90 s (Processing) at` **under 114 s**
- scan: it prints `finger slip in the video: X-Y s` (somewhere around 42–47 s) and **no** "shows no finger slip"
  warning; the coaching list shows `coach.cover` starting within a second of X
- scan: `HR` about 62, `outcome: reading`
- `head -c 200 apps/mobile/src/showcase/recordings/nitin-scan.json` must **not** say `SYNTHETIC`
- `open apps/mobile/src/showcase/recordings/nitin-scan.mp4`: carpet, then a red-orange lit fingertip, a flash of
  light where it slides off, then red again. (A smooth red gradient from the first frame = the old stand-in.)

## 5. Build the film app with the takes in it

```sh
cd apps/mobile
echo EXPO_PUBLIC_LUMEN_SHOWCASE=1 > .env.local     # don't commit it
export EXPO_PUBLIC_LUMEN_SHOWCASE=1
npx expo prebuild -p ios --clean                    # only if ios/ is missing or native code changed
npx expo run:ios --device --configuration Release
```

If a build error appears, fix it minimally on the local branch and tell Nitin what changed. The widget extension
(`apps/mobile/targets/widget`) is **needed** now (the setup film shows it); if it won't sign with the Personal Team,
stop and report the exact error instead of removing it.

## 6. Rehearse both films and check every item (nothing is recorded)

Reset first: in Lumen, **Settings → Delete all data** → confirm, swipe Lumen away. Never reinstall between films
(that resets the permissions). Start the cue script and open Lumen in the same minute, between :05 and :35:

```sh
node tools/showcase/iphone-cues.mjs     # prints the start time, then speaks the widget-beat moves
```

At about 1 min 40 s into the run iOS asks to allow **notifications** when Lumen turns reminders on: tap **Allow**
(only in the rehearsal; iOS remembers it). If iOS asks for the Camera, tap Allow too.

**The widget beat** (about 2 min 10 s after the start; the Mac speaks each move 1 s early):

| Mac says                       | Nitin does                                                                  |
| ------------------------------ | --------------------------------------------------------------------------- |
| "Get ready. Reminder coming."  | nothing; the reminder banner appears over Trends                            |
| "Home. Swipe up."              | swipe up from the bottom edge: the home screen with the Lumen widget        |
| "Lock. Press the side button." | press the side button once (screen goes dark)                               |
| "Wake. Tap the screen."        | tap the screen once: the lock screen with the Lumen widget and the reminder |
| "Unlock. Swipe up."            | look at the iPhone (Face ID) and swipe up from the bottom edge              |
| "Tap the Lumen widget."        | tap the Lumen widget on the home screen; Lumen opens, then hands off again  |

Check each item; on the A17 these went wrong before they were fixed:

- [ ] **Practice dial shows the real finger video** (carpet → "Cover the lens and the flash." → finger lands →
      red), not a plain red gradient.
- [ ] **"Your Lumen rating" shows a number and a tier** (with Rear camera speed / Flashlight / locks rows below),
      **not "Not tested yet"**. If it says "Not tested yet": open Console.app, pick the iPhone, filter `rating`,
      rehearse again, and report the line `Rating the phone failed: …` or `[showcase] rating …`. Don't film until
      the number shows.
- [ ] Diabetes questions get answered (about 3 s): family history No, blood pressure No, physically active **Yes**.
- [ ] Reminders: **Daily check switches on** and the reminder time changes to the minute 2 min 10 s after the start
      (not 8:00 AM), then "Turn on reminders".
- [ ] The reminder banner "Time for your 90-second Lumen check." appears over Trends at the whole minute.
- [ ] The **lock screen shows the Lumen widget and the reminder**. If the reminder isn't on the lock screen, tell
      Shravan (it may sit under "Notification Center"; don't change any code).
- [ ] After the widget tap Lumen opens (on "Before you start"), goes back to Trends by itself, then Learn, a lesson,
      Care (types 78681, clinics and the map), Home, the AFib result, Doctor report, and the share sheet opens.
- [ ] Scan: the slip shows in the dial and "Cover the lens and the flash." shows at the same moment, then the
      count resumes.
- [ ] Scan result is normal, pulse about 62, then "Show me why" scrolls to the bottom.
- [ ] Light mode, touch dots visible on each tap, scroll thumb visible, no other iOS pop-ups or banners.

## 7. Film

Before each film: iPhone charged, brightness high, sound off, notifications cleared, Lumen closed, unlocked, on the
home screen (first page). Focus **off** for the setup film. Close QuickTime.

**Recording quality (Shravan's A17 films are 1080×2340 at a constant 60 fps; match that).** First make a 10 s test
while scrolling on the iPhone, then check it:

```sh
swift tools/showcase/record-iphone.swift ~/Desktop/quality-test.mov    # scroll the iPhone for 10 s, Ctrl-C
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,avg_frame_rate -of default=nw=1 ~/Desktop/quality-test.mov
```

It must show the iPhone's own screen resolution (iPhone 17 Pro: 1206×2622, or the same shape) and about 60 fps
while scrolling. If it is smaller or about 30 fps, fix `record-iphone.swift` before filming: set
`session.sessionPreset = .inputPriority`, choose the device format with the largest dimensions whose
`videoSupportedFrameRateRanges` reach 60, set it as `device.activeFormat` and set
`activeVideoMinFrameDuration`/`activeVideoMaxFrameDuration` to 1/60 s (inside `lockForConfiguration`), then test
again. Keep that change on the local branch and include it in the patch for Shravan.

**Setup film** (reset first: Settings → Delete all data, swipe Lumen away)

```sh
cd ~/lumen && swift tools/showcase/record-iphone.swift ~/Desktop/nitin-setup.mov
# in a second Terminal window, in the same minute you open Lumen:
cd ~/lumen && node tools/showcase/iphone-cues.mjs
```

Open Lumen between :05 and :35 past a minute (it starts at :50). Do the widget-beat moves when the Mac speaks; hands
off otherwise. Stop with Ctrl-C about 5 s after the share sheet opens (about 3 min 30 s after the start).

**Scan film** (no reset; Focus may be on)

```sh
swift tools/showcase/record-iphone.swift ~/Desktop/nitin-scan.mov
```

Swipe Lumen away, then open it between :05 and :35 past a minute. Hands off about 6 min, until "Show me why" has
scrolled to the bottom and stopped. Ctrl-C.

**Make the files, trimmed like Shravan's**, and send them to Shravan (AirDrop, USB stick or Google Drive). Each
recording opens with up to a minute of the app waiting for its start; Shravan's films start 2 s before the first
tap, so cut Nitin's the same way. Find where the opening still stretch ends (the first `freeze_end` after Lumen is
on screen), then cut 2 s before it:

```sh
for f in nitin-setup nitin-scan; do
  ffmpeg -hide_banner -i ~/Desktop/$f.mov -vf "freezedetect=n=0.003:d=3" -map 0:v -f null - 2>&1 | grep freeze_end | head -3
done
# START = that freeze_end minus 2, for each film:
ffmpeg -ss <START> -i ~/Desktop/nitin-setup.mov -vf fps=60 -c:v libx264 -crf 14 -pix_fmt yuv420p -movflags +faststart -an ~/Desktop/nitin-setup-trimmed.mp4
ffmpeg -ss <START> -i ~/Desktop/nitin-scan.mov -vf fps=60 -c:v libx264 -crf 14 -pix_fmt yuv420p -movflags +faststart -an ~/Desktop/nitin-scan-trimmed.mp4
```

Also cut the idle end: add `-t <seconds>` after the input so each film ends about 3 s after the last step (setup:
the share sheet open; scan: "Why regular?" scrolled to the bottom). Check each with `ffprobe` (native resolution,
`r_frame_rate=60/1`). For email, a smaller copy: `ffmpeg -i <file> -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p
-movflags +faststart <file>-email.mp4` (stays under 25 MB).

**Then watch both trimmed files from start to end before sending them.** The setup one must open on Welcome a
moment before "Get started" and end on the share sheet; the scan one must open on Home a moment before "Measure"
and end on "Why regular?". Check the rating number, the reminder (banner, lock screen), both widgets, the care map,
the slip with "Cover the lens and the flash.", and the result.

## 8. Report back to Shravan

The `video-take` lines from step 4 (timing, slip, HR), the Lumen rating number shown, any checklist item that
failed, any code changed (patch folder), and the paths of `nitin-setup-trimmed.mp4` and `nitin-scan-trimmed.mp4`.
