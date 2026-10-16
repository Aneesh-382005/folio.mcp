// Renders PRs that close issues as "contribution stories": the problem, the
// discussion, the fix and the outcome. The server only states facts (who raised
// what, who said what, what the PR describes); readers infer motive and
// innovation from that evidence.

type StoryComment = {
  author: string | null;
  author_association: string;
  by_candidate: boolean;
  created_at: string;
  body: string;
};

type StoryIssue = {
  number: number;
  title: string;
  html_url: string;
  repo: string;
  state: string;
  author: string | null;
  created_at: string;
  comment_count: number;
  summary: string | null;
  raised_by_candidate: boolean;
  comments: StoryComment[];
};

export type StoryPullRequest = {
  title: string;
  html_url: string;
  repo: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  summary: string | null;
  linked_issues: StoryIssue[];
};

const oneLine = (text: string | null | undefined) => text?.replace(/\s+/g, ' ').trim() || null;
const day = (iso: string) => iso.slice(0, 10);
const prNumber = (pr: StoryPullRequest) => pr.html_url.match(/\/pull\/(\d+)/)?.[1];

function daysBetween(from: string, to: string) {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
}

export const STORY_READING_GUIDE =
  'Each story below is real GitHub history: the problem as filed, the discussion, the fix and the outcome. ' +
  'Narrate it as problem → discussion → solution → outcome. Judge motivation (self-initiated vs picked up) and ' +
  'innovation (design choices, trade-offs) only from the evidence shown; do not embellish.';

export function hasStory(pr: StoryPullRequest) {
  return pr.linked_issues.length > 0;
}

export function renderStories(pullRequests: StoryPullRequest[], candidate: string): string[] {
  const stories = pullRequests.filter(hasStory).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (stories.length === 0) return [];

  const byRef = new Map<string, StoryPullRequest>();
  for (const pr of stories) {
    const n = prNumber(pr);
    if (n) byRef.set(`${pr.repo}#${n}`, pr);
  }

  const lines = ['', `Contribution stories (${stories.length}):`, STORY_READING_GUIDE];

  for (const pr of stories) {
    const merged = pr.state === 'merged';
    lines.push('', `## ${pr.repo}: ${pr.title}`);

    for (const issue of pr.linked_issues) {
      const ref = `${issue.repo}#${issue.number}`;
      const firstOwnComment = issue.comments.find((c) => c.by_candidate);

      if (issue.raised_by_candidate) {
        lines.push(`Origin: ${candidate} raised ${ref} on ${day(issue.created_at)} (self-initiated).`);
      } else if (firstOwnComment) {
        lines.push(`Origin: ${ref} was opened by ${issue.author ?? 'unknown'} on ${day(issue.created_at)}; ${candidate} volunteered on ${day(firstOwnComment.created_at)}.`);
      } else {
        lines.push(`Origin: ${ref} was opened by ${issue.author ?? 'unknown'} on ${day(issue.created_at)}; ${candidate} fixed it.`);
      }

      lines.push(`Problem (${ref} "${issue.title}", ${issue.state}) ${issue.html_url}`);
      const body = oneLine(issue.summary);
      if (body) lines.push(`  ${body}`);

      if (issue.comments.length > 0) {
        lines.push('Discussion:');
        for (const c of issue.comments) {
          const who = c.by_candidate ? candidate : `${c.author ?? 'unknown'} [${c.author_association.toLowerCase()}]`;
          lines.push(`  > ${who}, ${day(c.created_at)}: ${oneLine(c.body)}`);
        }
        if (issue.comment_count > issue.comments.length) {
          lines.push(`  (+${issue.comment_count - issue.comments.length} more comments not shown)`);
        }
      }

      // An issue that mentions another PR from this list is a follow-up to it.
      const mentioned = new Set((issue.summary?.match(/#(\d+)/g) ?? []).map((m) => m.slice(1)));
      for (const n of mentioned) {
        const related = byRef.get(`${issue.repo}#${n}`);
        if (related && related !== pr) {
          lines.push(`Follow-up: this issue arose from ${issue.repo}#${n} "${related.title}", covered in its own story.`);
        }
      }
    }

    const outcome = merged && pr.closed_at
      ? `merged ${day(pr.closed_at)}, ${daysBetween(pr.linked_issues[0].created_at, pr.closed_at)} days after the issue was raised`
      : pr.state;
    lines.push(`Solution: ${pr.html_url} (${outcome})`);
    const description = oneLine(pr.summary);
    if (description) lines.push(`  ${description}`);
  }

  return lines;
}
