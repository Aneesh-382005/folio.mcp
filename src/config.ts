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
  contact: {
    inboxEmail: 'aneesh.grover03@gmail.com',
    resendFrom: 'folio.mcp <onboarding@resend.dev>'
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
    },
    sendMessage: {
      title: 'Send Message',
      description:
        'Use this tool only when the user explicitly wants to send Aneesh a message from folio.mcp. Collect sender_name and message, plus optional context. Ask for reply_to_email only if the human intentionally wants a response by email. The message body must be 1000 characters or fewer, and this tool is for short contact requests, collaboration notes, or introductions.',
      returns: 'A success confirmation when the email is sent, or a graceful MCP error result when rate limited or when Resend fails.',
      exampleInput: {
        sender_name: 'Jordan Lee',
        message: 'I would like to talk about a systems project.',
        context: 'Open to a quick collaboration chat next week.',
        reply_to_email: 'jordan@example.com'
      },
      parameters: [
        {
          name: 'sender_name',
          description: 'Who is reaching out.'
        },
        {
          name: 'message',
          description: 'The message body, up to 1000 characters.'
        },
        {
          name: 'context',
          description: 'Optional context for what they want to discuss.'
        },
        {
          name: 'reply_to_email',
          description: 'Optional email for reply. Only provide if the user explicitly wants an email response.'
        }
      ]
    }
  }
} as const;

export type AppConfig = typeof appConfig;
