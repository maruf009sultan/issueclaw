/**
 * Structured logger with levels, timestamps, and optional JSON output.
 * Supports log levels: trace, debug, info, warn, error, fatal.
 * Output is written to stderr so stdout stays clean for agent output.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
};

const RESET = "\x1b[0m";

export interface LogContext {
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  colorize?: boolean;
  component?: string;
}

export class Logger {
  private level: LogLevel;
  private json: boolean;
  private colorize: boolean;
  private component: string;

  constructor(opts: LoggerOptions = {}) {
    this.level = (opts.level ??
      (process.env.ISSUECLAW_LOG_LEVEL as LogLevel) ??
      "info") as LogLevel;
    this.json = opts.json ?? process.env.ISSUECLAW_LOG_JSON === "true";
    this.colorize = opts.colorize ?? process.stderr.isTTY ?? false;
    this.component = opts.component ?? "issueclaw";
  }

  child(component: string, context: LogContext = {}): Logger {
    const child = new Logger({
      level: this.level,
      json: this.json,
      colorize: this.colorize,
      component: `${this.component}:${component}`,
    });
    child._context = { ...this._context, ...context };
    return child;
  }

  private _context: LogContext = {};

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private write(level: LogLevel, msg: string, context: LogContext = {}): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const allContext = { ...this._context, ...context };

    if (this.json) {
      const payload = {
        ts: timestamp,
        level,
        component: this.component,
        msg,
        ...allContext,
      };
      process.stderr.write(`${JSON.stringify(payload)}\n`);
    } else {
      const color = this.colorize ? LEVEL_COLORS[level] : "";
      const reset = this.colorize ? RESET : "";
      const ctxStr = Object.keys(allContext).length > 0 ? ` ${JSON.stringify(allContext)}` : "";
      process.stderr.write(
        `${color}[${timestamp}] ${level.toUpperCase().padEnd(5)} [${this.component}]${reset} ${msg}${ctxStr}\n`,
      );
    }
  }

  trace(msg: string, context?: LogContext): void {
    this.write("trace", msg, context);
  }
  debug(msg: string, context?: LogContext): void {
    this.write("debug", msg, context);
  }
  info(msg: string, context?: LogContext): void {
    this.write("info", msg, context);
  }
  warn(msg: string, context?: LogContext): void {
    this.write("warn", msg, context);
  }
  error(msg: string, context?: LogContext): void {
    this.write("error", msg, context);
  }
  fatal(msg: string, context?: LogContext): void {
    this.write("fatal", msg, context);
    process.exit(1);
  }
}

/** Default logger instance. */
export const log = new Logger();
