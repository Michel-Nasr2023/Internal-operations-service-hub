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
POST   /api/auth/forgot-password           ({ email }; always the same reply)
POST   /api/auth/reset-password/check      ({ token } -> { valid, purpose, email (masked) })
POST   /api/auth/reset-password/verify-code ({ email, code } -> { valid: true } or 400)
POST   /api/auth/reset-password            ({ token, newPassword })
POST   /api/auth/logout                  (records the sign-out in the audit log)
GET    /api/auth/users          (Helpdesk only)
GET    /api/health                       (public; { status, database }, or 503 when the database cannot be reached)
POST   /api/tickets                      (optional Idempotency-Key header: repeating a submission returns the same ticket)
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
| `auth`   | `LOGIN_SUCCEEDED`, `LOGIN_FAILED` (with the attempted email and the reason), `LOGIN_LOCKED` (attempt limit reached), `SIGNUP`, `SIGNUP_FAILED`, `LOGOUT` |
| `ticket` | `TICKET_SUBMITTED`, `TICKET_APPROVED`, `TICKET_REJECTED`, `PRIORITY_CHANGED`, `TICKET_ASSIGNED`, `TICKET_CLAIMED`, `TICKET_RESOLVED`, `COMMENT_ADDED` |
| `access` | `SESSION_REJECTED` (401: missing, forged or expired session), `ACCESS_DENIED` (403: role not allowed)                                                 |

Each entry records the time, actor and role, target, outcome, a short summary, the IP address, the browser, and a request ID. Every API response carries the same ID in the `X-Request-Id` header, so a user-reported problem can be matched to its log entry. Passwords, tokens and full ticket text are never logged.

Each ticket also keeps its own workflow history, saved atomically with the ticket, which `GET /api/tickets/:id/audit-events` returns with actor names. On first start the audit log is back-filled from that history.

## Who handled a ticket

Tickets record `reviewedBy` / `reviewedAt` (the Helpdesk member who approved or rejected it) and `assignedBy` (who gave it to its current assignee). Responses include their names and photos (`reviewedByName`, `assignedByName`, ...), and approval, rejection and assignment notifications name the person. Tickets from before this change are filled in from their history on start-up; returning a ticket to the queue clears `assignedBy`.

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
- `source: "failed"`: the AI could not answer. `failureCode` is `not-configured`, `timeout`, `rate-limited`, `provider-error`, `network`, `invalid-response` or `unavailable` (not sent, because requests are paused after repeated outages), and `failureReason` explains it in plain language. No substitute analysis is generated.

Busy or overloaded responses (429, 5xx), network errors and unusable answers are retried up to 3 times, with 5 s and 15 s pauses. Timeouts and rejected API keys are not retried. Each request waits up to 90 s (`RQSTY_TIMEOUT_MS`). Tickets still pending when the API restarts are picked up again on start-up. Outcomes are recorded in the audit log as `AI_ANALYSIS_COMPLETED`, `AI_ANALYSIS_FAILED` and `AI_ANALYSIS_REQUESTED`.

When the AI service itself is the problem (timeouts, network errors, 429/5xx), the failure is marked `temporary` and the hub tries again on its own after 2, 10 and 30 minutes (`retryAt` and `autoRetries` on the failure; checked every minute and after restarts). After 3 such failures in a row, AI requests pause for 2 minutes, so new tickets fail at once (`unavailable`) instead of each waiting for a timeout. Helpdesk's retry button works at any time.

## Reliability

- **Sign-in limits:** 5 failed sign-ins for one account, or 30 from one network address, within 15 minutes pause sign-in for the rest of that window (`429` with a `Retry-After` header, before any password check). Also per network address: 20 sign-ups per hour and 10 "forgot password" requests per 15 minutes. Password hashing runs off the main thread, so sign-ins never stall other requests.
- **Simultaneous changes:** a ticket is saved only if its `version` is unchanged since it was read. Otherwise the action runs again on the latest copy, so it never overwrites someone else's change; if it no longer applies (e.g. already approved), the reply is the usual `409` with the current state.
- **Duplicate submissions:** with an `Idempotency-Key` header (8–100 letters, digits, `-` or `_`), `POST /api/tickets` creates at most one ticket per key and requester; repeats return that ticket.
- **Single-statement writes:** every request shares one SQLite connection, so the API opens no transactions (one request's rollback could otherwise undo another's work); each write is one statement, and the database waits up to 5 s for a lock before failing.
- **Files:** a missing stored file answers `404` and a locked one `503`, for that download only.
- **Responses:** ticket responses leave out the workflow history; read it with `GET /api/tickets/:id/audit-events`.
- **Background jobs:** the AI queue, scheduled alerts, email retries and backups handle their own errors; an unexpected error is logged and the API keeps running.

## Attachments

Attachments are optional. The requester can attach files to their ticket while it is open (`stage: "submission"`), and the assignee can attach files once they have claimed it, typically when resolving (`stage: "resolution"`). Anyone who can read the ticket can list and download them.

- Up to 5 files per upload, 10 MB each (larger files get `413`), and 10 per ticket.
- Allowed types: png, jpg, jpeg, gif, webp, pdf, txt, log, csv, docx, xlsx. A file's first bytes must match its extension, so a renamed executable or script is refused. An upload is all-or-nothing.
- File bytes are stored on disk under a random ID in `backend/data/attachments/` (override with `ATTACHMENTS_DIR`); only metadata is stored in SQLite. Downloads are always served as file downloads with `X-Content-Type-Options: nosniff`.
- Each upload adds an `ATTACHMENTS_ADDED` entry to the ticket history and the audit log.

## Profile

Every route acts on the signed-in user only; role and email cannot be changed here.

```text
GET    /api/profile
PATCH  /api/profile                      ({ firstName, lastName, jobTitle }; empty jobTitle clears it)
POST   /api/profile/password             ({ currentPassword, newPassword })
POST   /api/profile/avatar               (multipart/form-data, field "avatar")
DELETE /api/profile/avatar
GET    /api/users/:id/avatar             (any signed-in user; served inline as an image)
```

- Passwords (sign-up and changes) need at least 8 characters with letters and numbers. A change requires the current password and must differ from it.
- Profile photos: PNG, JPG or WebP, up to 2 MB, checked by content like attachments, stored in `backend/data/avatars/` (override with `AVATARS_DIR`). The old file is deleted when a photo is replaced or removed.
- Audit log entries: `PROFILE_UPDATED`, `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILED` (with the reason, never the password), `AVATAR_UPDATED`, `AVATAR_REMOVED`.

## Sessions

Every request with a session token is checked against the account: the account must still exist and be active, its role must match the token, and the token must have been issued after the account's `sessionsRevokedAt`. Otherwise the API answers `401` with the reason. Sessions are revoked when a password is changed or reset, when an administrator changes a role or disables an account, and on "sign out everywhere". Changing your own password returns a new token for the current session.

## Password reset

`forgot-password` emails a 6-digit code and a single-use link (`APP_URL/?reset=<token>`); both expire after 15 minutes and earlier unused ones are cancelled. At most 3 emails are sent per account per hour, and the reply never reveals whether the email has an account. Only SHA-256 hashes of the token and code are stored.

The code flow is `POST /api/auth/reset-password/verify-code` (`{ email, code }`) then `POST /api/auth/reset-password` (`{ email, code, newPassword }`); the link flow sends `{ token, newPassword }`. Every failure gives the same message. After 5 wrong codes the reset is cancelled and a new email must be requested. Invitations from administrators use the same mechanism with a 72-hour link. Audit actions: `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_RESET_FAILED`, `USER_INVITED`, `INVITE_ACCEPTED`.

## Administration

Administrators only (`403` for everyone else). Administrators can also use every Helpdesk endpoint.

```text
GET    /api/admin/overview
GET    /api/admin/users                      (?search=&role=&status=)
POST   /api/admin/users                      ({ email, firstName, lastName, jobTitle?, role }; sends an invitation)
PATCH  /api/admin/users/:id                  ({ email?, firstName?, lastName?, jobTitle?, role?, status? })
POST   /api/admin/users/:id/handover         ({ mode: "reassign", toUserId } or { mode: "queue" })
POST   /api/admin/users/:id/password-reset
POST   /api/admin/users/:id/sign-out
GET    /api/admin/email-outbox
GET    /api/admin/system
```

Safeguards: administrators cannot change their own role or disable themselves, and at least one active administrator must remain. A person who still holds Assigned or In Progress tickets cannot be disabled or moved to Helpdesk (`409`) until those tickets are handed over: `reassign` gives them to another active employee (in-progress work returns to Assigned so the timer restarts, and the new assignee is notified), `queue` returns them to Helpdesk as Approved and unassigned. Each ticket's history records `TICKET_REASSIGNED` or `TICKET_RETURNED_TO_QUEUE` with the reason, and the audit log records `TICKETS_HANDED_OVER`. Audit actions: `USER_CREATED`, `USER_UPDATED`, `USER_ROLE_CHANGED`, `USER_DISABLED`, `USER_ENABLED`, `USER_SESSIONS_REVOKED`.
