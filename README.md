# Internal Operations Service Hub

The Internal Operations Service Hub is an internal helpdesk system for managing employee operational requests from creation through resolution.

> **Checking the project?** The Administrator, Helpdesk and Employee accounts are ready from the first start for quick checking, and new users are created with **Sign up**. See [Accounts for checking the project](#accounts-for-checking-the-project).

## Project Structure

```text
backend/     NestJS API, workflow rules, TypeORM, and SQLite persistence
frontend/    React employee interface
docs/        Product, architecture, and data-model decisions
```

The current workflow is employee ticket creation with AI intake analysis for Helpdesk:

```text
React form -> POST /api/tickets -> NestJS validation and authorization -> SQLite (saved at once) -> background Requesty AI analysis -> validated result shown to Helpdesk in the review panel
```

## Run Locally

**Requirements:** [Node.js](https://nodejs.org) **20 or newer** (LTS, includes npm) and git. Works on Windows, macOS and Linux; no database server is needed (SQLite is a file created on first start).

1. Get the code:

   ```text
   git clone https://github.com/Michel-Nasr2023/Internal-operations-service-hub.git
   cd Internal-operations-service-hub
   ```

2. Create the configuration file from the example (Windows: `copy backend\.env.example backend\.env`):

   ```text
   cp backend/.env.example backend/.env
   ```

   Then fill in `backend/.env`:

   | Setting | Needed for | Without it |
   | --- | --- | --- |
   | `AUTH_SECRET` | Signing sessions (any long random string) | A temporary secret is used, so everyone is signed out whenever the API restarts |
   | `RQSTY_API_KEY` | AI analysis of tickets | Tickets work normally; Helpdesk sees "AI analysis failed: not configured" |
   | `SMTP_*` (or `MAILJET_*`), `MAIL_FROM` | Sending password reset and invitation emails | Emails are kept in **Admin > System** instead of being sent (see [Email](#email)) |

3. Install dependencies once in each package:

   ```text
   npm install --prefix backend
   npm install --prefix frontend
   ```

4. Start the API and frontend in two terminals from the project root:

   ```text
   npm run backend
   npm run frontend
   ```

The API runs at `http://localhost:3000/api` (health check: `http://localhost:3000/api/health`) and the app at `http://localhost:5173`. SQLite stores data in `backend/data/tickets.sqlite`. Everything the hub stores (database, attachments, profile photos, backups) lives in `backend/data/`, whichever folder the API is started from; set `DATA_DIR` in `backend/.env` to move it, for example out of a folder synced by OneDrive.

### Accounts for checking the project

**Development accounts (quick checking).** Three accounts exist from the very first start, so every role can be tried straight away. They are also listed on the sign-in page.

| Role | Email | Password | Use it to |
| --- | --- | --- | --- |
| Administrator | admin@company.com | Admin12345 | Open the admin area: overview, users, system health, email outbox |
| Helpdesk | helpdesk@company.com | helpdesk123 | Review, approve, reject and assign tickets |
| Employee | employee@company.com | employee123 | Submit and follow tickets |

**The Administrator is pre-registered.** It cannot be created through sign-up, and it is the way into user management on a new installation. It is also created on an existing database that has no administrator.

**New users sign up.** To check the sign-up flow, choose **Sign up** on the sign-in page and create a new user with your own name and email. Every new sign-up is an **Employee**. The administrator can then change the role in **Admin > Users**, or add people there directly (they get an invitation email to set their own password). From **Admin > Users** the administrator can also disable or re-enable accounts, send password reset links and sign someone out of every session; these changes take effect immediately.

Suggested check of the whole workflow:

1. Sign up as a new user and submit a ticket.
2. Sign in as Helpdesk: review the ticket (with the AI analysis), approve it and assign it to the new user.
3. Sign in as the new user: open **My tasks**, claim the ticket, then resolve it with notes.
4. Sign in as Administrator: check **Overview**, **Users** and **System**.

Change these passwords before real use.

A role can also be changed from the command line (start the API once first so the database is up to date):

```text
npm run user:role -- jane.doe@company.com helpdesk
```

Roles: `employee`, `helpdesk`, `administrator`. The person is signed out and gets the new role at their next sign-in.

If a password needs to be set by the server operator (for example a demo password changed by a visitor): `npm run user:password -- admin@company.com Admin12345`.

### Email

Password reset emails contain a **6-digit code** (typed on the Forgot password page) and a link; invitations contain a link. Links point to `APP_URL` (default `http://localhost:5173`).

To send real email, add SMTP settings to `backend/.env` (see [backend/.env.example](backend/.env.example)) and restart the API:

| Provider | Settings |
| --- | --- |
| Gmail | `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=` a 16-character **App password** (Google Account > Security > 2-Step Verification > App passwords; your normal password will not work) |
| Outlook / Microsoft 365 | `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, your address and password (SMTP AUTH must be allowed for the mailbox) |
| Company mail server | Host, port and credentials from your IT team |
| Mailjet (for hosts that block SMTP, e.g. Railway) | `MAILJET_API_KEY` and `MAILJET_SECRET_KEY` from Mailjet (Account > API keys), with the `MAIL_FROM` address confirmed under Account > Senders. When these are set, they are used instead of SMTP. |

Set `MAIL_FROM` to the sender shown to recipients, e.g. `"Service Hub <you@gmail.com>"`. On start-up the API logs whether it could sign in to the mail server, and **Admin > System** shows the result plus every email with its delivery status (Sent / Retrying / Failed with the reason / Not sent). If the mail server is briefly unreachable, the email is sent again automatically after 1 and 5 minutes. Without SMTP settings, emails are kept in that outbox instead of being delivered (their content is never written to the server logs).

### Backups and recovery

The API copies the database to `backend/data/backups/` when it starts and every 6 hours, keeping one file per day for the last 7 days. To restore, stop the API, copy a backup over `backend/data/tickets.sqlite`, and start it again. `GET /api/health` tells monitoring (and the web app) whether the API, its database, the AI and email are working, without exposing any internal details.

## Tests and Release

```text
npm run backend:test      # 68 unit, integration and API end-to-end tests
npm run frontend:build    # type check and production build
npm run eval             # AI evals: 11 fixed tickets against the real AI, results in docs/evals
npm run smoke -- <url>    # final smoke test of a running hub, e.g. the live app
```

Every push runs the **release gate** on GitHub Actions ([release-gate.yml](.github/workflows/release-gate.yml)): backend type check, build and tests; frontend build; and a check that no `.env` file is committed. For a local smoke test, point it at the API: `SMOKE_API_URL=http://localhost:3000/api npm run smoke -- http://localhost:5173`.

The live app runs on Railway as one service (the API also serves the web app) with a persistent volume for the data; see [Deployment](docs/deployment.md).

See [Week 3 full-stack delivery](docs/week3-full-stack-delivery.md) for the original API contract, workflow tests, and build commands.
See [Week 4 production AI integration](docs/week4-production-ai.md) for the Requesty integration, AI output validation, and the direct UI evaluation cases.

## What It Does

- Allows every employee to submit requests with required details.
- Saves the ticket immediately, then has a Requesty AI model analyse it in the background. The model rewrites the employee's description into a clear summary for Helpdesk, classifies the issue type and severity, recommends a first step, and lists questions to ask the employee. Vague tickets are flagged as "Unclear request" with the questions needed to clarify them.
- Validates the AI response before saving it. Busy or overloaded provider responses (429/5xx) and unusable answers are retried up to 3 times. If the AI still cannot answer, the ticket is marked "AI analysis failed" with the reason, and Helpdesk can retry it; no substitute analysis is invented. When the AI service itself is down, the hub retries on its own after 2, 10 and 30 minutes.
- Shows the AI analysis, alongside the employee's original text, only to Helpdesk when reviewing the ticket. The AI-suggested severity is pre-selected as the priority.
- Lets employees choose the operational team (IT Operations, Facilities, Finance) for each request.
- Lets Helpdesk review requests, set priorities, and approve or reject them.
- Supports Helpdesk assignment, assignee claims, and progress updates.
- Sends alerts for unclaimed, overdue, and resolved requests.
- Maintains an audit trail for workflow and authorization-sensitive actions.
- Is safe to operate: a public health check that exposes nothing internal, logs that record ticket IDs and failure reasons but never ticket text or secrets, a release gate and a final smoke test.
- Keeps working when something goes wrong: sign-in attempt limits, safe simultaneous edits, protection against duplicate submissions, automatic retries for the AI and email, daily database backups, and clear messages in the browser when the server cannot be reached or a page fails to display.

## Main Workflow

```text
Created -> Helpdesk Review -> Approved -> Assigned -> In Progress -> Resolved
Helpdesk Review -> Rejected
```

If an assignee does not claim an assigned request within 24 hours, Helpdesk is notified. Helpdesk is also notified when an in-progress request exceeds its expected completion time and when a request is resolved.

## Project Scope

This project is designed for internal staff and operational teams. External customer support, payroll, and vendor management are outside its scope.

## Documentation

- [Product specification](docs/product_spec.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Week 3 full-stack delivery](docs/week3-full-stack-delivery.md)
- [Week 4 production AI integration](docs/week4-production-ai.md)
- [Week 5 operations and release](docs/week5-operations-and-release.md)
- [Deployment](docs/deployment.md)
- [Architecture decision record](docs/decisions/ADR-001.md)
