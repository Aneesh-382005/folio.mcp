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

function isValidRepoName(repo: string) {
  return /^[A-Za-z0-9._-]{1,100}$/.test(repo);
}

async function fetchRecentWork(githubUser: string) {
  const twelveMonthsAgo = monthsAgoDate(12).toISOString();

  let owned: GitHubRepo[] = [];
  try {
    owned = await githubFetch<GitHubRepo[]>(`/users/${githubUser}/repos?type=owner&per_page=100&sort=updated`);
  } catch (error) {
    console.warn('Could not fetch owned repos', error);
  }

  let eventRepos = new Set<string>();
  try {
    const events = await githubFetch<any[]>(`/users/${githubUser}/events/public`);
    eventRepos = new Set(
      events
        .filter((event) => ['PushEvent', 'PullRequestEvent', 'PullRequestReviewEvent'].includes(event.type))
        .map((event) => event.repo?.name)
        .filter(Boolean)
    );
  } catch (error) {
    console.warn('Could not fetch user events', error);
  }

  const recentWork = owned
    .filter((repo) => !repo.fork && repo.description && new Date(repo.pushed_at) >= new Date(twelveMonthsAgo))
    .map((repo) => ({
      ...toRepoDetail(repo),
      activity: eventRepos.has(repo.full_name ?? `${githubUser}/${repo.name}`) ? 'public activity' : 'recent push',
      recent: repo.pushed_at
    }))
    .sort((a, b) => new Date(b.recent).getTime() - new Date(a.recent).getTime())
    .slice(0, 12)
    .map(({ recent, ...repo }) => repo);

  return { username: githubUser, recentWork };
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

  server.tool(
    'get_repo_detail',
    githubConfig.tools.getRepoDetail.description,
    {
      repo: z.string().min(1).max(100).describe('Repository name only (example: folio-mcp)')
    },
    async ({ repo }) => {
      const repoName = repo.trim();

      if (!isValidRepoName(repoName)) {
        throw new Error('Invalid repo name. Use only letters, numbers, dot, underscore, and hyphen.');
      }

      const ghRepo = await githubFetch<GitHubRepo>(`/repos/${githubConfig.username}/${encodeURIComponent(repoName)}`);
      const detail = toRepoDetail(ghRepo);

      return {
        content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
        structuredContent: detail
      };
    }
  );
}
