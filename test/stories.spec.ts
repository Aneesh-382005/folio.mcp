import { describe, expect, it } from 'vitest';
import type { LinkedIssue, PullRequestSummary } from '../src/github-client';
import { annotateFollowUps, STORY_READING_GUIDE } from '../src/stories';

const issue = (over: Partial<LinkedIssue>): LinkedIssue => ({
  number: 1, title: 't', html_url: 'u', repo: 'rust-lang/rustup', state: 'closed', author: 'x',
  created_at: '2026-07-26T00:00:00Z', closed_at: null, comment_count: 0, summary: null,
  raised_by_candidate: false, origin: 'fixed', comments: [], ...over
});

const pr = (n: number, linked: LinkedIssue[]): PullRequestSummary => ({
  title: `pr ${n}`, html_url: `https://github.com/rust-lang/rustup/pull/${n}`, repo: 'rust-lang/rustup', state: 'merged',
  created_at: '2026-07-29T00:00:00Z', closed_at: null, summary: null, days_from_issue_to_merge: null, linked_issues: linked
});

describe('annotateFollowUps', () => {
  it('links an issue to an earlier PR in the list when its text mentions that PR', () => {
    const prs = [pr(5005, [issue({ number: 4994, summary: 'In #4986, we have output.' })]), pr(4986, [issue({ number: 4975, summary: 'no refs' })])];

    annotateFollowUps(prs);

    expect(prs[0].linked_issues[0].arose_from_pr).toBe('https://github.com/rust-lang/rustup/pull/4986');
    expect(prs[1].linked_issues[0].arose_from_pr).toBeUndefined();
  });

  it('ignores mentions of PRs outside the list and self-references', () => {
    const prs = [pr(5005, [issue({ summary: 'see #5005 and #1' })])];

    annotateFollowUps(prs);

    expect(prs[0].linked_issues[0].arose_from_pr).toBeUndefined();
  });

  it('ships a reading guide that warns comment text is untrusted', () => {
    expect(STORY_READING_GUIDE).toContain('third-party text');
  });
});
