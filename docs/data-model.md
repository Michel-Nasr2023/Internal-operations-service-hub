# Internal Operations Service Hub Data Model

## 1. Domain

### Core entities

| Entity                               | Purpose and important attributes                                                                                                                                       | Ownership                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **User**                             | Employee identity from the identity provider: `id`, name, department, active status                                                                                    | Identity provider is authoritative; the service stores a reference and role/department snapshot needed for authorization and audit |
| **Role / Membership**                | User's role and team membership, such as employee, Helpdesk, assignee, or administrator                                                                             | Organization/identity administration                                                                                               |
| **Team**                             | Operational queue that receives work, with a team leader and supported issue types/projects                                                                            | Operations administration                                                                                                          |
| **Project**                          | Business or technical context used for routing                                                                                                                         | Operations administration                                                                                                          |
| **Issue type**                       | Category used with project to determine the target team                                                                                                                | Operations administration                                                                                                          |
| **Ticket**                           | The request being processed: requester, department, issue type, project, title, description, priority, current state, timestamps, and version                          | Workflow service; requester owns the business request, but the service owns workflow state                                         |
| **Assignment**                       | The assignment of a ticket to a team and one assignee; includes assigned-by, assignment time, expected completion time, claim time, and resolution time | Helpdesk manages it; workflow service enforces it                                                                                  |
| **Comment / Status update**          | Human progress notes and status context attached to a ticket                                                                                                           | Author owns the submitted content; ticket retains it                                                                               |
| **Attachment**                      | Metadata and secure object-storage reference for files submitted with a ticket                                                       | Ticket retains metadata; object storage owns file bytes; access follows ticket authorization                                       |
| **Approval**                         | Helpdesk approval decision and rejection reason                                                                                                                        | Helpdesk owns the decision; workflow service validates authorization                                          |
| **Notification**                     | Durable alert request and delivery status for assignment, inactivity, deadline, rejection, completion, or requester updates                                            | Workflow service owns intent; notification provider owns delivery                                                                  |
| **Audit event**                      | Append-only record of security- and workflow-relevant actions, including actor, action, old/new values, reason, and timestamp                                          | Workflow service; administrators may read but must not alter historical events                                                     |

### Relationships and cardinality

- One **User** can create many **Tickets**; each ticket has exactly one requester.
- One **Team** handles many tickets; each ticket has one routed team after routing.
- One **Ticket** has status updates, attachments, approvals, notifications, and audit events.
- One ticket has one Helpdesk review decision.
- One **User** may be assignee for many assignments, but an assignment has at most one assignee. An assignment may be claimed by only its selected assignee.

## 2. Lifecycle and Rules

### Ticket state transitions

```text
Created by User
  -> Pending Helpdesk Review
  -> Approved -> Assigned -> In Progress
  -> Resolved
```

| From                          | To                            | Allowed actor and required conditions                                   |
| ----------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `Created`                     | `Pending Helpdesk Review`     | System after server-side validation succeeds and routing is recorded    |
| `Pending Helpdesk Review`     | `Approved`                    | Helpdesk approves; priority is set                                      |
| `Pending Helpdesk Review`     | `Rejected`                    | Helpdesk rejects with a non-empty explanation                           |
| `Approved`                    | `Assigned`                    | Helpdesk assigns a team member and expected completion time              |
| `Assigned`                    | `In Progress`                 | Selected assignee claims the ticket; `claimed_at` starts the work timer |
| `In Progress`                 | `Resolved`                    | Assignee completes the work and marks the ticket resolved               |

Each transition is controlled by the workflow service and creates an audit event.

### Invariants

- A ticket cannot be submitted without its required fields, a valid requester, issue type, project, and valid attachment metadata where required.
- Every ticket has exactly one requester.
- `priority` is one of `low`, `medium`, `high`, or `urgent`; it is set or changed only by Helpdesk according to policy.
- `Rejected` requires a rejection explanation. Rejected tickets cannot be assigned or worked until an explicitly supported resubmission/reopen flow exists.
- An active assignment requires a team, one assignee, and an expected completion time.
- The work timer starts only once, when the assignee claims the ticket. Claiming is restricted to the selected assignee and requires the ticket to be in `Assigned`.
- The expected completion time is measured from `claimed_at`; the ticket becomes overdue when that expected time is exceeded.
- An unclaimed assignment older than 24 hours generates one alert to Helpdesk.
- Only the assignee may mark an issue as resolved.
- Audit events are append-only and include actor, action, timestamp, ticket ID, and correlation/request ID. Sensitive file contents and secrets are not copied into the audit log.

### Authorization-sensitive rules

- Users may read tickets they requested, subject to organizational privacy rules.
- Helpdesk may review, prioritize, and assign tickets; assignees may update only tickets assigned to them.
- Authorization is evaluated server-side using current identity, role, department, team membership, and ticket relationship. Client-side controls are not security boundaries.

## 3. Storage

### Relational versus document choice

Use a relational database for workflow data. Foreign keys, unique constraints, transactions, optimistic concurrency, and filtered uniqueness are important for preventing multiple active assignments, duplicate approvals, and invalid state changes. The domain is highly relational and requires reporting across tickets, teams, users, deadlines, and audit records.

A document store is not the primary store because embedding comments, approvals, and assignments would make concurrent updates, auditability, authorization joins, and cross-ticket dashboards harder. JSON columns may be used only for controlled, non-query-critical provider payloads or extensible form fields.

### Durable data

Persist:

- User, role, team, department, project, issue type, and routing configuration references.
- Ticket fields, current state, priority, requester/department snapshots, routing result, and timestamps.
- Assignment history.
- Status updates, approvals, rejection reasons, and resolution notes.
- Append-only audit events.

### Derived data

Calculate or materialize these from durable data:

- Open, in-progress, resolved, and overdue counts.
- Whether a ticket is currently overdue or unclaimed for 24 hours.
- Elapsed work duration from `claimed_at` and the current time.
- Notification eligibility and dashboard aggregates.
- Current assignee and current active assignment, when these are also available from assignment history.

## 4. Access

### Important access patterns

1. Create a ticket.
2. List Helpdesk's pending-review.
3. List an assignee's active tickets ordered by expected completion time.
4. Read one authorized ticket with its active assignment, latest status, comments, attachments, approvals, and recent audit events.
