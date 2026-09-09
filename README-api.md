# API

This repository contains a NestJS API for the documented ticket workflow. Ticket records and audit events are persisted in SQLite through TypeORM.

## Run

```text
npm install --prefix backend
npm run backend
```

The API listens on `http://localhost:3000/api` when started from the project root.

For now, authentication is represented by these required headers:

```text
x-user-id: employee-1
x-user-role: employee | helpdesk | assignee | administrator
```

## Endpoints

```text
POST   /api/tickets
GET    /api/tickets
GET    /api/tickets/:id
POST   /api/tickets/:id/approve
POST   /api/tickets/:id/reject
PATCH  /api/tickets/:id/priority
POST   /api/tickets/:id/assign
POST   /api/tickets/:id/claim
POST   /api/tickets/:id/resolve
GET    /api/tickets/:id/audit-events
```

There is intentionally no comments endpoint. Status changes are controlled by workflow endpoints and cannot be performed through a generic status update.
