# AI Learning Events

The anamnesis trainer records local intent and AI-helper events without uploading anything by default.

## Local Event Shape

The event log prepared by `anamnesis-training/src/aiSupport.js` includes:

- `studentQuestion`
- `deterministicIntentGuess`
- `deterministicConfidence`
- `aiRescueUsed`
- `resolvedIntent`
- `fallbackUsed`
- `patientPhrasingUsed`
- `errors`
- `recordedAt`

## Upload Configuration

`LEARNING_EVENTS_ENDPOINT` is intentionally an empty string. When it is empty, events are logged locally and no network upload is attempted.

To enable uploads later, configure a backend endpoint that accepts JSON events and set:

```js
const LEARNING_EVENTS_ENDPOINT = "/api/learning-events";
```

Do not upload full conversations automatically. At interview end, the trainer asks whether the user wants to anonymously contribute the conversation. If accepted, the prepared payload contains transcript text, score, missed items, and debug intent events.

## Google Drive Flow

The safe future flow is:

1. Keep local event logging enabled for every interview.
2. Ask for explicit anonymous contribution consent at the end.
3. Send only the consented payload to a backend endpoint.
4. The backend writes the anonymized payload to a controlled Google Drive app folder or service-owned storage location.
5. Do not include student name, email, account ID, or other personal identifiers.

The current implementation stops at local logging and consent-gated payload preparation. No Google Drive upload endpoint is active yet.
