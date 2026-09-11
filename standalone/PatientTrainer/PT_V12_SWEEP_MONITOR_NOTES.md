# PT-v12 – ECG colour correction + continuous sweep monitor

## Limb lead correction
The internal limb mapping is now fixed to:
- RA = red
- LA = yellow
- LL = green
- RL = black

The lower-limb coordinates themselves were not moved from the accepted PT-v11 placement; only the green/black assignment was corrected.

## Monitor rendering architecture
PT-v12 removes the old full-window retrospective waveform redraw.

The monitor now:
- preserves the already-drawn trace
- advances a sweep cursor from left to right
- clears only a narrow wipe band immediately in front of the sweep head
- overwrites the previous trace only when the sweep reaches that position again
- internally samples signals at 250 Hz, independent of browser frame rate
- smooths numerical HR/RR changes before they influence new signal generation

This prevents the old visual effect where changing HR or RR caused the entire visible waveform history to bounce or reshape.

## ECG physiology
Peter's bedside display remains lead II.
The case monitor profile now includes:
- sinus rhythm
- HR driven from the current case value
- QRS/PR/QT morphology parameters
- visible positive ST displacement consistent with the inferior-STEMI case
- smooth ST-to-T transition rather than an abrupt synthetic notch

## Respiration
The respiratory trace is now modeled as spontaneous breathing rather than a regular ventilator-like cycle.
It includes:
- breath-to-breath interval variation
- amplitude variation
- asymmetric inspiration/expiration
- baseline micro-variation
- occasional sigh breaths

Ventilator-like regular breathing is still supported as a separate waveform profile for future cases.

## Plethysmography
The pleth remains pulse-synchronous and includes:
- pulse-transit delay
- rapid systolic upstroke
- slower decay
- dicrotic notch/secondary component
- respiratory amplitude modulation
- perfusion-index scaling

## Future dynamic inputs
`updateEmbeddedMonitorPhysiology(patch)` is now exported so future trainer events can modify monitor physiology without remounting the monitor.
Supported profile changes include rhythm, HR, RR, SpO2, BP, ST shift, QRS/PR/QT morphology, perfusion, respiratory pattern, PVC frequency and more.

## UI
- monitor screen height was reduced further so the full monitor, NIBP trend and clickable controls fit more easily on laptop displays
- Freeze/Resume, Start NIBP and Clear NIBP trend remain HTML controls outside the waveform canvas
- NIBP history remains inside the visible monitor screen

## Validation
All existing physical-examination, posterior-view, ECG placement and monitor tests pass, including new PT-v12 tests for continuous sweep architecture and inferior-STEMI ST elevation.
