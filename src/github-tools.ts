import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { githubConfig } from './github-config';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_HEADERS: HeadersInit = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'folio-mcp-worker'
};

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
  primary_language: string | null;
  topics: string[];
  stars: number;
  last_pushed_at: string;
  fork: boolean;
};

function toRepoDetail(repo: GitHubRepo): RepoDetail {
  return {
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    primary_language: repo.language,
    topics: repo.topics ?? [],
    stars: repo.stargazers_count,
    last_pushed_at: repo.pushed_at,
    fork: repo.fork
  };
}

async function githubFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: GITHUB_HEADERS
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${body}`);
  }

  return response.json() as Promise<T>;
}

function monthsAgoDate(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

async function fetchRecentWork(githubUser: string) {
  const twelveMonthsAgo = monthsAgoDate(12);

  // Fetch personal (owned) repos
  let owned: GitHubRepo[] = [];
  try {
    owned = await githubFetch<GitHubRepo[]>(`/users/${githubUser}/repos?type=owner&per_page=100&sort=updated`);
  } catch (error) {
    console.warn('Could not fetch owned repos', error);
  }

  // Fetch organizations the user belongs to, then fetch public repos for each org
  let orgRepos: GitHubRepo[] = [];
  try {
    const orgs = await githubFetch<any[]>(`/users/${githubUser}/orgs`);
    for (const org of orgs) {
      try {
        const repos = await githubFetch<GitHubRepo[]>(`/orgs/${org.login}/repos?type=public&per_page=100&sort=updated`);
        orgRepos = orgRepos.concat(repos.map((r) => ({ ...r })));
      } catch (err) {
        console.warn(`Could not fetch repos for org ${org.login}`, err);
      }
    }
  } catch (error) {
    console.warn('Could not fetch user orgs', error);
  }

  // Combine, dedupe by full_name (or name fallback)
  const combinedMap = new Map<string, GitHubRepo>();
  const pushRepo = (r: GitHubRepo) => {
    const key = r.full_name ?? `${githubUser}/${r.name}`;
    if (!combinedMap.has(key)) combinedMap.set(key, r);
  };

  for (const r of owned) pushRepo(r);
  for (const r of orgRepos) pushRepo(r);

  const twelveMonthsAgoISO = twelveMonthsAgo.toISOString();

  const recent = Array.from(combinedMap.values())
    .filter((repo) => !repo.fork && new Date(repo.pushed_at) >= new Date(twelveMonthsAgoISO))
    .map((repo) => ({
      ...toRepoDetail(repo),
      recent: repo.pushed_at
    }))
    .sort((a, b) => new Date(b.recent).getTime() - new Date(a.recent).getTime())
    .slice(0, 100)
    .map(({ recent, ...repo }) => repo);

  return { username: githubUser, recentWork: recent };
}

export function registerGitHubTools(server: McpServer) {
  server.tool(
    'get_recent_work',
    githubConfig.tools.getRecentWork.description,
    async () => {
      const result = await fetchRecentWork(githubConfig.username);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );
}
