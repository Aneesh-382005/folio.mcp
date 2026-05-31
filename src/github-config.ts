const username = 'Aneesh-382005';
const myName = 'Aneesh Grover'

export const githubConfig = {
  username,
  tools: {
    getRecentWork: {
      title: 'Recent Work',
      description: `Use this tool to retrieve recent public GitHub repositories actively worked on by ${myName} (${username}) within the last 12 months. Returns non-fork repositories with descriptions, technologies, topics, and activity metadata from personal and organization projects. Useful for portfolio analysis, technical evaluation, and understanding current AI, infrastructure, or developer-tooling work.`
    },
    getRepoDetail: {
      title: 'Repo Detail',
      description: `Use this tool to inspect one specific public repository for ${myName} (${username}). Returns repository metadata, README, languages, topics, stars, forks, open issues, last push time, file tree, and a machine-readable summary for deeper project analysis.`
    }
  }
} as const;