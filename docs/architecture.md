# Internal Operations Service Hub — Architecture

## 1. Purpose and scope

A web application for employees to submit operational requests and for Helpdesk to process them from review to resolution. Internal staff only; payroll, customer support and vendor management are out of scope.

## 2. Components

| Component              | Technology                       | Responsibility                                                           |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Web interface          | React + Vite                     | Forms, tables, review panels, notifications bell, admin pages            |
| API / workflow service | NestJS (TypeScript)              | Business rules, state transitions, authorization, validation             |
| Database               | SQLite via TypeORM               | Users, tickets, comments, attachments metadata, notifications, audit log |
| File storage           | Local disk (`backend/data/`)     | Ticket attachments and profile photos                                    |
| AI provider            | Requesty (OpenAI-compatible API) | Ticket analysis on submission                                            |
| Email                  | SMTP (e.g. Gmail) via Nodemailer | Password reset codes and account invitations                             |

API modules: `auth` (sign-in, sessions, password reset), `tickets` (workflow, comments, attachments, AI queue), `notifications`, `audit`, `profile`, `admin`, `mail`.

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
- **Password reset:** single-use 6-digit code and link, stored hashed, 15-minute expiry, 5 attempts, 3 emails per hour.
- **Audit log:** append-only record of sign-ins, refused requests, ticket actions and admin actions, with IP, browser and request ID (`X-Request-Id`).

## 5. Failure handling

| Failure                                               | Behaviour                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AI unavailable or invalid answer                      | Retried up to 3 times; then saved as "AI analysis failed" with the reason; Helpdesk can retry |
| Email cannot be sent                                  | Kept in the outbox with status "failed" and the reason (Admin > System)                       |
| Notification cannot be stored                         | Logged; the workflow action still succeeds                                                    |
| Server restarts                                       | Pending AI analyses and missed 24 h / overdue alerts are picked up on start-up                |
| Session revoked or expired                            | User is returned to sign-in with the reason                                                   |
| Invalid workflow action (e.g. ticket already handled) | Clear error; the panel reloads the current state                                              |

## 6. Architectural decisions

1. **Separate UI and workflow logic.** The browser only presents data; all rules live in the API.
2. **Explicit state transitions.** Only defined transitions are allowed, each recorded with actor, time and reason.
3. **Relational storage** as the system of record — see [ADR-001](decisions/ADR-001.md).
4. **AI in the background.** Keeps submission fast and makes AI failures visible instead of hidden.
5. **Privacy by default.** Employees only access tickets they requested or are assigned; logs never contain passwords or tokens.

## 7. Testing and development setup

- Automated tests (Jest): workflow rules, AI retries and failures, scheduled notifications, a SQLite integration test, and API end-to-end tests for tickets, sign-in, profile, password reset and administration.
- An empty database is seeded with three development accounts (Employee, Helpdesk, Administrator), listed on the sign-in page.
