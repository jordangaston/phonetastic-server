---
tags: email-support, tdd
summary: "Email Support technical design document"
locked: false
---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Jordan | in_progress | |

---

# Use Case Implementations

## Receive Inbound Email — Implements UC-E3: Receive Inbound Email

~~~mermaid
sequenceDiagram
    participant EU as End User
    participant R as Resend
    participant C as ResendWebhookController
    participant CS as ChatService
    participant RS as ResendService
    participant DB as Database

    rect rgb(240, 248, 255)
    note over R,C: Webhook Reception
    EU->>R: Send email
    R->>C: POST /v1/resend/webhook (email.received)
    C->>RS: verifyWebhookSignature(payload, headers)
    RS-->>C: valid
    C->>RS: getReceivedEmail(emailId)
    RS-->>C: Full email content (text, html, headers, attachment metadata)
    end

    rect rgb(255, 248, 240)
    note over C,DB: Persist Email + Attachment Metadata
    C->>CS: receiveInboundEmail(emailData)
    note over CS: Extract subdomain from forwardedTo or to address
    CS->>DB: subdomainRepo.findBySubdomain(subdomain)
    alt Subdomain found
        DB-->>CS: Subdomain + companyId
    else Fallback
        CS->>DB: companyRepo.findByEmailAddress(to)
        DB-->>CS: Company
    end
    CS->>DB: Resolve replyTo from company.email_addresses matching to[]
    DB-->>CS: replyToAddress
    CS->>DB: Find or create end user by sender email + companyId
    DB-->>CS: EndUser
    CS->>DB: Find open chat or create new (check in_reply_to for threading)
    DB-->>CS: Chat
    CS->>DB: TX: Insert email (fromAddress, toAddresses, forwardedTo, replyToAddress), insert attachment metadata (no content yet), set chat subject
    end

    rect rgb(240, 255, 240)
    note over CS: Enqueue Workflow
    CS->>CS: DBOS.startWorkflow(ProcessInboundEmail, chatId, emailId)
    end

    C-->>R: 200 OK
~~~

The webhook handler persists email and attachment metadata immediately, then returns 200. All downstream processing (attachment download, bot response) happens in the DBOS workflow. This ensures no data is lost even if attachment download or bot processing fails.

**Company resolution:** The `forwardedTo` field is extracted from `X-Forwarded-To` or `Delivered-To` headers (priority order) in `ResendServiceImpl.getReceivedEmail()`. Subdomain routing is tried first — the subdomain is extracted from `forwardedTo` (if present) or the first `to` address, and looked up via `subdomainRepo.findBySubdomain()`. If no subdomain match is found, the system falls back to `companyRepo.findByEmailAddress()`, which searches the `email_addresses` text array on the companies table.

**replyTo resolution:** The `replyToAddress` is determined by finding the entry in `company.email_addresses` that matches one of the inbound email's `to[]` addresses. This address is stored on the email row and used as the `from` address when the bot or owner sends a reply.

**ReceivedEmail interface:** The `ReceivedEmail` type returned by `ResendServiceImpl.getReceivedEmail()` includes a `forwardedTo?: string` field, extracted from `X-Forwarded-To` or `Delivered-To` headers (priority order). The `from`, `to`, and `replyTo` fields carry the raw email addresses from Resend.

## Store Attachment — Sub-workflow of ProcessInboundEmail

~~~mermaid
sequenceDiagram
    participant W as StoreAttachment Workflow
    participant RS as ResendService
    participant TG as Tigris
    participant DB as Database

    W->>RS: getAttachmentContent(emailId, attachmentId)
    RS-->>W: Signed download URL + size
    W->>RS: Download file from URL
    RS-->>W: File content
    W->>TG: PutObject({companyId}/attachments/{emailId}/{uuid}.{ext})
    TG-->>W: storage_key
    W->>DB: Update attachment row (storage_key, size_bytes, status = 'stored')
~~~

Each attachment is processed as its own DBOS child workflow with independent retry. The parent workflow starts all child workflows, then awaits them with `Promise.allSettled` — this is critical because `WorkflowHandle.getResult()` throws on failure. Using `allSettled` ensures one failed attachment does not crash the parent or block other attachments. For each rejected result, the parent marks the attachment `status = 'failed'`.

## Process Inbound Email — Implements UC-E3 + UC-E4: Attachment Processing and Bot Response

~~~mermaid
sequenceDiagram
    participant W as ProcessInboundEmail Workflow
    participant SA as StoreAttachment (child workflows)
    participant DB as Database
    participant TG as Tigris
    participant LLM as LLM (BAML)
    participant T as Agent Tools

    rect rgb(240, 248, 255)
    note over W,SA: Step 1: Process Attachments (parallel child workflows)
    W->>DB: Load attachment metadata for email
    DB-->>W: Attachment rows (external_attachment_id, status = 'pending')
    W->>SA: DBOS.startWorkflow(StoreAttachment) for each attachment
    note over W: await Promise.allSettled(handles.map(h => h.getResult()))
    SA-->>W: Each settles as fulfilled (stored) or rejected (failed)
    loop For each rejected result
        W->>DB: Update attachment status = 'failed'
    end
    end

    rect rgb(255, 248, 240)
    note over W,DB: Step 2: Check Bot Enabled
    W->>DB: Load chat
    DB-->>W: Chat (bot_enabled, summary)
    note over W: If !chat.bot_enabled, workflow ends here
    end

    rect rgb(240, 255, 240)
    note over W,DB: Step 3: Summarize Attachments (one step per attachment)
    W->>DB: Load stored attachments (status = 'stored', summary IS NULL)
    DB-->>W: Unsummarized attachments
    W->>DB: Load inbound email body (for relevance context)
    DB-->>W: Email text
    loop For each unsummarized attachment < 10MB
        W->>TG: GetObject(storage_key)
        TG-->>W: File content
        W->>LLM: SummarizeImageAttachment or SummarizeTextAttachment (BAML multimodal)
        LLM-->>W: Summary
        W->>DB: Update attachment.summary
    end
    end

    rect rgb(248, 248, 240)
    note over W,DB: Step 4: Build Chat History
    W->>DB: Load emails in chat (end_user and user senders only)
    DB-->>W: Human messages
    W->>DB: Load bot_tool_calls for chat
    DB-->>W: Tool call records
    note over W: Merge and sort chronologically into ChatHistoryEntry[]
    W->>DB: Load company, email address, attachment summaries
    DB-->>W: Bot context
    end

    rect rgb(255, 240, 240)
    note over W,LLM: Step 5: Agent Tool Loop (child workflow, one step per turn)
    loop For each turn (max 5)
        W->>LLM: BAML EmailAgentTurn(context + chat history)
        LLM-->>W: CompanyInfoTool or ReplyTool (BAML structured output)
        alt CompanyInfoTool
            W->>T: Execute FAQ vector search
            T-->>W: Search results
            W->>DB: Insert bot_tool_calls row (input + output)
        else ReplyTool
            W->>DB: Insert bot_tool_calls row (reply input)
            note over W: Break loop — reply text captured
        end
    end
    end

    rect rgb(240, 240, 255)
    note over W,DB: Step 6: Send Reply
    note over W: from = email.replyToAddress ?? company.email_addresses[0]
    W->>DB: sendEmail(from, to, text, In-Reply-To, References)
    DB-->>W: { id }
    W->>DB: Insert outbound email (sender: bot)
    note over W: If chat has > 2 emails
    W->>W: DBOS.startWorkflow(UpdateChatSummary, chatId)
    end
~~~

## Build Chat History — Operation within ProcessInboundEmail Step 4

The chat history is the LLM's view of the conversation. It must include human messages *and* the bot's prior tool calls so the model sees a faithful reproduction of its own reasoning — not just the final reply text.

**Why this matters:**
1. **Information loss.** Without persisted tool calls, the bot loses knowledge it already retrieved (FAQ answers, availability data). It re-queries tools it already called, wasting tokens and latency.
2. **Format drift.** The model was RLHF-trained to produce structured tool calls and receive structured results. If we only show it plain text messages, its output format drifts away from the structured schema we need.

**Reconstruction algorithm:**

1. Load emails in the chat where sender is end user (`end_user_id IS NOT NULL`) or owner (`user_id IS NOT NULL`). Bot-sent emails are excluded — the bot's contribution is represented by its tool calls, not by the reply email.
2. Load all `bot_tool_calls` rows for the chat.
3. Merge both lists and sort by `created_at` ascending.
4. Map each item to a `ChatHistoryEntry`:
   - **End user email** → role `user`, label `[Customer]`, content is `body_text`
   - **Owner email** → role `user`, label `[Human Agent]`, content is `body_text`
   - **Tool call** → rendered as an `assistant` role message showing the tool call input, followed by a `user` role message showing the tool result (see format below)

**Tool call format — unified between output and history:**

The BAML tool classes include `type: "function_call"` as a literal field. This means the model *produces* the same format it *sees* in chat history — no envelope mismatch. The `EmailAgentTurn` return type becomes `CompanyInfoTool | ReplyTool`, where both include `type: "function_call"`. Tool results use `type: "function_call_response"`.

Example of a tool call round-trip in the chat history:

```
[assistant role]
{"type": "function_call", "tool_call_id": "abc-123", "tool_name": "company_info", "query": "What are your oil change rates?"}

[user role]
{"type": "function_call_response", "tool_call_id": "abc-123", "output": {"found": true, "results": [{"question": "Oil change pricing?", "answer": "Starting at $39.99"}]}}
```

The model's live output matches this exactly — `ctx.output_format` renders the same schema the history contains. The `tool_call_id` is generated server-side and injected into the persisted record after the model responds (it is not part of the BAML output schema, only the history rendering).

**BAML tool classes (updated):**

```baml
class CompanyInfoTool {
  type "function_call"
  tool_name "company_info" @description("Searches the company knowledge base")
  query string @description("The question to search for")
}

class ReplyTool {
  type "function_call"
  tool_name "reply" @description("Sends the email reply to the customer")
  text string @description("The reply text to send")
}
```

**BAML types for chat history:**

```baml
class FunctionCallResponse {
  type "function_call_response"
  tool_call_id string
  output string @description("JSON result from tool execution")
}

class ChatHistoryEntry {
  role string @description("'user' or 'assistant'")
  label string? @description("'[Customer]' or '[Human Agent]' for human messages, null for tool calls")
  content string @description("Message text, or JSON function_call / function_call_response")
}
```

The BAML `EmailAgentTurn` prompt template iterates over `ChatHistoryEntry[]` using `_.role()` to set proper message roles, replacing the current `ConversationMessage[]` parameter.

**`tool_call_id` handling:** The model does not generate the `tool_call_id` — it is assigned server-side after the model responds. When persisting to `bot_tool_calls`, the server generates a UUID, stores it with the input/output, and uses it when rendering that tool call in future chat history. The live output from BAML does not include `tool_call_id`; it is spliced in during history reconstruction.

**Persistence:** Each `agentTurn` step writes a `bot_tool_calls` row after executing a tool. The `reply` tool call is also persisted (with the reply text as input and `{"sent": true}` as output) so the full reasoning chain is recorded even for the final turn.

## Owner Replies to Email — Implements UC-E5: Owner Replies to Email

The owner reply is async. The controller persists the email row with `status = 'pending'` and returns immediately. A DBOS workflow handles attachment upload and email sending in the background. The client polls the email status.

~~~mermaid
sequenceDiagram
    participant O as Owner
    participant C as ChatController
    participant CS as ChatService
    participant DB as Database

    rect rgb(240, 248, 255)
    note over O,DB: Persist + Enqueue (synchronous)
    O->>C: POST /v1/chats/:id/emails {body_text, attachments?}
    C->>CS: sendOwnerReply(userId, chatId, bodyText, attachments?)
    CS->>DB: Verify owner belongs to chat's company
    CS->>DB: TX: Insert email (status = 'pending', sender: user), insert attachment metadata (status = 'pending'), set bot_enabled = false
    CS->>CS: DBOS.startWorkflow(SendOwnerEmail, emailId)
    CS-->>C: Email record (status = 'pending')
    C-->>O: 202 { email }
    end
~~~

~~~mermaid
sequenceDiagram
    participant W as SendOwnerEmail Workflow
    participant SA as StoreAttachment (child workflows)
    participant DB as Database
    participant RS as ResendService

    rect rgb(240, 255, 240)
    note over W,SA: Step 1: Upload Attachments (parallel child workflows)
    W->>DB: Load attachment metadata for email
    W->>SA: DBOS.startWorkflow(StoreAttachment) for each attachment
    note over W: await Promise.allSettled(handles.map(h => h.getResult()))
    SA-->>W: Each settles as fulfilled (stored) or rejected (failed)
    loop For each rejected result
        W->>DB: Update attachment status = 'failed'
    end
    end

    rect rgb(255, 248, 240)
    note over W,RS: Step 2: Send Email
    W->>DB: Load email, chat, latest inbound email (for threading headers)
    note over W: from = latestInbound.replyToAddress ?? company.email_addresses[0]
    W->>RS: sendEmail(from, to, text, In-Reply-To, References, attachments)
    RS-->>W: { id }
    W->>DB: Update email status = 'sent'
    end

    rect rgb(240, 240, 255)
    note over W: Step 3: Enqueue Summary
    note over W: If chat has > 2 emails
    W->>W: DBOS.startWorkflow(UpdateChatSummary, chatId)
    end
~~~

## Enable Email Support — Implements UC-E1: Enable Email Support

Email support is enabled in two steps:

1. **Add email addresses** — The owner updates the company via `PATCH /v1/companies/:id` with an `email_addresses` array. These are the addresses the company receives customer emails at (e.g., `support@acme.com`). The array is stored directly on the companies table.
2. **Create a subdomain** — The owner calls `POST /v1/subdomains` to create a routing subdomain. This returns 202 and enqueues a DBOS workflow to set up DNS. The client polls `GET /v1/subdomains` until `verified` is true.

~~~mermaid
sequenceDiagram
    participant O as Owner
    participant C as CompanyController
    participant CS as CompanyService
    participant DB as Database

    rect rgb(240, 248, 255)
    note over O,DB: Step 1: Add Email Addresses
    O->>C: PATCH /v1/companies/:id { email_addresses }
    C->>CS: updateCompany(userId, companyId, { email_addresses })
    CS->>DB: Update company.email_addresses
    DB-->>CS: Company
    CS-->>C: Company
    C-->>O: 200 { company }
    end
~~~

~~~mermaid
sequenceDiagram
    participant O as Owner
    participant C as SubdomainController
    participant S as SubdomainService
    participant DB as Database

    rect rgb(255, 248, 240)
    note over O,DB: Step 2: Create Subdomain
    O->>C: POST /v1/subdomains
    C->>S: createSubdomain(userId)
    S->>DB: Load user's company
    note over S: Generate subdomain (adjective-noun-number pattern)
    S->>DB: Insert subdomains row
    DB-->>S: Subdomain
    S->>S: Enqueue SetupSubdomain DBOS workflow
    S-->>C: Subdomain (verified: false)
    C-->>O: 202 { subdomain }
    end

    rect rgb(240, 255, 240)
    note over O,C: Poll for verification
    O->>C: GET /v1/subdomains
    C-->>O: 200 { subdomains } (check verified field)
    end
~~~

The subdomain is generated using a random human-readable pattern (adjective-noun-number, e.g., `bright-falcon-42`) with a uniqueness retry loop. The SetupSubdomain DBOS workflow handles DNS provisioning asynchronously (see "Setup Subdomain DNS" below).

## Toggle Bot for Chat — Implements UC-E6: Owner Toggles Bot for Chat

~~~mermaid
sequenceDiagram
    participant O as Owner
    participant C as ChatController
    participant CS as ChatService
    participant DB as Database

    O->>C: PATCH /v1/chats/:id { bot_enabled }
    C->>CS: toggleBot(userId, chatId, enabled)
    CS->>DB: Verify owner belongs to chat's company
    CS->>DB: Update chat.bot_enabled
    DB-->>CS: Updated chat
    CS-->>C: Chat
    C-->>O: 200 { chat }
~~~

## Update Chat Summary — Implements UC-E9: Update Chat Summary

~~~mermaid
sequenceDiagram
    participant W as UpdateChatSummary Workflow
    participant DB as Database
    participant LLM as LLM (BAML)

    W->>DB: Load all emails in chat (chronological)
    DB-->>W: Email list
    W->>DB: Load existing chat summary
    DB-->>W: Existing summary (or null)
    W->>LLM: SummarizeChat(messages, existing_summary)
    LLM-->>W: Updated summary
    W->>DB: Update chat.summary
~~~

## Setup Subdomain DNS — DBOS Workflow

~~~mermaid
sequenceDiagram
    participant W as SetupSubdomain Workflow
    participant RD as ResendDomainService
    participant GD as GoDaddyDnsService
    participant DB as Database

    rect rgb(240, 248, 255)
    note over W,RD: Step 1: Create Resend Domain
    W->>RD: createResendDomain(subdomain)
    RD-->>W: { id, records[] }
    end

    rect rgb(255, 248, 240)
    note over W,DB: Step 2: Store Resend Domain ID
    W->>DB: Update subdomain.resend_domain_id = domainId
    end

    rect rgb(240, 255, 240)
    note over W,GD: Step 3: Configure DNS Records
    W->>GD: configureDns(records)
    GD-->>W: OK
    end

    rect rgb(248, 248, 240)
    note over W,RD: Step 4: Trigger Verification
    W->>RD: triggerVerification(domainId)
    RD-->>W: OK
    end

    rect rgb(255, 240, 240)
    note over W,RD: Step 5: Poll Verification (max 10 retries, exponential backoff)
    loop Until verified or max retries
        W->>RD: checkVerification(domainId)
        RD-->>W: verified: boolean
    end
    end

    rect rgb(240, 240, 255)
    note over W,DB: Step 6: Mark Verified
    W->>DB: Update subdomain.verified = true
    end
~~~

All operations are `@DBOS.step()`. No child workflows from steps. No bare DB access in workflow body. The verification poll uses bounded retries (max 10) with exponential backoff to avoid hammering the Resend API.

## List Chats — Implements UC-E7: List Chats

~~~mermaid
sequenceDiagram
    participant O as Owner
    participant C as ChatController
    participant CS as ChatService
    participant DB as Database

    O->>C: GET /v1/chats?channel=email&page_token=X
    C->>CS: listChats(userId, opts)
    CS->>DB: Load user's company
    CS->>DB: SELECT chats WHERE company_id = ? ORDER BY updated_at DESC
    DB-->>CS: Chat[]
    CS-->>C: Chat[]
    C-->>O: 200 { chats, page_token }
~~~

## View Chat Emails — Implements UC-E8: View Chat Messages

~~~mermaid
sequenceDiagram
    participant O as Owner
    participant C as ChatController
    participant CS as ChatService
    participant DB as Database

    O->>C: GET /v1/chats/:id/emails?page_token=X
    C->>CS: listEmails(userId, chatId, opts)
    CS->>DB: Verify owner belongs to chat's company
    CS->>DB: SELECT emails WHERE chat_id = ? with attachments
    DB-->>CS: Email[] with Attachment[]
    CS-->>C: Email[]
    C-->>O: 200 { emails, page_token }
~~~

---

# Tables

## companies — Modified

Add email_addresses column. [UC-E1]

| Column | Type | Change | Notes |
|---|---|---|---|
| email_addresses | varchar(255)[] | ADD, DEFAULT '{}' | Company's email addresses for receiving customer emails |

## chats

A conversation thread between a company and an end user. [UC-E3, UC-E5, UC-E6, UC-E7]

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | serial | PK | |
| company_id | integer | FK → companies.id, NOT NULL | |
| end_user_id | integer | FK → end_users.id, NOT NULL | |
| channel | chat_channel | NOT NULL | 'email' (future: 'sms', 'whatsapp') |
| status | chat_status | NOT NULL, DEFAULT 'open' | 'open', 'closed' |
| bot_enabled | boolean | NOT NULL, DEFAULT true | |
| subject | varchar(1024) | | Set from first email's subject line |
| summary | text | | AI-generated conversation summary [UC-E9] |
| created_at | timestamp | NOT NULL, DEFAULT now() | |
| updated_at | timestamp | NOT NULL, DEFAULT now() | |

## emails

Individual email messages within a chat. [UC-E3, UC-E4, UC-E5, UC-E8]

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | serial | PK | |
| chat_id | integer | FK → chats.id, NOT NULL | |
| direction | email_direction | NOT NULL | 'inbound', 'outbound' |
| end_user_id | integer | FK → end_users.id, nullable | Set when sender is end user |
| bot_id | integer | FK → bots.id, nullable | Set when sender is bot |
| user_id | integer | FK → users.id, nullable | Set when sender is owner |
| subject | varchar(1024) | | |
| body_text | text | | Plain text content |
| body_html | text | | HTML content |
| external_email_id | varchar(255) | UNIQUE | Resend email ID for dedup [UC-E3 ext 7b] |
| message_id | varchar(512) | | RFC Message-ID header |
| in_reply_to | varchar(512) | | RFC Message-ID of parent [UC-E3 ext 7a] |
| reference_ids | text[] | | Full thread chain of Message-IDs |
| from_address | varchar(512) | | Sender email address from Resend |
| to_addresses | text[] | | Recipient email addresses from Resend |
| forwarded_to | varchar(512) | | From X-Forwarded-To or Delivered-To header |
| reply_to_address | varchar(512) | | Entry from company.email_addresses matching a to address; used as from for replies |
| status | email_status | NOT NULL, DEFAULT 'received' | Inbound: 'received'. Outbound: 'pending' → 'sent' or 'failed' |
| created_at | timestamp | NOT NULL, DEFAULT now() | |

**Constraint:** Exactly one of `end_user_id`, `bot_id`, `user_id` must be non-null. Enforced via CHECK constraint.

## attachments

File metadata and storage references for email attachments. All attachment content (inbound and outbound) is stored in Tigris. Resend download URLs are temporary and expire — inbound content is downloaded and persisted to Tigris by the ProcessInboundEmail workflow after metadata is stored. [UC-E3, UC-E4, UC-E5]

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | serial | PK | |
| email_id | integer | FK → emails.id, NOT NULL | |
| external_attachment_id | varchar(255) | | Resend attachment ID (inbound only) |
| filename | varchar(512) | NOT NULL | |
| content_type | varchar(255) | NOT NULL | MIME type |
| size_bytes | integer | | Null until downloaded; populated by workflow |
| storage_key | varchar(1024) | | Null until uploaded to Tigris; `{companyId}/attachments/{emailId}/{uuid}.{ext}` |
| status | attachment_status | NOT NULL, DEFAULT 'pending' | 'pending', 'stored', 'failed' |
| summary | text | | AI-generated summary of content and relevance; cached after first generation |
| created_at | timestamp | NOT NULL, DEFAULT now() | |

## bot_tool_calls

Records every tool call made by the bot during the agent loop, preserving both input and output. Used to reconstruct faithful chat history for subsequent LLM turns. [UC-E4]

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | serial | PK | |
| chat_id | integer | FK → chats.id, NOT NULL | |
| tool_call_id | varchar(255) | NOT NULL, UNIQUE | Random UUID generated at creation time; links input to output in chat history |
| tool_name | varchar(255) | NOT NULL | e.g., `company_info`, `reply` |
| input | jsonb | NOT NULL | The tool call arguments as produced by the LLM |
| output | jsonb | NOT NULL | The tool execution result |
| created_at | timestamp | NOT NULL, DEFAULT now() | Used for chronological ordering in chat history |

## subdomains

Stores company email subdomains for inbound email routing. Distinct from the `email_addresses` array on companies — stores the DNS domain itself with verification state. A company can have multiple subdomains (initially auto-generated, later custom). [UC-E1]

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | serial | PK | |
| company_id | integer | FK → companies.id, NOT NULL | |
| subdomain | varchar(63) | NOT NULL, UNIQUE | e.g., `bright-falcon-42` |
| resend_domain_id | varchar(255) | | External ID from Resend domain creation |
| verified | boolean | NOT NULL, DEFAULT false | Set true after DNS verification |
| created_at | timestamp | NOT NULL, DEFAULT now() | |

## end_users — Modified

Add email column, make phone_number_id nullable. [UC-E3]

| Column | Type | Change | Notes |
|---|---|---|---|
| email | varchar(255) | ADD | End user's email address |
| phone_number_id | integer | ALTER: drop NOT NULL | Email-only end users won't have a phone number |

## New Enums

| Enum | Values |
|---|---|
| chat_channel | 'email' |
| chat_status | 'open', 'closed' |
| email_direction | 'inbound', 'outbound' |
| email_status | 'received', 'pending', 'sent', 'failed' |
| attachment_status | 'pending', 'stored', 'failed' |

## Indices

| Table | Index | Columns | Notes |
|---|---|---|---|
| emails | idx_emails_chat_id | chat_id | Message listing by chat |
| emails | idx_emails_external_email_id | external_email_id | Dedup lookup |
| emails | idx_emails_in_reply_to | in_reply_to | Thread lookup |
| chats | idx_chats_company_updated | company_id, updated_at DESC | Chat listing |
| chats | idx_chats_end_user_company_status | end_user_id, company_id, status | Find open chat |
| end_users | idx_end_users_email_company | email, company_id | Email lookup |
| attachments | idx_attachments_email_id | email_id | Attachment listing |
| bot_tool_calls | idx_bot_tool_calls_chat_id | chat_id, created_at ASC | Chat history reconstruction |
| subdomains | idx_subdomains_subdomain | subdomain | Subdomain lookup for routing |
| subdomains | idx_subdomains_company_id | company_id | List subdomains by company |

---

# APIs

## Update Company `PATCH /v1/companies/:id`

Updates company fields, including `email_addresses`. [UC-E1]

### Request

- Headers
    - content-type: `application/json`
    - authorization: `Bearer <jwt>`
- Body
    - company: object
        - email_addresses: string[] (optional) — replaces the full array

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - company: object (full company fields including email_addresses)

### Not Found Response `404`

- Body
    - error: object
        - code: 404
        - message: "Company not found"

## Resend Webhook `POST /v1/resend/webhook`

Receives inbound email events from Resend. Uses Svix signature verification. [UC-E3]

### Request

- Headers
    - content-type: `application/json`
    - svix-id: string
    - svix-timestamp: string
    - svix-signature: string
- Body
    - type: string (`email.received`)
    - data: object
        - email_id: string
        - from: string
        - to: string[]
        - subject: string
        - attachments: array

### Success Response `200`

- Body: empty

### Invalid Signature Response `401`

- Body
    - error: object
        - code: 401
        - message: "Invalid webhook signature"

## List Chats `GET /v1/chats`

Lists chats for the authenticated user's company. [UC-E7]

### Request

- Headers
    - authorization: `Bearer <jwt>`
- Query
    - channel: string (optional, e.g., `email`)
    - page_token: string (optional, chat id cursor)
    - limit: string (optional, default 20)

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - chats: array
        - id: integer
        - company_id: integer
        - end_user_id: integer
        - channel: string
        - status: string
        - bot_enabled: boolean
        - subject: string | null
        - summary: string | null
        - created_at: string (ISO 8601)
        - updated_at: string (ISO 8601)
    - page_token: integer | null

## Update Chat `PATCH /v1/chats/:id`

Toggles bot for a chat. [UC-E6]

### Request

- Headers
    - content-type: `application/json`
    - authorization: `Bearer <jwt>`
- Body
    - chat: object
        - bot_enabled: boolean

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - chat: object (full chat fields)

### Not Found Response `404`

- Body
    - error: object
        - code: 404
        - message: "Chat not found"

## List Chat Emails `GET /v1/chats/:id/emails`

Lists emails in a chat. [UC-E8]

### Request

- Headers
    - authorization: `Bearer <jwt>`
- Query
    - page_token: string (optional, email id cursor)
    - limit: string (optional, default 20)

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - emails: array
        - id: integer
        - chat_id: integer
        - direction: string
        - status: string (received | pending | sent | failed)
        - end_user_id: integer | null
        - bot_id: integer | null
        - user_id: integer | null
        - subject: string | null
        - body_text: string | null
        - body_html: string | null
        - attachments: array
            - id: integer
            - filename: string
            - content_type: string
            - size_bytes: integer | null
        - created_at: string (ISO 8601)
    - page_token: integer | null

## Send Owner Reply `POST /v1/chats/:id/emails`

Owner sends a reply in a chat. Async — persists the email with `status = 'pending'`, enqueues a workflow to upload attachments and send, returns immediately. The client polls the email status via `GET /v1/chats/:id/emails`. Disables bot. [UC-E5]

### Request

- Headers
    - content-type: `application/json`
    - authorization: `Bearer <jwt>`
- Body
    - email: object
        - body_text: string
        - attachments: array (optional)
            - filename: string
            - content_type: string
            - content: string (base64-encoded)

### Success Response `202`

- Headers
    - content-type: `application/json`
- Body
    - email: object
        - id: integer
        - chat_id: integer
        - direction: "outbound"
        - status: "pending"
        - user_id: integer
        - body_text: string
        - attachments: array
        - created_at: string (ISO 8601)

### Chat Not Found Response `404`

- Body
    - error: object
        - code: 404
        - message: "Chat not found"

## Create Subdomain `POST /v1/subdomains`

Creates a subdomain for the authenticated user's company and enqueues DNS setup. Returns 202 — the subdomain is not immediately usable. The client polls `GET /v1/subdomains` until the `verified` field is `true`.

### Request

- Headers
    - content-type: `application/json`
    - authorization: `Bearer <jwt>`
- Body: empty

### Accepted Response `202`

- Headers
    - content-type: `application/json`
- Body
    - subdomain: object
        - id: integer
        - company_id: integer
        - subdomain: string
        - verified: boolean (initially false)
        - created_at: string (ISO 8601)

Side effect: enqueues SetupSubdomain DBOS workflow.

### No Company Response `400`

- Headers
    - content-type: `application/json`
- Body
    - error: object
        - code: 400
        - message: "User has no company"

### Max Subdomains Response `409`

- Headers
    - content-type: `application/json`
- Body
    - error: object
        - code: 409
        - message: "Company already has max subdomains"

## List Subdomains `GET /v1/subdomains`

Lists subdomains for the authenticated user's company.

### Request

- Headers
    - authorization: `Bearer <jwt>`

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - subdomains: array
        - id: integer
        - company_id: integer
        - subdomain: string
        - verified: boolean
        - created_at: string (ISO 8601)

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration |
|---|---|---|---|
| UC-E1: Update Company Email Addresses | Flow | x | x |
| UC-E3: Receive Inbound Email | Flow | x | x |
| UC-E4: Bot Responds to Email | Flow | x | |
| UC-E5: Owner Replies to Email | Flow | x | x |
| UC-E6: Toggle Bot for Chat | Flow | | x |
| UC-E7: List Chats | Flow | | x |
| UC-E8: View Chat Emails | Flow | | x |
| UC-E9: Update Chat Summary | Flow | x | |
| Subdomain routing (forwarded) | Flow | x | x |
| Subdomain routing (direct) | Flow | x | x |
| Setup Subdomain DNS | Workflow | x | |
| Create Subdomain | Flow | x | x |
| List Subdomains | Flow | | x |

## Test Approach

### Unit Tests

| Component | What to Test |
|---|---|
| CompanyService | Email addresses array update, validation |
| ChatService.receiveInboundEmail | End user find/create, chat find/create, dedup by external_email_id, bot enqueue decision, in_reply_to threading, subdomain routing, forwardedTo handling, replyTo derivation, fallback to company email_addresses array |
| ChatService.sendOwnerReply | Threading header construction, bot disable side effect, attachment upload to Tigris |
| ChatService.findOrCreateChat | Open chat reuse, closed chat creates new, in-reply-to message lookup |
| ResendService | Request construction, response parsing, signature verification |
| ProcessInboundEmail workflow | Attachment download+storage step, attachment failure handling, agent tool loop, precanned error on LLM failure, precanned error when reply tool not called |
| Chat history reconstruction | Chronological merge of emails + tool calls, correct role/label assignment, BAML-aligned tool call formatting, tool_call_id linking |
| UpdateChatSummary workflow | Summary generation from email history, existing summary inclusion |
| SubdomainService | Random subdomain generation, uniqueness retry |
| SubdomainUtils | Subdomain extraction from email addresses, forwardedTo priority |
| SetupSubdomain workflow | Step ordering, DNS failure handling, verification polling |
| ResendDomainService | Domain creation, verification request/response |
| GoDaddyDnsService | DNS record addition |

Mock repositories and ResendService. No database.

### Integration Tests

| Route | Scenarios |
|---|---|
| PATCH /v1/companies/:id | Update email_addresses array, 404 for wrong company |
| POST /v1/subdomains | Success (202), no company (400) |
| GET /v1/subdomains | Returns company's subdomains |
| POST /v1/resend/webhook | Valid email → email persisted, duplicate → idempotent (200), invalid sig → 401, unknown address → 200 no-op, routes via subdomain, routes via forwardedTo header |
| GET /v1/chats | Pagination, channel filter, empty list |
| GET /v1/chats/:id/emails | Pagination, chronological order, includes attachment metadata |
| POST /v1/chats/:id/emails | Owner reply persisted + bot disabled, with attachments, 404 for wrong company |
| PATCH /v1/chats/:id | Toggle bot on/off, 404 for wrong company |

Uses test database with real queries. StubResendService and StubStorageService for external calls.

### End-to-End Bot Testing

Unit and integration tests verify individual components, but testing the full bot flow (inbound email → attachment processing → agent tool loop → outbound reply) requires sending real emails. The [Google Workspace CLI](https://github.com/googleworkspace/cli) (`gws`) provides the underlying Gmail API access, but developers and agents shouldn't need to learn it directly.

#### `email-test` TypeScript CLI

A TypeScript CLI at `src/cli.ts` provides domain-specific commands for end-to-end email testing. It boots the full DI container, giving it direct access to all repositories and services — no brittle inline scripts or shell hacks.

**Architecture:**

~~~mermaid
graph LR
    A[scripts/email-test] -->|"npx tsx"| B[src/cli.ts]
    B --> C[setupContainer]
    C --> D[Repositories]
    C --> E[Services]
    B --> F["arg (CLI parser)"]
    B -->|"child_process"| G[gws CLI]
~~~

**Design rationale:** By creating a proper TypeScript entrypoint that initializes the DI container, the CLI reuses the same repositories, services, and query logic as the server. This creates a tight feedback loop — the same code that runs in production handles DB lookups in the CLI, so bugs surface immediately. Commands are small exported functions, making them unit-testable without shell execution.

**Components:**

| File | Role |
|---|---|
| `src/cli.ts` | Entrypoint: parses args with `arg`, sets up container, routes to commands |
| `scripts/email-test` | Thin bash wrapper: `exec npx tsx src/cli.ts "$@"` |

**Dependencies:**

| Package | Purpose |
|---|---|
| [`arg`](https://github.com/vercel/arg) | Zero-dependency CLI argument parser |
| `gws` | Google Workspace CLI for Gmail API (external, must be installed globally) |

**Commands:**

```bash
# Send a new email to a company by name (resolves email address from DB)
scripts/email-test send --company "Acme Auto" \
  --subject "Question about pricing" \
  --body "Hi, what are your rates for an oil change?"

# Reply to the most recent email in a chat (resolves threading automatically)
scripts/email-test reply --chat-id 42 \
  --body "Thanks, can I book an appointment for tomorrow?"

# Send with an attachment
scripts/email-test send --company "Acme Auto" \
  --subject "Quote request" \
  --body "See attached for details" \
  --attach ./test-fixtures/sample-invoice.pdf

# Watch for bot replies (streams to stdout as JSON)
scripts/email-test watch

# List recent chats for a company (quick sanity check)
scripts/email-test chats --company "Acme Auto"
```

**How it works:**

1. `scripts/email-test` delegates to `npx tsx src/cli.ts` with all arguments.
2. `src/cli.ts` calls `setupContainer()` to initialize the DI container with the production database.
3. The `arg` parser extracts the subcommand and flags.
4. Each command resolves dependencies from the container (CompanyRepository, EmailRepository, ChatRepository).
5. DB lookups use repository methods directly — the same code paths as the server.
6. Gmail sending delegates to `gws` via `child_process.execFileSync` with structured JSON output.
7. `process.exit(0)` ensures the Node process terminates after the command completes (Drizzle's connection pool does not auto-close).

**Repository change:** `CompanyRepository.findByName(name)` is added to support company lookup by name.

**Prerequisites:** `gws` must be installed and authenticated (`gws auth login`). The CLI checks for this and prints setup instructions if missing.

#### AGENTS.md testing instructions

Add an `## Email Testing` section to `AGENTS.md` (or create it) so any agent starting with no context knows how to run end-to-end email tests:

```markdown
## Email Testing

To test the email bot end-to-end, use `scripts/email-test`:

1. Ensure `gws` is installed: `npm install -g @googleworkspace/cli`
2. Authenticate: `gws auth login`
3. Send a test email: `scripts/email-test send --company "Company Name" --body "Your question"`
4. Watch for the bot reply: `scripts/email-test watch`
5. Verify: the bot should reply within 30 seconds. Check chat state via API or `scripts/email-test chats`.
```

#### Test scenarios

| Scenario | Command | What to Verify |
|---|---|---|
| New conversation | `email-test send --company "Acme"` | Chat created, bot replies, email threaded |
| Follow-up in thread | `email-test reply --chat-id 42` | Same chat reused, summary updated |
| Attachment handling | `email-test send --attach file.pdf` | Attachment stored in Tigris, summarized, bot references it |
| Bot disabled | Disable bot via API, then `email-test send` | Email persisted but no bot reply |
| Owner reply | Owner replies via API, then end user sends again | Bot stays disabled, email persisted |

## Test Infrastructure

- `StubResendService` — canned responses for send, receive, attachment retrieval, signature verification
- `StubStorageService` — in-memory storage for attachment uploads/downloads
- `emailFactory` — Fishery factory for emails table rows
- `chatFactory` — Fishery factory for chats table rows
- `attachmentFactory` — Fishery factory for attachments table rows
- `botToolCallFactory` — Fishery factory for bot_tool_calls table rows
- `src/cli.ts` — TypeScript CLI entrypoint for end-to-end bot testing
- `scripts/email-test` — thin bash wrapper that delegates to `src/cli.ts`

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Create enums: chat_channel, chat_status, email_direction | yes |
| 2 | schema | Create tables: chats, emails, attachments | yes |
| 3 | schema | Add email column to end_users | yes |
| 4 | schema | Make phone_number_id nullable on end_users | yes |
| 5 | schema | Create table: bot_tool_calls | yes |
| 6 | schema | Add email_addresses column to companies | yes |
| 7 | schema | Add from_address, to_addresses, forwarded_to, reply_to_address columns to emails | yes |
| 8 | schema | Create table: subdomains | yes |

## Deploy Sequence

Single deploy. All migrations are additive (new tables and columns). No existing behavior changes.

## Rollback Plan

All migrations are backwards-compatible. Rolling back the code leaves unused tables in place. Drop tables manually if needed after rollback.

---

# Monitoring

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| emails_received_total | counter | UC-E3 | Inbound emails received via webhook |
| emails_sent_total | counter | UC-E4, UC-E5 | Outbound emails sent (bot + owner) |
| bot_response_duration_ms | histogram | UC-E4 | Time from workflow start to reply sent |
| bot_response_failures_total | counter | UC-E4 | Bot failures resulting in precanned error message |
| webhook_signature_failures_total | counter | UC-E3 | Invalid webhook signatures |

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| bot_response_failures_total rate > 5/min | 5 per minute | page |
| bot_response_duration_ms p99 > 30s | 30 seconds | warn |
| webhook_signature_failures_total rate > 10/min | 10 per minute | warn |

## Logging

- `email.received` — INFO — logged on each valid inbound email with chatId, emailId, companyId
- `email.sent` — INFO — logged on each outbound email with chatId, emailId, senderType
- `bot.response.failed` — ERROR — logged when bot falls back to precanned error, includes chatId and error details
- `webhook.signature.invalid` — WARN — logged on invalid webhook signatures

---

# Decisions

## Use Tigris for attachment storage

**Framework:** Direct criterion

Tigris is an S3-compatible object store built into Fly.io's infrastructure. Since the server deploys on Fly.io, Tigris provides the lowest-latency storage with zero additional infrastructure setup. It supports the same S3 API, so the implementation uses the standard `@aws-sdk/client-s3` package.

**Choice:** Tigris — co-located with the server on Fly.io, S3-compatible, no separate infrastructure to manage.

### Alternatives Considered
- **AWS S3:** Would work but adds cross-provider latency and requires separate AWS credentials management.
- **Cloudflare R2:** S3-compatible but not co-located with Fly.io compute.

## Cache attachment summaries on the attachment row

**Framework:** Direct criterion

The bot needs to understand attachment content to generate relevant replies. Rather than re-reading file content from Tigris and re-processing it on every subsequent message in the chat, each attachment is summarized once (describing what it contains and how it relates to the user's query) and the summary is cached in the `attachments.summary` column. On subsequent chat turns, the cached summary is included in the LLM context directly — no Tigris read, no re-summarization.

This requires a new BAML function `SummarizeAttachment(file_content, user_query) -> string` that produces a concise description of the attachment's content and its relevance to the user's email.

**Choice:** Summarize once, cache on the row, reuse on all subsequent turns.

### Alternatives Considered
- **Re-read from Tigris every turn:** Wastes bandwidth and adds latency. For PDFs or large text files, extraction is expensive to repeat.
- **Don't include attachment context in subsequent turns:** Bot loses context about what the customer sent, leading to worse replies in multi-turn conversations.

## Store all attachment content in Tigris, not Resend

**Framework:** Direct criterion

Resend provides signed download URLs for inbound email attachments, but these URLs have an `expires_at` timestamp — they are temporary. Relying on Resend for permanent attachment storage would mean losing access to attachment content after the URL expires. All inbound attachments must be downloaded from Resend and uploaded to Tigris during inbound email processing. Outbound attachments (owner-uploaded) are stored directly in Tigris.

**Choice:** Download inbound attachments from Resend immediately and store in Tigris. All attachment content lives in Tigris permanently.

### Alternatives Considered
- **Rely on Resend storage:** Would lose access to attachments after download URL expiration. Not viable for long-term storage.
- **Lazy download on first access:** Risk of URL expiration before first access. Adds complexity and failure modes.

## Name the message table `emails` instead of `messages`

**Framework:** Direct criterion

The table contains email-specific columns: subject, body_html, in_reply_to, reference_ids, message_id. These are RFC 5322 email concepts with no meaning in SMS or voice. A generic `messages` table would carry dead columns for non-email channels. Each channel should have its own message table (emails, sms_messages already exists).

**Choice:** `emails` — the table is email-specific, and the codebase already has `sms_messages` as a channel-specific table.

### Alternatives Considered
- **Generic `messages` table:** Would require nullable email-specific columns and a discriminator, adding complexity for future channels that don't share the same shape.

## Use separate foreign keys instead of polymorphic sender

**Framework:** Direct criterion

Polymorphic foreign keys (sender_type + sender_id) break referential integrity at the database level. PostgreSQL cannot enforce a FK constraint that points to different tables based on a discriminator column. Separate nullable FKs (end_user_id, bot_id, user_id) with a CHECK constraint ensure the database enforces exactly one sender per email.

**Choice:** Three nullable FK columns with a CHECK constraint — database-enforced referential integrity.

### Alternatives Considered
- **Polymorphic sender_type + sender_id:** Simpler schema but no FK enforcement. Application bugs could create orphaned references.

## Use DBOS.startWorkflow() instead of DBOSClient in server process

**Framework:** Direct criterion

The ChatService runs inside the Fastify server process, which also runs the DBOS runtime. `DBOS.startWorkflow()` is the in-process API for enqueuing workflows. `DBOSClient` is only needed in the agent process (`agent.ts`), which runs as a separate component without the DBOS runtime.

**Choice:** `DBOS.startWorkflow()` — the server process has direct access to the DBOS runtime.

### Alternatives Considered
- **DBOSClient.enqueue():** Works but adds unnecessary indirection. The client factory exists specifically for the agent process.

## TypeScript CLI with DI container for end-to-end testing

**Framework:** Direct criterion

End-to-end bot testing requires sending real emails, but the raw GWS CLI requires knowing the company's email address, threading flags, and GWS-specific syntax. The CLI must resolve addresses and threading from the database. A bash wrapper with inline `npx tsx -e "..."` scripts is brittle — it duplicates query logic, is hard to test, and can't leverage the existing repository layer.

A TypeScript CLI (`src/cli.ts`) that boots the full DI container reuses the same repositories and services as the server. The `arg` library provides zero-dependency argument parsing. A thin `scripts/email-test` bash wrapper delegates to `npx tsx src/cli.ts` so the command interface stays the same. Command handlers are small exported functions that resolve dependencies from the container, making them independently testable.

**Choice:** TypeScript CLI entrypoint with DI container + `arg` parser. `scripts/email-test` is a one-line bash delegate. GWS CLI remains a dependency for Gmail API access, invoked via `child_process`.

### Alternatives Considered
- **Bash wrapper with inline tsx:** Duplicates query logic outside the repository layer, no test coverage, string interpolation is injection-prone.
- **Use GWS CLI directly:** Requires learning GWS flags, knowing email addresses, manual Message-ID lookup for threading. Not agent-friendly.
- **Custom test harness that calls the webhook directly:** Skips Resend and MX routing, so it doesn't test the full inbound path.

## Persist bot tool calls and reconstruct chat history with BAML-aligned formatting

**Framework:** Direct criterion

The bot's agent loop uses BAML structured output (`CompanyInfoTool | ReplyTool`) instead of OpenAI/Anthropic native tool calling. The model produces JSON matching the BAML class schema, and BAML parses the response. For the model to maintain consistent behavior across multi-turn conversations, the chat history must show tool calls in the same format the model produced — the BAML schema JSON, not a foreign tool calling format.

Persisting tool calls in a `bot_tool_calls` table (with `input` and `output` as JSONB) keeps the storage format-agnostic. The chat history reconstruction layer formats them for the BAML prompt: tool input as an `assistant` message containing the BAML schema JSON, tool output as a `user` message labeled with `tool_call_id`. This matches the model's training distribution (structured JSON output followed by a result) without coupling to any provider's native tool calling wire format.

**Choice:** Separate `bot_tool_calls` table with JSONB input/output, rendered in chat history as plain JSON matching the BAML class schemas, linked by `tool_call_id`.

### Alternatives Considered
- **Store tool calls as extra fields on the emails table:** Mixes concerns — tool calls are not emails. Forces nullable columns on every email row for data that only applies to bot turns.
- **Store the full OpenAI messages array as JSON:** Couples persistence to the provider's wire format. If we switch providers or BAML changes its rendering, stored history becomes incompatible.
- **Don't persist tool calls; re-derive from context:** Loses information (FAQ answers, search results). Forces the bot to re-call tools it already used. Wastes tokens and latency.

## Subdomain routing with backward-compatible fallback

**Framework:** Direct criterion

Inbound emails can arrive via two paths: forwarded from the company's existing email provider (with `X-Forwarded-To` or `Delivered-To` headers), or sent directly to a subdomain address. Subdomain routing extracts the subdomain from `forwardedTo` or `to` and looks it up in the `subdomains` table. If no subdomain match is found, the system falls back to `companyRepo.findByEmailAddress()`, which searches the `email_addresses` array on the companies table. All new email columns (`from_address`, `to_addresses`, `forwarded_to`, `reply_to_address`) are nullable, so existing emails remain valid.

**Choice:** Subdomain routing first, company email_addresses array fallback.

### Alternatives Considered
- **Subdomain routing only:** Would not support companies that haven't created a subdomain yet.
- **Route only by forwardedTo:** Would not support direct-to-subdomain sends.

## Adjective-noun-number pattern for subdomain generation

**Framework:** Direct criterion

Subdomains must be human-readable and unique. An adjective-noun-number pattern (e.g., `bright-falcon-42`) produces memorable subdomains with no external dependency. A uniqueness retry loop handles the rare collision case.

**Choice:** Simple word-list-based generation with retry — no external service needed.

### Alternatives Considered
- **UUID-based subdomains:** Unique but unreadable. Users see these in forwarding config.
- **Company-name-based:** Slug collisions between companies with similar names.

## Store replyTo as varchar, not FK

**Framework:** Direct criterion

The `reply_to_address` column stores the email address string resolved from `company.email_addresses` at receive time. A company's email addresses may change over time — if an address is removed from the array, the stored `replyTo` on historical emails must remain valid for audit. A varchar string is self-contained.

**Choice:** `reply_to_address` as varchar(512) — a snapshot of the resolved address at receive time.

### Alternatives Considered
- **Re-derive from company.email_addresses at send time:** Would break if the address is removed between receive and reply.

## Email addresses as text array on companies, not a separate table

**Framework:** Direct criterion

Email addresses are simple strings — the company's support email addresses (e.g., `support@acme.com`). They have no lifecycle, no verification state, and no external IDs. A separate `email_addresses` table with its own PK, FK, and uniqueness constraint adds unnecessary indirection for what is a plain list of strings. A `varchar(255)[]` column on the companies table is simpler to query, update, and reason about.

**Choice:** `companies.email_addresses varchar(255)[]` — updated via the company API.

### Alternatives Considered
- **Separate `email_addresses` table:** Adds a table, a repository, a service, and two API endpoints for what amounts to a string list. Overhead not justified.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | What library should be used for PDF text extraction from attachments? Options: `pdf-parse`, `pdfjs-dist`. | open | |
| Q-02 | Should the bot response workflow have a per-company concurrency limit on the DBOS queue to prevent LLM overload? | open | |
| Q-03 | Should bot replies be sent as plain text or wrapped in a minimal HTML template? | open | |
| Q-04 | Email forwarding setup (REQ-E2) — how should forwarding instructions be presented to the user? This is a frontend/UX concern. | open | |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-03-16 | Claude | Initial draft |
| 2026-03-16 | Claude | Add bot_tool_calls table, chat history reconstruction design, BAML-aligned tool call formatting |
| 2026-03-18 | Claude | Add email address fields (from, to, forwardedTo, replyTo), subdomains table, subdomain-based routing, SetupSubdomain DNS workflow, subdomain management APIs |
| 2026-03-18 | Claude | Remove email_addresses table — move to varchar(255)[] on companies. Decouple subdomain creation as its own 202 API with polling. Update company API for email_addresses |
