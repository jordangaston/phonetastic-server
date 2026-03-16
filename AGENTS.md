## Email Testing

To test the email bot end-to-end, use `scripts/email-test`:

1. Ensure `gws` is installed: `npm install -g @googleworkspace/cli`
2. Authenticate: `gws auth login`
3. Send a test email: `scripts/email-test send --company "Company Name" --body "Your question"`
4. Watch for the bot reply: `scripts/email-test watch`
5. Verify: the bot should reply within 30 seconds. Check chat state via API or `scripts/email-test chats`.

### Test Scenarios

| Scenario | Command | What to Verify |
|---|---|---|
| New conversation | `email-test send --company "Acme"` | Chat created, bot replies, email threaded |
| Follow-up in thread | `email-test reply --chat-id 42` | Same chat reused, summary updated |
| Attachment handling | `email-test send --attach file.pdf` | Attachment stored in Tigris, summarized, bot references it |
| Bot disabled | Disable bot via API, then `email-test send` | Email persisted but no bot reply |
| Owner reply | Owner replies via API, then end user sends again | Bot stays disabled, email persisted |
