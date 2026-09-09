# Internal Operations Service Hub Architecture

## 1. Purpose and Scope

### Purpose

The Internal Operations Service Hub provides a controlled way for employees and the Helpdesk Team to manage internal operational requests. It replaces unstructured issue handling with a traceable workflow from request creation through resolution.

### Scope

- Employees submit requests (tickets) and track the progress
- Helpdesk receives and responds to all requests.
- Third-party workflow processing may be used to manage the internal operational service hub
- Zero trust, so will need to implement failure cases
- The workflow processing engine is inside the workflow boundary
- The actual company database is outside this service boundary

The system is for internal staff only. Payroll, external customer support, and vendor management are outside this architecture.

## 2. Structure and Flow

1. An employee opens the web interface and creates a request.
2. The web interface validates required fields and attachments before submission.
3. A validated request is sent to the workflow service through an API request.
4. The workflow service identifies the appropriate team using the issue type and project, then places the request in the relevant queue.
5. The Helpdesk Team approves or rejects the request and sets its priority. Rejections require an explanation.
6. The Helpdesk Team assigns a clear assignee and expected completion time.
7. The assignee claims the request, which starts the work timer. If it remains unclaimed for more than 24 hours, Helpdesk is notified.
8. The assignee works on the request and updates its status to `In Progress`. If the expected completion time is exceeded, Helpdesk is notified.
9. The assignee updates the status to `Resolved` when the issue is complete. Helpdesk is notified when the request is resolved.

### Core Components

| Component              | Responsibility                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Web interface          | User entry point, forms, validation feedback, request tracking, and error display                       |
| Workflow service       | Routing, approvals, priorities, assignment, timers, notifications, status transitions, and audit events |
| Company database       | Requests, users, assignments, comments, attachments metadata, deadlines, approvals, and audit records   |
| Notification mechanism | Alerts for assignment, inactivity, deadline breaches, rejection, completion, and requester updates      |
| Identity provider      | Authenticates employees and supplies identity and role information                                      |

## 3. Trust and Resilience

### Trust Model

The web interface, workflow service, and database are treated as separate trust zones. No component implicitly trusts another component merely because it is inside the organization or network.

- Authenticate every user and service request.
- Authorize actions by role and request ownership, including employee, Helpdesk, and assignee roles.
- Encrypt traffic between the browser, workflow service, and database.
- Encrypt sensitive stored data and attachments where organizational policy requires it.
- Validate all input on the server, even when client-side validation is present.
- Record authentication, authorization, request changes, assignments, approvals, status changes, notifications, and resolution details in an append-only audit trail.
- Avoid exposing internal error details to users; show a safe error reference and log diagnostic details securely.

### Failure and Recovery Behavior

| Failure                            | User-visible behavior                                | Recovery approach                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Web interface cannot load          | Show a web interface error                           | Allow retry, provide a correlation/reference ID, and monitor frontend availability                                                 |
| Workflow request fails             | Show a request failure                               | Use bounded retries for transient failures, avoid duplicate submissions with an idempotency key, and log the failed request        |
| Database is offline                | Show a database error or temporary-unavailable state | Keep the service available for safe read-only behavior where possible, retry connection, alert operators, and restore from backups |
| Notification delivery fails        | Request workflow remains authoritative               | Persist notification events, retry asynchronously, and expose undelivered notifications for operational follow-up                  |
| Deadline or timer processing fails | Preserve the request and deadline data               | Run scheduled jobs idempotently, detect missed jobs, and replay pending alerts                                                     |

The system should provide reliable uptime for internal business continuity and fast response for common operations. Database backups, restore testing, health checks, structured logs, metrics, and alerts are required operational safeguards.

## 4. Architectural Decisions

### Decision 1: Separate the web interface from workflow logic

The web interface handles presentation and user input, while the workflow service owns business rules and state transitions. This keeps validation and workflow behavior consistent across future clients and integrations.

### Decision 2: Use the workflow service as the system of record for process state

Assignment, priority, status, timers, approvals, deadlines, and notifications are controlled by the workflow service. The company database persists the resulting data.

### Decision 3: Use explicit state transitions

Requests should move through controlled states such as `Created`, `Pending Helpdesk Review`, `Approved`, `Rejected`, `Assigned`, `In Progress`, and `Resolved`. Each transition must record its actor, timestamp, and reason where applicable.

### Decision 5: Make retries safe

API submissions and background jobs must be idempotent. A request identifier or idempotency key prevents a retry from creating duplicate tickets, assignments, completion records, or notifications.

### Decision 6: Protect sensitive internal information by default

Access to requests and attachments is restricted by role and organizational need. Logs contain correlation IDs and operational details, but should not contain unnecessary personal or confidential content.
