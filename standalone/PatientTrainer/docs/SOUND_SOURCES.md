# Patient Trainer sound sources

The interactive physical-examination prototype separates three things that are very easy to blur together if one is feeling irresponsible:

1. **Recorded clinical audio** — an actual auscultation recording with a reuse license.
2. **Published reference simulation** — audio published in an open-access scientific source that simulates a pathology, explicitly labelled as simulation rather than a patient recording.
3. **Locally synthesized educational audio** — generated in the browser with Web Audio and never represented as a clinical recording.

The sound registry also stores `preferredHotspots` so future cases can attach each sound only to anatomically appropriate examination points.

## Recorded clinical audio in the library

| Sound ID | Sound | Preferred examination region | Source | Author | License |
|---|---|---|---|---|---|
| `normal_heart` | Normal S1/S2 heart sounds | Standard cardiac auscultation areas | Wikimedia Commons `File:HROgg.ogg` | James Heilman, MD | CC0 1.0 |
| `svt_heart` | Heart sounds during paroxysmal SVT | Cardiac auscultation areas | Wikimedia Commons `File:Ash-SVT.ogg` | Ashquacks | CC BY-SA 4.0 |
| `wheeze` | Wheezing respirations | Lung fields | Wikimedia Commons `File:Wheeze2O.ogg` | James Heilman, MD | CC BY-SA 3.0 |
| `crackles` | Pulmonary crackles in pneumonia | Lung fields | Wikimedia Commons `File:Crackles_pneumoniaO.ogg` | James Heilman, MD | CC BY-SA 3.0 |
| `ipf_velcro_crackles` | Fine Velcro-like crackles in IPF | Posterior lung bases | Wikimedia Commons `File:IPF_Lung_Sound.ogg` | IPFeditor | CC BY-SA 3.0 |
| `stridor` | Inspiratory/expiratory stridor | Trachea / upper airway | Wikimedia Commons `File:Stridor_NP_OGG_2.ogg` | James Heilman, MD; processed by Natural Philo | CC BY-SA 3.0 |
| `carotid_bruit` | Carotid bruit | Carotid arteries | Wikimedia Commons `File:MurmurO.ogg` | James Heilman, MD | CC BY-SA 3.0 |
| `bowel_obstruction` | Tinkling bowel sounds in SBO | Abdominal quadrants | Wikimedia Commons `File:SBOOgg.ogg` | James Heilman, MD | CC BY-SA 3.0 |

These files are streamed from Wikimedia Commons at runtime rather than copied into the repository. The source/license link is displayed next to the sound whenever it is used.

## Published reference simulations

The open-access *Heart energy signature spectrogram for cardiovascular diagnosis* supplementary audio is useful for expanding future cardiac cases. Wikimedia Commons identifies these as computer simulations, so the UI labels them **Published reference simulation**, not recorded patient audio.

| Sound ID | Reference sound | Preferred region | Wikimedia file | License |
|---|---|---|---|---|
| `mitral_valve_prolapse_reference` | Mitral valve prolapse with clicks | Mitral/apical area | `...S5.ogg` | CC BY 2.0 |
| `aortic_stenosis_reference` | Aortic stenosis | Aortic area, with carotid radiation mapping available | `...S6.ogg` | CC BY 2.0 |
| `pulmonary_stenosis_reference` | Pulmonary stenosis | Pulmonic area | `...S7.ogg` | CC BY 2.0 |
| `tetralogy_fallot_reference` | Acyanotic Tetralogy of Fallot example | Pulmonic / left sternal areas | `...S8.ogg` | CC BY 2.0 |
| `vsd_reference` | Ventricular septal defect | Lower left sternal / Erb region | `...S9.ogg` | CC BY 2.0 |

These entries broaden the sound atlas for future cases but **are not assigned to Peter Novak**, because his deterministic cardiovascular examination does not contain those murmurs.

## Locally synthesized educational audio

The following are generated locally with Web Audio and are always labelled **Simulated educational audio**:

- normal vesicular breathing
- normal bowel activity
- resonant lung percussion
- dull liver/solid-tissue percussion
- tympanic abdominal percussion
- flat dense-tissue percussion

A sufficiently comprehensive, clearly redistributable set of real bedside percussion recordings was not found during this research pass. Rather than quietly passing Foley sounds off as clinical data, this prototype synthesizes the notes and labels them honestly.

## Peter Novak mapping

The current single development case is intentionally conservative:

- five cardiac auscultation sites → real normal-heart recording
- carotids → no bruit sound because no bruit is present
- trachea → no stridor sound because no stridor is present
- twelve anterior/posterior lung points → simulated normal vesicular breath sound
- lung percussion → simulated resonant note
- abdomen → simulated normal bowel activity with tympanic notes except expected hepatic dullness in the RUQ
- visual inspection → subtle pallor and diaphoresis overlays

Future cases can swap only the deterministic point result/sound ID without rebuilding the avatar.
