const username = 'Aneesh-382005';
const myName = 'Aneesh Grover'

export const githubConfig = {
  username,
  tools: {
    getRecentWork: {
      title: 'Recent Work',
      description: `Returns repositories ${myName}, GitHub Username: ${username} has actively worked on in the last 12 months (non-fork, with description).`
    },
    getRepoDetail: {
      title: 'Repo Detail',
      description: `Returns detail for one public repository owned by ${myName}, GitHub Username: ${username}.`
    }
  }
} as const;