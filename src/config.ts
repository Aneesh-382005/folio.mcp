const githubUsername = 'Aneesh-382005';
const displayName = 'Aneesh Grover';
const portfolioUrl = 'https://www.aneeshgrover.me/';
const resumeUrl = 'https://www.aneeshgrover.me/Aneesh_Grover_Resume.pdf';
const linkedinUrl = 'https://www.linkedin.com/in/aneesh-grover/';
const siteOrigins = ['https://mcp.aneeshgrover.me', 'https://www.aneeshgrover.me'] as const;

export const appConfig = {
  cors: {
    origins: siteOrigins,
    localhostOriginPattern: /^http:\/\/localhost:\d+$/
  },
  github: {
    username: githubUsername,
    displayName,
    profileUrl: `https://github.com/${githubUsername}`
  },
  profile: {
    name: displayName,
    links: {
      github: `https://github.com/${githubUsername}`,
      portfolio: portfolioUrl,
      resume: resumeUrl,
      linkedin: linkedinUrl
    }
  },
  tools: {
    getProfile: {
      title: 'Profile',
      description:
        'Use this tool to retrieve minimal portfolio and contact information for Aneesh Grover. Returns the GitHub profile link, portfolio link, resume link, and LinkedIn link when available. Keep it lightweight for quick LLM lookups.'
      ,
      returns: 'Static profile and contact links.',
      exampleInput: null,
      parameters: []
    },
    getRecentWork: {
      title: 'Recent Work',
      description:
        'Use this tool to retrieve recent public GitHub repositories actively worked on by Aneesh Grover (Aneesh-382005) within the last 12 months. Returns non-fork repositories with descriptions, technologies, topics, and activity metadata from personal and organization projects. Useful for portfolio analysis, technical evaluation, and understanding current AI, infrastructure, or developer-tooling work.'
      ,
      returns: 'Recent public repositories from the last 12 months with activity metadata.',
      exampleInput: null,
      parameters: []
    },
    getRepoDetail: {
      title: 'Repo Detail',
      description:
        'Use this tool to inspect one specific public repository for Aneesh Grover (Aneesh-382005). Choose detail_level based on how much context you need: summary for metadata only, standard for metadata plus languages and file tree, and deep for everything including README. Optional max_readme_chars and max_tree_entries can cap response size. Returns repository metadata, README when requested, languages, topics, stars, forks, open issues, last push time, file tree, and a machine-readable summary for deeper project analysis.'
      ,
      returns: 'Repository metadata plus optional languages, tree, and README content.',
      exampleInput: {
        repo: 'folio-mcp',
        detail_level: 'summary'
      },
      parameters: [
        {
          name: 'repo',
          description: 'Repository name or owner/name.'
        },
        {
          name: 'owner',
          description: 'Optional owner or organization when repo is a short name.'
        },
        {
          name: 'detail_level',
          description: 'summary, standard, or deep.'
        },
        {
          name: 'max_readme_chars',
          description: 'Optional README size cap when detail_level is deep.'
        },
        {
          name: 'max_tree_entries',
          description: 'Optional file tree size cap.'
        }
      ]
    }
  }
} as const;

export type AppConfig = typeof appConfig;
