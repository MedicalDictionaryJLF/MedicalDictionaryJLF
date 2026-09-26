# Patient Trainer Google Drive uploader

This Apps Script is the private Drive-writing layer for completed, anonymised Patient Trainer sessions. The browser must **not** call this script directly. The browser calls the public application endpoint (`/api/patient-trainer-log`), which validates and sanitises the payload, rate-limits clients, then forwards it to this script with a server-only shared secret.

## Deployment

1. In the developer Google Drive, create a dedicated folder such as `Medical Dictionary/Patient Trainer/Chat Logs/` and copy only its folder ID.
2. Create a standalone Google Apps Script project owned by the developer and copy `PatientTrainerLogEndpoint.gs` into it.
3. In **Project Settings -> Script Properties**, add:
   - `PATIENT_TRAINER_DRIVE_FOLDER_ID` = the dedicated Chat Logs folder ID.
   - `PATIENT_TRAINER_UPLOAD_SHARED_SECRET` = a long random secret (at least 32 random bytes recommended).
4. Deploy the Apps Script as a **Web app**, executing as the developer. Configure access so the server-side proxy can POST to it. Do not place this Web App URL in frontend code.
5. Copy the `/exec` Web App URL into the hosting platform's server-side environment variable `PATIENT_TRAINER_APPS_SCRIPT_URL`.
6. Put the **same** random secret in the hosting platform's server-side environment variable `PATIENT_TRAINER_UPLOAD_SHARED_SECRET`.
7. Redeploy the web backend.

The Apps Script creates one JSON file per session using Europe/Bratislava time in the filename and the ISO timestamps already present in the JSON. Duplicate session UUIDs are treated idempotently: an existing file is returned rather than creating another copy.

## Security boundary

Do not put the Drive folder ID, Apps Script URL, shared secret, OAuth access/refresh tokens, service-account keys, or any reusable Drive credential in HTML/CSS/frontend JavaScript. The frontend only knows `PATIENT_TRAINER_LOG_ENDPOINT`.
