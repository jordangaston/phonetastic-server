## Rules
1.  **Test Coverage is mandatory:**
	1. All public functions of a model should have unit test coverage
	2. All controller routes should have integration test coverage
	3. A feature is not considered done until all of the test cases in the project pass
	4. Write as few tests as required to cover all code paths of use case but no more
2. **Methods and tests should be small and human readable**:
	1. Methods should not exceed 10 lines
	2. Readability is our highest priority
3. Always [Tidy First](https://henrikwarne.com/2024/01/10/tidy-first/) before implementing new changes
4. All public API's and methods must have preconditions, parameters, post conditions, return values and boundary conditions documented using [tsdoc](https://tsdoc.org).  We must be able to generate documentation that could be used by an LLM or a human to leverage the API's and functions of the server at any time.
5. **Use version control frequently:** 
	1. **Make small commits:** Each commit should contain one meaningful change like a simple API endpoint, a simple DBOS workflow, or a step of a more complicated workflow. 
	2. **Don't be afraid to reset changes**: If you get stuck and need a fresh start use git reset.
6. Think carefully about names.
7. CRITICAL: everything you do must be tested before you continue to the next step. This includes the project setup, the code you write, database schema changes, databse setup, etc.  DO NOT SKIP THIS STEP.
8. **Use transactions for multi-table writes:** When a service method inserts or updates rows across multiple tables, wrap all writes in a `db.transaction()` call and pass the `tx` to each repository method. This ensures atomicity — if any write fails, all changes are rolled back.
9. **All list APIs must be paginated:** Use cursor-based pagination. The pagination token must be called `page_token` everywhere — query parameter, response field, and internal variable names. No exceptions.
10. **LiveKit changes require doc reference:** Before making any LiveKit-related changes, fetch and read `https://docs.livekit.io/llms.txt` to ensure correct API usage.
11. **Drizzle ORM:**
    - **Use joins for related data, not application-level loops.** When a query needs data from a related table (e.g. emails with their attachments), the repository method should accept an `expand` parameter (e.g. `expand: ['attachments']`) and use Drizzle's relational query API (`db.query.*.findMany({ with: { ... } })`) to left join the related data in a single query. Never fetch the parent rows and then loop over them to fetch children — that is an N+1 bug. Repositories are allowed to break encapsulation to leverage the database correctly.
12. **DBOS workflows and steps:**
    - **Never start a child workflow from inside a `@DBOS.step()`.** Steps are checkpointed side-effect operations. Starting workflows from steps breaks deterministic replay. Only `@DBOS.workflow()` methods may call `DBOS.startWorkflow()`. If a step needs to load data and then start child workflows, split it: a step loads the data, and the parent workflow starts the children.
    - **Never access the database directly in a `@DBOS.workflow()` body.** All DB reads must go through a `@DBOS.step()` or `@DBOS.transaction()`. Bare repository calls in workflow bodies are not checkpointed and break recovery.
    - **Each external call in a loop must be its own step.** If a workflow runs a multi-turn LLM agent loop, each turn (LLM API call + tool execution) must be a separate `@DBOS.step()` call. This way, if the workflow crashes on turn N, recovery replays the checkpointed results of turns 1..N-1 and resumes from turn N — not from the beginning. Never put the entire loop inside a single step.
    - **Before writing any DBOS workflow**, fetch and read `https://docs.dbos.dev/typescript/programming-guide` to ensure correct usage of workflows, steps, and transactions.
13. **BAML:**
    - **All LLM prompts must be defined in BAML, not in TypeScript.** System messages, user messages, conversation formatting, tool schemas, and output format instructions belong in `.baml` files under `baml_src/`. TypeScript code calls the generated `b.FunctionName()` client — it must never build prompt strings, message arrays, or tool definitions directly.
    - **Use BAML multimodal types for non-text content.** When passing images, audio, or PDFs to an LLM, use the BAML types (`image`, `audio`, `pdf`) in the function signature — not raw strings or base64 fields. In TypeScript, construct them with `Image.fromBase64(mimeType, base64)`, `Image.fromUrl(url)`, `Pdf.fromBase64(base64)`, etc. imported from `@boundaryml/baml`. See https://docs.boundaryml.com/guide/baml-basics/multi-modal for the full API.
    - **Use BAML structured output for tool calling.** Define tools as BAML classes with a `tool_name` literal field and use union return types (`ToolA | ToolB`) instead of OpenAI's native function calling API. BAML renders the schema via `{{ ctx.output_format }}` and parses the response. TypeScript pattern-matches on `tool_name` to dispatch. See https://docs.boundaryml.com/examples/prompt-engineering/tools-function-calling for examples.
    - After creating or modifying `.baml` files, run `npx baml-cli generate` to regenerate the client in `src/baml_client/`.
14. **DBOSClient API:** `DBOSClient` is the external-process API for enqueuing DBOS workflows. Key facts:
    - Registered in the DI container as `Promise<DBOSClient>` via `container.registerInstance<Promise<DBOSClient>>('DBOSClient', DBOSClient.create(buildDbUrl()))`
    - Resolve with `await container.resolve<Promise<DBOSClient>>('DBOSClient')`
    - **Only method available**: `enqueue({ workflowClassName, workflowName, queueName }, ...args)` — there is NO `startWorkflow`
    - The workflow class must be imported (side-effect import) in `server.ts` so DBOS registers it: `import './workflows/my-workflow.js'`
    - Do NOT use `DBOS.startWorkflow()` from an agent process — that is only for in-process DBOS workers