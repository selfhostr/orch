import { describe, expect, it } from 'vitest';
import { isPullRequestExists } from './octokit';

describe('isPullRequestExists', () => {
  it('matches only the 422 that says a pull request is already open', () => {
    const exists = {
      status: 422,
      message: 'Validation Failed',
      response: {
        data: { errors: [{ message: 'A pull request already exists for acme:orch/task-1.' }] },
      },
    };
    expect(isPullRequestExists(exists)).toBe(true);
    expect(
      isPullRequestExists({
        status: 422,
        message: 'Validation Failed: {"message":"A pull request already exists for acme:b."}',
      }),
    ).toBe(true);
    expect(
      isPullRequestExists({
        status: 422,
        message: 'Validation Failed',
        response: { data: { errors: [{ message: 'No commits between main and orch/task-1' }] } },
      }),
    ).toBe(false);
    expect(isPullRequestExists({ status: 404, message: 'A pull request already exists' })).toBe(
      false,
    );
  });
});
