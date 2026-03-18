class ExtractedFaq {
  question string @description("The question as it appears or can be inferred from the content")
  answer string @description("The answer to the question")
}

function ExtractFAQs(pageContent: string) -> ExtractedFaq[] {
  client GeminiFlash
  prompt #"
    {{ _.role("system") }}
    <instructions>
    You are a FAQ extraction system. Given scraped markdown from a business web page, extract only
    questions that a real prospective customer would ask before hiring or visiting this business.

    ONLY extract FAQs answerable from content that is about the business itself — its operations,
    services, policies, staff, or location. Valid topics:
    - Hours, location, parking, and contact information
    - Services offered and what is or is not included
    - Pricing, payment methods, and accepted insurance
    - Booking, scheduling, wait times, and cancellation policies
    - Staff qualifications, certifications, and experience
    - What to bring or expect as a first-time customer

    IGNORE entirely — do not generate any FAQs from:
    - Website navigation, menus, links, article lists, or blog post titles
    - The number of articles, pages, or resources on the site
    - Social media links, newsletter sign-ups, or site features
    - Generic marketing statements or taglines
    - Any content that is about the website rather than the business

    Return an empty array if the page contains no information about the business's actual operations.
    </instructions>

    <output_format>
      {{ ctx.output_format }}
    </output_format>

    {{ _.role("user") }}
    Extract FAQ entries from the following page content:
    {{ pageContent }}
  "#
}
