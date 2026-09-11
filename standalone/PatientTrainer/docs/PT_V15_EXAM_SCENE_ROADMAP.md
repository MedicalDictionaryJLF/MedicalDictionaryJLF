# PT-v15 Examination Scene Roadmap / Next creative upgrades

## Already added in this patch
- Distressed, sweaty, pain-behaviour patient presentation.
- Emergency-room bed scene.
- Manual depiction of ECG / monitor hookup during physical examination.
- Responsive bedside message strip showing the patient is actively reacting.

## Strong next upgrades

### 1) State-driven patient expressions
Instead of one generic distressed state, use dedicated visual states:
- pain spike
- dyspnea
- nausea
- presyncope
- improved after nitrates / analgesia
- worsening shock / decompensation

Each state could alter:
- face / sweating intensity
- breathing pattern
- colour / pallor
- verbal responses
- body guarding posture

### 2) Dynamic speech / voice reactions
When the learner performs an action, the patient should react immediately:
- palpating epigastrium → “That is not where it hurts.”
- pressing precordium → wince + “That pressure is still there.”
- sitting him upright → breathing improves slightly
- oxygen applied → patient reports relief / no relief depending on case logic

### 3) Blood draw + tube selection mini-game
A high-value skills module:
- select cannula / butterfly / Vacutainer setup
- choose correct tube colours for tests
- draw blood in correct order of draw
- label samples
- send tests (troponin, FBC, biochemistry, coagulation, D-dimer, blood gas, cultures)

Could score:
- correct vial choice
- correct order
- underfilled / overfilled tubes
- missing urgent markers

### 4) IV access / treatment preparation
Interactive procedural steps:
- choose cannula size
- apply tourniquet
- pick vein
- advance cannula
- flush and secure line
- attach fluids / medications

Could connect to treatment actions:
- aspirin
- nitrates
- morphine / analgesia
- heparin / anticoagulation
- antiemetics

### 5) Oxygen / airway support mini-module
For dyspnea or decompensation cases:
- nasal cannula
- simple mask
- non-rebreather
- NIV / CPAP / BiPAP
- bag-mask preparation

Could update monitor parameters live and change the patient’s visible work of breathing.

### 6) Advanced monitor interaction
Beyond the current inline depiction:
- connect monitor leads physically
- place SpO2 probe on finger
- place NIBP cuff on arm
- connect temperature probe
- inspect trends over time
- change alarm thresholds
- silence alarms temporarily

### 7) Point-of-care tasks
Excellent educational depth:
- capillary glucose
- arterial blood gas
- bedside echo entry points
- FAST / lung ultrasound window selection
- troponin timeline interpretation

### 8) Documentation layer
Make students actively chart what they did:
- focused physical exam summary
- working diagnosis
- differential list
- initial management plan
- handover / SBAR to cardiology or ED senior

### 9) More realistic physical examination findings
Add richer physical interactions:
- true percussion sound map
- tactile fremitus / chest expansion comparison
- JVP estimation with bed angle adjustment
- peripheral perfusion / cap refill
- pedal edema grading
- sacral edema in supine patient

### 10) Case progression engine
A huge upgrade:
- patient worsens if STEMI is not recognized
- rhythm changes on the monitor
- pain changes over time
- hypotension after nitrates in RV infarct variant
- cardiogenic shock if delayed treatment

This would transform the trainer from a static station into a true evolving emergency simulation.

## Best next step if you want maximum value
If I were prioritizing the next patch, I would do this order:
1. **State-driven patient reactions**
2. **Blood draw + vial selection mini-game**
3. **IV access + medication administration**
4. **Monitor accessory placement (SpO2, cuff, temp)**
5. **Case progression / deterioration logic**

That order gives the largest improvement in realism without forcing a full engine rewrite immediately.
