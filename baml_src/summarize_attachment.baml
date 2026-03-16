function SummarizeImageAttachment(file: image, user_query: string) -> string {
  client GPT4_1Nano
  prompt #"
    {{ _.role("system") }}
    You are an attachment summarization assistant. Given an image attachment and the user's email message, produce a concise summary (2-4 sentences) that describes:
    1. What the image contains
    2. How it relates to the user's query or message

    {{ _.role("user") }}
    User's email message:
    {{ user_query }}

    Attachment:
    {{ file }}
  "#
}

function SummarizeTextAttachment(file_content: string, user_query: string) -> string {
  client GPT4_1Nano
  prompt #"
    {{ _.role("system") }}
    You are an attachment summarization assistant. Given the text content of an email attachment and the user's email message, produce a concise summary (2-4 sentences) that describes:
    1. What the attachment contains
    2. How it relates to the user's query or message

    If the content is not meaningful text (binary data, garbled output), say so briefly.

    {{ _.role("user") }}
    User's email message:
    {{ user_query }}

    Attachment content:
    {{ file_content }}
  "#
}
