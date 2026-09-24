export type ToastKind = 'success' | 'error' | 'info';
export const TOAST_EVENT = 'zenvia-gastos-toast';

export interface ToastPayload {
  kind: ToastKind;
  message: string;
  duration?: number;
}

function emit(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

export function showSuccess(message: string, duration = 3800) {
  emit({ kind: 'success', message, duration });
}

export function showError(message: string, duration = 9000) {
  emit({ kind: 'error', message, duration });
}

export function showInfo(message: string, duration = 6500) {
  emit({ kind: 'info', message, duration });
}

export function errorMessage(error: unknown, fallback = 'Se ha producido un error.') {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}


export function showOperationResult(successMessage: string, failureMessage?: string) {
  const success = successMessage.trim();
  const failure = failureMessage?.trim() || '';
  if (failure) {
    showError([success, failure].filter(Boolean).join(' '));
    return;
  }
  if (success) showSuccess(success);
}
