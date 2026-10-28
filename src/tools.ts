import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appConfig } from './config';
import { registerContactTools } from './contact-tools.js';
import { createGitHubClient } from './github-client';
import { createProfileClient } from './profile-client';
import { toolResult } from './tool-result';

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

  server.tool('get_profile', appConfig.tools.getProfile.description, async () => toolResult({ ...profile.getProfile() }));

  if (options.request) {
    registerContactTools(server, {
      cacheKv: options.cacheKv,
      request: options.request,
      resendApiKey: options.resendApiKey
    });
  }

  // content and structuredContent are built from one object (see tool-result.ts).
  server.tool('get_recent_work', appConfig.tools.getRecentWork.description, async () =>
    toolResult({ ...(await github.getRecentWork()) })
  );

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

      return toolResult({ ...result });
    }
  );
}
