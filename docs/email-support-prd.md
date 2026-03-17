---
tags: prd, email-support
summary: "Product Requirements Document for Email Support for Phonetastic"
locked: false
---

# Email Support for Phonetastic

*"Automate your customer service over email using AI."*

## Intro & Goal

Phonetastic automates customer service phone calls with AI voice agents. Businesses that also receive support requests over email must handle those manually or use a separate tool. Email Support extends Phonetastic so the same AI bot that handles voice calls and SMS can read, understand, and reply to customer emails — one AI agent across every channel.

## Who's It For?

- **Small business owner** — Runs a local service business (salon, auto shop, clinic) with limited staff to answer emails. Needs fast replies to common questions and appointment booking without manual back-and-forth.
- **SaaS business owner** — Operates a software product and receives support and sales emails. Needs accurate answers drawn from the company knowledge base and quick response times to reduce churn.
- **E-commerce business owner** — Sells products online and fields order and product questions via email. Needs instant answers about products, pricing, and availability using company information.
- **Real estate agent** — Receives inquiry emails from prospective buyers and sellers throughout the day. Needs appointment scheduling and property-related Q&A while showing homes.

All personas share three core needs:

1. **Reliability** — The bot must always answer. Every inbound email gets a response, no exceptions.
2. **AI-generated replies** grounded in company information.
3. **Appointment booking** via email, without manual back-and-forth.

## Why Build It?

- **Proven demand.** This capability powered customer support for Helpbase.ai, which automated 90% of email support for Trimbox.io before its acquisition. The same team builds it again with better infrastructure.
- **Most-requested channel.** Email is the #1 requested channel expansion from Phonetastic customers.
- **Low technical risk.** The team has built this before, has the source code, and the core AI agent and tools (company knowledge, appointment booking) already exist in Phonetastic. The work is integration, not invention.

## What Is It?

### Glossary

| Term | Definition |
|------|-----------|
| Email Address | An email address owned by a company. Used to send and receive emails on behalf of that company. |
| Email | An email message that was sent or received. |
| Chat | A turn-based communication channel between a company and an end user. SMS, email, and WhatsApp conversations are all represented as chats. |

### User Types

- **Owner / Member** — Configure email addresses, assign bots to handle email, and view email history.
- **Bot** — Reads inbound emails and generates replies using company information and skills (FAQ, appointment booking). Tone adapts for written communication.
- **End User** — Sends and receives emails with the company's email address like any normal email interaction. No special portal or account required.

### Requirements

#### Email Address Setup

A business owner enables email support and connects their existing email.

- **REQ-E1:** When a user enables inbound email support for the first time, the system shall create a Phonetastic email address for the company.
- **REQ-E2:** The system shall allow the user to set up forwarding rules for their existing email address(es) to route incoming emails to the Phonetastic email address.

#### Inbound Email Handling

An end user emails the company. The bot reads the message and replies.

- **REQ-E3:** While a bot is enabled for a chat, the company's bot shall automatically respond to customer messages using its skills and tools.
- **REQ-E4:** When a user responds to a customer's message in a chat, the bot shall be disabled for that chat.
- **REQ-E5:** The system shall allow the user to enable or disable the bot for a chat.
- **REQ-E6:** The system shall allow the user to respond to a customer's latest email in the chat.
- **REQ-E7:** The system shall allow the user to view all messages sent and received in an email chat.
- **REQ-E8:** The system shall support sending and receiving document and media attachments.
- **REQ-E9:** When the bot receives an attachment under 10 MB, the bot shall read and understand the attachment content to inform its reply.
- **REQ-E10:** If an internal error occurs in the system or a dependency, then the system shall not lose the incoming email message.
- **REQ-E11:** While the chat has more than two messages, the system shall maintain a summary of the chat.
- **REQ-E12:** When the system receives an inbound email message, the chat summary shall be updated.

## Competitors & Product Inspiration

| Competitor | Admire | Avoid |
|-----------|--------|-------|
| **Zendesk** | Comprehensive feature set, strong email automation. | Bloated setup, complex configuration — opposite of our 5-minute goal. |
| **Intercom** | Clean UX, AI-first approach to support. | Expensive, heavy onboarding. |
| **Freshdesk** | Good small-business positioning. | Feature sprawl, cluttered interface. |
| **Help Scout** | Simple, human-feeling email support. | Limited AI automation. |
| **Helpbase** | Proven 90% automation rate, simple setup. | No longer maintained; Phonetastic is the successor. |

**Design principle:** A business owner should go from zero to AI-powered email support in five minutes or less. Complexity is the enemy.

## Mockups

*To be determined.*

## Tech Notes

- **Email provider:** Resend for sending and receiving emails.
- **Existing stack:** Reuse all current Phonetastic infrastructure — DBOS for workflow processing, PostgreSQL for storage, Fastify for the API server, Drizzle ORM for data access.
- **Prior art:** The founders have implemented this before. Source code is at `~/workspace/helpbase`.

## Go to Market

*To be determined.*

## Post-Launch Marketing

*To be determined.*
