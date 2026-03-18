class PageSummary {
  url string
  title string
  description string
}

class RankedPages {
  faq_urls string[] @description("URLs most likely to contain FAQ content")
  offering_urls string[] @description("URLs most likely to contain product or service offerings")
}

function RankPages(pages: PageSummary[], businessType: string) -> RankedPages {
  client GeminiFlash
  prompt #"
    {{ _.role("system") }}
    <instructions>
    You are a web page classifier for a {{ businessType }} business.
    Given a list of pages (url, title, description), select:
    - Up to 5 URLs most likely to contain FAQ content (questions customers ask)
    - Up to 5 URLs most likely to contain product or service offerings (services, pricing, plans)

    A page may appear in both lists. Only include URLs from the provided list.
    Return empty arrays if no relevant pages exist.
    </instructions>

    <output_format>
      {{ ctx.output_format }}
    </output_format>

    {{ _.role("user") }}
    Pages:
    {{ pages }}
  "#
}
