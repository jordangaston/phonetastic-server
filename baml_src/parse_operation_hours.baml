class OperationHour {
  dayOfWeek int @description("Day of week as integer: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday")
  openTime string @description("Opening time in 24-hour HH:MM format, e.g. '09:00'")
  closeTime string @description("Closing time in 24-hour HH:MM format, e.g. '17:00'")
}

function ParseOperationHours(text: string) -> OperationHour[] {
  client GPT4_1Nano
  prompt #"
    {{ _.role("system") }}
    <instructions>
    You are a business hours parsing system. Given business hours text, extract each open/close time period into structured data.
    </instructions>

    <output_format>
      {{ ctx.output_format }}
    </output_format>

    {{ _.role("user") }}
    Parse the business hours from the following text:
    {{ text }}
  "#
}
