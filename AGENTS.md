# Project constraints

- This project implements the Android native protocol login flow.
- Do not add, restore, or use a web-version login path as a fallback, workaround, or acceptance path.
- QR login must use the native Android request/signing context and must stop clearly when that context is unavailable or unverified.
- A successful local calculation is not platform validation; only a trusted request sample or an actual platform login can establish that the native signature is accepted.
