# Internal Operations Service Hub — Data Model

## 1. Tables

| Table | Purpose | Key fields |
| --- | --- | --- |
| `users` | Accounts | id, email (unique), password hash, role, name, job title, status (active/disabled), photo, `sessionsRevokedAt` |
| `tickets` | The request and its workflow state | requester, team, issue type, project/area, title, description, status, priority, assignee, expected hours, claimed/due/resolved times, rejection reason, resolution notes, `reviewedBy`, `assignedBy`, AI result (JSON, incl. automatic retry time), history (JSON), version (checked on every save), submission key |
| `ticket_comments` | Discussion on a ticket | ticket, author, text, time |
| `ticket_attachments` | File metadata (bytes on disk) | ticket, uploader, stage (submission/resolution), file name, type, size, storage key |
| `ticket_views` | When each user last opened a ticket ("new" highlight) | user, ticket, time |
| `notifications` | In-app alerts, one row per recipient | recipient, ticket, kind, message, read time, dedupe key (unique per recipient) |
| `audit_log` | Append-only system audit trail | time, category, action, outcome, actor, target, summary, IP, browser, request ID |
| `password_reset_tokens` | Reset links, codes and invitations | user, token hash, code hash, attempts, expiry, used time |
| `email_outbox` | Every email sent and its delivery status | recipient, subject, body, status (sent/retrying/failed/not sent), error, attempts, next attempt |

Fixed values: teams `it`, `facilities`, `finance`; issue types `hardware`, `software`, `network`, `access`; priorities `low`, `medium`, `high`, `urgent`; roles `employee`, `helpdesk`, `administrator`.

## 2. Relationships

- A user requests many tickets; each ticket has exactly one requester.
- A ticket has at most one current assignee (an active employee).
- A ticket has many comments, attachments, notifications and history entries.
- A ticket records one reviewer (approved/rejected by) and the person who assigned it.

## 3. Ticket lifecycle

```text
Pending Helpdesk Review ──approve──> Approved ──assign──> Assigned ──claim──> In Progress ──resolve──> Resolved
        └──reject──> Rejected
(approve + assign can happen in one step)
```

| Transition | Who | Rule |
| --- | --- | --- |
| → Pending Helpdesk Review | Employee | Valid fields; AI analysis starts in the background |
| → Approved / Rejected | Helpdesk, admin | Priority required to approve; reason required to reject |
| → Assigned | Helpdesk, admin | Active assignee and expected hours required |
| → In Progress | Assignee (or admin) | Starts the timer; due time = claim time + expected hours |
| → Resolved | Assignee (or admin) | Resolution notes required |
| In Progress/Assigned → Assigned (other person) or → Approved | Administrator | Handover before disabling someone: reassign or return to queue |

Every transition is added to the ticket history and to `audit_log`.

## 4. Rules

- Priority, approval and assignment are Helpdesk/admin actions only.
- Only the assignee (or an administrator) can claim and resolve; comments close when a ticket is resolved or rejected.
- A 24 h unclaimed alert and an overdue alert are each sent once per ticket.
- A user holding active tickets cannot be disabled or moved to Helpdesk until they are handed over.
- There is always at least one active administrator; admins cannot disable or demote themselves.
- Audit entries are never edited or deleted and never contain passwords or tokens.
- A ticket is saved only if its version is unchanged since it was read; otherwise the action is re-checked on the latest copy, so simultaneous changes never overwrite each other.
- One ticket per submission key and requester (unique), so a repeated submission never creates a copy.

## 5. Access

| Data | Employee | Helpdesk | Administrator |
| --- | --- | --- | --- |
| Tickets, comments, files, history | Only tickets they requested or are assigned | All | All |
| Activity log, team workload | — | Yes | Yes |
| Users, system health, email outbox | — | — | Yes |

## 6. Derived data (calculated, not stored)

Open / in-progress / overdue counts, workload per employee, "new" tickets per user, time remaining, and last sign-in.
