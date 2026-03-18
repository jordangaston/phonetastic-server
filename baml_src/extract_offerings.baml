class ExtractedPrice {
  amount string @description("Price amount as a string, e.g. '29.99'")
  currency string @description("ISO 4217 currency code, e.g. 'USD'")
  frequency "one_time" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" @description("How often the price recurs")
}

class ExtractedOffering {
  type "product" | "service" @description("Whether this is a physical product or a service")
  name string @description("Short name of the product or service")
  description string? @description("Brief description of what is included, if present")
  price ExtractedPrice? @description("Pricing information, if clearly stated")
}

function ExtractOfferings(pageContent: string) -> ExtractedOffering[] {
  client GeminiFlash
  prompt #"
    {{ _.role("system") }}
    <instructions>
    You are a product and service extraction system. Given the text content of a business web page,
    extract all products and services the business offers.
    Only include items clearly present in the content.
    Return an empty array if no products or services are found.
    </instructions>

    <output_format>
      {{ ctx.output_format }}
    </output_format>

    {{ _.role("user") }}
    Extract products and services from the following page content:
    {{ pageContent }}
  "#
}
