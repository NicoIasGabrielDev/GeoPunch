import axios from 'axios';

type ErrorMessageOptions = {
  defaultMessage: string;
  service?: 'backend' | 'supabase' | 'generic';
};

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ERR_NETWORK',
  'ETIMEDOUT',
]);

const NETWORK_ERROR_PATTERNS = [
  'network failed',
  'network error',
  'network request failed',
  'failed to fetch',
  'timeout',
];

const BACKEND_WAKE_MESSAGE =
  'O backend no Render está a acordar. A primeira tentativa pode demorar até 60 segundos; tente novamente dentro de instantes.';

const SUPABASE_NETWORK_MESSAGE =
  'Não foi possível contactar o Supabase. Verifique a ligação à internet e tente novamente.';

const includesPattern = (value: string, patterns: string[]) => {
  const normalizedValue = value.toLowerCase();
  return patterns.some((pattern) => normalizedValue.includes(pattern));
};

export const isNetworkLikeError = (error: unknown): boolean => {
  if (axios.isAxiosError(error)) {
    const code = error.code ?? '';
    const message = error.message ?? '';
    return (
      NETWORK_ERROR_CODES.has(code) ||
      !error.response ||
      includesPattern(message, NETWORK_ERROR_PATTERNS)
    );
  }

  if (error instanceof Error) {
    return includesPattern(error.message, NETWORK_ERROR_PATTERNS);
  }

  if (typeof error === 'string') {
    return includesPattern(error, NETWORK_ERROR_PATTERNS);
  }

  return false;
};

export const getHumanReadableError = (
  error: unknown,
  options: ErrorMessageOptions,
): string => {
  if (options.service === 'backend' && isNetworkLikeError(error)) {
    return BACKEND_WAKE_MESSAGE;
  }

  if (options.service === 'supabase' && isNetworkLikeError(error)) {
    return SUPABASE_NETWORK_MESSAGE;
  }

  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }

    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) =>
          typeof item?.msg === 'string' ? item.msg.trim() : '',
        )
        .filter(Boolean);

      if (messages.length > 0) {
        return messages.join(', ');
      }
    }

    const message = error.message?.trim();
    if (message) {
      return message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return options.defaultMessage;
};
