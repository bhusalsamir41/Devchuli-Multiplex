# Devchuli Multiplex — Online Deployment

This version is prepared for Docker-based hosting with persistent storage.

## Render deployment
1. Create a GitHub repository and upload this project.
2. In Render, create a new Blueprint and select the repository.
3. Render reads `render.yaml` automatically.
4. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the service environment variables.
5. Deploy.
6. Open the generated `https://...onrender.com` address on your phone.

The app stores SQLite database and uploaded images under `/data`, backed by the configured persistent disk.

## Important
- Keep `SESSION_SECRET` private.
- Change the default admin password before using the system.
- The cinema BUY TICKET button remains an external link; cinema booking is not stored in this app.
- For a custom domain, add it in the hosting provider after deployment.
