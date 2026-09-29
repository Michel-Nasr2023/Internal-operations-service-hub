# Deployment — Live App on a Free VM

The live app runs on one always-free virtual machine (Oracle Cloud Always Free), so it does not depend on a laptop and costs nothing.

```text
Browser ──HTTPS──> Caddy (ports 80/443) ──┬── /api/*  ──> NestJS API on 127.0.0.1:3000 (kept running by pm2)
                                          └── other   ──> React build (frontend/dist)
                                                           SQLite, files and backups in backend/data (VM disk)
```

| Part | Why |
| --- | --- |
| Oracle Cloud Always Free VM (Ubuntu) | Free, and its disk is permanent: the SQLite database, attachments and backups survive restarts |
| Caddy | Serves the web app, forwards `/api` to the API, gets a free HTTPS certificate automatically |
| pm2 | Restarts the API if it ever stops, and after a reboot |
| DuckDNS | Free domain name (e.g. `your-hub.duckdns.org`) pointing to the VM |

Files used: [deploy/Caddyfile](../deploy/Caddyfile), [deploy/ecosystem.config.cjs](../deploy/ecosystem.config.cjs), [deploy/update.sh](../deploy/update.sh).

## 1. Create the VM

1. Create an Oracle Cloud account (Always Free; a card is asked for verification only).
2. **Compute > Instances > Create instance**: image **Ubuntu 24.04**, shape **Ampere A1.Flex, 1 OCPU, 6 GB** (Always Free). If it says "out of capacity", use **VM.Standard.E2.1.Micro** instead.
3. Add your SSH public key, create, and note the **public IP address**.
4. **Networking > Virtual cloud network > Security list**: add ingress rules for TCP **80** and **443** from `0.0.0.0/0`.

## 2. Domain

At [duckdns.org](https://www.duckdns.org), sign in, create a subdomain (e.g. `your-hub`) and set it to the VM's public IP.

## 3. Prepare the VM

```bash
ssh ubuntu@<public IP>

# Oracle's Ubuntu images block web traffic in the VM firewall too
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# Only on the 1 GB Micro shape: add swap so the build has enough memory
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Node.js 20, build tools (for the SQLite driver), git, pm2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3
sudo npm install -g pm2

# Caddy (official package)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

## 4. Get the code and the secrets

```bash
sudo mkdir -p /srv/service-hub && sudo chown ubuntu:ubuntu /srv/service-hub
git clone https://github.com/Michel-Nasr2023/Internal-operations-service-hub.git /srv/service-hub
cd /srv/service-hub
cp backend/.env.example backend/.env
nano backend/.env
```

In `backend/.env` set: `AUTH_SECRET` (generate with `openssl rand -hex 32`), `RQSTY_API_KEY`, `APP_URL=https://your-hub.duckdns.org`, and the `SMTP_*` / `MAIL_FROM` settings. This file stays on the server only; it is never committed.

## 5. Deploy and start

```bash
bash deploy/update.sh            # builds and starts the latest master (or: bash deploy/update.sh <commit SHA>)
pm2 startup                      # then run the one command it prints, so the API starts after a reboot
pm2 save

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/your-hub.duckdns.org/<your domain>/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 6. Check it

```bash
curl https://<your domain>/api/health     # {"status":"ok","database":"ok","ai":"ok","email":"ok",...}
```

From your laptop: `npm run smoke -- https://<your domain>` must end with **SMOKE PASSED**.

## Operating it

| Task | Command |
| --- | --- |
| Deploy the submitted commit | `bash deploy/update.sh <commit SHA>` |
| API logs | `pm2 logs service-hub-api` |
| Restart the API | `pm2 restart service-hub-api` |
| Status | `pm2 status` · `curl https://<domain>/api/health` |
| Backups | `backend/data/backups/` (one per day, last 7 days) |
| Keep a copy off the VM | `scp ubuntu@<ip>:/srv/service-hub/backend/data/backups/*.sqlite .` |
| Restore a backup | `pm2 stop service-hub-api`, copy the backup over `backend/data/tickets.sqlite`, `pm2 start service-hub-api` |
| Change a role from the command line | `npm run user:role -- someone@company.com administrator` |
| Restore a demo password changed by a visitor | `npm run user:password -- admin@company.com Admin12345` |
| Clear sign-in locks at once | `pm2 restart service-hub-api` (locks also end by themselves after 15 minutes) |

Oracle may reclaim Always Free VMs that stay almost completely idle for a week, so open the app and run the smoke test in the days before the defense.
