# title: Internal Operations Service hub

## 1. Context:

    The organization has many requests as issues and needs fixing.
    requests come through a helpDesk system.

## 2. Known facts:

    -The system is for internal staff , not for customers
    -There are multiple operational teams
    -requests must be tracked from creation to resolution

## 3. Actors

Employees/ Team leader/ IT Team/ security/ Admin/ System Administrator / helpdesk team

## 4. Stakeholders:

Employees/ Department managers/ IT Team/ HR/ BA/ Finance department/ Procurement/ Security team/ HelpDesk Team

## 5. Functional requirements:

1. Allowance of every chief of department to send mails for issues

2. System check and validates all fields before submitting the issue
   2.1 If fields are wrong, the system won't allow submission of the issue.

3. System will auto assign the issue to the right team based on issue type and project.

4. Helpdesk Team can approve or reject requests
   3.1 in case of a rejection, it will need an explanation

5. Helpdesk Team will set priority levels: low, medium, high, urgent

6. Team leader must assign a clear assignee with the expected time to finish the task.
   6.1 If he didn't assign the issue within 24h, then the system must alert the HelpDesk Team.

7. Timer starts when the assignee claim the issue  
   7.1 if he didn't claim the issue and stays on hold more than 24h, the system will notify the Team leader

8. Assignee works on issue and status should be updated
   8.1 if the issue (ticket) he's working on persist more than the expected time, team leder gets notified

9. On completition of the issue, the assignee must submit with proof of completition and notes for the system to accept it.

10. Chief of department must approve the completition of the ticket and his satisfaction.

## 6. Non-Fonctional requirements

-Fast response time for common operations
-Reliable uptime for internal business continuity
-Data privacy
-Audit trail for all actions
-Easy to use on desktop and mobile
-Clear UI for non-technical staff

## 7.Assumptions

- Users are employees of the organization
- An identity of the employee exists
- Requests are mostly sent by team leaders
- Most workflows are not highly complex but require structured tracking
- The project is focused on internal use only

## 8. Constraints

    -Limited budget for implementation
    -Small team for development and testing
    -Need to check organization policies

## 9. Unknowns

- Exact number of request.
- Handeling of many requests at the same time
- many requests for the same department
- Not enough resource for the solving of the issue

## 10. Non-goal

-External customer support
-Payroll
-Vendor management

## 11.Acceptance criteria

- A team leader can create a request with required fields and attachments
- The request is assigned to the correct team or queue
- HelpDesk can approve or reject high-priority requests
- The assignee can update status and add comments
- The system records all actions in an audit log
- The requester can see progress and resolution status
- Dashboard displays total open, in progress, and overdue requests
- Notifications are sent to assigned users and requesters
