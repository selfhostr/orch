import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TaskView } from '@orch/shared';
import { describe, expect, it } from 'vitest';
import { mockApi, switchToFrench } from '../test/helpers';
import { TaskCard } from './TaskCard';

const user = { id: 'u2', githubLogin: 'alice', avatarUrl: null };
const task = {
  id: 't1',
  projectId: 'p1',
  projectFullName: 'octo/repo',
  issueNumber: 1,
  issueUrl: 'https://github.com/octo/repo/issues/1',
  title: 'First task',
  body: '',
  acceptanceCriteria: [],
  size: 'M',
  model: 'SONNET',
  status: 'TODO',
  dependsOn: [],
  integrationBranch: null,
  baseBranch: 'main',
  branchName: null,
  prNumber: null,
  prUrl: null,
  origin: 'PLATFORM',
  createdBy: user,
  assignee: null,
  assigneeAgentId: null,
  canEdit: false,
  canApprove: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as TaskView;

async function openWhy() {
  mockApi({
    'GET /tasks/t1/why-not-running': () => ({
      json: {
        taskId: 't1',
        status: 'TODO',
        taskReasons: [{ code: 'no_writer', message: 'server text' }],
        members: [
          {
            user,
            eligible: false,
            reasons: [{ code: 'access_denied', message: 'No write access' }],
          },
        ],
      },
    }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskCard task={task} canApprove={false} approving={false} onApprove={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const details = container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('TaskCard: why is it not running', () => {
  it('says when no participant has write access to the repository', async () => {
    await openWhy();
    expect(
      await screen.findByText(/No participant has write access to this repository/),
    ).toBeTruthy();
  });

  it('in French too', async () => {
    await switchToFrench();
    await openWhy();
    expect(await screen.findByText(/Aucun participant n’a l’accès en écriture/)).toBeTruthy();
  });
});
