# Internal Operations Service Hub — Architecture

## 1. Purpose and scope

A web application for employees to submit operational requests and for Helpdesk to process them from review to resolution. Internal staff only; payroll, customer support and vendor management are out of scope.

## 2. Components

| Component              | Technology                       | Responsibility                                                           |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Web interface          | React + Vite                     | Forms, tables, review panels, notifications bell, admin pages            |
| API / workflow service | NestJS (TypeScript)              | Business rules, state transitions, authorization, validation             |
| Database               | SQLite via TypeORM               | Users, tickets, comments, attachments metadata, notifications, audit log |
| File storage           | Local disk (`backend/data/`)     | Ticket attachments, profile photos and database backups                  |
| AI provider            | Requesty (OpenAI-compatible API) | Ticket analysis on submission                                            |
| Email                  | SMTP (e.g. Gmail) via Nodemailer | Password reset codes and account invitations                             |

API modules: `auth` (sign-in, sessions, password reset), `tickets` (workflow, comments, attachments, AI queue), `notifications`, `audit`, `profile`, `admin`, `mail`, `system` (health check, backups).

## 3. Main flow

1. Employee submits a ticket → validated → saved as **Pending Helpdesk Review**.
2. A background queue sends it to the AI; the result (or a recorded failure) is saved on the ticket. Submission never waits for the AI.
3. Helpdesk reviews the ticket (with the AI analysis) and approves with a priority and an assignee, or rejects with a reason.
4. The assignee claims it (**In Progress**, timer starts), comments as needed, then resolves it with notes.
5. Each step creates notifications and audit entries. A scheduled check (start-up + every 5 min) alerts Helpdesk about tickets unclaimed for 24 h or overdue.

## 4. Security

- **Passwords:** salted scrypt hashes; minimum 8 characters with letters and numbers.
- **Sessions:** HMAC-signed tokens (8 h). Every request is checked against the account, so disabling a user, changing a role, changing/resetting a password or "sign out everywhere" takes effect immediately.
- **Authorization:** enforced on the server by role (employee / helpdesk / administrator) and by relationship to the ticket (requester or assignee).
- **Validation:** all input validated on the server; uploads checked by file signature, not just extension.
- **Attempt limits:** 5 failed sign-ins per account (30 per network address) pause sign-in for 15 minutes; sign-ups and reset requests are also limited per address.
- **Password reset:** single-use 6-digit code and link, stored hashed, 15-minute expiry, 5 attempts, 3 emails per hour.
- **Audit log:** append-only record of sign-ins, refused requests, ticket actions and admin actions, with IP, browser and request ID (`X-Request-Id`).

## 5. Failure handling

| Failure | Behaviour |
| --- | --- |
| AI invalid answer or error | Retried up to 3 times; then saved as "AI analysis failed" with the reason; Helpdesk can retry |
| AI service down | Retried automatically after 2, 10 and 30 min; after 3 outages in a row, AI requests pause for 2 min so tickets are not held up |
| Email cannot be sent | Temporary problems are sent again after 1 and 5 min; otherwise shown as "failed" with the reason (Admin > System) |
| Notification cannot be stored | Logged; the workflow action still succeeds |
| Two people change a ticket at once | The save checks the ticket's version; the second action is re-checked on the latest state, so nothing is overwritten |
| Same ticket submitted twice (double click, dropped connection) | The form sends one key per submission; the server returns the ticket already created |
| Many wrong passwords | Refused with "try again in N minutes" before any password check |
| Stored file missing or locked | Only that download fails, with a clear message |
| Database locked or damaged | Waits up to 5 s for a lock; backups at start-up and every 6 h (one per day, last 7 days) in `data/backups` |
| Unexpected server error | Logged; the server keeps running |
| Server restarts | Pending AI analyses, due retries and missed 24 h / overdue alerts are picked up on start-up |
| Server unreachable (browser) | Requests stop after 30 s with a clear message; a banner shows "Reconnecting" and checks the health endpoint until the server is back |
| A page fails to display | Only that page shows an error with "Try again"; the top bar and other pages keep working |
| Session revoked or expired | User is returned to sign-in with the reason |
| Invalid workflow action (e.g. ticket already handled) | Clear error; the panel reloads the current state |

## 6. Architectural decisions

1. **Separate UI and workflow logic.** The browser only presents data; all rules live in the API.
2. **Explicit state transitions.** Only defined transitions are allowed, each recorded with actor, time and reason.
3. **Relational storage** as the system of record — see [ADR-001](decisions/ADR-001.md).
4. **AI in the background.** Keeps submission fast and makes AI failures visible instead of hidden.
5. **Privacy by default.** Employees only access tickets they requested or are assigned; logs never contain passwords or tokens.
6. **Single-statement writes with version checks.** All requests share one SQLite connection, so the API uses no transactions; each write is one statement, and ticket saves use optimistic locking on the `version` field.

## 7. Testing and development setup

- Automated tests (Jest): workflow rules, AI retries, outages and automatic retries, scheduled notifications, email retries, backups, simultaneous edits, SQLite integration tests, and API end-to-end tests for tickets (including duplicate submissions and missing files), sign-in (including attempt limits), profile, password reset and administration.
- An empty database is seeded with three development accounts (Employee, Helpdesk, Administrator), listed on the sign-in page.
- All data lives in `backend/data/`, whichever folder the server is started from; `DATA_DIR` can move it (e.g. out of OneDrive).
