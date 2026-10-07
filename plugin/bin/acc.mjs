// packages/cli/src/main.ts
import { existsSync as existsSync18, mkdtempSync as mkdtempSync5, readFileSync as readFileSync22, realpathSync as realpathSync4, rmSync as rmSync14, writeFileSync as writeFileSync22 } from "node:fs";
import { tmpdir as tmpdir5 } from "node:os";
import { dirname as dirname8, join as join25, resolve as resolve3 } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// packages/core/src/exec.ts
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
var within = (ms) => ms % 6e4 === 0 ? `${ms / 6e4} minute${ms === 6e4 ? "" : "s"}` : `${ms / 1e3} seconds`;
var ghEnv = (env = process.env) => ({ ...env, GH_NO_UPDATE_NOTIFIER: "1", GH_PROMPT_DISABLED: "1" });
var isGh = (cmd) => basename(cmd) === "gh";
var run = (cmd, args, opts = {}) => {
  const gh = isGh(cmd);
  const timeout = opts.timeoutMs ?? 12e4;
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: gh ? ghEnv(opts.env) : opts.env ?? process.env,
    input: opts.input,
    encoding: "utf8",
    timeout,
    // At the timeout node signals the process, then waits for it to exit. A gh that catches SIGTERM would
    // outlive its timeout, and gh has nothing to tidy, so it gets SIGKILL. Others keep SIGTERM: git
    // removes its lock files on it (D-051).
    killSignal: gh ? "SIGKILL" : "SIGTERM",
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.error?.code === "ETIMEDOUT") {
    return { code: 127, stdout: "", stderr: `${basename(cmd)} didn't finish within ${within(timeout)}, so acc stopped it.`, timedOut: true };
  }
  if (r.error) return { code: 127, stdout: "", stderr: r.error.message };
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
var AccError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AccError";
  }
};
var sfEnv = (env = process.env) => ({
  ...env,
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  SF_NO_UPDATE_NOTIFIER: "true",
  SF_SKIP_NEW_VERSION_CHECK: "true",
  SF_DISABLE_TELEMETRY: "true"
});
function parseJsonOutput(text) {
  const plain = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  try {
    return JSON.parse(plain);
  } catch {
    const start = plain.search(/^[{[]/m);
    if (start < 0) throw new SyntaxError("No JSON in the output.");
    return JSON.parse(plain.slice(start));
  }
}

// packages/core/src/paths.ts
import { join } from "node:path";
function repoPaths(cwd, run2) {
  const top = run2("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (top.code !== 0) throw new AccError("not-a-repo", `${cwd} isn't inside a git repository.`);
  const common = run2("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  if (common.code !== 0) throw new AccError("not-a-repo", `Couldn't find the git directory for ${cwd}.`);
  const root = top.stdout.trim();
  const commonDir = common.stdout.trim();
  const stateDir = join(commonDir, "acc");
  return {
    root,
    commonDir,
    stateDir,
    ledger: join(stateDir, "ledger.json"),
    events: join(stateDir, "events.jsonl"),
    lock: join(stateDir, "ledger.lock"),
    autopilotLock: join(stateDir, "autopilot.lock"),
    receipts: join(stateDir, "receipts"),
    reviews: join(stateDir, "reviews"),
    analyses: join(stateDir, "analyses"),
    updates: join(stateDir, "updates"),
    checks: join(stateDir, "checks"),
    packets: join(stateDir, "packets"),
    logs: join(stateDir, "logs"),
    config: join(root, ".acc", "config.json")
  };
}

// packages/core/src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// packages/core/src/trackers/types.ts
var TRACKER_KINDS = ["github", "jira", "azure", "monday"];
var isTrackerKind = (v) => TRACKER_KINDS.includes(v);
var TRACKER_NAMES = { github: "GitHub", jira: "Jira", azure: "Azure DevOps", monday: "monday.com" };
var trackerName = (kind) => TRACKER_NAMES[kind];
var orList = (names2) => names2.length < 2 ? names2.join("") : `${names2.slice(0, -1).join(", ")} or ${names2.at(-1)}`;

// packages/core/src/config.ts
var PROFILES = ["generic", "salesforce"];
var ENV_TYPES = ["production", "full", "partial", "developer", "developer_pro", "none"];
var AUTONOMY = ["manual", "dispatch", "review", "full"];
var PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "dontAsk"];
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
var DEFAULT_MODEL = "claude-opus-5-5";
var AGENT_ROLES = ["builder", "reviewer"];
var noProfile = () => ({ model: null, effort: null, fallbackModel: null });
var TOP_KEYS = /* @__PURE__ */ new Set([
  "schema",
  "project",
  "profile",
  "github",
  "commitIdentity",
  "environments",
  "environmentSpecific",
  "knownDrift",
  "trackers",
  "agents",
  "autonomy",
  "worktrees",
  "gates",
  "secretScan",
  "analysis",
  "autopilot"
]);
var DEFAULT_HEAVY = {
  generic: ["build", "test", "check"],
  salesforce: ["static", "lwc-tests", "validate"]
};
function branchFor(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isStr = (v) => typeof v === "string" && v.trim() !== "";
var strList = (v) => Array.isArray(v) && v.every(isStr);
var JIRA_ISSUE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
function parseConfig(raw) {
  const errors = [];
  const warnings = [];
  if (!isObj(raw)) return { config: null, errors: ["The config must be a JSON object."], warnings };
  for (const k2 of Object.keys(raw)) if (!TOP_KEYS.has(k2)) warnings.push(`Unknown key "${k2}" is ignored.`);
  if (raw.schema !== 1) errors.push('"schema" must be 1.');
  if (!isStr(raw.project)) errors.push('"project" must be a name.');
  const profile = raw.profile ?? "generic";
  if (!PROFILES.includes(profile)) errors.push(`"profile" must be one of ${PROFILES.join(", ")}.`);
  let github = null;
  if (raw.github !== void 0 && raw.github !== null) {
    const g2 = raw.github;
    if (!isObj(g2) || !isStr(g2.repo) || !/^[\w.-]+\/[\w.-]+$/.test(g2.repo) || !isStr(g2.account)) {
      errors.push('"github" needs "repo" (owner/name) and "account" (the gh account for this repo).');
    } else github = { repo: g2.repo, account: g2.account };
  }
  let commitIdentity = null;
  if (raw.commitIdentity !== void 0 && raw.commitIdentity !== null) {
    const c = raw.commitIdentity;
    if (!isObj(c) || !isStr(c.name) || !isStr(c.email)) errors.push('"commitIdentity" needs "name" and "email".');
    else commitIdentity = { name: c.name, email: c.email };
  }
  const environments = parseEnvironments(raw.environments, profile, errors);
  const optPath = (key) => {
    const v = raw[key];
    if (v === void 0 || v === null) return null;
    if (!isStr(v)) {
      errors.push(`"${key}" must be a path inside the repo.`);
      return null;
    }
    return v;
  };
  const environmentSpecific = optPath("environmentSpecific");
  const knownDrift = optPath("knownDrift");
  const trackers = [];
  if (raw.trackers !== void 0) {
    if (!Array.isArray(raw.trackers)) errors.push('"trackers" must be a list.');
    else raw.trackers.forEach((t, i) => {
      if (!isObj(t) || !isTrackerKind(t.kind)) {
        errors.push(`trackers[${i}]: "kind" must be ${orList([...TRACKER_KINDS])}.`);
        return;
      }
      if (t.kind === "monday" && (!isStr(t.account) || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(t.account.trim()) || !Number.isSafeInteger(t.board) || t.board <= 0)) {
        errors.push(`trackers[${i}]: a monday.com tracker needs "account" (as in acme.monday.com) and "board" (the board's id, a number).`);
        return;
      }
      if (t.kind === "azure" && (!isStr(t.organization) || !isStr(t.project))) {
        errors.push(`trackers[${i}]: an Azure DevOps tracker needs "organization" and "project".`);
        return;
      }
      if (t.prefix !== void 0 && !(isStr(t.prefix) && /^[A-Za-z][A-Za-z0-9]{0,9}$/.test(t.prefix))) {
        errors.push(`trackers[${i}]: "prefix" must be a few letters, such as AB.`);
        return;
      }
      if (t.kind === "jira" && (!isStr(t.site) || !isStr(t.project))) {
        errors.push(`trackers[${i}]: a Jira tracker needs "site" and "project".`);
        return;
      }
      if (t.skipLabels !== void 0 && !(Array.isArray(t.skipLabels) && t.skipLabels.every(isStr))) {
        errors.push(`trackers[${i}]: "skipLabels" must be a list of label names, such as ["milestone"].`);
        return;
      }
      if (t.kind !== "github" && Array.isArray(t.skipLabels) && t.skipLabels.length) {
        warnings.push(`trackers[${i}]: "skipLabels" applies only to a GitHub tracker, so it's ignored.`);
      }
      const placeKeys = [
        { key: "epic", kind: "jira", on: "a Jira", ok: isStr(t.epic) && JIRA_ISSUE.test(t.epic.trim()), error: `"epic" must be a Jira epic's key, such as ACME-3.` },
        { key: "labels", kind: "github", on: "a GitHub", ok: strList(t.labels), error: '"labels" must be a list of label names, such as ["billing"].' },
        { key: "areaPath", kind: "azure", on: "an Azure DevOps", ok: isStr(t.areaPath), error: '"areaPath" must be an Azure DevOps area path, such as "CRM\\\\Billing".' },
        { key: "group", kind: "monday", on: "a monday.com", ok: isStr(t.group), error: `"group" must be a monday.com group's id, such as "topics".` },
        { key: "statusColumn", kind: "monday", on: "a monday.com", ok: isStr(t.statusColumn), error: `"statusColumn" must be a monday.com status column's id, such as "status".` }
      ];
      const set = placeKeys.filter((p) => t[p.key] !== void 0 && t[p.key] !== null);
      const bad = set.filter((p) => !p.ok);
      if (bad.length) {
        for (const p of bad) errors.push(`trackers[${i}]: ${p.error}`);
        return;
      }
      for (const p of set) {
        const empty = Array.isArray(t[p.key]) && !t[p.key].length;
        if (t.kind !== p.kind && !empty) warnings.push(`trackers[${i}]: "${p.key}" applies only to ${p.on} tracker, so it's ignored.`);
      }
      if (t.edits !== void 0 && typeof t.edits !== "boolean") {
        errors.push(`trackers[${i}]: "edits" must be true or false: whether the task page may change a ticket's status, assignee and labels, and on GitHub, whether acc sync closes an issue when its work merges.`);
        return;
      }
      const boardOk = t.board === void 0 || t.board === null || (t.kind === "azure" ? isStr(t.board) : Number.isSafeInteger(t.board) && t.board > 0);
      if (!boardOk) {
        errors.push(`trackers[${i}]: "board" must be ${t.kind === "azure" ? "an Azure board's name, such as Stories" : "a Jira board id or a GitHub Project number"}.`);
        return;
      }
      trackers.push({
        kind: t.kind,
        site: isStr(t.site) ? t.site : null,
        project: isStr(t.project) ? t.project : null,
        repo: isStr(t.repo) ? t.repo : null,
        organization: isStr(t.organization) ? t.organization : null,
        account: t.kind === "monday" && isStr(t.account) ? t.account.trim().toLowerCase() : null,
        team: isStr(t.team) ? t.team : null,
        board: Number.isInteger(t.board) || isStr(t.board) ? t.board : null,
        statusColumn: t.kind === "monday" && isStr(t.statusColumn) ? t.statusColumn.trim() : null,
        prefix: isStr(t.prefix) ? t.prefix.toUpperCase() : null,
        skipLabels: t.kind === "github" && strList(t.skipLabels) ? t.skipLabels : [],
        epic: t.kind === "jira" && isStr(t.epic) ? t.epic.trim().toUpperCase() : null,
        labels: t.kind === "github" && strList(t.labels) ? t.labels.map((l3) => l3.trim()) : [],
        areaPath: t.kind === "azure" && isStr(t.areaPath) ? t.areaPath.trim() : null,
        group: t.kind === "monday" && isStr(t.group) ? t.group.trim() : null,
        edits: t.edits === true
      });
    });
    const seen = /* @__PURE__ */ new Map();
    trackers.forEach((t, i) => {
      const p = keyPrefix(t);
      if (!p) return;
      const first = seen.get(p);
      if (first === void 0) seen.set(p, i);
      else warnings.push(`trackers[${first}] and trackers[${i}] both give tickets keys like ${p}-12, so those keys go to trackers[${first}]. Give one of them its own "prefix".`);
    });
  }
  const a = isObj(raw.agents) ? raw.agents : {};
  const max = a.max ?? 3;
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 16) errors.push('"agents.max" must be a whole number from 1 to 16.');
  const permissionMode = a.permissionMode ?? "acceptEdits";
  if (typeof permissionMode !== "string" || !PERMISSION_MODES.includes(permissionMode)) {
    errors.push(`"agents.permissionMode" must be one of ${PERMISSION_MODES.join(", ")}. bypassPermissions is never allowed for builders.`);
  }
  const profileOf = (role) => {
    const p = a[role];
    if (p === void 0 || p === null) return noProfile();
    if (!isObj(p)) {
      errors.push(`"agents.${role}" must be an object with model, effort and fallbackModel.`);
      return noProfile();
    }
    const model = (v, key) => {
      if (v === void 0 || v === null) return null;
      if (typeof v !== "string" || !MODEL_NAME.test(v)) {
        errors.push(`"agents.${role}.${key}" must be a model alias, such as sonnet, or a full model name.`);
        return null;
      }
      return v;
    };
    let effort = null;
    if (p.effort !== void 0 && p.effort !== null) {
      if (EFFORTS.includes(p.effort)) effort = p.effort;
      else errors.push(`"agents.${role}.effort" must be one of ${EFFORTS.join(", ")}.`);
    }
    return { model: model(p.model, "model"), effort, fallbackModel: model(p.fallbackModel, "fallbackModel") };
  };
  const builder = profileOf("builder");
  const reviewer = profileOf("reviewer");
  const autonomy = raw.autonomy ?? "manual";
  if (!AUTONOMY.includes(autonomy)) errors.push(`"autonomy" must be one of ${AUTONOMY.join(", ")}.`);
  const w = isObj(raw.worktrees) ? raw.worktrees : {};
  if (w.root !== void 0 && w.root !== null && !isStr(w.root)) errors.push('"worktrees.root" must be a path.');
  if (w.setup !== void 0 && !strList(w.setup)) errors.push('"worktrees.setup" must be a list of commands.');
  const g = isObj(raw.gates) ? raw.gates : {};
  if (g.required !== void 0 && !strList(g.required)) errors.push('"gates.required" must be a list of gate names.');
  const commands = {};
  if (g.commands !== void 0) {
    if (!isObj(g.commands) || !Object.values(g.commands).every(isStr)) errors.push('"gates.commands" must map gate names to commands.');
    else Object.assign(commands, g.commands);
  }
  if (g.heavy !== void 0 && !strList(g.heavy)) errors.push('"gates.heavy" must be a list of gate names.');
  if (g.severity !== void 0 && !(Number.isInteger(g.severity) && g.severity >= 1 && g.severity <= 5)) {
    errors.push('"gates.severity" must be a whole number from 1 (only the worst problems fail) to 5 (everything fails).');
  }
  const s = isObj(raw.secretScan) ? raw.secretScan : {};
  if (s.paths !== void 0 && !strList(s.paths)) errors.push('"secretScan.paths" must be a list.');
  if (s.exclude !== void 0 && !strList(s.exclude)) errors.push('"secretScan.exclude" must be a list.');
  const defaultScan = profile === "salesforce" ? ["force-app", "config", "scripts"] : ["."];
  const an = isObj(raw.analysis) ? raw.analysis : {};
  if (raw.analysis !== void 0 && !isObj(raw.analysis)) errors.push('"analysis" must be an object, such as { "required": true }.');
  if (an.required !== void 0 && typeof an.required !== "boolean") errors.push('"analysis.required" must be true or false.');
  let autopilot;
  if (raw.autopilot !== void 0) {
    const ap = raw.autopilot;
    if (!isObj(ap)) errors.push('"autopilot" must be an object, such as { "appendOnly": ["docs/DECISIONS.md"] }.');
    else {
      for (const k2 of Object.keys(ap)) if (k2 !== "appendOnly" && k2 !== "autoMerge") warnings.push(`Unknown key "autopilot.${k2}" is ignored.`);
      const list = ap.appendOnly ?? [];
      const autoMerge = ap.autoMerge ?? false;
      if (!strList(list) || list.some((f) => f.startsWith("/") || f.split("/").includes(".."))) {
        errors.push('"autopilot.appendOnly" must be a list of paths inside the repo, such as ["docs/DECISIONS.md"].');
      } else if (typeof autoMerge !== "boolean") {
        errors.push('"autopilot.autoMerge" must be true or false: whether autopilot merges a reviewed pull request whose checks passed.');
      } else if (autoMerge && profile === "salesforce") {
        errors.push(`"autopilot.autoMerge" can't be on in a Salesforce project: a person merges every pull request there.`);
      } else autopilot = { appendOnly: list, ...autoMerge ? { autoMerge: true } : {} };
    }
  }
  if (errors.length) return { config: null, errors, warnings };
  return {
    config: {
      schema: 1,
      project: raw.project,
      profile,
      github,
      commitIdentity,
      environments,
      environmentSpecific,
      knownDrift,
      trackers,
      agents: { max, permissionMode, builder, reviewer },
      autonomy,
      worktrees: { root: isStr(w.root) ? w.root : null, setup: strList(w.setup) ? w.setup : [] },
      gates: {
        required: strList(g.required) ? g.required : [],
        commands,
        heavy: strList(g.heavy) ? g.heavy : DEFAULT_HEAVY[profile],
        severity: g.severity ?? 2
      },
      secretScan: {
        paths: strList(s.paths) ? s.paths : defaultScan,
        exclude: strList(s.exclude) ? s.exclude : []
      },
      ...typeof an.required === "boolean" ? { analysis: { required: an.required } } : {},
      ...autopilot ? { autopilot } : {}
    },
    errors,
    warnings
  };
}
function parseEnvironments(raw, profile, errors) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('"environments" must list at least one environment.');
    return [];
  }
  const envs = [];
  raw.forEach((e, i) => {
    const at2 = `environments[${i}]`;
    if (!isObj(e) || !isStr(e.name)) {
      errors.push(`${at2}: needs a "name".`);
      return;
    }
    const branch = branchFor(e.name);
    if (e.branch !== void 0 && e.branch !== branch) {
      errors.push(`${at2}: the branch for "${e.name}" must be "${branch}", the environment name in lower case (D-015).`);
    }
    const type = e.type ?? (profile === "salesforce" ? void 0 : "none");
    if (type === void 0 || !ENV_TYPES.includes(type)) {
      errors.push(`${at2}: "type" must be one of ${ENV_TYPES.join(", ")}.`);
      return;
    }
    if (profile === "salesforce" && type === "none") errors.push(`${at2}: a Salesforce environment needs its org type.`);
    if (e.org !== void 0 && e.org !== null && !isStr(e.org)) errors.push(`${at2}: "org" must be an org alias.`);
    const isProd = type === "production";
    if (isProd && e.protected === false) errors.push(`${at2}: Production is always protected.`);
    if (e.promotesTo !== void 0 && !strList(e.promotesTo)) errors.push(`${at2}: "promotesTo" must be a list of branches.`);
    envs.push({
      name: e.name,
      branch,
      type,
      org: isStr(e.org) ? e.org : null,
      default: e.default === true,
      protected: isProd || e.protected === true,
      promotesTo: strList(e.promotesTo) ? e.promotesTo.map(branchFor) : []
    });
  });
  const seen = /* @__PURE__ */ new Set();
  for (const env of envs) {
    if (seen.has(env.branch)) errors.push(`Two environments share the branch "${env.branch}".`);
    seen.add(env.branch);
  }
  const defaults = envs.filter((e) => e.default);
  if (envs.length && defaults.length !== 1) errors.push('Mark exactly one environment as "default": the one day-to-day work starts from.');
  for (const d of defaults) if (d.protected) errors.push(`The default environment "${d.name}" can't be protected.`);
  for (const env of envs) {
    for (const to of env.promotesTo) {
      if (to === env.branch) errors.push(`"${env.name}" can't promote to itself.`);
      else if (!seen.has(to)) errors.push(`"${env.name}" promotes to "${to}", which isn't a listed environment.`);
    }
  }
  const cycle = findCycle(envs);
  if (cycle) errors.push(`The promotion paths loop: ${cycle.join(" \u2192 ")}.`);
  return envs;
}
function findCycle(envs) {
  const next = new Map(envs.map((e) => [e.branch, e.promotesTo]));
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (b) => {
    if (state.get(b) === "done") return null;
    if (state.get(b) === "visiting") return [...stack.slice(stack.indexOf(b)), b];
    state.set(b, "visiting");
    stack.push(b);
    for (const to of next.get(b) ?? []) {
      const c = visit(to);
      if (c) return c;
    }
    stack.pop();
    state.set(b, "done");
    return null;
  };
  for (const e of envs) {
    const c = visit(e.branch);
    if (c) return c;
  }
  return null;
}
function loadConfig(file) {
  if (!existsSync(file)) throw new AccError("no-config", `No ${file}. Run "acc init" first.`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new AccError("bad-config", `${file} isn't valid JSON: ${e.message}`);
  }
  const r = parseConfig(raw);
  if (!r.config) throw new AccError("bad-config", `${file} has problems:
- ${r.errors.join("\n- ")}`);
  return r;
}
function writeConfig(file, config) {
  mkdirSync(dirname(file), { recursive: true });
  const profile = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null));
  const { builder, reviewer, ...agents } = config.agents;
  const out2 = {
    ...config,
    environments: config.environments.map(({ branch: _branch, ...e }) => e),
    // A tracker is written as it was given, so the file loads again: what it doesn't set stays out, and it
    // says it may change tickets only when it may (D-066).
    trackers: config.trackers.map(({ edits, ...t }) => ({
      ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))),
      ...edits ? { edits } : {}
    })),
    agents: { ...agents, ...Object.keys(profile(builder)).length ? { builder: profile(builder) } : {}, ...Object.keys(profile(reviewer)).length ? { reviewer: profile(reviewer) } : {} }
  };
  writeFileSync(file, JSON.stringify(out2, null, 2) + "\n");
}
function defaultEnvironment(config) {
  const env = config.environments.find((e) => e.default);
  if (!env) throw new AccError("bad-config", "No default environment.");
  return env;
}
function environmentByBranch(config, branch) {
  return config.environments.find((e) => e.branch === branch);
}
var autoMergeOn = (config) => config.autopilot?.autoMerge === true && config.profile !== "salesforce";
function autoMergeFor(config, branch) {
  if (!autoMergeOn(config) || config.autonomy !== "review") return false;
  const env = environmentByBranch(config, branch);
  return !!env && !env.protected;
}
function keyPrefix(t) {
  if (t.kind === "github") return "GH";
  if (t.kind === "azure") return (t.prefix ?? "AB").toUpperCase();
  if (t.kind === "monday") return (t.prefix ?? "MON").toUpperCase();
  return t.project ? t.project.toUpperCase() : null;
}
function trackerForKey(trackers, key) {
  const k2 = key.toUpperCase();
  const i = trackers.findIndex((t) => {
    if (/^GH-\d+$/.test(k2)) return t.kind === "github";
    const p = t.kind === "github" ? null : keyPrefix(t);
    return !!p && k2.startsWith(`${p}-`);
  });
  return i >= 0 ? i : null;
}

// packages/core/src/lock.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function withLock(lockDir, fn2, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15e3;
  const staleMs = opts.staleMs ?? 6e4;
  const started = Date.now();
  for (; ; ) {
    try {
      mkdirSync2(lockDir);
      writeFileSync2(join2(lockDir, "owner"), JSON.stringify({ pid: process.pid, at: Date.now() }));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner = null;
      try {
        owner = JSON.parse(readFileSync2(join2(lockDir, "owner"), "utf8"));
      } catch {
        owner = null;
      }
      let age = 0;
      try {
        age = Date.now() - (owner?.at ?? statSync(lockDir).mtimeMs);
      } catch {
        continue;
      }
      if (owner && !alive(owner.pid) || age > staleMs) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new AccError("lock-timeout", `Another acc process is holding ${lockDir}. Try again in a moment.`);
      }
      sleep(20 + Math.floor(Math.random() * 40));
    }
  }
  try {
    return fn2();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

// packages/core/src/ledger.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync4, readFileSync as readFileSync4, renameSync, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname2 } from "node:path";

// packages/core/src/awake.ts
import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, rmSync as rmSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { basename as basename2, join as join3 } from "node:path";
var detached = (cmd, args) => {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => void 0);
  return child;
};
var stop = (pid) => {
  try {
    process.kill(pid);
  } catch {
  }
};
function holdAwake(watchPid, deps = {}) {
  if ((deps.platform ?? process.platform) !== "darwin" || !Number.isInteger(watchPid) || watchPid <= 0) return null;
  const child = (deps.spawn ?? detached)("caffeinate", ["-i", "-w", String(watchPid)]);
  child.unref();
  const pid = child.pid;
  if (!pid) return null;
  const kill = deps.kill ?? stop;
  return { pid, release: () => kill(pid) };
}
var awakePath = (paths, id) => join3(paths.stateDir, "awake", `${id}.pid`);
function isCaffeinate(pid) {
  if (!alive(pid)) return false;
  const r = spawnSync2("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" });
  return r.status === 0 && basename2(r.stdout.trim()) === "caffeinate";
}
function keepAwakeFor(paths, id, watchPid, deps = {}) {
  releaseAwake(paths, id, deps);
  const held = holdAwake(watchPid, deps);
  if (!held) return null;
  try {
    mkdirSync3(join3(paths.stateDir, "awake"), { recursive: true });
    writeFileSync3(awakePath(paths, id), JSON.stringify({ pid: held.pid, watch: watchPid }));
  } catch {
  }
  return held;
}
function releaseAwake(paths, id, deps = {}) {
  const file = awakePath(paths, id);
  let rec;
  try {
    rec = JSON.parse(readFileSync3(file, "utf8"));
  } catch {
    return false;
  }
  rmSync2(file, { force: true });
  if (!Number.isInteger(rec.pid) || rec.pid <= 0) return false;
  if (deps.kill) deps.kill(rec.pid);
  else if (isCaffeinate(rec.pid)) stop(rec.pid);
  return true;
}

// packages/core/src/ledger.ts
var STATES = ["todo", "running", "review", "rework", "blocked", "done"];
var ACTORS = ["human", "orchestrator", "builder", "reviewer", "sync"];
var SOURCE_KINDS = [...TRACKER_KINDS, "manual"];
var emptyLedger = () => ({ schema: 1, seq: 0, tasks: [] });
function readLedger(file) {
  if (!existsSync2(file)) return emptyLedger();
  const l3 = JSON.parse(readFileSync4(file, "utf8"));
  if (l3.schema !== 1 || !Array.isArray(l3.tasks)) throw new AccError("bad-ledger", `${file} isn't a ledger this version understands.`);
  return l3;
}
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync4(tmp, text);
  renameSync(tmp, file);
}
function mutate(paths, now2, fn2) {
  mkdirSync4(paths.stateDir, { recursive: true });
  return withLock(paths.lock, () => {
    const ledger = readLedger(paths.ledger);
    const events = [];
    const emit = (e) => events.push({ ...e, seq: ++ledger.seq, at: now2().toISOString() });
    const result = fn2(ledger, emit);
    if (events.length) {
      mkdirSync4(dirname2(paths.events), { recursive: true });
      appendFileSync(paths.events, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      writeAtomic(paths.ledger, JSON.stringify(ledger, null, 2) + "\n");
    }
    return result;
  });
}
var JIRA_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
function normalizeId(ref, defaultKind = "jira") {
  const r = ref.trim();
  const gh = /^(?:#|GH-)?(\d+)$/i.exec(r);
  if (gh && (defaultKind === "github" || /^(#|GH-)/i.test(r))) return `GH-${gh[1]}`;
  return r.toUpperCase();
}
function isValidId(id) {
  return JIRA_KEY.test(id);
}
function nextManualId(ledger) {
  const n = ledger.tasks.map((t) => /^T-(\d+)$/.exec(t.id)?.[1]).filter(Boolean).map(Number);
  return `T-${(n.length ? Math.max(...n) : 0) + 1}`;
}
function upsertTasks(ledger, config, inputs, actor, by, emit, now2) {
  const res = { added: [], updated: [], unchanged: [], errors: [] };
  const defaultEnv = defaultEnvironment(config).branch;
  inputs.forEach((input, i) => {
    const at2 = `item ${i + 1}`;
    if (!input || typeof input.title !== "string" || !input.title.trim()) {
      res.errors.push(`${at2}: needs a title.`);
      return;
    }
    const kind = input.source?.kind;
    if (!SOURCE_KINDS.includes(kind)) {
      res.errors.push(`${at2}: source kind must be ${SOURCE_KINDS.join(", ")}.`);
      return;
    }
    let id;
    if (kind === "manual") id = input.source.key ? normalizeId(input.source.key) : nextManualId(ledger);
    else {
      if (!input.source.key) {
        res.errors.push(`${at2}: a ${kind} task needs its tracker key.`);
        return;
      }
      id = normalizeId(input.source.key, kind);
    }
    if (!isValidId(id)) {
      res.errors.push(`${at2}: "${id}" isn't a valid task id.`);
      return;
    }
    const env = input.environment ?? defaultEnv;
    const envDef = environmentByBranch(config, env);
    if (!envDef) {
      res.errors.push(`${id}: environment "${env}" isn't in the config.`);
      return;
    }
    if (envDef.protected) {
      res.errors.push(`${id}: "${env}" is protected, so no task can build on it directly.`);
      return;
    }
    const deps = (input.deps ?? []).map((d) => normalizeId(d, kind));
    const fields = {
      title: input.title.trim(),
      brief: (input.brief ?? "").trim(),
      deps,
      labels: input.labels ?? [],
      url: input.source.url ?? null
    };
    const existing = ledger.tasks.find((t) => t.id === id);
    const stamp = now2().toISOString();
    if (!existing) {
      const task = {
        id,
        title: fields.title,
        brief: fields.brief,
        source: { kind, key: kind === "manual" ? null : input.source.key ?? null, url: fields.url },
        environment: env,
        deps,
        labels: fields.labels,
        state: "todo",
        blocker: null,
        run: null,
        pr: null,
        history: [{ at: stamp, actor, by, from: null, to: "todo", reason: null }],
        createdAt: stamp,
        updatedAt: stamp
      };
      ledger.tasks.push(task);
      emit({ type: "task.added", task: id, actor, by, data: { title: task.title, source: task.source } });
      res.added.push(id);
      return;
    }
    const changed = {};
    if (existing.title !== fields.title) changed.title = existing.title = fields.title;
    if (existing.brief !== fields.brief) changed.brief = existing.brief = fields.brief;
    if (existing.source.url !== fields.url) changed.url = existing.source.url = fields.url;
    if (JSON.stringify(existing.deps) !== JSON.stringify(deps)) changed.deps = existing.deps = deps;
    if (JSON.stringify(existing.labels) !== JSON.stringify(fields.labels)) changed.labels = existing.labels = fields.labels;
    if (Object.keys(changed).length) {
      existing.updatedAt = stamp;
      emit({ type: "task.updated", task: id, actor, by, data: changed });
      res.updated.push(id);
    } else res.unchanged.push(id);
  });
  return res;
}
var RULES = [
  { from: "todo", to: "running", actors: ["human", "orchestrator"], requires: ["depsDone", "underCap", "envNotProtected"] },
  { from: "running", to: "review", actors: ["builder", "human"], requires: ["gatesPassed"] },
  // The orchestrator is autopilot sending back a pull request whose checks failed on GitHub (D-076).
  { from: "review", to: "rework", actors: ["reviewer", "human", "orchestrator"], requires: ["reason"] },
  { from: "rework", to: "running", actors: ["human", "orchestrator"], requires: ["underCap", "envNotProtected"] },
  { from: "review", to: "done", actors: ["sync", "human"], requires: [] },
  // Its issue was closed on GitHub before anyone started it: acc intake moves it.
  { from: "todo", to: "done", actors: ["sync"], requires: [] },
  { from: "running", to: "todo", actors: ["human"], requires: ["reason"] },
  { from: "done", to: "rework", actors: ["human", "sync"], requires: ["reason"] },
  { from: "blocked", to: "todo", actors: ["human"], requires: [] },
  // A person settled what blocked finished work, such as by waiving a check (D-031).
  { from: "blocked", to: "review", actors: ["human"], requires: ["gatesPassed"] },
  { from: "any", to: "blocked", actors: [...ACTORS], requires: ["reason"] }
];
var noGateHooks = { missingGates: () => [] };
function findRule(from, to) {
  return RULES.find((r) => r.from === from && r.to === to) ?? RULES.find((r) => r.from === "any" && r.to === to && from !== "blocked" && from !== "done");
}
function checkMove(ledger, config, task, req, hooks) {
  if (!STATES.includes(req.to)) return [`"${req.to}" isn't a state. States: ${STATES.join(", ")}.`];
  if (!ACTORS.includes(req.actor)) return [`"${req.actor}" isn't an actor.`];
  if (task.state === req.to) return [`${task.id} is already ${req.to}.`];
  const reason = req.reason?.trim() ?? "";
  if (req.force) {
    const p = [];
    if (req.actor !== "human") p.push("Only a person can force a move.");
    if (!reason) p.push("A forced move needs --reason.");
    return p;
  }
  const rule = findRule(task.state, req.to);
  if (!rule) return [`There's no rule for ${task.state} \u2192 ${req.to}. A person can force it with --force --reason.`];
  if (!rule.actors.includes(req.actor)) {
    return [`A ${req.actor} can't move a task from ${task.state} to ${req.to}. Allowed: ${rule.actors.join(", ")}.`];
  }
  const problems = [];
  for (const r of rule.requires) {
    if (r === "reason" && !reason) problems.push(`Moving to ${req.to} needs a reason.`);
    if (r === "depsDone") {
      for (const d of task.deps) {
        const dep = ledger.tasks.find((t) => t.id === d);
        if (!dep) problems.push(`It depends on ${d}, which isn't in the ledger.`);
        else if (dep.state !== "done") problems.push(`It's waiting on ${d}, which is ${dep.state}.`);
      }
    }
    if (r === "underCap") {
      const running2 = ledger.tasks.filter((t) => t.state === "running" && t.id !== task.id).length;
      if (running2 >= config.agents.max) problems.push(`${running2} tasks are already running. The limit is ${config.agents.max}.`);
    }
    if (r === "envNotProtected") {
      const env = environmentByBranch(config, task.environment);
      if (!env) problems.push(`Its environment "${task.environment}" isn't in the config.`);
      else if (env.protected) problems.push(`"${env.name}" is protected. Agents never work on it directly.`);
    }
    if (r === "gatesPassed") {
      const missing = hooks.missingGates(task);
      if (missing.length) problems.push(`These required checks haven't passed on the current commit: ${missing.join(", ")}. Commit everything, then run: acc gate run`);
    }
  }
  return problems;
}
function applyMove(task, req, emit, now2, data = {}) {
  const at2 = now2().toISOString();
  const entry = { at: at2, actor: req.actor, by: req.by, from: task.state, to: req.to, reason: req.reason?.trim() || null };
  if (req.force) entry.override = true;
  task.blocker = req.to === "blocked" ? entry.reason ?? null : null;
  if (task.autopilot?.failed) task.autopilot.failed = null;
  task.state = req.to;
  task.updatedAt = at2;
  task.history.push(entry);
  emit({ type: "task.moved", task: task.id, actor: req.actor, by: req.by, data: { from: entry.from, to: entry.to, reason: entry.reason, override: req.force ?? false, ...data } });
  return entry;
}
function moveTask(paths, config, id, req, hooks, now2) {
  const moved = mutate(paths, now2, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task) throw new AccError("no-task", `No task ${id}.`);
    const problems = checkMove(ledger, config, task, req, hooks);
    if (problems.length) throw new AccError("move-refused", `Can't move ${id} to ${req.to}:
- ${problems.join("\n- ")}`);
    const entry = applyMove(task, req, emit, now2);
    return { task, entry };
  });
  if (moved.entry.from === "running") releaseAwake(paths, id);
  return moved;
}
function isReady(ledger, task) {
  return task.state === "todo" && task.deps.every((d) => ledger.tasks.find((t) => t.id === d)?.state === "done");
}
var autopilotFailure = (task) => task.autopilot?.failed && task.autopilot.failed.state === task.state ? task.autopilot.failed : null;
function sessionsOf(task, sessions) {
  const run2 = task.run;
  if (run2?.bgId || run2?.sessionId) return sessions.filter((s) => !!run2.bgId && s.id === run2.bgId || !!run2.sessionId && s.sessionId === run2.sessionId);
  const name = run2?.name ?? task.id;
  return sessions.filter((s) => s.kind === "background" && s.name === name);
}
function sessionActive(s) {
  if (!s.pid) return false;
  if (s.kind !== "background") return true;
  if (s.state === "done" || s.state === "failed" || s.state === "stopped") return false;
  return s.status !== "idle";
}
var STOPPED_GRACE_MS = 2 * 6e4;
function runStartedAt(task) {
  const times = [task.run?.startedAt, ...(task.run?.resumes ?? []).map((r) => r.at)].filter((t) => !!t);
  return times.sort().at(-1) ?? null;
}
function builderStopped(task, sessions, o) {
  if (task.state !== "running" || !sessions || o.resuming) return false;
  const started = runStartedAt(task);
  if (!started || o.now.getTime() - Date.parse(started) < (o.graceMs ?? STOPPED_GRACE_MS)) return false;
  return !sessionsOf(task, sessions).some(sessionActive);
}
var closedPr = (task) => task.state === "review" && task.pr?.state === "closed" ? task.pr : null;
var AUTOPILOT_BY = "orchestrator:autopilot";
var sentBackForChecks = (h2) => h2.from === "review" && h2.to === "rework" && h2.by === AUTOPILOT_BY;
function reworkCause(task) {
  const h2 = task.history.findLast((x2) => x2.to === "rework");
  return h2 ? sentBackForChecks(h2) ? "checks" : "review" : null;
}
var sentBackAt = (task, sha) => !!sha && task.autopilot?.sentBack?.sha === sha;
function displayState(ledger, task, session) {
  if (task.state === "todo" && isReady(ledger, task)) return "ready";
  if (autopilotFailure(task)) return "needs-you";
  if (task.state === "running" && (session?.stopped || session?.state === "blocked" || session?.status === "waiting")) return "needs-you";
  if (task.state === "review" && task.pr?.state === "open" && (task.pr.ci === "failing" && !sentBackAt(task, task.pr.sha) || task.pr.changesRequested || !!task.pr.conflicts?.length)) return "needs-you";
  if (closedPr(task)) return "needs-you";
  return task.state;
}
var DISPLAY = {
  todo: { label: "To do", icon: "circle-outline", glyph: "\u25CB", tone: "neutral" },
  ready: { label: "Ready", icon: "play-circle", glyph: "\u25B7", tone: "blue" },
  running: { label: "Running", icon: "sync", glyph: "\u21BB", tone: "blue" },
  "needs-you": { label: "Needs you", icon: "bell", glyph: "!", tone: "orange" },
  review: { label: "In review", icon: "eye", glyph: "\u25CE", tone: "blue" },
  rework: { label: "Rework", icon: "debug-restart", glyph: "\u21BA", tone: "orange" },
  blocked: { label: "Blocked", icon: "circle-slash", glyph: "\u2298", tone: "orange" },
  done: { label: "Done", icon: "check", glyph: "\u2713", tone: "neutral" }
};

// packages/core/src/receipts.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync5, readdirSync, readFileSync as readFileSync5, renameSync as renameSync2, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join4 } from "node:path";
var satisfies = (r) => r?.status === "pass" || r?.status === "skip";
function receiptPath(paths, sha, gate) {
  return join4(paths.receipts, sha, `${gate}.json`);
}
function readReceipt(paths, sha, gate) {
  const f = receiptPath(paths, sha, gate);
  if (!existsSync3(f)) return null;
  try {
    return JSON.parse(readFileSync5(f, "utf8"));
  } catch {
    return null;
  }
}
function receiptsAt(paths, sha) {
  const dir = join4(paths.receipts, sha);
  if (!existsSync3(dir)) return {};
  const out2 = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const r = readReceipt(paths, sha, f.slice(0, -5));
    if (r) out2[r.gate] = r;
  }
  return out2;
}
function writeReceipt(paths, receipt) {
  const f = receiptPath(paths, receipt.sha, receipt.gate);
  mkdirSync5(join4(paths.receipts, receipt.sha), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync5(tmp, JSON.stringify(receipt, null, 2) + "\n");
  renameSync2(tmp, f);
  return f;
}
function receiptHooks(paths, config, run2) {
  return {
    missingGates(task) {
      const required = config.gates.required;
      if (!required.length) return [];
      const branch = task.run?.branch;
      if (!branch) return required;
      const sha = run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: paths.root });
      if (sha.code !== 0) return required;
      const head = sha.stdout.trim();
      return required.filter((g) => !satisfies(readReceipt(paths, head, g)));
    }
  };
}

// packages/core/src/semaphore.ts
import { mkdirSync as mkdirSync6, readFileSync as readFileSync6, renameSync as renameSync3, rmSync as rmSync3, statSync as statSync2, writeFileSync as writeFileSync6 } from "node:fs";
import { homedir } from "node:os";
import { join as join5 } from "node:path";
var heavyDir = (env = process.env) => env.ACC_HEAVY_DIR || join5(homedir(), ".acc", "heavy");
var machineFile = (env = process.env) => env.ACC_MACHINE_FILE || join5(homedir(), ".acc", "machine.json");
var MAX_HEAVY_SLOTS = 8;
var slotCount = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_HEAVY_SLOTS, n) : null;
};
function heavySlots(env = process.env) {
  const fromEnv = slotCount(env.ACC_HEAVY_SLOTS);
  if (fromEnv) return fromEnv;
  try {
    return slotCount(JSON.parse(readFileSync6(machineFile(env), "utf8")).heavySlots) ?? 1;
  } catch {
    return 1;
  }
}
function setHeavySlots(n, env = process.env) {
  const slots = slotCount(n);
  if (!slots || slots !== n) throw new AccError("usage", `Heavy-check slots are a whole number from 1 to ${MAX_HEAVY_SLOTS}.`);
  const file = machineFile(env);
  let current = {};
  try {
    current = JSON.parse(readFileSync6(file, "utf8"));
  } catch {
  }
  mkdirSync6(join5(file, ".."), { recursive: true });
  writeFileSync6(`${file}.tmp`, JSON.stringify({ ...current, heavySlots: slots }, null, 2) + "\n");
  renameSync3(`${file}.tmp`, file);
  return slots;
}
var UNOWNED_GRACE_MS = 1e4;
function take(slot) {
  try {
    mkdirSync6(slot);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    return false;
  }
  writeFileSync6(join5(slot, "owner"), JSON.stringify({ pid: process.pid, at: Date.now() }));
  return true;
}
function reclaim(slot) {
  let owner = null;
  try {
    owner = JSON.parse(readFileSync6(join5(slot, "owner"), "utf8"));
  } catch {
    owner = null;
  }
  let age = 0;
  try {
    age = Date.now() - statSync2(slot).mtimeMs;
  } catch {
    return;
  }
  if (owner ? !alive(owner.pid) : age > UNOWNED_GRACE_MS) rmSync3(slot, { recursive: true, force: true });
}
function withSlot(fn2, opts = {}) {
  const dir = opts.dir ?? heavyDir();
  const slots = opts.slots ?? heavySlots();
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 6e4;
  mkdirSync6(dir, { recursive: true });
  const started = Date.now();
  let waiting = false;
  for (; ; ) {
    for (let i = 0; i < slots; i++) {
      const slot = join5(dir, `slot-${i}`);
      reclaim(slot);
      if (!take(slot)) continue;
      try {
        return fn2();
      } finally {
        rmSync3(slot, { recursive: true, force: true });
      }
    }
    if (!waiting) {
      waiting = true;
      opts.onWait?.();
    }
    if (Date.now() - started > timeoutMs) {
      throw new AccError("busy", `Every heavy-check slot in ${dir} stayed taken for ${Math.round(timeoutMs / 6e4)} minutes. If no check is running, delete that folder.`);
    }
    sleep(opts.pollMs ?? 500);
  }
}

// packages/core/src/gates.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync7, readFileSync as readFileSync7, writeFileSync as writeFileSync7 } from "node:fs";
import { join as join6 } from "node:path";
var pass = (summary, details) => ({ status: "pass", summary, details });
var fail = (summary, details) => ({ status: "fail", summary, details });
var error = (summary) => ({ status: "error", summary });
var skip = (summary) => ({ status: "skip", summary });
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
var listOf = (items, max = 3) => items.slice(0, max).join(", ") + (items.length > max ? ` and ${items.length - max} more` : "");
function lastLine(text) {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l3) => l3.trim()).filter(Boolean);
  const line = lines.at(-1) ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}\u2026` : line;
}
var shellLine = (cmd, args) => [cmd, ...args].map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
var exitRead = (r) => r.code === 0 ? pass("Passed.") : r.code === 127 ? error(lastLine(r.stderr) || "The command wasn't found.") : fail(lastLine(r.stdout + "\n" + r.stderr) || `Exited with ${r.code}.`);
function checkEnv(env = process.env, heavyDir2) {
  const { ACC_ROLE: _role, ACC_TASK: _task, ...rest } = env;
  return heavyDir2 ? { ...rest, ACC_HEAVY_DIR: heavyDir2 } : rest;
}
function commandGate(name, command, heavy) {
  return { name, heavy, about: command, plan: () => ({ cmd: "sh", args: ["-c", command], read: exitRead }) };
}
var nodeBin = (root, name) => join6(root, "node_modules", ".bin", name);
var missingTool = (root, name) => error(`${name} isn't installed in this repo. Run npm install in the main checkout, then try again.`);
function packageDirs(root) {
  try {
    const p = JSON.parse(readFileSync7(join6(root, "sfdx-project.json"), "utf8"));
    const dirs = (p.packageDirectories ?? []).map((d) => d.path?.replace(/\/+$/, "")).filter((d) => !!d);
    return dirs.length ? dirs : ["force-app"];
  } catch {
    return ["force-app"];
  }
}
var under = (files, dirs) => files.filter((f) => dirs.some((d) => f === d || f.startsWith(`${d}/`)));
var FORMATTED = /(\.(cls|trigger)$)|((^|\/)lwc\/.+\.(js|html|css)$)/;
var COMPONENT_JS = /(^|\/)(lwc|aura)\/.+\.js$/;
var LWC = /(^|\/)lwc\//;
var APEX = /\.(cls|trigger)(-meta\.xml)?$/;
var format = {
  name: "format",
  heavy: false,
  about: "prettier --check on changed Apex and LWC code",
  plan({ root, changes }) {
    const files = changes.files.filter((f) => FORMATTED.test(f));
    if (!files.length) return { outcome: skip("No Apex or LWC code has changed.") };
    const bin = nodeBin(root, "prettier");
    if (!existsSync4(bin)) return { outcome: missingTool(root, "prettier") };
    return {
      cmd: bin,
      args: ["--check", ...files],
      read(r) {
        if (r.code === 0) return pass(`${plural(files.length, "changed file")} formatted.`);
        const bad = (r.stdout + "\n" + r.stderr).split("\n").map((l3) => /^\[warn\] (.+)$/.exec(l3.trim())?.[1]).filter((f) => !!f && files.includes(f));
        if (r.code === 1 && bad.length) return fail(`${plural(bad.length, "file")} need formatting: ${listOf(bad)}. Fix with: npx prettier --write ${bad.join(" ")}`);
        return error(lastLine(r.stderr || r.stdout) || `prettier exited with ${r.code}.`);
      }
    };
  }
};
var lint = {
  name: "lint",
  heavy: false,
  about: "ESLint on changed LWC and Aura JavaScript",
  plan({ root, changes }) {
    const files = changes.files.filter((f) => COMPONENT_JS.test(f));
    if (!files.length) return { outcome: skip("No LWC or Aura JavaScript has changed.") };
    const bin = nodeBin(root, "eslint");
    if (!existsSync4(bin)) return { outcome: missingTool(root, "eslint") };
    return {
      cmd: bin,
      args: files,
      read: (r) => r.code === 0 ? pass(`${plural(files.length, "file")} lint clean.`) : r.code === 1 ? fail(lastLine(r.stdout) || "ESLint found problems.") : error(lastLine(r.stderr || r.stdout))
    };
  }
};
var lwcTests = {
  name: "lwc-tests",
  heavy: true,
  about: "Jest tests related to changed LWC",
  plan({ root, changes }) {
    const files = changes.files.filter((f) => LWC.test(f));
    if (!files.length) return { outcome: skip("No LWC has changed.") };
    const bin = nodeBin(root, "sfdx-lwc-jest");
    if (!existsSync4(bin)) return { outcome: missingTool(root, "sfdx-lwc-jest") };
    return {
      cmd: bin,
      args: ["--", "--findRelatedTests", ...files, "--passWithNoTests"],
      read: (r) => r.code === 0 ? pass(lastLine(r.stderr.split("\n").filter((l3) => /^Tests:/.test(l3.trim())).join("\n")) || "Related tests passed.") : fail(lastLine(r.stderr.split("\n").filter((l3) => /^Tests:/.test(l3.trim())).join("\n")) || "Related tests failed.")
    };
  }
};
function readAnalyzer(file, severity, root) {
  try {
    const j2 = JSON.parse(readFileSync7(file, "utf8"));
    const all = j2.violations ?? [];
    const worst = all.filter((v) => (v.severity ?? 5) <= severity).map((v) => {
      const at2 = v.locations?.[v.primaryLocationIndex ?? 0];
      const where = at2?.file ? `${at2.file.startsWith(root) ? at2.file.slice(root.length + 1) : at2.file}${at2.startLine ? `:${at2.startLine}` : ""}` : "";
      return `${where} ${v.rule ?? "rule"} (sev ${v.severity}): ${(v.message ?? "").trim()}`.trim();
    });
    return { worst, total: all.length };
  } catch {
    return null;
  }
}
var staticGate = {
  name: "static",
  heavy: true,
  about: "Salesforce Code Analyzer on changed source",
  plan({ root, config, changes, scratch }) {
    const files = under(changes.files, packageDirs(root));
    if (!files.length) return { outcome: skip("No Salesforce source has changed.") };
    const severity = config.gates.severity;
    const results = join6(scratch, "code-analyzer.json");
    return {
      cmd: "sf",
      args: ["code-analyzer", "run", "--workspace", ".", ...files.flatMap((f) => ["--target", f]), "--severity-threshold", String(severity), "--view", "table", "--output-file", results],
      read(r) {
        const found = readAnalyzer(results, severity, root);
        if (!found) return error(lastLine(r.stderr || r.stdout) || `Code Analyzer exited with ${r.code} and wrote no results.`);
        if (found.worst.length) return fail(`${plural(found.worst.length, "violation")} at severity ${severity} or worse: ${listOf(found.worst, 2)}`, { violations: found.worst });
        if (r.code !== 0) return error(lastLine(r.stderr || r.stdout) || `Code Analyzer exited with ${r.code}.`);
        return pass(`No violations at severity ${severity} or worse${found.total ? ` (${plural(found.total, "milder one")})` : ""}.`);
      }
    };
  }
};
function validateArgs(org, source, tests) {
  return [
    "project",
    "deploy",
    "start",
    "--dry-run",
    "--target-org",
    org,
    "--wait",
    "60",
    "--ignore-conflicts",
    "--json",
    ...source.flatMap((f) => ["--source-dir", f]),
    "--test-level",
    tests.length ? "RunSpecifiedTests" : "NoTestRun",
    ...tests.flatMap((t) => ["--tests", t.name])
  ];
}
var asList = (x2) => x2 == null ? [] : Array.isArray(x2) ? x2 : [x2];
function readDeploy(r, org, tests, sourceCount) {
  let j2;
  try {
    j2 = parseJsonOutput(r.stdout);
  } catch {
    return error(lastLine(r.stderr || r.stdout) || `sf exited with ${r.code} and printed no JSON.`);
  }
  const res = j2.result ?? j2.data;
  if (!res?.id) return error(j2.message?.trim() || lastLine(r.stderr) || "sf returned no deploy result.");
  const details = { jobId: res.id, org, testLevel: tests.length ? "RunSpecifiedTests" : "NoTestRun", tests };
  const n = res.numberComponentsTotal ?? sourceCount;
  if (res.success) {
    const ran = tests.length ? `, ${plural(res.numberTestsCompleted ?? 0, "test")} passed` : "";
    return pass(`Validated ${plural(n, "component")} against ${org}${ran}. Nothing was saved (job ${res.id}).`, details);
  }
  const problems = [
    ...asList(res.details?.componentFailures).map((f) => `${f.fileName ?? f.fullName ?? "?"}${f.lineNumber ? `:${f.lineNumber}` : ""}: ${f.problem ?? "failed"}`),
    ...asList(res.details?.runTestResult?.failures).map((f) => `${f.name}.${f.methodName}: ${f.message}`)
  ];
  return fail(problems.length ? `${plural(problems.length, "problem")}: ${listOf(problems, 2)}` : j2.message?.trim() || `The validation ${res.status ?? "failed"}.`, { ...details, problems });
}
var validate = {
  name: "validate",
  heavy: true,
  about: "a check-only deploy of changed source to the environment's org",
  plan({ root, env, changes, tests }) {
    if (!env.org) return { outcome: error(`${env.name} has no org alias in .acc/config.json.`) };
    if (env.protected) return { outcome: error(`${env.name} is protected. Tasks are checked against their own environment, never a protected one.`) };
    if (changes.envSpecific.length) {
      return { outcome: fail(`This branch changes environment-specific files, which differ by design in every org and are never part of a task (D-016): ${listOf(changes.envSpecific)}. Undo those changes.`) };
    }
    if (changes.deleted.length) {
      return { outcome: fail(`Deletions (and renames) go to a person for now: ${listOf(changes.deleted)}. Restore them, or block the task and say what should be deleted.`) };
    }
    const source = under(changes.files, packageDirs(root));
    if (!source.length) return { outcome: skip("No Salesforce source has changed.") };
    const apex = source.filter((f) => APEX.test(f));
    if (apex.length && !tests.length) {
      return { outcome: fail(`Apex changed (${listOf(apex)}). Name the test classes that cover it: acc gate run validate --test <TestClass>="<why it covers the change>"`) };
    }
    return { cmd: "sf", args: validateArgs(env.org, source, tests), read: (r) => readDeploy(r, env.org, tests, source.length) };
  }
};
var SALESFORCE_GATES = [format, lint, staticGate, lwcTests, validate];
function gatesFor(config) {
  const heavy = (name) => config.gates.heavy.includes(name);
  const builtIn = config.profile === "salesforce" ? SALESFORCE_GATES.map((g) => ({ ...g, heavy: heavy(g.name) })) : [];
  const custom = Object.entries(config.gates.commands).map(([name, cmd]) => commandGate(name, cmd, heavy(name)));
  return [...builtIn.filter((g) => !config.gates.commands[g.name]), ...custom];
}
function priorTests(paths, config, sha) {
  if (config.profile !== "salesforce") return [];
  const tests = readReceipt(paths, sha, "validate")?.details?.tests;
  return Array.isArray(tests) ? tests.filter((t) => typeof t?.name === "string" && typeof t?.reason === "string") : [];
}
function readList(root, rel) {
  if (!rel) return [];
  try {
    return readFileSync7(join6(root, rel), "utf8").split("\n").map((l3) => l3.trim()).filter((l3) => l3 && !l3.startsWith("#"));
  } catch {
    return [];
  }
}
var listed = (path, list) => list.some((p) => path === p || path.startsWith(`${p.replace(/\/+$/, "")}/`));
var git = (run2, root, args) => run2("git", args, { cwd: root });
function baseFor(run2, root, env) {
  for (const ref of [`origin/${env.branch}`, env.branch]) {
    if (git(run2, root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).code !== 0) continue;
    const mb = git(run2, root, ["merge-base", "HEAD", ref]);
    if (mb.code === 0 && mb.stdout.trim()) return mb.stdout.trim();
  }
  throw new AccError("no-base", `There's no ${env.branch} or origin/${env.branch} branch here to compare with.`);
}
function changesFor(run2, root, config, env) {
  const base = baseFor(run2, root, env);
  const r = git(run2, root, ["diff", "--name-status", "--no-renames", "-z", base, "HEAD"]);
  if (r.code !== 0) throw new AccError("git", `git diff failed: ${lastLine(r.stderr)}`);
  const parts = r.stdout.split("\0").filter(Boolean);
  const specific = readList(root, config.environmentSpecific);
  const files = [];
  const deleted = [];
  const envSpecific = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, path] = [parts[i], parts[i + 1]];
    if (listed(path, specific)) envSpecific.push(path);
    else if (status.startsWith("D")) deleted.push(path);
    else files.push(path);
  }
  return { base, files, deleted, envSpecific };
}
function gateTarget(config, ledger, branch, opts) {
  const byName = (name) => config.environments.find((e) => e.branch === name.toLowerCase() || e.name.toLowerCase() === name.toLowerCase());
  const taskById = opts.task ? ledger.tasks.find((t) => t.id === opts.task.toUpperCase()) : void 0;
  if (opts.task && !taskById) throw new AccError("no-task", `No task ${opts.task}.`);
  const task = taskById ?? (branch ? ledger.tasks.find((t) => t.run?.branch === branch) : void 0) ?? null;
  if (opts.env) {
    const env2 = byName(opts.env);
    if (!env2) throw new AccError("usage", `No environment "${opts.env}". The config has: ${config.environments.map((e) => e.branch).join(", ")}.`);
    return { env: env2, task };
  }
  const env = task && byName(task.environment) || branch && byName(branch) || (config.environments.length === 1 ? config.environments[0] : void 0);
  if (!env) throw new AccError("usage", `This branch${branch ? ` (${branch})` : ""} isn't a task's or an environment's. Name the environment to check against: --env <${config.environments.map((e) => e.branch).join("|")}>`);
  return { env, task };
}
function assertCheckOnly(cmd, args) {
  const i = args.indexOf("deploy");
  if (/(^|\/)sf$/.test(cmd) && i >= 0 && args[i + 1] !== "validate" && !args.includes("--dry-run")) {
    throw new AccError("refused", `A gate tried to run a real deploy (${[cmd, ...args.slice(0, 4)].join(" ")} \u2026). Gates only validate.`);
  }
}
var niced = (cmd, args) => process.platform === "win32" ? [cmd, args] : ["nice", ["-n", "15", cmd, ...args]];
function runGates(paths, config, env, names2, tests, deps) {
  const root = paths.root;
  const all = gatesFor(config);
  const wanted = names2.length ? names2 : config.gates.required.length ? config.gates.required : all.map((g) => g.name);
  const unknownNames = wanted.filter((n) => !all.some((g) => g.name === n));
  if (unknownNames.length) {
    const known = all.map((g) => g.name).join(", ") || "none yet";
    throw new AccError("usage", `No gate ${unknownNames.join(", ")}. This project's gates: ${known}.${config.profile === "generic" ? ' Add commands under "gates.commands" in .acc/config.json.' : ""}`);
  }
  const head = git(deps.run, root, ["rev-parse", "HEAD"]);
  if (head.code !== 0) throw new AccError("git", "This checkout has no commit to check yet.");
  const sha = head.stdout.trim();
  const dirty = git(deps.run, root, ["status", "--porcelain"]).stdout.trim() !== "";
  let changes = null;
  try {
    changes = changesFor(deps.run, root, config, env);
  } catch (e) {
    if (config.profile === "salesforce") throw e;
  }
  const input = {
    root,
    config,
    env,
    tests,
    changes: changes ?? { base: sha, files: [], deleted: [], envSpecific: [] },
    scratch: join6(paths.logs, "gates", sha)
  };
  mkdirSync7(input.scratch, { recursive: true });
  const results = [];
  for (const name of wanted) {
    const gate = all.find((g) => g.name === name);
    const kept = readReceipt(paths, sha, gate.name);
    if (kept?.waived) {
      results.push({ status: "skip", summary: kept.summary, gate: gate.name, recorded: true, receipt: kept });
      continue;
    }
    deps.onStart?.(gate);
    const started = deps.now();
    const plan = gate.plan(input);
    let outcome;
    let command = null;
    let log = null;
    if ("outcome" in plan) {
      outcome = plan.outcome;
    } else {
      assertCheckOnly(plan.cmd, plan.args);
      command = shellLine(plan.cmd, plan.args);
      const [cmd, args] = niced(plan.cmd, plan.args);
      const exec = () => deps.run(cmd, args, { cwd: root, timeoutMs: (gate.heavy ? 90 : 20) * 6e4, env: plan.cmd === "sf" ? sfEnv() : checkEnv(process.env, gate.heavy ? join6(input.scratch, "heavy") : void 0) });
      const r = gate.heavy ? withSlot(exec, { ...deps.slots, onWait: () => deps.onWait?.(gate) }) : exec();
      log = join6(input.scratch, `${gate.name}.log`);
      writeFileSync7(log, `$ ${command}
# exit ${r.code}

${r.stdout}${r.stderr ? `
--- stderr ---
${r.stderr}` : ""}`);
      outcome = (plan.read ?? exitRead)(r);
    }
    const finished = deps.now();
    const receipt = {
      gate: gate.name,
      sha,
      env: env.branch,
      status: outcome.status,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      summary: outcome.summary,
      command,
      log,
      ...outcome.details ? { details: outcome.details } : {}
    };
    if (!dirty) writeReceipt(paths, receipt);
    results.push({ ...outcome, gate: gate.name, recorded: !dirty, receipt });
  }
  return { sha, env, dirty, changes, results };
}
function waiveGates(paths, config, req) {
  const all = gatesFor(config);
  const reason = req.reason.trim();
  if (!reason) throw new AccError("usage", `Say why it's waived: acc gate waive <gate> --reason "<why>". The reason is kept with the commit's checks.`);
  if (!req.gates.length) throw new AccError("usage", `Name the gates to waive. This project's gates: ${all.map((g) => g.name).join(", ") || "none"}.`);
  const unknown2 = req.gates.filter((n) => !all.some((g) => g.name === n));
  if (unknown2.length) throw new AccError("usage", `No gate ${unknown2.join(", ")}. This project's gates: ${all.map((g) => g.name).join(", ")}.`);
  const at2 = req.now().toISOString();
  const out2 = [];
  for (const gate of [...new Set(req.gates)]) {
    const before = readReceipt(paths, req.sha, gate);
    if (before?.status === "pass") throw new AccError("refused", `${gate} already passes on ${req.sha.slice(0, 7)}, so there's nothing to waive.`);
    const was = before?.waived ? before.waived.was : before?.status ?? null;
    const wasSummary = before?.waived ? before.waived.wasSummary : before?.summary ?? null;
    const receipt = {
      gate,
      sha: req.sha,
      env: req.env.branch,
      status: "skip",
      startedAt: at2,
      finishedAt: at2,
      durationMs: 0,
      summary: `Waived by ${req.by.replace(/^human:/, "")}: ${reason}`,
      command: null,
      log: before?.log ?? null,
      ...before?.details ? { details: before.details } : {},
      waived: { by: req.by, reason, at: at2, was, wasSummary }
    };
    writeReceipt(paths, receipt);
    out2.push(receipt);
  }
  return out2;
}

// packages/core/src/drift.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync8, rmSync as rmSync4, writeFileSync as writeFileSync8 } from "node:fs";
import { join as join7 } from "node:path";
var BASELINE_MANIFEST = "manifest/baseline-package.xml";
function environmentNamed(config, name) {
  const env = config.environments.find((e) => e.branch === name.toLowerCase() || e.name.toLowerCase() === name.toLowerCase());
  if (!env) throw new AccError("usage", `No environment "${name}". The config has: ${config.environments.map((e) => e.branch).join(", ")}.`);
  return env;
}
var driftReportPath = (paths, branch) => join7(paths.stateDir, "drift", `${branch}.json`);
var FOLDER = {
  ApexClass: "classes",
  ApexTrigger: "triggers",
  ApexPage: "pages",
  ApexComponent: "components",
  CustomObject: "objects",
  CustomField: "fields",
  ListView: "listViews",
  RecordType: "recordTypes",
  ValidationRule: "validationRules",
  WebLink: "webLinks",
  CompactLayout: "compactLayouts",
  FieldSet: "fieldSets",
  BusinessProcess: "businessProcesses",
  Flow: "flows",
  ContentAsset: "contentassets",
  ReportType: "reportTypes",
  Layout: "layouts",
  PermissionSet: "permissionsets",
  Profile: "profiles",
  CustomTab: "tabs",
  CustomApplication: "applications",
  QuickAction: "quickActions",
  FlexiPage: "flexipages",
  StaticResource: "staticresources",
  LightningComponentBundle: "lwc",
  AuraDefinitionBundle: "aura",
  EmailTemplate: "email",
  Report: "reports",
  Dashboard: "dashboards",
  GlobalValueSet: "globalValueSets",
  StandardValueSet: "standardValueSets",
  CustomMetadata: "customMetadata",
  CustomLabels: "labels"
};
function filesFor(type, fullName, tracked) {
  const parts = fullName.split(".");
  const name = parts.pop();
  const folder = FOLDER[type];
  return tracked.filter((f) => {
    const segs = f.split("/");
    const base = segs.at(-1);
    const inBundle = segs.at(-2) === name && (type === "LightningComponentBundle" || type === "AuraDefinitionBundle");
    if (!base.startsWith(`${name}.`) && !inBundle) return false;
    if (folder && !segs.includes(folder)) return false;
    return parts.every((p) => segs.includes(p));
  });
}
function failures(stdout) {
  let files = [];
  try {
    files = parseJsonOutput(stdout).result?.files ?? [];
  } catch {
    files = [];
  }
  const failed = files.filter((f) => f.state === "Failed");
  const isAbsent = (f) => /cannot be found/i.test(f.error ?? "");
  return {
    lacking: failed.filter(isAbsent).map((f) => ({ type: f.type ?? "", fullName: f.fullName ?? "" })),
    other: failed.filter((f) => !isAbsent(f)).map((f) => `${f.type && f.fullName ? `${f.type}:${f.fullName}: ` : ""}${(f.error ?? "failed").trim()}`)
  };
}
function statusOf(run2, dir) {
  const r = run2("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: dir });
  if (r.code !== 0) throw new AccError("git", `git status failed in the drift worktree: ${lastLine(r.stderr)}`);
  const changed = [];
  const added = [];
  for (const entry of r.stdout.split("\0").filter(Boolean)) {
    const [code, path] = [entry.slice(0, 2), entry.slice(3)];
    (code === "??" ? added : changed).push(path);
  }
  return { changed, added };
}
function drift(paths, config, envName, deps, opts = {}) {
  if (config.profile !== "salesforce") throw new AccError("usage", "acc drift compares a Salesforce org with its branch. This project has no orgs.");
  const env = environmentNamed(config, envName);
  if (!env.org) throw new AccError("usage", `${env.name} has no org alias in .acc/config.json.`);
  const manifest = opts.manifest ?? BASELINE_MANIFEST;
  const git9 = (args, cwd = paths.root) => deps.run("git", args, { cwd });
  if (git9(["remote", "get-url", "origin"]).code === 0) git9(["fetch", "--quiet", "origin", env.branch]);
  const ref = [`origin/${env.branch}`, env.branch].find((r) => git9(["rev-parse", "--verify", "--quiet", `${r}^{commit}`]).code === 0);
  if (!ref) throw new AccError("no-base", `There's no ${env.branch} or origin/${env.branch} branch to compare ${env.name} with.`);
  const base = git9(["rev-parse", ref]).stdout.trim();
  if (git9(["cat-file", "-e", `${base}:${manifest}`]).code !== 0) throw new AccError("usage", `${ref} has no ${manifest}. Make the baseline manifest first (ONBOARDING.md, B5), or pass --manifest.`);
  const dir = join7(paths.stateDir, "drift", `${env.branch}-${deps.now().getTime()}`);
  mkdirSync8(join7(paths.stateDir, "drift"), { recursive: true });
  const add = git9(["worktree", "add", "--detach", "--quiet", dir, base]);
  if (add.code !== 0) throw new AccError("git", `Couldn't make a throwaway worktree: ${lastLine(add.stderr)}`);
  try {
    const args = ["project", "retrieve", "start", "--manifest", manifest, "--target-org", env.org, "--ignore-conflicts", "--wait", "60", "--json"];
    const retrieve = () => deps.run(...niced("sf", args), { cwd: dir, timeoutMs: 70 * 6e4, env: sfEnv() });
    const r = withSlot(retrieve, { ...deps.slots, onWait: deps.onWait });
    const log = join7(paths.logs, "drift", `${env.branch}.log`);
    mkdirSync8(join7(paths.logs, "drift"), { recursive: true });
    writeFileSync8(log, `$ ${shellLine("sf", args)}
# exit ${r.code}

${r.stdout}${r.stderr ? `
--- stderr ---
${r.stderr}` : ""}`);
    let status;
    let message = "";
    try {
      const j2 = parseJsonOutput(r.stdout);
      status = j2.status;
      message = j2.message ?? "";
    } catch {
      status = void 0;
    }
    if (r.code !== 0 || status !== 0) throw new AccError("sf", `The retrieve from ${env.org} failed: ${message.trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`}. The full output is in ${log}`);
    const expected = [...readList(dir, config.knownDrift), ...readList(dir, config.environmentSpecific)];
    const found = statusOf(deps.run, dir);
    const source = packageDirs(dir);
    found.changed = under(found.changed, source);
    found.added = under(found.added, source);
    const keep = (p) => !listed(p, expected);
    const changed = found.changed.filter(keep);
    const added = found.added.filter(keep);
    const { lacking, other } = failures(r.stdout);
    const tracked = under(git9(["ls-files"], dir).stdout.split("\n").filter(Boolean), source);
    const lackingFiles = [...new Set(lacking.flatMap((c) => filesFor(c.type, c.fullName, tracked)))].sort();
    const missing = lackingFiles.filter(keep);
    const result = {
      env: env.branch,
      org: env.org,
      base,
      changed,
      added,
      missing,
      unretrievable: other,
      ignored: found.changed.length + found.added.length + lackingFiles.length - changed.length - added.length - missing.length,
      checkedAt: deps.now().toISOString(),
      kept: opts.keep ? dir : null
    };
    writeFileSync8(driftReportPath(paths, env.branch), JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally {
    if (!opts.keep) {
      git9(["worktree", "remove", "--force", dir]);
      if (existsSync5(dir)) rmSync4(dir, { recursive: true, force: true });
      git9(["worktree", "prune"]);
    }
  }
}

// node_modules/marked/lib/marked.esm.js
function I() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var y = I();
function W(l3) {
  y = l3;
}
var A = { exec: () => null };
function C(l3) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
    return s || (s = l3(n), e[n] = s), s;
  };
}
function h(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (s, r) => {
    let o = typeof r == "string" ? r : r.source;
    return o = o.replace(x.caret, "$1"), t = t.replace(s, o), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var _e = ((l3 = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l3);
  } catch {
    return false;
  }
})();
var x = { codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, endingSpaceTabChar: /[ \t]$/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, leadingSpaceTab: /^[ \t]+/, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/g, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: C((l3) => new RegExp(`^ {0,${l3}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)), fencesBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:\`\`\`|~~~)`)), headingBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}#`)), htmlBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:</?(?:${N})(?: +|$|/?>)|<(?:script|pre|style|textarea|!--))`, "i")), blockquoteBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}>`)) };
var $e = /^(?:[ \t]*(?:\n|$))+/;
var Le = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ze = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var G = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Ae = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var J = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var ce = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var he = h(ce).replace(/bull/g, J).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Ee = h(ce).replace(/bull/g, J).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var V = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var Me = /^[^\n]+/;
var Y = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Ie = h(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", Y).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var Ce = h(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, J).getRegex();
var N = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var ee = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var Be = h("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ee).replace("tag", N).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var de = (l3) => h(V).replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", l3).replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex();
var De = de(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var qe = de(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var ve = h(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", qe).getRegex();
var te = { blockquote: ve, code: Le, def: Ie, fences: ze, heading: Ae, hr: G, html: Be, lheading: he, list: Ce, newline: $e, paragraph: De, table: A, text: Me };
var le = h("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex();
var Ze = { ...te, lheading: Ee, table: le, paragraph: h(V).replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", le).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex() };
var He = { ...te, html: h(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", ee).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: A, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: h(V).replace("hr", G).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", he).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Ge = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ne = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ke = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
var Qe = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var $ = /[\p{P}\p{S}]/u;
var B = /[\s\p{P}\p{S}]/u;
var Q = /[^\s\p{P}\p{S}]/u;
var je = h(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, B).getRegex();
var Fe = /[\p{Pi}\p{Ps}"']/u;
var ge = /(?!~)[\p{P}\p{S}]/u;
var Ue = /(?!~)[\s\p{P}\p{S}]/u;
var Ke = /(?:[^\s\p{P}\p{S}]|~)/u;
var We = h(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", _e ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var fe = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Xe = h(fe, "u").replace(/punct/g, $).getRegex();
var Je = h(fe, "u").replace(/punct/g, ge).getRegex();
var Ve = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
var Ye = h(Ve, "u").replace(/openQuote/g, Fe).replace(/punct/g, $).getRegex();
var me = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var et = h(me, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var tt = h(me, "gu").replace(/notPunctSpace/g, Ke).replace(/punctSpace/g, Ue).replace(/punct/g, ge).getRegex();
var nt = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
var rt = h(nt, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var st = h("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var it = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
var ot = h(it, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var at = h(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, $).getRegex();
var lt = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var ut = h(lt, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var pt = h(/\\(punct)/, "gu").replace(/punct/g, $).getRegex();
var ct = h(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var ht = h(ee).replace("(?:-->|$)", "-->").getRegex();
var dt = h("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", ht).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var xe = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
var U = h(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", xe).getRegex();
var kt = h(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", U).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var gt = h(/^!?\[(label)\]\[(ref)\]/).replace("label", U).replace("ref", Y).getRegex();
var ft = h(/^!?\[(ref)\](?:\[\])?/).replace("ref", Y).getRegex();
var ue = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
var mt = h(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", xe).getRegex();
var xt = h("reflink|nolink(?!\\()", "g").replace("reflink", h(/^!?\[(label)\]\[(ref)\]/).replace("label", mt).replace("ref", ue).getRegex()).replace("nolink", h(/^!?\[(ref)\](?:\[\])?/).replace("ref", ue).getRegex()).getRegex();
var pe = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var bt = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
var Rt = h(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, bt).getRegex();
var ne = { _backpedal: A, anyPunctuation: pt, autolink: ct, blockSkip: We, br: ke, code: Ne, del: A, delLDelim: A, delRDelim: A, emStrongLDelim: Xe, emStrongRDelimAst: et, emStrongRDelimUnd: st, escape: Ge, link: kt, nolink: ft, punctuation: je, reflink: gt, reflinkSearch: xt, tag: dt, text: Qe, url: A };
var Tt = { ...ne, emStrongLDelim: Ye, emStrongRDelimAst: rt, emStrongRDelimUnd: ot, link: h(/^!?\[(label)\]\((.*?)\)/).replace("label", U).getRegex(), reflink: h(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", U).getRegex() };
var X = { ...ne, emStrongRDelimAst: tt, emStrongLDelim: Je, delLDelim: at, delRDelim: ut, url: h(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", Rt).replace("protocol", pe).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: h(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", pe).replace(/emailProtocol/g, /(?:mailto|xmpp):/).getRegex() };
var Ot = { ...X, br: h(ke).replace("{2,}", "*").getRegex(), text: h(X.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var j = { normal: te, gfm: Ze, pedantic: He };
var D = { normal: ne, gfm: X, breaks: Ot, pedantic: Tt };
var wt = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var be = (l3) => wt[l3];
function O(l3, e) {
  if (e) {
    if (x.escapeTest.test(l3)) return l3.replace(x.escapeReplace, be);
  } else if (x.escapeTestNoEncode.test(l3)) return l3.replace(x.escapeReplaceNoEncode, be);
  return l3;
}
function Re(l3) {
  return l3.replace(x.numericCharacterReference, (e, t, n) => {
    let s = t === void 0 ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
    return s === 0 || s > 1114111 || s >= 55296 && s <= 57343 ? "\uFFFD" : String.fromCodePoint(s);
  });
}
function re(l3) {
  try {
    l3 = encodeURI(l3).replace(x.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function se(l3, e) {
  let t = l3.replace(x.findPipe, (r, o, i) => {
    let u = false, a = o;
    for (; --a >= 0 && i[a] === "\\"; ) u = !u;
    return u ? "|" : " |";
  }), n = t.split(x.splitPipe), s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; s < n.length; s++) n[s] = n[s].trim().replace(x.slashPipe, "|");
  return n;
}
function L(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let s = 0;
  for (; s < n; ) {
    let r = l3.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return l3.slice(0, n - s);
}
function ie(l3) {
  let e = l3.split(`
`), t = e.length - 1;
  for (; t >= 0 && x.blankLine.test(e[t]); ) t--;
  return e.length - t <= 2 ? l3 : e.slice(0, t + 1).join(`
`);
}
function q(l3) {
  return l3.trim().toLowerCase().toUpperCase().toLowerCase();
}
function Te(l3, e) {
  if (l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function oe(l3, e = 0) {
  let t = e, n = "";
  for (let s of l3) if (s === "	") {
    let r = 4 - t % 4;
    n += " ".repeat(r), t += r;
  } else n += s, t++;
  return n;
}
function Oe(l3, e, t, n, s) {
  let r = e.href, o = e.title || null, i = l3[1].replace(s.other.outputLinkReplace, "$1"), u = l3[0].charAt(0) === "!";
  n.state.inLink = true;
  let a = n.state.linkEmitted, p = n.state.inRawBlock;
  n.state.linkEmitted = false;
  let c = n.inlineTokens(i), d = n.state.linkEmitted;
  if (n.state.linkEmitted = a, n.state.inLink = false, !u) {
    if (d) {
      n.state.inRawBlock = p;
      return;
    }
    n.state.linkEmitted = true;
  }
  return { type: u ? "image" : "link", raw: t, href: r, title: o, text: i, tokens: c };
}
function yt(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let s = n[1];
  return e.split(`
`).map((r) => {
    let o = r.match(t.other.beginningSpace);
    if (o === null) return r;
    let [i] = o;
    return r.slice(Math.min(i.length, s.length));
  }).join(`
`);
}
function we(l3, e, t, n) {
  if (!e.includes("<")) return false;
  for (let s = 0; s < e.length; s++) {
    if (e[s] === "\\") {
      s++;
      continue;
    }
    if (e[s] === "`") {
      let i = n.inline.code.exec(e.slice(s));
      if (i) {
        s += i[0].length - 1;
        continue;
      }
    }
    if (e[s] !== "<") continue;
    let r = l3.slice(t + s), o = n.inline.tag.exec(r) || n.inline.autolink.exec(r);
    if (o) {
      if (o[0].length > e.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}
var P = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || y;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : ie(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], s = yt(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let s = L(n, "#");
        (this.options.pedantic || !s || this.rules.other.endingSpaceTabChar.test(s)) && (n = s.trim());
      }
      return { type: "heading", raw: L(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: L(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = L(t[0], `
`).split(`
`), s = "", r = "", o = [];
      for (; n.length > 0; ) {
        let i = false, u = [], a;
        for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) u.push(n[a]), i = true;
        else if (!i) u.push(n[a]);
        else break;
        n = n.slice(a);
        let p = u.join(`
`), c = p.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        s = s ? `${s}
${p}` : p, r = r ? `${r}
${c}` : c;
        let d = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, o, true), this.lexer.state.top = d, n.length === 0) break;
        let m = o.at(-1);
        if (m?.type === "code") break;
        if (m?.type === "blockquote") {
          let b = m, g = n.join(`
`), w = b.raw + `
` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), f = this.blockquote(w);
          o[o.length - 1] = f;
          let M = w.substring(f.raw.length).replace(/^\n/, ""), v = M ? M.split(`
`).length : 0, Z = v ? n.slice(0, -v) : n;
          Z.length > 0 && (s = `${s}
${Z.join(`
`)}`), r = r.substring(0, r.length - b.text.length) + f.text;
          break;
        } else if (m?.type === "list") {
          let b = m, g = b.raw + `
` + n.join(`
`), w = this.list(g);
          o[o.length - 1] = w, s = s.substring(0, s.length - m.raw.length) + w.raw, r = r.substring(0, r.length - b.raw.length) + w.raw, n = g.substring(o.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: s, tokens: o, text: r };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), s = n.length > 1, r = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
      let o = this.rules.other.listItemRegex(n), i = false;
      for (; e; ) {
        let a = false, p = "", c = "";
        if (!(t = o.exec(e)) || this.rules.block.hr.test(e)) break;
        p = t[0], e = e.substring(p.length);
        let d = t[2].split(`
`, 1)[0], m = t[1].length, b = this.options.pedantic ? oe(d, m) : d.replace(this.rules.other.leadingSpaceTab, (M) => oe(M, m)), g = e.split(`
`, 1)[0], w = !b.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, c = b.trimStart()) : w ? f = m + 1 : (f = b.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, c = b.slice(f), f += m), w && this.rules.other.blankLine.test(g) && (p += g + `
`, e = e.substring(g.length + 1), a = true), !a) {
          let M = this.rules.other.nextBulletRegex(f), v = this.rules.other.hrRegex(f), Z = this.rules.other.fencesBeginRegex(f), ae = this.rules.other.headingBeginRegex(f), ye = this.rules.other.htmlBeginRegex(f), Pe = this.rules.other.blockquoteBeginRegex(f);
          for (; e; ) {
            let K = e.split(`
`, 1)[0], H;
            if (g = K, this.options.pedantic ? (g = g.replace(this.rules.other.listReplaceNesting, "  "), H = g) : H = g.replace(this.rules.other.leadingSpaceTab, (Se) => Se.replace(this.rules.other.tabCharGlobal, "    ")), Z.test(g) || ae.test(g) || ye.test(g) || Pe.test(g) || M.test(g) || v.test(g)) break;
            if (H.search(this.rules.other.nonSpaceChar) >= f || !g.trim()) c += `
` + H.slice(f);
            else {
              if (w || b.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || Z.test(b) || ae.test(b) || v.test(b)) break;
              c += `
` + g;
            }
            w = !g.trim(), p += K + `
`, e = e.substring(K.length + 1), b = H.slice(f);
          }
        }
        r.loose || (i ? r.loose = true : this.rules.other.doubleBlankLine.test(p) && (i = true)), r.items.push({ type: "list_item", raw: p, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), r.raw += p;
      }
      let u = r.items.at(-1);
      if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
      else return;
      r.raw = r.raw.trimEnd();
      for (let a of r.items) if (this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []), !r.loose) {
        let p = a.tokens.filter((d) => d.type === "space"), c = p.length > 0 && p.some((d) => this.rules.other.anyLine.test(d.raw));
        r.loose = c;
      }
      for (let a of r.items) {
        let p = a.tokens[0];
        if (a.task && (p?.type === "text" || p?.type === "paragraph")) {
          a.text = a.text.replace(this.rules.other.listReplaceTask, ""), p.raw = p.raw.replace(this.rules.other.listReplaceTask, ""), p.text = p.text.replace(this.rules.other.listReplaceTask, "");
          for (let d = this.lexer.inlineQueue.length - 1; d >= 0; d--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[d].src)) {
            this.lexer.inlineQueue[d].src = this.lexer.inlineQueue[d].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let c = this.rules.other.listTaskCheckbox.exec(a.raw);
          if (c) {
            let d = { type: "checkbox", raw: c[0] + " ", checked: c[0] !== "[ ]" };
            a.checked = d.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = d.raw + a.tokens[0].raw, a.tokens[0].text = d.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(d)) : a.tokens.unshift({ type: "paragraph", raw: d.raw, text: d.raw, tokens: [d] }) : a.tokens.unshift(d);
          }
        } else a.task && (a.task = false);
      }
      if (r.loose) for (let a of r.items) {
        a.loose = true;
        for (let p of a.tokens) p.type === "text" && (p.type = "paragraph");
      }
      return r;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = ie(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = q(t[1]).replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: L(t[0], `
`), href: s, title: r };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = se(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o = { type: "table", raw: L(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === s.length) {
      for (let i of s) this.rules.other.tableAlignRight.test(i) ? o.align.push("right") : this.rules.other.tableAlignCenter.test(i) ? o.align.push("center") : this.rules.other.tableAlignLeft.test(i) ? o.align.push("left") : o.align.push(null);
      for (let i = 0; i < n.length; i++) o.header.push({ text: n[i], tokens: this.lexer.inline(n[i]), header: true, align: o.align[i] });
      for (let i of r) o.rows.push(se(i, o.header.length).map((u, a) => ({ text: u, tokens: this.lexer.inline(u), header: false, align: o.align[a] })));
      return o;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: L(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && we(e, t[1], n, this.rules)) return;
      let s = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(s)) {
        if (!this.rules.other.endAngleBracket.test(s)) return;
        let i = L(s.slice(0, -1), "\\");
        if ((s.length - i.length) % 2 === 0) return;
      } else {
        let i = Te(t[2], "()");
        if (i === -2) return;
        if (i > -1) {
          let a = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
          t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, a).trim(), t[3] = "";
        }
      }
      let r = t[2], o = "";
      if (this.options.pedantic) {
        let i = this.rules.other.pedanticHrefTitle.exec(r);
        i && (r = i[1], o = i[3]);
      } else o = t[3] ? t[3].slice(1, -1) : "";
      return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(s) ? r = r.slice(1) : r = r.slice(1, -1)), Oe(t, { href: r && r.replace(this.rules.inline.anyPunctuation, "$1"), title: o && o.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let s = n[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && we(e, n[1], s, this.rules)) return;
      let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), o = t[q(r)];
      if (!o) {
        let i = n[0].charAt(0);
        return { type: "text", raw: i, text: i };
      }
      return Oe(n, o, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let s = this.rules.inline.emStrongLDelim.exec(e);
    if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...s[0]].length - 1, i, u, a = o, p = 0, c = s[0][0], d = n === c, m = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (m.lastIndex = 0, t = t.slice(-1 * e.length + o); (s = m.exec(t)) !== null; ) {
        if (i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !i) continue;
        if (u = [...i].length, s[3] || s[4]) {
          a += u;
          continue;
        } else if (s[5] || s[6]) {
          if (o % 3 && !((o + u) % 3)) {
            p += u;
            continue;
          }
          if (d) break;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a + p);
        let b = [...s[0]][0].length, g = e.slice(0, o + s.index + b + u);
        if (Math.min(o, u) % 2) {
          let f = g.slice(1, -1);
          return { type: "em", raw: g, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let w = g.slice(2, -2);
        return { type: "strong", raw: g, text: w, tokens: this.lexer.inlineTokens(w) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return s && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let s = this.rules.inline.delLDelim.exec(e);
    if (!s) return;
    if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...s[0]].length - 1, i, u, a = o, p = this.rules.inline.delRDelim;
      for (p.lastIndex = 0, t = t.slice(-1 * e.length + o); (s = p.exec(t)) !== null; ) {
        if (i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !i || (u = [...i].length, u !== o)) continue;
        if (s[3] || s[4]) {
          a += u;
          continue;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a);
        let c = [...s[0]][0].length, d = e.slice(0, o + s.index + c + u), m = d.slice(o, -o);
        return { type: "del", raw: d, text: m, tokens: this.lexer.inlineTokens(m) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, s;
      return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, s;
      if (t[2] === "@") n = t[0], s = "mailto:" + n;
      else {
        let r;
        do
          r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r !== t[0]);
        n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: s, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: n ? t[0] : Re(t[0]), escaped: n };
    }
  }
};
var R = class l {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || y, this.options.tokenizer = this.options.tokenizer || new P(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, linkEmitted: false, top: true };
    let t = { other: x, block: j.normal, inline: D.normal };
    this.options.pedantic ? (t.block = j.pedantic, t.inline = D.pedantic) : this.options.gfm && (t.block = j.gfm, this.options.breaks ? t.inline = D.breaks : t.inline = D.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: j, inline: D };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(x.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(x.tabCharGlobal, "    ").replace(x.spaceLine, ""));
    let s = 1 / 0;
    for (; e; ) {
      if (e.length < s) s = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r;
      if (this.options.extensions?.block?.some((i) => (r = i.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        r.raw.length === 1 && i !== void 0 ? i.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.at(-1).src = i.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.raw, this.inlineQueue.at(-1).src = i.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let o = e;
      if (this.options.extensions?.startBlock) {
        let i = 1 / 0, u = e.slice(1), a;
        this.options.extensions.startBlock.forEach((p) => {
          a = p.call({ lexer: this }, u), typeof a == "number" && a >= 0 && (i = Math.min(i, a));
        }), i < 1 / 0 && i >= 0 && (o = e.substring(0, i + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(o))) {
        let i = t.at(-1);
        n && i?.type === "paragraph" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r), n = o.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let i = t.at(-1);
        i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  linkInText(e) {
    if (!e.includes("[")) return false;
    let t = this.tokenizer.rules.inline.link;
    for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return true;
    for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
      let s = n[0], r = s.lastIndexOf("[");
      if (!(s.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, q(s.slice(r + 1, -1)))) && !(r > 1 && this.linkInText(s.slice(1, r - 1)))) return true;
    }
    return false;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e;
    if (this.tokens.links && e.includes("[")) {
      let i = this.tokenizer.rules.inline.reflinkSearch, u = (a) => {
        let p = a.lastIndexOf("[");
        if (!Object.hasOwn(this.tokens.links, q(a.slice(p + 1, -1)))) return a;
        if (p > 1 && a.charAt(0) !== "!") {
          let c = a.slice(1, p - 1);
          if (this.linkInText(c)) return "[" + c.replace(i, u) + "][" + "a".repeat(a.length - p - 2) + "]";
        }
        return "[" + "a".repeat(a.length - 2) + "]";
      };
      n = n.replace(i, u);
    }
    n = n.replace(this.tokenizer.rules.inline.anyPunctuation, (i) => "+".repeat(i.length)), n = n.replace(this.tokenizer.rules.inline.blockSkip, (i, u, a) => {
      let p = a ? a.length : 0;
      return i.slice(0, p) + "[" + "a".repeat(i.length - p - 2) + "]";
    }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, r = "", o = 1 / 0;
    for (; e; ) {
      if (e.length < o) o = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      s || (r = ""), s = false;
      let i;
      if (this.options.extensions?.inline?.some((a) => (i = a.call({ lexer: this }, e, t)) ? (e = e.substring(i.raw.length), t.push(i), true) : false)) continue;
      if (i = this.tokenizer.escape(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.tag(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.link(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(i.raw.length);
        let a = t.at(-1);
        i.type === "text" && a?.type === "text" ? (a.raw += i.raw, a.text += i.text) : t.push(i);
        continue;
      }
      if (i = this.tokenizer.emStrong(e, n, r)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.codespan(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.br(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.del(e, n, r)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.autolink(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (!this.state.inLink && (i = this.tokenizer.url(e))) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      let u = e;
      if (this.options.extensions?.startInline) {
        let a = 1 / 0, p = e.slice(1), c;
        this.options.extensions.startInline.forEach((d) => {
          c = d.call({ lexer: this }, p), typeof c == "number" && c >= 0 && (a = Math.min(a, c));
        }), a < 1 / 0 && a >= 0 && (u = e.substring(0, a + 1));
      }
      if (i = this.tokenizer.inlineText(u)) {
        e = e.substring(i.raw.length), i.raw.slice(-1) !== "_" && (r = i.raw.slice(-1)), s = true;
        let a = t.at(-1);
        a?.type === "text" ? (a.raw += i.raw, a.text += i.text) : t.push(i);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent) console.error(t);
    else throw new Error(t);
  }
};
var S = class {
  options;
  parser;
  constructor(e) {
    this.options = e || y;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let s = (t || "").match(x.notSpaceStart)?.[0], r = e ? e.replace(x.endingNewline, "") + `
` : "";
    return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r : O(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : O(r, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, s = "";
    for (let i = 0; i < e.items.length; i++) {
      let u = e.items[i];
      s += this.listitem(u);
    }
    let r = t ? "ol" : "ul", o = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r + o + `>
` + s + "</" + r + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
    t += this.tablerow({ text: n });
    let s = "";
    for (let r = 0; r < e.rows.length; r++) {
      let o = e.rows[r];
      n = "";
      for (let i = 0; i < o.length; i++) n += this.tablecell(o[i]);
      s += this.tablerow({ text: n });
    }
    return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, text: n, tokens: s, autolink: r }) {
    let o = r ? O(n, true) : this.parser.parseInline(s), i = re(e);
    if (i === null) return o;
    e = O(i, r);
    let u = '<a href="' + e + '"';
    return t && (u += ' title="' + O(t) + '"'), u += ">" + o + "</a>", u;
  }
  image({ href: e, title: t, text: n, tokens: s }) {
    s && (n = this.parser.parseInline(s, this.parser.textRenderer));
    let r = re(e);
    if (r === null) return O(n);
    e = r;
    let o = `<img src="${O(e)}" alt="${O(n)}"`;
    return t && (o += ` title="${O(t)}"`), o += ">", o;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var z = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var T = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || y, this.options.renderer = this.options.renderer || new S(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new z();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let s = e[n];
      if (this.options.extensions?.renderers?.[s.type]) {
        let o = s, i = this.options.extensions.renderers[o.type].call({ parser: this }, o);
        if (i !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(o.type)) {
          t += i || "";
          continue;
        }
      }
      let r = s;
      switch (r.type) {
        case "space": {
          t += this.renderer.space(r);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r);
          break;
        }
        case "code": {
          t += this.renderer.code(r);
          break;
        }
        case "table": {
          t += this.renderer.table(r);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r);
          break;
        }
        case "list": {
          t += this.renderer.list(r);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r);
          break;
        }
        case "html": {
          t += this.renderer.html(r);
          break;
        }
        case "def": {
          t += this.renderer.def(r);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r);
          break;
        }
        case "text": {
          t += this.renderer.text(r);
          break;
        }
        default: {
          let o = 'Token with "' + r.type + '" type was not found.';
          if (this.options.silent) return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let s = 0; s < e.length; s++) {
      let r = e[s];
      if (this.options.extensions?.renderers?.[r.type]) {
        let i = this.options.extensions.renderers[r.type].call({ parser: this }, r);
        if (i !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
          n += i || "";
          continue;
        }
      }
      let o = r;
      switch (o.type) {
        case "escape": {
          n += t.text(o);
          break;
        }
        case "html": {
          n += t.html(o);
          break;
        }
        case "link": {
          n += t.link(o);
          break;
        }
        case "image": {
          n += t.image(o);
          break;
        }
        case "checkbox": {
          n += t.checkbox(o);
          break;
        }
        case "strong": {
          n += t.strong(o);
          break;
        }
        case "em": {
          n += t.em(o);
          break;
        }
        case "codespan": {
          n += t.codespan(o);
          break;
        }
        case "br": {
          n += t.br(o);
          break;
        }
        case "del": {
          n += t.del(o);
          break;
        }
        case "text": {
          n += t.text(o);
          break;
        }
        default: {
          let i = 'Token with "' + o.type + '" type was not found.';
          if (this.options.silent) return console.error(i), "";
          throw new Error(i);
        }
      }
    }
    return n;
  }
};
var _ = class {
  options;
  block;
  constructor(e) {
    this.options = e || y;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? R.lex : R.lexInline;
  }
  provideParser(e = this.block) {
    return e ? T.parse : T.parseInline;
  }
};
var F = class {
  defaults = I();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = T;
  Renderer = S;
  TextRenderer = z;
  Lexer = R;
  Tokenizer = P;
  Hooks = _;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
      case "table": {
        let r = s;
        for (let o of r.header) n = n.concat(this.walkTokens(o.tokens, t));
        for (let o of r.rows) for (let i of o) n = n.concat(this.walkTokens(i.tokens, t));
        break;
      }
      case "list": {
        let r = s;
        n = n.concat(this.walkTokens(r.items, t));
        break;
      }
      default: {
        let r = s;
        this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((o) => {
          let i = r[o].flat(1 / 0);
          n = n.concat(this.walkTokens(i, t));
        }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let s = { ...n };
      if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r) => {
        if (!r.name) throw new Error("extension name required");
        if ("renderer" in r) {
          let o = t.renderers[r.name];
          o ? t.renderers[r.name] = function(...i) {
            let u = r.renderer.apply(this, i);
            return u === false && (u = o.apply(this, i)), u;
          } : t.renderers[r.name] = r.renderer;
        }
        if ("tokenizer" in r) {
          if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let o = t[r.level];
          o ? o.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
        }
        "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
      }), s.extensions = t), n.renderer) {
        let r = this.defaults.renderer || new S(this.defaults);
        for (let o in n.renderer) {
          if (!(o in r)) throw new Error(`renderer '${o}' does not exist`);
          if (["options", "parser"].includes(o)) continue;
          let i = o, u = n.renderer[i], a = r[i];
          r[i] = (...p) => {
            let c = u.apply(r, p);
            return c === false && (c = a.apply(r, p)), c || "";
          };
        }
        s.renderer = r;
      }
      if (n.tokenizer) {
        let r = this.defaults.tokenizer || new P(this.defaults);
        for (let o in n.tokenizer) {
          if (!(o in r)) throw new Error(`tokenizer '${o}' does not exist`);
          if (["options", "rules", "lexer"].includes(o)) continue;
          let i = o, u = n.tokenizer[i], a = r[i];
          r[i] = (...p) => {
            let c = u.apply(r, p);
            return c === false && (c = a.apply(r, p)), c;
          };
        }
        s.tokenizer = r;
      }
      if (n.hooks) {
        let r = this.defaults.hooks || new _();
        for (let o in n.hooks) {
          if (!(o in r)) throw new Error(`hook '${o}' does not exist`);
          if (["options", "block"].includes(o)) continue;
          let i = o, u = n.hooks[i], a = r[i];
          _.passThroughHooks.has(o) ? r[i] = (p) => {
            if (this.defaults.async && _.passThroughHooksRespectAsync.has(o)) return (async () => {
              let d = await u.call(r, p);
              return a.call(r, d);
            })();
            let c = u.call(r, p);
            return a.call(r, c);
          } : r[i] = (...p) => {
            if (this.defaults.async) return (async () => {
              let d = await u.apply(r, p);
              return d === false && (d = await a.apply(r, p)), d;
            })();
            let c = u.apply(r, p);
            return c === false && (c = a.apply(r, p)), c;
          };
        }
        s.hooks = r;
      }
      if (n.walkTokens) {
        let r = this.defaults.walkTokens, o = n.walkTokens;
        s.walkTokens = function(i) {
          let u = [];
          return u.push(o.call(this, i)), r && (u = u.concat(r.call(this, i))), u;
        };
      }
      this.defaults = { ...this.defaults, ...s };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return R.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return T.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, s) => {
      let r = { ...s }, o = { ...this.defaults, ...r }, i = this.onError(!!o.silent, !!o.async);
      if (this.defaults.async === true && r.async === false) return i(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return i(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return i(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (o.hooks && (o.hooks.options = o, o.hooks.block = e), o.async) return (async () => {
        let u = o.hooks ? await o.hooks.preprocess(n) : n, p = await (o.hooks ? await o.hooks.provideLexer(e) : e ? R.lex : R.lexInline)(u, o), c = o.hooks ? await o.hooks.processAllTokens(p) : p;
        o.walkTokens && await Promise.all(this.walkTokens(c, o.walkTokens));
        let m = await (o.hooks ? await o.hooks.provideParser(e) : e ? T.parse : T.parseInline)(c, o);
        return o.hooks ? await o.hooks.postprocess(m) : m;
      })().catch(i);
      try {
        o.hooks && (n = o.hooks.preprocess(n));
        let a = (o.hooks ? o.hooks.provideLexer(e) : e ? R.lex : R.lexInline)(n, o);
        o.hooks && (a = o.hooks.processAllTokens(a)), o.walkTokens && this.walkTokens(a, o.walkTokens);
        let c = (o.hooks ? o.hooks.provideParser(e) : e ? T.parse : T.parseInline)(a, o);
        return o.hooks && (c = o.hooks.postprocess(c)), c;
      } catch (u) {
        return i(u);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(s) : s;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var E = new F();
function k(l3, e) {
  return E.parse(l3, e);
}
k.options = k.setOptions = function(l3) {
  return E.setOptions(l3), k.defaults = E.defaults, W(k.defaults), k;
};
k.getDefaults = I;
k.defaults = y;
function Pt(...l3) {
  return E.use(...l3), k.defaults = E.defaults, W(k.defaults), k;
}
k.use = Pt;
k.walkTokens = function(l3, e) {
  return E.walkTokens(l3, e);
};
k.parseInline = E.parseInline;
k.Parser = T;
k.parser = T.parse;
k.Renderer = S;
k.TextRenderer = z;
k.Lexer = R;
k.lexer = R.lex;
k.Tokenizer = P;
k.Hooks = _;
k.parse = k;
var gn = k.options;
var fn = k.setOptions;
var mn = k.walkTokens;
var xn = k.parseInline;
var Rn = T.parse;
var Tn = R.lex;

// packages/core/src/trackers/github.ts
var issueRepo = (url) => url ? /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/\d+/i.exec(url)?.[1] ?? null : null;
function hasPlaceLabel(issue, labels) {
  if (!labels.length) return true;
  const want = new Set(labels.map((l3) => l3.toLowerCase()));
  return (issue.labels ?? []).some((l3) => want.has(l3.name.toLowerCase()));
}
function githubOutside(issue, repo, labels, projectOnly = false) {
  const now2 = issueRepo(issue.url);
  if (now2 && now2.toLowerCase() !== repo.toLowerCase()) return `it moved to ${now2}`;
  if (projectOnly || hasPlaceLabel(issue, labels)) return null;
  return labels.length === 1 ? `it has no label ${labels[0]}` : `it has none of the labels ${orList(labels)}`;
}

// packages/core/src/intake.ts
function depsFromBody(body) {
  const out2 = /* @__PURE__ */ new Set();
  for (const m of (body ?? "").matchAll(/\b(?:depends on|blocked by)\s+((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out2.add(`#${n[1]}`);
  }
  return [...out2];
}
function githubIssuesToTasks(issues, environment) {
  return issues.map((i) => ({
    source: { kind: "github", key: `#${i.number}`, url: i.url },
    title: i.title,
    brief: i.body ?? "",
    deps: depsFromBody(i.body).filter((d) => d !== `#${i.number}`),
    labels: (i.labels ?? []).map((l3) => l3.name),
    ...environment ? { environment } : {}
  }));
}
function skipLabelOf(issue, skip3) {
  const names2 = new Set(skip3.map((s) => s.toLowerCase()));
  return (issue.labels ?? []).map((l3) => l3.name).find((n) => names2.has(n.toLowerCase())) ?? null;
}
var noChanges = () => ({ closed: [], removed: [], left: [], leftAlone: [] });
var neverStarted = (t) => t.state === "todo" && !t.run;
var issueNumber = (t) => {
  const n = t.source.kind === "github" ? /^GH-(\d+)$/.exec(t.id)?.[1] : void 0;
  return n ? Number(n) : null;
};
function leave(ledger, t, ticket, why, emit, res) {
  if (neverStarted(t)) {
    ledger.tasks.splice(ledger.tasks.indexOf(t), 1);
    emit({ type: "task.removed", task: t.id, actor: "sync", by: "acc intake", data: { reason: why.reason, title: t.title, source: t.source } });
    res.removed.push(t.id);
    if (why.left) res.left.push(t.id);
  } else res.leftAlone.push({ task: t.id, issue: ticket, state: t.state, note: `${why.note}; ${t.id} is still ${t.state}` });
}
function reconcileGithub(ledger, config, issues, skip3, emit, now2, place = null) {
  const res = noChanges();
  const by = "acc intake";
  for (const t of [...ledger.tasks]) {
    const n = issueNumber(t);
    const issue = n === null || t.state === "done" ? void 0 : issues.get(n);
    if (!issue) continue;
    const key = `#${n}`;
    const label = skipLabelOf(issue, skip3);
    if (label) {
      leave(ledger, t, key, { reason: `Issue ${key} has the label "${label}", which isn't imported.`, note: `${key} has the label "${label}"`, left: false }, emit, res);
      continue;
    }
    const outside = place ? githubOutside(issue, place.repo, place.labels) : null;
    if (outside) {
      leave(ledger, t, key, { reason: `Issue ${key} left this repo's place: ${outside}.`, note: `${key} left this repo's place: ${outside}`, left: true }, emit, res);
      continue;
    }
    if (issue.state?.toUpperCase() !== "CLOSED") continue;
    const req = { to: "done", actor: "sync", by, reason: `Issue ${key} was closed on GitHub.` };
    if (neverStarted(t) && !checkMove(ledger, config, t, req, noGateHooks).length) {
      applyMove(t, req, emit, now2);
      res.closed.push(t.id);
    } else res.leftAlone.push({ task: t.id, issue: key, state: t.state, note: `${key} was closed on GitHub; ${t.id} is still ${t.state}` });
  }
  return res;
}
function intakeGithub(paths, config, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json.');
  const tracker = config.trackers.find((t) => t.kind === "github");
  const place = { repo: tracker?.repo ?? gh.repo, labels: tracker?.labels ?? [] };
  const skip3 = tracker?.skipLabels ?? [];
  const token = run2("gh", ["auth", "token", "-u", gh.account]);
  if (token.code !== 0) throw new AccError("no-github", `gh isn't logged in as ${gh.account}. Run: gh auth login`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  const lists = (place.labels.length ? place.labels : [null]).map((label) => {
    const args = ["issue", "list", "-R", place.repo, "--state", "open", "--limit", "500"];
    if (opts.label) args.push("--label", opts.label);
    if (label) args.push("--label", label);
    const r = run2("gh", [...args, "--json", "number,title,body,url,labels"], { env });
    if (r.code !== 0) throw new AccError("github", `Couldn't list issues on ${place.repo}: ${r.stderr.trim().split("\n")[0]}`);
    return JSON.parse(r.stdout);
  });
  const byNumber = /* @__PURE__ */ new Map();
  for (const i of lists.flat()) if (!byNumber.has(i.number)) byNumber.set(i.number, i);
  const open = lists.length === 1 ? lists[0] : [...byNumber.values()].sort((a, b) => b.number - a.number);
  const issues = new Map(open.map((i) => [i.number, { ...i, state: "OPEN" }]));
  for (const t of readLedger(paths.ledger).tasks) {
    const n = issueNumber(t);
    if (n === null || t.state === "done" || issues.has(n)) continue;
    const v = run2("gh", ["issue", "view", String(n), "-R", place.repo, "--json", "number,state,labels,url"], { env, timeoutMs: 6e4 });
    if (v.code !== 0) continue;
    try {
      issues.set(n, JSON.parse(v.stdout));
    } catch {
    }
  }
  const inputs = githubIssuesToTasks(open.filter((i) => !skipLabelOf(i, skip3)));
  return mutate(paths, now2, (ledger, emit) => ({
    ...upsertTasks(ledger, config, inputs, opts.actor, opts.by, emit, now2),
    ...reconcileGithub(ledger, config, issues, skip3, emit, now2, place)
  }));
}
function intakeOutside(paths, kind, outside, now2) {
  return mutate(paths, now2, (ledger, emit) => {
    const res = { added: [], updated: [], unchanged: [], errors: [], ...noChanges() };
    for (const o of outside) {
      const id = normalizeId(o.key, kind);
      const t = ledger.tasks.find((x2) => x2.id === id && x2.source.kind === kind);
      if (!t || t.state === "done") continue;
      leave(ledger, t, id, { reason: `${id} left this repo's place: ${o.why}.`, note: `${id} left this repo's place: ${o.why}`, left: true }, emit, res);
    }
    return res;
  });
}

// packages/core/src/dispatch.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { existsSync as existsSync8, mkdirSync as mkdirSync14, readFileSync as readFileSync14, realpathSync, symlinkSync, writeFileSync as writeFileSync16 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { basename as basename3, dirname as dirname3, isAbsolute, join as join14, resolve, sep } from "node:path";

// packages/core/src/questions.ts
import { chmodSync, closeSync, fstatSync, linkSync, mkdirSync as mkdirSync9, openSync, readdirSync as readdirSync2, readFileSync as readFileSync8, readSync, renameSync as renameSync4, rmSync as rmSync5, statSync as statSync3, writeFileSync as writeFileSync9, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import { join as join8 } from "node:path";
var questionsDir = (env = process.env) => env.ACC_QUESTIONS_DIR || join8(homedir2(), ".acc", "questions");
var ALLOWED_MODES = ["auto", "acceptEdits", "default"];
var LISTENER_STALE_MS = 45e3;
var HOOK_TIMEOUT_S = 3600;
var MAX_WAIT_MS = (HOOK_TIMEOUT_S - 120) * 1e3;
var isUnder = (path, root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
function readJson(file) {
  try {
    return JSON.parse(readFileSync8(file, "utf8"));
  } catch {
    return null;
  }
}
function writePrivate(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync9(tmp, JSON.stringify(data), { mode: 384 });
  renameSync4(tmp, file);
}
function ensureDir(dir) {
  mkdirSync9(join8(dir, "listeners"), { recursive: true, mode: 448 });
  try {
    chmodSync(dir, 448);
  } catch {
  }
}
var HISTORY_KEEP = 1e3;
var HISTORY_MAX_BYTES = 2 * 1024 * 1024;
var HISTORY_TRIM_EVERY_BYTES = 64 * 1024;
var HISTORY_LOCK = { timeoutMs: 1e4, staleMs: 5e3 };
function appendHistory(dir, rec, trimEvery = HISTORY_TRIM_EVERY_BYTES) {
  ensureDir(dir);
  const file = join8(dir, "history.jsonl");
  withLock(join8(dir, "history.lock"), () => {
    appendLine(file, JSON.stringify(rec));
    try {
      const size = statSync3(file).size;
      if (size > trimmedSize(dir, size) + trimEvery) writePrivateText(join8(dir, "history.trimmed"), `${trimHistory(file)}
`);
    } catch {
    }
  }, HISTORY_LOCK);
}
function appendLine(file, line) {
  const fd = openSync(file, "a+", 384);
  try {
    const { size } = fstatSync(fd);
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10;
    writeSync(fd, `${torn ? "\n" : ""}${line}
`);
  } finally {
    closeSync(fd);
  }
}
function trimmedSize(dir, size) {
  try {
    const n = Number(readFileSync8(join8(dir, "history.trimmed"), "utf8"));
    return Number.isSafeInteger(n) && n >= 0 && n <= size ? n : 0;
  } catch {
    return 0;
  }
}
function trimHistory(file) {
  const data = readFileSync8(file);
  const lines = data.toString("utf8").split("\n").filter(Boolean);
  const kept = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < HISTORY_KEEP; i--) {
    const line = lines[i];
    if (!readRecord(line)) continue;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > HISTORY_MAX_BYTES && kept.length) break;
    kept.push(line);
  }
  if (kept.length === lines.length) return data.length;
  const text = kept.reverse().map((l3) => `${l3}
`).join("");
  writePrivateText(file, text);
  return Buffer.byteLength(text);
}
function writePrivateText(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync9(tmp, text, { mode: 384 });
  renameSync4(tmp, file);
}
function readRecord(line) {
  try {
    const r = JSON.parse(line);
    return r?.v === 1 && typeof r.id === "string" && typeof r.outcome === "string" ? r : null;
  } catch {
    return null;
  }
}
var PREAPPROVAL_MS = 10 * 6e4;
var preapprovalFile = (dir, sessionId) => join8(dir, "approved", `${sessionId.replace(/[^A-Za-z0-9-]/g, "")}.json`);
function preapprove(dir, sessionId, command, now2 = Date.now()) {
  mkdirSync9(join8(dir, "approved"), { recursive: true, mode: 448 });
  writePrivate(preapprovalFile(dir, sessionId), { command, until: now2 + PREAPPROVAL_MS });
}
function takePreapproval(dir, sessionId, command, now2 = Date.now()) {
  const file = preapprovalFile(dir, sessionId);
  const p = readJson(file);
  if (!p || p.command !== command || typeof p.until !== "number" || now2 > p.until) return false;
  rmSync5(file, { force: true });
  return true;
}
var editedMessage = (command) => `The user edited this command in the Command Center. Run exactly this instead, as it is, and carry on:

\`\`\`
${command}
\`\`\``;
function outcomeOf(q2, a) {
  if (a.decision === "terminal") return "terminal";
  if (a.decision === "deny") return a.stop ? "denied-stopped" : "denied";
  if (q2.tool === "AskUserQuestion") return "answered";
  if (a.command && q2.tool === "Bash") return "allowed-edited";
  if (a.mode === "auto") return "allowed-auto-mode";
  if (a.mode === "acceptEdits") return "allowed-accept-edits";
  if (a.always) return a.scope === "project" ? "allowed-for-project" : "allowed-for-session";
  return "allowed";
}
function listeners(dir, now2 = Date.now()) {
  let names2 = [];
  try {
    names2 = readdirSync2(join8(dir, "listeners")).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names2.flatMap((n) => {
    const l3 = readJson(join8(dir, "listeners", n));
    const ok = !!l3 && Number.isInteger(l3.pid) && typeof l3.at === "number" && Array.isArray(l3.roots) && now2 - l3.at < LISTENER_STALE_MS && alive(l3.pid);
    return ok ? [l3] : [];
  });
}
var covered = (ls, cwd) => ls.some((l3) => l3.roots.some((r) => typeof r === "string" && isUnder(cwd, r)));
function existsQuestionsDir(dir) {
  try {
    return statSync3(join8(dir, "listeners")).isDirectory();
  } catch {
    return false;
  }
}
function parseHookInput(text) {
  let x2 = null;
  try {
    x2 = JSON.parse(text);
  } catch {
    return null;
  }
  if (!x2 || typeof x2 !== "object") return null;
  const str = (v) => typeof v === "string" && v.length > 0;
  if (!str(x2.session_id) || !str(x2.cwd) || !str(x2.tool_name) || !x2.tool_input || typeof x2.tool_input !== "object") return null;
  return {
    hook_event_name: String(x2.hook_event_name ?? ""),
    session_id: x2.session_id,
    cwd: x2.cwd,
    transcript_path: str(x2.transcript_path) ? x2.transcript_path : void 0,
    tool_name: x2.tool_name,
    tool_input: x2.tool_input,
    permission_suggestions: Array.isArray(x2.permission_suggestions) ? x2.permission_suggestions : []
  };
}
function isAnswer(a) {
  const x2 = a;
  if (!x2 || typeof x2 !== "object") return false;
  if (x2.decision === "terminal") return true;
  if (x2.decision === "deny") return (x2.message === void 0 || typeof x2.message === "string" && x2.message.length <= 4e3) && (x2.stop === void 0 || typeof x2.stop === "boolean");
  if (x2.decision !== "allow") return false;
  if (x2.always !== void 0 && typeof x2.always !== "boolean") return false;
  if (x2.scope !== void 0 && x2.scope !== "session" && x2.scope !== "project") return false;
  if (x2.mode !== void 0 && !ALLOWED_MODES.includes(x2.mode)) return false;
  if (x2.command !== void 0 && !(typeof x2.command === "string" && x2.command.trim().length > 0 && x2.command.length <= 2e4)) return false;
  if (x2.answers === void 0) return true;
  const answers = x2.answers;
  return !!answers && typeof answers === "object" && Object.values(answers).every((v) => typeof v === "string" && v.length <= 4e3);
}
async function ask(input, opts = {}) {
  const dir = opts.dir ?? questionsDir();
  const now2 = opts.now ?? Date.now;
  const wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 300;
  const maxWaitMs = opts.maxWaitMs ?? MAX_WAIT_MS;
  const record = (q2, outcome, a) => {
    try {
      appendHistory(dir, {
        v: 1,
        id: q2.id,
        sessionId: input.session_id,
        cwd: input.cwd,
        tool: input.tool_name,
        input: input.tool_input,
        askedAt: q2.at,
        endedAt: now2(),
        outcome,
        ...a?.decision === "allow" && a.answers ? { answers: a.answers } : {},
        ...a?.decision === "deny" && a.message ? { message: a.message } : {},
        ...a?.decision === "allow" && a.command && input.tool_name === "Bash" ? { command: a.command } : {}
      });
    } catch {
    }
  };
  if (input.tool_name === "Bash" && takePreapproval(dir, input.session_id, String(input.tool_input.command ?? ""), now2())) {
    const id = `${now2().toString(36)}-${randomBytes(4).toString("hex")}`;
    const q2 = { v: 1, id, pid: opts.pid ?? process.pid, at: now2(), sessionId: input.session_id, cwd: input.cwd, transcript: input.transcript_path ?? null, tool: input.tool_name, input: input.tool_input, suggestions: [] };
    return { question: q2, answer: { decision: "allow" } };
  }
  if (!covered(listeners(dir, now2()), input.cwd)) {
    if (listeners(dir, now2()).length || existsQuestionsDir(dir)) record({ id: `${now2().toString(36)}-${randomBytes(4).toString("hex")}`, at: now2() }, "no-window");
    return null;
  }
  ensureDir(dir);
  const question = {
    v: 1,
    id: `${now2().toString(36)}-${randomBytes(4).toString("hex")}`,
    pid: opts.pid ?? process.pid,
    at: now2(),
    sessionId: input.session_id,
    cwd: input.cwd,
    transcript: input.transcript_path ?? null,
    tool: input.tool_name,
    input: input.tool_input,
    suggestions: input.permission_suggestions ?? []
  };
  const file = join8(dir, `${question.id}.json`);
  const answerFile = join8(dir, `${question.id}.answer.json`);
  writePrivate(file, question);
  const started = now2();
  try {
    for (let i = 0; ; i++) {
      const a = readJson(answerFile);
      if (isAnswer(a)) {
        record(question, outcomeOf(question, a), a);
        if (a.decision === "allow" && a.command && question.tool === "Bash") preapprove(dir, question.sessionId, a.command, now2());
        return a.decision === "terminal" ? null : { question, answer: a };
      }
      if (opts.signal?.aborted) {
        record(question, "stopped");
        return null;
      }
      if (now2() - started > maxWaitMs) {
        record(question, "timed-out");
        return null;
      }
      if (i % 10 === 9 && !covered(listeners(dir, now2()), input.cwd)) {
        record(question, "window-closed");
        return null;
      }
      await wait(pollMs);
    }
  } finally {
    rmSync5(file, { force: true });
    rmSync5(answerFile, { force: true });
  }
}
function hookOutput(q2, a) {
  if (a.decision === "terminal") return null;
  let decision;
  if (a.decision === "deny") {
    decision = { behavior: "deny", message: a.message?.trim() ? `The user said no, from the Command Center: ${a.message.trim()}` : "The user said no, from the Command Center." };
    if (a.stop) decision.interrupt = true;
  } else if (q2.tool === "AskUserQuestion") {
    decision = { behavior: "allow", updatedInput: { ...q2.input, answers: a.answers ?? {} } };
  } else {
    if (a.command && q2.tool === "Bash") return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: editedMessage(a.command) } } };
    decision = { behavior: "allow" };
    const updates = [];
    if (a.always && q2.suggestions.length) updates.push(...q2.suggestions.map((s) => ({ ...s, destination: a.scope === "project" ? "localSettings" : "session" })));
    if (a.mode) updates.push({ type: "setMode", mode: a.mode, destination: "session" });
    if (updates.length) decision.updatedPermissions = updates;
  }
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } };
}
function permissionHook(command) {
  return { PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: `${command} hook permission`, timeout: HOOK_TIMEOUT_S }] }] };
}
function pendingQuestions(dir) {
  let names2 = [];
  try {
    names2 = readdirSync2(dir).filter((n) => n.endsWith(".json") && !n.endsWith(".answer.json"));
  } catch {
    return [];
  }
  const out2 = [];
  for (const n of names2) {
    const q2 = readJson(join8(dir, n));
    if (!q2 || q2.v !== 1 || typeof q2.id !== "string" || `${q2.id}.json` !== n || !Number.isInteger(q2.pid)) continue;
    if (!alive(q2.pid)) {
      rmSync5(join8(dir, n), { force: true });
      rmSync5(join8(dir, `${q2.id}.answer.json`), { force: true });
      continue;
    }
    out2.push(q2);
  }
  return out2.sort((a, b) => a.at - b.at);
}

// packages/core/src/analyze.ts
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync as existsSync6, mkdirSync as mkdirSync10, readFileSync as readFileSync10, renameSync as renameSync5, rmSync as rmSync6, writeFileSync as writeFileSync11 } from "node:fs";
import { join as join9 } from "node:path";

// packages/core/src/agents.ts
import { readFileSync as readFileSync9, writeFileSync as writeFileSync10 } from "node:fs";
var KEYS = { model: "model", effort: "effort", fallbackModel: "fallbackmodel" };
var gitKey = (role, field) => `acc.${role}.${KEYS[field]}`;
function cloneProfile(run2, root, role) {
  const out2 = {};
  for (const field of Object.keys(KEYS)) {
    const r = run2("git", ["config", "--get", gitKey(role, field)], { cwd: root });
    const v = r.code === 0 ? r.stdout.trim() : "";
    if (!v) continue;
    if (field === "effort") {
      if (EFFORTS.includes(v)) out2.effort = v;
    } else if (MODEL_NAME.test(v)) out2[field] = v;
  }
  return out2;
}
var modelOf = (p) => p?.model ?? DEFAULT_MODEL;
function profileView(config, run2, root, role) {
  const project2 = config.agents[role];
  const mine = cloneProfile(run2, root, role);
  const pick = (f) => mine[f] != null ? { v: mine[f], from: "clone" } : project2[f] != null ? { v: project2[f], from: "project" } : { v: null, from: "default" };
  const m = pick("model");
  const e = pick("effort");
  const fb = pick("fallbackModel");
  return {
    model: m.v ?? DEFAULT_MODEL,
    effort: e.v,
    fallbackModel: fb.v,
    from: { model: m.from === "default" ? "acc" : m.from, effort: e.from, fallbackModel: fb.from }
  };
}
function withCloneAgents(config, root, run2) {
  const merge = (role) => ({ ...config.agents[role], ...cloneProfile(run2, root, role) });
  return { ...config, agents: { ...config.agents, builder: merge("builder"), reviewer: merge("reviewer") } };
}
function agentArgs(p) {
  const model = modelOf(p);
  return ["--model", model, ...p?.effort ? ["--effort", p.effort] : [], ...p?.fallbackModel && p.fallbackModel !== model ? ["--fallback-model", p.fallbackModel] : []];
}
function checkModelName(v) {
  if (!MODEL_NAME.test(v)) throw new AccError("usage", `"${v}" isn't a model name. Use an alias such as opus, sonnet or fable, or a full model name.`);
}
function check(change2) {
  for (const f of ["model", "fallbackModel"]) {
    const v = change2[f];
    if (v != null) checkModelName(v);
  }
  if (change2.effort != null && !EFFORTS.includes(change2.effort)) throw new AccError("usage", `Effort is one of ${EFFORTS.join(", ")}.`);
}
function setProfile(run2, root, configFile, role, change2, scope) {
  check(change2);
  if (scope === "clone") {
    for (const f of Object.keys(change2)) {
      const v = change2[f];
      if (v === void 0) continue;
      const r = v === null ? run2("git", ["config", "--unset", gitKey(role, f)], { cwd: root }) : run2("git", ["config", gitKey(role, f), v], { cwd: root });
      if (r.code !== 0 && !(v === null && r.code === 5)) throw new AccError("git", `git config refused ${gitKey(role, f)}: ${r.stderr.trim()}`);
    }
    return;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync9(configFile, "utf8"));
  } catch (e) {
    throw new AccError("bad-config", `Couldn't read ${configFile}: ${e.message}`);
  }
  raw.agents ??= {};
  const p = { ...raw.agents[role] ?? {} };
  for (const f of Object.keys(change2)) {
    const v = change2[f];
    if (v === void 0) continue;
    if (v === null) delete p[f];
    else p[f] = v;
  }
  if (Object.keys(p).length) raw.agents[role] = p;
  else delete raw.agents[role];
  writeFileSync10(configFile, JSON.stringify(raw, null, 2) + "\n");
}
var SETTABLE_AUTONOMY = ["manual", "review"];
function setAutonomy(configFile, value) {
  if (value === "dispatch" || value === "full") {
    throw new AccError("refused", `autonomy "${value}" isn't built yet: autopilot would also start Ready tasks (D-055). Choose manual or review.`);
  }
  if (!SETTABLE_AUTONOMY.includes(value)) throw new AccError("usage", `Autonomy is ${SETTABLE_AUTONOMY.join(" or ")}.`);
  let text;
  let raw;
  try {
    text = readFileSync9(configFile, "utf8");
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError("bad-config", `Couldn't read ${configFile}: ${e.message}`);
  }
  const wanted = { ...raw, autonomy: value };
  const at2 = [...text.matchAll(/("autonomy"\s*:\s*)"[^"\\]*"/g)];
  if (at2.length === 1) {
    const edited = text.replace(/("autonomy"\s*:\s*)"[^"\\]*"/, `$1${JSON.stringify(value)}`);
    try {
      if (JSON.stringify(JSON.parse(edited)) === JSON.stringify(wanted)) {
        writeFileSync10(configFile, edited);
        return;
      }
    } catch {
    }
  }
  writeFileSync10(configFile, JSON.stringify(wanted, null, 2) + "\n");
}
function setAutoMerge(configFile, on) {
  let text;
  let raw;
  try {
    text = readFileSync9(configFile, "utf8");
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError("bad-config", `Couldn't read ${configFile}: ${e.message}`);
  }
  if (on && raw.profile === "salesforce") throw new AccError("refused", "A Salesforce project never auto-merges: a person merges every pull request there.");
  const was = raw.autopilot && typeof raw.autopilot === "object" && !Array.isArray(raw.autopilot) ? raw.autopilot : null;
  if (!on && was?.autoMerge === void 0) return;
  const wanted = { ...raw, autopilot: { ...was ?? {}, autoMerge: on } };
  const canon = (v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k2) => [k2, canon(v[k2])])) : Array.isArray(v) ? v.map(canon) : v;
  const fits = (edited) => {
    try {
      return JSON.stringify(canon(JSON.parse(edited))) === JSON.stringify(canon(wanted));
    } catch {
      return false;
    }
  };
  const tries = [];
  const value = /("autoMerge"\s*:\s*)(true|false)/;
  if ([...text.matchAll(new RegExp(value, "g"))].length === 1) tries.push(text.replace(value, `$1${on}`));
  const block = /("autopilot"\s*:\s*\{)(\s*)(?=")/;
  if (block.test(text)) tries.push(text.replace(block, (_m, open, gap) => `${open}${gap}"autoMerge": ${on},${gap}`));
  const indent = /^\{\s*?\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  if (!was) tries.push(text.replace(/(\S)(\s*)\}\s*$/, (_m, last, gap) => `${last},
${indent}"autopilot": {
${indent}${indent}"autoMerge": ${on}
${indent}}${gap}}
`));
  writeFileSync10(configFile, tries.find(fits) ?? JSON.stringify(wanted, null, 2) + "\n");
}

// packages/core/src/names.ts
var NAME_PART_MAX = 40;
var NAME_SEP = " \xB7 ";
var SECRET_PREFIX = /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-|xox|AKIA|eyJ)/;
var tokenLike = (word) => SECRET_PREFIX.test(word) || word.length >= 20 && new RegExp("\\p{L}", "u").test(word) && new RegExp("\\p{N}", "u").test(word);
function cleanName(text) {
  return text.normalize("NFC").replace(/[\p{Cc}\p{Z}\s/\\~·]+/gu, " ").replace(/[^\p{L}\p{M}\p{N} _.,:()+#-]/gu, "").split(" ").filter((w) => w && !tokenLike(w)).join(" ");
}
function shortTitle(text, max = NAME_PART_MAX) {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max).join("");
  const hard = chars.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  const cut = (space > 0 ? head.slice(0, space) : hard).replace(/[\s.,:(+#_-]+$/u, "");
  return `${cut || hard}\u2026`;
}
var cleanKey = (key) => /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : key.replace(/[^A-Za-z0-9_-]/g, "");
function sessionName(p) {
  const project2 = shortTitle(cleanName(p.project));
  const title = shortTitle(cleanName(p.title));
  const key = cleanKey(p.key);
  const task = [key, title].filter(Boolean).join(" ");
  const role = p.role === "builder" && p.n && p.n > 1 ? `${p.role} ${p.n}` : p.role;
  return [project2, task, role].filter(Boolean).join(NAME_SEP);
}

// packages/core/src/analyze.ts
var SIZE_MEANING = { S: "an hour or two", M: "a day", L: "a few days", XL: "split it" };
var strings = { type: "array", items: { type: "string" } };
var ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "requirements", "questions", "findings", "approach", "split"],
  properties: {
    verdict: { type: "string", enum: ["ready", "questions", "split"], description: "questions when a person must answer something before it can be built well; split when it is too big for one task" },
    summary: { type: "string", description: "Two or three plain sentences: what the task needs, what is already there, and how to build it" },
    requirements: {
      type: "object",
      additionalProperties: false,
      required: ["goal", "criteria", "assumptions", "outOfScope"],
      properties: {
        goal: { type: "string", description: "What the person asking wants, in a sentence" },
        criteria: { ...strings, description: "Acceptance criteria, each one testable" },
        assumptions: { ...strings, description: "What you assumed that the ticket does not say" },
        outOfScope: { ...strings, description: "What this task should not do" }
      }
    },
    questions: {
      type: "array",
      description: "Only what a person must decide, and nothing you could find out yourself",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "why", "suggested"],
        properties: { question: { type: "string" }, why: { type: "string", description: "What changes depending on the answer" }, suggested: { type: "string", description: "What you would assume if nobody answers" } }
      }
    },
    findings: {
      type: "array",
      description: "What is already there that this task touches or depends on",
      items: { type: "object", additionalProperties: false, required: ["area", "detail", "source"], properties: { area: { type: "string" }, detail: { type: "string" }, source: { type: "string", description: "A file path, or the org alias and the query or command" } } }
    },
    approach: {
      type: "object",
      additionalProperties: false,
      required: ["plan", "files", "refactors", "risks", "tests", "size"],
      properties: {
        plan: { ...strings, description: "The steps to build it, in order" },
        files: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["path", "change", "why"], properties: { path: { type: "string" }, change: { type: "string", enum: ["create", "update", "delete"] }, why: { type: "string" } } }
        },
        refactors: {
          type: "array",
          description: "Changes to what is there that the task needs first, and why",
          items: { type: "object", additionalProperties: false, required: ["what", "why"], properties: { what: { type: "string" }, why: { type: "string" } } }
        },
        risks: strings,
        tests: { ...strings, description: "How to prove it works: the tests to write or run" },
        size: { type: "string", enum: ["S", "M", "L", "XL"], description: Object.entries(SIZE_MEANING).map(([s, m]) => `${s}: ${m}`).join(". ") }
      }
    },
    split: { ...strings, description: "When the verdict is split: the smaller tasks, one line each. Otherwise empty" }
  }
};
var analysisPath = (paths, task) => join9(paths.analyses, `${task}.json`);
var runningPath = (paths, task) => join9(paths.analyses, `${task}.running.json`);
function readAnalysis(paths, task) {
  try {
    const a = JSON.parse(readFileSync10(analysisPath(paths, task), "utf8"));
    return a.v === 1 && a.task === task ? a : null;
  } catch {
    return null;
  }
}
function writeAnalysis(paths, a) {
  mkdirSync10(paths.analyses, { recursive: true });
  const file = analysisPath(paths, a.task);
  writeFileSync11(`${file}.tmp`, JSON.stringify(a, null, 2) + "\n");
  renameSync5(`${file}.tmp`, file);
}
var openQuestions = (a) => (a?.questions ?? []).filter((q2) => !q2.answer);
var analysisRequired = (config) => config.analysis?.required ?? config.profile === "salesforce";
function analysisProblems(paths, config, task) {
  if (task.state !== "todo" || !analysisRequired(config)) return [];
  const a = readAnalysis(paths, task.id);
  if (!a) return [`${task.id} hasn't been analyzed. This project wants an analysis before a build: acc analyze ${task.id}.`];
  if (a.verdict === "split") return [`${task.id}'s analysis says it's too big for one task. Split it into: ${a.split.join("; ")}. Or a person dispatches it anyway with --without-analysis.`];
  const open = openQuestions(a);
  if (open.length) return [`${open.length} question${open.length === 1 ? "" : "s"} from ${task.id}'s analysis ${open.length === 1 ? "is" : "are"} unanswered: ${open.map((q2) => `${q2.id}. ${q2.question}`).join(" ")} Answer with acc analysis answer ${task.id} <q> "<answer>".`];
  return [];
}
var SALESFORCE_COOKBOOK = [
  "Reading the org. Every command takes --target-org <alias> and --json. You can only read: nothing you run changes an org.",
  '- Which org, for sure: `sf org display --target-org <alias> --json`, and `sf data query --target-org <alias> --query "SELECT IsSandbox, Name, OrganizationType FROM Organization"`. Say which org each finding came from.',
  "- An object's fields and picklists: `sf sobject describe --sobject <Object> --target-org <alias> --json`.",
  "- Automation on an object, which runs in this order on save: validation rules, before-save flows, before triggers, after triggers, after-save flows. With --use-tooling-api:",
  "  - `SELECT ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '<Object>'`",
  "  - `SELECT Name, Status, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate FROM ApexTrigger WHERE TableEnumOrId = '<Object>'`",
  "  - `SELECT Name, TableEnumOrId FROM WorkflowRule WHERE TableEnumOrId = '<Object>'`",
  "  - and without the tooling API: `SELECT ApiName, Label, ProcessType, TriggerType, RecordTriggerType, TriggerObjectOrEventLabel, IsActive FROM FlowDefinitionView WHERE TriggerObjectOrEventLabel = '<Object label>'`",
  "- What uses a component (tooling API): `SELECT MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentName = '<Name>'`.",
  "- Code and its tests: `SELECT Name, LastModifiedDate, LastModifiedBy.Name FROM ApexClass WHERE Name LIKE '%<word>%'`, and coverage with `SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate` (tooling API).",
  "- Volumes and limits: `sf limits recordcounts display --sobject <Object> --target-org <alias>` and `sf limits api display --target-org <alias>`.",
  "- A component's source as the org has it: `sf project retrieve start --metadata <Type>:<Name> --target-org <alias>` from your working folder, which is a scratch project. It never touches the repo.",
  "- Records: you may read a few to learn their shape (LIMIT 5, only the fields you need). Don't copy names, emails or other personal details into your analysis: describe patterns instead.",
  "Compare the org with the repo: the repo's branch is meant to match its org. Say where they differ for what this task touches."
];
var SALESFORCE_FOCUS = [
  "What automation already runs on the objects this touches, in order, and whether the change should join it (an existing flow or trigger handler) instead of adding one more.",
  "Bulk safety and limits at the volumes you found: SOQL and DML out of loops, 200 records a transaction.",
  "Sharing and field access, permission sets and profiles that would need the new fields or classes.",
  "Tests: which test classes cover what changes, and what new tests prove it.",
  "Environment-specific files (D-016) and anything that would differ between orgs."
];
function analysisPrompt(i) {
  const sf = i.config.profile === "salesforce";
  const system = [
    `You are the analyst for ${i.task.id}. Before anyone builds it, you work out what it asks for, what is already there, and how it should be built. A builder agent is given your analysis; a person answers your questions first.`,
    `You can read the repo at ${i.root} (Read, Grep, Glob, and git log, show, diff and grep)${sf ? ", and read the Salesforce orgs listed below with the sf CLI" : ""}. You can't change anything: no edits, no writes, no deploys.`,
    "Work like a careful senior consultant on a new ticket:",
    "- Read the ticket. Restate the goal. Turn what it asks for into testable acceptance criteria. Name your assumptions and what is out of scope.",
    `- Investigate before you decide: find the code${sf ? " and the org configuration" : ""} this touches, what depends on it, and how it behaves today. Every finding names its source.`,
    "- Decide the approach: the steps, the files, any refactor the task needs first and why, the risks, and the tests that prove it.",
    "- Ask only what a person must decide: business rules, priorities, trade-offs. Never ask what you could find out yourself. Give each question your suggested answer.",
    "- If it is too big for one task (more than a few days), say split and list the smaller tasks.",
    ...sf ? ["", "For a Salesforce project, also cover:", ...SALESFORCE_FOCUS.map((f) => `- ${f}`), "", ...SALESFORCE_COOKBOOK] : [],
    "",
    "Be concrete and brief: names, files, numbers. No filler."
  ].join("\n");
  const prompt = [
    `# Analyze ${i.task.id}: ${i.task.title}`,
    "",
    `For the ${i.env.name} environment (branch \`${i.env.branch}\`).${i.checkedOut ? ` The repo is checked out on \`${i.checkedOut}\`: read the environment's files with git show ${i.env.branch}:<path>.` : ""}`,
    i.task.source.url ? `Ticket: ${i.task.source.url}` : `Source: ${i.task.source.kind}`,
    "",
    "## The ticket",
    "",
    i.task.brief.trim() || "_Only the title was given._",
    "",
    ...sf && i.orgs.length ? ["## The orgs you may read", "", ...i.orgs.map((o) => `- \`${o.alias}\`: ${o.name} (${o.type})`), ""] : [],
    ...i.previous?.questions.some((q2) => q2.answer) ? [
      "## What a person already answered",
      "",
      ...i.previous.questions.filter((q2) => q2.answer).map((q2) => `- ${q2.question} **${q2.answer.text}**`),
      "",
      "Don't ask these again.",
      ""
    ] : [],
    ...i.rules?.trim() ? ["## The project's rules", "", i.rules.trim(), ""] : []
  ].join("\n");
  return { system, prompt };
}
function parseAnalysis(stdout) {
  let r;
  try {
    r = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() ?? "");
  } catch {
    throw new AccError("analyze", `The analyst gave no result Claude Code could read: ${stdout.trim().slice(0, 200) || "(nothing)"}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || !["ready", "questions", "split"].includes(s.verdict) || typeof s.summary !== "string") {
    throw new AccError("analyze", `The analysis didn't finish (${r.subtype ?? "no result"}): ${String(r.result ?? "").slice(0, 300)}`);
  }
  const list = (v) => Array.isArray(v) ? v.filter((x2) => typeof x2 === "string" && !!x2.trim()) : [];
  const req = s.requirements ?? {};
  const ap = s.approach ?? {};
  const questions = (Array.isArray(s.questions) ? s.questions : []).filter((q2) => typeof q2?.question === "string" && q2.question.trim()).map((q2, n) => ({ id: `q${n + 1}`, question: q2.question, why: String(q2.why ?? ""), suggested: String(q2.suggested ?? "") }));
  const analysis = {
    // A ready verdict with questions waiting isn't ready.
    verdict: s.verdict === "ready" && questions.length ? "questions" : s.verdict,
    summary: s.summary,
    requirements: { goal: String(req.goal ?? ""), criteria: list(req.criteria), assumptions: list(req.assumptions), outOfScope: list(req.outOfScope) },
    questions,
    findings: (Array.isArray(s.findings) ? s.findings : []).filter((f) => typeof f?.detail === "string").map((f) => ({ area: String(f.area ?? ""), detail: f.detail, source: String(f.source ?? "") })),
    approach: {
      plan: list(ap.plan),
      files: (Array.isArray(ap.files) ? ap.files : []).filter((f) => typeof f?.path === "string" && ["create", "update", "delete"].includes(f.change)).map((f) => ({ path: f.path, change: f.change, why: String(f.why ?? "") })),
      refactors: (Array.isArray(ap.refactors) ? ap.refactors : []).filter((x2) => typeof x2?.what === "string").map((x2) => ({ what: x2.what, why: String(x2.why ?? "") })),
      risks: list(ap.risks),
      tests: list(ap.tests),
      size: ["S", "M", "L", "XL"].includes(ap.size) ? ap.size : "M"
    },
    split: list(s.split)
  };
  return { analysis, sessionId: typeof r.session_id === "string" ? r.session_id : null, costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null };
}
var ANALYST_COMMANDS = {
  any: ["git log", "git show", "git diff", "git grep", "git ls-files"],
  salesforce: [
    "sf org display",
    "sf org list metadata",
    "sf org list metadata-types",
    "sf data query",
    "sf sobject describe",
    "sf sobject list",
    "sf limits api display",
    "sf limits recordcounts display",
    "sf project retrieve start",
    "sf apex list log",
    "sf apex get log"
  ]
};
var git2 = (run2, cwd, ...args) => run2("git", args, { cwd });
function scratchProject(paths, id) {
  const dir = join9(paths.analyses, `${id}.work`);
  rmSync6(dir, { recursive: true, force: true });
  mkdirSync10(join9(dir, "force-app"), { recursive: true });
  const project2 = join9(paths.root, "sfdx-project.json");
  if (existsSync6(project2)) {
    try {
      const p = JSON.parse(readFileSync10(project2, "utf8"));
      writeFileSync11(join9(dir, "sfdx-project.json"), JSON.stringify({ ...p, packageDirectories: [{ path: "force-app", default: true }] }, null, 2));
    } catch {
      copyFileSync(project2, join9(dir, "sfdx-project.json"));
    }
  } else {
    writeFileSync11(join9(dir, "sfdx-project.json"), JSON.stringify({ packageDirectories: [{ path: "force-app", default: true }], sourceApiVersion: "62.0" }, null, 2));
  }
  return dir;
}
function analyze(paths, config, id, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (task.state === "done") throw new AccError("refused", `${id} is done. There's nothing left to analyze.`);
  if (task.state === "running") throw new AccError("refused", `${id} is being built. Analyze before dispatch, or after it's abandoned.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("analyze", `${id}'s environment "${task.environment}" isn't in the config.`);
  const sf = config.profile === "salesforce";
  const base = git2(run2, paths.root, "rev-parse", "--verify", "--quiet", env.branch).stdout.trim() || git2(run2, paths.root, "rev-parse", "HEAD").stdout.trim();
  const current = git2(run2, paths.root, "branch", "--show-current").stdout.trim();
  const orgs = sf ? config.environments.filter((e) => e.org).map((e) => ({ alias: e.org, name: e.name, type: e.type })) : [];
  const rulesFile = join9(paths.root, ".acc", "rules.md");
  const previous = readAnalysis(paths, id);
  const { system, prompt } = analysisPrompt({ task, config, env, root: paths.root, checkedOut: current && current !== env.branch ? current : null, orgs, rules: existsSync6(rulesFile) ? readFileSync10(rulesFile, "utf8") : null, previous });
  const allowed = [...ANALYST_COMMANDS.any, ...sf ? ANALYST_COMMANDS.salesforce : []].map((c) => `Bash(${c}:*)`);
  const settings = deps.accCommand ? { hooks: { PreToolUse: [{ matcher: "Bash|Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: `${deps.accCommand} hook pre-tool-use` }] }] } } : null;
  const cwd = sf ? scratchProject(paths, id) : paths.root;
  const sessionId = (deps.uuid ?? randomUUID)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: "analysis" });
  mkdirSync10(paths.analyses, { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now2();
  writeFileSync11(marker, JSON.stringify({ sessionId, name, startedAt: startedAt.toISOString(), pid: process.pid }));
  deps.onStart?.(sessionId, name);
  const awake = holdAwake(process.pid, deps.awake);
  let out2;
  try {
    out2 = run2("claude", [
      "-p",
      "--session-id",
      sessionId,
      "--name",
      name,
      "--permission-mode",
      "dontAsk",
      ...agentArgs(config.agents.reviewer),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(ANALYSIS_SCHEMA),
      "--append-system-prompt",
      system,
      ...cwd !== paths.root ? ["--add-dir", paths.root] : [],
      ...settings ? ["--settings", JSON.stringify(settings)] : [],
      "--allowedTools",
      "Read",
      "Grep",
      "Glob",
      ...allowed,
      "--disallowedTools",
      "Edit",
      "Write",
      "NotebookEdit",
      "WebFetch",
      "WebSearch"
    ], { cwd, input: prompt, env: { ...sf ? sfEnv(deps.env) : deps.env, ACC_ROLE: "analyst", ACC_TASK: id }, timeoutMs: 45 * 6e4 });
  } finally {
    awake?.release();
    rmSync6(marker, { force: true });
  }
  if (out2.timedOut) throw new AccError("analyze", `The analysis didn't finish within 45 minutes, so acc stopped it.`);
  if (out2.code === 127 && !out2.stdout) throw new AccError("analyze", `Claude Code didn't start: ${out2.stderr.trim().split("\n")[0] ?? "claude not found"}`);
  const parsed = parseAnalysis(out2.stdout);
  const finished = now2();
  const answered = new Map((previous?.questions ?? []).filter((q2) => q2.answer).map((q2) => [q2.question.trim().toLowerCase(), q2.answer]));
  const questions = parsed.analysis.questions.map((q2) => answered.has(q2.question.trim().toLowerCase()) ? { ...q2, answer: answered.get(q2.question.trim().toLowerCase()) } : q2);
  const analysis = {
    v: 1,
    task: id,
    env: env.branch,
    base,
    ...parsed.analysis,
    questions,
    verdict: parsed.analysis.verdict === "questions" && !questions.some((q2) => !q2.answer) ? "ready" : parsed.analysis.verdict,
    orgs: orgs.map((o) => o.alias),
    sessionId: parsed.sessionId ?? sessionId,
    name,
    at: finished.toISOString(),
    durationMs: finished.getTime() - startedAt.getTime(),
    costUsd: parsed.costUsd
  };
  writeAnalysis(paths, analysis);
  mutate(paths, now2, (_l, emit) => {
    emit({ type: "task.updated", task: id, actor: opts.actor ?? "human", by: opts.by ?? `analyst:${id}`, data: { analyzed: { verdict: analysis.verdict, questions: analysis.questions.length } } });
  });
  return analysis;
}
function answerAnalysis(paths, id, question, text, by, now2) {
  const a = readAnalysis(paths, id);
  if (!a) throw new AccError("no-analysis", `${id} hasn't been analyzed yet: acc analyze ${id}.`);
  const q2 = a.questions.find((x2) => x2.id === question.toLowerCase() || x2.id === `q${question}`);
  if (!q2) throw new AccError("usage", `${id}'s analysis has no question ${question}. It has: ${a.questions.map((x2) => x2.id).join(", ") || "none"}.`);
  if (!text.trim()) throw new AccError("usage", "Give an answer.");
  q2.answer = { text: text.trim(), by, at: now2().toISOString() };
  if (a.verdict === "questions" && !openQuestions(a).length) a.verdict = "ready";
  writeAnalysis(paths, a);
  mutate(paths, now2, (_l, emit) => {
    emit({ type: "task.updated", task: id, actor: "human", by, data: { answered: { question: q2.id } } });
  });
  return a;
}
function analysisSection(a) {
  if (!a) return [];
  const bullets = (xs) => xs.map((x2) => `- ${x2}`);
  return [
    "## What the analysis found",
    "",
    `An analyst read the ticket${a.orgs.length ? `, the code and the orgs (${a.orgs.join(", ")})` : " and the code"} before you. Build from this, and check what it says as you go: if something here turns out to be wrong, say so in your final message.`,
    "",
    a.summary,
    "",
    ...a.requirements.criteria.length ? ["**Acceptance criteria**", "", ...bullets(a.requirements.criteria), ""] : [],
    ...a.questions.length ? ["**Decided by a person**", "", ...a.questions.map((q2) => `- ${q2.question} ${q2.answer ? `**${q2.answer.text}**` : `Nobody answered; assume: ${q2.suggested}`}`), ""] : [],
    ...a.requirements.assumptions.length ? ["**Assumptions**", "", ...bullets(a.requirements.assumptions), ""] : [],
    ...a.requirements.outOfScope.length ? ["**Out of scope**", "", ...bullets(a.requirements.outOfScope), ""] : [],
    ...a.findings.length ? ["**What is there now**", "", ...a.findings.map((f) => `- ${f.area}: ${f.detail}${f.source ? ` (${f.source})` : ""}`), ""] : [],
    ...a.approach.plan.length ? ["**The approach**", "", ...a.approach.plan.map((s, i) => `${i + 1}. ${s}`), ""] : [],
    ...a.approach.refactors.length ? ["**Refactors first**", "", ...a.approach.refactors.map((r) => `- ${r.what}: ${r.why}`), ""] : [],
    ...a.approach.files.length ? ["**Files**", "", ...a.approach.files.map((f) => `- ${f.change} \`${f.path}\`: ${f.why}`), ""] : [],
    ...a.approach.risks.length ? ["**Risks**", "", ...bullets(a.approach.risks), ""] : [],
    ...a.approach.tests.length ? ["**Tests**", "", ...bullets(a.approach.tests), ""] : []
  ];
}

// packages/core/src/checks.ts
import { mkdirSync as mkdirSync13, readFileSync as readFileSync13, writeFileSync as writeFileSync15 } from "node:fs";
import { join as join13 } from "node:path";

// packages/core/src/land.ts
import { mkdtempSync, rmSync as rmSync9, writeFileSync as writeFileSync14 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join12 } from "node:path";

// packages/core/src/review.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { existsSync as existsSync7, mkdirSync as mkdirSync11, readdirSync as readdirSync3, readFileSync as readFileSync11, renameSync as renameSync6, rmSync as rmSync7, writeFileSync as writeFileSync12 } from "node:fs";
import { join as join10 } from "node:path";
var VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "client", "criteria", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "changes"], description: "changes only when something must be fixed before this merges" },
    summary: { type: "string", description: "Two or three plain sentences for the pull request: what the change does and how well" },
    client: { type: "string", description: "One plain sentence for the client: what changes for them, with no code, file, tool or agent names" },
    criteria: {
      type: "array",
      description: "Each acceptance criterion in the task, in its own words",
      items: { type: "object", additionalProperties: false, required: ["text", "met", "evidence"], properties: { text: { type: "string" }, met: { type: "boolean" }, evidence: { type: "string", description: "Where it is met (file:line), or what is missing" } } }
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["message", "must"],
        properties: {
          message: { type: "string", description: "What is wrong, and what to do instead" },
          must: { type: "boolean", description: "true if it has to be fixed before merging" },
          file: { type: "string" },
          line: { type: "integer" },
          rule: { type: "string", description: "The project rule it breaks, if any" }
        }
      }
    }
  }
};
var DIFF_MAX = 15e4;
var reviewPath = (paths, task, sha) => join10(paths.reviews, `${task}-${sha}.json`);
var runningPath2 = (paths, task) => join10(paths.reviews, `${task}.running.json`);
function readVerdict(paths, task, sha) {
  try {
    return JSON.parse(readFileSync11(reviewPath(paths, task, sha), "utf8"));
  } catch {
    return null;
  }
}
function latestVerdict(paths, task) {
  if (!existsSync7(paths.reviews)) return null;
  const mine = readdirSync3(paths.reviews).filter((n) => n.startsWith(`${task}-`) && n.endsWith(".json"));
  const all = mine.map((n) => readVerdict(paths, task, n.slice(task.length + 1, -5))).filter((v) => !!v && v.task === task);
  return all.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}
function reviewing(paths, task) {
  try {
    const r = JSON.parse(readFileSync11(runningPath2(paths, task), "utf8"));
    return alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}
var FOCUS = {
  salesforce: [
    "Apex is bulk-safe: no SOQL or DML inside loops, and triggers handle 200 records.",
    "Apex respects sharing and object and field access where the data calls for it.",
    "Apex tests assert outcomes, cover the changed paths, and don't depend on org data they don't create.",
    "Metadata carries no values that belong to one org: user names, record ids, org URLs."
  ]
};
function reviewPrompt(i) {
  const focus = FOCUS[i.config.profile] ?? [];
  const system = [
    `You are the reviewer for ${i.task.id}. A builder agent made this change; you judge it before a person sees the pull request.`,
    "You can read files in this worktree with Read, Grep and Glob. You can't change anything, run commands, or ask questions.",
    "Judge it as a careful senior engineer would:",
    "- Does it do what the task asks? Go through each acceptance criterion in the task, and say whether it is met, with the file and line that meets it.",
    "- Does it follow the project's rules, if there are any?",
    "- Did it change anything the task didn't ask for?",
    "- Do the tests actually exercise the change?",
    ...focus.length ? ["- For this kind of project, also check:", ...focus.map((f) => `  - ${f}`)] : [],
    "Skip formatting and style: the checks cover those. A check that a person waived is settled; don't reopen it.",
    `Give "changes" only for problems that must be fixed before this merges, each as a finding with must: true. Lesser points are findings with must: false, and they don't block.`,
    "Be specific: the file, the line, what is wrong, and what to do instead."
  ].join("\n");
  const prompt = [
    `# Review ${i.task.id}: ${i.task.title}`,
    "",
    `Commit ${i.sha.slice(0, 7)} on the task's branch, against ${i.envName} (\`${i.envBranch}\`).`,
    "",
    "## The task, as the builder was given it",
    "",
    i.packet.trim(),
    "",
    "## The checks on this commit",
    "",
    ...i.checks.length ? i.checks : ["- none recorded"],
    "",
    ...i.rules?.trim() ? ["## The project's rules", "", i.rules.trim(), ""] : [],
    "## What changed",
    "",
    "```",
    i.stat.trim() || "(no files changed)",
    "```",
    "",
    i.diff.length > DIFF_MAX ? "The diff is too long to include here. Read the changed files listed above." : ["```diff", i.diff.trim(), "```"].join("\n")
  ].join("\n");
  return { system, prompt };
}
function parseReview(stdout) {
  let r;
  try {
    r = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() ?? "");
  } catch {
    throw new AccError("review", `The reviewer gave no result Claude Code could read: ${stdout.trim().slice(0, 200) || "(nothing)"}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || s.verdict !== "pass" && s.verdict !== "changes" || typeof s.summary !== "string") {
    throw new AccError("review", `The review didn't finish with a verdict (${r.subtype ?? "no result"}): ${String(r.result ?? "").slice(0, 300)}`);
  }
  const criteria = (Array.isArray(s.criteria) ? s.criteria : []).filter((c) => typeof c?.text === "string").map((c) => ({ text: c.text, met: c.met === true, evidence: String(c.evidence ?? "") }));
  const findings = (Array.isArray(s.findings) ? s.findings : []).filter((f) => typeof f?.message === "string").map((f) => ({
    message: f.message,
    must: f.must === true,
    ...typeof f.file === "string" && f.file ? { file: f.file } : {},
    ...Number.isInteger(f.line) ? { line: f.line } : {},
    ...typeof f.rule === "string" && f.rule ? { rule: f.rule } : {}
  }));
  const verdict = s.verdict === "pass" && findings.some((f) => f.must) ? "changes" : s.verdict;
  const client = typeof s.client === "string" && s.client.trim() ? { client: s.client.trim() } : {};
  return { verdict: { verdict, summary: s.summary, ...client, criteria, findings }, sessionId: typeof r.session_id === "string" ? r.session_id : null, costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null };
}
var git3 = (run2, cwd, ...args) => run2("git", args, { cwd });
function baseRef(run2, root, branch) {
  return git3(run2, root, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`).code === 0 ? `origin/${branch}` : branch;
}
function review(paths, config, id, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (task.state !== "review") throw new AccError("refused", `${id} is ${task.state}. A review is for work that's in review: acc done, or a person, moves it there.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("review", `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const worktree = task.run?.worktree;
  if (!branch) throw new AccError("review", `${id} has no branch to review.`);
  if (!worktree || !existsSync7(worktree)) throw new AccError("review", `${id}'s worktree isn't on disk any more, so there's nothing for the reviewer to read.`);
  const sha = git3(run2, paths.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).stdout.trim();
  if (!sha) throw new AccError("review", `The branch ${branch} isn't in this clone.`);
  const missing = receiptHooks(paths, config, run2).missingGates(task);
  if (missing.length) throw new AccError("refused", `${id}'s checks aren't settled on ${sha.slice(0, 7)}: ${missing.join(", ")}. Run acc gate run in its worktree, or waive them, then review.`);
  const base = baseRef(run2, paths.root, env.branch);
  const diff = git3(run2, paths.root, "diff", "--no-color", "--find-renames", `${base}...${sha}`).stdout;
  const stat = git3(run2, paths.root, "diff", "--stat=120", "--find-renames", `${base}...${sha}`).stdout;
  const receipts = receiptsAt(paths, sha);
  const checks = Object.values(receipts).map((r) => `- ${r.gate}: ${r.waived ? `waived (it was ${r.waived.was ?? "not run"}), because ${r.waived.reason}` : `${r.status}. ${r.summary}`}`);
  const packetFile = join10(paths.packets, `${id}.md`);
  const packet = existsSync7(packetFile) ? readFileSync11(packetFile, "utf8") : `# ${task.id}: ${task.title}

${task.brief}`;
  const rulesFile = join10(worktree, ".acc", "rules.md");
  const rules = existsSync7(rulesFile) ? readFileSync11(rulesFile, "utf8") : null;
  const { system, prompt } = reviewPrompt({ task, config, envName: env.name, envBranch: env.branch, sha, packet, diff, stat, checks, rules });
  const sessionId = (deps.uuid ?? randomUUID2)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: "review" });
  mkdirSync11(paths.reviews, { recursive: true });
  const marker = runningPath2(paths, id);
  const startedAt = now2();
  writeFileSync12(marker, JSON.stringify({ sessionId, name, sha, startedAt: startedAt.toISOString(), pid: process.pid }));
  deps.onStart?.(sessionId, sha, name);
  const awake = holdAwake(process.pid, deps.awake);
  let out2;
  try {
    out2 = run2("claude", [
      "-p",
      "--session-id",
      sessionId,
      "--name",
      name,
      "--permission-mode",
      "dontAsk",
      ...agentArgs(config.agents.reviewer),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(VERDICT_SCHEMA),
      "--append-system-prompt",
      system,
      "--allowedTools",
      "Read",
      "Grep",
      "Glob",
      "--disallowedTools",
      "Bash",
      "Edit",
      "Write",
      "NotebookEdit",
      "WebFetch",
      "WebSearch"
    ], { cwd: worktree, input: prompt, env: { ...deps.env, ACC_ROLE: "reviewer", ACC_TASK: id }, timeoutMs: 45 * 6e4 });
  } finally {
    awake?.release();
    rmSync7(marker, { force: true });
  }
  if (out2.timedOut) throw new AccError("review", `The review didn't finish within 45 minutes, so acc stopped it.`);
  if (out2.code === 127 && !out2.stdout) throw new AccError("review", `Claude Code didn't start: ${out2.stderr.trim().split("\n")[0] ?? "claude not found"}`);
  const parsed = parseReview(out2.stdout);
  const finished = now2();
  const verdict = {
    v: 1,
    task: id,
    sha,
    env: env.branch,
    ...parsed.verdict,
    sessionId: parsed.sessionId ?? sessionId,
    name,
    at: finished.toISOString(),
    durationMs: finished.getTime() - startedAt.getTime(),
    costUsd: parsed.costUsd
  };
  const file = reviewPath(paths, id, sha);
  writeFileSync12(`${file}.tmp`, JSON.stringify(verdict, null, 2) + "\n");
  renameSync6(`${file}.tmp`, file);
  const actor = opts.actor ?? "reviewer";
  const by = opts.by ?? `reviewer:${id}`;
  const moved = mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (t.state !== "review") return null;
    if (verdict.verdict === "changes") {
      const req = { to: "rework", actor, by, reason: `Review asked for changes: ${verdict.summary}` };
      const problems = checkMove(l3, config, t, req, noGateHooks);
      if (problems.length) throw new AccError("move-refused", problems.join(" "));
      applyMove(t, req, emit, now2);
      return "rework";
    }
    if (t.autopilot?.failed) t.autopilot.failed = null;
    emit({ type: "task.updated", task: id, actor, by, data: { reviewed: { sha, verdict: verdict.verdict } } });
    return null;
  });
  return { verdict, moved };
}

// packages/core/src/carried.ts
function arrivedAt(t, branch) {
  if (t.environment === branch && t.pr?.state === "merged") return t.pr.mergeSha ?? t.pr.sha;
  const merged = (t.promotions ?? []).filter((p) => p.to === branch && p.state === "merged" && p.mergeSha);
  return merged.sort((a, b) => (a.mergedAt ?? a.at).localeCompare(b.mergedAt ?? b.at))[0]?.mergeSha;
}
var git4 = (run2, root, ...args) => run2("git", args, { cwd: root });
function carriedTasks(paths, run2, plan) {
  const on = (sha, tip) => git4(run2, paths.root, "merge-base", "--is-ancestor", sha, tip).code === 0;
  const reached = readLedger(paths.ledger).tasks.filter((t) => {
    const at2 = arrivedAt(t, plan.from.branch);
    return !!at2 && !arrivedAt(t, plan.to.branch) && on(at2, plan.fromSha);
  });
  if (!reached.length) return [];
  const others = [...new Set(reached.map((t) => t.environment).filter((b) => b !== plan.from.branch))];
  if (others.length) git4(run2, paths.root, "fetch", "--quiet", "origin", ...others);
  const moving = /* @__PURE__ */ new Set([...plan.files, ...plan.deleted]);
  return reached.filter((t) => {
    const own = t.pr?.state === "merged" ? t.pr.mergeSha ?? t.pr.sha : void 0;
    if (!own) return true;
    const r = git4(run2, paths.root, "diff-tree", "-r", "-z", "--no-commit-id", "--name-only", "-m", "--first-parent", own);
    if (r.code !== 0) return true;
    return r.stdout.split("\0").some((f) => moving.has(f));
  });
}

// packages/core/src/updates.ts
import { mkdirSync as mkdirSync12, readdirSync as readdirSync4, readFileSync as readFileSync12, renameSync as renameSync7, rmSync as rmSync8, writeFileSync as writeFileSync13 } from "node:fs";
import { join as join11 } from "node:path";
var STALE_POSTING_MS = 5 * 6e4;
var UPDATE_TEXT_MAX = 65536;
var UPDATE_ID = /^[A-Z][A-Z0-9_]*-\d+\.\d{1,6}$/;
var REPLACES_MAX = 20;
var updateFile = (paths, id) => join11(paths.updates, `${id}.json`);
var EVENT_WORDS = {
  "pr-opened": "ready for review",
  "pr-updated": "updated for review",
  merged: "merged",
  "promotion-opened": "promotion opened",
  promoted: "promoted",
  deployed: "deployed",
  blocked: "a question for the client",
  question: "a question from its analysis"
};
function ticketOf(task) {
  const { kind, key, url } = task.source;
  if (!isTrackerKind(kind) || !key) return null;
  return { tracker: kind, key, url };
}
function githubIssue(u, repo) {
  const m = u.url ? /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/.exec(u.url) : null;
  if (m) return { repo: m[1], number: m[2] };
  const n = /(\d+)$/.exec(u.key)?.[1];
  return n && repo ? { repo, number: n } : null;
}
var sentence = (text) => text.trim().replace(/([^.!?])$/, "$1.");
function updateText(event, c) {
  const summary = c.summary?.trim() ? `
${sentence(c.summary)}` : "";
  switch (event) {
    case "pr-opened":
      return `The change is ready for review: ${c.pr?.url ?? ""}${summary}`;
    case "pr-updated":
      return `The change was updated and is ready for review again: ${c.pr?.url ?? ""}${summary}`;
    case "merged":
      return `The change was approved and merged into ${c.env ?? "its environment"}.`;
    case "promotion-opened":
      return `The change is ready to go to ${c.env ?? "its next environment"}: ${c.pr?.url ?? ""}`;
    case "promoted":
      return `The change is now in ${c.env ?? "its next environment"}.`;
    case "deployed":
      return `The change is now deployed to ${c.env ?? "its environment"}.`;
    case "blocked":
      return `We need your input before we can go on:
${sentence(c.question ?? "")}`;
    case "question":
      return `Before we start, a question for you:
${sentence(c.question ?? "")}`;
  }
}
function readUpdate(paths, id) {
  if (!UPDATE_ID.test(id)) return null;
  try {
    const u = JSON.parse(readFileSync12(updateFile(paths, id), "utf8"));
    return u.v === 1 && u.id === id ? u : null;
  } catch {
    return null;
  }
}
function listUpdates(paths) {
  let names2;
  try {
    names2 = readdirSync4(paths.updates);
  } catch {
    return [];
  }
  const out2 = names2.filter((n) => n.endsWith(".json")).map((n) => readUpdate(paths, n.slice(0, -5))).filter((u) => !!u);
  return out2.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, void 0, { numeric: true }));
}
var isOpenUpdate = (u) => u.state === "draft" || u.state === "posting";
var stalePosting = (u, now2) => u.state === "posting" && !!u.posting && now2.getTime() - Date.parse(u.posting.at) > STALE_POSTING_MS;
function writeUpdate(paths, u) {
  const file = updateFile(paths, u.id);
  writeFileSync13(`${file}.tmp`, JSON.stringify(u, null, 2) + "\n");
  renameSync7(`${file}.tmp`, file);
}
function locked(paths, fn2) {
  mkdirSync12(paths.updates, { recursive: true });
  return withLock(`${paths.updates}.lock`, fn2);
}
var sameNews = (a, b) => {
  const family = (e) => e === "pr-opened" || e === "pr-updated" ? "pr" : e;
  return a.task === b.task && family(a.event) === family(b.event) && (a.env ?? "") === (b.env ?? "") && (a.question ?? "") === (b.question ?? "");
};
var STAGE = { "pr-opened": 0, "pr-updated": 0, merged: 1, "promotion-opened": 1, promoted: 2, deployed: 3 };
var overtakes = (next, old) => {
  const n = STAGE[next.event];
  const o = STAGE[old.event];
  if (next.task !== old.task || n === void 0 || o === void 0 || n <= o) return false;
  return o === 0 || (old.env ?? "") === (next.env ?? "");
};
function draftUpdate(paths, task, input, by, now2) {
  const ticket = ticketOf(task);
  if (!ticket) return null;
  return locked(paths, () => {
    const all = listUpdates(paths);
    const mine = all.filter((u2) => u2.task === task.id);
    const replaced = mine.find((u2) => u2.state === "draft" && sameNews(u2, { task: task.id, ...input }));
    const overtaken = mine.filter((u2) => u2.state === "draft" && u2 !== replaced && overtakes({ task: task.id, ...input }, u2));
    const gone = [...replaced ? [replaced] : [], ...overtaken];
    const event = input.event === "pr-updated" && replaced?.event === "pr-opened" ? "pr-opened" : input.event;
    const text = event === input.event && input.text !== void 0 ? input.text : updateText(event, { ...input.context, ...input.pr ? { pr: input.pr } : {}, ...input.env ? { env: input.env } : {} });
    const n = Math.max(0, ...mine.map((u2) => Number(u2.id.slice(task.id.length + 1)) || 0)) + 1;
    const u = {
      v: 1,
      id: `${task.id}.${n}`,
      task: task.id,
      tracker: ticket.tracker,
      key: ticket.key,
      url: ticket.url,
      event,
      text,
      state: "draft",
      ...input.env ? { env: input.env } : {},
      ...input.pr ? { pr: { number: input.pr.number, url: input.pr.url } } : {},
      ...input.question ? { question: input.question } : {},
      createdAt: now2().toISOString(),
      by,
      ...gone.length ? { replaces: gone.flatMap((r) => [r.id, ...r.replaces ?? []]).slice(0, REPLACES_MAX) } : {}
    };
    writeUpdate(paths, u);
    for (const r of gone) rmSync8(updateFile(paths, r.id), { force: true });
    return u;
  });
}
function change(paths, id, check2, apply) {
  return locked(paths, () => {
    const u = readUpdate(paths, id);
    if (!u) throw new AccError("no-update", `No update ${id}. acc updates lists them.`);
    const why = check2(u);
    if (why) throw new AccError("refused", why);
    const next = apply(u);
    writeUpdate(paths, next);
    return next;
  });
}
var stateWords = (u) => u.state === "posted" ? `was posted${u.posted ? ` by ${u.posted.by.replace(/^human:/, "")}` : ""}` : u.state === "discarded" ? "was discarded" : "is being posted";
function claimUpdate(paths, id, by, now2, opts = {}) {
  return change(paths, id, (u) => {
    if (u.state === "draft") return null;
    if (u.state === "posting" && opts.again && stalePosting(u, now2())) return null;
    if (u.state === "posting" && stalePosting(u, now2())) return `${id} may have posted already: it was being posted at ${u.posting.at} and never confirmed. Look at ${u.key} first. If it isn't there, post it again with --again.`;
    return `${id} ${stateWords(u)}.`;
  }, (u) => ({ ...u, state: "posting", posting: { at: now2().toISOString(), by } }));
}
function markPosted(paths, id, posted, now2) {
  return change(paths, id, (u) => u.state === "posting" ? null : `${id} ${u.state === "draft" ? "wasn't claimed for posting" : stateWords(u)}.`, (u) => {
    const { failed: _failed, ...rest } = u;
    return { ...rest, state: "posted", posted: { at: now2().toISOString(), by: posted.by, text: posted.text, ...posted.url ? { url: posted.url } : {} } };
  });
}
function releaseUpdate(paths, id, reason, now2) {
  return change(paths, id, (u) => u.state === "posting" ? null : `${id} ${u.state === "draft" ? "is a draft already" : stateWords(u)}.`, (u) => {
    const { posting: _posting, ...rest } = u;
    return { ...rest, state: "draft", failed: { at: now2().toISOString(), reason: reason.trim() || "it didn't say why" } };
  });
}
function discardUpdate(paths, id, by, now2) {
  return change(paths, id, (u) => u.state === "draft" || stalePosting(u, now2()) ? null : `${id} ${stateWords(u)}.`, (u) => {
    const { posting: _posting, ...rest } = u;
    return { ...rest, state: "discarded", discarded: { at: now2().toISOString(), by } };
  });
}

// packages/core/src/closing.ts
var GH_CALL_MS = 6e4;
var ALREADY_CLOSED = "it was already closed";
var STOOD_IN = /* @__PURE__ */ new Set(["pr-opened", "pr-updated", "merged"]);
function editsTracker(config) {
  const tracker = config.trackers.find((t) => t.kind === "github");
  return tracker?.edits && config.github ? tracker : null;
}
var closesIssues = (config) => !!editsTracker(config);
function issueToClose(config, task) {
  const tracker = editsTracker(config);
  const n = /^GH-(\d+)$/.exec(task.id)?.[1];
  if (task.source.kind !== "github" || !tracker || !n) return null;
  return { repo: tracker.repo ?? config.github.repo, number: Number(n) };
}
function closeText(config, task, repo) {
  const env = environmentByBranch(config, task.environment)?.name ?? task.environment;
  const prRepo = config.github?.repo;
  const ref = prRepo && prRepo.toLowerCase() !== repo.toLowerCase() ? `${prRepo}#${task.pr.number}` : `#${task.pr.number}`;
  return `Done: pull request ${ref} merged into ${env}.`;
}
var firstLine = (r) => (r.stderr || r.stdout).trim().split("\n")[0] || `gh exited with ${r.code}.`;
function look(run2, env, repo, n, leaveReopened) {
  const r = run2("gh", ["issue", "view", String(n), "-R", repo, "--json", "state,stateReason,url"], { env, timeoutMs: GH_CALL_MS });
  if (r.code !== 0) {
    const why = firstLine(r);
    return /could not resolve to an issue/i.test(why) ? { close: false, outcome: "left", reason: "GitHub can't find it" } : { close: false, outcome: "failed", reason: why };
  }
  let issue;
  try {
    issue = JSON.parse(r.stdout);
  } catch {
    return { close: false, outcome: "failed", reason: "gh's answer wasn't JSON" };
  }
  const lives = issueRepo(issue.url);
  if (lives && lives.toLowerCase() !== repo.toLowerCase()) return { close: false, outcome: "left", reason: `it moved to ${lives}` };
  const state = String(issue.state ?? "").toUpperCase();
  if (state === "CLOSED") return { close: false, outcome: "left", reason: ALREADY_CLOSED };
  if (state !== "OPEN") return { close: false, outcome: "failed", reason: "gh didn't say whether it's open" };
  if (leaveReopened && String(issue.stateReason ?? "").toUpperCase() === "REOPENED") return { close: false, outcome: "left", reason: "it was reopened" };
  return { close: true };
}
function close(run2, env, repo, n, text) {
  const r = run2("gh", ["issue", "close", String(n), "-R", repo, "--reason", "completed", "--comment", text], { env, timeoutMs: GH_CALL_MS });
  if (r.code === 0) return { outcome: "closed" };
  return { outcome: "failed", reason: r.timedOut ? `gh stopped at its timeout, and may have closed it: ${firstLine(r)}` : firstLine(r) };
}
function settleCloses(paths, config, deps, opts = {}) {
  const { run: run2, now: now2, env } = deps;
  const tidy = !!opts.tidy;
  const tasks = readLedger(paths.ledger).tasks.filter((t) => t.state === "done" && (tidy ? t.pr?.state === "merged" && !t.pr.issue : t.pr?.issue?.state === "pending"));
  const results = [];
  for (const t of tasks) {
    const pr = t.pr;
    const key = t.id.replace(/^GH-/, "#");
    const target = issueToClose(config, t);
    if (!target) {
      if (!tidy) results.push({ task: t.id, key, pr: pr.number, outcome: "left", reason: `its tracker doesn't say "edits": true now` });
      continue;
    }
    const seen = look(run2, env, target.repo, target.number, tidy || !!pr.issue?.reason);
    if (!seen.close) results.push({ task: t.id, key, pr: pr.number, outcome: seen.outcome, reason: seen.reason });
    else if (opts.plan) results.push({ task: t.id, key, pr: pr.number, outcome: "to close" });
    else results.push({ task: t.id, key, pr: pr.number, ...close(run2, env, target.repo, target.number, closeText(config, { environment: t.environment, pr }, target.repo)) });
  }
  if (opts.plan || !results.length) return results;
  const at2 = now2().toISOString();
  mutate(paths, now2, (ledger, emit) => {
    for (const r of results) {
      const t = ledger.tasks.find((x2) => x2.id === r.task);
      if (!t?.pr || t.pr.number !== r.pr || t.pr.issue && t.pr.issue.state !== "pending") continue;
      const issue = r.outcome === "failed" ? { state: "pending", at: at2, reason: r.reason ?? "" } : { state: r.outcome === "closed" ? "closed" : "left", at: at2, ...r.reason ? { reason: r.reason } : {} };
      if (t.pr.issue?.state === issue.state && t.pr.issue.reason === issue.reason) continue;
      t.pr = { ...t.pr, issue };
      emit({ type: "task.updated", task: t.id, actor: opts.actor ?? "sync", by: opts.by ?? "acc sync", data: { pr: t.pr } });
    }
  });
  const settled = results.filter((r) => r.outcome === "closed" || r.reason === ALREADY_CLOSED);
  const drafts = settled.length ? listUpdates(paths) : [];
  for (const r of settled) {
    const gone = [];
    for (const u of drafts) {
      if (u.task !== r.task || u.state !== "draft" || !STOOD_IN.has(u.event)) continue;
      try {
        discardUpdate(paths, u.id, "acc sync", now2);
        gone.push(u.id);
      } catch {
      }
    }
    if (gone.length) r.discarded = gone;
  }
  return results;
}
function closeWords(r, plan = false) {
  const drafts = r.discarded?.length ? `; discarded its unposted update${r.discarded.length === 1 ? "" : "s"} ${r.discarded.join(", ")}` : "";
  switch (r.outcome) {
    case "closed":
      return `closed issue ${r.key}${drafts}`;
    case "to close":
      return `would close issue ${r.key}`;
    case "left":
      return `${plan ? "would leave" : "left"} issue ${r.key} as it is: ${r.reason}${drafts}`;
    case "failed":
      return plan ? `couldn't look at issue ${r.key}: ${r.reason}` : `couldn't close issue ${r.key} (${r.reason}): the next sync tries again`;
  }
}

// packages/core/src/sync.ts
var mergeShaOf = (p) => p.mergeCommit?.oid && /^[0-9a-f]{40,64}$/.test(p.mergeCommit.oid) ? p.mergeCommit.oid : void 0;
var FAILED = /* @__PURE__ */ new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
function ciOf(rollup) {
  const items = rollup ?? [];
  if (!items.length) return null;
  if (items.some((c) => FAILED.has(String(c.conclusion ?? "").toUpperCase()) || FAILED.has(String(c.state ?? "").toUpperCase()))) return "failing";
  if (items.some((c) => c.status && c.status.toUpperCase() !== "COMPLETED" || ["PENDING", "EXPECTED"].includes(String(c.state ?? "").toUpperCase()))) return "pending";
  return "passing";
}
function failingOf(rollup) {
  const failed = (rollup ?? []).filter((c) => FAILED.has(String(c.conclusion ?? "").toUpperCase()) || FAILED.has(String(c.state ?? "").toUpperCase()));
  return [...new Set(failed.map((c) => c.name || c.context || c.workflowName || "").filter(Boolean))];
}
var FETCH_TIMEOUT_MS = 2 * 6e4;
function fetchBranches(run2, root, branches, env) {
  const refs = [...new Set(branches)].map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`);
  return run2("git", ["fetch", "--quiet", "--no-tags", "origin", ...refs], { cwd: root, env, timeoutMs: FETCH_TIMEOUT_MS }).code === 0;
}
function conflictsOf(run2, root, base, head) {
  const r = run2("git", ["merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", `origin/${base}`, `origin/${head}`], { cwd: root });
  const [tree, ...files] = r.stdout.split("\0");
  if (r.code !== 0 && r.code !== 1 || !/^[0-9a-f]{40,64}$/.test(tree ?? "")) return null;
  return r.code === 0 ? [] : [...new Set(files.filter(Boolean))];
}
function sync(paths, config, deps) {
  const { run: run2, now: now2 } = deps;
  const tasks = readLedger(paths.ledger).tasks;
  const open = tasks.filter((t) => t.pr?.state === "open");
  const promotions = [...new Set(tasks.flatMap((t) => (t.promotions ?? []).filter((p) => p.state === "open").map((p) => p.pr.number)))];
  const closing = tasks.some((t) => t.pr?.issue?.state === "pending");
  if (!open.length && !promotions.length && !closing) return { checked: 0, changes: [] };
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json, so there are no pull requests to follow.');
  const token = run2("gh", ["auth", "token", "-u", gh.account]);
  if (token.code !== 0) throw new AccError("no-github", `gh isn't logged in as ${gh.account}, the account this repo works as.`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  const view = (n, fields) => {
    const r = run2("gh", ["pr", "view", String(n), "-R", gh.repo, "--json", fields], { env, timeoutMs: 6e4 });
    if (r.code !== 0) return void 0;
    try {
      return JSON.parse(r.stdout);
    } catch {
      return void 0;
    }
  };
  const seen = /* @__PURE__ */ new Map();
  for (const t of open) {
    const p = view(t.pr.number, "number,state,url,reviewDecision,baseRefName,headRefName,mergeCommit,statusCheckRollup");
    if (p) seen.set(t.pr.number, p);
  }
  const promoted = /* @__PURE__ */ new Map();
  for (const n of promotions) {
    const p = view(n, "number,state,url,mergeCommit,mergedAt");
    if (p) promoted.set(n, p);
  }
  const branches = /* @__PURE__ */ new Map();
  for (const t of open) {
    const p = seen.get(t.pr.number);
    const base = p?.baseRefName || t.environment;
    const head = p?.headRefName || t.run?.branch;
    if (p?.state === "OPEN" && head) branches.set(p.number, { base, head });
  }
  const conflicts = /* @__PURE__ */ new Map();
  if (branches.size && fetchBranches(run2, paths.root, [...branches.values()].flatMap((b) => [b.base, b.head]), { ...deps.env, GIT_TERMINAL_PROMPT: "0" })) {
    for (const [n, b] of branches) {
      const files = conflictsOf(run2, paths.root, b.base, b.head);
      if (files) conflicts.set(n, files);
    }
  }
  const at2 = now2().toISOString();
  const arrived = [];
  const closed = [];
  const changes = mutate(paths, now2, (ledger2, emit) => {
    const out2 = [];
    for (const t of ledger2.tasks) {
      const p = t.pr && t.pr.state === "open" ? seen.get(t.pr.number) : void 0;
      if (!p || !t.pr) continue;
      const before = JSON.stringify(t.pr);
      const ci = ciOf(p.statusCheckRollup);
      const changesRequested = p.reviewDecision === "CHANGES_REQUESTED";
      let moved = null;
      let note = "";
      if (p.state === "MERGED") {
        const mergeSha = mergeShaOf(p);
        t.pr = { ...t.pr, state: "merged", ci, ...mergeSha ? { mergeSha } : {}, syncedAt: at2 };
        const req = { to: "done", actor: "sync", by: "acc sync", reason: `Pull request #${p.number} merged.` };
        if (t.state === "review" && !checkMove(ledger2, config, t, req, noGateHooks).length) {
          moved = { from: t.state, to: "done" };
          applyMove(t, req, emit, now2);
          if (issueToClose(config, t)) t.pr.issue = { state: "pending", at: at2 };
        }
        note = `#${p.number} merged`;
      } else if (p.state === "CLOSED") {
        t.pr = { ...t.pr, state: "closed", ci, syncedAt: at2 };
        const req = { to: "blocked", actor: "sync", by: "acc sync", reason: `Pull request #${p.number} was closed without merging. Reopen it, or decide what happens to ${t.id}.` };
        if (t.state !== "blocked" && t.state !== "done" && !checkMove(ledger2, config, t, req, noGateHooks).length) {
          moved = { from: t.state, to: "blocked" };
          applyMove(t, req, emit, now2);
        }
        note = `#${p.number} closed without merging`;
      } else {
        const files = conflicts.get(p.number) ?? t.pr.conflicts;
        const failing = ci === "failing" ? failingOf(p.statusCheckRollup) : [];
        t.pr = { ...t.pr, url: p.url, ci, changesRequested, ...files ? { conflicts: files } : {}, syncedAt: at2 };
        if (failing.length) t.pr.failing = failing;
        else delete t.pr.failing;
        const why = [
          changesRequested ? "a person asked for changes" : "",
          ci === "failing" ? "checks failing" : "",
          files?.length ? `conflicts with ${branches.get(p.number)?.base ?? t.environment} in ${files.join(", ")}` : ""
        ].filter(Boolean);
        note = why.length ? `#${p.number}: ${why.join("; ")}` : `#${p.number} open${ci ? `, checks ${ci}` : ""}`;
      }
      const after = JSON.stringify({ ...t.pr, syncedAt: void 0 });
      if (moved || after !== JSON.stringify({ ...JSON.parse(before), syncedAt: void 0 })) {
        emit({ type: "task.updated", task: t.id, actor: "sync", by: "acc sync", data: { pr: t.pr } });
        out2.push({ task: t.id, pr: p.number, moved, note });
      }
    }
    for (const t of ledger2.tasks) {
      for (const promotion of t.promotions ?? []) {
        const p = promotion.state === "open" ? promoted.get(promotion.pr.number) : void 0;
        if (!p || p.state !== "MERGED" && p.state !== "CLOSED") continue;
        const env2 = environmentByBranch(config, promotion.to)?.name ?? promotion.to;
        const change2 = { task: t.id, pr: promotion.pr.number, moved: null, note: "" };
        if (p.state === "MERGED") {
          const before = arrivedAt(t, promotion.to);
          const mergeSha = mergeShaOf(p);
          promotion.state = "merged";
          if (mergeSha) promotion.mergeSha = mergeSha;
          if (p.mergedAt && !Number.isNaN(Date.parse(p.mergedAt))) promotion.mergedAt = p.mergedAt;
          change2.note = `promotion #${p.number} merged into ${env2}`;
          if (!before) arrived.push({ change: change2, env: env2 });
        } else {
          promotion.state = "closed";
          change2.note = `promotion #${p.number} to ${env2} closed without merging`;
          closed.push({ change: change2, pr: p.number });
        }
        emit({ type: "task.updated", task: t.id, actor: "sync", by: "acc sync", data: { promotion } });
        out2.push(change2);
      }
    }
    return out2;
  });
  for (const c of changes) if (c.moved?.from === "running") releaseAwake(paths, c.task);
  const ledger = readLedger(paths.ledger);
  for (const c of changes) {
    if (c.moved?.to !== "done") continue;
    const t = ledger.tasks.find((x2) => x2.id === c.task);
    if (!t || t.pr?.issue) continue;
    try {
      const u = draftUpdate(paths, t, { event: "merged", env: environmentByBranch(config, t.environment)?.name ?? t.environment }, "acc sync", now2);
      if (u) c.update = { id: u.id, key: u.key };
    } catch (e) {
      c.note += `; no update drafted: ${e.message}`;
    }
  }
  for (const { change: change2, env: env2 } of arrived) {
    const t = ledger.tasks.find((x2) => x2.id === change2.task);
    if (!t) continue;
    try {
      const u = draftUpdate(paths, t, { event: "promoted", env: env2 }, "acc sync", now2);
      if (u) change2.update = { id: u.id, key: u.key };
    } catch (e) {
      change2.note += `; no update drafted: ${e.message}`;
    }
  }
  const drafts = closed.length ? listUpdates(paths) : [];
  for (const { change: change2, pr } of closed) {
    const gone = [];
    for (const u of drafts) {
      if (u.task !== change2.task || u.event !== "promotion-opened" || u.pr?.number !== pr || u.state !== "draft") continue;
      try {
        discardUpdate(paths, u.id, "acc sync", now2);
        gone.push(u.id);
      } catch {
      }
    }
    if (gone.length) change2.note += `; discarded its unposted update ${gone.join(", ")}`;
  }
  for (const r of settleCloses(paths, config, { run: run2, now: now2, env })) {
    const issue = { key: r.key, outcome: r.outcome, ...r.reason ? { reason: r.reason } : {} };
    const c = changes.find((x2) => x2.task === r.task && x2.pr === r.pr && x2.moved?.to === "done");
    if (c) {
      c.issue = issue;
      c.note += `; ${closeWords(r)}`;
    } else changes.push({ task: r.task, pr: r.pr, moved: null, note: closeWords(r), issue });
  }
  return { checked: seen.size + promoted.size, changes };
}

// packages/core/src/land.ts
var PUSH_TIMEOUT_MS = 5 * 6e4;
var GH_TIMEOUT_MS = 2 * 6e4;
var LAND_TIMEOUT_MS = PUSH_TIMEOUT_MS + FETCH_TIMEOUT_MS + 3 * GH_TIMEOUT_MS + 6e4;
var UPDATE_POST_TIMEOUT_MS = 2 * GH_TIMEOUT_MS + 6e4;
var STATUS_WORD = { pass: "Passed", fail: "Failed", error: "Couldn't run", skip: "Didn't apply" };
var cell = (s) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
function mergesWords(autoMerge) {
  return autoMerge ? "With autopilot running, it merges once its checks pass on GitHub and nothing waits on a person: auto-merge is on for this repo. Ask for changes to hold it." : "It merges only when a person merges it.";
}
function prBody(task, env, sha, verdict, receipts, autoMerge = false) {
  const ticket = task.source.url ? `[${task.source.key ?? task.id}](${task.source.url})` : null;
  const lines = [
    verdict.summary.trim(),
    "",
    ...ticket ? [`Ticket: ${ticket}${task.source.kind === "github" && task.source.key ? ` (refs ${task.source.key})` : ""}`, ""] : [],
    "## Acceptance criteria",
    "",
    ...verdict.criteria.length ? verdict.criteria.map((c) => `- [${c.met ? "x" : " "}] ${c.text}${c.evidence ? ` (${c.evidence})` : ""}`) : ["_The reviewer listed none._"],
    "",
    `## Checks on ${sha.slice(0, 7)}`,
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...Object.values(receipts).map((r) => `| \`${r.gate}\` | ${r.waived ? `Waived by ${r.waived.by.replace(/^human:/, "")}` : STATUS_WORD[r.status] ?? r.status} | ${cell(r.waived ? r.waived.reason : r.summary)} |`),
    "",
    "## Review",
    "",
    `Passed by a reviewer agent that read the change and couldn't edit it.`,
    ...verdict.findings.length ? ["", "Worth a look, not blocking:", "", ...verdict.findings.map((f) => `- ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`: ` : ""}${f.message}`)] : [],
    "",
    "---",
    `Built by a Claude Code agent and opened by \`acc land\` into \`${env.branch}\` (${env.name}). ${mergesWords(autoMerge)}`
  ];
  return lines.join("\n") + "\n";
}
function ghToken(run2, account) {
  const t = run2("gh", ["auth", "token", "-u", account], { timeoutMs: GH_TIMEOUT_MS });
  if (t.code !== 0 || !t.stdout.trim()) throw new AccError("no-github", `gh isn't logged in as ${account}, the account this repo works as. Sign in from the Command Center, or run gh auth login.`);
  return t.stdout.trim();
}
function land(paths, config, id, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (task.state !== "review") throw new AccError("refused", `${id} is ${task.state}. A task lands from review, once its review has passed.`);
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'acc land opens a pull request on GitHub, and this project has no "github" section in .acc/config.json.');
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("land", `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  if (!branch) throw new AccError("land", `${id} has no branch to land.`);
  const sha = run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim();
  if (!sha) throw new AccError("land", `The branch ${branch} isn't in this clone.`);
  const missing = receiptHooks(paths, config, run2).missingGates(task);
  if (missing.length) throw new AccError("refused", `${id}'s checks aren't settled on ${sha.slice(0, 7)}: ${missing.join(", ")}.`);
  const verdict = readVerdict(paths, id, sha);
  if (!verdict) throw new AccError("refused", `${id} hasn't been reviewed on ${sha.slice(0, 7)}. Run acc review ${id} first.`);
  if (verdict.verdict !== "pass") throw new AccError("refused", `${id}'s review on ${sha.slice(0, 7)} asked for changes: ${verdict.summary}`);
  const ghEnv3 = { ...deps.env, GH_TOKEN: ghToken(run2, gh.account) };
  const ghRun = (args) => run2("gh", args, { cwd: paths.root, env: ghEnv3, timeoutMs: GH_TIMEOUT_MS });
  const open = ghRun(["pr", "list", "-R", gh.repo, "--head", branch, "--state", "open", "--json", "number,url"]);
  const existing = open.code === 0 ? JSON.parse(open.stdout || "[]")[0] : void 0;
  if (!existing && task.pr && opts.actor === "orchestrator") {
    const seen = open.code === 0 ? "isn't open on GitHub" : `may not be open on GitHub: gh couldn't list the branch's pull requests (${(open.stderr || open.stdout).trim().split("\n")[0] || `exit ${open.code}`})`;
    throw new AccError("land", `Pull request #${task.pr.number} ${seen}. Autopilot won't open another: a person decides.`);
  }
  const push = run2("git", ["push", "--set-upstream", "origin", `${branch}:${branch}`], { cwd: paths.root, env: deps.env, timeoutMs: PUSH_TIMEOUT_MS });
  if (push.code !== 0) throw new AccError("land", `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split("\n").slice(-2).join(" ")}`);
  const receipts = receiptsAt(paths, sha);
  const body = prBody(task, env, sha, verdict, receipts, autoMergeFor(config, env.branch));
  const dir = mkdtempSync(join12(tmpdir(), "acc-land-"));
  let pr;
  let opened;
  try {
    const bodyFile = join12(dir, "body.md");
    writeFileSync14(bodyFile, body);
    if (existing) {
      const edit = ghRun(["pr", "edit", String(existing.number), "-R", gh.repo, "--body-file", bodyFile]);
      if (edit.code !== 0) throw new AccError("land", `Couldn't update pull request #${existing.number}: ${edit.stderr.trim().split("\n")[0]}`);
      pr = { number: existing.number, url: existing.url, state: "open", landedAt: now2().toISOString(), sha };
      opened = false;
    } else {
      const create = ghRun(["pr", "create", "-R", gh.repo, "--base", env.branch, "--head", branch, "--title", `${task.id}: ${task.title}`, "--body-file", bodyFile]);
      const url = create.stdout.trim().split("\n").find((l3) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(l3.trim()))?.trim();
      if (create.code !== 0 || !url) throw new AccError("land", `gh couldn't open the pull request: ${(create.stderr || create.stdout).trim().split("\n")[0]}`);
      pr = { number: Number(/\/pull\/(\d+)/.exec(url)[1]), url, state: "open", landedAt: now2().toISOString(), sha };
      opened = true;
    }
  } finally {
    rmSync9(dir, { recursive: true, force: true });
  }
  const conflicts = fetchBranches(run2, paths.root, [env.branch, branch], deps.env) ? conflictsOf(run2, paths.root, env.branch, branch) : null;
  if (conflicts) pr = { ...pr, conflicts };
  const updated = mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    t.pr = pr;
    if (t.autopilot?.failed) t.autopilot.failed = null;
    t.updatedAt = now2().toISOString();
    emit({ type: "task.updated", task: id, actor: opts.actor ?? "human", by: opts.by ?? "acc land", data: { pr, sha, opened } });
    return t;
  });
  try {
    const update = draftUpdate(paths, task, {
      event: opened ? "pr-opened" : "pr-updated",
      pr: { number: pr.number, url: pr.url },
      context: { summary: verdict.client?.trim() || task.title }
    }, opts.by ?? "acc land", now2);
    return { task: updated, sha, pr, opened, update: update ? { id: update.id, key: update.key } : null };
  } catch (e) {
    return { task: updated, sha, pr, opened, update: null, updateError: e.message };
  }
}

// packages/core/src/checks.ts
var LOG_TAIL_LINES = 100;
var LOG_TAIL_BYTES = 10 * 1024;
var MAX_LOGS = 5;
var NO_ACTIONS_LOG = "GitHub keeps no log for it: it isn't a GitHub Actions job.";
var short = (sha) => sha.slice(0, 7) || "no commit";
var firstLine2 = (r) => (r.stderr || r.stdout).trim().split("\n")[0]?.trim() || `exit ${r.code}`;
var said = (r) => `${r.stderr}
${r.stdout}`;
var JOB_LINK = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)(?:[/?#]|$)/;
function actionsJob(link) {
  const m = JOB_LINK.exec(link);
  if (!m) return null;
  return { repo: m[1] === "github.com" ? m[2] : `${m[1]}/${m[2]}`, id: m[3] };
}
function headOf(run2, repo, pr, env) {
  const r = run2("gh", ["pr", "view", String(pr), "-R", repo, "--json", "headRefOid"], { env, timeoutMs: GH_TIMEOUT_MS });
  let sha = "";
  try {
    sha = parseJsonOutput(r.stdout).headRefOid ?? "";
  } catch {
    sha = "";
  }
  if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) throw new AccError("checks", `gh couldn't read pull request #${pr}: ${firstLine2(r)}`);
  return sha;
}
function listOf2(r) {
  try {
    const list = parseJsonOutput(r.stdout);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
function readChecks(run2, repo, pr, env) {
  const sha = headOf(run2, repo, pr, env);
  const checks = (...more) => run2("gh", ["pr", "checks", String(pr), "-R", repo, ...more, "--json", "name,bucket,link,workflow,state"], { env, timeoutMs: GH_TIMEOUT_MS });
  let required = true;
  let r = checks("--required");
  let list = listOf2(r);
  if (!list && /no required checks reported/i.test(said(r))) {
    required = false;
    r = checks();
    list = listOf2(r);
  }
  if (!list && /no checks reported/i.test(said(r))) {
    required = false;
    list = [];
  }
  if (!list) throw new AccError("checks", `gh couldn't read pull request #${pr}'s checks: ${firstLine2(r)}`);
  const name = (c) => c.name || c.workflow || "a check";
  const failed = list.filter((c) => c.bucket === "fail").map((c) => ({ name: name(c), workflow: c.workflow ?? "", link: c.link ?? "", job: actionsJob(c.link ?? "") }));
  const pending = list.filter((c) => c.bucket === "pending").map(name);
  const cancelled = list.filter((c) => c.bucket === "cancel").map(name);
  return { sha, required, failed, pending, cancelled, count: list.length };
}
var CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
var PREFIX = /^[^\t\n]*\t[^\t\n]*\t/;
var STAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
function tailLog(text, lines = LOG_TAIL_LINES, bytes = LOG_TAIL_BYTES) {
  const all = text.replace(/\r\n?/g, "\n").split("\n").map((l3) => l3.replace(CSI, "").replace(PREFIX, "").replace(STAMP, "").trimEnd());
  while (all.length && !all.at(-1)) all.pop();
  const kept = [];
  let size = 0;
  for (const line of all.slice(-lines).reverse()) {
    const b = Buffer.byteLength(line) + (kept.length ? 1 : 0);
    if (size + b > bytes) {
      if (!kept.length) kept.push(Buffer.from(line).subarray(-bytes).toString("utf8").replace(/^�+/, ""));
      break;
    }
    kept.push(line);
    size += b;
  }
  return kept.reverse().join("\n");
}
function fetchLog(run2, job, env) {
  const view = (flag) => run2("gh", ["run", "view", "--job", job.id, flag, "-R", job.repo], { env, timeoutMs: GH_TIMEOUT_MS });
  let r = view("--log-failed");
  if (r.code === 0 && !tailLog(r.stdout)) r = view("--log");
  if (r.code !== 0) return { error: firstLine2(r) };
  const log = tailLog(r.stdout);
  return log ? { log } : { error: "GitHub gave an empty log." };
}
var checksPath = (paths, task, sha) => join13(paths.checks, `${task}-${sha}.json`);
function readChecksReport(paths, task, sha) {
  try {
    const r = JSON.parse(readFileSync13(checksPath(paths, task, sha), "utf8"));
    return r.v === 1 && r.task === task && Array.isArray(r.checks) ? r : null;
  } catch {
    return null;
  }
}
var fence = (text) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
var sentence2 = (text) => text.trim().replace(/([^.!?])$/, "$1.");
function checksSection(r) {
  if (!r?.checks.length) return [];
  const which = r.required ? "checks its base branch requires" : "its checks";
  const lines = [
    "## What GitHub's checks said",
    "",
    `This is a rework. Your change is pull request #${r.pr.number}, and ${which} failed on GitHub on ${short(r.sha)}: ${r.checks.map((c) => c.name).join(", ")}. Its review passed: these failures are all there is to fix.`,
    "",
    "Reproduce each failure here and fix it, keeping the rest of the change as it is. Then finish as below: commit, run `acc gate run`, then `acc done`. If a failure isn't caused by this change, such as a check that fails on the base branch too or a service that was down, don't work around it: run `acc block \"<what you found>\"` and stop.",
    ""
  ];
  for (const c of r.checks) {
    lines.push(`### ${c.name}${c.workflow && c.workflow !== c.name ? ` (${c.workflow})` : ""}`, "");
    if (c.link) lines.push(`Link: ${c.link}`, "");
    if (c.log) {
      const f = fence(c.log);
      lines.push("The end of its log:", "", `${f}text`, c.log, f, "");
    } else lines.push(`Couldn't fetch its log: ${sentence2(c.noLog ?? "GitHub gave none")}`, "");
  }
  return lines;
}
function sendBack(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open") throw new AccError("refused", `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : " with no pull request"}. Autopilot sends back the open pull request of a task in review.`);
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json, so there are no checks to read.');
  const branch = task.run?.branch;
  const head = branch ? run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim() : "";
  if (!head) throw new AccError("checks", `${id}'s branch isn't in this clone.`);
  const moved = (why) => new AccError("checks-moved", why);
  if (pr.sha !== head) throw moved(`Pull request #${pr.number} was landed at ${short(pr.sha ?? "")}, not ${short(head)}: a land comes first.`);
  const env = { ...deps.env, GH_TOKEN: ghToken(run2, gh.account) };
  const read = readChecks(run2, gh.repo, pr.number, env);
  const away = (sha) => moved(`Pull request #${pr.number} is at ${short(sha)} on GitHub, not ${short(head)}.`);
  if (read.sha !== head) throw away(read.sha);
  if (read.pending.length) throw moved(`Checks are still running on GitHub: ${read.pending.join(", ")}.`);
  if (!read.failed.some((c) => c.job)) throw moved(read.failed.length ? `Checks failed on GitHub with no log there: ${read.failed.map((c) => c.name).join(", ")}.` : "Its checks no longer fail on GitHub.");
  let fetched = 0;
  const checks = read.failed.map((c) => {
    const base = { name: c.name, workflow: c.workflow, link: c.link };
    if (!c.job) return { ...base, log: null, noLog: NO_ACTIONS_LOG };
    if (fetched >= MAX_LOGS) return { ...base, log: null, noLog: `Not fetched: autopilot reads the logs of ${MAX_LOGS} checks at most.` };
    fetched++;
    const got = fetchLog(run2, c.job, env);
    return "log" in got ? { ...base, log: got.log, noLog: null } : { ...base, log: null, noLog: got.error };
  });
  const still = headOf(run2, gh.repo, pr.number, env);
  if (still !== head) throw away(still);
  const names2 = checks.map((c) => c.name);
  const at2 = now2().toISOString();
  const report = { v: 1, task: id, sha: head, pr: { number: pr.number, url: pr.url }, required: read.required, checks, at: at2 };
  mkdirSync13(paths.checks, { recursive: true });
  const file = checksPath(paths, id, head);
  writeFileSync15(file, JSON.stringify(report, null, 2) + "\n");
  const reason = `Checks failed on GitHub on ${short(head)}: ${names2.join(", ")}.`;
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t) throw new AccError("no-task", `No task ${id}.`);
    if (t.pr?.sha !== head) throw moved(`Pull request #${pr.number} was landed again meanwhile.`);
    const req = { to: "rework", actor: opts.actor, by: opts.by, reason };
    const problems = checkMove(l3, config, t, req, noGateHooks);
    if (problems.length) throw new AccError("move-refused", `Can't send ${id} back:
- ${problems.join("\n- ")}`);
    applyMove(t, req, emit, now2, { checks: names2, sha: head });
    const sentBack = { sha: head, checks: names2, at: at2 };
    t.autopilot = { failed: null, ...t.autopilot, sentBack };
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { autopilot: { sentBack } } });
  });
  return { sha: head, checks: names2, report: file, reason: `Sent it back to its builder: ${reason[0].toLowerCase()}${reason.slice(1)}` };
}

// packages/core/src/dispatch.ts
function slugify(title, max = 40) {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let out2 = "";
  for (const w of words) {
    const next = out2 ? `${out2}-${w}` : w;
    if (next.length > max) break;
    out2 = next;
  }
  return out2 || "task";
}
var taskBranch = (task) => `task/${task.id}-${slugify(task.title)}`;
function mainCheckout(run2, cwd) {
  const r = run2("git", ["worktree", "list", "--porcelain"], { cwd });
  const first = /^worktree (.+)$/m.exec(r.stdout)?.[1];
  if (r.code !== 0 || !first) throw new AccError("not-a-repo", `${cwd} isn't inside a git repository.`);
  return first;
}
function worktreeRoot(config, main2) {
  const root = config.worktrees.root;
  if (!root) return join14(main2, ".claude", "worktrees");
  return isAbsolute(root) ? root : resolve(main2, root);
}
var isClaudeWorktree = (main2, wt2) => wt2.startsWith(join14(main2, ".claude", "worktrees") + sep);
function claudeStatePath(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join14(env.CLAUDE_CONFIG_DIR, ".claude.json") : join14(env.HOME || homedir3(), ".claude.json");
}
function isTrusted(folder, env = process.env) {
  let state;
  try {
    state = JSON.parse(readFileSync14(claudeStatePath(env), "utf8"));
  } catch {
    return false;
  }
  const keys = /* @__PURE__ */ new Set([folder, folder.normalize("NFC")]);
  try {
    keys.add(realpathSync(folder));
  } catch {
  }
  return [...keys].some((k2) => state.projects?.[k2]?.hasTrustDialogAccepted === true);
}
function reviewSection(v) {
  if (!v || v.verdict !== "changes") return [];
  const where = (f) => f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`: ` : "";
  const must2 = v.findings.filter((f) => f.must);
  const unmet = v.criteria.filter((c) => !c.met);
  return [
    "## What the review asked for",
    "",
    `This is a rework. The reviewer looked at ${v.sha.slice(0, 7)} and asked for changes: ${v.summary}`,
    "",
    ...must2.map((f) => `- ${where(f)}${f.message}${f.rule ? ` (rule: ${f.rule})` : ""}`),
    ...unmet.map((c) => `- Not met yet: ${c.text}. ${c.evidence}`),
    ...must2.length || unmet.length ? [""] : [],
    "Fix these, and keep the rest of the change as it is. Then finish as below.",
    ""
  ];
}
function commitRef(task) {
  if (task.source.kind === "github") return ` Add \`refs #${task.id.replace(/^GH-/, "")}\` on its own line, so GitHub links the commit to the issue.`;
  return "";
}
function renderPacket(p) {
  const { task, config, env } = p;
  const sf = config.profile === "salesforce";
  const required = config.gates.required;
  const lines = [
    `# Task ${task.id}: ${task.title}`,
    "",
    `You are the builder for ${task.id}. Work only on this task, only in this worktree, and stop when it's done.`,
    ""
  ];
  if (p.enterWorktree) {
    lines.push(
      "## First, before anything else",
      "",
      `Call the **EnterWorktree** tool with the path \`${p.worktree}\`. Do this before reading or editing any file. Your session starts in the main checkout, which you must never change. Claude Code keeps you inside the worktree once you've entered it.`,
      ""
    );
  }
  lines.push(
    "## The task",
    "",
    task.brief.trim() || "_No details were given beyond the title. If the title alone is too vague to build from, block (see the finish line) and say what you need._",
    "",
    task.source.url ? `Ticket: ${task.source.url}` : `Source: ${task.source.kind}`,
    "",
    ...analysisSection(p.analysis ?? null),
    ...reviewSection(p.review),
    ...checksSection(p.checks),
    "## Where you are",
    "",
    `- **Worktree:** \`${p.worktree}\`. This is your only workspace.`,
    `- **Branch:** \`${p.branch}\`, started from \`${env.branch}\`, the ${env.name} environment's branch.`
  );
  if (sf && env.org) lines.push(`- **Org:** \`${env.org}\` (${env.name}). It's already this worktree's default org.`);
  lines.push(
    "",
    "## How to work",
    "",
    `- **Commits:** \`${task.id}: <what changed>\`, one logical change per commit.${commitRef(task)} Never write "fixes", "closes" or "resolves" in a commit message; the ticket is closed by a person.`,
    "- **Changes:** keep them to what the task asks. If you find something else that needs fixing, mention it in your final message instead of fixing it."
  );
  if (sf) {
    lines.push(
      "- **Salesforce:** validate, never deploy. `acc gate run validate` proves a change with a check-only deploy to the org; nothing is saved. Real deploys happen after a person merges.",
      '- **Tests:** if you change Apex, name the test classes that cover it and why each is the right one: `acc gate run validate --test <TestClass>="<why>"`, once per class.'
    );
  }
  lines.push("", "## The finish line", "");
  lines.push("1. **Commit** everything the task needs. Leave nothing uncommitted.");
  if (required.length) {
    lines.push(
      `2. **Checks:** run exactly \`acc gate run\`. It runs the required checks (${required.map((g) => `\`${g}\``).join(", ")}) on your latest commit and records each result; \`acc done\` refuses until every one has passed. If one fails, fix it, commit, and run \`acc gate run\` again. If a check can't run at all (it says error), block and quote its message.`
    );
    if (sf) {
      lines.push('   If you changed Apex, add `--test <TestClass>="<why it covers the change>"` once per test class, for example `acc gate run --test AccountServiceTest="covers the new discount rule"`. Those flags are the only thing to add.');
    }
  } else {
    lines.push("2. **Checks:** run the project's tests or build if it has them, and report the results.");
  }
  lines.push(
    "3. **Finish** by running exactly `acc done`, as its own command. It is already on your PATH and pre-approved. Don't run it through npm scripts, `npx`, or other wrappers, and don't chain it with other commands, or it will stop for permission. If you're stuck, run exactly `acc block \"<what you need>\"` instead, and stop.",
    "   If only the client can answer what you need (a business rule, access you don't have, or a choice that's theirs to make), run exactly `acc block --client \"<your question>\"` instead, and stop. Write the question for the client, in plain words with no code, file or tool names: a person reads it before it goes on the ticket.",
    ...p.accPath ? [`   If \`acc\` really isn't found, its full path is \`${p.accPath}\`.`] : [],
    "4. **Summarize** in your final message: what changed, how you checked it, and anything a reviewer should look at.",
    "",
    "## Never",
    "",
    "- push, merge, or open a pull request (a person and `acc land` do that)"
  );
  if (sf) lines.push("- deploy to any org (`sf project deploy start`)");
  lines.push(
    "- edit files outside this worktree, or check out another branch",
    "- change the ticket or the task list, apart from `acc done` and `acc block`"
  );
  if (p.environmentSpecific.length) {
    lines.push("- edit an environment-specific file (D-016). Each org keeps its own version of these:", ...p.environmentSpecific.map((f) => `  - \`${f}\``));
  }
  if (p.rules?.trim()) lines.push("", "## Project rules", "", p.rules.trim());
  return lines.join("\n") + "\n";
}
function builderSettings(task, config, accBinDir2, basePath, accCommand2) {
  const sf = config.profile === "salesforce";
  const allow = [
    "Bash(acc done*)",
    "Bash(acc block *)",
    "Bash(acc show *)",
    "Bash(acc gate run)",
    "Bash(acc gate run *)",
    "Bash(acc gate list*)",
    "Bash(git status*)",
    "Bash(git diff*)",
    "Bash(git add *)",
    "Bash(git commit *)",
    "Bash(git log*)",
    "Bash(git show *)",
    "Bash(npm test*)",
    "Bash(npm run *)",
    "Bash(npx prettier *)",
    "Bash(npx eslint *)",
    "Bash(node --test*)",
    "Bash(node --no-warnings --test*)",
    // A project may ask for builds and tests under nice, so the machine stays usable: the same commands, niced.
    "Bash(nice -n 15 npm test*)",
    "Bash(nice -n 15 npm run *)",
    "Bash(nice -n 15 npx prettier *)",
    "Bash(nice -n 15 npx eslint *)",
    "Bash(nice -n 15 node --test*)",
    "Bash(nice -n 15 node --no-warnings --test*)",
    ...sf ? ["Bash(sf project deploy validate *)", "Bash(sf code-analyzer run *)", "Bash(sf apex run test *)", "Bash(sf data query *)"] : []
  ];
  const deny2 = [
    "Bash(git push*)",
    "Bash(gh pr *)",
    "Bash(git checkout *)",
    "Bash(git switch *)",
    "Bash(git worktree *)",
    "Bash(git reset --hard*)",
    "Bash(acc set *)",
    "Bash(acc dispatch *)",
    "Bash(acc init*)",
    "Bash(acc gate waive*)",
    "Bash(acc land*)",
    "Bash(acc review*)",
    "Bash(acc autopilot*)",
    "Bash(acc agents autonomy*)",
    "Bash(acc agents auto-merge*)",
    "Bash(acc analyze*)",
    "Bash(acc analysis answer*)",
    "Bash(acc promote*)",
    "Bash(acc deploy*)",
    "Bash(acc update*)",
    "Bash(acc resume*)",
    "Bash(acc machine*)",
    "Bash(acc sync --close-done*)",
    // Releases are a person's (D-079): npm run * is allowed above, and deny beats allow.
    "Bash(gh release create*)",
    "Bash(gh release upload*)",
    "Bash(gh release edit*)",
    "Bash(gh release delete*)",
    "Bash(npm run release*)",
    "Bash(nice -n 15 npm run release*)",
    ...sf ? ["Bash(sf project deploy start*)", "Bash(sf project deploy quick*)", "Bash(sf org delete *)"] : []
  ];
  return {
    env: { ACC_TASK: task.id, ACC_ROLE: "builder", PATH: `${accBinDir2}:${basePath}` },
    permissions: { allow, deny: deny2 },
    // Its permission prompts and questions go to the Command Center when one is open (D-030).
    ...accCommand2 ? { hooks: permissionHook(accCommand2) } : {}
  };
}
var git5 = (run2, cwd, ...args) => run2("git", args, { cwd });
function ensureWorktree(run2, main2, wt2, branch, env) {
  if (existsSync8(wt2)) {
    const inside = git5(run2, wt2, "rev-parse", "--abbrev-ref", "HEAD");
    if (inside.code !== 0) throw new AccError("dispatch", `${wt2} exists but isn't a git worktree. Move it aside and dispatch again.`);
    if (inside.stdout.trim() !== branch) throw new AccError("dispatch", `${wt2} is on ${inside.stdout.trim()}, not ${branch}.`);
    return true;
  }
  mkdirSync14(dirname3(wt2), { recursive: true });
  git5(run2, main2, "fetch", "--quiet", "origin", env.branch);
  const hasLocal = git5(run2, main2, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).code === 0;
  let r;
  if (hasLocal) r = git5(run2, main2, "worktree", "add", wt2, branch);
  else {
    const remote = `refs/remotes/origin/${env.branch}`;
    const base = git5(run2, main2, "rev-parse", "--verify", "--quiet", remote).code === 0 ? `origin/${env.branch}` : env.branch;
    if (git5(run2, main2, "rev-parse", "--verify", "--quiet", base).code !== 0) throw new AccError("dispatch", `There's no "${env.branch}" branch to start from.`);
    r = git5(run2, main2, "worktree", "add", "--no-track", "-b", branch, wt2, base);
  }
  if (r.code !== 0) throw new AccError("dispatch", `git couldn't create the worktree: ${r.stderr.trim()}`);
  return false;
}
function setupWorktree(run2, config, env, main2, wt2) {
  if (config.profile === "salesforce" && env.org) {
    mkdirSync14(join14(wt2, ".sf"), { recursive: true });
    writeFileSync16(join14(wt2, ".sf", "config.json"), JSON.stringify({ "target-org": env.org }, null, 2) + "\n");
  }
  if (existsSync8(join14(main2, "node_modules")) && !existsSync8(join14(wt2, "node_modules"))) {
    symlinkSync(join14(main2, "node_modules"), join14(wt2, "node_modules"), "dir");
    excludeEverywhere(run2, main2, "node_modules");
  }
  for (const cmd of config.worktrees.setup) {
    const r = run2("sh", ["-c", cmd], { cwd: wt2 });
    if (r.code !== 0) throw new AccError("dispatch", `Setup command failed in the worktree: ${cmd}
${(r.stderr || r.stdout).trim()}`);
  }
}
function excludeEverywhere(run2, main2, pattern) {
  const common = run2("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: main2 }).stdout.trim();
  if (!common) return;
  const file = join14(common, "info", "exclude");
  const text = existsSync8(file) ? readFileSync14(file, "utf8") : "";
  if (text.split("\n").some((l3) => l3.trim() === pattern)) return;
  mkdirSync14(dirname3(file), { recursive: true });
  writeFileSync16(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}# Added by acc: worktrees link node_modules from the main checkout.
${pattern}
`);
}
function readList2(wt2, rel) {
  if (!rel || !existsSync8(join14(wt2, rel))) return [];
  return readFileSync14(join14(wt2, rel), "utf8").split("\n").map((l3) => l3.trim()).filter((l3) => l3 && !l3.startsWith("#"));
}
var sleep2 = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function samePlace(a, b) {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
function findSession(run2, cwd, name, waitMs, o = {}) {
  const until = Date.now() + waitMs;
  let found = null;
  const ours = (x2) => x2.name === name && x2.kind === "background" && (o.since === void 0 || (x2.startedAt ?? 0) >= o.since) && (!o.places || !x2.cwd || o.places.some((p) => samePlace(x2.cwd, p)));
  do {
    const r = run2("claude", ["agents", "--json"], { cwd, timeoutMs: 2e4 });
    try {
      const list = JSON.parse(r.stdout);
      const s = list.filter(ours).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
      if (s) {
        found = { bgId: s.id ?? null, sessionId: s.sessionId ?? null, pid: Number.isInteger(s.pid) && s.pid > 0 ? s.pid : null };
        if (found.pid) return found;
      }
    } catch {
    }
    if (Date.now() < until) sleep2(500);
  } while (Date.now() < until);
  return found ?? { bgId: null, sessionId: null, pid: null };
}
var LAUNCH_SLACK_MS = 5e3;
function builderModel(task, config, chosen) {
  const picked = chosen ?? (task.run?.modelPicked ? task.run.model : void 0);
  return picked ? { model: picked, picked: true } : { model: modelOf(config.agents.builder), picked: false };
}
function dispatch(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  if (opts.model !== void 0) checkModelName(opts.model);
  const before = readLedger(paths.ledger);
  const found = before.tasks.find((t) => t.id === id);
  if (!found) throw new AccError("no-task", `No task ${id}.`);
  const req = { to: "running", actor: opts.actor, by: opts.by };
  const problems = checkMove(before, config, found, req, noGateHooks);
  if (problems.length) throw new AccError("move-refused", `Can't dispatch ${id}:
- ${problems.join("\n- ")}`);
  const held = analysisProblems(paths, config, found);
  if (held.length && !(opts.withoutAnalysis && opts.actor === "human")) throw new AccError("move-refused", `Can't dispatch ${id}:
- ${held.join("\n- ")}`);
  const env = environmentByBranch(config, found.environment);
  if (!env) throw new AccError("dispatch", `${id}'s environment "${found.environment}" isn't in the config.`);
  const main2 = mainCheckout(run2, paths.root);
  const wt2 = join14(worktreeRoot(config, main2), found.id);
  const enter = isClaudeWorktree(main2, wt2);
  const launchDir = enter ? main2 : wt2;
  if (!opts.foreground && enter && !isTrusted(main2, deps.env)) {
    throw new AccError("not-trusted", `Claude Code doesn't trust ${main2} yet, so it won't start a background agent there. Run \`claude\` once in that folder, accept the trust prompt, then type /exit and dispatch again.`);
  }
  const branch = found.run?.branch ?? taskBranch(found);
  const reused = ensureWorktree(run2, main2, wt2, branch, env);
  setupWorktree(run2, config, env, main2, wt2);
  const rules = existsSync8(join14(wt2, ".acc", "rules.md")) ? readFileSync14(join14(wt2, ".acc", "rules.md"), "utf8") : null;
  const rework = found.state === "rework";
  const head = rework && reworkCause(found) === "checks" ? git5(run2, paths.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).stdout.trim() : "";
  const packet = renderPacket({
    task: found,
    config,
    env,
    worktree: wt2,
    branch,
    rules,
    environmentSpecific: readList2(wt2, config.environmentSpecific),
    enterWorktree: enter && !opts.foreground,
    accPath: join14(deps.accBinDir, "acc"),
    review: rework ? latestVerdict(paths, found.id) : null,
    analysis: readAnalysis(paths, found.id),
    checks: head ? readChecksReport(paths, found.id, head) : null
  });
  mkdirSync14(paths.packets, { recursive: true });
  const packetPath = join14(paths.packets, `${found.id}.md`);
  writeFileSync16(packetPath, packet);
  const settings = JSON.stringify(builderSettings(found, config, deps.accBinDir, deps.env.PATH ?? "", deps.accCommand));
  const prompt = `Read your task instructions below and do the task.

${packet}`;
  const n = (found.run?.n ?? (found.run ? 1 : 0)) + 1;
  const name = sessionName({ project: config.project, key: found.id, title: found.title, role: "builder", n });
  const { model, picked } = builderModel(found, config, opts.model);
  const base = ["--name", name, "--permission-mode", config.agents.permissionMode, ...agentArgs({ ...config.agents.builder, model }), "--settings", settings];
  const record = (bgId2, sessionId2) => mutate(paths, now2, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    const again = checkMove(ledger, config, task, req, noGateHooks);
    if (again.length) throw new AccError("move-refused", `Can't dispatch ${id}:
- ${again.join("\n- ")}`);
    applyMove(task, { ...req, reason: reused ? `re-dispatched in ${basename3(wt2)}` : null }, emit, now2, opts.cause ? { cause: opts.cause } : {});
    task.run = { worktree: wt2, branch, startedAt: now2().toISOString(), model, ...picked ? { modelPicked: true } : {}, ...bgId2 ? { bgId: bgId2 } : {}, ...sessionId2 ? { sessionId: sessionId2 } : {}, name, n };
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { run: task.run } });
    return task;
  });
  if (opts.foreground) {
    const task = record(null, null);
    const awake = holdAwake(process.pid, deps.awake);
    try {
      spawnSync3("claude", [...base, prompt], { cwd: wt2, stdio: "inherit", env: deps.env });
    } finally {
      awake?.release();
    }
    return { task, worktree: wt2, branch, reused, packetPath, bgId: null, sessionId: null, name };
  }
  const since = Date.now() - LAUNCH_SLACK_MS;
  const launched = run2("claude", ["--bg", ...base, prompt], { cwd: launchDir, env: deps.env, timeoutMs: 6e4 });
  if (launched.code !== 0) throw new AccError("dispatch", `Claude Code didn't start the agent: ${(launched.stderr || launched.stdout).trim().split("\n")[0]}. The worktree is kept at ${wt2}.`);
  const { bgId, sessionId, pid } = findSession(run2, launchDir, name, deps.findSessionMs ?? 8e3, { since, places: [launchDir, wt2] });
  try {
    const task = record(bgId, sessionId);
    if (pid) keepAwakeFor(paths, id, pid, deps.awake);
    return { task, worktree: wt2, branch, reused, packetPath, bgId, sessionId, name };
  } catch (e) {
    if (bgId) run2("claude", ["stop", bgId], { cwd: wt2 });
    throw e;
  }
}
function cleanup(paths, config, id, run2, now2) {
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const wt2 = task.run?.worktree ?? null;
  if (!wt2 || !existsSync8(wt2)) return { removed: false, reasons: ["It has no worktree on disk."], worktree: wt2 };
  const reasons = [];
  if (task.state === "running") reasons.push(`${id} is still running. Abandon it or let it finish first.`);
  const dirty = git5(run2, wt2, "status", "--porcelain").stdout.trim();
  if (dirty) reasons.push(`The worktree has ${dirty.split("\n").length} uncommitted change(s).`);
  const env = environmentByBranch(config, task.environment);
  const branch = task.run?.branch;
  if (branch && env) {
    const main3 = mainCheckout(run2, paths.root);
    git5(run2, main3, "fetch", "--quiet", "origin", env.branch);
    const target = git5(run2, main3, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${env.branch}`).code === 0 ? `origin/${env.branch}` : env.branch;
    const ahead = Number(git5(run2, main3, "rev-list", "--count", `${target}..${branch}`).stdout.trim() || "0");
    const merged = git5(run2, main3, "merge-base", "--is-ancestor", branch, target).code === 0;
    if (ahead > 0 && !merged) reasons.push(`${branch} has ${ahead} commit(s) that aren't in ${target} yet.`);
  }
  if (reasons.length) return { removed: false, reasons, worktree: wt2 };
  const main2 = mainCheckout(run2, paths.root);
  const r = git5(run2, main2, "worktree", "remove", wt2);
  if (r.code !== 0) return { removed: false, reasons: [`git refused: ${r.stderr.trim()}`], worktree: wt2 };
  if (branch) git5(run2, main2, "branch", "-D", branch);
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (t.run) delete t.run.worktree;
    emit({ type: "task.updated", task: id, actor: "human", by: "acc cleanup", data: { worktreeRemoved: wt2 } });
  });
  return { removed: true, reasons: [], worktree: wt2 };
}

// packages/core/src/init.ts
import { existsSync as existsSync10 } from "node:fs";
import { join as join16 } from "node:path";

// packages/core/src/github.ts
var CLONE_ACCOUNT_KEY = "acc.githubAccount";
var credentialHelper = (fallback) => `!f() { test "$1" = get || exit 0; a=$(git config --get ${CLONE_ACCOUNT_KEY} || echo ${fallback}); echo username=$a; echo "password=$(gh auth token -u $a)"; }; f`;
var LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
function cloneAccount(run2, root) {
  const r = run2("git", ["config", "--get", CLONE_ACCOUNT_KEY], { cwd: root });
  const v = r.stdout.trim();
  return r.code === 0 && LOGIN.test(v) ? v : null;
}
function withCloneAccount(config, root, run2) {
  if (!config.github) return config;
  const mine = cloneAccount(run2, root);
  return mine && mine !== config.github.account ? { ...config, github: { ...config.github, account: mine } } : config;
}
function parseGhStatus(text) {
  const out2 = [];
  for (const block of text.split(/(?=Logged in to )/)) {
    const m = /^Logged in to github\.com account (\S+)/.exec(block);
    if (!m) continue;
    const scopes = /Token scopes: (.*)/.exec(block)?.[1] ?? "";
    out2.push({ login: m[1], active: /Active account: true/.test(block), scopes: [...scopes.matchAll(/'([^']+)'/g)].map((s) => s[1]) });
  }
  return out2;
}
function ghAccounts(run2, env = process.env) {
  const r = run2("gh", ["auth", "status", "--hostname", "github.com"], { env });
  if (r.code === 127) return null;
  return parseGhStatus(r.stdout + r.stderr);
}
function pushSetup(run2, root) {
  const r = run2("git", ["config", "--get-all", "credential.helper"], { cwd: root });
  const helpers = r.code === 0 ? r.stdout.split("\n").filter((l3) => l3.trim()) : [];
  if (helpers.some((h2) => h2.includes(CLONE_ACCOUNT_KEY))) return { kind: "follows", account: null };
  const pinned = helpers.map((h2) => /gh auth token -u ([A-Za-z0-9-]+)/.exec(h2)?.[1]).find(Boolean);
  if (pinned) return { kind: "pinned", account: pinned };
  return { kind: helpers.length ? "other" : "none", account: null };
}
function githubIdentity(config, root, run2, env = process.env) {
  if (!config.github) return null;
  const mine = cloneAccount(run2, root);
  const account = mine ?? config.github.account;
  const accounts = ghAccounts(run2, env);
  const git9 = (k2) => {
    const r = run2("git", ["config", "--get", k2], { cwd: root });
    return r.code === 0 ? r.stdout.trim() || null : null;
  };
  const push = pushSetup(run2, root);
  return {
    repo: config.github.repo,
    account,
    from: mine && mine !== config.github.account ? "clone" : "config",
    projectAccount: config.github.account,
    signedIn: !!accounts?.some((a) => a.login.toLowerCase() === account.toLowerCase()),
    accounts,
    commit: { name: git9("user.name"), email: git9("user.email") },
    pushesAs: push.kind === "follows" ? account : push.account,
    push: push.kind
  };
}
function useGithubAccount(config, root, run2, account, env = process.env) {
  if (!config.github) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json.');
  const want = account ?? config.github.account;
  if (!LOGIN.test(want)) throw new AccError("usage", `${want} isn't a GitHub login.`);
  const accounts = ghAccounts(run2, env);
  if (accounts && !accounts.some((a) => a.login.toLowerCase() === want.toLowerCase())) {
    throw new AccError("not-signed-in", `gh isn't logged in as ${want}. Sign in first: in VSCode, "Sign in to GitHub as this repo's account"; in a terminal, gh auth login.`);
  }
  const git9 = (...args) => run2("git", args, { cwd: root });
  if (want === config.github.account) git9("config", "--unset", CLONE_ACCOUNT_KEY);
  else if (git9("config", CLONE_ACCOUNT_KEY, want).code !== 0) throw new AccError("git", `Couldn't record ${want} in this clone's git config.`);
  if (pushSetup(run2, root).kind !== "follows") {
    git9("config", "--unset-all", "credential.helper");
    git9("config", "credential.helper", "");
    git9("config", "--add", "credential.helper", credentialHelper(config.github.account));
  }
  return githubIdentity(config, root, run2, env);
}

// packages/core/src/onboarding/helpers.ts
import { existsSync as existsSync9, readFileSync as readFileSync15 } from "node:fs";
import { join as join15 } from "node:path";
var pass2 = (detail) => ({ status: "pass", detail });
var fail2 = (detail, fix) => fix ? { status: "fail", detail, fix } : { status: "fail", detail };
var unknown = (detail) => ({ status: "unknown", detail });
var skip2 = (detail) => ({ status: "skip", detail });
function makeContext(cwd, run2, env = process.env, version = null) {
  let paths = null;
  try {
    paths = repoPaths(cwd, run2);
  } catch {
    paths = null;
  }
  let config = null;
  let configErrors = [];
  if (paths && existsSync9(paths.config)) {
    try {
      const r = parseConfig(JSON.parse(readFileSync15(paths.config, "utf8")));
      config = r.config;
      configErrors = r.errors;
    } catch (e) {
      configErrors = [`.acc/config.json isn't valid JSON: ${e.message}`];
    }
  }
  if (config && paths) config = withCloneAccount(config, paths.root, run2);
  return { cwd, run: run2, env, paths, config, configErrors, cache: /* @__PURE__ */ new Map(), version };
}
function cached(ctx, key, fn2) {
  if (!ctx.cache.has(key)) ctx.cache.set(key, fn2());
  return ctx.cache.get(key);
}
function versionAtLeast(version, min) {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x2 = a[i] ?? 0;
    const y2 = b[i] ?? 0;
    if (x2 !== y2) return x2 > y2;
  }
  return true;
}
var firstVersion = (text) => /(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? null;
function sfJson(ctx, args) {
  return cached(ctx, `sf ${args.join("\0")}`, () => {
    const r = ctx.run("sf", [...args, "--json"], { cwd: ctx.paths?.root ?? ctx.cwd, env: sfEnv(ctx.env) });
    if (r.code === 127) return { status: 127, message: "The Salesforce CLI (sf) isn't installed." };
    try {
      return parseJsonOutput(r.stdout);
    } catch {
      return { status: r.code || 1, message: (r.stderr || r.stdout).trim().split("\n")[0] ?? "sf failed" };
    }
  });
}
function ghEnv2(ctx) {
  const account = ctx.config?.github?.account;
  if (!account) return null;
  return cached(ctx, `gh-token ${account}`, () => {
    const t = ctx.run("gh", ["auth", "token", "-u", account], { env: ctx.env });
    if (t.code !== 0 || !t.stdout.trim()) return null;
    return { ...ctx.env, GH_TOKEN: t.stdout.trim() };
  });
}
function parseOrgUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { kind: "unknown" };
  }
  const sb = /^([a-z0-9-]+?)--([a-z0-9]+)\.sandbox\.my\.salesforce\.com$/.exec(host);
  if (sb) return { kind: "sandbox", domain: sb[1], sandbox: sb[2] };
  const prod = /^([a-z0-9-]+)\.my\.salesforce\.com$/.exec(host);
  if (prod) return { kind: "production", domain: prod[1] };
  return { kind: "unknown" };
}
var LICENSE_TO_TYPE = {
  DEVELOPER: "developer",
  DEVELOPER_PRO: "developer_pro",
  PARTIAL: "partial",
  FULL: "full"
};
function readText(root, rel) {
  const f = join15(root, rel);
  return existsSync9(f) ? readFileSync15(f, "utf8") : null;
}
var SECRET_PATTERN = [
  "force://[A-Za-z0-9._~-]+:[^@[:space:]]+@",
  '"access_token"[[:space:]]*:[[:space:]]*"[^"]{20,}"',
  "<consumerSecret>[A-Za-z0-9]{8,}</consumerSecret>",
  "<password>[^<[:space:]]{6,}</password>",
  "sk_live_[0-9a-zA-Z]{20,}",
  "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  "gh[pousr]_[0-9A-Za-z]{30,}",
  "AKIA[0-9A-Z]{16}"
].join("|");

// packages/core/src/init.ts
var sfJson2 = (run2, root, args) => {
  const r = run2("sf", [...args, "--json"], { cwd: root, env: { ...process.env, SF_NO_UPDATE_NOTIFIER: "true", SF_DISABLE_TELEMETRY: "true" } });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: r.code || 1, message: (r.stderr || r.stdout).trim().split("\n")[0] };
  }
};
function discoverSalesforce(run2, root, productionOrg, notes) {
  const prod = sfJson2(run2, root, ["org", "display", "-o", productionOrg]);
  if (prod.status !== 0) throw new AccError("init", `"${productionOrg}" isn't logged in: ${prod.message ?? "sf failed"}`);
  const url = parseOrgUrl(String(prod.result?.instanceUrl ?? ""));
  if (url.kind !== "production") throw new AccError("init", `"${productionOrg}" isn't a Production org (${prod.result?.instanceUrl}).`);
  const q2 = sfJson2(run2, root, ["data", "query", "--use-tooling-api", "-q", "SELECT SandboxName, LicenseType FROM SandboxInfo ORDER BY SandboxName", "-o", productionOrg]);
  if (q2.status !== 0) throw new AccError("init", `Couldn't read Production's sandbox list: ${q2.message ?? "sf failed"}`);
  const sandboxes = q2.result?.records ?? [];
  const list = sfJson2(run2, root, ["org", "list"]);
  const orgs = list.status === 0 ? Object.values(list.result ?? {}).filter(Array.isArray).flat() : [];
  const aliasFor = /* @__PURE__ */ new Map();
  for (const o of [...orgs].sort((a, b) => String(a.alias).localeCompare(String(b.alias)))) {
    if (!o.alias || !o.instanceUrl) continue;
    const u = parseOrgUrl(o.instanceUrl);
    if (u.kind === "sandbox" && u.domain === url.domain && !aliasFor.has(u.sandbox)) aliasFor.set(u.sandbox, o.alias);
  }
  const envs = [{ name: "Production", type: "production", org: productionOrg, default: false, protected: true, promotesTo: [] }];
  for (const s of sandboxes) {
    const branch = branchFor(s.SandboxName);
    const type = LICENSE_TO_TYPE[s.LicenseType] ?? "partial";
    const org = aliasFor.get(branch) ?? null;
    if (!org) notes.push(`${s.SandboxName} (${type}) has no logged-in alias yet. Run: sf org login web --alias "<alias>" --instance-url https://${url.domain}--${branch}.sandbox.my.salesforce.com`);
    envs.push({ name: s.SandboxName, type, org, default: false, protected: false, promotesTo: [] });
  }
  const first = (t) => envs.find((e) => e.type === t && e.org)?.name ?? envs.find((e) => e.type === t)?.name;
  const partial = first("partial");
  const full = first("full");
  const uniq = (xs) => [...new Set(xs.filter((x2) => !!x2).map(branchFor))];
  for (const e of envs) {
    if (e.type === "developer" || e.type === "developer_pro") e.promotesTo = uniq([partial, full, "Production"]);
    else if (e.type === "partial") e.promotesTo = uniq([full, "Production"]);
    else if (e.type === "full") e.promotesTo = ["production"];
  }
  const candidates = envs.filter((e) => e.org && (e.type === "developer" || e.type === "developer_pro"));
  const fallback = envs.filter((e) => e.org && e.type !== "production");
  const def = candidates[0] ?? fallback[0];
  if (!def) throw new AccError("init", "Log in to at least one sandbox first, so day-to-day work has somewhere to go.");
  def.default = true;
  if (!candidates.length) notes.push(`There's no logged-in Developer sandbox, so "${def.name}" is the default. Agents work best against a source-tracked Developer sandbox.`);
  return envs;
}
function originRepo(run2, root) {
  const r = run2("git", ["remote", "get-url", "origin"], { cwd: root });
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(r.stdout.trim())?.[1];
}
function pushingAccount(run2, root) {
  const fill = run2("git", ["credential", "fill"], { cwd: root, input: "protocol=https\nhost=github.com\n\n", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
  if (!token) return void 0;
  const who = run2("gh", ["api", "user", "--jq", ".login"], { env: { ...process.env, GH_TOKEN: token } });
  return who.code === 0 ? who.stdout.trim() : void 0;
}
function planInit(run2, opts) {
  const notes = [];
  const root = opts.root;
  const gitGet = (k2) => run2("git", ["config", "--local", "--get", k2], { cwd: root }).stdout.trim() || void 0;
  let environments;
  if (opts.profile === "salesforce") {
    if (!opts.productionOrg) throw new AccError("init", "A Salesforce project needs --production-org <alias>, so its sandboxes can be found.");
    environments = discoverSalesforce(run2, root, opts.productionOrg, notes);
  } else {
    const head = run2("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: root }).stdout.trim().replace(/^origin\//, "");
    const cur = run2("git", ["branch", "--show-current"], { cwd: root }).stdout.trim();
    environments = [{ name: head || cur || "main", type: "none", org: null, default: true, protected: false, promotesTo: [] }];
  }
  const repo = opts.githubRepo ?? originRepo(run2, root);
  const account = opts.githubAccount ?? (repo ? pushingAccount(run2, root) : void 0);
  if (repo && !account) notes.push("Couldn't tell which GitHub account this repo pushes as. Pass --github-account.");
  const name = opts.commitName ?? gitGet("user.name");
  const email = opts.commitEmail ?? gitGet("user.email");
  const listIfPresent = (rel) => existsSync10(join16(root, rel)) ? rel : void 0;
  const raw = {
    schema: 1,
    project: opts.project ?? root.split("/").filter(Boolean).pop() ?? "project",
    profile: opts.profile,
    ...repo && account ? { github: { repo, account } } : {},
    ...name && email ? { commitIdentity: { name, email } } : {},
    environments,
    ...opts.profile === "salesforce" ? {
      environmentSpecific: listIfPresent("manifest/environment-specific.txt"),
      knownDrift: listIfPresent("manifest/known-drift.txt")
    } : {},
    trackers: opts.jiraSite && opts.jiraProject ? [{ kind: "jira", site: opts.jiraSite, project: opts.jiraProject }] : [],
    agents: { max: 3, permissionMode: "acceptEdits" },
    autonomy: "manual",
    worktrees: { root: null, setup: [] },
    gates: { required: opts.profile === "salesforce" ? ["format", "static", "validate"] : [], commands: {} }
  };
  const parsed = parseConfig(JSON.parse(JSON.stringify(raw)));
  if (!parsed.config) throw new AccError("init", `The discovered config doesn't validate:
- ${parsed.errors.join("\n- ")}`);
  return { config: parsed.config, notes };
}
function configureRepoAccess(run2, root, account, identity) {
  const git9 = (...args) => {
    const r = run2("git", args, { cwd: root });
    if (r.code !== 0) throw new AccError("init", `git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  };
  if (identity) {
    git9("config", "user.name", identity.name);
    git9("config", "user.email", identity.email);
  }
  run2("git", ["config", "--unset-all", "credential.helper"], { cwd: root });
  git9("config", "credential.helper", "");
  git9("config", "--add", "credential.helper", credentialHelper(account));
}

// packages/core/src/autopilot.ts
import { closeSync as closeSync4, mkdirSync as mkdirSync17, openSync as openSync4, readFileSync as readFileSync18, readSync as readSync3, statSync as statSync5 } from "node:fs";
import { join as join20 } from "node:path";

// packages/core/src/merge.ts
var NO_CHECKS_GRACE_MS = 2 * 6e4;
var BLOCKED_NO_CHECKS_MS = 15 * 6e4;
var MERGE_METHODS = ["merge", "squash", "rebase"];
var MERGEABLE = /* @__PURE__ */ new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS"]);
var short2 = (sha) => sha.slice(0, 7) || "no commit";
var firstLine3 = (r) => (r.stderr || r.stdout).trim().split("\n")[0]?.trim() || `exit ${r.code}`;
var under2 = (path, root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
function viewPr(run2, repo, n, env) {
  const r = run2("gh", ["pr", "view", String(n), "-R", repo, "--json", "state,headRefOid,mergeable,mergeStateStatus,reviewDecision,baseRefName,isDraft"], { env, timeoutMs: GH_TIMEOUT_MS });
  if (r.code !== 0) return null;
  try {
    return parseJsonOutput(r.stdout);
  } catch {
    return null;
  }
}
function mergeMethod(run2, repo, env) {
  const r = run2("gh", ["repo", "view", repo, "--json", "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"], { env, timeoutMs: GH_TIMEOUT_MS });
  let allowed = null;
  try {
    allowed = r.code === 0 ? parseJsonOutput(r.stdout) : null;
  } catch {
    allowed = null;
  }
  if (!allowed) throw new AccError("merge", `gh couldn't read how ${repo} merges pull requests: ${firstLine3(r)}`);
  const key = { merge: "mergeCommitAllowed", squash: "squashMergeAllowed", rebase: "rebaseMergeAllowed" };
  const method = MERGE_METHODS.find((m) => allowed[key[m]] === true);
  if (!method) throw new AccError("merge", `${repo} allows no way to merge a pull request.`);
  return method;
}
function notCovered(config, env) {
  if (config.profile === "salesforce") return "A Salesforce project never auto-merges: a person merges every pull request there.";
  if (env.protected) return `"${env.name}" is protected: a person merges into it.`;
  if (config.autonomy !== "review") return `autonomy is "${config.autonomy}": autopilot merges only under review.`;
  return "Auto-merge is off for this project: a person merges its pull requests.";
}
function mergePr(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open") throw new AccError("refused", `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : " with no pull request"}. Autopilot merges the open pull request of a task in review.`);
  const gh = config.github;
  if (!gh) throw new AccError("no-github", `This project has no "github" section in .acc/config.json, so there's no pull request to merge.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("merge", `${id}'s environment "${task.environment}" isn't in the config.`);
  if (!autoMergeFor(config, env.branch)) throw new AccError("refused", notCovered(config, env));
  const branch = task.run?.branch;
  const head = branch ? run2("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim() : "";
  if (!branch || !head) throw new AccError("merge", `${id}'s branch isn't in this clone.`);
  const wait = (why) => new AccError("merge-waits", why);
  if (task.autopilot?.merged?.sha === head) throw wait(`Autopilot already merged pull request #${pr.number}: acc sync moves ${id} to done.`);
  if (pr.sha !== head) throw wait(`Pull request #${pr.number} was landed at ${short2(pr.sha ?? "")}, not ${short2(head)}: a land comes first.`);
  if (readVerdict(paths, id, head)?.verdict !== "pass") throw wait(`${id}'s review hasn't passed on ${short2(head)}.`);
  const missing = receiptHooks(paths, config, run2).missingGates(task);
  if (missing.length) throw new AccError("merge", `Its checks aren't settled on ${short2(head)}: ${missing.join(", ")}.`);
  const wt2 = task.run?.worktree;
  if (wt2 && pendingQuestions(questionsDir(deps.env)).some((q2) => under2(q2.cwd, wt2))) throw wait(`An agent in ${id}'s worktree is waiting for your answer.`);
  if (!fetchBranches(run2, paths.root, [env.branch, branch], { ...deps.env, GIT_TERMINAL_PROMPT: "0" })) throw wait(`Couldn't fetch ${env.branch} and ${branch} from origin.`);
  const git9 = (...args) => run2("git", args, { cwd: paths.root });
  if (git9("merge-base", "--is-ancestor", `refs/remotes/origin/${env.branch}`, head).code !== 0) throw wait(`${env.branch} moved on since ${short2(head)}: autopilot merges it in first.`);
  const changed = git9("diff", "--name-only", "--no-renames", `refs/remotes/origin/${env.branch}...${head}`, "--", ".acc");
  if (changed.code !== 0) throw new AccError("merge", `git couldn't list what pull request #${pr.number} changes: ${firstLine3(changed)}`);
  const acc = changed.stdout.split("\n").filter(Boolean);
  if (acc.length) throw new AccError("merge", `It changes .acc/, which a person merges: ${acc.join(", ")}.`);
  const ghEnv3 = { ...deps.env, GH_TOKEN: ghToken(run2, gh.account) };
  const seen = viewPr(run2, gh.repo, pr.number, ghEnv3);
  if (!seen) throw wait(`gh couldn't read pull request #${pr.number}.`);
  if (seen.state === "MERGED") throw wait(`Pull request #${pr.number} is already merged on GitHub: acc sync moves ${id} to done.`);
  if (seen.state !== "OPEN") throw wait(`Pull request #${pr.number} is ${String(seen.state ?? "not open").toLowerCase()} on GitHub: acc sync follows it.`);
  if (seen.headRefOid !== head) throw wait(`Pull request #${pr.number} is at ${short2(seen.headRefOid ?? "")} on GitHub, not ${short2(head)}: a land or a person comes first.`);
  if (seen.baseRefName !== env.branch) throw new AccError("merge", `Pull request #${pr.number} merges into ${seen.baseRefName || "another branch"} on GitHub, not ${env.branch}: a person merges it.`);
  if (seen.reviewDecision === "CHANGES_REQUESTED") throw wait(`A person asked for changes on pull request #${pr.number}.`);
  if (seen.isDraft) throw new AccError("merge", `Pull request #${pr.number} is a draft on GitHub.`);
  let checks;
  try {
    checks = readChecks(run2, gh.repo, pr.number, ghEnv3);
  } catch (e) {
    throw wait(e.message);
  }
  if (checks.sha !== head) throw wait(`Pull request #${pr.number} is at ${short2(checks.sha)} on GitHub, not ${short2(head)}.`);
  if (checks.pending.length) throw wait(`Checks are still running on GitHub: ${checks.pending.join(", ")}.`);
  if (checks.failed.length) throw new AccError("merge", `Checks failed on GitHub: ${checks.failed.map((c) => c.name).join(", ")}.`);
  if (checks.cancelled.length) throw new AccError("merge", `Checks were cancelled on GitHub: ${checks.cancelled.join(", ")}. Run them again, or merge it yourself.`);
  const landed = Date.parse(pr.landedAt ?? "");
  const since = (ms) => Number.isFinite(landed) && now2().getTime() - landed < ms;
  if (!checks.count) {
    if (checks.required) throw wait(`No checks ${env.branch} requires are reported on GitHub yet.`);
    if (since(NO_CHECKS_GRACE_MS)) throw wait("No checks are reported on GitHub yet: autopilot gives them 2 minutes after a land.");
  }
  if (seen.mergeable === "CONFLICTING" || seen.mergeStateStatus === "DIRTY") throw new AccError("merge", `GitHub says pull request #${pr.number} conflicts with ${env.branch}.`);
  if (seen.mergeable !== "MERGEABLE" || !seen.mergeStateStatus || seen.mergeStateStatus === "UNKNOWN") throw wait(`GitHub is still working out whether pull request #${pr.number} can merge.`);
  if (seen.mergeStateStatus === "BEHIND") throw wait(`GitHub says pull request #${pr.number} is behind ${env.branch}: autopilot merges it in first.`);
  if (seen.mergeStateStatus === "BLOCKED" && !checks.count) {
    if (since(BLOCKED_NO_CHECKS_MS)) throw wait(`GitHub says ${env.branch}'s rules block pull request #${pr.number}, and no checks are reported on it yet: autopilot waits for the checks ${env.branch} requires.`);
    throw new AccError("merge", `GitHub won't merge pull request #${pr.number}: ${env.branch}'s rules block it, and no checks were reported on it in the 15 minutes after its land. It may need an approving review: merge it yourself.`);
  }
  if (seen.mergeStateStatus === "BLOCKED") throw new AccError("merge", `GitHub won't merge pull request #${pr.number}: ${env.branch}'s rules block it, such as a required approving review.`);
  if (!MERGEABLE.has(seen.mergeStateStatus)) throw new AccError("merge", `GitHub says pull request #${pr.number} can't merge (${seen.mergeStateStatus}).`);
  const method = mergeMethod(run2, gh.repo, ghEnv3);
  const r = run2("gh", ["pr", "merge", String(pr.number), "-R", gh.repo, `--${method}`, "--match-head-commit", head], { env: ghEnv3, timeoutMs: GH_TIMEOUT_MS });
  if (r.code !== 0) {
    const after = viewPr(run2, gh.repo, pr.number, ghEnv3);
    if (after?.state !== "MERGED") {
      if (after?.headRefOid && after.headRefOid !== head) throw wait(`Pull request #${pr.number} moved on to ${short2(after.headRefOid)} on GitHub while autopilot merged it.`);
      throw new AccError("merge", `gh couldn't merge pull request #${pr.number}: ${firstLine3(r)}${after ? "" : " GitHub didn't say afterwards whether it merged."}`);
    }
  }
  const merged = { sha: head, pr: { number: pr.number, url: pr.url }, method, at: now2().toISOString() };
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t) return;
    t.autopilot = { ...t.autopilot, failed: null, merged };
    t.updatedAt = merged.at;
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { merged } });
  });
  return { sha: head, pr: merged.pr, method, reason: `Merged pull request #${pr.number} into ${env.branch} at ${short2(head)}. acc sync moves ${id} to done.` };
}

// packages/core/src/refresh.ts
import { existsSync as existsSync11, realpathSync as realpathSync2 } from "node:fs";
var short3 = (sha) => sha.slice(0, 7);
var lastLines = (r) => (r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ");
function appendOnlyMerge(common, ours, theirs) {
  if (!ours.startsWith(common) || !theirs.startsWith(common)) return null;
  let start = common;
  let mine = ours.slice(common.length);
  let added = theirs.slice(common.length);
  if (start && !start.endsWith("\n") && (mine || added)) {
    if ([mine, added].some((t) => t && !t.startsWith("\n"))) return null;
    start += "\n";
    mine = mine.slice(1);
    added = added.slice(1);
  }
  if (mine === added) return start + mine;
  if (added.startsWith(mine)) return start + added;
  if (mine.startsWith(added)) return start + mine;
  return start + added + (added && mine && !added.endsWith("\n") ? "\n" : "") + mine;
}
function unmerged(run2, wt2) {
  const out2 = /* @__PURE__ */ new Map();
  for (const entry of run2("git", ["ls-files", "-u", "-z"], { cwd: wt2 }).stdout.split("\0")) {
    const m = /^(\d+) ([0-9a-f]+) ([123])\t(.+)$/s.exec(entry);
    if (!m) continue;
    const stages = out2.get(m[4]) ?? /* @__PURE__ */ new Map();
    stages.set(Number(m[3]), { mode: m[1], sha: m[2] });
    out2.set(m[4], stages);
  }
  return out2;
}
var isText = (s) => !s.includes("\0") && !s.includes("\uFFFD");
function resolveAppend(run2, wt2, mergeBase, path, stages) {
  const git9 = (...args) => run2("git", args, { cwd: wt2 });
  const [common, ours, theirs] = [stages.get(1), stages.get(2), stages.get(3)];
  if (!common || !ours || !theirs) return false;
  if (![common, ours, theirs].every((s) => s.mode === "100644" || s.mode === "100755")) return false;
  const at2 = (ref) => git9("rev-parse", "--verify", "--quiet", `${ref}:${path}`).stdout.trim();
  if (at2(mergeBase) !== common.sha || at2("HEAD") !== ours.sha || at2("MERGE_HEAD") !== theirs.sha) return false;
  const blobs = [common, ours, theirs].map((s) => git9("cat-file", "blob", s.sha));
  if (blobs.some((b) => b.code !== 0 || !isText(b.stdout))) return false;
  const merged = appendOnlyMerge(blobs[0].stdout, blobs[1].stdout, blobs[2].stdout);
  if (merged === null) return false;
  const blob = run2("git", ["hash-object", "-w", "--stdin"], { cwd: wt2, input: merged });
  if (blob.code !== 0) return false;
  if (git9("update-index", "--cacheinfo", `${ours.mode},${blob.stdout.trim()},${path}`).code !== 0) return false;
  return git9("checkout", "--", path).code === 0;
}
var samePath = (a, b) => {
  try {
    return realpathSync2(a) === realpathSync2(b);
  } catch {
    return a === b;
  }
};
function refresh(paths, config, id, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open") throw new AccError("refused", `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : " with no pull request"}. Autopilot updates the open pull request of a task in review.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError("refresh", `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const wt2 = task.run?.worktree;
  if (!branch) throw new AccError("refresh", `${id} has no branch.`);
  if (!wt2 || !existsSync11(wt2)) throw new AccError("refresh", `${id}'s worktree isn't on disk any more, so there's nowhere to merge ${env.branch} in.`);
  if (samePath(wt2, mainCheckout(run2, paths.root))) throw new AccError("refresh", `${id}'s worktree is the main checkout. Autopilot merges only in a task's own worktree.`);
  const git9 = (...args) => run2("git", args, { cwd: wt2 });
  const on = git9("symbolic-ref", "--quiet", "--short", "HEAD").stdout.trim();
  if (on !== branch) throw new AccError("refresh", `${wt2} is on ${on || "a detached commit"}, not ${branch}.`);
  const mid = () => git9("rev-parse", "--verify", "--quiet", "MERGE_HEAD").code === 0;
  const dirty = (untracked = true) => git9("status", "--porcelain", ...untracked ? [] : ["--untracked-files=no"]).stdout.trim() !== "";
  if (dirty() || mid()) throw new AccError("refresh", `${id}'s worktree has changes nobody committed, so autopilot leaves it alone.`);
  const from = git9("rev-parse", "HEAD").stdout.trim();
  if (!fetchBranches(run2, paths.root, [env.branch, branch], { ...deps.env, GIT_TERMINAL_PROMPT: "0" })) {
    throw new AccError("refresh", `Couldn't fetch ${env.branch} and ${branch} from origin.`);
  }
  if (git9("merge-base", "--is-ancestor", `refs/remotes/origin/${branch}`, from).code !== 0) {
    throw new AccError("refresh", `origin's ${branch} has commits this clone's branch doesn't, perhaps from GitHub. Bring them in by hand.`);
  }
  const record = (change2) => mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t) return;
    const data = change2(t);
    t.updatedAt = now2().toISOString();
    emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data });
  });
  const settled = () => {
    record((t) => {
      if (t.pr) t.pr = { ...t.pr, conflicts: [] };
      return { pr: t.pr };
    });
    return { sha: null, from, resolved: [], reason: `Pull request #${pr.number} no longer conflicts with ${env.branch}, so nothing was merged.` };
  };
  if (!opts.behind && conflictsOf(run2, paths.root, env.branch, branch)?.length === 0) return settled();
  const upToDate = () => pr.conflicts?.length ? settled() : { sha: null, from, resolved: [], reason: `Pull request #${pr.number} already has everything on ${env.branch}, so nothing was merged.` };
  if (opts.behind && git9("merge-base", "--is-ancestor", `refs/remotes/origin/${env.branch}`, from).code === 0) return upToDate();
  const who = config.commitIdentity ? ["-c", `user.name=${config.commitIdentity.name}`, "-c", `user.email=${config.commitIdentity.email}`] : [];
  const merge = (...args) => run2("git", ["-c", "rerere.enabled=false", ...who, ...args], { cwd: wt2 });
  const putBack = (how) => {
    merge(...how);
    const back = git9("rev-parse", "HEAD").stdout.trim() === from && !dirty(false) && !mid();
    return back ? `The branch is as it was, at ${short3(from)}, and nothing was pushed.` : `Putting the branch back at ${short3(from)} didn't work: look at ${wt2} before anything else.`;
  };
  const merged = merge("merge", "--no-ff", "--no-commit", `origin/${env.branch}`);
  if (!mid()) {
    if (merged.code === 0) return opts.behind ? upToDate() : settled();
    throw new AccError("refresh", `git wouldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(["reset", "--merge"])}`);
  }
  const appendOnly = config.autopilot?.appendOnly ?? [];
  const mergeBase = git9("merge-base", "HEAD", "MERGE_HEAD").stdout.trim();
  const resolved = [];
  const left = [];
  for (const [path, stages] of unmerged(run2, wt2)) {
    if (listed(path, appendOnly) && resolveAppend(run2, wt2, mergeBase, path, stages)) resolved.push(path);
    else left.push(path);
  }
  if (left.length) throw new AccError("refresh", `Conflicts with ${env.branch} that autopilot can't resolve: ${left.join(", ")}. ${putBack(["merge", "--abort"])}`);
  if (merged.code !== 0 && !resolved.length) throw new AccError("refresh", `git couldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(["merge", "--abort"])}`);
  const message = [`Merge ${env.branch} into ${branch}`, ...resolved.length ? ["", `Autopilot kept both sides' additions to ${resolved.join(", ")}.`] : []].join("\n");
  const commit = merge("commit", "-m", message);
  if (commit.code !== 0) throw new AccError("refresh", `The merge commit was refused: ${lastLines(commit)} ${putBack(["merge", "--abort"])}`);
  const sha = git9("rev-parse", "HEAD").stdout.trim();
  const required = config.gates.required;
  let failed = [];
  try {
    if (required.length) {
      const ran = runGates(repoPaths(wt2, run2), config, env, required, priorTests(paths, config, from), { run: run2, now: now2, slots: deps.slots });
      failed = ran.results.filter((r) => !r.recorded || !satisfies(r.receipt)).map((r) => `${r.gate} ${!r.recorded ? "wasn't recorded" : r.status === "fail" ? "failed" : "couldn't run"}: ${r.summary.replace(/[.!?]$/, "")}${r.receipt.log ? ` (log ${r.receipt.log})` : ""}`);
    }
  } catch (e) {
    const err = e;
    throw new AccError(err.code ?? "refresh", `Merged ${env.branch} in, but its checks couldn't run: ${err.message} ${putBack(["reset", "--hard", from])}`);
  }
  if (failed.length) throw new AccError("refresh", `Merged ${env.branch} in, but its checks failed on ${short3(sha)}: ${failed.join("; ")}. ${putBack(["reset", "--hard", from])}`);
  const refreshed = { base: env.branch, from, to: sha, resolved, ...opts.behind ? { behind: true } : {} };
  record((t) => {
    if (t.autopilot?.failed) t.autopilot.failed = null;
    return { refreshed };
  });
  const kept = resolved.length ? `, keeping both sides' additions to ${resolved.join(", ")}` : "";
  return { sha, from, resolved, reason: `Merged ${env.branch} into ${short3(from)} as ${short3(sha)}${kept}.${required.length ? " Its checks passed." : ""} It's reviewed next pass, then landed.` };
}

// packages/core/src/resume.ts
import { spawn as spawn2 } from "node:child_process";
import { appendFileSync as appendFileSync2, closeSync as closeSync3, existsSync as existsSync14, mkdirSync as mkdirSync16, openSync as openSync3, readFileSync as readFileSync17, rmSync as rmSync10, writeFileSync as writeFileSync18 } from "node:fs";
import { dirname as dirname5, join as join19 } from "node:path";

// packages/core/src/hooks.ts
import { existsSync as existsSync12, mkdirSync as mkdirSync15, realpathSync as realpathSync3, writeFileSync as writeFileSync17 } from "node:fs";
import { dirname as dirname4, join as join17, relative, resolve as resolve2, sep as sep2 } from "node:path";
function findAccRoot(cwd) {
  let dir = resolve2(cwd);
  for (; ; ) {
    if (existsSync12(join17(dir, ".acc", "config.json"))) return dir;
    const up = dirname4(dir);
    if (up === dir) return null;
    dir = up;
  }
}
var real = (p) => {
  try {
    return realpathSync3(p);
  } catch {
    return resolve2(p);
  }
};
var under3 = (path, root) => {
  const r = relative(real(root), real(path));
  return r === "" || !r.startsWith("..") && !r.startsWith(sep2) && !/^[A-Za-z]:/.test(r);
};
function builderFor(ctx) {
  const root = findAccRoot(ctx.cwd);
  if (!root) return null;
  let tasks;
  try {
    tasks = readLedger(repoPaths(root, ctx.run).ledger).tasks;
  } catch {
    return null;
  }
  const byEnv = ctx.env.ACC_ROLE === "builder" && ctx.env.ACC_TASK ? tasks.find((t) => t.id === ctx.env.ACC_TASK) : void 0;
  const byFolder = tasks.find((t) => t.run?.worktree && (t.state === "running" || t.state === "rework") && under3(ctx.cwd, t.run.worktree));
  const task = byEnv ?? byFolder;
  if (!task?.run?.worktree) return null;
  return { task, worktree: task.run.worktree, root };
}
function guardEdit(b, filePath, envSpecific) {
  if (!filePath) return null;
  const abs = resolve2(b.worktree, filePath);
  if (!under3(abs, b.worktree)) return `You're the builder for ${b.task.id}, and your only workspace is ${b.worktree}. ${filePath} is outside it. Make the change in your worktree, or say what you need with acc block.`;
  const rel = relative(real(b.worktree), real(abs)).split(sep2).join("/");
  if (envSpecific.some((p) => rel === p || rel.startsWith(`${p.replace(/\/+$/, "")}/`))) {
    return `${rel} is environment-specific (D-016): every org keeps its own version, and no task changes it. Leave it, and mention in your summary what it should say.`;
  }
  return null;
}
function commandsOf(line) {
  const out2 = [];
  let words = [];
  let word = "";
  let quote = null;
  let any = false;
  const end = () => {
    if (any) words.push(word);
    word = "";
    any = false;
  };
  const next = () => {
    end();
    if (words.length) out2.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      any = true;
      continue;
    }
    if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      any = true;
      continue;
    }
    if (/\s/.test(c) && c !== "\n") {
      end();
      continue;
    }
    if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      next();
      continue;
    }
    word += c;
    any = true;
  }
  next();
  return out2.map((w) => {
    let i = 0;
    while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]) || ["nice", "env", "time", "command", "npx"].includes(w[i]) || w[i - 1] === "nice" && /^-n$|^-\d+$/.test(w[i]) || w[i - 2] === "nice" && w[i - 1] === "-n")) i++;
    return w.slice(i);
  }).filter((w) => w.length);
}
var CLOSING = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b[\s:]+(#\d+|[A-Z][A-Z0-9_]*-\d+|https?:\/\/)/i;
var PERSON_ONLY_ACC = /* @__PURE__ */ new Set(["set", "dispatch", "land", "review", "autopilot", "analyze", "promote", "deploy", "init", "cleanup", "agents", "setup", "update", "updates", "resume", "machine"]);
function guardBash(b, line) {
  for (const w of commandsOf(line)) {
    const [cmd, sub, ...rest] = w;
    const args = [sub, ...rest].filter((x2) => !!x2);
    if (cmd === "git") {
      if (sub === "push") return "Builders never push. Finish with acc done: a person lands your branch with acc land, which pushes it and opens the pull request.";
      if (args.includes("--no-verify") || sub === "commit" && args.includes("-n")) return "Don't skip the repo's git hooks (--no-verify). If a hook fails, fix what it found.";
      if (sub === "commit") {
        const message = args.filter((a, i) => args[i - 1] === "-m" || args[i - 1] === "--message" || a.startsWith("--message=")).join("\n");
        if (CLOSING.test(message)) return `Don't close the ticket from a commit message ("fixes", "closes" or "resolves"): a person closes it. Refer to it plainly, as refs #12.`;
      }
      if (sub === "switch" || sub === "checkout" && !args.includes("--") && args.some((a) => !a.startsWith("-"))) return `Stay on your branch, ${b.task.run?.branch ?? "the task's branch"}, in your worktree. To restore a file, use git checkout -- <file>.`;
      if (sub === "worktree") return "acc makes and removes worktrees. Work in the one you have.";
      if (sub === "reset" && args.includes("--hard")) return "Don't reset --hard: it throws away work. Revert or amend what you need instead.";
    }
    if (cmd === "gh" && sub === "pr" && ["merge", "create", "close"].includes(rest[0] ?? "")) return "Pull requests are a person's: acc land opens one after review, and a person merges it.";
    if (cmd === "gh" && sub === "release" && ["create", "upload", "edit", "delete"].includes(rest[0] ?? "") || cmd === "npm" && (sub === "run" || sub === "run-script") && rest[0] === "release" || cmd === "node" && args.some((a) => a.endsWith("scripts/release.mjs"))) return "Releases are a person's: they run npm run release on main, after the merge. Finish with acc done.";
    if (cmd === "sf" && sub === "project" && rest[0] === "deploy") {
      const verb = rest[1];
      if (verb === "quick" || verb === "resume" || verb === "start" && !rest.includes("--dry-run")) return "Builders validate and never deploy (D-011). Use acc gate run validate, which is a check-only deploy.";
    }
    if (cmd === "sf" && sub === "org" && rest[0] === "delete") return "Builders never delete an org.";
    if (cmd === "acc" && sub && (PERSON_ONLY_ACC.has(sub) || sub === "gate" && rest[0] === "waive")) {
      return `acc ${sub}${sub === "gate" ? " waive" : ""} is a person's. A builder finishes with acc done, or acc block "<what you need>".`;
    }
    if (cmd === "acc" && sub === "sync" && rest.some((a) => a === "--close-done" || a.startsWith("--close-done="))) {
      return `acc sync --close-done is a person's: it closes GitHub issues. A builder finishes with acc done, or acc block "<what you need>".`;
    }
  }
  return null;
}
function guardAnalyst(line) {
  const allowed = [...ANALYST_COMMANDS.any, ...ANALYST_COMMANDS.salesforce].map((c) => c.split(" "));
  for (const w of commandsOf(line)) {
    if (!allowed.some((a) => a.every((word, i) => w[i] === word))) {
      return `The analyst only reads: ${w.slice(0, 3).join(" ")} isn't one of its commands. Use git log, show, diff or grep, or the read-only sf commands (org display, data query, sobject describe, org list metadata, limits, project retrieve start).`;
    }
    if (w[0] === "sf" && w[1] === "project" && w.includes("--output-dir") && w.some((x2) => x2.startsWith("/") || x2.startsWith(".."))) {
      return "Retrieve into your working folder, the scratch project, without --output-dir.";
    }
  }
  return null;
}
var deny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
function preToolUseHook(input, ctx) {
  if (ctx.env.ACC_ROLE === "analyst") {
    const tool2 = input.tool_name ?? "";
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool2)) return deny("The analyst changes nothing. Put what you would change in the approach.");
    if (tool2 === "Bash") {
      const reason = guardAnalyst(String(input.tool_input?.command ?? ""));
      return reason ? deny(reason) : null;
    }
    return null;
  }
  const b = builderFor(ctx);
  if (!b) return null;
  const tool = input.tool_name ?? "";
  const t = input.tool_input ?? {};
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    let list = [];
    try {
      list = readList(b.worktree, loadConfig(join17(b.worktree, ".acc", "config.json")).config.environmentSpecific);
    } catch {
      list = [];
    }
    const reason = guardEdit(b, String(t.file_path ?? t.notebook_path ?? ""), list);
    return reason ? deny(reason) : null;
  }
  if (tool === "Bash") {
    const reason = guardBash(b, String(t.command ?? ""));
    return reason ? deny(reason) : null;
  }
  return null;
}
function shortPacket(task, gates) {
  return [
    `You are the builder for ${task.id}: ${task.title}.`,
    `Work only in ${task.run?.worktree}, on ${task.run?.branch}.`,
    `Finish line: commit everything, run exactly \`acc gate run\`${gates.length ? ` (${gates.join(", ")})` : ""}, then run exactly \`acc done\`. If you're stuck, run \`acc block "<what you need>"\` and stop.`,
    "Never push, merge, open a pull request or deploy.",
    `Your full instructions: acc show ${task.id}.`
  ].join("\n");
}
function sessionStartHook(input, ctx) {
  const b = builderFor(ctx);
  if (!b) return null;
  const id = input.session_id;
  if (id && b.task.run && b.task.run.sessionId !== id) {
    try {
      mutate(repoPaths(b.root, ctx.run), ctx.now, (l3, emit) => {
        const t = l3.tasks.find((x2) => x2.id === b.task.id);
        if (!t?.run || t.run.sessionId === id) return;
        t.run.sessionId = id;
        emit({ type: "task.updated", task: t.id, actor: "builder", by: `builder:${t.id}`, data: { sessionId: id } });
      });
    } catch {
    }
  }
  if (input.source !== "resume" && input.source !== "compact") return null;
  let gates = [];
  try {
    gates = loadConfig(join17(b.root, ".acc", "config.json")).config.gates.required;
  } catch {
    gates = [];
  }
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: shortPacket(b.task, gates) } };
}
var remindedPath = (stateDir, sessionId) => join17(stateDir, "hooks", `${(sessionId ?? "session").replace(/[^A-Za-z0-9-]/g, "")}.reminded`);
function stopHook(input, ctx) {
  if (input.stop_hook_active) return null;
  const b = builderFor(ctx);
  if (!b || b.task.state !== "running") return null;
  const paths = repoPaths(b.root, ctx.run);
  const mark = remindedPath(paths.stateDir, input.session_id);
  if (existsSync12(mark)) return null;
  try {
    mkdirSync15(dirname4(mark), { recursive: true });
    writeFileSync17(mark, ctx.now().toISOString());
  } catch {
    return null;
  }
  return {
    decision: "block",
    reason: `${b.task.id} is still running. If the work is done: commit everything, run exactly \`acc gate run\`, then \`acc done\`. If you can't finish it, run \`acc block "<what you need>"\` and stop. If you are still working, carry on.`
  };
}
function parseEventInput(text) {
  try {
    const x2 = JSON.parse(text);
    return x2 && typeof x2 === "object" ? x2 : null;
  } catch {
    return null;
  }
}

// packages/core/src/transcript.ts
import { closeSync as closeSync2, existsSync as existsSync13, openSync as openSync2, readdirSync as readdirSync5, readFileSync as readFileSync16, readSync as readSync2, statSync as statSync4 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { join as join18 } from "node:path";
function claudeProjectsDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join18(env.CLAUDE_CONFIG_DIR, "projects") : join18(env.HOME || homedir4(), ".claude", "projects");
}
var transcriptDir = (projectsDir, cwd) => `${projectsDir}/${cwd.replace(/[^A-Za-z0-9]/g, "-")}`;
function savedDir(projectsDir, file, likely) {
  for (const f of new Set(likely.filter((c) => !!c))) {
    const dir2 = transcriptDir(projectsDir, f);
    if (existsSync13(join18(dir2, file))) return { dir: dir2, folder: f };
  }
  let dirs;
  try {
    dirs = readdirSync5(projectsDir);
  } catch {
    return null;
  }
  const dir = dirs.find((d) => existsSync13(join18(projectsDir, d, file)));
  return dir ? { dir: `${projectsDir}/${dir}`, folder: null } : null;
}
function transcriptFile(projectsDir, sessionId, likely) {
  const file = `${sessionId}.jsonl`;
  const found = savedDir(projectsDir, file, likely);
  return found ? join18(found.dir, file) : null;
}
function savedFolder(projectsDir, sessionId, likely) {
  const file = `${sessionId}.jsonl`;
  const found = savedDir(projectsDir, file, likely);
  if (!found) return null;
  if (found.folder) return found.folder;
  let text;
  try {
    text = readFileSync16(join18(found.dir, file), "utf8");
  } catch {
    return null;
  }
  for (const m of text.matchAll(/"cwd":("(?:[^"\\]|\\.)*")/g)) {
    let cwd;
    try {
      cwd = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (typeof cwd === "string" && transcriptDir(projectsDir, cwd) === found.dir) return cwd;
  }
  return null;
}
var TAIL_BYTES = 256 * 1024;
function* assistantTurns(file) {
  let fd;
  try {
    fd = openSync2(file, "r");
  } catch {
    return;
  }
  let text;
  try {
    const size = statSync4(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    readSync2(fd, buf, 0, buf.length, from);
    text = buf.toString("utf8");
    if (from > 0) text = text.slice(text.indexOf("\n") + 1);
  } catch {
    return;
  } finally {
    closeSync2(fd);
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"assistant"')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r?.type === "assistant" && !r.isSidechain) yield r;
  }
}
function lastSaidIn(file) {
  for (const r of assistantTurns(file)) {
    if (!Array.isArray(r.message?.content)) continue;
    const said2 = r.message.content.filter((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim()).map((b) => b.text.trim());
    if (said2.length) return said2[said2.length - 1];
  }
  return null;
}
function lastSaid(projectsDir, sessionId, likely) {
  const file = transcriptFile(projectsDir, sessionId, likely);
  return file ? lastSaidIn(file) : null;
}

// packages/core/src/resume.ts
var resumingPath = (paths, id) => join19(paths.stateDir, "resumes", `${id}.json`);
function resuming(paths, id) {
  try {
    const r = JSON.parse(readFileSync17(resumingPath(paths, id), "utf8"));
    return Number.isInteger(r.pid) && r.pid > 0 && alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}
function endResume(paths, id) {
  const r = resuming(paths, id);
  rmSync10(resumingPath(paths, id), { force: true });
  releaseAwake(paths, id);
  if (!r) return false;
  try {
    process.kill(-r.pid, "SIGTERM");
  } catch {
    try {
      process.kill(r.pid, "SIGTERM");
    } catch {
      return false;
    }
  }
  return true;
}
function listSessions(run2, cwd) {
  const r = run2("claude", ["agents", "--json"], { cwd, timeoutMs: 2e4 });
  if (r.code !== 0) return null;
  try {
    const list = parseJsonOutput(r.stdout);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
var clipSaid = (said2, max = 300) => {
  const one = said2.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}\u2026` : one;
};
function resumeMessage(task, said2, head) {
  const quote = said2 ? clipSaid(said2, 1500) : null;
  return [
    `You are the builder for ${task.id}: ${task.title}. Your last turn ended before you ran acc done or acc block, so ${task.id} is still running.${quote ? " The last thing you said was:" : ""}`,
    ...quote ? ["", `> ${quote}`] : [],
    "",
    "If you were cut off, carry on from where you left off. If you stopped to ask something, decide it yourself where the task allows, or block and ask.",
    "",
    `Start with \`git status\` and \`git log --oneline -3\`${head ? ` (your branch's latest commit is ${head})` : ""}, then finish the task and its finish line: commit everything, run exactly \`acc gate run\`, then run exactly \`acc done\`. If you're stuck, run exactly \`acc block "<what you need>"\` and stop.`
  ].join("\n");
}
function resumeCommand(task, config, i) {
  const settings = JSON.stringify(builderSettings(task, config, i.accBinDir, i.basePath, i.accCommand));
  const { model } = builderModel(task, config);
  const name = task.run?.name ? ["--name", task.run.name] : [];
  return {
    args: ["-p", i.message, "--resume", i.sessionId, ...name, "--permission-mode", config.agents.permissionMode, ...agentArgs({ ...config.agents.builder, model }), "--settings", settings],
    env: { ACC_ROLE: "builder", ACC_TASK: task.id },
    model
  };
}
var launchDetached = (cmd, args, o) => {
  const fd = openSync3(o.log, "a");
  try {
    const child = spawn2(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ["ignore", fd, fd] });
    child.on("error", () => void 0);
    child.unref();
    return child.pid ?? null;
  } finally {
    closeSync3(fd);
  }
};
function activeWhy(id, s) {
  if (s.kind !== "background") return `${id}'s conversation is open in a terminal or a Claude Code tab, or a message to it is running: carry on there.`;
  if (s.state === "blocked" || s.status === "waiting") return `${id}'s agent is waiting for you in its own prompt: answer it there, with Open in Claude Code or claude attach ${s.id ?? ""}.`.replace(/ \.$/, ".");
  return `${id}'s agent is still working.`;
}
function resume(paths, config, id, deps, opts) {
  const { now: now2 } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  if (task.state !== "running") throw new AccError("refused", `${id} is ${task.state}. Only a running task's builder is resumed.`);
  const sessionId = task.run?.sessionId;
  if (!sessionId) throw new AccError("refused", `${id} has no session to carry on. Abandon it and dispatch it again.`);
  const worktree = task.run?.worktree;
  if (!worktree || !existsSync14(worktree)) throw new AccError("refused", `${id}'s worktree isn't on disk any more, so there's nowhere to carry on.`);
  const marker = resumingPath(paths, id);
  const log = join19(paths.logs, `${id}.resume.log`);
  claimResume(paths, id, { sessionId, pid: process.pid, startedAt: now2().toISOString(), by: opts.by, log });
  try {
    return resumeClaimed(paths, config, id, deps, opts, { task, sessionId, worktree, marker, log });
  } catch (e) {
    if (readMarker(marker)?.pid === process.pid) rmSync10(marker, { force: true });
    throw e;
  }
}
function readMarker(file) {
  try {
    return JSON.parse(readFileSync17(file, "utf8"));
  } catch {
    return null;
  }
}
function claimResume(paths, id, claim) {
  const file = resumingPath(paths, id);
  mkdirSync16(dirname5(file), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      writeFileSync18(file, JSON.stringify(claim), { flag: "wx" });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const already = resuming(paths, id);
      if (already) throw new AccError("refused", `${id} is already being resumed (pid ${already.pid}).`);
      rmSync10(file, { force: true });
    }
  }
  throw new AccError("refused", `${id} is already being resumed.`);
}
function resumeClaimed(paths, config, id, deps, opts, c) {
  const { run: run2, now: now2 } = deps;
  const { task, sessionId, worktree, log } = c;
  const sessions = listSessions(run2, paths.root);
  if (!sessions) throw new AccError("refused", `claude agents didn't answer, so acc can't tell whether ${id}'s agent is still at work. Try again in a moment.`);
  const mine = sessionsOf(task, sessions);
  const active = mine.find(sessionActive);
  if (active) throw new AccError("agent-active", activeWhy(id, active));
  const projectsDir = deps.projectsDir ?? claudeProjectsDir(deps.env);
  const folder = savedFolder(projectsDir, sessionId, [worktree, ...mine.map((s) => s.cwd), paths.root]);
  if (!folder) throw new AccError("refused", `${id}'s conversation (${sessionId}) isn't saved anywhere this machine can find.`);
  const said2 = lastSaid(projectsDir, sessionId, [folder]);
  const head = run2("git", ["log", "-1", "--format=%h"], { cwd: worktree }).stdout.trim() || null;
  const message = opts.message?.trim() || resumeMessage(task, said2, head);
  let stopped = null;
  for (const s of mine) {
    if (s.kind !== "background" || !s.id || !s.pid) continue;
    const r = run2("claude", ["stop", s.id], { cwd: paths.root, timeoutMs: 3e4 });
    if (r.code !== 0) throw new AccError("refused", `${id}'s background session ${s.id} wouldn't stop: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
    stopped = s.id;
  }
  const cmd = resumeCommand(task, withCloneAgents(config, paths.root, run2), { sessionId, message, accBinDir: deps.accBinDir, basePath: deps.env.PATH ?? "", accCommand: deps.accCommand });
  mkdirSync16(dirname5(log), { recursive: true });
  const at2 = now2().toISOString();
  appendFileSync2(log, `
--- ${at2}: ${id} resumed by ${opts.by}, in ${folder} ---
`);
  const pid = (deps.launch ?? launchDetached)("claude", cmd.args, { cwd: folder, env: { ...deps.env, ...cmd.env }, log });
  if (!pid) throw new AccError("resume", `Claude Code didn't start. Its output is in ${log}.`);
  keepAwakeFor(paths, id, pid, deps.awake);
  writeFileSync18(c.marker, JSON.stringify({ sessionId, pid, startedAt: at2, by: opts.by, log }));
  rmSync10(remindedPath(paths.stateDir, sessionId), { force: true });
  try {
    const recorded = mutate(paths, now2, (l3, emit) => {
      const t = l3.tasks.find((x2) => x2.id === id);
      if (!t?.run || t.state !== "running") throw new AccError("refused", `${id} left running meanwhile, so its resume was stopped.`);
      t.run.resumes = [...t.run.resumes ?? [], { at: at2, actor: opts.actor, by: opts.by }];
      t.run.model = cmd.model;
      if (t.autopilot?.failed) t.autopilot.failed = null;
      t.updatedAt = at2;
      emit({ type: "task.updated", task: id, actor: opts.actor, by: opts.by, data: { resumed: { said: said2 ? clipSaid(said2) : null } } });
      return t;
    });
    return { task: recorded, sessionId, pid, folder, log, message, said: said2, stopped };
  } catch (e) {
    endResume(paths, id);
    throw e;
  }
}

// packages/core/src/autopilot.ts
var AUTOPILOT_MIN_EVERY_S = 30;
var AUTOPILOT_REVIEW_DOES = "reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, and merges the base into a pull request that conflicts with it";
function autopilotDoes(autoMerge) {
  return autoMerge ? `${AUTOPILOT_REVIEW_DOES}. Auto-merge is on: it also merges a pull request whose review and checks passed, once it's up to date with its base, GitHub says it can merge and nothing waits on a person, one a pass. It never merges into a protected environment.` : `${AUTOPILOT_REVIEW_DOES}. It never merges a pull request.`;
}
function autopilotMode(config) {
  const autonomy = config.autonomy;
  if (autonomy === "manual") return { autonomy, on: false, warnings: [], refusal: null };
  if (autonomy === "review") return { autonomy, on: true, warnings: [], refusal: null };
  const warnings = autonomy === "full" ? ['autonomy "full" is read as "dispatch".'] : [];
  return {
    autonomy,
    on: false,
    warnings,
    refusal: `autonomy "dispatch" (autopilot also starting Ready tasks) is not built yet. Set "autonomy" to "review" in .acc/config.json: autopilot then ${AUTOPILOT_REVIEW_DOES}.`
  };
}
var short4 = (sha) => sha.slice(0, 7) || "no commit";
var sentence3 = (text) => text.replace(/([^.!?])$/, "$1.");
function reworkedByAutopilot(task, before) {
  let cause = null;
  for (const h2 of task.history) {
    if (before !== void 0 && h2.at >= before) break;
    if (h2.to === "rework") cause = sentBackForChecks(h2) ? "checks" : "review";
    else if (h2.from === "rework" && h2.to === "running" && h2.actor === "orchestrator" && cause !== "checks") return true;
  }
  return false;
}
var CHECKS_SEND_BACKS = 3;
var checksSendBacks = (task) => task.history.filter(sentBackForChecks).length;
function failedChecks(task) {
  const pr = task.pr;
  if (task.state === "review" && pr?.state === "open" && pr.ci === "failing" && pr.failing?.length) return pr.failing;
  const back = task.autopilot?.sentBack;
  if (task.state === "rework" && back?.checks.length && reworkCause(task) === "checks") return back.checks;
  return null;
}
var resumedByAutopilot = (task) => !!task.run?.resumes?.some((r) => byAutopilot(r.by));
var running = (ledger, except) => ledger.tasks.filter((t) => t.state === "running" && t.id !== except).length;
function nextStep(ledger, config, task, facts) {
  const step = (s, reason) => {
    const f = task.autopilot?.failed;
    if (f && f.step === s && f.sha === facts.head && f.state === task.state) {
      return { step: null, outcome: "waiting", reason: `Autopilot couldn't ${failedWords(s, f.sha)}: ${sentence3(f.reason)} It waits for a person, or a new commit.` };
    }
    return { step: s, outcome: null, reason };
  };
  const none = (outcome, reason) => ({ step: null, outcome, reason });
  if (task.state === "review") {
    if (facts.reviewing) return none("waiting", `A review is running (session ${facts.reviewing}).`);
    if (!facts.verdict) return step("review", `Nothing has reviewed ${short4(facts.head)} yet.`);
    if (facts.verdict === "changes") return none("waiting", `Its review on ${short4(facts.head)} asked for changes, and it's still in review: a person decides.`);
    const pr = task.pr;
    if (pr?.state === "merged") return none("skipped", `Pull request #${pr.number} merged.`);
    const closed = closedPr(task);
    if (closed) return none("waiting", `Pull request #${closed.number} was closed without merging. Autopilot won't replace it: reopen it on GitHub and land to update it, or land to open a new one.`);
    if (pr?.state !== "open") return step("land", `Its review passed on ${short4(facts.head)}, and it has no pull request.`);
    if (facts.landed === facts.head) {
      if (pr.conflicts?.length) return step("refresh", `Pull request #${pr.number} conflicts with ${task.environment} in ${pr.conflicts.join(", ")}.`);
      const checks = checksStep(task, facts, step, none);
      if (checks) return checks;
      if (autoMergeFor(config, task.environment)) return mergeStep(task, facts, step, none);
      return none("skipped", `Pull request #${pr.number} is up to date with ${short4(facts.head)}.`);
    }
    return step("land", `Its review passed on ${short4(facts.head)}, and pull request #${pr.number} is behind it.`);
  }
  if (task.state === "rework") {
    const checks = reworkCause(task) === "checks";
    if (!checks && reworkedByAutopilot(task)) return none("waiting", "Autopilot re-dispatched it once already. A second rework waits for a person.");
    const n = running(ledger, task.id);
    if (n >= config.agents.max) return none("waiting", `${n} tasks are running. The limit is ${config.agents.max}.`);
    return step("dispatch", checks ? `Checks failed on GitHub: ${task.autopilot?.sentBack?.checks.join(", ") || "see its pull request"}.` : "The reviewer asked for changes.");
  }
  if (task.state === "todo") return none("skipped", "To do: autopilot never starts a task that's to do.");
  if (task.state === "running") {
    if (!facts.stopped) return none("skipped", "Its builder is working.");
    if (resumedByAutopilot(task)) return none("waiting", "Its agent stopped again. Autopilot resumed it once already: a person resumes it.");
    return step("resume", "Its agent stopped before acc done or acc block.");
  }
  if (task.state === "blocked") return none("skipped", "Blocked: a person decides.");
  return none("skipped", "Done.");
}
function failedWords(s, sha) {
  if (s === "refresh") return `update ${short4(sha)} from its base`;
  if (s === "checks") return `send ${short4(sha)} back for its failing checks`;
  return `${s} ${short4(sha)}`;
}
var names = (list) => list.join(", ");
function checksStep(task, facts, step, none) {
  const pr = task.pr;
  const head = facts.head;
  const f = task.autopilot?.failed;
  if (f?.step === "checks" && f.sha === head && f.state === task.state) return step("checks", "");
  if (facts.checksError) return none("waiting", `Autopilot couldn't read pull request #${pr.number}'s checks on GitHub: ${sentence3(facts.checksError)} It tries again next pass.`);
  const c = facts.checks;
  if (!c) return null;
  if (c.sha !== head) return none("waiting", `Pull request #${pr.number} is at ${short4(c.sha)} on GitHub, not ${short4(head)}: a land or a person comes first.`);
  if (c.pending.length) return none("waiting", `Checks are still running on GitHub: ${names(c.pending)}.`);
  if (!c.failed.length) return null;
  const failed = names(c.failed.map((x2) => x2.name));
  if (!c.failed.some((x2) => x2.job)) return none("waiting", `Checks failed on GitHub: ${failed}. GitHub keeps no log for ${c.failed.length === 1 ? "it" : "them"}, so autopilot doesn't send it back: a person decides.`);
  const record = (reason) => ({ step: null, outcome: "waiting", reason, record: { step: "checks", reason } });
  if (sentBackAt(task, head)) return record(`Checks failed on GitHub again: ${failed}. Autopilot already sent ${short4(head)} back once: a person decides.`);
  if (checksSendBacks(task) >= CHECKS_SEND_BACKS) return record(`Checks failed on GitHub: ${failed}. Autopilot sent ${task.id} back for failing checks ${CHECKS_SEND_BACKS} times already: a person decides.`);
  return step("checks", `Checks failed on GitHub on ${short4(head)}: ${failed}.`);
}
function mergeStep(task, facts, step, none) {
  const pr = task.pr;
  const merged = task.autopilot?.merged;
  if (merged?.sha === facts.head) return none("skipped", `Autopilot merged pull request #${merged.pr.number}. acc sync moves it to done.`);
  const f = task.autopilot?.failed;
  if (f?.step === "merge" && f.sha === facts.head && f.state === task.state) return step("merge", "");
  const failure = autopilotFailure(task);
  if (failure) return none("waiting", `Autopilot couldn't ${failedWords(failure.step, failure.sha)}: a person decides before it merges.`);
  if (pr.changesRequested) return none("waiting", `A person asked for changes on pull request #${pr.number}, so autopilot doesn't merge it.`);
  const c = facts.checks;
  if (!c) return none("waiting", `Autopilot hasn't read pull request #${pr.number}'s checks on GitHub yet.`);
  if (c.cancelled.length) {
    const reason = `Checks were cancelled on GitHub: ${names(c.cancelled)}. Run them again, or merge it yourself.`;
    return { step: null, outcome: "waiting", reason, record: { step: "merge", reason } };
  }
  if (!c.count && (c.required || facts.noChecksYet)) return none("waiting", `GitHub reports no checks on pull request #${pr.number} yet. Autopilot gives them 2 minutes after a land.`);
  const behind = facts.behind ? facts.behind() : false;
  if (behind === null) return none("waiting", `Autopilot couldn't fetch ${task.environment} and its branch to see whether pull request #${pr.number} is up to date. It tries again next pass.`);
  if (behind) return step("refresh", `Pull request #${pr.number} is behind ${task.environment}: it's brought up to date before it merges.`);
  return step("merge", `Pull request #${pr.number} passed its review and its checks on ${short4(facts.head)}.`);
}
function checksWanted(task, facts, merging) {
  const pr = task.pr;
  if (task.state !== "review" || pr?.state !== "open" || facts.verdict !== "pass" || facts.reviewing) return false;
  if (!facts.head || pr.sha !== facts.head || facts.landed !== facts.head || pr.conflicts?.length) return false;
  if (merging ? task.autopilot?.merged?.sha === facts.head : pr.ci === "passing") return false;
  const f = task.autopilot?.failed;
  return !(f && (f.step === "checks" || f.step === "merge") && f.sha === facts.head && f.state === task.state);
}
var settledChecks = /* @__PURE__ */ new Map();
function taskFacts(paths, task, run2, sessions = null, now2 = /* @__PURE__ */ new Date(), github) {
  const facts = { head: "", verdict: null, reviewing: null, landed: null };
  if (task.state !== "review" && task.state !== "rework" && task.state !== "running") return facts;
  const branch = task.run?.branch;
  const rev = (ref) => run2("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: paths.root }).stdout.trim();
  facts.head = branch ? rev(`refs/heads/${branch}`) : "";
  if (task.state === "running") {
    facts.stopped = builderStopped(task, sessions, { resuming: !!resuming(paths, task.id), now: now2 });
    return facts;
  }
  if (task.state !== "review") return facts;
  facts.reviewing = reviewing(paths, task.id)?.sessionId ?? null;
  facts.verdict = facts.head ? readVerdict(paths, task.id, facts.head)?.verdict ?? null : null;
  if (task.pr?.state === "open") facts.landed = task.pr.sha ?? (branch ? rev(`refs/remotes/origin/${branch}`) || null : null);
  const merging = !!github?.autoMerge?.(task.environment);
  if (github && checksWanted(task, facts, merging)) {
    const key = `${paths.ledger}#${task.id}`;
    const settled = settledChecks.get(key);
    if (settled?.sha === facts.head) facts.checks = settled.checks;
    else {
      try {
        facts.checks = readChecks(run2, github.repo, task.pr.number, github.env());
        const c = facts.checks;
        if (c && c.sha === facts.head && c.count && !c.pending.length && !c.failed.some((x2) => x2.job)) settledChecks.set(key, { sha: facts.head, checks: c });
      } catch (e) {
        facts.checksError = firstLines(e.message ?? String(e));
      }
    }
    const landedAt = Date.parse(task.pr?.landedAt ?? "");
    if (facts.checks && !facts.checks.count && Number.isFinite(landedAt)) facts.noChecksYet = now2.getTime() - landedAt < NO_CHECKS_GRACE_MS;
  }
  if (merging && github && branch && facts.head) {
    const base = task.environment;
    const head = facts.head;
    facts.behind = () => {
      if (!fetchBranches(run2, paths.root, [base, branch], { ...github.gitEnv ?? process.env, GIT_TERMINAL_PROMPT: "0" })) return null;
      const code = run2("git", ["merge-base", "--is-ancestor", `refs/remotes/origin/${base}`, head], { cwd: paths.root }).code;
      return code === 0 ? false : code === 1 ? true : null;
    };
  }
  return facts;
}
function realSteps(paths, config, deps) {
  const { run: run2, now: now2, env } = deps;
  return {
    review: (id) => {
      const r = review(paths, config, id, { run: run2, now: now2, env }, { by: `reviewer:${id} for ${AUTOPILOT_BY}` });
      return { reason: r.verdict.verdict === "pass" ? `Review passed: ${r.verdict.summary}` : `Review asked for changes, so it went to rework: ${r.verdict.summary}` };
    },
    land: (id) => landStep(land(paths, config, id, { run: run2, now: now2, env }, { actor: "orchestrator", by: AUTOPILOT_BY })),
    dispatch: (id) => {
      const t = readLedger(paths.ledger).tasks.find((x2) => x2.id === id);
      const cause = (t && reworkCause(t)) ?? "review";
      const r = dispatch(paths, config, id, { run: run2, now: now2, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand }, { actor: "orchestrator", by: AUTOPILOT_BY, cause });
      return { reason: `Re-dispatched${cause === "checks" ? " for its failing checks" : ""} in ${r.worktree}${r.bgId ? `, background session ${r.bgId}` : ""}.` };
    },
    refresh: (id) => {
      const t = readLedger(paths.ledger).tasks.find((x2) => x2.id === id);
      const behind = !!t && autoMergeFor(config, t.environment);
      return { reason: refresh(paths, config, id, { run: run2, now: now2, env, slots: deps.slots }, { actor: "orchestrator", by: AUTOPILOT_BY, behind }).reason };
    },
    resume: (id) => {
      const r = resume(paths, config, id, { run: run2, now: now2, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand, ...deps.resume }, { actor: "orchestrator", by: AUTOPILOT_BY });
      return { reason: `Resumed its builder${r.said ? `, which last said: ${clipSaid(r.said, 200)}` : "."}` };
    },
    checks: (id) => ({ reason: sendBack(paths, config, id, { run: run2, now: now2, env }, { actor: "orchestrator", by: AUTOPILOT_BY }).reason }),
    merge: (id) => {
      const r = mergePr(paths, config, id, { run: run2, now: now2, env }, { actor: "orchestrator", by: AUTOPILOT_BY });
      return { reason: r.reason, pr: { number: r.pr.number, url: r.pr.url, opened: false } };
    }
  };
}
function landStep(r) {
  return {
    reason: `${r.opened ? "Opened" : "Updated"} pull request #${r.pr.number}.`,
    pr: { number: r.pr.number, url: r.pr.url, opened: r.opened },
    ...r.update ? { update: r.update } : {}
  };
}
function temporary(e, paths, config, id) {
  const code = e.code;
  if (code === "lock-timeout") return "The ledger was busy. Autopilot tries again next pass.";
  if (code === "agent-active" || code === "checks-moved" || code === "merge-waits") return `${e.message} Autopilot looks again next pass.`;
  if (code === "move-refused") {
    const n = running(readLedger(paths.ledger), id);
    if (n >= config.agents.max) return `${n} tasks are running. The limit is ${config.agents.max}.`;
  }
  return null;
}
var firstLines = (text) => text.trim().split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ");
function recordFailure(paths, now2, id, failed) {
  mutate(paths, now2, (l3, emit) => {
    const t = l3.tasks.find((x2) => x2.id === id);
    if (!t || t.state !== failed.state) return;
    t.autopilot = { ...t.autopilot, failed };
    t.updatedAt = failed.at;
    emit({ type: "task.updated", task: id, actor: "orchestrator", by: AUTOPILOT_BY, data: { autopilot: { failed } } });
  });
}
function autopilotPass(paths, config, deps) {
  const steps = { ...realSteps(paths, config, deps), ...deps.steps };
  const out2 = { steps: [], updates: [] };
  const first = readLedger(paths.ledger);
  let look2 = null;
  const gh = config.github;
  let ghEnv3 = null;
  const github = gh ? {
    repo: gh.repo,
    env: () => ghEnv3 ??= { ...deps.env, GH_TOKEN: ghToken(deps.run, gh.account) },
    autoMerge: (branch) => autoMergeFor(config, branch),
    gitEnv: deps.env
  } : void 0;
  let merged = false;
  for (const id of first.tasks.map((t) => t.id)) {
    if (deps.stop?.()) break;
    const ledger = readLedger(paths.ledger);
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task || task.state === "done") continue;
    if (task.state === "running" && (!look2 || deps.now().getTime() - look2.at > STOPPED_GRACE_MS)) look2 = { sessions: listSessions(deps.run, paths.root), at: deps.now().getTime() };
    const facts = taskFacts(paths, task, deps.run, look2?.sessions ?? null, deps.now(), github);
    if (facts.stopped) releaseAwake(paths, id);
    const d = nextStep(ledger, config, task, facts);
    const sha = facts.head || null;
    if (d.record) {
      let unrecorded = "";
      try {
        recordFailure(paths, deps.now, id, { step: d.record.step, sha: facts.head, state: task.state, reason: d.record.reason, at: deps.now().toISOString() });
      } catch (err) {
        unrecorded = ` (Not recorded on the task: ${err.message})`;
      }
      out2.steps.push({ task: id, state: task.state, step: d.record.step, sha, outcome: "failed", reason: d.record.reason + unrecorded });
      continue;
    }
    if (!d.step) {
      out2.steps.push({ task: id, state: task.state, step: null, sha, outcome: d.outcome ?? "skipped", reason: d.reason });
      continue;
    }
    if (d.step === "merge" && merged) {
      out2.steps.push({ task: id, state: task.state, step: null, sha, outcome: "waiting", reason: "Autopilot merged a pull request this pass already: it merges one a pass." });
      continue;
    }
    deps.onStep?.(id, d.step, facts.head);
    try {
      const r = steps[d.step](id);
      out2.steps.push({ task: id, state: task.state, step: d.step, sha, outcome: "done", reason: r.reason, ...r.pr ? { pr: r.pr } : {}, ...r.update ? { update: r.update } : {} });
      if (r.update) out2.updates.push({ task: id, ...r.update });
      if (d.step === "merge") merged = true;
    } catch (e) {
      const wait = temporary(e, paths, config, id);
      if (wait) {
        out2.steps.push({ task: id, state: task.state, step: d.step, sha, outcome: "waiting", reason: wait });
        continue;
      }
      const reason = firstLines(e.message ?? String(e));
      let unrecorded = "";
      try {
        recordFailure(paths, deps.now, id, { step: d.step, sha: facts.head, state: task.state, reason, at: deps.now().toISOString() });
      } catch (err) {
        unrecorded = ` (Not recorded on the task: ${err.message})`;
      }
      out2.steps.push({ task: id, state: task.state, step: d.step, sha, outcome: "failed", reason: reason + unrecorded });
    }
  }
  return out2;
}
var byAutopilot = (by) => by === AUTOPILOT_BY || by.endsWith(` for ${AUTOPILOT_BY}`);
var EVENTS_TAIL_BYTES = 256 * 1024;
function holdAutopilot(paths, fn2) {
  mkdirSync17(paths.stateDir, { recursive: true });
  let held = false;
  try {
    return withLock(paths.autopilotLock, () => {
      held = true;
      return fn2();
    }, { staleMs: Infinity, timeoutMs: 0 });
  } catch (e) {
    if (held || e.code !== "lock-timeout") throw e;
    let pid = null;
    try {
      pid = JSON.parse(readFileSync18(join20(paths.autopilotLock, "owner"), "utf8")).pid;
    } catch {
      pid = null;
    }
    throw new AccError("autopilot-running", `Autopilot is already running here (pid ${pid ?? "unknown"}). Stop that one first.${pid ? "" : ` If none is running, delete ${paths.autopilotLock}.`}`);
  }
}

// packages/core/src/promote.ts
import { appendFileSync as appendFileSync3, mkdirSync as mkdirSync18, mkdtempSync as mkdtempSync2, rmSync as rmSync11, writeFileSync as writeFileSync19 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join21 } from "node:path";
var git6 = (run2, cwd, ...args) => run2("git", args, { cwd });
var must = (r, what) => {
  if (r.code !== 0) throw new AccError("git", `${what}: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
  return r.stdout;
};
function promotionPaths(envs) {
  const into = new Set(envs.flatMap((e) => e.promotesTo));
  const starts = envs.filter((e) => !into.has(e.branch) && e.promotesTo.length);
  const out2 = [];
  const walk = (path) => {
    const last = envs.find((e) => e.branch === path[path.length - 1]);
    const next = (last?.promotesTo ?? []).filter((b) => !path.includes(b));
    if (!next.length) {
      out2.push(path);
      return;
    }
    for (const b of next) walk([...path, b]);
  };
  for (const s of starts) walk([s.branch]);
  return out2;
}
function envByName(config, name) {
  const e = config.environments.find((x2) => x2.branch === name.toLowerCase() || x2.name.toLowerCase() === name.toLowerCase());
  if (!e) throw new AccError("usage", `No environment "${name}". The config has: ${config.environments.map((x2) => x2.branch).join(", ")}.`);
  return e;
}
function skippedOn(config, from, to) {
  const usual = from.promotesTo[0];
  if (!usual || usual === to.branch) return [];
  const path = [];
  let at2 = from;
  while (at2?.promotesTo[0] && at2.promotesTo[0] !== to.branch) {
    const next = config.environments.find((e) => e.branch === at2.promotesTo[0]);
    if (!next || path.includes(next)) break;
    path.push(next);
    at2 = next;
  }
  return at2?.promotesTo[0] === to.branch ? path : path.slice(0, 1);
}
function specificOn(run2, root, config, refs) {
  if (!config.environmentSpecific) return [];
  const out2 = /* @__PURE__ */ new Set();
  for (const ref of refs) {
    const r = git6(run2, root, "show", `${ref}:${config.environmentSpecific}`);
    if (r.code !== 0) continue;
    for (const l3 of r.stdout.split("\n").map((x2) => x2.trim()).filter((x2) => x2 && !x2.startsWith("#"))) out2.add(l3);
  }
  return [...out2];
}
function planPromotion(paths, config, fromName, toName, deps) {
  const { run: run2 } = deps;
  const from = envByName(config, fromName);
  if (!from.promotesTo.length) throw new AccError("refused", `${from.name} doesn't promote anywhere: its "promotesTo" is empty.`);
  const to = toName ? envByName(config, toName) : envByName(config, from.promotesTo[0]);
  if (!from.promotesTo.includes(to.branch)) throw new AccError("refused", `${from.name} can't promote to ${to.name}. Its "promotesTo" allows: ${from.promotesTo.join(", ")}.`);
  must(git6(run2, paths.root, "fetch", "--quiet", "origin", from.branch, to.branch), `Couldn't fetch ${from.branch} and ${to.branch}`);
  const src = `origin/${from.branch}`;
  const dst = `origin/${to.branch}`;
  const fromSha = must(git6(run2, paths.root, "rev-parse", src), `No ${src}`).trim();
  const toSha = must(git6(run2, paths.root, "rev-parse", dst), `No ${dst}`).trim();
  const parts = must(git6(run2, paths.root, "diff", "--name-status", "--no-renames", "-z", `${dst}...${src}`), "git diff failed").split("\0").filter(Boolean);
  const specific = specificOn(run2, paths.root, config, [src, dst]);
  const blob = (ref, f) => git6(run2, paths.root, "rev-parse", "--verify", "--quiet", `${ref}:${f}`).stdout.trim();
  const files = [];
  const deleted = [];
  const leftOut = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, f] = [parts[i], parts[i + 1]];
    if (listed(f, specific)) {
      leftOut.push(f);
      continue;
    }
    const there = blob(dst, f);
    if (status.startsWith("D")) {
      if (there) deleted.push(f);
      continue;
    }
    if (there && there === blob(src, f)) continue;
    files.push(f);
  }
  return { from, to, skipped: skippedOn(config, from, to), files, deleted, leftOut, fromSha, toSha };
}
var describeSkip = (plan) => plan.skipped.map((e) => `Skips \`${e.branch}\` (${e.name}): this change hasn't been validated there.`);
function promotionBody(plan, validation) {
  const list = (xs) => xs.length > 60 ? [...xs.slice(0, 60).map((f) => `- \`${f}\``), `- \u2026and ${xs.length - 60} more`] : xs.map((f) => `- \`${f}\``);
  return [
    `Promotes \`${plan.from.branch}\` (${plan.from.name}) at ${plan.fromSha.slice(0, 7)} into \`${plan.to.branch}\` (${plan.to.name}).`,
    "",
    ...plan.skipped.length ? ["> [!WARNING]", ...describeSkip(plan).map((l3) => `> ${l3}`), ""] : [],
    ...plan.deleted.length ? ["> [!WARNING]", `> Deletes ${plan.deleted.length} file${plan.deleted.length === 1 ? "" : "s"} in \`${plan.to.branch}\`. That usually means the branches have drifted apart.`, ""] : [],
    `## Changes (${plan.files.length})`,
    "",
    ...list(plan.files),
    ...plan.deleted.length ? ["", `## Deleted (${plan.deleted.length})`, "", ...list(plan.deleted)] : [],
    ...plan.leftOut.length ? ["", "## Left out: environment-specific", "", ...list(plan.leftOut)] : [],
    ...validation ? ["", "## Validation", "", `Check-only deploy to ${plan.to.name}: ${validation.status}. ${validation.summary}`] : [],
    "",
    "---",
    `Opened by \`acc promote\`. It merges only when a person merges it; deploying to ${plan.to.name} is a separate step after that.`
  ].join("\n") + "\n";
}
function promotionCheckArgs(org, source) {
  const apex = source.some((f) => /\.(cls|trigger)(-meta\.xml)?$/.test(f));
  return ["project", "deploy", "start", "--dry-run", "--target-org", org, "--wait", "90", "--json", "--ignore-conflicts", ...source.flatMap((f) => ["--source-dir", f]), "--test-level", apex ? "RunLocalTests" : "NoTestRun"];
}
function recordCarried(paths, plan, pr, carried, by, now2) {
  const problems = [];
  const at2 = now2().toISOString();
  try {
    mutate(paths, now2, (ledger, emit) => {
      for (const c of carried) {
        const t = ledger.tasks.find((x2) => x2.id === c.id);
        if (!t) continue;
        const promotion = { from: plan.from.branch, to: plan.to.branch, pr, state: "open", at: at2 };
        t.promotions = [...t.promotions ?? [], promotion];
        emit({ type: "task.updated", task: t.id, actor: "human", by, data: { promotion } });
      }
    });
  } catch (e) {
    problems.push(`Its tasks weren't recorded, so acc sync won't follow it for them: ${e.message}`);
  }
  const updates = [];
  try {
    for (const t of carried) {
      const u = draftUpdate(paths, t, { event: "promotion-opened", env: plan.to.name, pr }, by, now2);
      if (u) updates.push({ task: t.id, id: u.id, key: u.key });
    }
  } catch (e) {
    problems.push(`Its tickets' updates weren't all drafted: ${e.message}`);
  }
  return { updates, warning: problems.length ? `The pull request is open. ${problems.join(" ")}` : null };
}
function promote(paths, config, fromName, toName, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const plan = planPromotion(paths, config, fromName, toName, deps);
  const none = { tasks: [], updates: [], warning: null };
  if (!plan.files.length && !plan.deleted.length) return { plan, branch: null, pr: null, validation: null, stopped: `${plan.to.name} already has everything from ${plan.from.name}.`, ...none };
  if (plan.deleted.length && !opts.allowDeletions) {
    throw new AccError("refused", `Promoting would delete ${plan.deleted.length} file(s) in ${plan.to.branch}, which usually means the branches have drifted apart: ${plan.deleted.slice(0, 5).join(", ")}${plan.deleted.length > 5 ? ", \u2026" : ""}. Check them, then add --allow-deletions.`);
  }
  const gh = config.github;
  if (!gh) throw new AccError("no-github", 'acc promote opens a pull request on GitHub, and this project has no "github" section.');
  const stamp = now2().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const branch = `promote/${plan.from.branch}-to-${plan.to.branch}-${stamp}`;
  const dir = mkdtempSync2(join21(tmpdir2(), "acc-promote-"));
  const wt2 = join21(dir, "wt");
  let validation = null;
  try {
    deps.onStep?.(`Building ${branch} from ${plan.to.branch}`);
    must(git6(run2, paths.root, "worktree", "add", "--quiet", "-b", branch, wt2, plan.toSha), "Couldn't make the promotion worktree");
    for (let i = 0; i < plan.files.length; i += 200) must(git6(run2, wt2, "checkout", plan.fromSha, "--", ...plan.files.slice(i, i + 200)), "Couldn't bring the changes over");
    for (let i = 0; i < plan.deleted.length; i += 200) must(git6(run2, wt2, "rm", "--quiet", "--", ...plan.deleted.slice(i, i + 200)), "Couldn't remove the deleted files");
    must(git6(run2, wt2, "commit", "--quiet", "-m", `Promote ${plan.from.branch} to ${plan.to.branch}`, "-m", `${plan.files.length} changed, ${plan.deleted.length} deleted, from ${plan.fromSha.slice(0, 7)}.`), "Couldn't commit the promotion");
    const source = config.profile === "salesforce" ? under(plan.files, packageDirs(wt2)) : [];
    if (source.length && plan.to.org && opts.validate !== false) {
      deps.onStep?.(`Validating against ${plan.to.name} (${plan.to.org}). Nothing is saved to the org.`);
      const args = promotionCheckArgs(plan.to.org, source);
      assertCheckOnly("sf", args);
      const [cmd, a] = niced("sf", args);
      const r = withSlot(() => run2(cmd, a, { cwd: wt2, env: sfEnv(), timeoutMs: 120 * 6e4 }), { ...deps.slots });
      validation = readDeploy(r, plan.to.org, [], source.length);
      if (validation.status !== "pass") {
        return { plan, branch: null, pr: null, validation, stopped: `Validation against ${plan.to.name} didn't pass: ${validation.summary}`, ...none };
      }
    }
    const carried = carriedTasks(paths, run2, plan);
    deps.onStep?.(`Pushing ${branch}`);
    must(run2("git", ["push", "--quiet", "--set-upstream", "origin", `${branch}:${branch}`], { cwd: wt2, env: deps.env, timeoutMs: 5 * 6e4 }), `git push refused ${branch}`);
    const token = run2("gh", ["auth", "token", "-u", gh.account]);
    if (token.code !== 0) throw new AccError("no-github", `gh isn't logged in as ${gh.account}. The branch ${branch} is pushed; open its pull request on GitHub.`);
    const bodyFile = join21(dir, "body.md");
    writeFileSync19(bodyFile, promotionBody(plan, validation));
    const title = `Promote ${plan.from.name} to ${plan.to.name}${plan.skipped.length ? ` (skips ${plan.skipped.map((e) => e.branch).join(", ")})` : ""}`;
    const create = run2("gh", ["pr", "create", "-R", gh.repo, "--base", plan.to.branch, "--head", branch, "--title", title, "--body-file", bodyFile], { cwd: paths.root, env: { ...deps.env, GH_TOKEN: token.stdout.trim() }, timeoutMs: 2 * 6e4 });
    const url = create.stdout.trim().split("\n").find((l3) => /\/pull\/\d+/.test(l3))?.trim();
    if (create.code !== 0 || !url) throw new AccError("land", `gh couldn't open the pull request: ${(create.stderr || create.stdout).trim().split("\n")[0]}. The branch ${branch} is pushed.`);
    const pr = { number: Number(/\/pull\/(\d+)/.exec(url)[1]), url };
    mkdirSync18(paths.stateDir, { recursive: true });
    const tasks = carried.map((t) => t.id);
    appendFileSync3(join21(paths.stateDir, "promotions.jsonl"), JSON.stringify({ at: now2().toISOString(), from: plan.from.branch, to: plan.to.branch, fromSha: plan.fromSha, branch, pr, files: plan.files.length, deleted: plan.deleted.length, skipped: plan.skipped.map((e) => e.branch), tasks }) + "\n");
    return { plan, branch, pr, validation, stopped: null, tasks, ...recordCarried(paths, plan, pr, carried, opts.by ?? "acc promote", now2) };
  } finally {
    git6(run2, paths.root, "worktree", "remove", "--force", wt2);
    git6(run2, paths.root, "branch", "-D", branch);
    git6(run2, paths.root, "worktree", "prune");
    rmSync11(dir, { recursive: true, force: true });
  }
}
var skipWarning = describeSkip;

// packages/core/src/deploy.ts
import { existsSync as existsSync15, mkdirSync as mkdirSync19, mkdtempSync as mkdtempSync3, readFileSync as readFileSync19, renameSync as renameSync8, rmSync as rmSync12, writeFileSync as writeFileSync20 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import { join as join22 } from "node:path";
var deployRecordPath = (paths, env) => join22(paths.stateDir, "deploys", `${env}.json`);
function lastDeploy(paths, env) {
  try {
    return JSON.parse(readFileSync19(deployRecordPath(paths, env), "utf8"));
  } catch {
    return null;
  }
}
var git7 = (run2, cwd, ...args) => run2("git", args, { cwd });
function planDeploy(paths, config, envName, deps, opts = {}) {
  const { run: run2 } = deps;
  if (config.profile !== "salesforce") throw new AccError("refused", "acc deploy deploys Salesforce source to an org; this project isn't a Salesforce one.");
  const env = envByName(config, envName);
  if (!env.org) throw new AccError("refused", `${env.name} has no org alias in .acc/config.json.`);
  if (opts.noTests && (env.type === "production" || env.protected)) throw new AccError("refused", `${env.name} is ${env.type === "production" ? "production" : "protected"}: its deploys run the tests. --no-tests is for sandboxes.`);
  const fetched = git7(run2, paths.root, "fetch", "--quiet", "origin", env.branch);
  if (fetched.code !== 0) throw new AccError("git", `Couldn't fetch ${env.branch}: ${fetched.stderr.trim().split("\n").pop()}`);
  const head = git7(run2, paths.root, "rev-parse", `origin/${env.branch}`).stdout.trim();
  const last = lastDeploy(paths, env.branch);
  const since = opts.since ?? last?.sha;
  if (!since) throw new AccError("usage", `${env.name} hasn't been deployed by acc before, so say where to start: --since <the commit or tag the org already has>.`);
  const base = git7(run2, paths.root, "rev-parse", "--verify", "--quiet", `${since}^{commit}`).stdout.trim();
  if (!base) throw new AccError("usage", `There's no commit "${since}" here.`);
  if (git7(run2, paths.root, "merge-base", "--is-ancestor", base, head).code !== 0) throw new AccError("refused", `${since} isn't on ${env.branch}, so it can't be where the org's deploy starts.`);
  const r = git7(run2, paths.root, "diff", "--name-status", "--no-renames", "-z", base, head);
  const parts = r.stdout.split("\0").filter(Boolean);
  const show = (f) => git7(run2, paths.root, "show", `${head}:${f}`);
  const sfdx = show("sfdx-project.json");
  const dirs = (() => {
    if (sfdx.code !== 0) return ["force-app"];
    const tmp = mkdtempSync3(join22(tmpdir3(), "acc-sfdx-"));
    try {
      writeFileSync20(join22(tmp, "sfdx-project.json"), sfdx.stdout);
      return packageDirs(tmp);
    } finally {
      rmSync12(tmp, { recursive: true, force: true });
    }
  })();
  const specific = config.environmentSpecific ? show(config.environmentSpecific).stdout.split("\n").map((l3) => l3.trim()).filter((l3) => l3 && !l3.startsWith("#")) : [];
  const files = [];
  const deleted = [];
  const leftOut = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, f] = [parts[i], parts[i + 1]];
    if (!under([f], dirs).length) continue;
    if (listed(f, specific)) leftOut.push(f);
    else if (status.startsWith("D")) deleted.push(f);
    else files.push(f);
  }
  const apex = files.some((f) => /\.(cls|trigger)(-meta\.xml)?$/.test(f));
  return { env, org: env.org, base, head, files, deleted, leftOut, testLevel: apex && !opts.noTests ? "RunLocalTests" : "NoTestRun", confirm: env.protected };
}
function deployedTasks(paths, run2, plan) {
  const on = (sha, tip) => git7(run2, paths.root, "merge-base", "--is-ancestor", sha, tip).code === 0;
  return readLedger(paths.ledger).tasks.filter((t) => {
    const sha = arrivedAt(t, plan.env.branch);
    return !!sha && on(sha, plan.head) && !on(sha, plan.base);
  });
}
function deployArgs(plan) {
  return ["project", "deploy", "start", "--target-org", plan.org, "--wait", "90", "--json", "--test-level", plan.testLevel, ...plan.files.flatMap((f) => ["--source-dir", f])];
}
function deploy(paths, config, envName, deps, opts) {
  const { run: run2, now: now2 } = deps;
  const plan = planDeploy(paths, config, envName, deps, opts);
  if (!plan.files.length && !plan.deleted.length) return { plan, deployed: false, jobId: null, summary: `${plan.env.name} already has ${plan.env.branch} at ${plan.head.slice(0, 7)}.`, updates: [] };
  if (plan.deleted.length) {
    throw new AccError("refused", `${plan.deleted.length} file(s) were deleted on ${plan.env.branch} since the last deploy (${plan.deleted.slice(0, 5).join(", ")}${plan.deleted.length > 5 ? ", \u2026" : ""}). acc doesn't deploy deletions; remove them from the org by hand, or with a destructive-changes manifest.`);
  }
  if (plan.confirm && !opts.confirmed) throw new AccError("refused", `${plan.env.name} is protected. Deploying to it needs a person's confirmation: add --confirm-production.`);
  if (!plan.files.length) return { plan, deployed: false, jobId: null, summary: "Nothing deployable changed.", updates: [] };
  const dir = mkdtempSync3(join22(tmpdir3(), "acc-deploy-"));
  const wt2 = join22(dir, "wt");
  try {
    const add = git7(run2, paths.root, "worktree", "add", "--quiet", "--detach", wt2, plan.head);
    if (add.code !== 0) throw new AccError("git", `Couldn't check out ${plan.head.slice(0, 7)}: ${add.stderr.trim()}`);
    const [cmd, args] = niced("sf", deployArgs(plan));
    const r = withSlot(() => run2(cmd, args, { cwd: wt2, env: sfEnv(), timeoutMs: 120 * 6e4 }), { ...deps.slots, onWait: deps.onWait });
    let result;
    try {
      result = parseJsonOutput(r.stdout);
    } catch {
      throw new AccError("deploy", `sf gave no result: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
    }
    const jobId = result.result?.id ?? null;
    if (r.code !== 0 || result.status !== 0 || result.result?.success === false) {
      const failures2 = result.result?.details?.componentFailures;
      const list = (Array.isArray(failures2) ? failures2 : failures2 ? [failures2] : []).slice(0, 3).map((f) => `${f.fullName}: ${f.problem}`);
      return { plan, deployed: false, jobId, summary: `The deploy to ${plan.env.name} failed${jobId ? ` (job ${jobId})` : ""}: ${list.join("; ") || result.message || "see sf's output"}`, updates: [] };
    }
    const record = { env: plan.env.branch, org: plan.org, sha: plan.head, at: now2().toISOString(), by: opts.by, jobId, files: plan.files.length };
    const file = deployRecordPath(paths, plan.env.branch);
    mkdirSync19(join22(paths.stateDir, "deploys"), { recursive: true });
    writeFileSync20(`${file}.tmp`, JSON.stringify(record, null, 2) + "\n");
    renameSync8(`${file}.tmp`, file);
    const updates = [];
    let unsaid = "";
    try {
      for (const t of deployedTasks(paths, run2, plan)) {
        const u = draftUpdate(paths, t, { event: "deployed", env: plan.env.name }, opts.by, now2);
        if (u) updates.push({ task: t.id, id: u.id, key: u.key });
      }
    } catch (e) {
      unsaid = ` Its tickets' updates weren't all drafted: ${e.message}`;
    }
    return { plan, deployed: true, jobId, summary: `Deployed ${plan.files.length} file(s) from ${plan.env.branch} at ${plan.head.slice(0, 7)} to ${plan.env.name}${jobId ? ` (job ${jobId})` : ""}.${unsaid}`, updates };
  } finally {
    git7(run2, paths.root, "worktree", "remove", "--force", wt2);
    if (existsSync15(dir)) rmSync12(dir, { recursive: true, force: true });
  }
}

// packages/core/src/setup.ts
import { copyFileSync as copyFileSync2, existsSync as existsSync16, mkdirSync as mkdirSync20, mkdtempSync as mkdtempSync4, readFileSync as readFileSync20, rmSync as rmSync13, writeFileSync as writeFileSync21 } from "node:fs";
import { tmpdir as tmpdir4 } from "node:os";
import { dirname as dirname6, join as join23 } from "node:path";
var git8 = (run2, cwd, ...args) => run2("git", args, { cwd });
function refFor(run2, root, branch) {
  for (const ref of [`origin/${branch}`, branch]) if (git8(run2, root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`).code === 0) return ref;
  return null;
}
function inWorktree(run2, root, addArgs, fn2) {
  const tmp = mkdtempSync4(join23(tmpdir4(), "acc-setup-"));
  const dir = join23(tmp, "wt");
  const add = git8(run2, root, "worktree", "add", "--quiet", ...addArgs.slice(0, -1), dir, addArgs.at(-1));
  if (add.code !== 0) {
    rmSync13(tmp, { recursive: true, force: true });
    throw new AccError("git", `Couldn't make a worktree: ${lastLine(add.stderr)}`);
  }
  try {
    return fn2(dir);
  } finally {
    git8(run2, root, "worktree", "remove", "--force", dir);
    git8(run2, root, "worktree", "prune");
    rmSync13(tmp, { recursive: true, force: true });
  }
}
function parseManifest(xml) {
  const types = /* @__PURE__ */ new Map();
  for (const block of xml.match(/<types>[\s\S]*?<\/types>/g) ?? []) {
    const name = /<name>\s*([^<]+?)\s*<\/name>/.exec(block)?.[1];
    if (!name) continue;
    const set = types.get(name) ?? /* @__PURE__ */ new Set();
    for (const m of block.matchAll(/<members>\s*([^<]+?)\s*<\/members>/g)) set.add(m[1]);
    types.set(name, set);
  }
  return { types, version: /<version>\s*([^<]+?)\s*<\/version>/.exec(xml)?.[1] ?? null };
}
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function unionManifests(xmls) {
  const all = /* @__PURE__ */ new Map();
  let version = null;
  for (const xml of xmls) {
    const m = parseManifest(xml);
    for (const [t, ms] of m.types) all.set(t, /* @__PURE__ */ new Set([...all.get(t) ?? [], ...ms]));
    if (m.version && (!version || Number(m.version) > Number(version))) version = m.version;
  }
  const types = [...all.keys()].sort().map((t) => [
    "    <types>",
    ...[...all.get(t)].sort().map((m) => `        <members>${esc(m)}</members>`),
    `        <name>${esc(t)}</name>`,
    "    </types>"
  ].join("\n"));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<Package xmlns="http://soap.sforce.com/2006/04/metadata">', ...types, `    <version>${version ?? "62.0"}</version>`, "</Package>", ""].join("\n");
}
function buildBaseline(paths, config, deps) {
  if (config.profile !== "salesforce") throw new AccError("refused", "A baseline manifest is for Salesforce projects.");
  const { run: run2 } = deps;
  if (git8(run2, paths.root, "remote", "get-url", "origin").code === 0) git8(run2, paths.root, "fetch", "--quiet", "origin");
  const out2 = mkdtempSync4(join23(tmpdir4(), "acc-manifests-"));
  const xmls = [];
  const from = [];
  const generate = (dir, name) => {
    const dirs = packageDirs(dir).filter((d) => existsSync16(join23(dir, d)));
    if (!dirs.length) return;
    deps.onStep?.(`Listing the components on ${name}`);
    const r = run2(...niced("sf", ["project", "generate", "manifest", ...dirs.flatMap((d) => ["--source-dir", d]), "--output-dir", out2, "--name", name, "--json"]), { cwd: dir, env: sfEnv(), timeoutMs: 10 * 6e4 });
    const file2 = join23(out2, `${name}.xml`);
    if (r.code !== 0 || !existsSync16(file2)) throw new AccError("sf", `sf couldn't list the components on ${name}: ${lastLine(r.stderr || r.stdout)}`);
    xmls.push(readFileSync20(file2, "utf8"));
    from.push(name);
  };
  try {
    const branches = config.environments.map((e) => ({ e, ref: refFor(run2, paths.root, e.branch) })).filter((x2) => x2.ref);
    for (const { e, ref } of branches) inWorktree(run2, paths.root, ["--detach", ref], (dir) => generate(dir, e.branch));
    if (!from.length) generate(paths.root, "this-checkout");
  } finally {
    rmSync13(out2, { recursive: true, force: true });
  }
  if (!xmls.length) throw new AccError("refused", "There's no Salesforce source on any environment branch, or in this checkout, to list.");
  const xml = unionManifests(xmls);
  const file = join23(paths.root, BASELINE_MANIFEST);
  mkdirSync20(dirname6(file), { recursive: true });
  writeFileSync21(file, xml);
  const parsed = parseManifest(xml);
  return { file, from, types: parsed.types.size, members: [...parsed.types.values()].reduce((n, s) => n + s.size, 0) };
}
function retrieveInto(run2, dir, org, deps) {
  const r = withSlot(() => run2(...niced("sf", ["project", "retrieve", "start", "--manifest", BASELINE_MANIFEST, "--target-org", org, "--ignore-conflicts", "--wait", "60", "--json"]), { cwd: dir, env: sfEnv(), timeoutMs: 70 * 6e4 }), { ...deps.slots });
  try {
    const j2 = parseJsonOutput(r.stdout);
    if (r.code === 0 && j2.status === 0) return null;
    return (j2.message ?? "").trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`;
  } catch {
    return lastLine(r.stderr || r.stdout) || `exit ${r.code}`;
  }
}
function seedBranches(paths, config, deps, opts = {}) {
  const { run: run2, now: now2 } = deps;
  const sf = config.profile === "salesforce";
  const manifest = join23(paths.root, BASELINE_MANIFEST);
  if (sf && !existsSync16(manifest)) throw new AccError("refused", `There's no ${BASELINE_MANIFEST} yet. Make it first: acc setup baseline (B5).`);
  if (git8(run2, paths.root, "remote", "get-url", "origin").code === 0) git8(run2, paths.root, "fetch", "--quiet", "origin");
  const prod = config.environments.find((e) => e.type === "production") ?? config.environments.find((e) => e.protected) ?? null;
  const date = now2().toISOString().slice(0, 10);
  const out2 = [];
  const commitAll = (dir, message) => {
    git8(run2, dir, "add", "-A");
    const c = git8(run2, dir, "commit", "--quiet", "--allow-empty", "-m", message);
    if (c.code !== 0) throw new AccError("git", `Couldn't commit: ${lastLine(c.stderr)}`);
  };
  const seed = (e, start, clear) => {
    deps.onStep?.(`Making ${e.branch}${sf && e.org ? ` from ${e.org}` : ""}`);
    let made = false;
    try {
      inWorktree(run2, paths.root, ["-b", e.branch, start], (dir) => {
        if (sf) {
          copyFileSync2(manifest, join23(dir, BASELINE_MANIFEST));
          if (clear) {
            for (const d of packageDirs(dir)) if (existsSync16(join23(dir, d))) {
              git8(run2, dir, "rm", "-r", "-q", "--", d);
              mkdirSync20(join23(dir, d, "main", "default"), { recursive: true });
            }
          }
          if (e.org) {
            const failed = retrieveInto(run2, dir, e.org, deps);
            if (failed) throw new AccError("sf", `the retrieve from ${e.org} failed: ${failed}`);
          }
        }
        commitAll(dir, sf && e.org ? `Baseline: ${e.name} org metadata, retrieved ${date}` : `Branch for ${e.name}`);
      });
      made = true;
      const differs = prod && prod.branch !== e.branch && refFor(run2, paths.root, prod.branch) ? git8(run2, paths.root, "diff", "--no-renames", "--name-only", refFor(run2, paths.root, prod.branch), e.branch).stdout.split("\n").filter(Boolean).length : null;
      const pushed = opts.push ? git8(run2, paths.root, "push", "--quiet", "--set-upstream", "origin", `${e.branch}:${e.branch}`) : null;
      const note = !pushed ? "made locally; push it when you're happy with it" : pushed.code === 0 ? "made and pushed" : `made locally, but git push refused it: ${lastLine(pushed.stderr)}`;
      out2.push({ env: e.name, branch: e.branch, status: "made", note, differs });
    } catch (err) {
      if (!made && git8(run2, paths.root, "rev-parse", "--verify", "--quiet", `refs/heads/${e.branch}`).code === 0) git8(run2, paths.root, "branch", "-D", e.branch);
      out2.push({ env: e.name, branch: e.branch, status: made ? "made" : "failed", note: err.message, differs: null });
    }
  };
  if (prod && !refFor(run2, paths.root, prod.branch)) seed(prod, "HEAD", false);
  const prodRef = prod ? refFor(run2, paths.root, prod.branch) : null;
  for (const e of config.environments) {
    if (e === prod || refFor(run2, paths.root, e.branch)) continue;
    seed(e, prodRef ?? "HEAD", sf && !!prodRef);
  }
  return out2;
}
var ENV_SPECIFIC = [
  /\/emailservices\//,
  /\/namedCredentials\//,
  /\/externalCredentials\//,
  /\/remoteSiteSettings\//,
  /\/authproviders\//,
  /\/samlssoconfigs\//,
  /\/connectedApps\//,
  /\/cspTrustedSites\//,
  /\/corsWhitelistOrigins\//,
  /\/sites\//,
  /\/networks\//,
  /\/certs\//,
  /\/settings\/(Case|EmailAdministration|EmailIntegration|Security|SingleSignOn|MyDomain|Domain)\.settings-meta\.xml$/
];
var KNOWN_DRIFT = [/\/contentassets\//];
function readBlobs(run2, root, specs) {
  const out2 = /* @__PURE__ */ new Map();
  if (!specs.length) return out2;
  const r = run2("git", ["cat-file", "--batch"], { cwd: root, input: specs.join("\n") + "\n" });
  const buf = Buffer.from(r.stdout, "utf8");
  let at2 = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, at2);
    if (nl < 0) break;
    const head = buf.subarray(at2, nl).toString("utf8");
    at2 = nl + 1;
    const m = /^\S+ \S+ (\d+)$/.exec(head);
    if (!m) {
      out2.set(spec, null);
      continue;
    }
    const size = Number(m[1]);
    out2.set(spec, buf.subarray(at2, at2 + size).toString("utf8"));
    at2 += size + 1;
  }
  return out2;
}
var reorderedOnly = (a, b) => {
  if (a === null || b === null || a === b) return false;
  const lines = (s) => s.split("\n").map((l3) => l3.trimEnd()).filter(Boolean).sort().join("\n");
  return lines(a) === lines(b);
};
function draftLists(paths, config, deps) {
  const { run: run2 } = deps;
  if (config.profile !== "salesforce") throw new AccError("refused", "The environment-specific and known-drift lists are for Salesforce projects.");
  if (!config.environmentSpecific || !config.knownDrift) throw new AccError("refused", 'Name both lists in .acc/config.json first: "environmentSpecific": "manifest/environment-specific.txt" and "knownDrift": "manifest/known-drift.txt".');
  if (git8(run2, paths.root, "remote", "get-url", "origin").code === 0) git8(run2, paths.root, "fetch", "--quiet", "origin");
  const prod = config.environments.find((e) => e.type === "production");
  const prodRef = prod ? refFor(run2, paths.root, prod.branch) : null;
  if (!prod || !prodRef) throw new AccError("refused", "There's no production branch to compare the others with yet. Make the branches first (B6).");
  const specific = /* @__PURE__ */ new Set();
  const drift2 = /* @__PURE__ */ new Set();
  const unexplained = [];
  for (const e of config.environments) {
    if (e === prod) continue;
    const ref = refFor(run2, paths.root, e.branch);
    if (!ref) continue;
    const files = under(git8(run2, paths.root, "diff", "--no-renames", "--name-only", prodRef, ref).stdout.split("\n").filter(Boolean), packageDirs(paths.root));
    const rest = [];
    const maybe = [];
    for (const f of files) {
      if (ENV_SPECIFIC.some((p) => p.test(f))) specific.add(f);
      else if (KNOWN_DRIFT.some((p) => p.test(f))) drift2.add(f);
      else maybe.push(f);
    }
    const blobs = readBlobs(run2, paths.root, maybe.flatMap((f) => [`${prodRef}:${f}`, `${ref}:${f}`]));
    for (const f of maybe) {
      if (reorderedOnly(blobs.get(`${prodRef}:${f}`) ?? null, blobs.get(`${ref}:${f}`) ?? null)) drift2.add(f);
      else rest.push(f);
    }
    if (rest.length) unexplained.push({ branch: e.branch, files: rest });
  }
  const draft = (rel, found) => {
    const file = join23(paths.root, rel);
    const have = readList(paths.root, rel);
    const entries = [...found].filter((f) => !listed(f, have)).sort();
    if (existsSync16(file)) return { file, written: false, entries };
    mkdirSync20(dirname6(file), { recursive: true });
    writeFileSync21(file, entries.length ? `${entries.join("\n")}
` : "");
    return { file, written: true, entries };
  };
  return { environmentSpecific: draft(config.environmentSpecific, specific), knownDrift: draft(config.knownDrift, drift2), unexplained };
}
var README_START = "<!-- acc:environments -->";
var README_END = "<!-- /acc:environments -->";
function environmentsSection(config) {
  const envs = config.environments;
  const name = (b) => `\`${b}\``;
  const role = (e) => [
    e.protected ? "protected: changes arrive only by promotion" : "",
    e.default ? "day-to-day work" : "",
    e.promotesTo.length ? `promotes to ${e.promotesTo.map(name).join(" or ")}` : ""
  ].filter(Boolean).join("; ") || "\u2013";
  const rows = envs.map((e) => `| ${e.name} | ${name(e.branch)} | ${e.org ?? "\u2013"} | ${e.type === "none" ? "branch" : e.type.replace("_", " ")} | ${role(e)} |`);
  const paths = promotionPaths(envs);
  return [
    README_START,
    "## Environments",
    "",
    "Each environment has its own branch, named after it.",
    "",
    "| Environment | Branch | Org | Type | Role |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    ...paths.length ? ["**How changes move:** " + paths.map((p) => p.map(name).join(" \u2192 ")).join(", or ") + ". Each step is a pull request (`acc promote`), and a deploy after it merges (`acc deploy`).", ""] : [],
    ...config.environmentSpecific ? [`**Environment-specific files,** listed in \`${config.environmentSpecific}\`, differ in every org by design. They're never promoted, deployed, or changed as part of a task.`, ""] : [],
    `_This section is kept by \`acc setup readme\`; edit the environments in \`.acc/config.json\`._`,
    README_END
  ].join("\n");
}
function writeReadme(paths, config) {
  const file = join23(paths.root, "README.md");
  const section = environmentsSection(config);
  if (!existsSync16(file)) {
    writeFileSync21(file, `# ${config.project}

${section}
`);
    return { file, created: true, replaced: false };
  }
  const text = readFileSync20(file, "utf8");
  const a = text.indexOf(README_START);
  const b = text.indexOf(README_END);
  if (a >= 0 && b > a) {
    writeFileSync21(file, `${text.slice(0, a)}${section}${text.slice(b + README_END.length)}`);
    return { file, created: false, replaced: true };
  }
  writeFileSync21(file, `${text.replace(/\s*$/, "")}

${section}
`);
  return { file, created: false, replaced: false };
}

// packages/core/src/onboarding/steps.ts
import { existsSync as existsSync17, readdirSync as readdirSync6, readFileSync as readFileSync21 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { dirname as dirname7, join as join24, sep as sep3 } from "node:path";
var DOCS = "docs/ONBOARDING.md";
var GH_SIGN_IN = `"Do it" opens VSCode's GitHub sign-in: pick this repo's account, or add it, and gh gets that login, with access to GitHub Projects for the board. gh's active account stays as it was. In a terminal: gh auth login.`;
var DATA_EXT = /\.(csv|xls|xlsx|eml)$/i;
var BACKSTOP = ["/*.csv", "/*.xls", "/*.xlsx", "/*.eml"];
function needsProject(ctx) {
  if (!ctx.paths) return skip2("Not inside a repo.");
  if (!ctx.config) return skip2("Needs a valid .acc/config.json first (step B0).");
  return null;
}
function nearbyRepo(cwd) {
  const isRepo = (d) => existsSync17(join24(d, ".git"));
  const parent = dirname7(cwd);
  let siblings = [];
  try {
    siblings = readdirSync6(parent, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => join24(parent, e.name));
  } catch {
    siblings = [];
  }
  const candidates = [...siblings.filter((d) => d !== cwd), parent].filter(isRepo);
  return candidates.find((d) => existsSync17(join24(d, ".acc", "config.json"))) ?? candidates.find((d) => existsSync17(join24(d, "sfdx-project.json"))) ?? null;
}
function filesOnEnvironmentBranches(ctx) {
  return cached(ctx, "env-branch-files", () => {
    const files = /* @__PURE__ */ new Set();
    for (const env of ctx.config.environments) {
      for (const ref of [`origin/${env.branch}`, env.branch]) {
        const r = ctx.run("git", ["ls-tree", "-r", "--name-only", ref], { cwd: ctx.paths.root });
        if (r.code === 0) {
          for (const f of r.stdout.split("\n")) if (f) files.add(f);
        }
      }
    }
    return files;
  });
}
var sfEnvs = (ctx) => (ctx.config?.environments ?? []).filter((e) => e.type !== "none");
var devEnvs = (ctx) => sfEnvs(ctx).filter((e) => (e.type === "developer" || e.type === "developer_pro") && e.org);
var API_KEY_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
var CLOUD_VARS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"];
var isTrue = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
function billingVars(vars) {
  return [...API_KEY_VARS.filter((v) => String(vars[v] ?? "") !== ""), ...CLOUD_VARS.filter((v) => isTrue(vars[v]))];
}
function claudeSettingsFiles(ctx) {
  const home = ctx.env.HOME || homedir5();
  const tilde = (f) => f.startsWith(home + sep3) ? `~${f.slice(home.length)}` : f;
  const user = ctx.env.CLAUDE_CONFIG_DIR ? join24(ctx.env.CLAUDE_CONFIG_DIR, "settings.json") : join24(home, ".claude", "settings.json");
  const files = [{ file: user, label: tilde(user) }];
  if (!ctx.paths) return files;
  let main2 = ctx.paths.root;
  try {
    main2 = mainCheckout(ctx.run, ctx.paths.root);
  } catch {
  }
  for (const root of /* @__PURE__ */ new Set([ctx.paths.root, main2])) {
    for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
      files.push({ file: join24(root, rel), label: root === ctx.paths.root ? rel : tilde(join24(root, rel)) });
    }
  }
  return files;
}
function billingSettings(file) {
  let text;
  try {
    text = readFileSync21(file, "utf8");
  } catch {
    return [];
  }
  let s;
  try {
    s = JSON.parse(text) ?? {};
  } catch {
    return null;
  }
  const found = s.apiKeyHelper ? ["apiKeyHelper"] : [];
  if (s.env && typeof s.env === "object") found.push(...billingVars(s.env).map((v) => `${v} under env`));
  return found;
}
var PLUGIN = { marketplace: "agent-command-center", name: "acc", repo: "https://github.com/jack-huffman/agent-command-center" };
var PLUGIN_ID = `${PLUGIN.name}@${PLUGIN.marketplace}`;
var MARKETPLACE_ADD = `claude plugin marketplace add ${PLUGIN.repo}`;
var PLUGIN_INSTALL = `claude plugin install ${PLUGIN_ID} --scope user`;
var PLUGIN_UPDATE = `claude plugin marketplace update ${PLUGIN.marketplace} && claude plugin update ${PLUGIN_ID} --scope user`;
var SEMVER = /^\d+\.\d+\.\d+$/;
function claudeJson(ctx, args) {
  const r = ctx.run("claude", args, { env: ctx.env });
  if (r.code === 127) return 127;
  if (r.code !== 0) return `claude ${args.slice(0, 2).join(" ")} didn't run: ${(r.stderr || r.stdout).trim().split("\n")[0] || `exit ${r.code}`}`;
  try {
    const list = parseJsonOutput(r.stdout);
    if (Array.isArray(list) && list.every((x2) => x2 && typeof x2 === "object")) return list;
  } catch {
  }
  return `claude ${args.slice(0, 2).join(" ")} printed something other than a list.`;
}
function versionStep(id, title, why, cmd, args, min, fix, profiles) {
  return {
    id,
    part: "machine",
    group: "A1",
    title,
    why,
    profiles,
    fix: { command: fix },
    check(ctx) {
      const r = ctx.run(cmd, args, { env: ctx.env });
      if (r.code === 127) return fail2(`${cmd} isn't installed.`);
      if (r.code !== 0) return fail2(`${cmd} didn't run: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
      const v = firstVersion(r.stdout + r.stderr);
      if (min && (!v || !versionAtLeast(v, min))) return fail2(`${cmd} ${v ?? "(unknown version)"} is older than ${min}.`);
      return pass2(`${cmd} ${v ?? ""}`.trim());
    }
  };
}
var STEPS = [
  // ------------------------------------------------------------ Part A: this machine
  versionStep("A1.git", "git 2.40 or later", "Worktrees and the shared git directory need a recent git.", "git", ["--version"], "2.40", "brew install git"),
  // acc itself needs no Node: its launcher falls back to VSCode's runtime (D-077).
  versionStep("A1.node", "Node 20 or later", "The Salesforce CLI and its plugins run on Node, and npm installs them. acc itself doesn't need it.", "node", ["--version"], "20", "brew install node", ["salesforce"]),
  versionStep("A1.gh", "GitHub CLI", "Pull requests, issues and the per-repo account all go through gh.", "gh", ["--version"], null, "brew install gh"),
  {
    id: "A1.claude",
    part: "machine",
    group: "A1",
    title: "Claude Code CLI with background sessions",
    why: "Builders run as `claude --bg` sessions (D-009). The VSCode extension ships its own copy, so the terminal CLI can fall far behind.",
    fix: { command: "claude update" },
    check(ctx) {
      const v = ctx.run("claude", ["--version"], { env: ctx.env });
      if (v.code === 127) return fail2("claude isn't installed.", "brew install --cask claude-code");
      const h2 = ctx.run("claude", ["--help"], { env: ctx.env });
      if (!/--bg\b/.test(h2.stdout)) return fail2(`claude ${firstVersion(v.stdout) ?? ""} has no --bg. Update it.`);
      return pass2(`claude ${firstVersion(v.stdout) ?? ""}`.trim());
    }
  },
  {
    id: "A1.claude-billing",
    part: "machine",
    group: "A1",
    title: "Agents bill your Claude subscription",
    why: "On your Claude subscription, agents' work counts toward the plan you already pay for; with an API key, or through Bedrock or Vertex, every token they use is billed on top, and nothing else tells you.",
    fix: {
      text: 'Remove each setting the check names: take the variable out of your shell profile (such as ~/.zshrc) and open a new terminal, or delete apiKeyHelper, or the variable under "env", from the settings file it names. If Claude Code then asks you to sign in, use /login with your Claude account. Keeping one on purpose, such as a key you mean to bill per token, is fine: mark this done.'
    },
    check(ctx) {
      const found = billingVars(ctx.env).map((v) => `${v} in the environment`);
      const unreadable = [];
      for (const { file, label } of claudeSettingsFiles(ctx)) {
        const names2 = billingSettings(file);
        if (names2) found.push(...names2.map((n) => `${n} in ${label}`));
        else unreadable.push(label);
      }
      const note = unreadable.length ? `Not valid JSON, so not checked: ${unreadable.join(", ")}.` : "";
      if (found.length) return fail2(`Agents would bill per token, not your Claude subscription: ${found.join(", ")}.${note && ` ${note}`}`);
      if (unreadable.length) return unknown(note);
      return pass2("Agents use your Claude subscription.");
    }
  },
  versionStep("A1.sf", "Salesforce CLI", "Validation, retrieves and org checks use sf.", "sf", ["--version"], null, "npm install -g @salesforce/cli", ["salesforce"]),
  {
    id: "A1.code-analyzer",
    part: "machine",
    group: "A1",
    title: "Salesforce Code Analyzer",
    profiles: ["salesforce"],
    why: "The `static` check runs `sf code-analyzer`.",
    fix: { command: "sf plugins install code-analyzer" },
    check(ctx) {
      const r = ctx.run("sf", ["plugins"], { env: { ...ctx.env, SF_NO_UPDATE_NOTIFIER: "true" } });
      if (r.code === 127) return fail2("sf isn't installed.");
      return /code-analyzer/.test(r.stdout) ? pass2("code-analyzer plugin installed") : fail2("The code-analyzer plugin isn't installed.");
    }
  },
  {
    id: "A2.gh-login",
    part: "machine",
    group: "A2",
    title: "Logged in to GitHub",
    why: "Each repo uses its own account through `gh auth token -u`. Never `gh auth switch`, which changes every session.",
    fix: { vscode: "acc.github.signIn", text: GH_SIGN_IN },
    check(ctx) {
      const r = ctx.run("gh", ["auth", "status"], { env: ctx.env });
      if (r.code === 127) return fail2("gh isn't installed.");
      const accounts = [...(r.stdout + r.stderr).matchAll(/account (\S+)/g)].map((m) => m[1]);
      if (!accounts.length) return fail2("gh isn't logged in to any account.");
      const want = ctx.config?.github?.account;
      if (want && !accounts.includes(want)) return fail2(`gh isn't logged in as ${want}. Logged in: ${accounts.join(", ")}.`, `gh auth login   # as ${want}`);
      return pass2(`Logged in as ${accounts.join(", ")}`);
    }
  },
  {
    id: "A4.plugin",
    part: "machine",
    group: "A4",
    title: "The acc plugin in Claude Code",
    why: "Its hooks keep each builder inside its own worktree and away from pushes, merges and deploys, and send it back to the finish line if it stops early. It also gives agents acc's skills and the reviewer. It's installed once, for every Claude Code session, and does nothing in a repo without .acc/config.json.",
    fix: {
      command: `${MARKETPLACE_ADD} && ${PLUGIN_INSTALL}`,
      text: "Claude Code clones this private repo with your own git credentials, so accept the invitation to it first. Sessions already running don't load the plugin: start a new one."
    },
    check(ctx) {
      const list = claudeJson(ctx, ["plugin", "list", "--json"]);
      if (list === 127) return fail2("claude isn't installed. Do A1.claude first.", "brew install --cask claude-code");
      if (typeof list === "string") return unknown(`Couldn't read Claude Code's plugins: ${list}`);
      const mine = list.filter((p) => p.id === PLUGIN_ID);
      const user = mine.find((p) => p.scope === "user");
      const version = typeof user?.version === "string" ? user.version : "(unknown version)";
      if (user?.enabled === true) {
        if (ctx.version && SEMVER.test(version) && SEMVER.test(ctx.version) && !versionAtLeast(version, ctx.version)) {
          return fail2(`acc ${version} is installed, older than this acc (${ctx.version}).`, PLUGIN_UPDATE);
        }
        return pass2(`acc ${version}, for every Claude Code session.`);
      }
      if (user) return fail2(`acc ${version} is installed but disabled.`, `claude plugin enable ${PLUGIN_ID} --scope user`);
      const scopes = [...new Set(mine.map((p) => String(p.scope)))];
      const only = scopes.length ? ` It's installed for one project only (${scopes.join(", ")} scope), not for every session.` : "";
      const markets = claudeJson(ctx, ["plugin", "marketplace", "list", "--json"]);
      if (Array.isArray(markets) && markets.some((m) => m.name === PLUGIN.marketplace)) return fail2(`acc isn't installed in Claude Code.${only}`, PLUGIN_INSTALL);
      return fail2(`acc isn't installed in Claude Code, and its marketplace isn't added.${only}`, `${MARKETPLACE_ADD} && ${PLUGIN_INSTALL}`);
    }
  },
  // ------------------------------------------------------------ Part B: this project
  {
    id: "B0.repo",
    part: "project",
    group: "B0",
    title: "Inside the project's repo",
    why: "Everything per-project hangs off the repo: config, branches, and the ledger in the git directory (D-008).",
    fix: { fromCheck: true, docs: `${DOCS}#b1-decide-where-everything-lives` },
    check(ctx) {
      if (ctx.paths) return pass2(`Repo at ${ctx.paths.root}`);
      const near = nearbyRepo(ctx.cwd);
      if (near) return { status: "fail", detail: `This folder isn't a git repo. The project's repo looks like ${near}. Open that folder instead.`, open: near };
      const sfdx = existsSync17(join24(ctx.cwd, "sfdx-project.json"));
      return fail2(sfdx ? "This Salesforce folder isn't a git repo yet. Onboarding starts with the client's repo (guide steps B1 and B2)." : "This folder isn't a git repo. Open the project's repo folder.");
    }
  },
  {
    id: "B0.config",
    part: "project",
    group: "B0",
    title: "Project config",
    why: "`.acc/config.json` names the environments, GitHub account and checks.",
    fix: { command: "acc init" },
    check(ctx) {
      if (!ctx.paths) return skip2("Not inside a repo.");
      if (ctx.config) {
        const n = ctx.config.environments.length;
        return pass2(`${ctx.config.project}: ${ctx.config.profile}, ${n} environment${n === 1 ? "" : "s"}`);
      }
      if (!existsSync17(ctx.paths.config)) return fail2("There's no .acc/config.json yet.");
      return fail2(`.acc/config.json has problems: ${ctx.configErrors.join(" ")}`);
    }
  },
  {
    id: "B1.orgs",
    part: "project",
    group: "B1",
    title: "Every org is listed",
    profiles: ["salesforce"],
    why: "Pipelines differ by client, so the config lists every sandbox Production has, with its type (D-018).",
    fix: { command: "acc init --force" },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const prod = ctx.config.environments.find((e) => e.type === "production");
      if (!prod) return fail2("There's no Production environment.");
      if (!prod.org) return fail2("Production has no org alias.");
      const q2 = sfJson(ctx, ["data", "query", "--use-tooling-api", "-q", "SELECT SandboxName, LicenseType FROM SandboxInfo", "-o", prod.org]);
      if (q2.status !== 0) return unknown(`Couldn't read Production's sandbox list: ${q2.message ?? "sf failed"}`);
      const records = q2.result?.records ?? [];
      const problems = [];
      const listed2 = [];
      for (const r of records) {
        const env = ctx.config.environments.find((e) => e.branch === branchFor(r.SandboxName));
        const type = LICENSE_TO_TYPE[r.LicenseType] ?? r.LicenseType.toLowerCase();
        if (!env) problems.push(`${r.SandboxName} (${type}) isn't in the config.`);
        else if (env.type !== type) problems.push(`${env.name} is ${type} in Salesforce but "${env.type}" in the config.`);
        else listed2.push(`${env.branch} (${type})`);
      }
      const known = new Set(records.map((r) => branchFor(r.SandboxName)));
      for (const e of ctx.config.environments) {
        if (e.type !== "production" && e.type !== "none" && !known.has(e.branch)) problems.push(`${e.name} is in the config but not in Production's sandbox list.`);
      }
      return problems.length ? fail2(problems.join(" ")) : pass2(`All ${records.length} sandboxes are listed: ${listed2.join(", ")}`);
    }
  },
  {
    id: "B2.identity",
    part: "project",
    group: "B2",
    title: "Commit identity",
    why: "Commits in this repo carry its own name and email, set in the repo only.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const want = ctx.config.commitIdentity;
      if (!want) return skip2("No commitIdentity in the config.");
      const get = (k2) => ctx.run("git", ["config", "--local", "--get", k2], { cwd: ctx.paths.root }).stdout.trim();
      const name = get("user.name");
      const email = get("user.email");
      if (name === want.name && email === want.email) return pass2(`${name} <${email}>`);
      return fail2(
        `Commits would be ${name || "(no name)"} <${email || "no email"}>, not ${want.name} <${want.email}>.`,
        `git config user.name "${want.name}" && git config user.email "${want.email}"`
      );
    }
  },
  {
    id: "B2.account",
    part: "project",
    group: "B2",
    title: "The repo's GitHub account is logged in",
    why: "acc runs every gh call for this repo as its own account (D-007).",
    fix: { vscode: "acc.github.signIn", text: GH_SIGN_IN },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const account = ctx.config.github?.account;
      if (!account) return skip2("No GitHub account in the config.");
      return ghEnv2(ctx) ? pass2(`gh can act as ${account}`) : fail2(`gh isn't logged in as ${account}.`, `gh auth login   # as ${account}`);
    }
  },
  {
    id: "B2.credentials",
    part: "project",
    group: "B2",
    title: "git pushes as the right account",
    why: "gh's own credential helper ignores the username and uses the active account, so a repo can silently push as the wrong one.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const account = ctx.config.github?.account;
      if (!account) return skip2("No GitHub account in the config.");
      const helper = `git config credential.helper '' && git config --add credential.helper '${credentialHelper(ctx.config.github.account)}'`;
      const fill = ctx.run("git", ["credential", "fill"], {
        cwd: ctx.paths.root,
        input: "protocol=https\nhost=github.com\n\n",
        env: { ...ctx.env, GIT_TERMINAL_PROMPT: "0" }
      });
      const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
      if (fill.code !== 0 || !token) return fail2("git has no GitHub credential for this repo.", helper);
      const who = ctx.run("gh", ["api", "user", "--jq", ".login"], { env: { ...ctx.env, GH_TOKEN: token } });
      const login = who.stdout.trim();
      if (who.code !== 0) return unknown("git returned a credential, but GitHub didn't accept it.");
      return login === account ? pass2(`git pushes as ${login}`) : fail2(`git would push as ${login}, not ${account}.`, helper);
    }
  },
  {
    id: "B3.gitignore",
    part: "project",
    group: "B3",
    title: "Client data blocked at the repo root",
    profiles: ["salesforce"],
    why: "A backstop. The real safeguard is keeping client data in the Working Files folder.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const lines = new Set((readText(ctx.paths.root, ".gitignore") ?? "").split("\n").map((l3) => l3.trim()));
      const missing = BACKSTOP.filter((p) => !lines.has(p));
      return missing.length ? fail2(`.gitignore is missing ${missing.join(", ")}.`, `printf '${missing.join("\\n")}\\n' >> .gitignore`) : pass2("CSV, XLS, XLSX and EML are blocked at the root.");
    }
  },
  {
    id: "B3.data-files",
    part: "project",
    group: "B3",
    title: "No client data files in git",
    profiles: ["salesforce"],
    why: "Contact imports and workbooks belong in the Working Files folder, outside the repo.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const files = ctx.run("git", ["ls-files"], { cwd: ctx.paths.root }).stdout.split("\n").filter((f) => f && !f.includes("/") && DATA_EXT.test(f));
      return files.length ? fail2(`Tracked data files: ${files.join(", ")}.`, `git rm --cached ${files.map((f) => JSON.stringify(f)).join(" ")}`) : pass2("No data files at the repo root.");
    }
  },
  {
    id: "B3.secrets",
    part: "project",
    group: "B3",
    title: "No credentials in tracked files",
    why: "Org auth URLs, tokens and private keys must never be committed.",
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const scan = ctx.config.secretScan;
      const spec = [...scan.paths, ...scan.exclude.map((x2) => `:(exclude)${x2}`)];
      const r = ctx.run("git", ["grep", "-I", "-l", "-E", SECRET_PATTERN, "--", ...spec], { cwd: ctx.paths.root });
      if (r.code === 1) return pass2(`No credentials found (scanned: ${scan.paths.join(", ")})`);
      if (r.code === 0) return fail2(`Possible credentials in: ${r.stdout.trim().split("\n").join(", ")}.`, "Remove them, rotate the credential, and rewrite history if it was pushed.");
      return unknown(`The scan didn't run: ${r.stderr.trim().split("\n")[0]}`);
    }
  },
  {
    id: "B4.skeleton",
    part: "project",
    group: "B4",
    title: "Salesforce project skeleton",
    profiles: ["salesforce"],
    why: "sfdx-project.json defines the source folders, and local tool state must stay out of git.",
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const sfdx = readText(ctx.paths.root, "sfdx-project.json");
      if (!sfdx) return fail2("There's no sfdx-project.json.");
      const local = ctx.run("git", ["ls-files", ".sf", ".sfdx", ".claude/settings.local.json"], { cwd: ctx.paths.root }).stdout.trim();
      if (local) return fail2(`Local tool state is tracked: ${local.split("\n").join(", ")}.`, "git rm -r --cached .sf .sfdx");
      try {
        const dirs = (JSON.parse(sfdx).packageDirectories ?? []).map((d) => d.path);
        return pass2(`Source in ${dirs.join(", ") || "(none listed)"}`);
      } catch {
        return fail2("sfdx-project.json isn't valid JSON.");
      }
    }
  },
  {
    id: "B5.baseline",
    part: "project",
    group: "B5",
    title: "Baseline manifest",
    profiles: ["salesforce"],
    why: "Every branch is retrieved with the same component list, so a diff between branches is real drift.",
    fix: { command: "acc setup baseline", text: '"Do it" lists the components on every environment branch with sf, and writes the union to manifest/baseline-package.xml. Commit it on each branch.', docs: `${DOCS}#b5-make-one-baseline-manifest-for-every-environment` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const xml = readText(ctx.paths.root, "manifest/baseline-package.xml");
      if (!xml) return fail2("There's no manifest/baseline-package.xml.");
      const members = (xml.match(/<members>/g) ?? []).length;
      return members ? pass2(`${members} components`) : fail2("manifest/baseline-package.xml lists no components.");
    }
  },
  {
    id: "B6.branches",
    part: "project",
    group: "B6",
    title: "A branch for every environment",
    why: "Each environment has its own branch, named after it (D-015).",
    fix: { command: "acc setup branches", text: `"Do it" makes each missing branch: production's from this checkout, then each sandbox's from it, each retrieved from its own org (read only). Nothing is pushed until you push it.`, docs: `${DOCS}#b6-create-a-branch-per-environment-named-after-it-and-seed-each-from-its-org` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const has = (ref) => ctx.run("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: ctx.paths.root }).code === 0;
      const missing = ctx.config.environments.filter((e) => !has(`refs/heads/${e.branch}`) && !has(`refs/remotes/origin/${e.branch}`)).map((e) => e.branch);
      return missing.length ? fail2(`No branch for ${missing.join(", ")}.`) : pass2(ctx.config.environments.map((e) => e.branch).join(", "));
    }
  },
  {
    id: "B6.org-match",
    part: "project",
    group: "B6",
    title: "Each branch points at the right org",
    profiles: ["salesforce"],
    why: "A sandbox's name is in its URL, so the tool can prove a branch deploys where its name says (D-015).",
    fix: { vscode: "acc.sf.login", text: `"Do it" checks each environment's org, lists the ones that need a login first, and opens Salesforce's login for the one you pick, at the URL its name implies. Nothing to type: you sign in in the browser.` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const problems = [];
      const ok = [];
      for (const e of sfEnvs(ctx)) {
        if (!e.org) {
          problems.push(`${e.name} has no org alias.`);
          continue;
        }
        const d = sfJson(ctx, ["org", "display", "-o", e.org]);
        if (d.status !== 0) {
          problems.push(`"${e.org}" isn't logged in (${d.message ?? "sf failed"}).`);
          continue;
        }
        const url = parseOrgUrl(String(d.result?.instanceUrl ?? ""));
        if (e.type === "production") {
          if (url.kind !== "production") problems.push(`"${e.org}" isn't a Production org.`);
          else ok.push(`${e.branch} \u2192 ${url.domain}`);
        } else if (url.kind !== "sandbox") problems.push(`"${e.org}" isn't a sandbox.`);
        else if (url.sandbox !== e.branch) problems.push(`"${e.org}" is the "${url.sandbox}" sandbox, but its branch is "${e.branch}".`);
        else ok.push(`${e.branch} \u2192 ${url.domain}--${url.sandbox}`);
      }
      return problems.length ? fail2(problems.join(" "), 'sf org login web --alias "<alias>" --instance-url <My Domain URL>') : pass2(ok.join(", "));
    }
  },
  {
    id: "B8.tracking",
    part: "project",
    group: "B8",
    title: "Developer sandboxes are source tracked",
    profiles: ["salesforce"],
    why: "A Developer sandbox is tracked only if tracking was on when it was created, or switched on inside it afterwards.",
    fix: {
      text: "Log in to the sandbox: Setup \u2192 Sandbox Settings \u2192 Enable Source Tracking in This Sandbox.",
      setupPath: "/lightning/setup/SetupOneHome/home",
      docs: "https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-setup-enable-source-tracking-sandboxes.html"
    },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const envs = devEnvs(ctx);
      if (!envs.length) return skip2("No Developer sandboxes in this project.");
      const off = envs.filter((e) => sfJson(ctx, ["data", "query", "--use-tooling-api", "-q", "SELECT COUNT() FROM SourceMember", "-o", e.org]).status !== 0);
      return off.length ? fail2(`Not tracked: ${off.map((e) => e.name).join(", ")}.`) : pass2(`Tracked: ${envs.map((e) => e.name).join(", ")}`);
    }
  },
  {
    id: "B8.cli-tracking",
    part: "project",
    group: "B8",
    title: "The CLI knows they're tracked",
    profiles: ["salesforce"],
    why: "An org logged in before tracking was switched on is remembered as untracked.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const envs = devEnvs(ctx);
      if (!envs.length) return skip2("No Developer sandboxes in this project.");
      const list = sfJson(ctx, ["org", "list"]);
      if (list.status !== 0) return unknown(`Couldn't list orgs: ${list.message ?? "sf failed"}`);
      const all = Object.values(list.result ?? {}).filter(Array.isArray).flat();
      const off = envs.filter((e) => !all.some((o) => o.alias === e.org && o.tracksSource === true));
      return off.length ? fail2(`The CLI treats ${off.map((e) => `"${e.org}"`).join(", ")} as untracked.`, off.map((e) => `sf org enable tracking -o "${e.org}"`).join(" && ")) : pass2("The CLI tracks source for every Developer sandbox.");
    }
  },
  {
    id: "B9.lists",
    part: "project",
    group: "B9",
    title: "Environment-specific and known-drift lists",
    profiles: ["salesforce"],
    why: "Environment config is never promoted or deployed (D-016), and drift checks need to know what differs by design.",
    fix: { command: "acc setup lists", text: `"Do it" drafts both lists from how each sandbox's branch differs from production's, and names the differences neither explains. It never overwrites a list you have.`, docs: `${DOCS}#b9-sort-out-the-environment-specific-differences` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const problems = [];
      const counts = [];
      for (const [label, rel] of [["environment-specific", ctx.config.environmentSpecific], ["known-drift", ctx.config.knownDrift]]) {
        if (!rel) {
          problems.push(`No ${label} list in the config.`);
          continue;
        }
        const text = readText(ctx.paths.root, rel);
        if (text === null) {
          problems.push(`${rel} doesn't exist.`);
          continue;
        }
        const lines = text.replace(/\n$/, "").split("\n");
        if (lines.some((l3) => l3.trim() === "")) problems.push(`${rel} has a blank line. As a grep pattern, that matches everything.`);
        const paths = lines.filter((l3) => l3.trim() && !l3.startsWith("#"));
        const here = paths.filter((p) => !existsSync17(join24(ctx.paths.root, p)));
        const elsewhere = here.length ? filesOnEnvironmentBranches(ctx) : /* @__PURE__ */ new Set();
        const gone = here.filter((p) => !elsewhere.has(p));
        if (gone.length) problems.push(`${rel} lists files that don't exist: ${gone.slice(0, 3).join(", ")}${gone.length > 3 ? " \u2026" : ""}.`);
        counts.push(`${paths.length} ${label}`);
      }
      return problems.length ? fail2(problems.join(" ")) : pass2(counts.join(", "));
    }
  },
  {
    id: "B10.default-branch",
    part: "project",
    group: "B10",
    title: "GitHub's default branch is the day-to-day one",
    why: "New pull requests then target day-to-day work, not a protected environment.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const gh = ctx.config.github;
      if (!gh) return skip2("No GitHub repo in the config.");
      const env = ghEnv2(ctx);
      if (!env) return unknown(`gh isn't logged in as ${gh.account}.`);
      const want = ctx.config.environments.find((e) => e.default).branch;
      const r = ctx.run("gh", ["api", `repos/${gh.repo}`, "--jq", ".default_branch"], { env });
      if (r.code !== 0) return unknown(`Couldn't read ${gh.repo}: ${r.stderr.trim().split("\n")[0]}`);
      const got = r.stdout.trim();
      return got === want ? pass2(`${gh.repo} defaults to ${got}`) : fail2(`${gh.repo} defaults to ${got}, not ${want}.`, `gh repo edit ${gh.repo} --default-branch ${want}`);
    }
  },
  {
    id: "B10.default-org",
    part: "project",
    group: "B10",
    title: "The local default org is the day-to-day one",
    profiles: ["salesforce"],
    why: "A deploy without --target-org then can't reach Production.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const want = ctx.config.environments.find((e) => e.default).org;
      if (!want) return fail2("The default environment has no org alias.");
      let got;
      try {
        got = JSON.parse(readText(ctx.paths.root, ".sf/config.json") ?? "{}")["target-org"];
      } catch {
        got = void 0;
      }
      return got === want ? pass2(`Default org: ${got}`) : fail2(`The default org is ${got ? `"${got}"` : "not set"}, not "${want}".`, `sf config set target-org "${want}"`);
    }
  },
  {
    id: "B10.ignore-worktrees",
    part: "project",
    group: "B10",
    title: "Task worktrees are git-ignored",
    why: "Task worktrees live in .claude/worktrees/ inside the repo (D-022). Ignoring it keeps them out of your main checkout's changes and out of VSCode search.",
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const r = ctx.run("git", ["check-ignore", "-q", ".claude/worktrees/probe"], { cwd: ctx.paths.root });
      return r.code === 0 ? pass2(".claude/worktrees/ is ignored.") : fail2(".claude/worktrees/ isn't in .gitignore.", "printf '.claude/worktrees/\\n' >> .gitignore");
    }
  },
  {
    id: "B10.readme",
    part: "project",
    group: "B10",
    title: "README names every environment",
    why: "Anyone opening the repo sees which branch is which org, and how changes flow.",
    fix: { command: "acc setup readme", text: '"Do it" writes the environments table and promotion flow between markers in README.md, leaving the rest as it is. Run it again after changing the environments.' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      if (ctx.config.environments.length < 2) return skip2("Only one environment, so there's no map to document.");
      const text = readText(ctx.paths.root, "README.md");
      if (!text) return fail2("There's no README.md.");
      const missing = ctx.config.environments.filter((e) => !text.includes(`\`${e.branch}\``)).map((e) => e.branch);
      return missing.length ? fail2(`README.md doesn't mention ${missing.join(", ")}.`) : pass2("Every environment is in the README.");
    }
  },
  {
    id: "B12.trust",
    part: "project",
    group: "B12",
    title: "Claude Code trusts the repo for background agents",
    why: "Background agents start in the main checkout, and Claude Code only starts one in a folder you've trusted. VSCode's own Claude sessions don't record this, so it takes one run of claude in a terminal.",
    fix: { command: "claude", text: 'In the terminal that opens, accept the "trust this folder" prompt, then type /exit.' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      let main2 = ctx.paths.root;
      try {
        main2 = mainCheckout(ctx.run, ctx.paths.root);
      } catch {
      }
      return isTrusted(main2, ctx.env) ? pass2(`Trusted: ${main2}`) : fail2(`Claude Code hasn't been trusted in ${main2} yet.`, "claude   # then accept the trust prompt and type /exit");
    }
  },
  {
    id: "B13.gate-tools",
    part: "project",
    group: "B13",
    title: "The required checks can run",
    why: "acc done waits for every required check to pass, and a check whose tool is missing can only report an error.",
    fix: { fromCheck: true, docs: `${DOCS}#b13-make-sure-the-checks-can-run` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const config = ctx.config;
      const required = config.gates.required;
      if (!required.length) return skip2('No checks are required ("gates.required" is empty).');
      const defined = gatesFor(config).map((g) => g.name);
      const undefinedGates = required.filter((n) => !defined.includes(n));
      if (undefinedGates.length) return fail2(`Required, but with no command: ${undefinedGates.join(", ")}. Give each one under "gates.commands" in .acc/config.json.`);
      let main2 = ctx.paths.root;
      try {
        main2 = mainCheckout(ctx.run, ctx.paths.root);
      } catch {
      }
      const TOOLS = { format: "prettier", lint: "eslint", "lwc-tests": "sfdx-lwc-jest" };
      const absent = config.profile !== "salesforce" ? [] : required.filter((n) => TOOLS[n] && !config.gates.commands[n] && !existsSync17(join24(main2, "node_modules", ".bin", TOOLS[n]))).map((n) => TOOLS[n]);
      if (absent.length) return fail2(`Not installed in ${main2}: ${absent.join(", ")}.`, `cd "${main2}" && npm install`);
      return pass2(`Ready: ${required.join(", ")}.`);
    }
  },
  {
    id: "B14.tickets",
    part: "project",
    group: "B14",
    title: "The repo's ticket source",
    why: "The Tasks board shows this repo's own tickets: a Jira project, an Azure DevOps board, a monday.com board or GitHub Issues, signed in for this repo only (D-027). If this repo keeps its tasks in acc alone, mark this done.",
    fix: {
      vscode: "acc.trackers.add",
      confirm: true,
      text: `"Do it" opens the Connect page in the Command Center: pick Jira, GitHub Issues, Azure DevOps or monday.com, sign in and test the connection, then pick the project or board, which of its tickets are this repo's (an epic, labels, an area path or a group, or the whole of it) and the board's columns. Save writes them to this repo's .acc/config.json.`,
      docs: `${DOCS}#b14-connect-the-ticket-source`
    },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const list = ctx.config.trackers;
      if (!list.length) return unknown("No ticket source yet, so tasks come from acc alone. Add one, or mark this done if that's how this repo works.");
      const names2 = list.map((t) => t.kind === "github" ? `GitHub Issues${t.repo ? ` (${t.repo})` : ""}${t.labels.length ? ` labelled ${orList(t.labels)}` : ""}` : t.kind === "jira" ? `Jira ${t.project} on ${t.site}${t.epic ? `, epic ${t.epic}` : ""}` : t.kind === "monday" ? `monday.com board ${t.board} in ${t.account}${t.group ? `, group ${t.group}` : ""}` : `Azure DevOps ${t.project} in ${t.organization}${t.areaPath ? `, area ${t.areaPath}` : ""}`);
      return pass2(`Tickets come from ${names2.join(" and ")}.`);
    }
  },
  {
    id: "B11.drift",
    part: "project",
    group: "B11",
    title: "The day-to-day org matches its branch",
    profiles: ["salesforce"],
    why: "A change made straight in an org is lost the next time its branch is deployed there. A drift check finds it first.",
    fix: { fromCheck: true, docs: `${DOCS}#b11-drift-check-any-time` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const env = ctx.config.environments.find((e) => e.default);
      if (!env.org) return skip2(`${env.name} has no org.`);
      const cmd = `acc drift ${env.branch}`;
      let report = null;
      try {
        report = JSON.parse(readFileSync21(driftReportPath(ctx.paths, env.branch), "utf8"));
      } catch {
        report = null;
      }
      if (!report) return { status: "unknown", detail: `${env.org} hasn't been compared with ${env.branch} yet. It takes a few minutes and only reads the org.`, fix: cmd };
      const days = Math.floor((Date.now() - Date.parse(report.checkedAt)) / 864e5);
      const when = days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
      const found = report.changed.length + report.added.length + (report.missing?.length ?? 0);
      if (found) return fail2(`${env.org} had ${found} difference${found === 1 ? "" : "s"} from ${env.branch} when checked ${when}. Look with: ${cmd} --keep`, cmd);
      if (days > 14) return { status: "unknown", detail: `${env.org} matched ${env.branch} ${when}. Check again; orgs change.`, fix: cmd };
      return pass2(`${env.org} matched ${env.branch} ${when}${report.ignored ? `, apart from ${report.ignored} expected differences` : ""}.`);
    }
  }
];
function applies(step, ctx) {
  if (!step.profiles) return true;
  if (!ctx.config) return step.part === "machine";
  return step.profiles.includes(ctx.config.profile);
}
function runSteps(ctx, part, only) {
  return STEPS.filter((s) => (!part || s.part === part) && (!only?.length || only.includes(s.id)) && applies(s, ctx)).map((step) => {
    try {
      return { step, result: step.check(ctx) };
    } catch (e) {
      return { step, result: unknown(`The check failed to run: ${e.message}`) };
    }
  });
}

// packages/cli/src/format.ts
var useColor = () => !process.env.NO_COLOR && !!process.stdout.isTTY;
var TONES = { orange: "\x1B[38;5;208m", blue: "\x1B[38;5;33m", neutral: "", dim: "\x1B[2m" };
function tone(text, t) {
  if (!useColor() || !TONES[t]) return text;
  return `${TONES[t]}${text}\x1B[0m`;
}
function stateLabel(s) {
  const d = DISPLAY[s];
  return tone(`${d.glyph} ${d.label}`, d.tone);
}
var CHECK = {
  pass: { glyph: "\u2713", label: "pass", tone: "blue" },
  fail: { glyph: "\u2717", label: "fail", tone: "orange" },
  unknown: { glyph: "?", label: "check by hand", tone: "orange" },
  skip: { glyph: "\u2013", label: "skip", tone: "dim" }
};
var LABEL_WIDTH = Math.max(...Object.values(CHECK).map((c) => c.label.length)) + 2;
function checkLabel(s) {
  const c = CHECK[s];
  return tone(`${c.glyph} ${c.label}`.padEnd(LABEL_WIDTH), c.tone);
}
function table(rows) {
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = rows[0]?.map((_2, i) => Math.max(...rows.map((r) => strip(r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => i === r.length - 1 ? c : c + " ".repeat((widths[i] ?? 0) - strip(c).length)).join("  ")).join("\n");
}
var GATE = {
  pass: { glyph: "\u2713", label: "pass", tone: "blue" },
  fail: { glyph: "\u2717", label: "fail", tone: "orange" },
  error: { glyph: "!", label: "error", tone: "orange" },
  skip: { glyph: "\u2013", label: "skip", tone: "dim" }
};
var GATE_WIDTH = Math.max(...Object.values(GATE).map((c) => `${c.glyph} ${c.label}`.length)) + 2;
function gateLabel(s) {
  const c = GATE[s];
  return tone(`${c.glyph} ${c.label}`.padEnd(GATE_WIDTH), c.tone);
}

// package.json
var package_default = { version: "0.36.0" };

// packages/cli/src/main.ts
var VERSION = package_default.version;
var now = () => /* @__PURE__ */ new Date();
var HELP = `acc ${VERSION}: Agent Command Center

Setup
  acc doctor [--part machine|project] [--step <id>]...
                                        Check the onboarding steps and print the fixes
  acc onboard                           The same checks as a guided list, with the next step to do
  acc setup baseline                    B5: one manifest of every component on every environment branch
  acc setup branches [--push]           B6: make each missing environment branch, seeded from its org
  acc setup lists                       B9: draft the environment-specific and known-drift lists
  acc setup readme                      B10: write the README's environments table
  acc init --profile salesforce --production-org <alias> [--project <name>] [--github-repo <o/r>]
           [--github-account <a>] [--commit-name <n> --commit-email <e>] [--configure-git]
           [--jira-site <site> --jira-project <key>] [--dry-run] [--force]
  acc init --profile generic [...]

Tasks
  acc add "<title>" [--brief <text>] [--dep <id>]... [--env <branch>] [--key <T-n>]
  acc import [--file <tasks.json>]      Add or refresh tasks from JSON (stdin by default). A Jira, Azure DevOps or
                                        monday.com key that no tracker in .acc/config.json owns is refused
  acc intake github [--label <l>]       Add or refresh tasks from the open GitHub issues in the repo's place: its
                                        tracker's repo, and its labels if it names some. A task not started yet
                                        leaves the board when its issue closes, has a skipLabels label, or leaves
                                        the place
  acc intake jira|azure|monday --file <report.json>
                                        Follow tickets the Command Center found outside the repo's place, from
                                        { "outside": [{ "key", "why" }] }: a task not started yet leaves the board
  acc status                            One line: how many tasks are in each state
  acc list [--state <state>]
  acc ready
  acc show <id>
  acc set <id> <state> [--reason <text>] [--force] [--as <actor>] [--by <name>]

Agents
  acc dispatch <id> [--foreground] [--without-analysis] [--model <m>]
                                        Worktree, setup, instructions, and a background builder session.
                                        --model picks the builder's model for this task: a re-dispatch and a
                                        resume keep it. Without one, the builder's model (acc agents)
  acc done [<id>]                       A builder's finish line: moves its task to review
  acc block [<id>] "<reason>"           A builder's way out when stuck
  acc block [<id>] --client "<question>"
                                        Stuck on something only the client can answer: blocks, and drafts an
                                        update for the ticket that a person reviews before posting
  acc resume <id> [--message "<text>"]  Carry on a running task whose builder stopped before acc done or acc
                                        block, as when the Mac slept: its own session, in its worktree, with the
                                        rules it was dispatched with. It's told it was cut off, or --message
  acc cleanup <id>                      Remove a finished task's worktree, only if nothing would be lost
  acc agents                            The model and effort builders and reviewers run with, and where each is
                                        set. A model nobody set is acc's default, claude-opus-5-5
  acc agents set <builder|reviewer> [--model <m>] [--effort <low|medium|high|xhigh|max>] [--fallback-model <m>]
                [--clear <model|effort|fallback-model>]... [--project]
                                        Change them for this clone, or with --project in .acc/config.json
  acc agents autonomy [manual|review]   What autopilot may do on its own, or change it in .acc/config.json
  acc agents auto-merge [on|off]        Whether autopilot merges a reviewed pull request whose checks passed, into
                                        an environment that isn't protected, or change it in .acc/config.json
  acc machine heavy-slots [<n>]         How many heavy checks (builds, tests, validations) this machine runs at once,
                                        for every repo on it; with <n>, set it (1 to 8) in ~/.acc/machine.json
  acc analyze <id>                      Before the build: a read-only analyst works out the requirements, what's
                                        there now (the code, and on Salesforce the orgs), the approach, and questions
  acc analysis <id>                     What the task's analysis found
  acc analysis answer <id> <q> "<text>" Answer one of its questions; when the last is answered, it's ready to build
  acc review <id>                       A read-only reviewer agent judges the task's latest commit:
                                        pass, or changes (back to rework, with its findings)
  acc land <id>                         Push a reviewed task's branch and open its pull request; it never merges it
  acc autopilot [--once | --every <seconds>]
                                        With "autonomy": "review", take each task's next step on its own: review it,
                                        land it, re-dispatch a rework once, resume a stopped builder once, or merge
                                        the base into a pull request that conflicts with it. It merges a pull request
                                        only where auto-merge is on: reviewed, its checks passed, nothing waiting on
                                        a person, one a pass. One pass, or one every
                                        <seconds> (at least 30) until stopped; --json then prints a line a pass
  acc sync                              Follow open pull requests: merged \u2192 done, closed \u2192 blocked, failing checks or conflicts \u2192 needs you.
                                        Where the GitHub tracker says "edits": true, a task's issue closes when it
                                        merges to done, with a comment naming the pull request
  acc sync --close-done [--plan]        A person's one-off tidy: close the issues of tasks done before acc closed
                                        them, under the same rule, listing each. --plan lists them, changing nothing

Ticket updates (acc drafts them; only a person posts)
  acc updates [--all] [--task <id>]     The drafts waiting for a person; --all adds the posted and discarded
  acc update post <id> [--text-file <f>] [--again]
                                        Post a draft on its GitHub issue as the repo's account, with the text
                                        in <f> if you edited it. Jira and Azure DevOps post from the Command Center
  acc update discard <id>               Set a draft aside: it's kept, and never posted
  acc update ask <id> <q>               Draft one of the task's analysis's questions for the client

Environments
  acc promote <env> [--to <env>] [--plan] [--allow-deletions] [--skip-validate]
                                        A pull request taking <env>'s merged changes to the next environment
  acc deploy <env> [--plan] [--since <commit>] [--confirm-production] [--no-tests]
                                        Deploy what changed on <env>'s branch since its last deploy to its org
  acc hook permission                   Claude Code's PermissionRequest hook: puts an agent's prompt in the
                                        Command Center, when one is open, and waits for the answer

GitHub
  acc github status                     Which account this repo works as, and whether gh and git push agree
  acc github use <account> | --default  Work as another logged-in account in this clone only; nothing committed changes

Checks
  acc gate run [<gate>...] [--test <ApexTest>=<why>]... [--env <name>] [--task <id>]
                                        Run the required checks (or the ones named) on this commit
  acc gate list [--env <name>] [--task <id>]
                                        The project's checks, and their results on this commit
  acc gate waive <gate>... --reason "<why>" [--task <id>]
                                        A person sets checks aside on this commit (or the task's), with a reason
  acc drift <environment> [--manifest <path>] [--keep]
                                        What changed in an org since its branch; prints nothing if none

Every command takes --json. Docs: docs/ONBOARDING.md, docs/DESIGN.md.`;
function out(o, human, data) {
  if (o.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(human() + "\n");
}
function project(cwd) {
  const paths = repoPaths(cwd, run);
  const { config: loaded, warnings } = loadConfig(paths.config);
  for (const w of warnings) process.stderr.write(`warning: ${w}
`);
  return { paths, config: withCloneAgents(withCloneAccount(loaded, paths.root, run), paths.root, run) };
}
function actorFrom(o) {
  const role = o.as || process.env.ACC_ROLE || "human";
  if (!ACTORS.includes(role)) throw new AccError("usage", `--as must be one of ${ACTORS.join(", ")}.`);
  const by = o.by ?? (role === "builder" && process.env.ACC_TASK ? `builder:${process.env.ACC_TASK}` : `${role}:${process.env.USER ?? "unknown"}`);
  return { actor: role, by };
}
function renderSteps(results, guided) {
  const lines = [];
  let part = "";
  for (const { step, result } of results) {
    if (step.part !== part) {
      part = step.part;
      lines.push("", part === "machine" ? "This machine" : "This project");
    }
    lines.push(`  ${checkLabel(result.status)}  ${step.id.padEnd(18)} ${step.title}`);
    if (result.status !== "pass" && result.status !== "skip") lines.push(`      ${result.detail}`);
    else if (!guided) lines.push(tone(`      ${result.detail}`, "dim"));
    if (result.status === "fail" || result.status === "unknown") {
      const fix = result.fix ?? step.fix?.command ?? step.fix?.text;
      if (fix) lines.push(`      fix: ${fix}`);
      if (result.open) lines.push(`      open: ${result.open}`);
      if (step.fix?.docs) lines.push(`      docs: ${step.fix.docs}`);
    }
  }
  const failing = results.filter((r) => r.result.status === "fail");
  const byHand = results.filter((r) => r.result.status === "unknown");
  const passed = results.filter((r) => r.result.status === "pass").length;
  lines.push("", `${passed} passed, ${failing.length} failing, ${byHand.length} to check by hand.`);
  if (guided && failing[0]) {
    const { step, result } = failing[0];
    lines.push("", tone(`Next: ${step.id}, ${step.title}`, "orange"), `  Why: ${step.why}`, `  Do:  ${result.fix ?? step.fix?.command ?? step.fix?.text ?? `see ${step.fix?.docs ?? "docs/ONBOARDING.md"}`}`);
  }
  return lines.join("\n").replace(/^\n/, "");
}
function cmdDoctor(o, guided) {
  const ctx = makeContext(process.cwd(), run, process.env, VERSION);
  const part = o.part;
  if (part && part !== "machine" && part !== "project") throw new AccError("usage", "--part must be machine or project.");
  const only = o.step ?? [];
  const unknownIds = only.filter((id) => !STEPS.some((s) => s.id === id));
  if (unknownIds.length) throw new AccError("usage", `No step ${unknownIds.join(", ")}. Run acc doctor to see them all.`);
  const results = runSteps(ctx, part, only);
  out(o, () => renderSteps(results, guided), results.map(({ step, result }) => ({
    id: step.id,
    part: step.part,
    group: step.group,
    title: step.title,
    why: step.why,
    status: result.status,
    detail: result.detail,
    fix: result.fix ?? null,
    howTo: step.fix ?? null,
    open: result.open ?? null
  })));
  return results.some((r) => r.result.status === "fail") ? 1 : 0;
}
function cmdInit(o) {
  const paths = repoPaths(process.cwd(), run);
  const profile = o.profile ?? "generic";
  if (profile !== "generic" && profile !== "salesforce") throw new AccError("usage", "--profile must be generic or salesforce.");
  if (existsSync18(paths.config) && !o.force && !o["dry-run"]) throw new AccError("exists", `${paths.config} already exists. Use --force to replace it.`);
  const plan = planInit(run, {
    root: paths.root,
    profile,
    project: o.project,
    productionOrg: o["production-org"],
    githubRepo: o["github-repo"],
    githubAccount: o["github-account"],
    commitName: o["commit-name"],
    commitEmail: o["commit-email"],
    jiraSite: o["jira-site"],
    jiraProject: o["jira-project"]
  });
  if (!o["dry-run"]) {
    writeConfig(paths.config, plan.config);
    if (o["configure-git"] && plan.config.github) configureRepoAccess(run, paths.root, plan.config.github.account, plan.config.commitIdentity);
  }
  out(o, () => {
    const c = plan.config;
    const rows = [["Environment", "Branch", "Type", "Org alias", "Promotes to"], ...c.environments.map((e) => [
      e.name + (e.default ? " (default)" : "") + (e.protected ? " (protected)" : ""),
      e.branch,
      e.type,
      e.org ?? "(not logged in)",
      e.promotesTo.join(", ") || "\u2013"
    ])];
    return [
      `${o["dry-run"] ? "Would write" : "Wrote"} ${paths.config}`,
      "",
      table(rows),
      "",
      `GitHub: ${c.github ? `${c.github.repo} as ${c.github.account}` : "(none)"}   Commits: ${c.commitIdentity ? `${c.commitIdentity.name} <${c.commitIdentity.email}>` : "(not set)"}`,
      ...plan.notes.map((n) => `note: ${n}`),
      "",
      "Next: acc doctor"
    ].join("\n");
  }, { written: !o["dry-run"], path: paths.config, config: plan.config, notes: plan.notes });
  return 0;
}
function readInput(file) {
  const text = file ? readFileSync22(file, "utf8") : readFileSync22(0, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AccError("usage", `The input isn't valid JSON: ${e.message}`);
  }
}
var upsertLines = (res) => [
  res.added.length ? `Added ${res.added.join(", ")}` : "",
  res.updated.length ? `Updated ${res.updated.join(", ")}` : "",
  res.unchanged.length ? `Unchanged ${res.unchanged.join(", ")}` : "",
  ...res.errors.map((e) => tone(`\u2717 ${e}`, "orange"))
];
function upsert(o, inputs, own = false) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const held = own ? ownTickets(config, inputs) : { inputs, refused: [] };
  const res = mutate(paths, now, (ledger, emit) => upsertTasks(ledger, config, held.inputs, actor, by, emit, now));
  res.errors.push(...held.refused);
  out(o, () => upsertLines(res).filter(Boolean).join("\n") || "Nothing to do.", res);
  return res.errors.length ? 1 : 0;
}
function ownTickets(config, inputs) {
  if (!config.trackers.length) return { inputs, refused: [] };
  const refused = [];
  const kept = inputs.filter((i) => {
    const kind = i?.source?.kind;
    const key = i?.source?.key;
    if (!isSignedInKind(kind) || typeof key !== "string") return true;
    const at2 = trackerForKey(config.trackers, key);
    if (at2 !== null && config.trackers[at2].kind === kind) return true;
    refused.push(`${key.toUpperCase()}: no ${trackerName(kind)} tracker in .acc/config.json owns it, so it isn't one of this repo's tickets.`);
    return false;
  });
  return { inputs: kept, refused };
}
var intakeLines = (res) => {
  const skipped = res.removed.filter((id) => !res.left.includes(id));
  return [
    res.closed.length ? `Done ${res.closed.join(", ")}: closed on GitHub before work started` : "",
    skipped.length ? `Removed ${skipped.join(", ")}: their issues have a label in skipLabels` : "",
    res.left.length ? `Removed ${res.left.join(", ")}: their tickets left this repo's place before work started` : "",
    ...res.leftAlone.map((l3) => tone(`! ${l3.note}`, "orange"))
  ];
};
function cmdIntakeGithub(o) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const res = intakeGithub(paths, config, { run, now, env: process.env }, { label: o.label, actor, by });
  out(o, () => [...upsertLines(res), ...intakeLines(res)].filter(Boolean).join("\n") || "Nothing to do.", res);
  return res.errors.length ? 1 : 0;
}
var SIGNED_IN_KINDS = TRACKER_KINDS.filter((k2) => k2 !== "github");
var isSignedInKind = (k2) => SIGNED_IN_KINDS.includes(k2);
function cmdIntakeOutside(o, kind) {
  const file = o.file;
  if (!file) throw new AccError("usage", `acc intake ${kind} --file <report.json>, with { "outside": [{ "key": "ACME-7", "why": "it isn't in epic ACME-3" }] }. The Command Center writes it after a board loads.`);
  const data = readInput(file);
  const list = data?.outside;
  if (!Array.isArray(list) || !list.every((x2) => typeof x2?.key === "string" && typeof x2?.why === "string")) {
    throw new AccError("usage", `${file} must hold { "outside": [{ "key": "<ticket key>", "why": "<why it's outside>" }] }.`);
  }
  const { paths } = project(process.cwd());
  const res = intakeOutside(paths, kind, list, now);
  out(o, () => intakeLines(res).filter(Boolean).join("\n") || "Nothing to do.", res);
  return 0;
}
function taskIdFrom(arg) {
  const id = arg ?? process.env.ACC_TASK;
  if (!id) throw new AccError("usage", "Name the task, for example: acc done GH-12. Builders get it from ACC_TASK.");
  return id;
}
var accBinDir = () => {
  try {
    return dirname8(realpathSync4(process.argv[1]));
  } catch {
    return dirname8(process.argv[1] ?? ".");
  }
};
var shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
var accCommand = () => {
  let script = process.argv[1] ?? "";
  try {
    script = realpathSync4(script);
  } catch {
  }
  return `${process.versions.electron ? "ELECTRON_RUN_AS_NODE=1 " : ""}${shellQuote(process.execPath)} ${shellQuote(script)}`;
};
async function readStdin(limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += c.length;
    if (size > limit) break;
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function cmdHookEvent(event) {
  try {
    const input = parseEventInput(await readStdin());
    if (!input) return 0;
    const ctx = { cwd: input.cwd || process.cwd(), env: process.env, run, now };
    const out2 = event === "session-start" ? sessionStartHook(input, ctx) : event === "pre-tool-use" ? preToolUseHook(input, ctx) : stopHook(input, ctx);
    if (out2) process.stdout.write(JSON.stringify(out2));
  } catch (e) {
    process.stderr.write(`acc hook ${event}: ${e.message}
`);
  }
  return 0;
}
async function cmdHookPermission() {
  const stop2 = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.once(sig, () => stop2.abort());
  try {
    const input = parseHookInput(await readStdin());
    if (!input) return 0;
    const r = await ask(input, { signal: stop2.signal });
    const output = r ? hookOutput(r.question, r.answer) : null;
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.stderr.write(`acc hook permission: ${e.message}
`);
  }
  return 0;
}
function cmdReview(o, id) {
  const { paths, config } = project(process.cwd());
  const { by } = actorFrom(o);
  const say = (line) => {
    if (!o.json) process.stderr.write(line + "\n");
  };
  const r = review(paths, config, id.toUpperCase(), {
    run,
    now,
    env: process.env,
    onStart: (session, sha, name) => say(tone(`Reviewing ${id.toUpperCase()} at ${sha.slice(0, 7)}. The reviewer reads and changes nothing. Session ${session}, named ${name}.`, "dim"))
  }, { by: `reviewer:${id.toUpperCase()} for ${by}` });
  const v = r.verdict;
  const where = (f) => f.file ? `${f.file}${f.line ? `:${f.line}` : ""}  ` : "";
  out(o, () => [
    v.verdict === "pass" ? tone(`\u2713 Review passed: ${v.summary}`, "blue") : tone(`\u21BA Changes asked for: ${v.summary}`, "orange"),
    ...v.criteria.length ? ["", "Acceptance criteria", ...v.criteria.map((c) => `  ${c.met ? "\u2713" : "\u2717"} ${c.text}${c.evidence ? tone(`  ${c.evidence}`, "dim") : ""}`)] : [],
    ...v.findings.length ? ["", "Findings", ...v.findings.map((f) => `  ${f.must ? "!" : "\xB7"} ${where(f)}${f.message}`)] : [],
    "",
    r.moved === "rework" ? `${id.toUpperCase()} \u2192 ${stateLabel("rework")}. Re-dispatch it, and the builder gets these findings.` : `${id.toUpperCase()} stays in review, ready to land.`
  ].join("\n"), r);
  return v.verdict === "pass" ? 0 : 1;
}
function analysisLines(a) {
  const head = a.verdict === "ready" ? tone(`\u2713 Ready to build: ${a.summary}`, "blue") : a.verdict === "split" ? tone(`! Too big for one task: ${a.summary}`, "orange") : tone(`? ${openQuestions(a).length} question${openQuestions(a).length === 1 ? "" : "s"} for you: ${a.summary}`, "orange");
  const list = (title, xs) => xs.length ? ["", title, ...xs.map((x2) => `  - ${x2}`)] : [];
  return [
    head,
    ...a.questions.length ? ["", "Questions", ...a.questions.map((q2) => `  ${q2.id}. ${q2.question}${q2.answer ? tone(`  \u2192 ${q2.answer.text}`, "blue") : tone(`  (suggested: ${q2.suggested})`, "dim")}`)] : [],
    ...list("Acceptance criteria", a.requirements.criteria),
    ...list("What is there now", a.findings.map((f) => `${f.area}: ${f.detail}${f.source ? tone(`  ${f.source}`, "dim") : ""}`)),
    ...list("Approach", a.approach.plan),
    ...list("Refactors first", a.approach.refactors.map((r) => `${r.what}: ${r.why}`)),
    ...list("Risks", a.approach.risks),
    ...list("Tests", a.approach.tests),
    ...a.split.length ? list("Split into", a.split) : [],
    "",
    tone(`Size ${a.approach.size}. ${a.orgs.length ? `Read ${a.orgs.join(", ")}. ` : ""}Session ${a.sessionId}.`, "dim")
  ];
}
function cmdAnalyze(o, id) {
  const by = personOnly(o, "analyze a task");
  const { paths, config } = project(process.cwd());
  const say = (line) => {
    if (!o.json) process.stderr.write(line + "\n");
  };
  const a = analyze(paths, config, id.toUpperCase(), {
    run,
    now,
    env: process.env,
    accCommand: accCommand(),
    onStart: (session, name) => say(tone(`Analyzing ${id.toUpperCase()}. The analyst reads the ticket${config.profile === "salesforce" ? ", the code and the orgs" : " and the code"}, and changes nothing. Session ${session}, named ${name}.`, "dim"))
  }, { by: `analyst:${id.toUpperCase()} for ${by}` });
  out(o, () => analysisLines(a).join("\n"), a);
  return a.verdict === "ready" ? 0 : 1;
}
function cmdShowAnalysis(o, id) {
  const { paths } = project(process.cwd());
  const a = readAnalysis(paths, id.toUpperCase());
  if (!a) throw new AccError("no-analysis", `${id.toUpperCase()} hasn't been analyzed yet: acc analyze ${id.toUpperCase()}.`);
  out(o, () => analysisLines(a).join("\n"), a);
  return 0;
}
function cmdAnswerAnalysis(o, id, q2, text) {
  const by = personOnly(o, "answer an analysis's questions");
  const { paths } = project(process.cwd());
  const a = answerAnalysis(paths, id.toUpperCase(), q2, text, by, now);
  const open = openQuestions(a);
  out(o, () => open.length ? `Answered. ${open.length} to go: ${open.map((x2) => x2.id).join(", ")}.` : tone(`Answered. ${a.task} is ready to build: acc dispatch ${a.task}.`, "blue"), a);
  return 0;
}
function cmdLand(o, id) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  if (actor === "builder") throw new AccError("refused", "A builder never lands its own work. A person does, once it's reviewed.");
  const r = land(paths, config, id.toUpperCase(), { run, now, env: process.env }, { actor, by });
  out(o, () => [
    `${r.task.id}: ${r.opened ? "opened" : "updated"} pull request #${r.pr.number}  ${r.pr.url}`,
    r.update ? `  Drafted an update for ${r.update.key} (${r.update.id}). Nothing is posted until a person posts it: acc updates.` : "",
    r.updateError ? tone(`! No update was drafted for ${r.task.id}'s ticket: ${r.updateError}`, "orange") : "",
    r.pr.conflicts?.length ? tone(`! Pull request #${r.pr.number} conflicts with ${r.task.environment} in ${r.pr.conflicts.join(", ")}. GitHub can't merge it until that's resolved.`, "orange") : "",
    tone(autoMergeFor(config, r.task.environment) ? mergesWords(true) : "It merges only when a person merges it on GitHub.", "dim")
  ].filter(Boolean).join("\n"), r);
  return 0;
}
var STEP_WORD = { review: "review", land: "land", dispatch: "re-dispatch", refresh: "update", resume: "resume", checks: "send back", merge: "merge" };
var stepWords = (step, sha) => {
  if (step === "checks") return `send ${sha.slice(0, 7) || "it"} back for its failing checks`;
  const what = [STEP_WORD[step], sha.slice(0, 7)].filter(Boolean).join(" ");
  return step === "refresh" ? `${what} from its base` : what;
};
function autopilotLines(r) {
  const lines = [];
  for (const s of r.steps) {
    if (s.outcome === "done") lines.push(`${tone(`\u2713 ${s.task}  ${s.reason}`, "blue")}${s.pr ? `  ${s.pr.url}` : ""}`);
    else if (s.outcome === "failed") lines.push(tone(`! ${s.task}  Couldn't ${stepWords(s.step, s.sha ?? "")}: ${s.reason}`, "orange"), tone("    It isn't tried again on this commit. Do it by hand, or a new commit lets autopilot try again.", "dim"));
    else if (s.outcome === "waiting") lines.push(tone(`\u2026 ${s.task}  Waiting: ${s.reason}`, "dim"));
  }
  for (const u of r.updates) lines.push(`  Drafted an update for ${u.key} (${u.id}): acc updates`);
  const idle = r.steps.filter((s) => s.outcome === "skipped").length;
  if (!lines.length) lines.push("Nothing for autopilot to do.");
  else if (idle) lines.push(tone(`${idle} other task${idle === 1 ? "" : "s"}: nothing to do.`, "dim"));
  return lines;
}
function cmdAutopilot(o) {
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `A ${role} can't run autopilot. A person starts it.`);
  if (o.once && o.every !== void 0) throw new AccError("usage", "--once is one pass and --every repeats them: give one or the other.");
  const every = o.every === void 0 ? 0 : Number(o.every);
  if (o.every !== void 0 && (!Number.isInteger(every) || every < AUTOPILOT_MIN_EVERY_S)) {
    throw new AccError("usage", `--every takes whole seconds, at least ${AUTOPILOT_MIN_EVERY_S}: the gap between one pass ending and the next starting.`);
  }
  const start = project(process.cwd());
  const { paths } = start;
  const mode = autopilotMode(start.config);
  for (const w of mode.warnings) process.stderr.write(`warning: ${w}
`);
  if (mode.refusal) throw new AccError("refused", mode.refusal);
  if (!mode.on) {
    out(
      o,
      () => `autonomy is "manual" in .acc/config.json, so autopilot does nothing. Set it to "review" for autopilot to act: it then ${autopilotDoes(autoMergeOn(start.config))}`,
      { autonomy: mode.autonomy, warnings: mode.warnings, steps: [], updates: [] }
    );
    return 0;
  }
  if (!start.config.github) throw new AccError("no-github", 'Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section in .acc/config.json.');
  const say = (line) => {
    if (!o.json) process.stderr.write(tone(line, "dim") + "\n");
  };
  const doing = { review: "Reviewing", land: "Landing", dispatch: "Re-dispatching", refresh: "Updating", resume: "Resuming", checks: "Sending back", merge: "Merging" };
  const after = { review: ". The reviewer reads and changes nothing.", land: "", dispatch: "", refresh: " from its base, then running its checks.", resume: ": its builder stopped before acc done or acc block.", checks: " to its builder: its checks failed on GitHub. Reading their logs.", merge: ": its review and checks passed. GitHub is asked again first." };
  const parent = Number(process.env.ACC_AUTOPILOT_PARENT);
  const orphaned = () => Number.isInteger(parent) && parent > 0 && !alive(parent);
  const closed = "The Command Center that started autopilot closed, so it stops.";
  const wait = (seconds) => {
    for (let left = seconds * 1e3; left > 0 && !orphaned(); left -= 1e3) sleep(Math.min(1e3, left));
    return !orphaned();
  };
  return holdAutopilot(paths, () => {
    let config = start.config;
    for (; ; ) {
      if (orphaned()) {
        say(closed);
        return 0;
      }
      const r = autopilotPass(paths, config, {
        run,
        now,
        env: process.env,
        accBinDir: accBinDir(),
        accCommand: accCommand(),
        stop: orphaned,
        onStep: (task, step, sha) => say(`\u2026 ${doing[step]} ${task}${sha ? ` at ${sha.slice(0, 7)}` : ""}${after[step]}`)
      });
      const data = { autonomy: mode.autonomy, warnings: mode.warnings, steps: r.steps, updates: r.updates };
      if (!every) {
        out(o, () => autopilotLines(r).join("\n"), data);
        return r.steps.some((s) => s.outcome === "failed") ? 1 : 0;
      }
      if (o.json) process.stdout.write(JSON.stringify({ at: now().toISOString(), ...data }) + "\n");
      else process.stdout.write([tone(`Autopilot pass at ${now().toLocaleTimeString()}`, "dim"), ...autopilotLines(r)].join("\n") + "\n");
      if (!wait(every)) {
        say(closed);
        return 0;
      }
      config = project(process.cwd()).config;
      if (!autopilotMode(config).on) {
        say(`autonomy is "${config.autonomy}" now, so autopilot stops.`);
        return 0;
      }
    }
  });
}
function cmdSync(o) {
  const closeDone = o["close-done"] === true;
  const plan = o.plan === true;
  if (plan && !closeDone) throw new AccError("usage", "--plan goes with --close-done: acc sync --close-done --plan");
  const by = closeDone ? personOnlyUpdate(o, "close the issues of tasks already done") : null;
  const { paths, config } = project(process.cwd());
  const r = closeDone && plan ? { checked: 0, changes: [] } : sync(paths, config, { run, now, env: process.env });
  const lines = [
    ...r.checked ? [`Checked ${r.checked} open pull request${r.checked === 1 ? "" : "s"}.`] : [],
    ...r.changes.map((c) => `  ${c.task}: ${c.note}${c.moved ? ` \u2192 ${stateLabel(c.moved.to)}` : ""}${c.update ? `. Drafted an update for ${c.update.key} (${c.update.id})` : ""}`)
  ];
  if (!by) {
    out(o, () => lines.length ? lines.join("\n") : "No open pull requests to follow.", r);
    return 0;
  }
  if (!closesIssues(config)) {
    out(o, () => [...lines, 'No GitHub tracker here says "edits": true, so acc closes no issues.'].join("\n"), { ...r, closeDone: [] });
    return 0;
  }
  const env = { ...process.env, GH_TOKEN: ghToken(run, config.github.account) };
  const closes = settleCloses(paths, config, { run, now, env }, { tidy: true, plan, actor: "human", by });
  out(o, () => [
    ...lines,
    !closes.length ? "No done task's issue is waiting to close." : plan ? "The done tasks whose issues the tidy would close (nothing is changed). A sync may also close those of tasks merged since it last ran:" : "The issues of tasks already done:",
    ...closes.map((c) => `  ${c.task} (pull request #${c.pr}): ${closeWords(c, plan)}`),
    plan && closes.some((c) => c.outcome === "to close") ? tone("Close them with acc sync --close-done.", "dim") : ""
  ].filter(Boolean).join("\n"), { ...r, closeDone: closes, ...plan ? { plan: true } : {} });
  return 0;
}
function cmdMachine(o, sub, value) {
  if (sub !== "heavy-slots") throw new AccError("usage", "acc machine heavy-slots [<n>]");
  if (value === void 0) {
    const n2 = heavySlots();
    out(o, () => `${n2} heavy check${n2 === 1 ? "" : "s"} at once on this machine${process.env.ACC_HEAVY_SLOTS ? " (from ACC_HEAVY_SLOTS)" : ""}.`, { heavySlots: n2 });
    return 0;
  }
  personOnly(o, "change how many heavy checks this machine runs");
  const n = setHeavySlots(Number(value));
  out(o, () => `This machine now runs ${n} heavy check${n === 1 ? "" : "s"} at once, for every repo on it. Set in ${machineFile()}.`, { heavySlots: n });
  return 0;
}
function cmdAgents(o, sub, roleArg) {
  const { paths } = project(process.cwd());
  const { config: projectConfig } = loadConfig(paths.config);
  const views = () => Object.fromEntries(AGENT_ROLES.map((r) => [r, profileView(projectConfig, run, paths.root, r)]));
  if (sub === "autonomy") return cmdAutonomy(o, paths.config, roleArg);
  if (sub === "auto-merge") return cmdAutoMerge(o, paths.config, roleArg);
  if (!sub || sub === "show") {
    const v = views();
    const from = { clone: " (this clone)", project: " (project)", acc: " (acc's default)", default: "" };
    out(o, () => AGENT_ROLES.map((r) => {
      const p = v[r];
      return `${r.padEnd(9)} model ${p.model}${from[p.from.model]}, effort ${p.effort ?? "default"}${from[p.from.effort]}${p.fallbackModel ? `, falls back to ${p.fallbackModel}${from[p.from.fallbackModel]}` : ""}`;
    }).join("\n"), v);
    return 0;
  }
  if (sub !== "set" || !roleArg || !AGENT_ROLES.includes(roleArg)) throw new AccError("usage", "acc agents set <builder|reviewer> [--model <m>] [--effort <e>] [--fallback-model <m>] [--clear <field>] [--project] | acc agents autonomy [manual|review] | acc agents auto-merge [on|off]");
  personOnly(o, "change what agents run with");
  const change2 = {};
  if (o.model !== void 0) change2.model = o.model;
  if (o.effort !== void 0) change2.effort = o.effort;
  if (o["fallback-model"] !== void 0) change2.fallbackModel = o["fallback-model"];
  for (const f of o.clear ?? []) {
    const key = f === "model" ? "model" : f === "effort" ? "effort" : f === "fallback-model" ? "fallbackModel" : null;
    if (!key) throw new AccError("usage", "--clear takes model, effort or fallback-model.");
    change2[key] = null;
  }
  if (!Object.keys(change2).length) throw new AccError("usage", "Say what to change: --model, --effort, --fallback-model or --clear.");
  setProfile(run, paths.root, paths.config, roleArg, change2, o.project ? "project" : "clone");
  const after = profileView(loadConfig(paths.config).config, run, paths.root, roleArg);
  out(o, () => `${roleArg}: model ${after.model}${after.from.model === "acc" ? " (acc's default)" : ""}, effort ${after.effort ?? "default"}${after.fallbackModel ? `, falls back to ${after.fallbackModel}` : ""}. ${o.project ? "Set in .acc/config.json: commit it to share it." : "Set for this clone only."} The next ${roleArg} uses it.`, after);
  return 0;
}
var autonomyWords = (config) => ({
  manual: "nothing happens on its own.",
  review: `autopilot ${autopilotDoes(autoMergeOn(config))}`,
  dispatch: "as review, and it also starts Ready tasks. Not built yet: autopilot refuses.",
  full: "read as dispatch. Not built yet: autopilot refuses."
})[config.autonomy] ?? "";
function cmdAutonomy(o, configFile, value) {
  if (value === void 0) {
    const { config: config2 } = loadConfig(configFile);
    out(o, () => `autonomy ${config2.autonomy} (project): ${autonomyWords(config2)}`.trim(), { autonomy: config2.autonomy });
    return 0;
  }
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `${role === "analyst" ? "An" : "A"} ${role} can't change what autopilot may do. A person does that.`);
  personOnly(o, "change what autopilot may do");
  setAutonomy(configFile, value);
  const { config } = loadConfig(configFile);
  out(o, () => `autonomy ${config.autonomy}: ${autonomyWords(config)} Set in .acc/config.json: commit it to share it.`, { autonomy: config.autonomy });
  return 0;
}
function autoMergeLines(config) {
  if (!autoMergeOn(config)) {
    return config.profile === "salesforce" ? "auto-merge off (project): a Salesforce project never auto-merges. A person merges every pull request." : "auto-merge off (project): autopilot never merges a pull request. A person merges each one.";
  }
  const covered2 = config.environments.filter((e) => !e.protected).map((e) => e.branch);
  const kept = config.environments.filter((e) => e.protected).map((e) => e.branch);
  return [
    `auto-merge on (project): autopilot merges a pull request into ${covered2.join(", ") || "no environment"} once its review and checks passed, it's up to date with its base, GitHub says it can merge, nothing waits on a person, and it changes nothing under .acc/. One a pass.`,
    kept.length ? `Never into ${kept.join(", ")}: protected, so a person merges.` : "",
    config.autonomy === "review" ? "It merges while autopilot is on." : `autonomy is "${config.autonomy}", so autopilot doesn't run and nothing merges on its own.`
  ].filter(Boolean).join(" ");
}
function cmdAutoMerge(o, configFile, value) {
  const data = (config2) => ({ autoMerge: autoMergeOn(config2), environments: config2.environments.filter((e) => autoMergeOn(config2) && !e.protected).map((e) => e.branch), autonomy: config2.autonomy });
  if (value === void 0) {
    const { config: config2 } = loadConfig(configFile);
    out(o, () => autoMergeLines(config2), data(config2));
    return 0;
  }
  if (value !== "on" && value !== "off") throw new AccError("usage", "acc agents auto-merge [on|off]");
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `${role === "analyst" ? "An" : "A"} ${role} can't change whether autopilot merges. A person does that.`);
  personOnly(o, "change whether autopilot merges");
  setAutoMerge(configFile, value === "on");
  const { config } = loadConfig(configFile);
  out(o, () => `${autoMergeLines(config)} Set in .acc/config.json: commit it to share it.`, data(config));
  return 0;
}
function cmdSetup(o, what) {
  const { paths, config } = project(process.cwd());
  const say = (line) => {
    if (!o.json) process.stderr.write(tone(line, "dim") + "\n");
  };
  const deps = { run, now, onStep: say };
  if (what === "baseline") {
    const r = buildBaseline(paths, config, deps);
    out(o, () => `Wrote ${r.file}: ${r.members} components of ${r.types} types, from ${r.from.join(", ")}.
Commit it on every environment's branch, so each is retrieved with the same list.`, r);
    return 0;
  }
  if (what === "branches") {
    personOnly(o, "make environment branches");
    const r = seedBranches(paths, config, deps, { push: o.push === true });
    out(o, () => r.length ? r.map((b) => `  ${b.status === "made" ? "\u2713" : "\u2717"} ${b.branch.padEnd(16)} ${b.note}${b.differs !== null ? `; ${b.differs} files differ from production` : ""}`).join("\n") : "Every environment already has its branch.", r);
    return r.some((b) => b.status === "failed") ? 1 : 0;
  }
  if (what === "lists") {
    const r = draftLists(paths, config, deps);
    const show = (label, d) => `${d.written ? "Wrote" : "Kept"} ${d.file}${d.written ? ` with ${d.entries.length} ${label}` : d.entries.length ? `; consider adding ${d.entries.length}: ${d.entries.slice(0, 5).join(", ")}${d.entries.length > 5 ? ", \u2026" : ""}` : ""}.`;
    out(o, () => [
      show("environment-specific paths", r.environmentSpecific),
      show("known-drift paths", r.knownDrift),
      ...r.unexplained.map((u) => `  ${u.branch}: ${u.files.length} other difference${u.files.length === 1 ? "" : "s"} from production that neither list explains: real drift, or work in progress. ${u.files.slice(0, 5).join(", ")}${u.files.length > 5 ? ", \u2026" : ""}`),
      "Read both lists before committing them: each line keeps a file out of promotions (environment-specific) or out of drift checks (known drift)."
    ].join("\n"), r);
    return 0;
  }
  if (what === "readme") {
    const r = writeReadme(paths, config);
    out(o, () => `${r.created ? "Wrote" : r.replaced ? "Updated the environments section of" : "Added an environments section to"} ${r.file}. Keep it the same on every non-production branch.`, r);
    return 0;
  }
  throw new AccError("usage", "acc setup baseline | branches [--push] | lists | readme");
}
function personOnly(o, what) {
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer") throw new AccError("refused", `A ${role} can't ${what}. A person does that.`);
  const { actor, by } = actorFrom(o);
  if (actor !== "human") throw new AccError("refused", `Only a person can ${what}.`);
  return by;
}
function cmdPromote(o, from) {
  const by = personOnly(o, "promote");
  const { paths, config } = project(process.cwd());
  const say = (line) => {
    if (!o.json) process.stderr.write(tone(line, "dim") + "\n");
  };
  const show = (p) => [
    `${p.from.name} (${p.from.branch} at ${p.fromSha.slice(0, 7)}) \u2192 ${p.to.name} (${p.to.branch} at ${p.toSha.slice(0, 7)})`,
    ...skipWarning(p).map((l3) => tone(`  ! ${l3}`, "orange")),
    `  ${p.files.length} to bring over${p.deleted.length ? tone(`, ${p.deleted.length} to delete`, "orange") : ""}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ""}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`),
    ...p.files.length > 20 ? [`    \u2026and ${p.files.length - 20} more`] : [],
    ...p.deleted.map((f) => tone(`    deletes ${f}`, "orange"))
  ];
  if (o.plan) {
    const p = planPromotion(paths, config, from, o.to, { run });
    out(o, () => show(p).join("\n"), p);
    return 0;
  }
  const r = promote(paths, config, from, o.to, { run, now, env: process.env, onStep: say }, { allowDeletions: o["allow-deletions"] === true, validate: o["skip-validate"] !== true, by });
  out(o, () => [
    ...show(r.plan),
    "",
    r.pr ? `Opened pull request #${r.pr.number}  ${r.pr.url}` : r.stopped ?? "",
    r.pr ? tone("It merges only when a person merges it. Deploy after that with acc deploy.", "dim") : "",
    r.warning ? tone(`! ${r.warning}`, "orange") : "",
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone("Nothing is posted until a person posts it: acc updates.", "dim") : ""
  ].filter(Boolean).join("\n"), r);
  return r.pr || !r.stopped?.startsWith("Validation") ? 0 : 1;
}
function cmdDeploy(o, envName) {
  const by = personOnly(o, "deploy");
  const { paths, config } = project(process.cwd());
  const show = (p) => [
    `${p.env.name} (${p.org}): ${p.env.branch} from ${p.base.slice(0, 7)} to ${p.head.slice(0, 7)}${p.confirm ? tone("  protected: needs --confirm-production", "orange") : ""}`,
    `  ${p.files.length} to deploy, tests: ${p.testLevel}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ""}${p.deleted.length ? tone(`, ${p.deleted.length} deleted (not deployed by acc)`, "orange") : ""}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`),
    ...p.files.length > 20 ? [`    \u2026and ${p.files.length - 20} more`] : []
  ];
  if (o.plan) {
    const p = planDeploy(paths, config, envName, { run }, { since: o.since, noTests: o["no-tests"] === true });
    out(o, () => show(p).join("\n"), { ...p, last: lastDeploy(paths, p.env.branch) });
    return 0;
  }
  const r = deploy(paths, config, envName, { run, now, onWait: () => {
    if (!o.json) process.stderr.write(tone("Waiting for another heavy check or deploy on this machine to finish\u2026\n", "dim"));
  } }, { since: o.since, confirmed: o["confirm-production"] === true, noTests: o["no-tests"] === true, by });
  out(o, () => [
    ...show(r.plan),
    "",
    r.deployed ? tone(`\u2713 ${r.summary}`, "blue") : r.summary,
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone("Nothing is posted until a person posts it: acc updates.", "dim") : ""
  ].filter(Boolean).join("\n"), r);
  return r.deployed || !r.plan.files.length ? 0 : 1;
}
function cmdDispatch(o, id) {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  if (o.foreground && !o.json) process.stdout.write(`Starting ${id.toUpperCase()} in this terminal. Leave the session when it's done.
`);
  const model = typeof o.model === "string" ? o.model : void 0;
  const r = dispatch(paths, config, id.toUpperCase(), { run, now, accBinDir: accBinDir(), accCommand: accCommand(), env: process.env }, { actor, by, foreground: o.foreground === true, withoutAnalysis: o["without-analysis"] === true, model });
  out(o, () => [
    `${r.task.id} \u2192 ${stateLabel("running")}`,
    `  worktree: ${r.worktree}${r.reused ? " (reused)" : ""}`,
    `  branch:   ${r.branch}`,
    `  name:     ${r.name}`,
    `  model:    ${r.task.run?.model ?? ""}${r.task.run?.modelPicked ? " (picked for this task)" : ""}`,
    `  agent:    ${r.bgId ? `background session ${r.bgId}. Watch it with: claude attach ${r.bgId}` : o.foreground ? "ran in this terminal" : "started; it will appear in claude agents shortly"}`,
    `  packet:   ${r.packetPath}`
  ].join("\n"), r);
  return 0;
}
function cmdCleanup(o, id) {
  const { paths, config } = project(process.cwd());
  const r = cleanup(paths, config, id.toUpperCase(), run, now);
  out(o, () => r.removed ? `Removed ${r.worktree}.` : `Kept ${r.worktree ?? "the worktree"}:
- ${r.reasons.join("\n- ")}`, r);
  return r.removed ? 0 : 1;
}
function cmdList(o, onlyReady) {
  const { paths } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const want = o.state;
  const tasks = ledger.tasks.filter((t) => onlyReady ? isReady(ledger, t) : !want || t.state === want || displayState(ledger, t) === want);
  out(o, () => {
    if (!tasks.length) return onlyReady ? "Nothing is ready." : "No tasks.";
    return table([["Id", "State", "Env", "Title", "Waiting on"], ...tasks.map((t) => [
      t.id,
      stateLabel(displayState(ledger, t)),
      t.environment,
      t.title,
      t.deps.filter((d) => ledger.tasks.find((x2) => x2.id === d)?.state !== "done").join(", ")
    ])]);
  }, tasks.map((t) => ({ ...t, display: displayState(ledger, t), ready: isReady(ledger, t) })));
  return 0;
}
function cmdStatus(o) {
  const { paths } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const counts = { running: 0, "needs-you": 0, review: 0, rework: 0, blocked: 0, ready: 0, todo: 0, done: 0 };
  for (const t of ledger.tasks) counts[displayState(ledger, t)]++;
  out(o, () => {
    const parts = Object.keys(counts).filter((s) => s !== "done" && counts[s] > 0).map((s) => tone(`${counts[s]} ${DISPLAY[s].label.toLowerCase()}`, DISPLAY[s].tone));
    return parts.length ? parts.join(" \xB7 ") : "Nothing in play.";
  }, { counts });
  return 0;
}
function cmdShow(o, id) {
  const { paths } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const t = ledger.tasks.find((x2) => x2.id === id.toUpperCase());
  if (!t) throw new AccError("no-task", `No task ${id}.`);
  const failed = autopilotFailure(t);
  const closed = closedPr(t);
  const checks = failedChecks(t);
  const stopped = t.state === "running" && builderStopped(t, listSessions(run, paths.root), { resuming: !!resuming(paths, t.id), now: now() });
  const said2 = stopped && t.run?.sessionId ? lastSaid(claudeProjectsDir(), t.run.sessionId, [t.run.worktree, paths.root]) : null;
  const quote = said2 ? clipSaid(said2, 600) : null;
  out(o, () => [
    `${t.id}  ${stateLabel(displayState(ledger, t, { stopped }))}  ${t.title}`,
    `Environment: ${t.environment}   Source: ${t.source.kind}${t.source.url ? ` ${t.source.url}` : ""}`,
    t.run?.name ? `Agent: ${t.run.name}` : "",
    t.deps.length ? `Depends on: ${t.deps.join(", ")}` : "",
    t.blocker ? `Blocked: ${t.blocker}` : "",
    failed ? tone(`! Autopilot couldn't ${stepWords(failed.step, failed.sha || "it")}: ${failed.reason}`, "orange") : "",
    checks ? tone(`! Checks failed on GitHub: ${checks.join(", ")}`, "orange") : "",
    closed ? tone(`! Pull request #${closed.number} was closed without merging. Reopen it on GitHub and land to update it, or land to open a new one.`, "orange") : "",
    stopped ? tone(`! Its agent stopped: ${quote ?? "its turn ended before acc done or acc block."}${quote && !/[.!?…]$/.test(quote) ? "." : ""} Resume it with acc resume ${t.id}.`, "orange") : "",
    t.brief ? `
${t.brief}
` : "",
    "History:",
    ...t.history.map((h2) => `  ${h2.at}  ${h2.from ?? "\u2013"} \u2192 ${h2.to}  by ${h2.by}${h2.reason ? `: ${h2.reason}` : ""}${h2.override ? " (override)" : ""}`)
  ].filter(Boolean).join("\n"), { ...t, stopped: stopped ? { said: said2 } : null });
  return 0;
}
function cmdResume(o, id) {
  const role = process.env.ACC_ROLE;
  if (role === "builder" || role === "reviewer" || role === "analyst") throw new AccError("refused", `${role === "analyst" ? "An" : "A"} ${role} can't resume a builder. A person does that, or autopilot.`);
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const r = resume(paths, config, id.toUpperCase(), { run, now, env: process.env, accBinDir: accBinDir(), accCommand: accCommand() }, {
    actor,
    by,
    message: o.message
  });
  out(o, () => [
    tone(`${r.task.id} resumed: its builder carries on in ${r.folder}.`, "blue"),
    r.stopped ? `  Stopped its idle background session ${r.stopped} first, so the conversation runs in one place.` : "",
    r.said ? `  It last said: ${clipSaid(r.said, 600)}` : "",
    `  Its output: ${r.log}`,
    tone(`  It finishes with acc done, or blocks. Session ${r.sessionId}, pid ${r.pid}.`, "dim")
  ].filter(Boolean).join("\n"), r);
  return 0;
}
function cmdSet(o, id, to) {
  const client = typeof o.client === "string" ? o.client.trim() : void 0;
  if (o.client !== void 0 && to !== "blocked") throw new AccError("usage", '--client goes with blocking: acc block --client "<question>".');
  if (o.client !== void 0 && !client) throw new AccError("usage", 'acc block --client "<the question, for the client>"');
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const { task, entry } = moveTask(paths, config, id.toUpperCase(), {
    to,
    actor,
    by,
    reason: o.reason ?? (client ? `Waiting on the client: ${client}` : null),
    force: o.force === true
  }, receiptHooks(paths, config, run), now);
  const update = client ? draftUpdate(paths, task, { event: "blocked", context: { question: client } }, by, now) : null;
  out(o, () => [
    `${task.id}: ${entry.from} \u2192 ${stateLabel(displayState(readLedger(paths.ledger), task))}${entry.override ? " (override recorded)" : ""}`,
    update ? `  Drafted an update for ${update.key} (${update.id}) with your question. A person reads it before it's posted.` : "",
    client && !update ? `  ${task.id} has no ticket to post a question on: a person passes it on.` : ""
  ].filter(Boolean).join("\n"), { task, entry, ...client ? { update } : {} });
  return 0;
}
function personOnlyUpdate(o, what) {
  if (process.env.ACC_ROLE === "analyst") throw new AccError("refused", `An analyst can't ${what}. A person does that.`);
  return personOnly(o, what);
}
function updateLines(u) {
  const state = u.state === "posting" ? stalePosting(u, now()) ? tone("may have posted", "orange") : "posting" : u.state === "draft" ? tone("draft", "orange") : u.state;
  const when = u.posted ? `posted by ${u.posted.by.replace(/^human:/, "")} ${u.posted.at}` : u.discarded ? `discarded by ${u.discarded.by.replace(/^human:/, "")} ${u.discarded.at}` : `drafted by ${u.by.replace(/^human:/, "")} ${u.createdAt}`;
  return [
    `${u.id.padEnd(12)} ${state}  ${trackerName(u.tracker)} ${u.key}: ${EVENT_WORDS[u.event]}${u.env ? ` (${u.env})` : ""}  ${tone(when, "dim")}`,
    ...u.failed && u.state === "draft" ? [tone(`    ! The last try didn't post: ${u.failed.reason}`, "orange")] : [],
    ...(u.posted?.text ?? u.text).split("\n").map((l3) => `    ${l3}`)
  ];
}
function cmdUpdates(o) {
  personOnlyUpdate(o, "read the ticket updates");
  const { paths } = project(process.cwd());
  const task = o.task?.toUpperCase();
  const list = listUpdates(paths).filter((u) => (o.all || isOpenUpdate(u)) && (!task || u.task === task));
  out(o, () => list.length ? [...list.flatMap((u) => [...updateLines(u), ""]), tone("Post one from the Command Center, or a GitHub issue's with acc update post <id>. acc update discard <id> sets one aside.", "dim")].join("\n") : o.all ? "No ticket updates yet." : "No drafts waiting. acc updates --all shows the posted and discarded too.", list);
  return 0;
}
function postText(o, u) {
  const file = o["text-file"];
  const text = (file ? readFileSync22(file, "utf8") : u.text).trim();
  if (!text) throw new AccError("usage", "There's nothing to post: the text is empty.");
  if (text.length > UPDATE_TEXT_MAX) throw new AccError("usage", `The text is ${text.length} characters, more than a post takes (${UPDATE_TEXT_MAX}).`);
  return text;
}
var updateOrThrow = (paths, id) => {
  const u = readUpdate(paths, id.toUpperCase());
  if (!u) throw new AccError("no-update", `No update ${id}. acc updates lists them.`);
  return u;
};
function cmdUpdatePost(o, id) {
  const by = personOnlyUpdate(o, "post a ticket's update");
  const { paths, config } = project(process.cwd());
  const u = updateOrThrow(paths, id);
  if (u.tracker !== "github") throw new AccError("refused", `${u.id} is for ${trackerName(u.tracker)} ticket ${u.key}. acc posts only on GitHub: post it from the Command Center, which posts as you through this repo's ${trackerName(u.tracker)} sign-in.`);
  const text = postText(o, u);
  const gh = config.github;
  if (!gh) throw new AccError("no-github", `This project has no "github" section in .acc/config.json, so acc can't post as its account.`);
  const issue = githubIssue(u, gh.repo);
  if (!issue) throw new AccError("refused", `${u.id}'s ticket ${u.key} isn't a GitHub issue acc can find.`);
  const env = { ...process.env, GH_TOKEN: ghToken(run, gh.account) };
  const repo = config.trackers.find((t) => t.kind === "github")?.repo ?? gh.repo;
  const seen = run("gh", ["issue", "view", issue.number, "-R", issue.repo, "--json", "url"], { cwd: paths.root, env, timeoutMs: GH_TIMEOUT_MS });
  let lives = null;
  try {
    lives = seen.code === 0 ? issueRepo(JSON.parse(seen.stdout).url) : null;
  } catch {
    lives = null;
  }
  if (lives && lives.toLowerCase() !== repo.toLowerCase()) {
    throw new AccError("refused", `${u.key} is in ${lives} now, not this repo's ${repo}, so ${u.id} isn't posted. Discard it if it no longer applies: acc update discard ${u.id}`);
  }
  claimUpdate(paths, u.id, by, now, { again: o.again === true });
  const dir = mkdtempSync5(join25(tmpdir5(), "acc-update-"));
  try {
    const file = join25(dir, "body.md");
    writeFileSync22(file, text + "\n");
    const r = run("gh", ["issue", "comment", issue.number, "-R", issue.repo, "--body-file", file], { cwd: paths.root, env, timeoutMs: GH_TIMEOUT_MS });
    if (r.code !== 0) {
      const why = (r.stderr || r.stdout).trim().split("\n")[0] || `gh exited with ${r.code}.`;
      if (r.timedOut) throw new AccError("unconfirmed", `${u.id} may have posted on ${u.key}: ${why} Look at the issue before you post it again with --again.`);
      releaseUpdate(paths, u.id, why, now);
      throw new AccError("post", `Couldn't post ${u.id} on ${u.key}: ${why}`);
    }
    const url = r.stdout.split("\n").map((l3) => l3.trim()).find((l3) => /^https:\/\/github\.com\//.test(l3));
    const posted = markPosted(paths, u.id, { by, text, ...url ? { url } : {} }, now);
    out(o, () => tone(`\u2713 Posted ${u.id} on ${u.key} as ${gh.account}${url ? `: ${url}` : "."}`, "blue"), posted);
    return 0;
  } finally {
    rmSync14(dir, { recursive: true, force: true });
  }
}
function cmdUpdateStep(o, step, id) {
  const by = personOnlyUpdate(o, "post a ticket's update");
  const { paths } = project(process.cwd());
  const u = updateOrThrow(paths, id);
  const r = step === "posting" ? claimUpdate(paths, u.id, by, now, { again: o.again === true }) : step === "posted" ? markPosted(paths, u.id, { by, text: postText(o, u), ...typeof o.url === "string" && /^https?:\/\//.test(o.url) ? { url: o.url } : {} }, now) : releaseUpdate(paths, u.id, o.reason ?? "", now);
  out(o, () => step === "posting" ? `${u.id} is being posted by ${by.replace(/^human:/, "")}.` : step === "posted" ? tone(`\u2713 ${u.id} is recorded as posted on ${u.key}.`, "blue") : `${u.id} is a draft again.`, r);
  return 0;
}
function cmdUpdateDiscard(o, id) {
  const by = personOnlyUpdate(o, "discard a ticket's update");
  const { paths } = project(process.cwd());
  const u = discardUpdate(paths, updateOrThrow(paths, id).id, by, now);
  out(o, () => `Discarded ${u.id}. It's kept, and never posted.`, u);
  return 0;
}
function cmdUpdateAsk(o, id, q2) {
  const by = personOnlyUpdate(o, "draft a question for the client");
  const { paths } = project(process.cwd());
  const taskId = id.toUpperCase();
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === taskId);
  if (!task) throw new AccError("no-task", `No task ${id}.`);
  const a = readAnalysis(paths, taskId);
  if (!a) throw new AccError("no-analysis", `${taskId} hasn't been analyzed yet: acc analyze ${taskId}.`);
  const question = a.questions.find((x2) => x2.id === q2.toLowerCase() || x2.id === `q${q2}`);
  if (!question) throw new AccError("usage", `${taskId}'s analysis has no question ${q2}. It has: ${a.questions.map((x2) => x2.id).join(", ") || "none"}.`);
  const u = draftUpdate(paths, task, { event: "question", question: question.id, text: updateText("question", { question: question.question }) }, by, now);
  if (!u) throw new AccError("refused", `${taskId} has no ticket to post a question on: it's a task acc alone keeps.`);
  out(o, () => `Drafted ${question.id} for ${u.key} (${u.id}). Read and edit it before you post it.
${u.text.split("\n").map((l3) => `    ${l3}`).join("\n")}`, u);
  return 0;
}
function cmdUpdate(o, sub, args) {
  const usage = "acc update post <id> [--text-file <f>] [--again] | acc update discard <id> | acc update ask <task> <q>";
  if (sub === "ask") {
    if (!args[0] || !args[1]) throw new AccError("usage", "acc update ask <task> <q>");
    return cmdUpdateAsk(o, args[0], args[1]);
  }
  if (!args[0]) throw new AccError("usage", usage);
  if (sub === "post") return cmdUpdatePost(o, args[0]);
  if (sub === "discard") return cmdUpdateDiscard(o, args[0]);
  if (sub === "posting" || sub === "posted" || sub === "release") return cmdUpdateStep(o, sub, args[0]);
  throw new AccError("usage", usage);
}
function renderIdentity(id) {
  const scopes = id.accounts?.find((a) => a.login.toLowerCase() === id.account.toLowerCase())?.scopes ?? [];
  return [
    `${id.repo} works as ${id.account}${id.from === "clone" ? ` (this clone's choice; the project's is ${id.projectAccount})` : " (the project's account)"}`,
    `  gh:      ${id.signedIn ? `${tone("\u2713", "blue")} logged in${scopes.length ? `, ${scopes.join(", ")}` : ""}` : tone(`\u2717 not logged in as ${id.account}`, "orange")}`,
    `  push:    ${id.pushesAs ? id.pushesAs.toLowerCase() === id.account.toLowerCase() ? `${tone("\u2713", "blue")} as ${id.pushesAs}` : tone(`\u2717 as ${id.pushesAs}`, "orange") : tone("? not set up by acc", "orange")}`,
    `  commits: ${id.commit.name || id.commit.email ? `${id.commit.name ?? "?"} <${id.commit.email ?? "?"}>` : tone("no identity set for this repo", "orange")}`,
    id.accounts && id.accounts.length > 1 ? `  others:  ${id.accounts.filter((a) => a.login !== id.account).map((a) => a.login).join(", ")}` : ""
  ].filter(Boolean).join("\n");
}
function cmdGithub(o, sub, arg) {
  const paths = repoPaths(process.cwd(), run);
  const { config } = loadConfig(paths.config);
  if (sub === "status" || !sub) {
    const id = githubIdentity(config, paths.root, run);
    if (!id) throw new AccError("no-github", 'This project has no "github" section in .acc/config.json.');
    out(o, () => renderIdentity(id), id);
    return id.signedIn && id.pushesAs?.toLowerCase() === id.account.toLowerCase() ? 0 : 1;
  }
  if (sub === "use") {
    if (!arg && !o.default) throw new AccError("usage", "acc github use <account>, or --default for the project's account");
    const id = useGithubAccount(config, paths.root, run, o.default ? null : arg);
    out(o, () => renderIdentity(id), id);
    return 0;
  }
  throw new AccError("usage", "acc github status | acc github use <account> | acc github use --default");
}
function currentBranch(root) {
  const r = run("git", ["branch", "--show-current"], { cwd: root });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
function apexTests(o) {
  return (o.test ?? []).map((t) => {
    const [name, ...why] = t.split("=");
    if (!name?.trim() || !/^[A-Za-z_][\w.]*$/.test(name.trim())) throw new AccError("usage", `--test takes an Apex test class and why it covers the change: --test AccountServiceTest="covers the new discount rule". Got "${t}".`);
    return { name: name.trim(), reason: why.join("=").trim() };
  });
}
function checkTarget(o) {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const branch = currentBranch(paths.root);
  const { env, task } = gateTarget(config, ledger, branch, { env: o.env, task: o.task ?? process.env.ACC_TASK ?? void 0 });
  return { paths, config, env, task, branch };
}
function cmdGateRun(o, names2) {
  const { paths, config, env, branch } = checkTarget(o);
  const say = (line) => {
    if (!o.json) process.stderr.write(line + "\n");
  };
  const r = runGates(paths, config, env, names2, apexTests(o), {
    run,
    now,
    onStart: (g) => say(tone(`  \u2026 ${g.name}${g.heavy ? " (heavy)" : ""}`, "dim")),
    onWait: (g) => say(tone(`  \u2026 ${g.name} is waiting for another heavy check on this machine to finish`, "dim"))
  });
  const bad = r.results.filter((x2) => !satisfies(x2));
  out(o, () => [
    `${branch ?? "HEAD"} at ${r.sha.slice(0, 7)}, against ${r.env.name}${r.env.org ? ` (${r.env.org})` : ""}`,
    ...r.results.map((x2) => `  ${gateLabel(x2.status)}${x2.gate.padEnd(11)} ${x2.summary}`),
    r.dirty ? tone("Not recorded: there are uncommitted changes, so these results can't vouch for a commit. Commit, then run acc gate run again.", "orange") : "",
    bad.length ? `${bad.length} to fix: ${bad.map((x2) => x2.gate).join(", ")}.` : r.dirty ? "" : "All recorded. acc done will accept this commit."
  ].filter(Boolean).join("\n"), r);
  return bad.length ? 1 : 0;
}
function cmdGateWaive(o, names2) {
  if (process.env.ACC_ROLE === "builder") throw new AccError("refused", `A builder can't waive its own checks. If one can't pass, say why with acc block "<why>", and a person decides.`);
  const { actor, by } = actorFrom(o);
  if (actor !== "human") throw new AccError("refused", "Only a person can waive a check.");
  const { paths, config, env, task } = checkTarget(o);
  const branch = o.task ? task?.run?.branch : void 0;
  if (o.task && !branch) throw new AccError("usage", `${task?.id ?? o.task} has no branch yet, so there's no commit to waive checks on.`);
  const sha = run("git", ["rev-parse", "--verify", "--quiet", branch ? `refs/heads/${branch}` : "HEAD"], { cwd: paths.root }).stdout.trim();
  if (!sha) throw new AccError("git", branch ? `The branch ${branch} isn't in this clone.` : "This checkout has no commit yet.");
  const waived = waiveGates(paths, config, { sha, env, gates: names2, reason: o.reason ?? "", by, now });
  out(o, () => [
    `${branch ?? "HEAD"} at ${sha.slice(0, 7)}, against ${env.name}`,
    ...waived.map((r) => `  ${gateLabel("skip")}${r.gate.padEnd(11)} waived${r.waived?.was ? ` (it was ${r.waived.was})` : ""}: ${r.waived?.reason}`),
    tone("Waived for this commit only. A new commit needs its checks again.", "dim")
  ].join("\n"), { sha, env: env.branch, waived });
  return 0;
}
function cmdGateList(o) {
  const { paths, config, env, branch: here, task } = checkTarget(o);
  const branch = o.task && task?.run?.branch ? task.run.branch : here;
  const head = run("git", ["rev-parse", "--verify", "--quiet", o.task && task?.run?.branch ? `refs/heads/${task.run.branch}` : "HEAD"], { cwd: paths.root }).stdout.trim();
  const receipts = head ? receiptsAt(paths, head) : {};
  const gates = gatesFor(config).map((g) => ({ name: g.name, about: g.about, required: config.gates.required.includes(g.name), heavy: g.heavy, receipt: receipts[g.name] ?? null }));
  out(o, () => gates.length ? [`${branch ?? "HEAD"} at ${head.slice(0, 7)}, against ${env.name}`, "", table([["Gate", "Required", "Heavy", "This commit", "Checks"], ...gates.map((g) => [
    g.name,
    g.required ? "yes" : "",
    g.heavy ? "yes" : "",
    g.receipt ? gateLabel(g.receipt.status).trimEnd() : tone("not run", "dim"),
    g.about
  ])])].join("\n") : 'No gates. List commands under "gates.commands" in .acc/config.json, and the required ones under "gates.required".', { sha: head, env: env.branch, gates });
  return 0;
}
function cmdDrift(o, envName) {
  const { paths, config } = project(process.cwd());
  if (!o.json) process.stderr.write(tone(`Retrieving the baseline from ${envName}. This only reads the org.
`, "dim"));
  const r = drift(paths, config, envName, { run, now, onWait: () => {
    if (!o.json) process.stderr.write(tone("Waiting for another heavy check on this machine to finish\u2026\n", "dim"));
  } }, { manifest: o.manifest, keep: o.keep === true });
  const found = r.changed.length + r.added.length + r.missing.length;
  if (o.json) {
    out(o, () => "", r);
    return found ? 1 : 0;
  }
  if (r.unretrievable.length) process.stderr.write([tone(`Not drift, but the retrieve couldn't fetch these; check the baseline manifest (${r.unretrievable.length}):`, "dim"), ...r.unretrievable.map((f) => tone(`  ${f}`, "dim"))].join("\n") + "\n");
  if (found || r.kept) {
    process.stdout.write([
      found ? `${r.org} differs from ${r.env} at ${r.base.slice(0, 7)}${r.ignored ? ` (${r.ignored} expected differences left out)` : ""}:` : "",
      ...r.changed.length ? ["", `Changed in the org (${r.changed.length}):`, ...r.changed.map((f) => `  ${f}`)] : [],
      ...r.added.length ? ["", `Only in the org (${r.added.length}):`, ...r.added.map((f) => `  ${f}`)] : [],
      ...r.missing.length ? ["", `In the branch but not the org (${r.missing.length}):`, ...r.missing.map((f) => `  ${f}`)] : [],
      r.kept ? `
Kept the retrieved copy at ${r.kept}. Remove it with: git worktree remove --force "${r.kept}"` : ""
    ].filter((l3) => l3 !== "").join("\n") + "\n");
  }
  return found ? 1 : 0;
}
async function main(argv) {
  const args = argv[0] === "agents" ? argv.map((x2) => x2 === "--project" ? "--project=yes" : x2) : argv;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", default: false },
      part: { type: "string" },
      step: { type: "string", multiple: true },
      profile: { type: "string" },
      project: { type: "string" },
      "production-org": { type: "string" },
      "github-repo": { type: "string" },
      "github-account": { type: "string" },
      "commit-name": { type: "string" },
      "commit-email": { type: "string" },
      "configure-git": { type: "boolean", default: false },
      "jira-site": { type: "string" },
      "jira-project": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      brief: { type: "string" },
      dep: { type: "string", multiple: true },
      env: { type: "string" },
      key: { type: "string" },
      file: { type: "string" },
      state: { type: "string" },
      reason: { type: "string" },
      as: { type: "string" },
      by: { type: "string" },
      label: { type: "string" },
      foreground: { type: "boolean", default: false },
      "without-analysis": { type: "boolean", default: false },
      "no-tests": { type: "boolean", default: false },
      test: { type: "string", multiple: true },
      task: { type: "string" },
      manifest: { type: "string" },
      keep: { type: "boolean", default: false },
      default: { type: "boolean", default: false },
      to: { type: "string" },
      plan: { type: "boolean", default: false },
      "close-done": { type: "boolean", default: false },
      "allow-deletions": { type: "boolean", default: false },
      "skip-validate": { type: "boolean", default: false },
      since: { type: "string" },
      "confirm-production": { type: "boolean", default: false },
      push: { type: "boolean", default: false },
      model: { type: "string" },
      effort: { type: "string" },
      "fallback-model": { type: "string" },
      clear: { type: "string", multiple: true },
      once: { type: "boolean", default: false },
      every: { type: "string" },
      client: { type: "string" },
      all: { type: "boolean", default: false },
      "text-file": { type: "string" },
      again: { type: "boolean", default: false },
      url: { type: "string" },
      message: { type: "string" }
    }
  });
  const o = values;
  const [cmd, ...rest] = positionals;
  if (values.version) {
    process.stdout.write(`${VERSION}
`);
    return 0;
  }
  if (!cmd || values.help || cmd === "help") {
    process.stdout.write(HELP + "\n");
    return cmd ? 0 : values.help ? 0 : 2;
  }
  switch (cmd) {
    case "doctor":
      return cmdDoctor(o, false);
    case "onboard":
      return cmdDoctor(o, true);
    case "init":
      return cmdInit(o);
    case "setup":
      return cmdSetup(o, rest[0]);
    case "agents":
      return cmdAgents(o, rest[0], rest[1]);
    case "machine":
      return cmdMachine(o, rest[0], rest[1]);
    case "add": {
      const title = rest.join(" ").trim();
      if (!title) throw new AccError("usage", 'acc add "<title>"');
      return upsert(o, [{ source: { kind: "manual", key: o.key ?? null }, title, brief: o.brief, deps: o.dep ?? [], environment: o.env }]);
    }
    case "import": {
      const data = readInput(o.file);
      if (!Array.isArray(data)) throw new AccError("usage", "acc import expects a JSON list of tasks.");
      return upsert(o, data, true);
    }
    case "intake": {
      if (rest[0] === "github") return cmdIntakeGithub(o);
      if (isSignedInKind(rest[0])) return cmdIntakeOutside(o, rest[0]);
      throw new AccError("usage", "acc intake github [--label <label>], or acc intake jira|azure|monday --file <report.json>. Jira, Azure DevOps and monday.com tickets come in through the Command Center's Track in acc; Jira and Azure DevOps ones also through the plugin's skill.");
    }
    case "dispatch": {
      if (!rest[0]) throw new AccError("usage", "acc dispatch <id> [--foreground] [--without-analysis] [--model <m>]");
      return cmdDispatch(o, rest[0]);
    }
    case "done":
      return cmdSet(o, taskIdFrom(rest[0]), "review");
    case "block": {
      const [first, ...more] = rest;
      const looksLikeId = !!first && /^[A-Z][A-Z0-9_]*-\d+$/i.test(first) && (more.length > 0 || typeof o.client === "string");
      const id = taskIdFrom(looksLikeId ? first : void 0);
      const client = typeof o.client === "string" ? o.client.trim() : "";
      const reason = o.reason ?? ((looksLikeId ? more : rest).join(" ").trim() || (client ? `Waiting on the client: ${client}` : ""));
      if (!reason) throw new AccError("usage", 'acc block "<what you need>", or acc block --client "<question>" when only the client can answer');
      return cmdSet({ ...o, reason }, id, "blocked");
    }
    case "resume": {
      if (!rest[0]) throw new AccError("usage", 'acc resume <id> [--message "<text>"]');
      return cmdResume(o, rest[0]);
    }
    case "analyze": {
      if (!rest[0]) throw new AccError("usage", "acc analyze <id>");
      return cmdAnalyze(o, rest[0]);
    }
    case "analysis": {
      if (rest[0] === "answer") {
        if (!rest[1] || !rest[2] || !rest[3]) throw new AccError("usage", 'acc analysis answer <id> <q> "<answer>"');
        return cmdAnswerAnalysis(o, rest[1], rest[2], rest.slice(3).join(" "));
      }
      if (!rest[0]) throw new AccError("usage", "acc analysis <id>");
      return cmdShowAnalysis(o, rest[0]);
    }
    case "review": {
      if (!rest[0]) throw new AccError("usage", "acc review <id>");
      return cmdReview(o, rest[0]);
    }
    case "land": {
      if (!rest[0]) throw new AccError("usage", "acc land <id>");
      return cmdLand(o, rest[0]);
    }
    case "autopilot":
      return cmdAutopilot(o);
    case "sync":
      return cmdSync(o);
    case "updates":
      return cmdUpdates(o);
    case "update":
      return cmdUpdate(o, rest[0], rest.slice(1));
    case "promote": {
      if (!rest[0]) throw new AccError("usage", "acc promote <env> [--to <env>]");
      return cmdPromote(o, rest[0]);
    }
    case "deploy": {
      if (!rest[0]) throw new AccError("usage", "acc deploy <env> [--since <commit>] [--confirm-production]");
      return cmdDeploy(o, rest[0]);
    }
    case "cleanup": {
      if (!rest[0]) throw new AccError("usage", "acc cleanup <id>");
      return cmdCleanup(o, rest[0]);
    }
    case "gate": {
      const [sub, ...names2] = rest;
      if (sub === "run") return cmdGateRun(o, names2);
      if (sub === "list") return cmdGateList(o);
      if (sub === "waive") return cmdGateWaive(o, names2);
      throw new AccError("usage", 'acc gate run [<gate>...] | acc gate list | acc gate waive <gate>... --reason "<why>"');
    }
    case "github":
      return cmdGithub(o, rest[0], rest[1]);
    case "hook": {
      if (rest[0] === "permission") return cmdHookPermission();
      if (rest[0] === "session-start" || rest[0] === "pre-tool-use" || rest[0] === "stop") return cmdHookEvent(rest[0]);
      process.stderr.write("acc hook takes permission, session-start, pre-tool-use or stop.\n");
      return 1;
    }
    case "drift": {
      if (!rest[0]) throw new AccError("usage", "acc drift <environment>");
      return cmdDrift(o, rest[0]);
    }
    case "status":
      return cmdStatus(o);
    case "list":
      return cmdList(o, false);
    case "ready":
      return cmdList(o, true);
    case "show": {
      if (!rest[0]) throw new AccError("usage", "acc show <id>");
      return cmdShow(o, rest[0]);
    }
    case "set": {
      if (!rest[0] || !rest[1]) throw new AccError("usage", "acc set <id> <state> [--reason <text>]");
      return cmdSet(o, rest[0], rest[1]);
    }
    default:
      throw new AccError("usage", `Unknown command "${cmd}". Run acc help.`);
  }
}
var isEntry = (() => {
  try {
    return !!process.argv[1] && realpathSync4(fileURLToPath(import.meta.url)) === realpathSync4(resolve3(process.argv[1]));
  } catch {
    return false;
  }
})();
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      const err = e;
      const json = process.argv.includes("--json");
      if (json) process.stdout.write(JSON.stringify({ error: err.code ?? "error", message: err.message }) + "\n");
      else process.stderr.write(tone(`\u2717 ${err.message}`, "orange") + "\n");
      const usage = err.code === "usage" || String(err.code ?? "").startsWith("ERR_PARSE_ARGS");
      process.exit(usage ? 2 : err instanceof AccError ? 1 : 3);
    }
  );
}
export {
  main
};
