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