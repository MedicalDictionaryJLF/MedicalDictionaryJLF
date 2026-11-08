# Medical Dictionary v3.6.1: Patient Trainer log upload repair

**Source revision:** `main` at `88c2df080bca8223145fb5bcee243d4298e6446f` (8 November 2026).
**Scope:** Patient Trainer session persistence, log submissions, and contrast of the debrief modal. Proposed for review only; this branch does not alter `main` until explicitly merged.

## Why this patch exists

The browser sends an opt-in POST to `https://medical-dictionary-jlf.vercel.app/api/patient-trainer-log`. The matching Vercel handler did not exist in the repository. In the mobile screenshot, the app retained the session locally but could not upload it.

## Scope of changes

- `api/patient-trainer-log.js`: new server-side relay to Google Apps Script. Validates requests, filters payload, bounds size, uses a server-side timeout, keeps secrets server-side, and returns success only after the destination confirms the matching session was stored.
- `google-apps-script/Code.gs`: matching private Drive receiver, using session IDs to prevent duplicate files on repeated attempts. Installing the source in GitHub **does not deploy the Apps Script**.
- `anamnesis-training/src/main.js`: one upload per session at a time; 30-second timeout, visible failure message, explicit privacy notice, local JSON backup.
- `assets/js/services/patient-trainer-session-store.js`: never reports a successful local save after browser storage fails.
- `anamnesis-training/styles.css` and `anamnesis-training/index.html`: restore text contrast in the debrief modal and ensure changed assets are refreshed on mobile.
- Two regression test files under `scripts/`.

The patch does not replace 3D assets, patient cases, examination mechanics, navigation, dictionaries, or quizzes.

## Before a live field test

1. Confirm that the Google Drive folder intended for submitted logs is private. One existing candidate is `Patient trainer/Chat logs`.
2. Install or update the receiver from `google-apps-script/Code.gs` in Google Apps Script. Set **Script Properties** `PATIENT_TRAINER_LOG_FOLDER_ID` to the actual folder ID and `PATIENT_TRAINER_UPLOAD_SHARED_SECRET` to a strong private secret. Deploy as a Web App executing as its owner and record its `/exec` URL.
3. Check the Vercel project `medical-dictionary-jlf` **production** environment variables `PATIENT_TRAINER_APPS_SCRIPT_URL` and `PATIENT_TRAINER_UPLOAD_SHARED_SECRET`; they must match the deployed receiver. They were present during inspection, but their values and connectivity were not verified. Never expose them to the frontend or GitHub.
4. After reviewing and merging the PR, deploy the backend from the correct revision using Vercel and let the frontend deployment publish the changed static Patient Trainer files. GitHub Pages and Vercel are distinct deployments.
5. Confirm the configured `https://medical-dictionary-jlf.vercel.app/api/patient-trainer-log` hostname is publicly reachable without Vercel SSO. Verify CORS `OPTIONS` from `https://medicaldictionaryjlf.github.io` and a real POST. A protected deployment alias can still block access.
6. Run a session using **fictional** patient data, press Submit, verify the new Drive file and server response; resend the same session ID to confirm there is no duplicate. Test browser reload, offline operation, manual retry and JSON download.

## Local regression checks

```bash
node --test scripts/patient-trainer-log-tests.cjs
node scripts/patient-trainer-session-store-tests.mjs
node scripts/patient-trainer-phase1-tests.mjs
node scripts/patient-trainer-anamnesis-tests.mjs
node --check anamnesis-training/src/main.js
node --check api/patient-trainer-log.js
```

Local regression testing succeeded before preparing this branch, including eight relay test cases, simulated Apps Script storage, local save failure, and the existing eight-patient anamnesis regression. **A complete browser-to-Vercel-to-Apps-Script-to-Drive production submission has not been verified.** The patch must not be presented as a completed live repair until the deployment and real end-to-end test succeed.

## Privacy

The student's typed interview text is included in the log. A random anonymous app ID does not guarantee that free-form text is anonymous. Use fictional patients, and never submit real clinical identifying information. The downloaded backup should also be stored privately.
