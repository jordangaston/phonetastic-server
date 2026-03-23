## General Rules

1. **Test coverage is mandatory:**
	1. All public functions of a model should have unit test coverage
	2. All controller routes should have integration test coverage
	3. A feature is not done until the app builds, starts, and all tests pass
	4. Write as few tests as required to cover all code paths but no more
2. **Test everything before proceeding.** This includes project setup, code, database schema changes, and migrations. This is mandatory.
3. **Methods and tests should be small and readable.** Methods should not exceed 10 lines. Readability is our highest priority.
4. **Tidy first.** Always [Tidy First](https://henrikwarne.com/2024/01/10/tidy-first/) before implementing new changes.
5. **Think carefully about names.**
6. **Document all public APIs and methods** using [tsdoc](https://tsdoc.org): include preconditions, parameters, postconditions, return values, and boundary conditions. We must be able to generate documentation for both LLM and human consumers at any time.
7. **Use version control frequently:**
	1. **Make small commits:** Each commit should contain one meaningful change — a simple API endpoint, a DBOS workflow, or a step of a larger workflow.
	2. **Reset changes freely:** If you get stuck and need a fresh start, use git reset.
8. **All list APIs must be paginated.** Use cursor-based pagination. The pagination token must be called `page_token` everywhere — query parameter, response field, and internal variable names. No exceptions.

## Drizzle ORM

- **Use transactions for multi-table writes.** When a service method writes across multiple tables, wrap all writes in a `db.transaction()` call and pass the `tx` to each repository method. If any write fails, all changes roll back.
- **Use joins for related data, not application-level loops.** Repository methods should accept an `expand` parameter (e.g. `expand: ['attachments']`) and use Drizzle's relational query API (`db.query.*.findMany({ with: { ... } })`) to left join related data in a single query. Fetching parent rows then looping to fetch children is an N+1 bug. Repositories may break encapsulation to leverage the database correctly.

## DBOS

- **Start child workflows only from `@DBOS.workflow()` methods.** Steps are checkpointed side-effect operations; starting workflows from steps breaks deterministic replay. If a step loads data that feeds child workflows, split the work: the step loads data, the parent workflow starts children.
- **Access the database only through `@DBOS.step()` or `@DBOS.transaction()`.** Bare repository calls in workflow bodies are not checkpointed and break recovery.
- **Wrap each external call in a loop in its own step.** For multi-turn LLM agent loops, each turn (LLM API call + tool execution) must be a separate `@DBOS.step()`. On crash at turn N, recovery replays checkpointed results of turns 1..N-1 and resumes from N.
- **Before writing any DBOS workflow**, fetch and read `https://docs.dbos.dev/typescript/programming-guide`.
- **DBOSClient API:** `DBOSClient` is the external-process API for enqueuing DBOS workflows.
    - Registered in the DI container as `Promise<DBOSClient>` via `container.registerInstance<Promise<DBOSClient>>('DBOSClient', DBOSClient.create(buildDbUrl()))`
    - Resolve with `await container.resolve<Promise<DBOSClient>>('DBOSClient')`
    - **Only method available**: `enqueue({ workflowClassName, workflowName, queueName }, ...args)` — there is no `startWorkflow`
    - The workflow class must be imported (side-effect import) in `server.ts` so DBOS registers it: `import './workflows/my-workflow.js'`
    - Use `DBOS.startWorkflow()` only from in-process DBOS workers, never from the agent process

## BAML

- **Define all LLM prompts in BAML files (`baml_src/`), not in TypeScript.** This includes system messages, user messages, conversation formatting, tool schemas, and output format instructions. TypeScript code should call `b.FunctionName()` and never construct prompt strings, message arrays, or tool definitions. **Exception:** LiveKit voice agents (`src/agent.ts`) cannot use BAML because the LiveKit agents SDK manages its own LLM pipeline.
- **Use BAML multimodal types for non-text content.** Use `image`, `audio`, `pdf` in function signatures — not raw strings or base64 fields. In TypeScript, construct them with `Image.fromBase64(mimeType, base64)`, `Image.fromUrl(url)`, `Pdf.fromBase64(base64)`, etc. imported from `@boundaryml/baml`. See https://docs.boundaryml.com/guide/baml-basics/multi-modal for the full API.
- **Use BAML structured output for tool calling.** Define tools as BAML classes with a `tool_name` literal field and use union return types (`ToolA | ToolB`) instead of OpenAI's native function calling API. BAML renders the schema via `{{ ctx.output_format }}` and parses the response. TypeScript pattern-matches on `tool_name` to dispatch. See https://docs.boundaryml.com/examples/prompt-engineering/tools-function-calling for examples.
- After creating or modifying `.baml` files, run `npx baml-cli generate` to regenerate the client in `src/baml_client/`.

## LiveKit

- **Changes require doc reference.** Before making any LiveKit-related changes, fetch and read `https://docs.livekit.io/llms.txt`.

## Deployment & Debugging

### Architecture

- **Web server** (`Dockerfile.web`): Deployed to Fly.io as `phonetastic-web`. Runs `dist/server.js`.
- **Voice agent** (`Dockerfile`): Deployed to LiveKit Cloud. Runs `dist/agent.js start`.
- `lk agent deploy` always uses the default `Dockerfile`. `fly deploy` uses `Dockerfile.web` (configured in `fly.toml`).
- **Deploy the web server before the agent when migrations are present.** Fly.io runs migrations via `release_command` during deploy. The agent connects to the same database, so it must not start against a schema it doesn't expect.

### Fly.io (Web Server)

| Task | Command |
|---|---|
| Check app status | `fly status -a phonetastic-web` |
| View logs | `fly logs -a phonetastic-web` |
| SSH into machine | `fly ssh console -a phonetastic-web` |
| List secrets | `fly secrets list -a phonetastic-web` |
| Deploy | `fly deploy -a phonetastic-web` |
| Run migrations | `fly ssh console -a phonetastic-web -C "node dist/db/migrate.js"` |

### LiveKit Cloud (Voice Agent)

| Task | Command |
|---|---|
| Check agent status | `lk agent status` |
| View agent logs | `lk agent logs` |
| View build logs | `lk agent logs --log-type build` |
| Deploy agent | `lk agent deploy` |
| Restart agent | `lk agent restart` |
| List versions | `lk agent versions` |
| Rollback | `lk agent rollback` |
| List SIP dispatch rules | `lk sip dispatch list` |
| List SIP inbound trunks | `lk sip inbound list` |
| List active rooms | `lk room list` |
| List projects | `lk project list` |

### Debugging Calls Not Connecting

1. **Verify the phone number is active:** Query the LiveKit PhoneNumberService Twirp API (`ListPhoneNumbers`). Confirm `status: PHONE_NUMBER_STATUS_ACTIVE` and a `sip_dispatch_rule_ids` entry.
2. **Verify the dispatch rule:** `lk sip dispatch list` — confirm it references the correct trunk ID and dispatches `phonetastic-agent`.
3. **Verify the agent is running:** `lk agent status` — status should be `Running`. Check `lk agent logs` for startup errors. Logs should show `Prewarm started` and `Prewarm complete`. If you see DBOS initialization instead, the wrong Dockerfile was used (web server instead of agent).
4. **Check active rooms:** `lk room list` — if a room appears but the agent never joins, the dispatch rule or agent name is misconfigured.

## Email Testing

Test the email bot end-to-end with `scripts/email-test`:

1. Install `gws`: `npm install -g @googleworkspace/cli`
2. Authenticate: `gws auth login`
3. Send a test email: `scripts/email-test send --company "Company Name" --body "Your question"`
4. Watch for the bot reply: `scripts/email-test watch`
5. Verify: the bot should reply within 30 seconds. Check chat state via API or `scripts/email-test chats`.

### Test Scenarios

| Scenario | Command | What to Verify |
|---|---|---|
| New conversation | `email-test send --company "Acme"` | Chat created, bot replies, email threaded |
| Follow-up in thread | `email-test reply --chat-id 42` | Same chat reused, summary updated |
| Attachment handling | `email-test send --attach file.pdf` | Attachment stored in Tigris, summarized, bot references it |
| Bot disabled | Disable bot via API, then `email-test send` | Email persisted but no bot reply |
| Owner reply | Owner replies via API, then end user sends again | Bot stays disabled, email persisted |
