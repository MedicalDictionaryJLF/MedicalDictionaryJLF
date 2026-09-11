# PT-v15 Examination Distress Scene Patch

This patch contains only the relevant updated files for the standalone Patient Trainer repository.

## Repository-relative files

- `src/ui/interactivePhysicalExam.v6.js`
- `styles.v12.css`
- `docs/PT_V15_EXAM_SCENE_ROADMAP.md`

## What this patch changes

### Examination scene / patient presentation
- Rebuilds the examination workspace into a more explicit **emergency-room bedside scene**.
- Adds an ER **bed, pillow, railings, sheet, and room staging** behind the patient.
- Makes Peter appear more **distressed / in pain / sweaty / visibly uncomfortable**.
- Adds a **responsive bedside status strip** so the patient appears to react and answer during the examination.
- Adds distress badges such as **Distressed**, **Chest pain**, **Diaphoretic**, and **Responding**.

### Hookup depiction
- Adds a **Bedside setup switch** in the examination toolbar:
  - `No hookups`
  - `ECG attached`
  - `Monitor attached`
- When ECG or monitor is selected, the patient is visually depicted with **limb and chest electrodes/wires**.
- When Monitor is selected, a **small inline ER monitor depiction** appears in the room.

### Notes
- This patch focuses on the **examination scene** only. It does not replace the separate full monitor engine.
- It is designed as a visual/interaction-layer upgrade that can later be connected to deeper state logic.

## Apply
Copy these files into the repository root and overwrite the originals.
