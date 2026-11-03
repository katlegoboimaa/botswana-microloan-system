# Botswana Micro-Lending Management System (Starter Application)

A runnable full-stack source-code project for a single-branch Botswana micro-lender.

## Stack
- Backend: Node.js, Express, MongoDB/Mongoose, JWT, bcrypt
- Frontend: React + Vite
- Currency: BWP
- Four roles: `CLERK`, `MANAGER`, `ADMIN`, `MANAGEMENT`

## Included
- Staff login and role-based API access
- Client registration and administrator-only client profile editing
- Loan application capture and manager approval/rejection
- Loan disbursement recording after approval
- Repayment capture and printable receipt reference
- Due dates and overdue-charge assessment
- Monthly overdue charge history with duplicate-charge prevention
- Dashboard and operational reports
- Append-only audit events for key actions
- Initial administrator bootstrap script

## Requirements
- Node.js 18+
- MongoDB 6+ running locally or a MongoDB connection string

## Quick start

### 1. Backend
```bash
cd server
copy .env.example .env
npm install
npm run seed-admin
npm run dev
```
On macOS/Linux use `cp .env.example .env` instead of `copy`.

Edit `.env` before seeding. Set a strong `JWT_SECRET`, `MONGODB_URI`, and the initial admin email/password.

Backend runs at `http://localhost:5000`.

### 2. Frontend
Open another terminal:
```bash
cd client
npm install
npm run dev
```
Open the URL Vite prints (usually `http://localhost:5173`).

Sign in with the administrator credentials set in `server/.env`.

### 3. Create other staff
Sign in as ADMIN and use the Staff Accounts panel to create CLERK, MANAGER, and MANAGEMENT accounts.

## Important business-rule notes
- Initial interest is calculated as 25% of original principal for the loan term (flat interest).
- The first overdue charge is assessed the day after the due date, then at monthly intervals while a balance remains.
- This implementation charges 25% of the remaining unpaid loan balance at each overdue assessment date. It records each charge separately and prevents duplicate assessment for the same loan and period.
- Payments are allocated first to overdue charges, then interest, then principal. This is a configurable business choice and should be confirmed in the signed loan agreement.
- All monetary values are stored as integer thebe (minor currency units) internally to reduce floating-point rounding errors.
- Monthly schedule uses calendar-month anniversaries from the first overdue date; if a month does not contain that day, it uses the last day of that month.
- This is a starter system, not a legal or accounting certification. Confirm the applicable Botswana lending, consumer-protection, privacy, record-retention, and interest/fee rules with a qualified local adviser before live lending.

## Security / production checklist
Before production: use HTTPS, a managed MongoDB with authentication and network restrictions, strong unique secrets, reliable off-site backups, access reviews, monitoring, rate limiting, MFA for privileged users, tested restore procedures, and independent security review. Never expose MongoDB publicly. The bootstrap admin password must be changed after first login (the current starter does not yet force a password reset).

## API overview
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET/POST /api/clients`
- `PATCH /api/clients/:id` (ADMIN only)
- `GET/POST /api/loans`
- `POST /api/loans/:id/decision` (MANAGER only)
- `POST /api/loans/:id/disburse` (MANAGER only)
- `POST /api/loans/:id/repayments` (CLERK or MANAGER)
- `POST /api/loans/assess-overdue` (MANAGER or ADMIN; idempotent)
- `GET /api/reports/summary`
- `GET /api/reports/loans`
- `GET /api/audit` (ADMIN or MANAGEMENT)
- `GET/POST /api/staff` (ADMIN only)

## Statuses
Loan application lifecycle: `PENDING` → `APPROVED` or `REJECTED`; approved loans can be `DISBURSED`; settled loans are `SETTLED`.
