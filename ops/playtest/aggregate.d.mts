/** Types for `aggregate.mjs`, so `aggregate.test.ts` type-checks under `ops/tsconfig.json`. */

export type Row = Readonly<Record<string, string>>;
export type ParsedTable = Readonly<{ header: readonly string[]; rows: readonly Row[]; error?: undefined }> | Readonly<{ error: string }>;

export interface Findings {
  readonly persona: string;
  readonly model: string;
  readonly games: readonly Row[];
  readonly scores: readonly Row[];
  readonly problems: readonly string[];
}

export interface Judge {
  readonly name: string;
  readonly tableA: readonly Row[];
  readonly tableB: readonly Row[];
  readonly verdict: readonly Row[];
  readonly problems: readonly string[];
}

export interface ArmRow {
  readonly arm: string;
  readonly games: number;
  readonly completion: number | null;
  readonly hintsPerRound: number | null;
  readonly medianRoundSeconds: number | null;
  readonly fallbacksPerRound: number | null;
  readonly costPerGame: number | null;
}

export interface Reports { readonly haiku: unknown; readonly sonnet: unknown }

export const DIMENSIONS: readonly string[];
export const DECK_ROWS: readonly string[];
export const RELEASE_BAR: readonly Readonly<{ line: string; judge: string; text: string }>[];

export function section(markdown: string, heading: string): string | null;
export function parseTable(markdown: string): ParsedTable;
export function parseFindings(markdown: string, name: string): Findings;
export function parseJudge(markdown: string, name: string): Judge;
export function scoreOf(cell: string | undefined): number | null;
export function armRows(report: unknown): readonly ArmRow[];
export function aggregate(input: Readonly<{ findings: readonly Findings[]; judges: readonly Judge[]; reports: Reports; run?: string }>): string;
export function aggregateRun(directory: string): Readonly<{ markdown: string; problems: readonly string[] }>;
