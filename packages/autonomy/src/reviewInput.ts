import * as fs from "node:fs";
import * as path from "node:path";
import type { ReviewFinding, SubagentReview } from "./ship.js";

export interface ReviewInputFile {
  reviews: SubagentReview[];
  expectedReviewers?: string[];
}

export function loadReviewInput(projectRoot: string, reviewFile: string): ReviewInputFile {
  const target = path.resolve(projectRoot, reviewFile);
  return parseReviewInput(fs.readFileSync(target, "utf8"));
}

export function parseReviewInput(raw: string): ReviewInputFile {
  const parsed = JSON.parse(raw) as unknown;
  const input = Array.isArray(parsed) ? { reviews: parsed } : parsed;
  if (!isRecord(input) || !Array.isArray(input.reviews)) {
    throw new Error("Review input must be an array or an object with a reviews array.");
  }
  const reviews = input.reviews.map(parseReview);
  const expectedReviewers = Array.isArray(input.expectedReviewers)
    ? input.expectedReviewers.map((value) => parseNonEmptyString(value, "expected reviewer"))
    : undefined;
  return { reviews, expectedReviewers };
}

function parseReview(value: unknown): SubagentReview {
  if (!isRecord(value)) {
    throw new Error("Review entry must be an object.");
  }
  const reviewer = parseNonEmptyString(value.reviewer, "reviewer");
  const status = parseStatus(value.status);
  const findings = Array.isArray(value.findings) ? value.findings.map(parseFinding) : undefined;
  const summary = typeof value.summary === "string" ? value.summary : undefined;
  return { reviewer, status, findings, summary };
}

function parseFinding(value: unknown): ReviewFinding {
  if (!isRecord(value)) {
    throw new Error("Review finding must be an object.");
  }
  const priority = value.priority;
  if (priority !== 0 && priority !== 1 && priority !== 2 && priority !== 3) {
    throw new Error("Review finding priority must be 0, 1, 2, or 3.");
  }
  return {
    priority,
    title: parseNonEmptyString(value.title, "finding title"),
    body: typeof value.body === "string" ? value.body : undefined,
    file: typeof value.file === "string" ? value.file : undefined,
    line: typeof value.line === "number" && Number.isInteger(value.line) ? value.line : undefined,
    source: typeof value.source === "string" ? value.source : undefined
  };
}

function parseStatus(value: unknown): SubagentReview["status"] {
  if (value === "pass" || value === "fail" || value === "pending") {
    return value;
  }
  throw new Error("Review status must be pass, fail, or pending.");
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
