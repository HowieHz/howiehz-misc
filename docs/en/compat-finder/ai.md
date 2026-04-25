# Work with AI

If you want AI to help with a `compat-finder` troubleshooting or integration flow, you can install the `compat-finder` [Agent Skill](https://agentskills.io/) into your AI agent.

Once installed, the agent has better context for `compat-finder` CLI usage, library APIs, and common troubleshooting workflows.

## What AI Can Help With

- Continue a compatibility troubleshooting flow from your target list and test results
- Help you decide whether to start with the CLI or integrate `compat-finder` into your own project
- Write or adjust `compat-finder` CLI commands
- Integrate `compat-finder` into your app, script, or custom UI
- Design save, resume, and persistence flows for troubleshooting sessions

## Installation

Install the `compat-finder` skill into your AI agent:

```bash
npx skills add HowieHz/howiehz-misc --skill compat-finder
```

The source code for the skill is [skills/compat-finder](https://github.com/HowieHz/howiehz-misc/tree/main/packages/compat-finder/skills/compat-finder).

## What to Include in Your Prompt

To get more actionable help, include:

- Your target list, such as plugins, mods, versions, feature flags, or config options
- How you decide whether a test result means "issue" or "pass"
- The tests you have already run and the results you got
- Whether you want to use the CLI directly or integrate `compat-finder` into your own app or script

## Example Prompts

Once installed, you can ask AI to help with tasks like these:

<!-- markdownlint-disable MD013 -->

```text
I need to track down a compatibility issue across Plugin 1, Plugin 2, Plugin 3, and Plugin 4. Walk me through the next tests and narrow it down from my results.
```

<!-- markdownlint-enable MD013 -->

```text
Scan my game's mods folder with compat-finder and find which mods are breaking startup.
```

```text
Build a compat-finder powered troubleshooting flow into my app so users can find plugin conflicts on their own.
```

<!-- markdownlint-disable MD013 -->

```text
My compat-finder UI needs to save a troubleshooting session and resume it after a page refresh. Which API should I use, and what state should I persist?
```

<!-- markdownlint-enable MD013 -->
