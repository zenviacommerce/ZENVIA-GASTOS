export type ToastKind = 'success' | 'error';
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

export function showError(message: string, duration = 5200) {
  emit({ kind: 'error', message, duration });
}

export function errorMessage(error: unknown, fallback = 'Se ha producido un error.') {
  return error instanceof Error && error.message ? error.message : fallback;
}
