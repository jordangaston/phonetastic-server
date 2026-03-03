client<llm> GPT5 {
  provider openai
  retry_policy Exponential
  options {
    model "gpt-5"
    api_key env.OPENAI_API_KEY
  }
}

client<llm> GPT5Nano {
  provider openai
  retry_policy Exponential
  options {
    model "gpt-5-nano"
    api_key env.OPENAI_API_KEY
  }
}

client<llm> GPT4_1Nano {
  provider openai
  retry_policy Exponential
  options {
    model "gpt-4.1-nano"
    api_key env.OPENAI_API_KEY
  }
}

client<llm> GPT5Mini {
  provider openai
  retry_policy Exponential
  options {
    model "gpt-5-mini"
    api_key env.OPENAI_API_KEY
  }
}


retry_policy Exponential {
  max_retries 2
  // Strategy is optional
  strategy {
    type exponential_backoff
    delay_ms 300
    multiplier 1.5
    max_delay_ms 10000
  }
}