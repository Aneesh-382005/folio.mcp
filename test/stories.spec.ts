import { describe, expect, it } from 'vitest';
import { renderStories, type StoryPullRequest } from '../src/stories';

const issue = (over: Partial<StoryPullRequest['linked_issues'][number]>) => ({
  number: 1, title: 't', html_url: 'u', repo: 'rust-lang/rustup', state: 'closed', author: 'x',
  created_at: '2026-07-26T00:00:00Z', comment_count: 0, summary: null, raised_by_candidate: false, comments: [], ...over
});

const prs: StoryPullRequest[] = [
  {
    title: 'Add `rustup doc --serve`', html_url: 'https://github.com/rust-lang/rustup/pull/4986', repo: 'rust-lang/rustup',
    state: 'merged', created_at: '2026-07-29T00:00:00Z', closed_at: '2026-07-31T21:03:02Z', summary: 'Opt-in flag.',
    linked_issues: [issue({
      number: 4975, title: 'Improve doc UX', author: 'me', raised_by_candidate: true, summary: 'Snap browsers fail on file:// URLs.',
      comment_count: 3,
      comments: [{ author: 'djc', author_association: 'CONTRIBUTOR', by_candidate: false, created_at: '2026-07-28T00:00:00Z', body: 'Serve HTTP.' }]
    })]
  },
  {
    title: 'use tracing', html_url: 'https://github.com/rust-lang/rustup/pull/5005', repo: 'rust-lang/rustup',
    state: 'merged', created_at: '2026-08-11T00:00:00Z', closed_at: '2026-08-11T10:33:46Z', summary: 'tracing::info!',
    linked_issues: [issue({
      number: 4994, title: 'use info!', author: 'rami3l', created_at: '2026-08-03T00:00:00Z', summary: 'In #4986, we have output.',
      comments: [{ author: 'me', author_association: 'CONTRIBUTOR', by_candidate: true, created_at: '2026-08-11T07:06:06Z', body: "I'll take a shot." }]
    })]
  },
  { title: 'no issue', html_url: 'https://github.com/o/r/pull/9', repo: 'o/r', state: 'merged', created_at: '2026-01-01T00:00:00Z', closed_at: null, summary: null, linked_issues: [] }
];

describe('renderStories', () => {
  const text = renderStories(prs, 'Aneesh').join('\n');

  it('marks self-initiated vs picked-up work and orders stories chronologically', () => {
    expect(text).toContain('Aneesh raised rust-lang/rustup#4975 on 2026-07-26 (self-initiated).');
    expect(text).toContain('opened by rami3l on 2026-08-03; Aneesh volunteered on 2026-08-11.');
    expect(text.indexOf('Add `rustup doc --serve`')).toBeLessThan(text.indexOf('use tracing'));
  });

  it('shows discussion, outcome timing and the follow-up link between stories', () => {
    expect(text).toContain('> djc [contributor], 2026-07-28: Serve HTTP.');
    expect(text).toContain('(+2 more comments not shown)');
    expect(text).toContain('merged 2026-07-31, 6 days after the issue was raised');
    expect(text).toContain('Follow-up: this issue arose from rust-lang/rustup#4986 "Add `rustup doc --serve`"');
  });

  it('leaves PRs without linked issues out of the stories', () => {
    expect(text).not.toContain('no issue');
    expect(renderStories([prs[2]], 'Aneesh')).toEqual([]);
  });
});
