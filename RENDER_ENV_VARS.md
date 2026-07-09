# Render environment variables (Firebase Admin)

## Required

- `FIREBASE_SERVICE_ACCOUNT` (string)
  - Must be the **raw JSON** for the Firebase Admin service account.
  - Example format (single-line recommended):
    ```
    {"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"...","token_uri":"...","auth_provider_x509_cert_url":"...","client_x509_cert_url":"..."}
    ```

## Removed / no longer used

This backend no longer uses:
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_SERVICE_ACCOUNT_PATH`

