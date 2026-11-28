# Customer catalog deployment

Deploy this directory alone as static files to a commercial-use-permitted HTTPS host, for example a configured Cloudflare Pages project. No database keys, environment variables or build command are needed. The _headers file supplies security response headers on Cloudflare Pages; configure equivalent headers on other hosts. Do not use a non-commercial-only hosting plan for a business catalog.

Verify the deployed HTTPS page, then enter its URL in the owner's Customer Share Studio. Test a deliberately generated short-lived catalog link and revoke it afterwards. The link token is passed in the URL fragment and sent only to the customer-share endpoint by POST; do not publish real tokens in logs or source. The server still enforces expiry, revocation, store scope and price visibility. No customer checkout or payment is provided by this catalog.

This directory is deployment-ready; a successful CI artifact is not a public deployment. Hosting account authorization is required.
