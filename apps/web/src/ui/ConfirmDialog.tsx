import type { ReactNode } from 'react';
import { errorMessage } from '../i18n/errors.ts';
import { useT } from '../i18n/index.ts';
import { Modal, closeModal } from './Modal';

/**
 * The confirmation every sensitive action goes through: a danger-toned Modal with a Cancel
 * button and a solid red confirm button. The caller closes it from the mutation's onSuccess
 * with `closeModal`; a failed action keeps it open and shows the error inside.
 */
export function ConfirmDialog({
  label,
  title,
  body,
  confirmLabel,
  pending = false,
  error,
  onConfirm,
  onClose,
}: {
  /** Accessible name of the dialog. */
  label: string;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal label={label} title={title} onClose={onClose} closeButton={false} tone="danger">
      <p>{body}</p>
      {error != null && <p className="error">{errorMessage(error)}</p>}
      <div className="modal-actions">
        <button type="button" onClick={() => closeModal(onClose)}>
          {t('common.actions.cancel')}
        </button>
        <button type="button" className="danger solid" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
