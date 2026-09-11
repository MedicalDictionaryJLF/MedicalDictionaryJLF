# PT-v4 isolated Patient Trainer fix

This version remains **standalone only**. It has not been merged back into Medical Dictionary.

## What actually changed
- The standard cardiac auscultation points were recalibrated against the photograph itself. Aortic/pulmonic points are now close to the sternal borders rather than sitting over the pectoral muscles.
- Anterior lung points were moved inward onto the chest.
- Auscultation and percussion no longer have to share identical coordinates: each lung hotspot can render at a technique-specific position.
- Posterior lung points were recalibrated against the rear photograph.
- Posterior uses a real rear image, not the old vector model.

## Why this build cannot silently reuse the old exam implementation
The relevant assets/modules were renamed:
- `physicalExamMap.v4.js`
- `interactivePhysicalExam.v4.js`
- `clinicalEncounterPanels.v4.js`
- `peter_novak_front_52_v4.png`
- `peter_novak_back_52_v4.png`

The setup screen also shows `PT-v4`, so you can immediately tell whether the new build is actually loaded.
