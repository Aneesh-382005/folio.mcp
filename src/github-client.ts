import { withCache } from './cache';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_HEADERS: HeadersInit = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'folio-mcp-worker'
};

const RECENT_WORK_TTL_SECONDS = 15 * 60;
const REPO_DETAIL_TTL_SECONDS = 60 * 60;

type GitHubRepo = {
  name: string;
  full_name?: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  pushed_at: string;
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

async function githubFetch<T>(path: string, githubToken?: string): Promise<T> {
  const headers = new Headers(GITHUB_HEADERS);

  if (githubToken) {
    headers.set('Authorization', `Bearer ${githubToken}`);
  }

  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${body}`);
  }

  return response.json() as Promise<T>;
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

function b64Decode(input: string) {
  if (typeof atob === 'function') return atob(input);
  if (typeof Buffer !== 'undefined') return Buffer.from(input, 'base64').toString('utf8');
  throw new Error('No base64 decoder available');
}

async function fetchRecentWork(username: string, githubToken?: string) {
  const twelveMonthsAgo = monthsAgoDate(12);

  let owned: GitHubRepo[] = [];
  try {
    owned = await githubFetch<GitHubRepo[]>(`/users/${username}/repos?type=owner&per_page=100&sort=updated`, githubToken);
  } catch (error) {
    console.warn('Could not fetch owned repos', error);
  }

  let orgRepos: GitHubRepo[] = [];
  try {
    const orgs = await githubFetch<any[]>(`/users/${username}/orgs`, githubToken);
    for (const org of orgs) {
      try {
        const repos = await githubFetch<GitHubRepo[]>(`/orgs/${org.login}/repos?type=public&per_page=100&sort=updated`, githubToken);
        orgRepos = orgRepos.concat(repos.map((r) => ({ ...r })));
      } catch (err) {
        console.warn(`Could not fetch repos for org ${org.login}`, err);
      }
    }
  } catch (error) {
    console.warn('Could not fetch user orgs', error);
  }

  const combinedMap = new Map<string, GitHubRepo>();
  const pushRepo = (repo: GitHubRepo) => {
    const key = repo.full_name ?? `${username}/${repo.name}`;
    if (!combinedMap.has(key)) combinedMap.set(key, repo);
  };

  for (const repo of owned) pushRepo(repo);
  for (const repo of orgRepos) pushRepo(repo);

  const twelveMonthsAgoISO = twelveMonthsAgo.toISOString();

  const recent = Array.from(combinedMap.values())
    .filter((repo) => !repo.fork && Boolean(repo.description?.trim()) && new Date(repo.pushed_at) >= new Date(twelveMonthsAgoISO))
    .map((repo) => ({
      ...toRepoDetail(repo),
      forks: 0,
      recent: repo.pushed_at
    }))
    .sort((a, b) => new Date(b.recent).getTime() - new Date(a.recent).getTime())
    .slice(0, 100)
    .map(({ recent, ...repo }) => repo);

  return { username, recentWork: recent };
}

async function fetchRepoDetail(options: RepoDetailOptions, githubToken?: string): Promise<RepoDetail> {
  const { repo, owner, detailLevel = 'summary', maxReadmeChars, maxTreeEntries } = options;
  const includeLanguages = detailLevel !== 'summary';
  const includeTree = detailLevel !== 'summary';
  const includeReadme = detailLevel === 'deep';

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

  const repoResp = await fetch(`${GITHUB_API_BASE}/repos/${ownerName}/${repoName}`, {
    headers
  });

  if (!repoResp.ok) {
    const body = await repoResp.text();
    throw new Error(`GitHub repo fetch error ${repoResp.status}: ${body}`);
  }

  const repoJson: any = await repoResp.json();

  const [languages, readme, tree] = await Promise.all([
    includeLanguages
      ? githubFetch<Record<string, number>>(`/repos/${ownerName}/${repoName}/languages`, githubToken)
          .catch((err) => { console.warn('Could not fetch languages', err); return null; })
      : Promise.resolve(null),

    includeReadme
      ? (async () => {
          const rawHeaders = new Headers(GITHUB_HEADERS);
          if (githubToken) rawHeaders.set('Authorization', `Bearer ${githubToken}`);
          rawHeaders.set('Accept', 'application/vnd.github.v3.raw');
          const rawResp = await fetch(`${GITHUB_API_BASE}/repos/${ownerName}/${repoName}/readme`, { headers: rawHeaders });
          if (rawResp.status === 404) return null;
          if (!rawResp.ok) throw new Error(`README fetch failed: ${rawResp.status}`);
          const text = await rawResp.text();
          return (typeof maxReadmeChars === 'number' && maxReadmeChars > 0 && text.length > maxReadmeChars)
            ? { text: `${text.slice(0, maxReadmeChars)}\n\n[truncated at ${maxReadmeChars} characters]` }
            : { text };
        })().catch((err) => { console.warn('Could not fetch README', err); return null; })
      : Promise.resolve(null),

    includeTree
      ? githubFetch<any>(`/repos/${ownerName}/${repoName}/git/trees/HEAD?recursive=0`, githubToken)
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
        () => fetchRecentWork(resolvedUsername, options.githubToken)
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
        () => fetchRepoDetail(repoOptions.owner ? repoOptions : { ...repoOptions, owner: repoOptions.owner ?? resolvedUsername }, options.githubToken)
      );
    }
  };
}
