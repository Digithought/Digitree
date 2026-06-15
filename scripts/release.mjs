#!/usr/bin/env node
// Release orchestration for digitree. Run via `yarn release [patch|minor|major|<version>]`.
//
// One command cuts a full release:
//   1. Pre-flight  — gh installed + authenticated, on the release branch, clean
//                    working tree, and in sync with origin.
//   2. Validate    — build + test (so a broken state never gets tagged).
//   3. Bump        — bumpp picks the new version (prompts, or uses the passed
//                    release type) and writes package.json.
//   4. Docs        — regenerate typedoc against the new version.
//   5. Commit/tag  — commit package.json + docs and create a `v<version>` tag
//                    (locally; nothing is pushed until publish succeeds).
//   6. Publish     — yarn npm publish.
//   7. Push        — push the commit and tag to origin.
//   8. GitHub      — create the release with auto-generated notes.
//
// If something fails after the commit/tag is created, the script prints how to
// unwind it so you can retry cleanly.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Branch releases are cut from. Change this if the project's default branch moves.
const RELEASE_BRANCH = 'master';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const passthrough = process.argv.slice(2); // forwarded to bumpp, e.g. `yarn release minor`

// --- shell helpers ----------------------------------------------------------
// We run through the shell so .cmd shims (yarn, gh) resolve on Windows, and
// quote every argument ourselves so values with spaces (commit messages) survive.
function quote(arg) {
	if (process.platform === 'win32') {
		return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
	}
	return /[^A-Za-z0-9_@%+=:,./-]/.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg;
}

function run(cmd, args = []) {
	const line = [cmd, ...args.map(quote)].join(' ');
	const res = spawnSync(line, { stdio: 'inherit', shell: true, cwd: root });
	if (res.status !== 0) {
		throw new Error(`\`${cmd} ${args.join(' ')}\` exited with ${res.status ?? res.signal}`);
	}
}

function capture(cmd, args = []) {
	const line = [cmd, ...args.map(quote)].join(' ');
	const res = spawnSync(line, { encoding: 'utf8', shell: true, cwd: root });
	if (res.status !== 0) {
		throw new Error((res.stderr || res.stdout || `\`${cmd}\` failed`).trim());
	}
	return res.stdout.trim();
}

function ok(cmd, args = []) {
	const line = [cmd, ...args.map(quote)].join(' ');
	return spawnSync(line, { stdio: 'ignore', shell: true, cwd: root }).status === 0;
}

function readVersion() {
	return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
}

const step = (msg) => console.log(`\n▶ ${msg}`);

// --- release flow -----------------------------------------------------------
let tagCreated = null; // set once a local commit + tag exist, for recovery hints

async function main() {
	step('Pre-flight checks');

	if (!ok('gh', ['--version'])) {
		throw new Error('GitHub CLI (`gh`) is not installed — see https://cli.github.com/.');
	}
	if (!ok('gh', ['auth', 'status'])) {
		throw new Error('Not authenticated with GitHub. Run `gh auth login` first.');
	}

	const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
	if (branch !== RELEASE_BRANCH) {
		throw new Error(`On branch \`${branch}\`; releases must be cut from \`${RELEASE_BRANCH}\`.`);
	}

	if (capture('git', ['status', '--porcelain'])) {
		throw new Error('Working tree is not clean. Commit or stash your changes first.');
	}

	run('git', ['fetch', '--tags', 'origin', RELEASE_BRANCH]);
	const localHead = capture('git', ['rev-parse', 'HEAD']);
	const remoteHead = capture('git', ['rev-parse', `origin/${RELEASE_BRANCH}`]);
	if (localHead !== remoteHead) {
		throw new Error(`Local \`${RELEASE_BRANCH}\` is out of sync with \`origin/${RELEASE_BRANCH}\` — pull/push first.`);
	}

	const fromVersion = readVersion();
	console.log(`  ${RELEASE_BRANCH} is clean and in sync. Current version: ${fromVersion}`);

	step('Building');
	run('yarn', ['build']);

	step('Testing');
	run('yarn', ['test']);

	step('Bumping version');
	run('yarn', ['bumpp', '--no-commit', '--no-tag', '--no-push', ...passthrough]);
	const version = readVersion();
	if (version === fromVersion) {
		throw new Error('Version did not change; aborting.');
	}
	const tag = `v${version}`;

	step('Regenerating docs');
	run('yarn', ['doc']);

	step(`Committing and tagging ${tag}`);
	run('git', ['add', '-A']);
	run('git', ['commit', '-m', `release: ${tag}`]);
	run('git', ['tag', '-a', tag, '-m', tag]);
	tagCreated = tag;

	step(`Publishing ${version} to npm`);
	run('yarn', ['npm', 'publish', '--access', 'public']);

	step('Pushing commit and tag');
	run('git', ['push', '--follow-tags', 'origin', RELEASE_BRANCH]);

	step(`Creating GitHub release ${tag}`);
	run('gh', ['release', 'create', tag, '--title', tag, '--generate-notes', '--verify-tag']);

	console.log(`\n✓ Released ${tag} — published to npm and GitHub.\n`);
}

main().catch((err) => {
	console.error(`\n✖ Release failed: ${err.message}`);
	if (tagCreated) {
		console.error(
			`\nA local commit and tag ${tagCreated} were already created but not pushed.\n` +
				`To unwind and retry:\n` +
				`  git tag -d ${tagCreated}\n` +
				`  git reset --hard HEAD~1\n` +
				`If the npm publish succeeded, finish manually instead:\n` +
				`  git push --follow-tags origin ${RELEASE_BRANCH}\n` +
				`  gh release create ${tagCreated} --title ${tagCreated} --generate-notes --verify-tag\n`,
		);
	}
	process.exit(1);
});
