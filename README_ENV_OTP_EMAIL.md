# Email OTP Auth (production) - required environment variables

This module is mounted at:
- `POST /api/email-otp-auth/start`
- `POST /api/email-otp-auth/verify`
- `POST /api/email-otp-auth/resend`

## OTP crypto
- `OTP_HMAC_SECRET` (required)
  - Secret used to HMAC-hash OTP values before storing them.

## SMTP (Gmail/Nodemailer)
These are used by the existing `backend/services/emailService.js` transporter.
- `SMTP_HOST` (required) e.g. `smtp.gmail.com`
- `SMTP_PORT` (required or defaults to `587`) e.g. `587`
- `SMTP_USER` (required) your Gmail/SMTP username
- `SMTP_PASS` (required) app-password / SMTP password
- `SMTP_FROM_EMAIL` (required) the sender email address
- `SMTP_FROM_NAME` (optional) default `InternArea`

## DATABASE
- `DATABASE_URL` required for OTP persistence.

## Notes
- OTP values are never logged.
- OTP records are auto-expired via MongoDB TTL index on `otpExpiresAt`.

