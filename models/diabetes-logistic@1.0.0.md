# diabetes-logistic 1.0.0 (ablation model, not shipped)

Lumen is a screening prototype, not a diagnosis.

## Intended use

Estimates whether the averaged fingertip pulse shape matches a pattern research has linked to diabetes. It is not a diabetes test, a glucose reading, or an A1c. Full tier (60 fps) only. Part of a screening prototype, not a diagnosis, and never part of emergency logic.

This is an ablation model and does not ship; the app loads diabetes-net for the diabetes family (ADR 0031). On development subjects it did not beat diabetes-net (subject-level AUROC for diabetic vs not on dev-val).

## Data

Public pulse-oximeter waveforms resampled to 256 Hz, band-limited to 0.5–8 Hz, and normalized per beat. The VitalDB holdout locked in ml/splits/diabetes.json (ADR 0014) is never used for training or tuning.

Trained on: vitaldb. Splits are by subject: no person appears in both development-train and development-validation.

Training notes, as written at training time:

- Data: VitalDB development patients (ADR 0047), 90 s PLETH segments with a DSP-14 averaged beat. dev-train: 355 diabetic and 1068 control subjects, 5667 segments; dev-val: 92 diabetic and 274 control subjects, 1459 segments. The locked holdout (ADR 0014) is never read.
- Missing shape or HR-summary values are filled with the dev-train median of that feature (fillMedians), or 0.0 for a feature with no dev-train value at all (['sdnnMs']), which is then constant and ignored; segments filled per feature, dev-train and dev-val together: {'width25': 1, 'notchTime': 4, 'notchHeight': 4, 'diastolicPeakHeight': 4, 'dOverA': 227, 'eOverA': 1218, 'agingIndex': 1218, 'areaRatio': 4, 'rmssdMs': 1434, 'sdnnMs': 7126, 'pnn50': 1434}.
- Training, early stopping, and both baselines weight segments so each label carries equal weight and each subject equal weight within its label.
- Threshold: τ_DM is the lowest threshold at which dev-val subject-level specificity is at least 85%; a subject's score is the mean probability over that subject's 90 s segments (ADR 0061, proposed).
- Dev-val numbers are optimistic: early stopping, model choice, and τ_DM were all chosen on dev-val. The locked VitalDB holdout is the unbiased check.
- The HR-summary-only model is in the ablation table to show how much heart rate and HRV alone separate the groups (ADR 0047).
- Ship rule (§11.4, subject-level AUROC for diabetic vs not on dev-val): diabetes-net is the v1 diabetes model.

## Development metrics

Development-validation subjects: 366. Confidence intervals resample subjects.

| metric | estimate | 95% CI low | 95% CI high |
|---|---|---|---|
| subjectAuroc | 0.5579181212313551 | 0.48925672852257945 | 0.6248925028736855 |
| subjectSensitivity | 0.2608695652173913 | 0.17390195208518192 | 0.35789473684210527 |
| subjectSpecificity | 0.8503649635036497 | 0.807540308747856 | 0.8916991082493669 |
| readingAuroc | 0.5549598056647717 | 0.49732436404841823 | 0.6116196512730999 |
| subjectPpvAt5PctPrevalence | 0.08404478298655489 | 0.05426718815116645 | 0.12594989346743 |
| subjectNpvAt5PctPrevalence | 0.9562542848824651 | 0.9509116312074349 | 0.9620119114381477 |
| subjectPpvAt11.6PctPrevalence | 0.18617692196548724 | 0.12515779755973827 | 0.26431092132579714 |
| subjectNpvAt11.6PctPrevalence | 0.8976202440312834 | 0.8859705447276328 | 0.9103717177788845 |
| subjectPpvAt20PctPrevalence | 0.30354505169867063 | 0.21418257107145258 | 0.4063418304792765 |
| subjectNpvAt20PctPrevalence | 0.8214915306200659 | 0.8030796235527445 | 0.8420564776709519 |

## Ablation

The neural model ships only if it beats its classical baseline on held-out subjects.

| model | inputs | subject AUROC (95% CI) | subject sensitivity at τ_DM | subject specificity at τ_DM | reading AUROC | τ_DM |
|---|---|---|---|---|---|---|
| diabetes-net | averaged beat, 12 shape features, HR summary | 0.590 (0.526-0.655) | 0.228 (0.148-0.314) | 0.850 (0.809-0.892) | 0.570 (0.516-0.624) | 0.5614 |
| diabetes-logistic | 12 shape features | 0.558 (0.489-0.625) | 0.261 (0.174-0.358) | 0.850 (0.808-0.892) | 0.555 (0.497-0.612) | 0.5483 |
| diabetes-lgbm | 12 shape features | 0.581 (0.516-0.647) | 0.196 (0.119-0.278) | 0.850 (0.807-0.889) | 0.561 (0.513-0.611) | 0.5294 |
| hr-summary-logistic | HR summary only (ablation, not exported) | 0.466 (0.395-0.542) | 0.141 (0.073-0.216) | 0.850 (0.807-0.891) | 0.480 (0.431-0.531) | 0.5158 |

## Calibration

- sourceSha256: e01f2531156d9269c1412b41b0f654de0efdb1ece8b92d84bc1b9d8fa3ae5912
- measuredBy: python -m train.diabetes
- method: none: the model's own probabilities, not recalibrated
- unit: dev-val 90 s segments (the 'windows' count in each row), weighted by label and subject
- segmentExpectedCalibrationErrorPattern: 0.034978667959751616

## External test

Dataset: vitaldb-holdout. Not run yet. Run once per model version, only after the owner approves (need-human).

## Limitations

- Trained on clinical pulse-oximeter data; phone-camera pulses differ, and performance on the owner's phone captures is reported separately.
- Small public datasets: if the ML-6 floor is not met, the output appears only as Experimental and is never flagged.

## What the app shows when the model abstains

The result appears only as Experimental ("Experimental: pulse pattern linked to diabetes in research. Not a diabetes test.") unless the ML-6 floor is met. Phones below 60 fps show "Needs a phone that films at 60 frames per second."
