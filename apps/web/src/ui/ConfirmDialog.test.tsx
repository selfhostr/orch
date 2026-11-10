import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';

const open = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      label="Remove thing"
      title="Remove the thing?"
      body="It cannot be undone."
      confirmLabel="Remove it"
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
  return { onConfirm, onClose };
};

describe('ConfirmDialog', () => {
  it('names the dialog, marks the confirm button as dangerous and confirms only on click', () => {
    const { onConfirm, onClose } = open();
    expect(screen.getByRole('dialog', { name: 'Remove thing' })).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Remove it' });
    expect(confirm.className).toContain('danger');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without confirming', async () => {
    const { onConfirm, onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the error code of a failed action that has no translation', () => {
    open({ error: new ApiError(418, 'teapot', 'I am a teapot') });
    expect(screen.getByText('I am a teapot (teapot)')).toBeTruthy();
  });

  it('disables the confirm button while the action runs', () => {
    open({ pending: true });
    expect((screen.getByRole('button', { name: 'Remove it' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
