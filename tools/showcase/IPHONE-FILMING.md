# Filming the iPhone side of the Lumen demo (Nitin's Mac + iPhone 17 Pro)

Shravan filmed the Galaxy A17 side on 2026-10-25 with this branch. Do exactly the same on the iPhone. Everything
person-specific is already in the code for the iPhone: Nitin, 17, 74 in, 150 lb, family history No, high blood
pressure No, physically active **Yes**, pulse about **62 bpm** (Shravan's is 74; Nitin's must be lower).

Two films, each a recording of the iPhone screen made by the Mac:

1. **Setup film** (about 105 s of app time): Welcome → What Lumen is and isn't → About you → diabetes questions →
   checking your phone → finger placement → practice reading (dial shows Nitin's real finger video) → how to sit →
   **Your Lumen rating with a number** → Reminders "Not now" → Home. It stops on Home. That is the end of this film.
2. **Scan film** (about 5 min): Measure → Full Scan → 2-minute rest ring → the scan (carpet, finger lands, count;
   at about 44 s the finger visibly slides half off and Lumen shows **"Cover the lens and the flash."**, the count
   pauses, the finger goes back, counting resumes) → a normal result → scrolls → "Show me why" → scrolls.

The app taps through by itself (grey touch dots) starting on the next whole minute at least 15 s after it opens.
**Hands off the iPhone during a film.**

## Rules

- Free tools only. No EAS cloud builds, no paid Apple account. Keep `LUMEN_IOS_PERSONAL_TEAM=1` set (bundle ID
  `io.github.shravanvasa2009.heartcheck.dev`).
- Never commit or push Nitin's take files (`apps/mobile/src/showcase/recordings/nitin-*`): leave them unstaged.
- Don't push. If code must change to build, commit on a local branch and make a patch for Shravan.
- Rear camera only.
- **Don't change the film's timing** (`apps/mobile/src/showcase/script.ts`, `walkthrough.ts`, `scan.ts`,
  `runner.ts`, `people.ts`). Shravan's A17 films are final; every tap lands at a fixed second after the start on
  both phones, so the editor lines the two films up on the first tap and they stay in step to the end. A timing
  change on the Mac would break that. If something seems to need one, ask Shravan first.

## 1. Get the latest code (must include commit "showcase replay reports the phone's camera" or later)

```sh
cd ~/lumen && git fetch && git checkout track/showcase && git pull
git log --oneline -5
npm ci
```

## 2. Record Nitin's two takes (each about 1–2 min)

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

## 3. Turn the videos into take files and check them

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

## 4. Build the film app with the takes in it

```sh
cd apps/mobile
echo EXPO_PUBLIC_LUMEN_SHOWCASE=1 > .env.local     # don't commit it
export EXPO_PUBLIC_LUMEN_SHOWCASE=1
npx expo prebuild -p ios --clean                    # only if ios/ is missing or native code changed
npx expo run:ios --device --configuration Release
```

If a build error appears, fix it minimally on a local branch and tell Nitin what changed.

## 5. Rehearse both films and check every item (nothing is recorded)

Reset first: in Lumen, **Settings → Delete all data** → confirm, swipe Lumen away. Open Lumen, hands off.
If iOS asks for the Camera, tap Allow (it is remembered). Watch the whole setup, then reopen Lumen for the scan.

On A17 these went wrong before they were fixed; check each one on the iPhone:

- [ ] **Practice dial shows the real finger video** (carpet → "Cover the lens and the flash." → finger lands →
      red), not a plain red gradient.
- [ ] **"Your Lumen rating" shows a number and a tier** (with Rear camera speed / Flashlight / locks rows below),
      **not "Not tested yet"**. If it says "Not tested yet": open Console.app, pick the iPhone, filter `rating`,
      rehearse again, and report the line `Rating the phone failed: …` or `[showcase] rating …`. Don't film until
      the number shows.
- [ ] Diabetes questions get answered (they're quick, about 3 s): Physically active = **Yes** for Nitin.
- [ ] Setup ends on Home after Reminders "Not now". Sitting still on Home afterwards is expected.
- [ ] Scan: the slip shows in the dial and "Cover the lens and the flash." shows at the same moment, then the
      count resumes.
- [ ] Scan result is normal, pulse about 62, then "Show me why" scrolls to the bottom.
- [ ] Light mode, touch dots visible on each tap, scroll thumb visible, no iOS pop-ups or banners.

## 6. Film

Before each film: iPhone charged, brightness high, sound off, **Focus / Do Not Disturb ON**, notifications
cleared, Lumen closed, on the home screen. Close QuickTime.

**Setup film** (reset first: Settings → Delete all data, swipe Lumen away)

```sh
cd ~/lumen && swift tools/showcase/record-iphone.swift ~/Desktop/nitin-setup.mov
```

Open Lumen between :05 and :35 past a minute. Hands off until it has sat on Home for 5 s (about 2 min 45 s after
opening). Ctrl-C.

**Scan film** (no reset)

```sh
swift tools/showcase/record-iphone.swift ~/Desktop/nitin-scan.mov
```

Swipe Lumen away, then open it between :05 and :35 past a minute. Hands off about 6 min, until "Show me why" has
scrolled to the bottom and stopped. Ctrl-C.

**Make the files, trimmed like Shravan's**, and send them to Shravan (AirDrop, USB stick or Google Drive). Each
recording opens with up to a minute of the app waiting for the whole minute; Shravan's films start 2 s before the
first tap, so cut Nitin's the same way. Find where the opening still stretch ends (the first `freeze_end` after
Lumen is on screen, about 30–90 s in), then cut 2 s before it:

```sh
for f in nitin-setup nitin-scan; do
  ffmpeg -hide_banner -i ~/Desktop/$f.mov -vf "freezedetect=n=0.003:d=3" -map 0:v -f null - 2>&1 | grep freeze_end | head -3
done
# START = that freeze_end minus 2, for each film:
ffmpeg -ss <START> -i ~/Desktop/nitin-setup.mov -c:v libx264 -crf 16 -pix_fmt yuv420p -movflags +faststart -an ~/Desktop/nitin-setup-trimmed.mp4
ffmpeg -ss <START> -i ~/Desktop/nitin-scan.mov -c:v libx264 -crf 16 -pix_fmt yuv420p -movflags +faststart -an ~/Desktop/nitin-scan-trimmed.mp4
```

**Then watch both trimmed files from start to end before sending them.** The setup one must open on Welcome a
moment before "Get started" and end on Home; the scan one must open on Home a moment before "Measure" and end on
"Why regular?". Check the rating number, the slip with "Cover the lens and the flash.", and the result.

## 7. Report back to Shravan

The `video-take` lines from step 3 (timing, slip, HR), the Lumen rating number shown, any checklist item that
failed, any code changed (patch folder), and the paths of `nitin-setup.mp4` and `nitin-scan.mp4`.
