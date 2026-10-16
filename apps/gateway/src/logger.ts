import pino from 'pino';
import { LOG_REDACT_PATHS } from '@pulsegate/shared';

export type Logger = pino.Logger;

export function createLogger(
  service: string,
  level = process.env.LOG_LEVEL ?? 'info',
  destination?: pino.DestinationStream,
): Logger {
  return pino(
    {
      level,
      base: { service },
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
