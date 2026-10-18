# Showcase recordings

The showcase build plays these through the live pipeline instead of the camera (`../scanSource.ts`), while
the real camera runs alongside only to draw the finger in the dial (`../filmCamera.ts`). The iPhone plays
`nitin-*` and the Galaxy A17 plays `shravan-*`. `*-practice` is the setup's practice reading and `*-scan` is
the Full Scan. Each take is one continuous piece: the camera on the floor, the finger landing at about 4 s,
then held still, so the film shows the app refusing to read before it counts.

**The four files here are SYNTHETIC STAND-INS** for rehearsal. `tools/showcase/make-standins.mjs`
generated them. They are not recorded from anyone. Before filming, replace them locally with real Lab captures,
whole and untrimmed, and never commit the real ones:

```
node tools/showcase/import-capture.mjs <captures/folder> --name shravan-scan
node tools/showcase/check-timing.mjs shravan-scan
```
