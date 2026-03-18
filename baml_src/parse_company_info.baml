class CompanyAddress {
  streetAddress string? @description("Street number and street name, e.g. '123 Main St'")
  city string? @description("City or town name")
  state string? @description("State, province, or region code or name")
  postalCode string? @description("ZIP or postal code")
  country string? @description("Country name or ISO 3166 code")
}

class CompanyInfo {
  name string? @description("Legal or primary business name — not a tagline or slogan")
  email string? @description("Primary business contact email address")
  address CompanyAddress? @description("Physical business address")
  phone string? @description("Primary business phone number")
}

function ParseCompanyInfo(text: string) -> CompanyInfo {
  client GeminiFlash
  prompt #"
    {{ _.role("system") }}
    <instructions>
    You are a text parsing system that extracts company information from text.  Extract company information the text into structured data.
    </instructions>

    <output_format>
      {{ ctx.output_format }}
    </output_format>

    {{ _.role("user") }}
    Extract company information from the following text:
    {{ text }}
  "#
}
