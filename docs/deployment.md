# Deployment — Live App on Railway

The live app runs on [Railway](https://railway.com) as **one service**: the NestJS API also serves the built React app, so the whole hub has one address. A **volume** (persistent disk) keeps the SQLite database, attachments, profile photos and backups across restarts and redeploys.

```text
Browser ──HTTPS──> Railway ──> one service: node backend/dist/main.js
                                 ├── /api/*  -> NestJS API
                                 ├── other   -> React app (frontend/dist)
                                 └── /data   -> volume: tickets.sqlite, attachments, avatars, backups
```

How Railway builds, starts and checks the app is in [railway.json](../railway.json):

| Step | What happens |
| --- | --- |
| Build | Installs and builds the backend and the frontend (the web app calls the API at `/api`) |
| Start | `node backend/dist/main.js` |
| Health check | A new deployment only receives traffic once `/api/health` answers `200` |
| Restart | If the app ever stops with an error, Railway starts it again (up to 10 times in a row) |

## 1. Create the service

1. Sign in at [railway.com](https://railway.com) **with GitHub**.
2. **New Project → Deploy from GitHub repo →** `Internal-operations-service-hub`. The first build starts.
3. In the service, **Settings → Source**: turn on **Wait for CI**, so a commit is only deployed after the release gate on GitHub is green.

## 2. Add the volume

Right-click the service (or **⌘K / Ctrl+K**) → **Attach volume** → mount path **`/data`**.

## 3. Variables

In the service, **Variables → Raw Editor**, paste and fill in:

```text
NODE_ENV=production
DATA_DIR=/data
TRUST_PROXY=1
AUTH_SECRET=<a long random string>
RQSTY_API_KEY=<your key>
RQSTY_API_URL=https://router.requesty.ai/v1/chat/completions
RQSTY_MODEL=nvidia/nemotron-3-super-120b-a12b
APP_URL=https://<your address>.up.railway.app
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<your Gmail address>
SMTP_PASS=<your Gmail App password>
MAIL_FROM="Service Hub <your Gmail address>"
```

Secrets are stored only in Railway, never in the repository. `TRUST_PROXY=1` lets sign-in limits and the audit log see each visitor's real address behind Railway's proxy.

## 4. Public address

**Settings → Networking → Generate Domain**. Put that address in `APP_URL` (used in password reset links) and deploy the change.

## 5. Check it

- Open `https://<your address>.up.railway.app/api/health` → `{"status":"ok","database":"ok","ai":"ok","email":"ok",...}`
- From your laptop: `npm run smoke -- https://<your address>.up.railway.app` must end with **SMOKE PASSED**.
- **Deployments** shows the commit SHA that is live: it must be the submitted one.

If the health check shows `"email":"failed"`, the Railway plan may block outgoing email (SMTP). Everything else keeps working and emails stay in **Admin > System**.

## Operating it

| Task | How |
| --- | --- |
| Deploy a new version | Push to `master`; Railway deploys it once the release gate is green |
| Logs | Service → **Deployments → View logs** (search e.g. `ticket bf5b3b58`) |
| Restart | Service → **⋮ → Restart** |
| Roll back | **Deployments →** an earlier deployment **→ Redeploy** |
| Backups | On the volume in `/data/backups` (one per day, last 7 days) |
| Run a command on the server | Install the [Railway CLI](https://docs.railway.com/guides/cli), then `railway ssh` |
| Restore a demo password changed by a visitor | `railway ssh`, then `npm run user:password -- admin@company.com Admin12345` |
| Clear sign-in locks at once | Restart the service (locks also end by themselves after 15 minutes) |
| Restore a backup | `railway ssh`, `cp /data/backups/tickets-<date>.sqlite /data/tickets.sqlite`, then restart the service |
