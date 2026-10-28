// The grammar of the list keys the kit's guarded workflows read from
// `.xezar/pipeline/config.json`, and one function that judges a config against it.
//
// Why a grammar at all. `pipeline_config_list` answers an absent key, a misspelt key, an object
// where a list belongs and an honest `[]` with the same empty list — deliberately, because for a
// list of CI job names "none stated" is a fact. For these keys it is not: an empty list means
// "this project has no deploy", and the workflow refuses on it. A typo must never look like that.
// So a guarded workflow asks here first, and gets one of four answers it can tell apart.
//
// The values become arguments to `gh`, so they are validated, never sanitised: a value that is not
// the shape it claims to be is a refusal.

export const GRAMMAR = {
  "deploy.environments": {
    element: /^[a-z0-9][a-z0-9-]*=[A-Za-z0-9._-]+\.ya?ml$/,
    shape: "<environment>=<workflow file>, e.g. staging=deploy.yml — a file name, never a path",
  },
  "deploy.rollback": {
    element: /^[a-z0-9][a-z0-9-]*=[A-Za-z0-9._-]+\.ya?ml$/,
    shape: "<environment>=<workflow file>, e.g. staging=rollback.yml — a file name, never a path",
  },
  "performance.budgets": {
    element: /^[a-z0-9][a-z0-9-]*=p(50|75|90|95|99)<[0-9]+(\.[0-9]+)?@n=([5-9]|[1-9][0-9]+)$/,
    shape: "<metric>=p<percentile><<limit>@n=<runs>, e.g. cold-start-ms=p95<400@n=20 — a percentile and at least five runs, because one sample is not a measurement",
  },
  "localisation.locales": {
    element: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/,
    shape: "a locale tag, e.g. pl or pt-BR",
  },
};

/**
 * Judge one key. Returns { status, detail, values }, status one of:
 *   ok         the list is there, non-empty, every element is the right shape
 *   empty      the key is there and is `[]` — the owner's honest "this project has none"
 *   absent     the key is not there at all
 *   malformed  anything else: unknown sibling key, not a list, an element of the wrong shape
 * `empty` and `absent` are both a refusal, and they are different sentences on purpose.
 */
export function judge(config, key) {
  const rule = GRAMMAR[key];
  if (!rule) return { status: "malformed", detail: `"${key}" is not a key this kit reads`, values: [] };
  const [group, leaf] = key.split(".");
  const node = config?.[group];
  if (node !== undefined && (node === null || typeof node !== "object" || Array.isArray(node))) {
    return { status: "malformed", detail: `"${group}" must be an object`, values: [] };
  }
  const value = node?.[leaf];
  if (value === undefined) {
    // The key is missing. A sibling the kit does not know is then the typo this whole file exists
    // for. Only then: when the key IS present there is nothing it could be a typo of, and refusing
    // on an unknown neighbour would break every installed copy of this grammar the day a later
    // release adds a key beside these.
    for (const sibling of Object.keys(node ?? {})) {
      if (!GRAMMAR[`${group}.${sibling}`]) {
        return { status: "malformed", detail: `"${key}" is not set, and "${group}.${sibling}" is not a key this kit reads — a misspelt key must not read as "none configured"`, values: [] };
      }
    }
    return { status: "absent", detail: `"${key}" is not set`, values: [] };
  }
  if (!Array.isArray(value)) return { status: "malformed", detail: `"${key}" must be a list of strings`, values: [] };
  if (value.length === 0) return { status: "empty", detail: `"${key}" is []`, values: [] };
  for (const element of value) {
    if (typeof element !== "string" || !rule.element.test(element)) {
      return { status: "malformed", detail: `"${key}" holds ${JSON.stringify(element)}, which is not ${rule.shape}`, values: [] };
    }
  }
  const names = value.map((element) => element.split("=")[0]);
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) {
    return { status: "malformed", detail: `"${key}" names "${twice}" twice`, values: [] };
  }
  // A rollback for an environment nobody can deploy to is a list somebody half edited.
  if (key === "deploy.rollback") {
    const deployable = (Array.isArray(node?.environments) ? node.environments : [])
      .filter((element) => typeof element === "string")
      .map((element) => element.split("=")[0]);
    const orphan = names.find((name) => !deployable.includes(name));
    if (orphan !== undefined) {
      return { status: "malformed", detail: `"deploy.rollback" names "${orphan}", which "deploy.environments" does not list`, values: [] };
    }
  }
  return { status: "ok", detail: `${value.length} entr${value.length === 1 ? "y" : "ies"}`, values: value };
}
