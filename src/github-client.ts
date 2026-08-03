import { fetchWithEtagCache, withCache } from './cache';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_HEADERS: HeadersInit = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'folio-mcp-worker'
};

const RECENT_WORK_TTL_SECONDS = 15 * 60;
const REPO_DETAIL_TTL_SECONDS = 60 * 60;
// Shorter than the aggregate TTLs so per-endpoint ETag revalidation kicks in independently of them.
const ENDPOINT_TTL_SECONDS = 5 * 60;

type GitHubEvent = {
  type: string;
  repo: { name: string };
  payload?: { action?: string };
};

type GitHubSearchIssue = {
  title: string;
  html_url: string;
  repository_url: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  body?: string | null;
  pull_request?: { merged_at: string | null };
};

type GitHubSearchResult = {
  items: GitHubSearchIssue[];
};

type GitHubRepo = {
  name: string;
  full_name?: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  pushed_at: string;
  created_at: string;
  fork: boolean;
};

type RepoDetail = {
  name: string;
  full_name?: string;
  description: string | null;
  html_url: string;
  summary: string;
  default_branch: string;
  primary_language: string | null;
  languages: Record<string, number> | null;
  topics: string[];
  stars: number;
  forks: number;
  open_issues: number;
  last_pushed_at: string;
  created_at: string;
  updated_at: string;
  license: string | null;
  archived: boolean;
  fork: boolean;
  private: boolean;
  readme: { text?: string; encoding?: string } | null;
  tree: string[];
  fetched_at: string;
};

type GitHubClientOptions = {
  username: string;
  githubToken?: string;
  cacheKv?: KVNamespace;
  fetchFn?: typeof fetch;
};

type RepoDetailOptions = {
  repo: string;
  owner?: string;
  detailLevel?: 'summary' | 'standard' | 'deep';
  maxReadmeChars?: number;
  maxTreeEntries?: number;
};

function githubCacheKey(scope: string, ...parts: Array<string | number | boolean>) {
  return ['github', scope, ...parts].map((p) => encodeURIComponent(String(p))).join(':');
}

function monthsAgoDate(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

// PR bodies are often auto-filled from repo templates (HTML comments, empty
// checklist headers); strip that boilerplate so what's left is signal. Not
// truncated here — callers that want a bounded excerpt slice it themselves.
function summarizePrBody(body: string | null | undefined): string | null {
  if (!body) return null;

  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/- \[ \].*$/gm, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return cleaned || null;
}

type GithubFetchOptions = {
  githubToken?: string;
  fetchFn?: typeof fetch;
  cacheKv?: KVNamespace;
  cacheKey?: string;
};

async function githubFetch<T>(path: string, options: GithubFetchOptions = {}): Promise<T> {
  const { githubToken, fetchFn = fetch, cacheKv, cacheKey } = options;
  const headers = new Headers(GITHUB_HEADERS);

  if (githubToken) {
    headers.set('Authorization', `Bearer ${githubToken}`);
  }

  const url = `${GITHUB_API_BASE}${path}`;
  const response = cacheKey
    ? await fetchWithEtagCache(cacheKv, cacheKey, ENDPOINT_TTL_SECONDS, url, { headers }, fetchFn)
    : await fetchFn(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${body}`);
  }

  return response.json() as Promise<T>;
}

type GraphQLRepoNode = {
  name: string;
  nameWithOwner: string;
  description: string | null;
  primaryLanguage: { name: string } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
  stargazerCount: number;
  pushedAt: string;
  createdAt: string;
  isFork: boolean;
};

const RECENT_WORK_GRAPHQL_QUERY = `
query RecentWork($login: String!) {
  user(login: $login) {
    repositories(first: 100, ownerAffiliations: OWNER, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes { ...RepoFields }
    }
    organizations(first: 20) {
      nodes {
        login
        repositories(first: 100, privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC }) {
          nodes { ...RepoFields }
        }
      }
    }
  }
}
fragment RepoFields on Repository {
  name
  nameWithOwner
  description
  primaryLanguage { name }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  stargazerCount
  pushedAt
  createdAt
  isFork
}`;

function graphqlRepoToRest(node: GraphQLRepoNode): GitHubRepo {
  return {
    name: node.name,
    full_name: node.nameWithOwner,
    description: node.description,
    language: node.primaryLanguage?.name ?? null,
    topics: node.repositoryTopics.nodes.map((t) => t.topic.name),
    stargazers_count: node.stargazerCount,
    pushed_at: node.pushedAt,
    created_at: node.createdAt,
    fork: node.isFork
  };
}

// Requires a token: GitHub's GraphQL API has no anonymous access.
async function fetchOwnedAndOrgReposViaGraphQL(
  username: string,
  githubToken: string,
  fetchFn: typeof fetch
): Promise<{ owned: GitHubRepo[]; orgRepos: GitHubRepo[] } | null> {
  const response = await fetchFn(`${GITHUB_API_BASE}/graphql`, {
    method: 'POST',
    headers: {
      ...GITHUB_HEADERS,
      Authorization: `Bearer ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: RECENT_WORK_GRAPHQL_QUERY, variables: { login: username } })
  });

  if (!response.ok) {
    console.warn('GraphQL recent-work query failed', response.status, await response.text());
    return null;
  }

  const json: any = await response.json();
  if (json.errors) {
    console.warn('GraphQL recent-work query returned errors', json.errors);
    return null;
  }

  const user = json.data?.user;
  if (!user) return null;

  const owned: GitHubRepo[] = (user.repositories?.nodes ?? []).map(graphqlRepoToRest);
  const orgRepos: GitHubRepo[] = (user.organizations?.nodes ?? [])
    .flatMap((org: any) => org.repositories?.nodes ?? [])
    .map(graphqlRepoToRest);

  return { owned, orgRepos };
}

async function fetchOwnedAndOrgReposViaRest(
  username: string,
  base: GithubFetchOptions
): Promise<{ owned: GitHubRepo[]; orgRepos: GitHubRepo[] }> {
  const [owned, orgs] = await Promise.all([
    githubFetch<GitHubRepo[]>(`/users/${username}/repos?type=owner&per_page=100&sort=updated`, { ...base, cacheKey: githubCacheKey('owned_repos', username) })
      .catch((err) => { console.warn('Could not fetch owned repos', err); return [] as GitHubRepo[]; }),
    githubFetch<any[]>(`/users/${username}/orgs`, { ...base, cacheKey: githubCacheKey('user_orgs', username) })
      .catch((err) => { console.warn('Could not fetch user orgs', err); return [] as any[]; }),
  ]);

  const orgRepos = (await Promise.all(
    orgs.map((org) =>
      githubFetch<GitHubRepo[]>(`/orgs/${org.login}/repos?type=public&per_page=100&sort=updated`, { ...base, cacheKey: githubCacheKey('org_repos', org.login) })
        .catch((err) => { console.warn(`Could not fetch repos for org ${org.login}`, err); return [] as GitHubRepo[]; })
    )
  )).flat();

  return { owned, orgRepos };
}

function toRepoDetail(repo: GitHubRepo): Omit<RepoDetail, 'html_url' | 'default_branch' | 'languages' | 'open_issues' | 'created_at' | 'updated_at' | 'license' | 'archived' | 'private' | 'readme' | 'tree' | 'fetched_at'> {
  return {
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    summary: `${repo.full_name ?? repo.name} | ${repo.language ?? 'unknown'} | ${repo.stargazers_count} stars`,
    primary_language: repo.language,
    topics: repo.topics ?? [],
    stars: repo.stargazers_count,
    forks: 0,
    last_pushed_at: repo.pushed_at,
    fork: repo.fork
  };
}

async function fetchRecentWork(username: string, githubToken?: string, fetchFn: typeof fetch = fetch, cacheKv?: KVNamespace) {
  const twelveMonthsAgo = monthsAgoDate(12);
  const base: GithubFetchOptions = { githubToken, fetchFn, cacheKv };

  const graphqlResult = githubToken
    ? await fetchOwnedAndOrgReposViaGraphQL(username, githubToken, fetchFn)
    : null;

  const [{ owned, orgRepos }, events, prSearch] = await Promise.all([
    graphqlResult ? Promise.resolve(graphqlResult) : fetchOwnedAndOrgReposViaRest(username, base),
    githubFetch<GitHubEvent[]>(`/users/${username}/events?per_page=100`, { ...base, cacheKey: githubCacheKey('events', username) })
      .catch(() => [] as GitHubEvent[]),
    githubFetch<GitHubSearchResult>(`/search/issues?q=${encodeURIComponent(`type:pr author:${username}`)}&sort=updated&order=desc&per_page=20`, { ...base, cacheKey: githubCacheKey('pr_search', username) })
      .catch((err) => { console.warn('Could not fetch pull requests', err); return { items: [] } as GitHubSearchResult; }),
  ]);

  const combinedMap = new Map<string, GitHubRepo>();
  const pushRepo = (repo: GitHubRepo) => {
    const key = repo.full_name ?? `${username}/${repo.name}`;
    if (!combinedMap.has(key)) combinedMap.set(key, repo);
  };

  for (const repo of owned) pushRepo(repo);
  for (const repo of orgRepos) pushRepo(repo);

  const recent = Array.from(combinedMap.values())
    .filter((repo) => {
      if (!Boolean(repo.description?.trim())) return false;
      if (new Date(repo.pushed_at) < twelveMonthsAgo) return false;
      if (repo.fork) {
        const age = new Date(repo.pushed_at).getTime() - new Date(repo.created_at).getTime();
        if (age < 24 * 60 * 60 * 1000) return false;
      }
      return true;
    })
    .map((repo) => ({
      ...toRepoDetail(repo),
      forks: 0,
      recent: repo.pushed_at
    }))
    .sort((a, b) => new Date(b.recent).getTime() - new Date(a.recent).getTime())
    .slice(0, 100)
    .map(({ recent, ...repo }) => repo);

  const externalActivityMap = new Map<string, Set<string>>();
  for (const event of events) {
    let tag: string;
    if (event.type === 'PushEvent') {
      tag = 'push';
    } else if (event.type === 'IssueCommentEvent') {
      tag = 'issue_comment';
    } else {
      continue;
    }
    const name = event.repo.name;
    if (combinedMap.has(name)) continue;
    if (!externalActivityMap.has(name)) externalActivityMap.set(name, new Set());
    externalActivityMap.get(name)!.add(tag);
  }

  const externalActivity = Array.from(externalActivityMap.entries())
    .slice(0, 10)
    .map(([name, types]) => ({ full_name: name, github_url: `https://github.com/${name}`, activity: [...types] }));

  const pullRequests = prSearch.items.map((issue) => {
    const merged = Boolean(issue.pull_request?.merged_at);

    return {
      title: issue.title,
      html_url: issue.html_url,
      repo: issue.repository_url.replace('https://api.github.com/repos/', ''),
      state: merged ? 'merged' : issue.state,
      created_at: issue.created_at,
      closed_at: issue.closed_at,
      summary: merged ? summarizePrBody(issue.body) : null
    };
  });

  return { username, recentWork: recent, externalActivity, pullRequests };
}

async function fetchRepoDetail(options: RepoDetailOptions, base: GithubFetchOptions): Promise<RepoDetail> {
  const { repo, owner, detailLevel = 'summary', maxReadmeChars, maxTreeEntries } = options;
  const includeLanguages = detailLevel !== 'summary';
  const includeTree = detailLevel !== 'summary';
  const includeReadme = detailLevel === 'deep';
  const { githubToken, fetchFn = fetch, cacheKv } = base;

  let ownerName = owner;
  let repoName = repo;
  if (repo.includes('/')) {
    const parts = repo.split('/');
    ownerName = parts[0];
    repoName = parts.slice(1).join('/');
  }

  ownerName = ownerName ?? '';

  const headers = new Headers(GITHUB_HEADERS);
  if (githubToken) headers.set('Authorization', `Bearer ${githubToken}`);

  const repoResp = await fetchWithEtagCache(
    cacheKv,
    githubCacheKey('repo', ownerName, repoName),
    ENDPOINT_TTL_SECONDS,
    `${GITHUB_API_BASE}/repos/${ownerName}/${repoName}`,
    { headers },
    fetchFn
  );

  if (!repoResp.ok) {
    const body = await repoResp.text();
    throw new Error(`GitHub repo fetch error ${repoResp.status}: ${body}`);
  }

  const repoJson: any = await repoResp.json();

  const [languages, readme, tree] = await Promise.all([
    includeLanguages
      ? githubFetch<Record<string, number>>(`/repos/${ownerName}/${repoName}/languages`, { ...base, cacheKey: githubCacheKey('languages', ownerName, repoName) })
          .catch((err) => { console.warn('Could not fetch languages', err); return null; })
      : Promise.resolve(null),

    includeReadme
      ? fetchWithEtagCache(
          cacheKv,
          githubCacheKey('readme', ownerName, repoName),
          ENDPOINT_TTL_SECONDS,
          `${GITHUB_API_BASE}/repos/${ownerName}/${repoName}/readme`,
          { headers: { ...GITHUB_HEADERS, ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}), Accept: 'application/vnd.github.v3.raw' } },
          fetchFn
        )
          .then(async (rawResp) => {
            if (rawResp.status === 404) return null;
            if (!rawResp.ok) throw new Error(`README fetch failed: ${rawResp.status}`);
            const text = await rawResp.text();
            return (typeof maxReadmeChars === 'number' && maxReadmeChars > 0 && text.length > maxReadmeChars)
              ? { text: `${text.slice(0, maxReadmeChars)}\n\n[truncated at ${maxReadmeChars} characters]` }
              : { text };
          })
          .catch((err) => { console.warn('Could not fetch README', err); return null; })
      : Promise.resolve(null),

    includeTree
      ? githubFetch<any>(`/repos/${ownerName}/${repoName}/git/trees/HEAD?recursive=0`, { ...base, cacheKey: githubCacheKey('tree', ownerName, repoName) })
          .then((treeResp) => {
            const paths = treeResp?.tree?.map((f: any) => f.path) ?? [];
            return (typeof maxTreeEntries === 'number' && maxTreeEntries > 0) ? paths.slice(0, maxTreeEntries) : paths;
          })
          .catch((err) => { console.warn('Could not fetch repo tree', err); return [] as string[]; })
      : Promise.resolve([] as string[]),
  ]);

  return {
    name: repoJson.name,
    full_name: repoJson.full_name,
    description: repoJson.description,
    html_url: repoJson.html_url,
    summary: `${repoJson.full_name ?? repoJson.name} | ${repoJson.html_url} | ${repoJson.language ?? 'unknown'} | ${repoJson.stargazers_count ?? 0} stars | ${repoJson.forks_count ?? 0} forks | ${repoJson.open_issues_count ?? 0} open issues`,
    default_branch: repoJson.default_branch ?? 'main',
    primary_language: repoJson.language ?? null,
    languages,
    topics: repoJson.topics ?? [],
    stars: repoJson.stargazers_count ?? 0,
    forks: repoJson.forks_count ?? 0,
    open_issues: repoJson.open_issues_count ?? 0,
    last_pushed_at: repoJson.pushed_at,
    created_at: repoJson.created_at,
    updated_at: repoJson.updated_at,
    license: repoJson.license?.name ?? null,
    archived: repoJson.archived ?? false,
    fork: repoJson.fork ?? false,
    private: repoJson.private ?? false,
    readme,
    tree: tree ?? [],
    fetched_at: new Date().toISOString()
  };
}

export function createGitHubClient(options: GitHubClientOptions) {
  const resolvedUsername = options.username;

  return {
    async getRecentWork() {
      return withCache(
        options.cacheKv,
        githubCacheKey('recent_work', resolvedUsername, options.githubToken ? 'auth' : 'anon'),
        RECENT_WORK_TTL_SECONDS,
        () => fetchRecentWork(resolvedUsername, options.githubToken, options.fetchFn ?? fetch, options.cacheKv)
      );
    },
    async getRepoDetail(repoOptions: RepoDetailOptions) {
      return withCache(
        options.cacheKv,
        githubCacheKey(
          'repo_detail',
          repoOptions.owner ?? resolvedUsername,
          repoOptions.repo,
          `level=${repoOptions.detailLevel ?? 'summary'}`,
          `maxReadme=${repoOptions.maxReadmeChars ?? 'none'}`,
          `maxTree=${repoOptions.maxTreeEntries ?? 'none'}`,
          options.githubToken ? 'auth' : 'anon'
        ),
        REPO_DETAIL_TTL_SECONDS,
        () => fetchRepoDetail(
          repoOptions.owner ? repoOptions : { ...repoOptions, owner: repoOptions.owner ?? resolvedUsername },
          { githubToken: options.githubToken, fetchFn: options.fetchFn ?? fetch, cacheKv: options.cacheKv }
        )
      );
    }
  };
}
