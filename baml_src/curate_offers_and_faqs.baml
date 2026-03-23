class CuratedOffersAndFAQs {
  faqs ExtractedFaq[] @description("FAQs that passed curation")
  offerings ExtractedOffering[] @description("Offerings that passed curation")
}

function CurateOffersAndFAQs(faqs: ExtractedFaq[], offerings: ExtractedOffering[]) -> CuratedOffersAndFAQs {
  client GeminiFlash
  prompt #"
    {{ _.role("system") }}
    <context>
    You are a quality-control system for a business AI phone assistant.

    A cheaper model extracted FAQs and product/service offerings from a business website. The
    raw lists may contain duplicates, navigation artifacts, vague entries, and items that would
    confuse rather than help a customer calling the business.

    Your job is to return clean, high-signal lists. Every FAQ kept must be something a real
    customer would ask on a phone call. Every offering kept must be a real product or service
    the customer might inquire about or book.

    You must not add, rephrase, or modify any item — only decide keep or remove.
    </context>

    <faq_rules>
    REMOVE a FAQ if ANY of the following are true:

    DUPLICATE — The question or answer substantially overlaps with another FAQ already kept.
    Keep the version with the most complete, specific answer; discard the rest.

    WEBSITE ARTIFACT — The question is about the website, social media pages, newsletter,
    login, or any digital property rather than the business itself.
    Examples: "How do I log in?", "Where can I follow you on Instagram?"

    UNANSWERABLE OR EMPTY — The answer is absent, is only "contact us for details", or is so
    generic that it tells a caller nothing actionable.
    Examples: answer is "We offer many great services." with no specifics.

    NO CUSTOMER VALUE — No real caller would ask this before visiting or hiring the business.
    Examples: "What year did you launch your website?", "How many blog posts do you have?"

    KEEP a FAQ if all of the following are true:
    - A first-time customer could plausibly ask it on a phone call.
    - The answer gives specific, actionable information about hours, location, pricing, booking,
      services, staff qualifications, policies, or what to expect.
    - It is not covered by another FAQ already in the kept set.
    </faq_rules>

    <offering_rules>
    REMOVE an offering if ANY of the following are true:

    DUPLICATE — The same product or service appears under multiple names or slight variations.
    Keep the most descriptive version; discard the rest.

    NAVIGATION ARTIFACT — The item is a page name, menu label, button, section heading, or
    call-to-action, not a purchasable product or engageable service.
    Examples: "Home", "About Us", "Get Started", "Book Now", "Learn More", "Contact"

    BOOKING OR ADMINISTRATIVE ACTION — The item is a process step or form, not an offering.
    Examples: "Free Consultation", "Free Quote", "Schedule Appointment", "Request a Callback"
    These are entry points into a sales flow, not services a customer receives.

    IMPLAUSIBLE FOR THIS BUSINESS — The offering clearly does not fit the business implied by
    the rest of the offering list. A barbershop should not list "Enterprise Software Licensing".

    TOO VAGUE TO BE USEFUL — The name and description together give a caller no real idea of
    what they are getting.
    Examples: "Package A", "Service 1", "Other Services", "Miscellaneous", "Various Options"

    KEEP an offering if all of the following are true:
    - It is a named product or service the business actually sells or provides.
    - A customer could ask "do you offer X?" and the answer would be yes or no.
    - It has a clear name and at least an implied scope or description.
    </offering_rules>

    <output_format>
      {{ ctx.output_format }}
    </output_format>

    {{ _.role("user") }}
    FAQs to review:
    {{ faqs }}

    Offerings to review:
    {{ offerings }}
  "#
}
