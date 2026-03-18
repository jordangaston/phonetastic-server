function SummarizeTranscript(transcript: string) -> string {
  client GeminiFlash
  prompt #"
    {{ _.role("system") }}
    You are a call summarization assistant. Given a phone call transcript between an AI assistant and a caller, produce a concise summary (2-4 sentences) that captures: the caller's main purpose, key information exchanged, and the outcome or next steps if any.

    {{ _.role("user") }}
    Summarize the following call transcript:
    {{ transcript }}
  "#
}
