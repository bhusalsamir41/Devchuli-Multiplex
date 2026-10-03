# Devchuli Multiplex — Render Deployment

This package is prepared for deployment as a Docker Web Service on Render.

## 1. Upload to GitHub

1. Open https://github.com and sign in.
2. Click **New repository**.
3. Repository name: `devchuli-multiplex`
4. Keep it Private if you want.
5. Create repository.
6. Extract this ZIP on your computer.
7. Upload **all files and folders inside the extracted folder** to the GitHub repository root.
8. Commit to the `main` branch.

## 2. Deploy on Render

1. Open https://render.com and sign in.
2. Connect GitHub when Render asks.
3. Click **New +** → **Blueprint** (recommended because this project includes `render.yaml`).
4. Select the GitHub repository `devchuli-multiplex`.
5. Render reads `render.yaml`.
6. Review the service and create/apply the Blueprint.
7. When prompted for secret/sync variables, enter:
   - `ADMIN_EMAIL`: your admin email
   - `ADMIN_PASSWORD`: a strong password (12+ characters recommended)
8. Wait for the first deploy to finish.
9. Open the `onrender.com` URL shown by Render.

## 3. Important Render storage setting

This project uses SQLite and uploaded images, so it uses a Render Persistent Disk mounted at `/data`.
The included `render.yaml` requests a 1 GB disk on the paid Starter web service plan. Render documents that persistent disks are available for paid web services and preserve filesystem changes across restarts/deploys.

If you do not want to pay for a persistent disk, do not use this SQLite package for production data; use a managed PostgreSQL database and object storage instead.

## 4. Default settings

- Customer app: `/`
- Admin login: `/admin/login`
- Default ticket URL: `https://www.inicinemas.com`
- Default VAT: `13%`
- Health check: `/api/health`

## 5. After deployment

Log in at `/admin/login` with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` values you entered in Render.

Then change/manage:
- Businesses
- News
- Pricing
- Food & Services
- BUY TICKET URL
- VAT
- Users & Roles
- Audit Logs

## 6. Do not commit secrets

Never put your real `ADMIN_PASSWORD` or `SESSION_SECRET` into GitHub. Render generates `SESSION_SECRET` from `render.yaml`; enter the admin credentials through Render's environment-variable UI.
