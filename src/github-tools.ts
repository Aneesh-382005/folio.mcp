import * as z from 'zod/v4';
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

function monthsAgoDate(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

async function fetchRecentWork(githubUser: string, githubToken?: string) {
  const twelveMonthsAgo = monthsAgoDate(12);

  // Fetch personal (owned) repos
  let owned: GitHubRepo[] = [];
  try {
    owned = await githubFetch<GitHubRepo[]>(`/users/${githubUser}/repos?type=owner&per_page=100&sort=updated`, githubToken);
  } catch (error) {
    console.warn('Could not fetch owned repos', error);
  }

  // Fetch organizations the user belongs to, then fetch public repos for each org
  let orgRepos: GitHubRepo[] = [];
  try {
    const orgs = await githubFetch<any[]>(`/users/${githubUser}/orgs`, githubToken);
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
    .filter((repo) => !repo.fork && Boolean(repo.description?.trim()) && new Date(repo.pushed_at) >= new Date(twelveMonthsAgoISO))
    .map((repo) => ({
      ...toRepoDetail(repo),
      recent: repo.pushed_at
    }))
    .sort((a, b) => new Date(b.recent).getTime() - new Date(a.recent).getTime())
    .slice(0, 100)
    .map(({ recent, ...repo }) => repo);

  return { username: githubUser, recentWork: recent };
}

function b64Decode(input: string) {
  if (typeof atob === 'function') return atob(input);
  if (typeof Buffer !== 'undefined') return Buffer.from(input, 'base64').toString('utf8');
  throw new Error('No base64 decoder available');
}

export function registerGitHubTools(server: McpServer, githubUser?: string, githubToken?: string) {
  server.tool(
    'get_recent_work',
    githubConfig.tools.getRecentWork.description,
    async () => {
      const result = await fetchRecentWork(githubUser ?? githubConfig.username, githubToken);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // get_repo_detail: fetch core metadata + languages + topics + full README
  server.tool(
    'get_repo_detail',
    githubConfig.tools.getRepoDetail.description,
    {
      repo: z.string().min(1).describe('Repository name or owner/name'),
      owner: z.string().optional().describe('Optional owner/org if repo is short name'),
      include_readme: z.boolean().optional().default(true),
      include_languages: z.boolean().optional().default(true)
    },
    async ({ repo, owner, include_readme, include_languages }) => {
      // resolve owner/repo
      let ownerName = owner;
      let repoName = repo;
      if (repo.includes('/')) {
        const parts = repo.split('/');
        ownerName = parts[0];
        repoName = parts.slice(1).join('/');
      }
      ownerName = ownerName ?? githubConfig.username;

      // fetch core repo metadata (standard Accept header)
      const headers = new Headers(GITHUB_HEADERS);
      if (githubToken) headers.set('Authorization', `Bearer ${githubToken}`);
      headers.set('Accept', 'application/vnd.github+json');

      const repoResp = await fetch(`${GITHUB_API_BASE}/repos/${ownerName}/${repoName}`, {
        headers
      });

      if (!repoResp.ok) {
        const body = await repoResp.text();
        throw new Error(`GitHub repo fetch error ${repoResp.status}: ${body}`);
      }

      const repoJson: any = await repoResp.json();

      // languages
      let languages: Record<string, number> | null = null;
      if (include_languages) {
        try {
          languages = await githubFetch<Record<string, number>>(`/repos/${ownerName}/${repoName}/languages`, githubToken);
        } catch (err) {
          console.warn('Could not fetch languages', err);
        }
      }

      // readme (full, no truncation) - try raw first
      let readme: { text?: string; encoding?: string } | null = null;
      if (include_readme) {
        try {
          const rawHeaders = new Headers(GITHUB_HEADERS);
          if (githubToken) rawHeaders.set('Authorization', `Bearer ${githubToken}`);
          rawHeaders.set('Accept', 'application/vnd.github.v3.raw');

          const rawResp = await fetch(`${GITHUB_API_BASE}/repos/${ownerName}/${repoName}/readme`, {
            headers: rawHeaders
          });

          if (rawResp.status === 404) {
            readme = null; // no README
          } else if (!rawResp.ok) {
            throw new Error(`README fetch failed: ${rawResp.status}`);
          } else {
            const text = await rawResp.text();
            readme = { text };
          }
        } catch (err) {
          console.warn('Could not fetch README', err);
        }
      }

      const result = {
        name: repoJson.name,
        full_name: repoJson.full_name,
        description: repoJson.description,
        html_url: repoJson.html_url,
        default_branch: repoJson.default_branch ?? 'main',
        primary_language: repoJson.language ?? null,
        languages: languages,
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
        readme: readme,
        // shallow top-level file tree for quick architecture overview
        tree: [],
        fetched_at: new Date().toISOString()
      };

      // fetch shallow file tree (recursive=0) for top-level file list
      try {
        const treeResp = await githubFetch<any>(`/repos/${ownerName}/${repoName}/git/trees/HEAD?recursive=0`, githubToken);
        result.tree = treeResp?.tree?.map((f: any) => f.path) ?? [];
      } catch (err) {
        console.warn('Could not fetch repo tree', err);
        result.tree = [];
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );
}
