# Work with AI

`compat-finder` provides an [Agent Skill](https://agentskills.io/) that helps AI agents understand the compatibility troubleshooting workflows, CLI usage, and TypeScript API for this package.

If you want an agent to drive the troubleshooting workflow with you, installing the skill first gives it the right context.

## Installation

Install the `compat-finder` skill into your AI agent:

```bash
npx skills add HowieHz/howiehz-misc --skill compat-finder
```

The source code of the skills is [skills/compat-finder](https://github.com/HowieHz/howiehz-misc/tree/main/packages/compat-finder/skills/compat-finder).

## Example Prompts

Once installed, you can ask agents to help with `compat-finder` tasks:

```text
I need to track down a compatibility issue across Plugin 1, Plugin 2, Plugin 3, and Plugin 4. Walk me through the next tests and narrow it down from my results.
```

```text
Scan my game's mods folder with compat-finder and find which mods are breaking startup.
```

```text
Build a compat-finder powered troubleshooting flow into my app so users can find plugin conflicts on their own.
```

```text
My compat-finder UI needs to save a troubleshooting session and resume it after a page refresh. Which API should I use, and what state should I persist?
```

## What's Included

The `compat-finder` skill covers:

- How to choose between one-off CLI usage and library integration
- CLI commands, options, locales, and supported answer formats
- Built-in algorithm selection, including `binary-split` and `leave-one-out`
- Guided and one-shot troubleshooting workflows
- Help turning broad requests, such as testing a mods or plugins folder, into a concrete `compat-finder` workflow
- The TypeScript session API and the lower-level state API
- When advanced integrations should use the lower-level state API to persist or resume sessions
- How to choose between guided triage, automatic triage, and app integration workflows
