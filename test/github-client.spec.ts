import { describe, expect, it, vi } from 'vitest';
import { createGitHubClient } from '../src/github-client';

const GRAPHQL_URL = 'https://api.github.com/graphql';

function graphqlResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200 });
}

describe('getRecentWork', () => {
  it('uses a single GraphQL query for owned + org repos when a token is present', async () => {
    const fetchFn = vi.fn(async (input: string) => {
      const url = String(input);

      if (url === GRAPHQL_URL) {
        return graphqlResponse({
          data: {
            user: {
              repositories: {
                nodes: [
                  {
                    name: 'folio-mcp',
                    nameWithOwner: 'Aneesh-382005/folio-mcp',
                    description: 'A portfolio MCP server',
                    primaryLanguage: { name: 'TypeScript' },
                    repositoryTopics: { nodes: [{ topic: { name: 'mcp' } }] },
                    stargazerCount: 3,
                    pushedAt: '2026-07-01T00:00:00Z',
                    createdAt: '2025-01-01T00:00:00Z',
                    isFork: false
                  }
                ]
              },
              organizations: {
                nodes: [
                  {
                    login: 'some-org',
                    repositories: {
                      nodes: [
                        {
                          name: 'org-repo',
                          nameWithOwner: 'some-org/org-repo',
                          description: 'An org repo',
                          primaryLanguage: { name: 'Go' },
                          repositoryTopics: { nodes: [] },
                          stargazerCount: 1,
                          pushedAt: '2026-06-01T00:00:00Z',
                          createdAt: '2024-01-01T00:00:00Z',
                          isFork: false
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        });
      }

      if (url.startsWith('https://api.github.com/users/')) {
        throw new Error('REST fallback should not be called when GraphQL succeeds');
      }

      if (url.startsWith('https://api.github.com/orgs/')) {
        throw new Error('per-org REST fan-out should not be called when GraphQL succeeds');
      }

      if (url.includes('/search/issues')) {
        return graphqlResponse({ items: [] });
      }

      // events endpoint
      return graphqlResponse([]);
    });

    const client = createGitHubClient({
      username: 'Aneesh-382005',
      githubToken: 'test-token',
      fetchFn: fetchFn as unknown as typeof fetch
    });

    const result = await client.getRecentWork();

    const graphqlCalls = fetchFn.mock.calls.filter(([input]) => String(input) === GRAPHQL_URL);
    expect(graphqlCalls).toHaveLength(1);

    const names = result.recentWork.map((repo) => repo.full_name);
    expect(names).toContain('Aneesh-382005/folio-mcp');
    expect(names).toContain('some-org/org-repo');

    const orgRepo = result.recentWork.find((repo) => repo.full_name === 'some-org/org-repo');
    expect(orgRepo?.topics).toEqual([]);
    const ownedRepo = result.recentWork.find((repo) => repo.full_name === 'Aneesh-382005/folio-mcp');
    expect(ownedRepo?.topics).toEqual(['mcp']);
  });

  it('returns pull requests with the issues they close from the same GraphQL query', async () => {
    const fetchFn = vi.fn(async (input: string) => {
      const url = String(input);
      if (url === GRAPHQL_URL) {
        return graphqlResponse({
          data: {
            pullRequests: {
              nodes: [
                {
                  title: 'refactor(cli/docs): use tracing for docs opening status messages',
                  url: 'https://github.com/rust-lang/rustup/pull/5005',
                  state: 'MERGED',
                  merged: true,
                  createdAt: '2026-07-02T00:00:00Z',
                  closedAt: '2026-07-03T00:00:00Z',
                  body: 'Closes #4994\nSwitched to tracing::info!',
                  repository: { nameWithOwner: 'rust-lang/rustup' },
                  closingIssuesReferences: {
                    nodes: [
                      {
                        number: 4994,
                        title: '`rustup doc` should use `info!()` and friends for console output',
                        url: 'https://github.com/rust-lang/rustup/issues/4994',
                        state: 'CLOSED',
                        createdAt: '2026-07-01T00:00:00Z',
                        closedAt: '2026-07-03T00:00:00Z',
                        body: 'We should systematically use the logging system here.',
                        author: { login: 'rami3l' },
                        comments: {
                          totalCount: 1,
                          nodes: [{ author: { login: 'aneesh-382005' }, authorAssociation: 'CONTRIBUTOR', createdAt: '2026-08-11T07:06:06Z', body: "I'll take a shot at it." }]
                        },
                        repository: { nameWithOwner: 'rust-lang/rustup' }
                      }
                    ]
                  }
                },
                {}
              ]
            },
            user: { repositories: { nodes: [] }, organizations: { nodes: [] } }
          }
        });
      }
      if (url.includes('/search/issues')) throw new Error('REST PR search should be skipped when GraphQL returns PRs');
      return graphqlResponse([]);
    });

    const client = createGitHubClient({
      username: 'Aneesh-382005',
      githubToken: 'test-token',
      fetchFn: fetchFn as unknown as typeof fetch
    });

    const { pullRequests } = await client.getRecentWork();

    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0].state).toBe('merged');
    expect(pullRequests[0].days_from_issue_to_merge).toBe(2);
    expect(pullRequests[0].linked_issues).toEqual([
      expect.objectContaining({
        number: 4994,
        repo: 'rust-lang/rustup',
        state: 'closed',
        author: 'rami3l',
        comment_count: 1,
        raised_by_candidate: false,
        origin: 'volunteered',
        summary: 'We should systematically use the logging system here.',
        comments: [expect.objectContaining({ by_candidate: true, author_association: 'CONTRIBUTOR', body: "I'll take a shot at it." })]
      })
    ]);
  });

  it('falls back to REST fan-out when no token is present (GraphQL requires auth)', async () => {
    const fetchFn = vi.fn(async (input: string) => {
      const url = String(input);

      if (url === GRAPHQL_URL) {
        throw new Error('GraphQL should not be called without a token');
      }

      if (url.includes('/users/Aneesh-382005/repos')) {
        return graphqlResponse([
          {
            name: 'folio-mcp',
            full_name: 'Aneesh-382005/folio-mcp',
            description: 'A portfolio MCP server',
            language: 'TypeScript',
            topics: ['mcp'],
            stargazers_count: 3,
            pushed_at: '2026-07-01T00:00:00Z',
            created_at: '2025-01-01T00:00:00Z',
            fork: false
          }
        ]);
      }

      if (url.includes('/users/Aneesh-382005/orgs')) {
        return graphqlResponse([]);
      }

      if (url.includes('/search/issues')) {
        return graphqlResponse({ items: [] });
      }

      return graphqlResponse([]);
    });

    const client = createGitHubClient({
      username: 'Aneesh-382005',
      fetchFn: fetchFn as unknown as typeof fetch
    });

    const result = await client.getRecentWork();

    const graphqlCalls = fetchFn.mock.calls.filter(([input]) => String(input) === GRAPHQL_URL);
    expect(graphqlCalls).toHaveLength(0);
    expect(result.recentWork.map((repo) => repo.full_name)).toContain('Aneesh-382005/folio-mcp');
  });

  it('falls back to REST fan-out when the GraphQL query errors, even with a token', async () => {
    const fetchFn = vi.fn(async (input: string) => {
      const url = String(input);

      if (url === GRAPHQL_URL) {
        return graphqlResponse({ errors: [{ message: 'something went wrong' }] });
      }

      if (url.includes('/users/Aneesh-382005/repos')) {
        return graphqlResponse([
          {
            name: 'fallback-repo',
            full_name: 'Aneesh-382005/fallback-repo',
            description: 'Fetched via REST fallback',
            language: 'TypeScript',
            topics: [],
            stargazers_count: 0,
            pushed_at: '2026-07-01T00:00:00Z',
            created_at: '2025-01-01T00:00:00Z',
            fork: false
          }
        ]);
      }

      if (url.includes('/users/Aneesh-382005/orgs')) {
        return graphqlResponse([]);
      }

      if (url.includes('/search/issues')) {
        return graphqlResponse({ items: [] });
      }

      return graphqlResponse([]);
    });

    const client = createGitHubClient({
      username: 'Aneesh-382005',
      githubToken: 'test-token',
      fetchFn: fetchFn as unknown as typeof fetch
    });

    const result = await client.getRecentWork();

    expect(result.recentWork.map((repo) => repo.full_name)).toContain('Aneesh-382005/fallback-repo');
  });

  it('does not leak private org repos: GraphQL query filters organization repositories to PUBLIC', async () => {
    const fetchFn = vi.fn(async (input: string) => {
      const url = String(input);
      if (url === GRAPHQL_URL) {
        return graphqlResponse({ data: { user: { repositories: { nodes: [] }, organizations: { nodes: [] } } } });
      }
      if (url.includes('/search/issues')) {
        return graphqlResponse({ items: [] });
      }
      return graphqlResponse([]);
    });

    const client = createGitHubClient({
      username: 'Aneesh-382005',
      githubToken: 'test-token',
      fetchFn: fetchFn as unknown as typeof fetch
    });

    await client.getRecentWork();

    const graphqlCall = fetchFn.mock.calls.find(([input]) => String(input) === GRAPHQL_URL);
    expect(graphqlCall).toBeDefined();
    const init = graphqlCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.query).toContain('privacy: PUBLIC');
  });
});
