# Canteen Pre-Order: Student App

Students log in with their School ID (accounts are created by the School Cashier; first login requires setting their own password), browse the menu with live stock, order and pay from their **Student Wallet**,
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
```
server.js            Express app (API + static frontend)
routes/auth.js       login, logout, me, change password (forced at first login; once every 7 days)
routes/menu.js       menu with live stock, today's pickup slots
routes/orders.js     place order (wallet + stock in one transaction), cancel, confirm-now, QR
routes/wallet.js     balance + transaction history
db/                  schema + auto-setup (shared)
lib/                 auth, helpers, auto lock-in / suspension sweeps (shared)
public/              login.html, index.html (menu), orders.html, wallet.html, css, js
```
