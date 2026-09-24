# Documented script output

Maintained Markdown can claim the JSON keys printed by a small, reviewed set of kit scripts. Put an
opaque script ID immediately before a JSON fence:

    <!-- documented-output:script-id -->
    ```json
    {
      "stableKey": {
        "nestedKey": "values are illustrative"
      }
    }
    ```

The repository check runs the ID's allowlisted script inside the script's own temporary fixture and
requires every documented key, including nested keys, to exist in the JSON object it prints. Values
are not compared because fixture-dependent text is often the point of the script. The fixture may
also enforce no-output cases; the `leader-context` fixture, for example, verifies the primary output
and every documented condition under which the loader must print nothing.

## The trust boundary

The marker names only an ID matching lowercase letters, digits, and hyphens. A path, command,
unknown ID, empty marker, missing JSON fence, invalid or empty JSON object, fixture setup failure,
script failure, or missing documented key fails closed with a named reason. Markdown never supplies
a path, command, arguments, environment, fixture, or expected-output producer, and the check never
executes marker text.

The allowlist is the kit file `.xezar/checks/documented-output.allowlist.json`. Each row owns exactly
four fields: the marker `id`, the fixed kit `script` path, the internal `fixture` ID, and the internal
`expectedOutputProducer` ID. Adding a script therefore requires a reviewable, fingerprinted kit-file
change plus the corresponding fixed fixture and producer in `documented-output.mjs`; adding a marker
to a document alone can never authorize an executable.

To add a row, implement the bounded fixture and output producer first, add the allowlist row, add
passing and refusal cases to the tests that run `documented-output.mjs`, then add the document marker. The script is copied
into a fresh directory beneath the current process's temporary directory and runs only there. It is
never run in the primary checkout or in the document's directory.

## Scan and no-op boundaries

The check asks Git for committed `*.md` files. It explicitly excludes any tracked Markdown under
`.local/xezar/`, `node_modules/`, or `changelog.d/`; untracked Markdown is outside this committed-document
check. Markers inside ordinary fenced examples and markers indented four or more spaces are inert,
as are marker lookalikes with text after the closing `-->` or with the comment split across lines,
so the example above is a deliberate silent no-op. That is the bounded no-op: a recognized marker
with nothing after it is a failure, never a skip, and a marker followed by anything other than a
JSON fence also fails.
