/**
 * Parses pagination query parameters from the request.
 *
 * @param query - The raw query string parameters.
 * @returns Parsed pageToken and limit values.
 */
export function parsePaginationQuery(query: { page_token?: string; limit?: string }): {
  pageToken: number | undefined;
  limit: number | undefined;
} {
  return {
    pageToken: query.page_token ? Number(query.page_token) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

/**
 * Computes the next page token from a result set.
 *
 * @param rows - Array of rows with an id field.
 * @returns The last row's id, or null if the array is empty.
 */
export function nextPageToken(rows: { id: number }[]): number | null {
  return rows.length > 0 ? rows[rows.length - 1].id : null;
}
