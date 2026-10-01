from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import wfdb

from datasets import paths
from datasets.splits import ensure_not_external

# BUT PPG 2.0.0 (https://physionet.org/content/butppg/2.0.0/), subject-info.csv: "measurement spot:
# 0 (ear) or 1 (finger)". Finger means the index finger on the rear camera and lit LED (ADR 0023).
FINGER = 1
# Same page: a record is quality 1 when most annotators' PPG heart rate was within 5 bpm of the ECG
# reference, which is §11.2's definition of a clean window.
GOOD_QUALITY = 1
REFERENCE_TOLERANCE_BPM = 5.0
PPG_RATE_HZ = 30.0
# "The data were collected from 50 subjects" and record IDs carry 50 distinct three-digit prefixes, so
# the prefix is the subject.
SUBJECT_DIGITS = 3


@dataclass(frozen=True)
class Recording:
    record: str
    subject: str
    quality: int
    reference_hr_bpm: float
    # DSP-3 primary signal, −R, one value per frame at PPG_RATE_HZ starting at t = 0.
    negative_red: np.ndarray
    # ECG R-peaks from the manually verified .qrs file, seconds from the ECG start.
    r_peaks_s: np.ndarray


def butppg_dir() -> Path:
    return paths.open_dir() / "butppg"


def subject_of(record: str) -> str:
    return record[:SUBJECT_DIGITS]


def _csv(name: str) -> pd.DataFrame:
    path = butppg_dir() / name
    ensure_not_external(path, "train")
    # The files start with a UTF-8 byte-order mark.
    return pd.read_csv(path, encoding="utf-8-sig", dtype={"ID": str})


def finger_records() -> pd.DataFrame:
    spots = _csv("subject-info.csv")[["ID", "Ear/finger"]]
    labels = _csv("quality-hr-ann.csv")
    table = labels.merge(spots, on="ID", how="inner", validate="one_to_one")
    finger = table[table["Ear/finger"] == FINGER]
    return pd.DataFrame(
        {
            "record": finger["ID"].to_numpy(str),
            "subject": finger["ID"].map(subject_of).to_numpy(str),
            "quality": finger["Quality"].to_numpy(int),
            "reference_hr_bpm": finger["HR"].to_numpy(float),
        }
    ).sort_values("record", ignore_index=True)


def negative_red(record: str) -> np.ndarray:
    path = butppg_dir() / record / f"{record}_PPG"
    ensure_not_external(path, "train")
    ppg = wfdb.rdrecord(str(path))
    if ppg.fs != PPG_RATE_HZ:
        raise ValueError(f"{record}: PPG at {ppg.fs} Hz, expected {PPG_RATE_HZ}")
    if ppg.sig_len == 1:
        # Records 100001–111004 store each frame as its own one-sample signal, already inverted
        # ("Finally, the PPG signal was inverted"), so the frames in signal order are −R.
        values = ppg.p_signal[0]
        if values.max() > 0:
            raise ValueError(f"{record}: expected inverted red (all ≤ 0), got a maximum of {values.max()}")
        return values.astype(float)
    # Records from 112001 on store raw R, G, B means. wfdb 4.3.1 reads the unit "a.u." as "a" and leaves
    # the rest of the line, ending in the channel name, in sig_name.
    names = [name.split()[-1] for name in ppg.sig_name]
    return -ppg.p_signal[:, names.index("PPG_R")].astype(float)


def r_peaks_s(record: str) -> np.ndarray:
    base = butppg_dir() / record / record
    ensure_not_external(base, "train")
    # The .qrs file has no rate of its own; it counts ECG samples. The rate is the third field of the ECG
    # header's record line (https://physionet.org/physiotools/wag/header-5.htm). Parsed directly because
    # wfdb.rdheader takes ~12 s on the first release's 10,000-signal headers.
    record_line = Path(f"{base}_ECG.hea").read_text(encoding="utf-8").split("\n", 1)[0]
    ecg_rate = float(record_line.split()[2])
    return wfdb.rdann(str(base), "qrs").sample / ecg_rate


def reference_consistent(recording: Recording) -> bool:
    # quality-hr-ann.csv's HR equals 60 / median R-R of the .qrs beats for every record of subjects
    # 100–141, but differs by more than 5 bpm in 61–78% of the records of subjects 142–149, where the PPG
    # of poor-quality records agrees with the .qrs far more often than with the CSV (ADR 0038). Quality
    # is defined against that HR, so a record whose HR contradicts its own verified beats has no
    # trustworthy label. 5 bpm is the dataset's own tolerance.
    intervals = np.diff(recording.r_peaks_s)
    if len(intervals) < 2:
        return False
    return abs(60.0 / float(np.median(intervals)) - recording.reference_hr_bpm) <= REFERENCE_TOLERANCE_BPM


def load_recording(row: pd.Series) -> Recording:
    return Recording(
        record=row["record"],
        subject=row["subject"],
        quality=int(row["quality"]),
        reference_hr_bpm=float(row["reference_hr_bpm"]),
        negative_red=negative_red(row["record"]),
        r_peaks_s=r_peaks_s(row["record"]),
    )
