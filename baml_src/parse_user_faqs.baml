class UserFaq {
  question string @description("The question the customer would ask")
  answer string @description("The answer to the question")
}

function ParseUserFaqs(text: string) -> UserFaq[] {
  client GPT4_1Nano
  prompt #"
    {{ _.role("system") }}
    <instructions>
    You are a FAQ parsing system. Given user-typed text containing questions and answers about a business, extract each Q&A pair into structured data.

    The text may use formats like:
    - "Q: ... A: ..."
    - "Question: ... Answer: ..."
    - Numbered lists with questions and answers
    - Free-form paragraphs describing common questions

    Extract every distinct question-answer pair. If a question has no clear answer, skip it.
    Return an empty array if no Q&A pairs can be identified.
    </instructions>

    <output_format>
      {{ ctx.output_format }}
    </output_format>

    {{ _.role("user") }}
    Parse the FAQ entries from the following text:
    {{ text }}
  "#
}
