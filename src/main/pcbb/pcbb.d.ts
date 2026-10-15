// PC Black Box library declarations (generated; do not edit here).
// ---- types.ts ----
/**
 * PC Black Box: the event shape every writer and reader agrees on. No Node and no Electron imports
 * here, so the renderer (and Vex) can import the types.
 */
/** The version written into every line. A reader keeps lines of a newer version (it cannot know what changed). */
export declare const PCBB_VERSION = 1;
/** Who wrote a line. Closed list; a reader keeps a value it does not know. */
export declare const SOURCES: readonly ["gcc", "vex"];
export type PcbbSource = (typeof SOURCES)[number];
/**
 * The closed vocabulary (version 1). New kinds are added here and in registry.ts; an old reader keeps
 * a kind it does not know and never rewrites it.
 */
export declare const EVENT_KINDS: readonly ["game.start", "game.stop", "boost.apply", "boost.restore", "net.verdict", "perf.hitch", "perf.throttle", "perf.tabcost", "system.update", "download.finish", "tab.sleep", "health.change", "note"];
export type PcbbKind = (typeof EVENT_KINDS)[number];
export declare function isKnownKind(kind: string): kind is PcbbKind;
/**
 * A pointer into the store that OWNS the facts: a Black Box line carries the id, never a copy of the
 * owner's payload. `file` is a file name only (sessions.json, journal.json, notifications.json).
 */
export interface PcbbRef {
    file: string;
    id: string;
}
/** One line of an events-YYYY-MM-DD.ndjson file. */
export interface PcbbEvent {
    v: number;
    /** ULID-like: sorts by time, unique across processes. */
    id: string;
    /** ISO 8601, UTC, with milliseconds. */
    t: string;
    src: string;
    /** One of EVENT_KINDS, or a kind a newer writer added. */
    kind: string;
    /** Game display name (a name, never a path). */
    game?: string;
    /** The owner's session id (sessions.json) when the event happened inside a play session. */
    sessionId?: string;
    data: Record<string, unknown>;
    ref?: PcbbRef;
}
/** What a caller hands to the writer. Everything not listed in the kind's schema is dropped. */
export interface PcbbEventInput {
    kind: PcbbKind;
    game?: string;
    sessionId?: string;
    data?: Record<string, unknown>;
    ref?: PcbbRef;
    /** Default: now. */
    t?: Date | string;
}
export type AppendResult = {
    ok: true;
    id: string;
} | {
    ok: false;
    reason: string;
};
/** The most one line may hold. Below the size at which concurrent appends are expected to stay whole. */
export declare const MAX_LINE_BYTES = 4096;
export declare const EVENTS_FILE_PATTERN: RegExp;

// ---- registry.ts ----
/** The only thing the public API says about a schema, so a consumer needs no zod types. */
export interface PcbbKindSchema {
    safeParse(value: unknown): {
        success: true;
        data: Record<string, unknown>;
    } | {
        success: false;
        error: {
            message: string;
        };
    };
}
export declare const KIND_SCHEMAS: Readonly<Record<PcbbKind, PcbbKindSchema>>;
export declare function kindList(): readonly PcbbKind[];
/** URLs become <url>; a path keeps only its last segment (a file name). */
export declare function maskText(input: string): string;
/** Mask every string inside a plain value (arrays and objects are walked; depth is bounded). */
export declare function maskValue(value: unknown, depth?: number): unknown;

// ---- ulid.ts ----
export declare function newEventId(ms?: number): string;

// ---- files.ts ----
/** Environment variable that overrides the folder (tests, probes). */
export declare const DIR_ENV = "PCBB_DIR";
/**
 * The shared per-user folder: %PCBB_DIR% when set, else %LOCALAPPDATA%\PCBlackBox.
 * Raises when neither can be determined (never guesses a path that another program might own).
 */
export declare function resolveDir(env?: Record<string, string | undefined>): string;
/** "2026-10-14" for the UTC day of a time. */
export declare function dayOf(t: Date | string | number): string;
export declare function dayFileName(day: string): string;
export declare function dayFromFileName(name: string): string | null;
export interface DayFile {
    day: string;
    file: string;
    name: string;
    bytes: number;
}
/** The day files in the folder, oldest first. A missing folder is an empty list. */
export declare function listDays(dir: string): DayFile[];

// ---- retention.ts ----
export interface RetentionPolicy {
    maxDays: number;
    maxBytes: number;
}
export declare const DEFAULT_RETENTION: RetentionPolicy;
export interface RetentionResult {
    deleted: string[];
    keptFiles: number;
    keptBytes: number;
}
export declare function applyRetention(dir: string, policy: RetentionPolicy, now?: Date): RetentionResult;
/** Delete every day file (the "Clear the Black Box" button). Other files in the folder stay. */
export declare function clearAll(dir: string): string[];

// ---- writer.ts ----
export interface WriterOptions {
    dir: string;
    src: PcbbSource;
    /** Checked on every emit; false = write nothing (the owner switched the Black Box off). */
    enabled?: () => boolean;
    now?: () => Date;
    /** Called once per run, with the first failure. */
    onProblem?: (message: string) => void;
    /** When given, retention runs once per run and once per new UTC day, at the first emit (no timer). */
    retention?: () => RetentionPolicy | null;
}
export interface PcbbWriter {
    emit(input: PcbbEventInput): AppendResult;
    /** How many emits were refused or failed since this writer was made. */
    failures(): number;
    /** The folder this writer appends to. */
    readonly dir: string;
}
/** Append one complete line (a trailing newline is added). Starts a new row if the file ends mid-line. */
export declare function appendLine(file: string, line: string): void;
/** Turn an input into the line's object, or say why it cannot be one. Pure. */
export declare function buildEvent(input: PcbbEventInput, src: PcbbSource, now: Date): {
    ok: true;
    event: PcbbEvent;
} | {
    ok: false;
    reason: string;
};
export declare function createWriter(o: WriterOptions): PcbbWriter;

// ---- reader.ts ----
export interface ReadStats {
    /** Lines that were not complete events. */
    skipped: number;
}
export interface EventQuery {
    /** Inclusive. */
    from?: Date | string;
    /** Exclusive. */
    to?: Date | string;
    kinds?: readonly string[];
    /** Exact, case-insensitive. */
    game?: string;
    sessionId?: string;
    src?: string;
    /** Most events returned (default 1000). */
    limit?: number;
    /** Newest first (the limit then keeps the NEWEST events). */
    newestFirst?: boolean;
}
export interface QueryResult {
    events: PcbbEvent[];
    /** More matched than `limit`. */
    truncated: boolean;
    skipped: number;
}
/** Every complete event of one file, in file order. Reads in chunks. */
export declare function iterateFile(file: string, stats?: ReadStats): Generator<PcbbEvent>;
/** Stream matching events oldest first, without keeping them. */
export declare function iterateEvents(dir: string, q?: EventQuery, stats?: ReadStats): Generator<PcbbEvent>;
/** Matching events, bounded by `limit`. Memory is bounded by the limit, not by the folder. */
export declare function queryEvents(dir: string, q?: EventQuery): QueryResult;
/**
 * The events within `windowMs` before and after `at`, closest first.
 * (What was happening around a stutter, a crash, a driver update.)
 */
export declare function eventsAround(dir: string, at: Date | string, windowMs: number, opts?: Pick<EventQuery, 'kinds' | 'game' | 'sessionId' | 'src' | 'limit'>): PcbbEvent[];
export interface GameAggregate {
    game: string;
    /** Number of each kind seen for this game. */
    counts: Record<string, number>;
    sessions: number;
    /** Sum of game.stop durations. */
    playMs: number;
    first: string;
    last: string;
}
/** Per-game totals, streamed (nothing is held but the totals). Events without a game are skipped. */
export declare function aggregateByGame(dir: string, q?: Omit<EventQuery, 'limit' | 'newestFirst'>): GameAggregate[];
export interface StoreStats {
    files: number;
    bytes: number;
    oldestDay: string | null;
    newestDay: string | null;
}
export declare function storeStats(dir: string): StoreStats;

// ---- fingerprint.ts ----
export interface Fingerprint {
    osBuild: string | null;
    gpuDriver: string | null;
    appVersion: string | null;
}
export interface FingerprintChange {
    field: keyof Fingerprint;
    from: string | null;
    to: string | null;
}
export declare function diffFingerprints(prev: Fingerprint, next: Fingerprint): FingerprintChange[];
/**
 * Compare with the saved fingerprint, emit one system.update when something differs, and save the
 * new one. Raises on an unreadable state file (the caller decides how to report it).
 */
export declare function checkSystemUpdate(opts: {
    dir: string;
    src: PcbbSource;
    current: Fingerprint;
    writer: PcbbWriter;
}): FingerprintChange[];
