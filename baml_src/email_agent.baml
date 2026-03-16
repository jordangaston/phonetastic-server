class ConversationMessage {
  direction string @description("'inbound' or 'outbound'")
  text string
}

class AttachmentSummary {
  filename string
  summary string
}

class CompanyInfoTool {
  tool_name "company_info" @description("Searches the company knowledge base to answer questions about the business")
  query string @description("The question to search for")
}

class ReplyTool {
  tool_name "reply" @description("Sends the email reply to the customer. You MUST call this tool to respond.")
  text string @description("The reply text to send")
}

function EmailAgentTurn(
  company_name: string,
  conversation: ConversationMessage[],
  attachment_summaries: AttachmentSummary[],
  chat_summary: string?,
  tool_results: string?
) -> CompanyInfoTool | ReplyTool {
  client GPT4_1Nano
  prompt #"
    {{ _.role("system") }}
    You are an AI email assistant for {{ company_name }}.
    You help customers by answering their questions using the company knowledge base.
    You MUST use the reply tool to send your response. Do NOT respond with plain text.
    If you need information about the company, use the company_info tool first.
    Be helpful, professional, and concise.

    {{ ctx.output_format }}

    {% if chat_summary %}
    Conversation summary: {{ chat_summary }}
    {% endif %}

    {% if attachment_summaries | length > 0 %}
    Attachments:
    {% for att in attachment_summaries %}
    - {{ att.filename }}: {{ att.summary }}
    {% endfor %}
    {% endif %}

    {% for msg in conversation %}
    {{ _.role("user" if msg.direction == "inbound" else "assistant") }}
    {{ msg.text }}
    {% endfor %}

    {% if tool_results %}
    {{ _.role("user") }}
    Previous tool results:
    {{ tool_results }}
    {% endif %}

    {{ _.role("user") }}
    Please respond to the customer's latest message.
  "#
}
