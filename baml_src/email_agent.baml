class ChatHistoryEntry {
  role string @description("'user' or 'assistant'")
  label string? @description("'[Customer]', '[Human Agent]', or '[Attachment]' for context, null for tool calls")
  content string @description("Message text, or JSON function_call / function_call_response")
}

class CompanyInfoTool {
  type "function_call"
  tool_name "company_info" @description("Searches the company knowledge base to answer questions about the business")
  query string @description("The question to search for")
}

class ReplyTool {
  type "function_call"
  tool_name "reply" @description("Sends the email reply to the customer. You MUST call this tool to respond.")
  text string @description("The reply text to send")
}

function EmailAgentTurn(
  company_name: string,
  history: ChatHistoryEntry[],
  chat_summary: string?
) -> CompanyInfoTool | ReplyTool {
  client GeminiFlash
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

    {% for entry in history %}
    {{ _.role(entry.role) }}
    {% if entry.label %}{{ entry.label }} {% endif %}{{ entry.content }}
    {% endfor %}

    {{ _.role("user") }}
    Please respond to the customer's latest message.
  "#
}
