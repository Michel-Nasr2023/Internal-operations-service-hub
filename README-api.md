# API

This repository contains a NestJS API for the documented ticket workflow. Ticket records and audit events are persisted in SQLite through TypeORM.

## Run

```text
npm install --prefix backend
npm run backend
```

The API listens on `http://localhost:3000/api` when started from the project root.

Authentication uses a signed session token. `POST /api/auth/login` (or `/api/auth/signup`) returns a `token`; send it on every other request:

```text
Authorization: Bearer <token>
```

The user ID and role are read from the token, which is HMAC-signed with `AUTH_SECRET` and expires after 8 hours. Requests without a valid token receive `401`. Passwords are stored as salted scrypt hashes.

## Endpoints

```text
POST   /api/auth/login
POST   /api/auth/signup
POST   /api/auth/logout                  (records the sign-out in the audit log)
GET    /api/auth/users          (Helpdesk only)
POST   /api/tickets
GET    /api/tickets
GET    /api/tickets/:id
POST   /api/tickets/:id/approve           ({ priority } or { priority, assigneeId, expectedDurationHours } to approve and assign in one step)
POST   /api/tickets/:id/reject
PATCH  /api/tickets/:id/priority
POST   /api/tickets/:id/assign
POST   /api/tickets/:id/claim
POST   /api/tickets/:id/resolve
POST   /api/tickets/:id/ai-analysis      (Helpdesk: run the AI analysis again, e.g. after it failed)
POST   /api/tickets/:id/view             (marks the ticket as opened by the current user)
GET    /api/tickets/:id/attachments
POST   /api/tickets/:id/attachments        (multipart/form-data, field "files")
GET    /api/tickets/:id/attachments/:attachmentId/download
GET    /api/tickets/:id/comments
POST   /api/tickets/:id/comments
GET    /api/tickets/:id/audit-events
GET    /api/notifications                (current user's latest 50)
POST   /api/notifications/:id/read
POST   /api/notifications/read-all
GET    /api/audit-log                    (Helpdesk only; ?category=auth|ticket|access&outcome=success|failure|denied&search=&before=&limit=)
```

## Audit log

Every security- and workflow-relevant action is written to the append-only `audit_log` table. There is no endpoint that edits or deletes entries.

| Category | Actions                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`   | `LOGIN_SUCCEEDED`, `LOGIN_FAILED` (with the attempted email and the reason), `SIGNUP`, `SIGNUP_FAILED`, `LOGOUT`                                      |
| `ticket` | `TICKET_SUBMITTED`, `TICKET_APPROVED`, `TICKET_REJECTED`, `PRIORITY_CHANGED`, `TICKET_ASSIGNED`, `TICKET_CLAIMED`, `TICKET_RESOLVED`, `COMMENT_ADDED` |
| `access` | `SESSION_REJECTED` (401: missing, forged or expired session), `ACCESS_DENIED` (403: role not allowed)                                                 |

Each entry records the time, actor and role, target, outcome, a short summary, the IP address, the browser, and a request ID. Every API response carries the same ID in the `X-Request-Id` header, so a user-reported problem can be matched to its log entry. Passwords, tokens and full ticket text are never logged.

Each ticket also keeps its own workflow history, saved atomically with the ticket, which `GET /api/tickets/:id/audit-events` returns with actor names. On first start the audit log is back-filled from that history.

## Notifications

Notifications are stored in SQLite, one row per recipient:

| Event                                         | Recipient                                             |
| --------------------------------------------- | ----------------------------------------------------- |
| Ticket submitted                              | Helpdesk                                              |
| Ticket approved or rejected                   | Requester                                             |
| Ticket assigned                               | Assignee                                              |
| Assigned but not claimed for 24 hours         | Helpdesk                                              |
| In progress past its expected completion time | Helpdesk                                              |
| Ticket resolved                               | Helpdesk and requester                                |
| Comment added                                 | Everyone else involved: requester, assignee, Helpdesk |

The 24-hour and overdue conditions are checked when the API starts and then every 5 minutes (`NOTIFICATION_CHECK_INTERVAL_MS` overrides this; `0` disables it). Each alert is stored once per ticket and recipient, however many times the check runs.

Comments can be read and added by the requester, the assignee and Helpdesk while a ticket is open; they close when the ticket is Resolved or Rejected. Comments never change the ticket status. Status changes are controlled by workflow endpoints and cannot be performed through a generic status update.

## AI analysis

`POST /api/tickets` saves the ticket straight away with `aiResult: { source: "pending" }`. A background queue then asks the AI model to analyse it, one ticket at a time so the provider's concurrent-request limit is respected. The result replaces `aiResult` with one of:

- `source: "ai"`: the model's analysis (`summary`, `clarifiedDescription`, `issueType`, `severity`, `recommendedAction`, `missingInformation`, `isUnclear`).
- `source: "failed"`: the AI could not answer. `failureCode` is `not-configured`, `timeout`, `rate-limited`, `provider-error`, `network` or `invalid-response`, and `failureReason` explains it in plain language. No substitute analysis is generated.

Busy or overloaded responses (429, 5xx), network errors and unusable answers are retried up to 3 times, with 5 s and 15 s pauses. Timeouts and rejected API keys are not retried. Each request waits up to 90 s (`RQSTY_TIMEOUT_MS`). Tickets still pending when the API restarts are picked up again on start-up. Outcomes are recorded in the audit log as `AI_ANALYSIS_COMPLETED`, `AI_ANALYSIS_FAILED` and `AI_ANALYSIS_REQUESTED`.

## Attachments

Attachments are optional. The requester can attach files to their ticket while it is open (`stage: "submission"`), and the assignee can attach files once they have claimed it, typically when resolving (`stage: "resolution"`). Anyone who can read the ticket can list and download them.

- Up to 5 files per upload, 10 MB each (larger files get `413`), and 10 per ticket.
- Allowed types: png, jpg, jpeg, gif, webp, pdf, txt, log, csv, docx, xlsx. A file's first bytes must match its extension, so a renamed executable or script is refused. An upload is all-or-nothing.
- File bytes are stored on disk under a random ID in `backend/data/attachments/` (override with `ATTACHMENTS_DIR`); only metadata is stored in SQLite. Downloads are always served as file downloads with `X-Content-Type-Options: nosniff`.
- Each upload adds an `ATTACHMENTS_ADDED` entry to the ticket history and the audit log.
