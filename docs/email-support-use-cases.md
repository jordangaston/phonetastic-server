---
tags: use-cases, email-support
summary: "Use case document for Email Support for Phonetastic"
locked: false
---

# Email Support — Use Cases

## System Purpose

Extend Phonetastic so the same AI bot that handles voice calls and SMS can read, understand, and reply to customer emails.

## Actors

| Actor | Description |
|-------|-------------|
| **Owner** | A business owner or team member who configures email support, views email history, and can manually reply to customers. Authenticated via JWT. |
| **Bot** | The company's AI agent. Reads inbound emails, generates replies using company knowledge and skills, and sends them via the company's email address. |
| **End User** | A customer who sends and receives emails with the company. No Phonetastic account required. |
| **System** | The Phonetastic server — receives webhooks, orchestrates workflows, enforces invariants. |

## Glossary

| Term | Definition |
|------|------------|
| Email Address | An email identity owned by a company within Phonetastic. Used to send and receive emails. |
| Chat | A turn-based conversation thread between a company and an end user. Groups related messages across time. |
| Message | A single email sent or received within a chat. |
| Attachment | A file sent with or received in an email message. |
| Chat Summary | A concise AI-generated summary of the conversation so far, updated as new messages arrive. |

---

## UC-E1: Enable Email Support

**Primary Actor:** Owner

**Goal:** The owner enables email support for their company, receiving a Phonetastic email address.

### Preconditions
- Owner is authenticated.
- Owner belongs to a company.
- The company does not already have an email address.

### Main Flow
1. Owner requests to enable email support for their company.
2. System creates an email address for the company in the format `{company-slug}@mail.phonetastic.ai`.
3. System persists the email address record linked to the company.
4. System returns the created email address.

### Postconditions
- An email address record exists for the company.
- Inbound emails to that address will be received by the system.

### Extensions
- **2a.** Company already has an email address → System returns error (409 Conflict).
- **2b.** Company slug is not unique → System appends a numeric suffix to ensure uniqueness.

---

## UC-E2: List Company Email Addresses

**Primary Actor:** Owner
**Goal:** The owner views the email addresses configured for their company.

### Preconditions
- Owner is authenticated.
- Owner belongs to a company.

### Main Flow
1. Owner requests the list of email addresses for their company.
2. System returns all email addresses belonging to the company.

### Postconditions
- None (read-only).

---

## UC-E3: Receive Inbound Email

**Primary Actor:** End User (via email client)
**Goal:** An end user's email is received, persisted, and routed to the bot for processing.

### Preconditions
- The destination email address belongs to a company in Phonetastic.
- The company has email support enabled (an email address exists).

### Main Flow
1. End user sends an email to the company's Phonetastic email address.
2. Resend receives the email and sends an `email.received` webhook to the system.
3. System verifies the webhook signature.
4. System calls the Resend API to retrieve the full email content (subject, text, html, headers).
5. System identifies the company by matching the `to` address against the email addresses table.
6. System finds or creates an end user record using the sender's email address.
7. System finds an existing open chat between this end user and this company, or creates a new one.
8. System persists the email in the chat with direction `inbound`, linking to the end user as sender.
9. If the email has attachments, system persists attachment metadata records (content not yet downloaded).
10. System enqueues a `ProcessInboundEmail` workflow to handle attachment download and bot response.

### Postconditions
- The inbound email is persisted in the database.
- Attachment metadata is persisted (content pending download by workflow).
- A processing workflow is enqueued.

### Extensions
- **3a.** Webhook signature is invalid → System returns 401. No email is persisted.
- **5a.** No company matches the `to` address → System logs a warning and returns 200 (Resend requires 200). No email is persisted.
- **7a.** The email is a reply (has `In-Reply-To` header) → System looks up the referenced message and uses its chat. If the referenced message is not found, falls through to creating a new chat.
- **7b.** The email is a duplicate (same `external_email_id` already exists) → System returns 200. No duplicate email is created.

---

## UC-E4: Process Inbound Email (Attachments + Bot Response)

**Primary Actor:** System (DBOS workflow)
**Goal:** Download and store attachments, then (if the bot is enabled) generate and send a reply.

### Preconditions
- An inbound email and attachment metadata have been persisted in a chat.
- A `ProcessInboundEmail` workflow has been enqueued.

### Main Flow
1. The DBOS workflow starts.
2. System downloads each attachment from Resend (via signed URL), uploads it to Tigris, and updates the attachment row with `storage_key`, `size_bytes`, and `status = 'stored'`. Each attachment is processed as an independent child workflow.
3. System checks whether the bot is enabled for this chat. If not, the workflow ends.
4. For each stored attachment under 10 MB that has no cached summary, system reads the content from Tigris, generates a summary describing what the attachment contains and how it relates to the user's email, and caches the summary on the attachment row.
5. System loads the chat, including the latest inbound email and the chat summary (if any).
6. System loads company context (name, business type, FAQ knowledge base).
7. System loads the bot's available tools and skills (companyInfo, getAvailability, bookAppointment, loadSkill).
8. System builds an LLM prompt with: system instructions (written communication style), company context, chat summary, the latest email content, cached attachment summaries from the current and prior emails in the chat, and the available tools.
9. System calls the LLM with tool definitions. The LLM responds exclusively via tool calls — including a `reply` tool to send the response text. The system executes each tool call in sequence.
10. System sends the reply email (from the `reply` tool output) via Resend, setting `In-Reply-To` and `References` headers for threading, and using the company's email address as the sender.
11. System persists the outbound email in the chat with direction `outbound`, linking to the bot as sender.
12. If the chat now has more than two emails, system enqueues a chat summary update workflow.

### Postconditions
- All attachments are stored in Tigris (or marked failed).
- Stored attachments under 10 MB have cached summaries.
- If the bot is enabled: an outbound reply has been sent and persisted.
- A summary update is enqueued if the chat has more than two emails.

### Extensions
- **2a.** An attachment download or upload fails → The child workflow retries independently. If all retries fail, the attachment is marked `status = 'failed'`. Other attachments and the bot response are not blocked.
- **4a.** Attachment is over 10 MB → System skips summarization. The LLM is informed an attachment was received but could not be read.
- **4b.** Attachment has `status = 'failed'` → Same behavior as 4a.
- **4c.** Summarization LLM call fails → System retries up to 3 times. If all fail, the attachment is included in the bot context as "Attachment: {filename} ({content_type}) — summary unavailable."
- **9a.** LLM call fails → System retries up to 3 times with exponential backoff. If all retries fail, system sends a precanned error message to the end user: "We're sorry, we had trouble processing your message. A team member will follow up with you shortly." The message is persisted in the chat. The inbound email is not lost.
- **9b.** The LLM responds without using the `reply` tool → System treats this as a failure and follows extension 9a.
- **10a.** Resend send call fails → System retries up to 3 times. If all retries fail, the workflow fails. DBOS will retry the entire workflow.

---

## UC-E5: Owner Replies to Email

**Primary Actor:** Owner
**Goal:** The owner manually replies to a customer's latest email in a chat.

### Preconditions
- Owner is authenticated.
- Owner belongs to the company that owns the chat.
- The chat has at least one inbound message from the end user.

### Main Flow
1. Owner submits a reply with text content for a specific chat.
2. System sends the reply email via Resend, setting `In-Reply-To` and `References` headers to thread with the latest message in the chat, using the company's email address as the sender.
3. System persists the outbound message in the chat with direction `outbound`, linking to the owner as sender.
4. System disables the bot for this chat.
5. If the chat now has more than two messages, system enqueues a chat summary update workflow.

### Postconditions
- The reply email has been sent to the end user.
- The outbound message is persisted.
- The bot is disabled for this chat.

### Extensions
- **2a.** Resend send call fails → System returns 502. The message is not persisted.

---

## UC-E6: Owner Toggles Bot for Chat

**Primary Actor:** Owner
**Goal:** The owner enables or disables the bot for a specific chat.

### Preconditions
- Owner is authenticated.
- Owner belongs to the company that owns the chat.

### Main Flow
1. Owner requests to enable or disable the bot for a specific chat.
2. System updates the chat's `bot_enabled` flag.
3. System returns the updated chat.

### Postconditions
- The chat's bot_enabled flag reflects the owner's choice.
- If enabled, future inbound messages in this chat will trigger bot responses.
- If disabled, future inbound messages will be persisted but not auto-replied to.

---

## UC-E7: List Chats

**Primary Actor:** Owner
**Goal:** The owner views all email chats for their company.

### Preconditions
- Owner is authenticated.
- Owner belongs to a company.

### Main Flow
1. Owner requests a list of chats, optionally filtered by channel (email).
2. System returns a paginated list of chats for the company, ordered by most recent message.

### Postconditions
- None (read-only).

---

## UC-E8: View Chat Messages

**Primary Actor:** Owner
**Goal:** The owner views all messages in a specific email chat.

### Preconditions
- Owner is authenticated.
- Owner belongs to the company that owns the chat.

### Main Flow
1. Owner requests messages for a specific chat.
2. System returns a paginated list of messages in the chat, ordered chronologically.

### Postconditions
- None (read-only).

---

## UC-E9: Update Chat Summary

**Primary Actor:** System
**Goal:** Maintain an up-to-date summary of the chat after each new message.

### Preconditions
- A new message (inbound or outbound) has been added to a chat.
- The chat has more than two messages.

### Main Flow
1. The DBOS workflow starts.
2. System loads all messages in the chat, ordered chronologically.
3. System loads the existing chat summary (if any).
4. System calls the LLM with the message history and existing summary to generate an updated summary.
5. System persists the updated summary on the chat record.

### Postconditions
- The chat's summary field is updated with the latest AI-generated summary.

### Extensions
- **4a.** LLM call fails → System retries up to 3 times. If all retries fail, the workflow fails. The existing summary remains unchanged.

---

## Operations Summary

| Operation | Trigger | Actor | Side Effects |
|-----------|---------|-------|-------------|
| Create email address | POST /v1/email-addresses | Owner | DB insert |
| List email addresses | GET /v1/email-addresses | Owner | None |
| Receive inbound email | POST /v1/resend/webhook | System (Resend) | DB inserts (email + attachment metadata), enqueue workflow |
| Process inbound email | DBOS workflow | System | Download attachments to Tigris, bot response, send email, enqueue summary |
| Owner replies | POST /v1/chats/:id/emails | Owner | Upload attachments to Tigris, send email, DB insert, disable bot |
| Toggle bot | PATCH /v1/chats/:id | Owner | DB update |
| List chats | GET /v1/chats | Owner | None |
| View emails | GET /v1/chats/:id/emails | Owner | None |
| Update summary | DBOS workflow | System | DB update |
