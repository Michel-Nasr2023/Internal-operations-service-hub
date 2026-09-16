# Week 3 Full-Stack Delivery

## Delivered slice

This delivery protects the existing employee Service Request flow:

```text
React form -> POST /api/tickets -> NestJS validation and authorization -> SQLite -> response and saved ticket list
```

A newly created ticket starts in `Pending Helpdesk Review`. Helpdesk can approve it with a priority. Employees cannot approve tickets.

## Local setup

From the repository root:

```text
npm install --prefix backend
npm install --prefix frontend
```

Start the API and frontend in separate terminals:

```text
npm run backend
npm run frontend
```

Open `http://localhost:5173/`. The API is available at `http://localhost:3000/api`.

SQLite data is stored at `backend/data/tickets.sqlite` and is ignored by Git.

## API contract

### Create a ticket

```http
POST /api/tickets
x-user-id: employee-1
x-user-role: employee
Content-Type: application/json
```

Request body:

```json
{
  "title": "Laptop cannot connect to Wi-Fi",
  "description": "The issue affects the office connection.",
  "teamId": "it",
  "issueType": "hardware",
  "project": "internal"
}
```

A successful request returns HTTP `201` and a ticket with status `Pending Helpdesk Review`.

### Approve a ticket

```http
POST /api/tickets/:id/approve
x-user-id: helpdesk-1
x-user-role: helpdesk
Content-Type: application/json
```

Request body:

```json
{
  "priority": "high"
}
```

A successful request returns HTTP `201` and changes the ticket status to `Approved`.

## Local identities and boundaries

Authentication is intentionally simulated with request headers for this assignment:

| Identity     | Role       | Allowed example                           |
| ------------ | ---------- | ----------------------------------------- |
| `employee-1` | `employee` | Create a ticket and view own tickets      |
| `helpdesk-1` | `helpdesk` | Approve a pending ticket and set priority |

The allowed case is `helpdesk-1` approving a pending ticket. The denied case is `employee-1` attempting the same approval, which returns HTTP `403` and leaves the ticket unchanged.

This is local development authentication, not production authentication. A real identity provider will replace these headers later.

## Invalid request

A create request missing required fields, such as `title`, is rejected by the NestJS validation pipe with HTTP `400 Bad Request`. Extra fields are also rejected because the API uses `forbidNonWhitelisted`.

## Expected frontend failure

The frontend handles both API error responses and network failures. To exercise the expected failure manually:

1. Start the frontend.
2. Stop the backend or set `VITE_API_URL` to an unavailable API URL.
3. Reload the page.
4. The saved-ticket loading error is displayed in the page alert.
5. Submitting a ticket displays the submission error instead of silently failing.

The backend remains the source of truth; the frontend does not show a successful save when the API request fails.

## Automated confidence

Run the existing business workflow regression test:

```text
npm run backend:test
```

Run the real SQLite integration test:

```text
npm run backend:test:integration
```

It creates a ticket through `TicketsService`, reads it from a real temporary SQLite database, and verifies the saved status and audit event.

Run the API E2E test:

```text
npm run backend:test:e2e
```

It starts a Nest application with a temporary SQLite database and uses real HTTP requests to verify:

- employee ticket creation succeeds
- employee approval is denied with HTTP `403`
- Helpdesk approval succeeds
- malformed ticket creation is rejected with HTTP `400`

Build both applications:

```text
npm run backend:build
npm run frontend:build
```

## Scope note

This assignment does not add external integrations, runtime AI, RAG, MCP, CI/CD, deployment, monitoring, or production infrastructure. It adds tests and documentation around the existing narrow user-facing flow.
