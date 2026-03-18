function SummarizeChat(messages: string, existing_summary: string?) -> string {
  client GeminiFlash
  prompt #"
    {{ _.role("system") }}
    You are a conversation summarization assistant. Given an email conversation between a customer and support, produce a concise summary (2-4 sentences) that captures: the customer's main issue, key information exchanged, current status, and any pending actions.

    If an existing summary is provided, incorporate the new messages into it rather than starting from scratch. Keep the summary under 500 characters.

    {{ _.role("user") }}
    {% if existing_summary %}
    Previous summary:
    {{ existing_summary }}

    New messages:
    {% endif %}
    {{ messages }}
  "#
}
