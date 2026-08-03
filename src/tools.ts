import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appConfig } from './config';
import { registerContactTools } from './contact-tools.js';
import { createGitHubClient } from './github-client';
import { createProfileClient } from './profile-client';

type RegisterToolsOptions = {
  githubUser?: string;
  githubToken?: string;
  cacheKv?: KVNamespace;
  resendApiKey?: string;
  request?: Request;
};

const repoDetailSchema = {
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
};

export function getToolCatalog() {
  return Object.entries(appConfig.tools).map(([name, tool]) => ({
    name,
    ...tool
  }));
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

  if (options.request) {
    registerContactTools(server, {
      cacheKv: options.cacheKv,
      request: options.request,
      resendApiKey: options.resendApiKey
    });
  }

  // MCP clients disagree on which of content/structuredContent they feed to
  // the model, so content mirrors structuredContent in full here.
  server.tool('get_recent_work', appConfig.tools.getRecentWork.description, async () => {
    const result = await github.getRecentWork();
    const mergedPrs = result.pullRequests.filter((pr) => pr.state === 'merged');
    const otherPrs = result.pullRequests.filter((pr) => pr.state !== 'merged');

    const lines = [
      `${appConfig.github.displayName} recent work (last 12 months): ${result.recentWork.length} repos, ${result.pullRequests.length} pull requests (${mergedPrs.length} merged).`,
      '',
      'Repositories:',
      ...result.recentWork.map((repo) => `- ${repo.full_name ?? repo.name} (${repo.primary_language ?? 'unknown'}, pushed ${repo.last_pushed_at}): ${repo.description ?? 'no description'}`)
    ];

    if (mergedPrs.length > 0) {
      lines.push('', 'Merged pull requests:');
      for (const pr of mergedPrs) {
        const singleLine = pr.summary?.replace(/\s+/g, ' ').trim() || null;
        lines.push(singleLine ? `- ${pr.repo}: ${pr.title} — ${singleLine}` : `- ${pr.repo}: ${pr.title}`);
      }
    }

    if (otherPrs.length > 0) {
      lines.push('', 'Other pull requests:');
      for (const pr of otherPrs) {
        lines.push(`- ${pr.repo}: ${pr.title} (${pr.state})`);
      }
    }

    if (result.externalActivity.length > 0) {
      lines.push('', 'External activity (repos not owned/orged but pushed to or commented on):');
      for (const activity of result.externalActivity) {
        lines.push(`- ${activity.full_name}: ${activity.activity.join(', ')}`);
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: result
    };
  });

  server.tool(
    'get_repo_detail',
    appConfig.tools.getRepoDetail.description,
    repoDetailSchema,
    async ({ repo, owner, detail_level, max_readme_chars, max_tree_entries }) => {
      const result = await github.getRepoDetail({
        repo,
        owner,
        detailLevel: detail_level,
        maxReadmeChars: max_readme_chars,
        maxTreeEntries: max_tree_entries
      });

      const languageList = result.languages ? Object.keys(result.languages).slice(0, 4).join(', ') : result.primary_language ?? 'unknown';

      return {
        content: [{ type: 'text', text: `${result.full_name ?? result.name} | ${result.html_url} | ${result.summary} | language ${languageList}.` }],
        structuredContent: result
      };
    }
  );
}
