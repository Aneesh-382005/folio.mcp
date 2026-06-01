import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appConfig } from './config';
import { createGitHubClient } from './github-client';
import { createProfileClient } from './profile-client';

type RegisterToolsOptions = {
  githubUser?: string;
  githubToken?: string;
  cacheKv?: KVNamespace;
};

export function getToolCatalog() {
  return Object.entries(appConfig.tools).map(([name, tool]) => ({
    name,
    ...tool
  }));
}

function summarizeRecentWork(result: Awaited<ReturnType<ReturnType<typeof createGitHubClient>['getRecentWork']>>) {
  const topRepos = result.recentWork.slice(0, 3).map((repo) => repo.full_name ?? repo.name).join(', ');
  return `${appConfig.github.displayName} recent work (${result.recentWork.length} repos). Top: ${topRepos || 'none found'}.`;
}

function summarizeRepoDetail(result: Awaited<ReturnType<ReturnType<typeof createGitHubClient>['getRepoDetail']>>) {
  const languageList = result.languages ? Object.keys(result.languages).slice(0, 4).join(', ') : result.primary_language ?? 'unknown';
  return `${result.full_name ?? result.name} | ${result.html_url} | ${result.summary} | language ${languageList}.`;
}

export function registerTools(server: McpServer, options: RegisterToolsOptions = {}) {
  const github = createGitHubClient({
    username: options.githubUser ?? appConfig.github.username,
    githubToken: options.githubToken,
    cacheKv: options.cacheKv
  });
  const profile = createProfileClient(appConfig.profile);

  server.tool('get_profile', appConfig.tools.getProfile.description, async () => {
    const result = profile.getProfile();
    const links = [
      `GitHub: ${result.links.github}`,
      result.links.portfolio ? `Portfolio: ${result.links.portfolio}` : null,
      result.links.resume ? `Resume: ${result.links.resume}` : null,
      result.links.linkedin ? `LinkedIn: ${result.links.linkedin}` : null
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      content: [
        {
          type: 'text',
          text: `${result.name} | ${links}`
        }
      ],
      structuredContent: result
    };
  });

  server.tool('get_recent_work', appConfig.tools.getRecentWork.description, async () => {
    const result = await github.getRecentWork();
    return {
      content: [{ type: 'text', text: summarizeRecentWork(result) }],
      structuredContent: result
    };
  });

  server.tool(
    'get_repo_detail',
    appConfig.tools.getRepoDetail.description,
    {
      repo: z.string().min(1).describe('Repository name or owner/name, for example folio-mcp or Aneesh-382005/folio-mcp'),
      owner: z.string().optional().describe('Optional owner or organization when repo is just a short name'),
      detail_level: z
        .enum(['summary', 'standard', 'deep'])
        .optional()
        .default('summary')
        .describe('summary = metadata only; standard = metadata + languages + tree; deep = metadata + languages + tree + README'),
      max_readme_chars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional maximum number of README characters to return when detail_level is deep'),
      max_tree_entries: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional maximum number of file paths to return when detail_level includes the tree')
    },
    async ({ repo, owner, detail_level, max_readme_chars, max_tree_entries }) => {
      const result = await github.getRepoDetail({
        repo,
        owner,
        detailLevel: detail_level,
        maxReadmeChars: max_readme_chars,
        maxTreeEntries: max_tree_entries
      });

      return {
        content: [{ type: 'text', text: summarizeRepoDetail(result) }],
        structuredContent: result
      };
    }
  );
}
