# Recall

> A local League of Legends companion for permanent match history, challenge planning, champion progress, ranked goals, and playstyle analysis.

![Recall dashboard](image.png)

## What Recall does

**Keeps your history** — Recall saves supported matches locally so the League
client's rolling history window does not erase games you have already synced.

**Turns challenges into a champion plan** — browse and filter every challenge,
see champion-specific requirements, and pin what matters. While in champion
select, Recall can show whether the champion you are hovering still advances a
pinned challenge.

**Shows the full game** — open a recorded match to compare both teams and
expand a player for combat, economy, vision, objective, multikill, and setup
statistics when the League client provided full game detail.

**Connects champion results to mastery and challenges** — compare champion
mastery, your results, ranked performance, and remaining champion-specific
challenge requirements.

**Tracks progress over time** — review ranked LP snapshots, set rank and
challenge goals, view personal records, and explore mode-specific playstyle
trends and lobby comparisons.

## Connected to the League client

Recall reads the locally running League Client on Windows. It syncs on launch,
after a game, and periodically while the client is available. Use **Refresh**
when you want to sync matches, challenges, ranked snapshots, and profile data
immediately.

Pinned champion challenges can also appear in a small, draggable overlay during
champion select. It marks whether the champion you are hovering still advances
each pinned challenge.

## Supported modes

Recall records Ranked Solo/Duo, Ranked Flex, Normal, Quickplay, Swiftplay,
ARAM, and ARAM: Mayhem. Arena and rotating modes are not currently tracked.

### Performance grades

Every game gets a letter grade from S+ down to D.

Riot does not expose a grade through the local client API, so Recall derives one
by comparing you against the other nine players in that same game. On Summoner's
Rift, role-sensitive statistics like creep score are measured against others in
your role — a support is not marked down for farming less than the mid laner. An
average game lands on a B.

Grading needs one extra request per game, so it runs after matches are recorded.
A game that has already aged out of the client's history cannot be graded
retroactively and will show no grade.

## The League client's 20-game window

The League client exposes only its **most recent 20 games**, shared across all
modes. Requests for anything older are accepted and silently ignored, and no
other local endpoint offers more.

Recall works around this by re-reading that window on launch, after each game
and periodically, storing anything it has not seen before. This means:

- Everything you play from installation onward is kept permanently, with no limit.
- On first run, up to your last 20 games are imported.
- Games played while Recall is closed are still picked up, provided you have not played more than 20 since it last ran.
- Games from before you installed Recall cannot be recovered. Nothing can retrieve them.

Match history is paged, filterable, and sortable by mode, result, champion,
grade, date, duration, KDA, and damage, so a large archive stays usable.

Challenge progress is also snapshotted whenever a value changes, which lets
Recall show progress over time — something the client, which only reports current
values, cannot do.

The database lives in your user data folder and survives app updates. Its exact
path is shown on the Settings page, along with export and reset actions.

# Install (Windows only)

Go to the [latest release](https://github.com/nyquase/lol-challenge-tracker/releases/latest)

> Windows will warn you that this exe is not safe, because it's a pain to sign an exe. Feel free to look at the code to see what it does.

# Build

```sh
pnpm install
```

Try in dev mode

```sh
pnpm dev
```

Run the tests

```sh
pnpm test
```

Build for release

```sh
pnpm build
```

## A note on SQLite

The app uses `better-sqlite3`, a native module. It is compiled against the
Electron runtime for the app itself, and a second copy (`better-sqlite3-node`)
is kept at the plain Node ABI so the test suite can run outside Electron.

## Privacy

Recall stores your own data locally and sends nothing anywhere. The challenge
payload from the client includes a `friendsAtLevels` field listing your friends'
identifiers; Recall deliberately discards it, and a test enforces that.
