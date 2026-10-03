# diabetes-net 1.0.0 (shipped diabetes model)

Lumen is a screening prototype, not a diagnosis.

## Intended use

Estimates whether the averaged fingertip pulse shape matches a pattern research has linked to diabetes. It is not a diabetes test, a glucose reading, or an A1c. Full tier (60 fps) only. Part of a screening prototype, not a diagnosis, and never part of emergency logic.

This is the shipped diabetes model: the app loads it. The development ablation picked it (subject-level AUROC for diabetic vs not on dev-val; network minus diabetes-lgbm: 0.0091, 95% CI -0.0436 to 0.0607), so it ships per §11.4 (ADR 0031).

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
| subjectAuroc | 0.5902887972072358 | 0.5255739471091715 | 0.6545849816262032 |
| subjectSensitivity | 0.22826086956521738 | 0.14772727272727273 | 0.313953488372093 |
| subjectSpecificity | 0.8503649635036497 | 0.8086604193870497 | 0.8924761051373954 |
| readingAuroc | 0.5704865893666575 | 0.515876734329218 | 0.6236288572167179 |
| subjectPpvAt5PctPrevalence | 0.07431996073467492 | 0.04646891141854705 | 0.11279954839129035 |
| subjectNpvAt5PctPrevalence | 0.9544123091920569 | 0.9493621258173591 | 0.9596604295424876 |
| subjectPpvAt11.6PctPrevalence | 0.16678627615999556 | 0.10833942613534452 | 0.24069252589728676 |
| subjectNpvAt11.6PctPrevalence | 0.8935841443268555 | 0.8826241632052007 | 0.905138884075643 |
| subjectPpvAt20PctPrevalence | 0.2760771519048076 | 0.1879716814215379 | 0.37652739930315465 |
| subjectNpvAt20PctPrevalence | 0.8150725298960056 | 0.7978556905505422 | 0.8335643284785595 |

## Ablation

The neural model ships only if it beats its classical baseline on held-out subjects.

| model | inputs | subject AUROC (95% CI) | subject sensitivity at τ_DM | subject specificity at τ_DM | reading AUROC | τ_DM |
|---|---|---|---|---|---|---|
| diabetes-net | averaged beat, 12 shape features, HR summary | 0.590 (0.526-0.655) | 0.228 (0.148-0.314) | 0.850 (0.809-0.892) | 0.570 (0.516-0.624) | 0.5614 |
| diabetes-logistic | 12 shape features | 0.558 (0.489-0.625) | 0.261 (0.174-0.358) | 0.850 (0.808-0.892) | 0.555 (0.497-0.612) | 0.5483 |
| diabetes-lgbm | 12 shape features | 0.581 (0.516-0.647) | 0.196 (0.119-0.278) | 0.850 (0.807-0.889) | 0.561 (0.513-0.611) | 0.5294 |
| hr-summary-logistic | HR summary only (ablation, not exported) | 0.466 (0.395-0.542) | 0.141 (0.073-0.216) | 0.850 (0.807-0.891) | 0.480 (0.431-0.531) | 0.5158 |

## Calibration

- sourceSha256: 0f621422bc68181b376c5e6131ba0fc1fd2182b13f87a1427a1156a46566cc67
- measuredBy: python -m train.diabetes
- method: none: the model's own probabilities, not recalibrated
- unit: dev-val 90 s segments (the 'windows' count in each row), weighted by label and subject
- segmentExpectedCalibrationErrorPattern: 0.010706839403940073

## External test

Dataset: vitaldb-holdout. Not run yet. Run once per model version, only after the owner approves (need-human).

## Limitations

- Trained on clinical pulse-oximeter data; phone-camera pulses differ, and performance on the owner's phone captures is reported separately.
- Small public datasets: if the ML-6 floor is not met, the output appears only as Experimental and is never flagged.

## What the app shows when the model abstains

The result appears only as Experimental ("Experimental: pulse pattern linked to diabetes in research. Not a diabetes test.") unless the ML-6 floor is met. Phones below 60 fps show "Needs a phone that films at 60 frames per second."
