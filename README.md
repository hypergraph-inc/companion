# Tesseract Hypergraph Companion

Read and write to a live [hypergraph](https://hypergraph.digital) from the terminal.

```
npm install -g @hypergraph-inc/companion
```

## What's a Tesseract Hypergraph ?

- **Tesseract** is a 4D cube. Popculture has equated it to 3D of space + 1D of time.
- **Hypergraph** is the upgraded version of the graph data structure.

## How to connect?

1. Open your [Tesseract](https://hypergraph.digital) instance in a browser and sign in.
2. In a terminal, welcome your companion to the hypergraph: `hypergraph welcome <name>`
3. Pair your companion with your account.
4. Click **Companion** in the toolbar.
5. Use your favourite LLM to build your hypergraph.

## Commands

```
hypergraph welcome <name>           create a companion identity and make it the default
hypergraph read                     what is in view right now
hypergraph probe <id>               structure around one node
hypergraph render [file.png]        sample the view to an image
hypergraph emit <rows.json>         write rows into the graph
hypergraph branch <scene>           census a named scene
hypergraph learn [lesson]           download the curriculum for LLM agents
```

Every command takes `--origin`, `--label`, `--json`, and `--linger`.
`hypergraph <command> --help` describes one command.

### welcome

```
hypergraph welcome work
```

Mints (or loads) the companion identity named `work`, pairs it if it has never
been paired, and makes it the default — every later command uses it without
needing `--label`.

`--no-pair`, `--no-open`, and `--no-learn` behave as they do everywhere else.
`--no-default` welcomes the identity without changing which one commands use
by default.

### read

```
hypergraph read --top 6
```

Prints tick and frame count, node/edge/hull/label totals, bounds, who else is
attached, then the top-N labelled nodes as `importance  deg  x,y  text`.

`--adjacency` adds each node's neighbours. `--repl` keeps the connection open
so you pay the settle once and then ask one question per round trip:

```
printf 'g:start 1\nq\n' | hypergraph read --repl --linger 0
```

Repl commands: `<id>`, `<id> <hops>`, `e <id>` for an edge, `r` to re-census,
`a` to re-census with adjacency, `?`, `q`.

### probe

```
hypergraph probe w:jmp:loop --hops 1
```

Walks structure outward from a real id. `--probe-edge <id>` starts from an
edge instead.

Each one-shot probe pays connect, settle, and linger — for a sequence, use
`read --repl`.

### render

```
hypergraph render view.png --cell 16 --scale 3
hypergraph render --field luma,warm
```

The node roster already carries position and colour, so a region can be
sampled without a screenshot. `--render <file>` writes a PNG; `--field <spec>`
prints an ASCII field to the terminal.

Built-in fields: `luma`, `warm`, `green`, `alpha`, `red`, `grn`, `blu`, `tex`.
Anything else is evaluated as an expression over `r, g, b, a, l`.

### emit

```
hypergraph emit rows.json
```

The file is a JSON array of rows, or an object with a `rows` array. Rows are
validated before anything is sent. Writes need the `append` grant, which the
default admission includes.

### learn

```
hypergraph learn
hypergraph learn hypergraph-colour
```

Downloads the lesson scenes this key is entitled to and writes them as skills
under `~/.claude/skills` (`--skill-dir` to change). Runs automatically the
first time a key is paired.

## Identity

`--label` is a durable identity, not a display name. On first use the CLI
mints a P-256 keypair and stores it in the macOS Keychain (service
`tesseract-companion`, account = label); elsewhere it falls back to
`~/.tesseract/companions/<label>.jwk.json` and says so loudly.

The label a command uses, in order: `--label` if given; otherwise whichever
identity `hypergraph welcome <name>` last set as default
(`~/.tesseract/companions/default-label`); otherwise `tesseract-companion`.
Run `welcome` once and every later command picks up that identity on its own.

The label is sanitised into that account name and filename: anything outside
`a-z 0-9 _ -` becomes `_`. So `my label` and `my_label` are one key, not two.

Every later run with that label authenticates as the same key, so the server
sees one identity across runs. Different labels are different companions with
separate keys — that is how one person runs several at once.

Deleting the key orphans whatever it was charged for, along with its
approvals. Treat it like a key, because it is one.

## What a key is allowed to do

Admission carries a grant. By default it is `observe+mark+append`: every read
shape above, plus row writes. `mutate` (delete) and `drive` (pause, sim keys,
grab) are withheld unless the owner widens the grant deliberately. A message
outside the grant is dropped server-side rather than answered.

**forget** in the browser revokes the enrollment, kills the live ticket, and
expels the key from the open window in one act.

## Create a new companion

Run `hypergraph welcome <name>` to mint another companion identity — a new
key is stored on your machine, and it becomes the default for later commands.
Pass `--label <name>` to any command instead when you want to use a companion
other than the default just for that one run.

Approving on the pairing page is a passkey signature, and it enrolls the key
durably — so it already carries everything the knock dialog would ask for. The
key is admitted to your open windows the moment pairing succeeds. Every later 
run with that label skips both steps and joins.

## Being seen

A companion is not a silent reader. It announces itself as a viewport, so the
label shows up in the browser next to the region it is looking at, and nodes
it touches are marked. Someone watching the session can see an agent working.

Opening the `connections` scene shows every attached companion, the grant it
was admitted under, and every message the gate refused.

## Scripting it

Pair every label interactively **before** a script uses it. A brand-new label
run headlessly blocks for the full 120 seconds and then fails, and because the
prompt goes to stderr while it waits, a backgrounded or piped run shows nothing
that distinguishes "waiting for a human" from "hung".

- `--no-open` — do not try to spawn a browser (it has nothing to open on a
  headless box).
- `--no-pair` — fail fast instead of starting a pairing flow.
- `--join <token>` — skip session discovery when you already know the session.
- `--no-learn` — skip the curriculum download that follows a first pairing.

## Exit codes

| code | meaning |
| ---- | ------- |
| 0 | ran to completion — **or** the browser dropped the connection mid-run |
| 1 | refused, failed the handshake, or timed out |
| 2 | unknown command or bad usage |

Companion mode being turned off, the key being forgotten, or the window closing
ends the run with status **0**, after printing the reason to stderr. A wrapper
that only checks the exit code cannot tell that from a clean finish — check the
output, not just the status.

## Troubleshooting

**`no session this key may join has companion mode open`** — nobody clicked
Companion, or the 5-minute publication lapsed. Click it again. The message is
the same either way, so if you clicked recently, assume the TTL.

**`this key is paired, but the account it belongs to has no window with
companion mode open`** — the opposite fix. The key is fine; the browser is not
showing a companion session, or it is signed in as a different account. Do not
re-pair; open the window.

**A run hangs with no output** — a label that has never been paired is waiting
on browser approval, for up to 120 seconds. Pair it interactively once.

**An emit reports success but nothing appears** — `emitted N row(s)` and
`marked N of M` both count what this end sent, not what the server accepted. A
batch refused by a rate limit is dropped without a reply. Diff a settled census
before and after to confirm a write landed.

**A read returns a tiny "Hello World" scene** — that is a different or reset
branch answering, not an error. Nothing announces that the branch changed under
you; compare node counts between reads.

**Handshake closes before WELCOME** — usually a protocol version mismatch
between this CLI and the server. Upgrade whichever is older.

**Writes are accepted but nothing changes** — the rows validated and sent, but
the grant did not include `append`. Check the grant printed at admission.
