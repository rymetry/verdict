#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

const waves = [
  ["T1500-1", "T1500-2", "T1500-8"],
  ["T1500-3", "T1500-4", "T1500-5", "T1500-6"],
  ["T1500-7", "T1500-9"],
  ["T1500-10"]
];

const progress = JSON.parse(process.env.AGENT_AUTONOMY_PROGRESS ?? "{}");
const progressEvidence = ".agents/state/progress.json";
const planEvidence = "docs/product/PLAN.v3.md";

const activeTaskId = progress.active?.id ?? progress.active?.tid ?? null;
const planPath = path.join(process.cwd(), planEvidence);
if (!fs.existsSync(planPath)) {
  writeSelection({
    task: null,
    warnings: [`${planEvidence} was not found.`],
    evidence: [progressEvidence],
    blockedReason: "task-source-missing"
  });
}

const rows = parsePlanV3Rows(fs.readFileSync(planPath, "utf8"));
const completed = new Set(progress.completed ?? []);
if (activeTaskId !== null) {
  const active = rows.get(activeTaskId);
  if (active && !completed.has(activeTaskId)) {
    writeSelection({
      task: taskFromRow(active),
      warnings: [`Retrying active task ${activeTaskId}.`],
      evidence: [progressEvidence, planEvidence]
    });
  }
  if (!active) {
    writeSelection({
      task: null,
      warnings: [`Active task ${activeTaskId} is already in progress but is missing from PLAN.v3.`],
      evidence: [progressEvidence, planEvidence],
      blockedReason: "active-task-in-progress"
    });
  }
}

for (const wave of waves) {
  const incomplete = wave.filter((id) => !completed.has(id));
  if (incomplete.length === 0) {
    continue;
  }
  const next = rows.get(incomplete[0]);
  if (!next) {
    writeSelection({
      task: null,
      warnings: [`Task ${incomplete[0]} is in the active wave but missing from PLAN.v3.`],
      evidence: [progressEvidence, planEvidence],
      blockedReason: "task-missing-from-plan"
    });
  }
  writeSelection({
    task: taskFromRow(next),
    warnings: [],
    evidence: [progressEvidence, planEvidence]
  });
}

writeSelection({
  task: null,
  warnings: [],
  evidence: [progressEvidence, planEvidence]
});

function parsePlanV3Rows(markdown) {
  const rows = new Map();
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\|\s*(T\d{4}-\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!match) {
      continue;
    }
    rows.set(match[1], {
      id: match[1],
      title: stripMarkdown(match[2].trim()),
      location: stripMarkdown(match[3].trim())
    });
  }
  return rows;
}

function stripMarkdown(value) {
  return value.replace(/`([^`]+)`/g, "$1");
}

function taskFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    deliverable: `${row.title} | ${row.location}`,
    expectedScope: inferExpectedScope(row.location),
    highRisk: isHighRisk(`${row.id} ${row.title} ${row.location}`)
  };
}

function inferExpectedScope(location) {
  if (location.includes("rfcs/")) {
    return ["docs/product/rfcs"];
  }
  const paths = [...location.matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/g)].map((match) =>
    match[1].replace(/\/$/, "")
  );
  return paths;
}

function isHighRisk(text) {
  const highRiskPatterns = [
    "auth",
    "permission",
    "billing",
    "payment",
    "delete",
    "external integration",
    "deploy"
  ];
  const haystack = text.toLowerCase();
  return highRiskPatterns.some((pattern) => haystack.includes(pattern));
}

function writeSelection(selection) {
  console.log(JSON.stringify(selection));
  process.exit(0);
}
