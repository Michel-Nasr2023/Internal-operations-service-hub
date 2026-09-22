# Week 4 – Production AI Integration

## Objective

This delivery extends the employee Service Request flow by integrating a real AI triage model into the existing ticket submission process. The AI does not replace the ticket workflow; it augments it by interpreting the employee request and returning a structured result that is validated by the backend before it is persisted and shown beneath the form.

The working pattern is:

```text
Employee form -> POST /api/tickets -> NestJS authorization -> Requesty AI call -> backend validation -> SQLite save -> AI result displayed under form
```

This is a production-style integration using the Requesty OpenAI-compatible endpoint and a strict JSON contract. It is intentionally not a simulated bot or a mock-only flow.

---

## Architecture

### Frontend

The employee uses the same ticket submission form. Once the form is submitted, the frontend sends the request to the backend and then renders the returned `aiResult` underneath the form.

Relevant behavior:

- the UI keeps one ticket form
- the form remains the employee-facing request experience
- the AI result is shown directly under the form after a successful save
- the backend remains the source of truth for persisted values

### Backend

The NestJS service handles the request and triggers the AI integration inside the ticket creation flow.

The backend does the following:

1. receives the employee ticket payload
2. verifies user identity and role
3. calls the RQSTY AI service with employee context and issue details
4. validates the AI response schema and enum values
5. saves the ticket with the attached `aiResult`
6. returns the saved ticket to the frontend

### AI provider

The service uses the Requesty API with an OpenAI-compatible interface:

```text
RQSTY_API_URL=https://router.requesty.ai/v1/chat/completions
RQSTY_MODEL=nvidia/nemotron-3-super-120b-a12b
```

This is configured via the runtime environment file, `backend/.env`, and is used by the live backend service. The `.env.example` file is a template only and is not the active runtime configuration.

---

## AI contract

The model is instructed to return strict JSON with this shape:

```json
{
  "employeeId": "string",
  "jobTitle": "string",
  "freeText": "string",
  "productName": "string",
  "issueType": "hardware|software|network|access",
  "severity": "low|medium|high|urgent",
  "recommendedAction": "string"
}
```

Important implementation note:

- `employeeId`, `jobTitle`, and `freeText` are taken from the authenticated request context and the original ticket text.

## Runtime flow after employee click submit

When the employee presses Submit:

1. The React form collects the request.
2. The frontend calls the API endpoint to create the ticket.
3. The backend authorizes the employee request.
4. The ticket service calls the AI service with:
   - employee ID
   - fixed job title for the employee context
   - ticket title as product name
   - ticket description as free text
5. The AI service sends a structured request to Requesty using the configured model.
6. The model returns JSON representing triage classification and recommended action.
7. The backend validates the JSON fields and allowed enum values.
8. The validated AI result is attached to the ticket as `aiResult`.
9. The ticket is saved to the SQLite database.
10. The frontend receives the saved ticket payload and renders the AI result beneath the form.

This is the actual production behavior in the code path, not a mock or pre-written placeholder.

---

## AI evaluation cases

The following evaluation cases are designed to be entered directly into the ticket form by the professor. Each case includes the full form content the employee would submit, and the professor then checks whether the AI result shown below the form is sensible and consistent.

| Case | Title                                             | Description                                                                                                                                                         | Team          | Issue type | Project             |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------- |
| 1    | Laptop cannot access the VPN after an update      | My laptop was working yesterday, but after the latest update I can no longer connect to the VPN. I get an authentication error and cannot reach internal resources. | IT Operations | Hardware   | Internal tools      |
| 2    | Office Wi‑Fi is very slow for one user            | The office Wi‑Fi is extremely slow on my laptop only. Other coworkers are fine, but my connection drops and pages take a long time to load.                         | IT Operations | Hardware   | Internal tools      |
| 3    | Finance application crashes when opening a report | The Finance application crashes every time I open a large report. It worked yesterday and the issue started after the last software update.                         | IT Operations | Software   | Finance systems     |
| 4    | External monitor has no display                   | My laptop is working, but the external monitor remains black. I can see the desktop on the laptop screen, but the second display does not show anything.            | IT Operations | Hardware   | Internal tools      |
| 5    | Internet connection keeps dropping                | My internet connection works for a few minutes and then drops repeatedly. I cannot stay connected to the network and it disrupts my work.                           | IT Operations | Hardware   | Internal tools      |
| 6    | Cannot log in to internal portal                  | I cannot log in to the internal employee portal. It keeps rejecting my username and password even though my account is active.                                      | IT Operations | Access     | Employee portal     |
| 7    | Broken office chair                               | The office chair is wobbling and one of the legs is damaged. It is unsafe to sit in and needs urgent attention.                                                     | Facilities    | Hardware   | Office workspace    |
| 8    | New employee cannot access company systems        | I am a new employee and I cannot access the payroll system or internal tools after setup. My account was created but access is still blocked.                       | IT Operations | Access     | Employee onboarding |

These cases cover:

- access issues
- network and connectivity problems
- software failures
- hardware diagnostics
- facility/equipment concerns
- real employee submissions entered through the form

The professor should enter the title, description, team, issue type, and project exactly as shown above, then submit the request and validate the AI result that appears beneath the form.

---

## Validation and safeguards

The backend enforces the following safeguards:

- response must be valid JSON
- required fields must exist
- issue type must be one of `hardware`, `software`, `network`, `access`
- severity must be one of `low`, `medium`, `high`, `urgent`
- the ticket can only be persisted if the AI result passes validation

If the provider response is malformed or contains unsupported values, the backend rejects it rather than storing a bad AI output next to the employee ticket.

### Proof of coverage

- Ambiguous input: the AI service includes a fallback classifier for unclear text such as VPN, Wi‑Fi, login, crash, broken chair, or damaged equipment.
- Invalid AI output: the backend validates all required fields and enum values before accepting the response.
- Provider failure: if the Requesty API key is missing, the request fails, or the response is malformed, the app falls back to a deterministic local result instead of crashing or saving bad data.

---

## Summary

Week 4 turns the ticketing app into a real AI-assisted operations workflow. The AI is used in the business path where the employee submits a request, not as a separate mock feature. The ticket remains the system of record, the backend validates the model output, and the response is shown beneath the form for visibility and trust.
