# Canteen Pre-Order: Student App

Students register with their School ID, browse the menu with live stock, order and pay from their **Student Wallet**,
cancel within 10 minutes (full refund) or tap **Confirm Now**, track order status, show a pickup QR, and view wallet history.

Shares a Render PostgreSQL database with the **canteen-backoffice** repo (Staff / School Cashier / Admin).

## Run locally
```bash
cp .env.example .env    # paste the Render External Database URL + a JWT_SECRET
npm install
npm start               # http://localhost:3000
```

## Deploy on Render
Web Service · Runtime **Node** · Build `npm install` · Start `npm start` · Region **Singapore**

Environment variables:
| Key | Value |
|---|---|
| `DATABASE_URL` | Render **Internal Database URL** |
| `JWT_SECRET` | long random string (different from the back-office one) |
| `NODE_ENV` | `production` |
| `COOKIE_NAME` | `canteen_student` |

Demo login: `2026-0001` / `student123` (₱1,000 demo balance).

## Structure
```text
server.js                 Express entry point
db/                      PostgreSQL connection, schema and setup
   init.js
   pool.js
   schema.sql
lib/                     Server-side authentication and helpers
   auth.js
   maintenance.js
   util.js
routes/                  API routes (auth, menu, orders, wallet)
public/                  Browser-only files served by Express
   index.html
   login.html
   orders.html
   wallet.html
   css/style.css
   js/                    common, home, login, orders, wallet
test/                    File-layout and authentication regression tests
```

Only `public/` is served to browsers. API route files and browser scripts have
separate directories, even when they share a name (for example, `orders.js`).

## Checks

```bash
npm test                  # no database connection required
npm run db:init           # requires DATABASE_URL; creates schema and demo data
```

`npm start` also initializes the database before listening. A reachable PostgreSQL
database and `JWT_SECRET` are required for login and end-to-end testing.
