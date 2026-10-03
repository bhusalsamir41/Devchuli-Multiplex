# Devchuli Multiplex JavaScript Project

This is a local runnable starter application with a customer-facing home page, business pages, admin login, database-backed businesses/news/settings, time-based pricing helpers, and food/service data structures.

## Run on Windows
1. Install Node.js LTS from https://nodejs.org/
2. Extract this ZIP to a folder, e.g. `C:\DevchuliMultiplex`
3. Open that folder.
4. Click the address bar in File Explorer, type `cmd`, press Enter.
5. Run:
   `npm install`
6. Copy `.env.example` to `.env` and update the admin password and session secret.
7. Run:
   `npm start`
8. Open `http://localhost:3000`
9. Admin login: `http://localhost:3000/admin/login`

## Default local admin
Email: `admin@devchulimultiplex.com`
Password: `ChangeThisPassword123!`
Change this immediately in `.env` before using the app.

## Scope and production warning
This package is a runnable local foundation, not a production-ready deployment. Admin authentication, businesses/news/settings and local image upload are wired for local use. Before public deployment, add stronger CSRF/session protections, managed database/backups, cloud image storage, role-specific authorization on every operation, comprehensive tests, and HTTPS deployment.

Cinema ticket booking is intentionally NOT implemented. The BUY TICKET button opens the configured external INI Cinemas URL.
