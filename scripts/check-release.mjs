#!/usr/bin/env node
/**
 * Guards a release.
 *
 * package.json, public/manifest.json, VERSION.md and the newest CHANGELOG entry
 * all have to name the same version, and that version has to be one Chrome will
 * accept — otherwise the store rejects the upload after the workflow has already
 * run, or the release notes describe something other than what shipped.
 *
 *   node scripts/check-release.mjs                    validate and report
 *   node scripts/check-release.mjs --version          print the version only
 *   node scripts/check-release.mjs --notes-file FILE  write the release notes
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const readFile = (name) => readFileSync(new URL(name, ROOT), 'utf8');
const readJson = (name) => JSON.parse(readFile(name));

/** Chrome accepts 1–4 dot-separated integers, each 0–65535, without leading zeros. */
const isChromeVersion = (version) =>
    /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(version) &&
    version.split('.').every((part) => Number(part) <= 65535);

const CHANGELOG_HEADING = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?[^\n]*$/gm;

/** Returns the newest released section, skipping an Unreleased placeholder. */
const latestChangelogEntry = (changelog) => {
    const headings = [...changelog.matchAll(CHANGELOG_HEADING)].map((match) => ({
        version: match[1],
        date: match[2],
        start: match.index,
        end: match.index + match[0].length,
    }));

    const index = headings.findIndex(
        (heading) => heading.version.toLowerCase() !== 'unreleased'
    );
    if (index === -1) return null;

    const entry = headings[index];
    const next = headings[index + 1];
    return {
        version: entry.version,
        date: entry.date,
        notes: changelog.slice(entry.end, next ? next.start : undefined).trim(),
    };
};

const pkg = readJson('package.json');
const manifest = readJson('public/manifest.json');
const entry = latestChangelogEntry(readFile('CHANGELOG.md'));
const versionFile = readFile('VERSION.md').trim();

const problems = [];

if (!entry) {
    problems.push('CHANGELOG.md has no released version section (## [x.y.z] - date).');
} else {
    if (entry.version !== manifest.version) {
        problems.push(
            `CHANGELOG.md documents ${entry.version} but public/manifest.json says ${manifest.version}.`
        );
    }
    if (!entry.date) {
        problems.push(`The ${entry.version} changelog heading has no release date.`);
    }
    if (!entry.notes) {
        problems.push(`The ${entry.version} changelog section is empty.`);
    }
}

if (pkg.version !== manifest.version) {
    problems.push(
        `package.json says ${pkg.version} but public/manifest.json says ${manifest.version}.`
    );
}

if (versionFile !== manifest.version) {
    problems.push(
        `VERSION.md says ${versionFile || '(empty)'} but public/manifest.json says ${manifest.version}.`
    );
}

if (!isChromeVersion(manifest.version)) {
    problems.push(
        `"${manifest.version}" is not a version Chrome accepts (1-4 dot-separated integers, each 0-65535).`
    );
}

if (problems.length > 0) {
    console.error('Release check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nBump package.json, public/manifest.json and VERSION.md together,');
    console.error('and add a matching CHANGELOG.md section, before releasing.');
    process.exit(1);
}

const notesFileIndex = process.argv.indexOf('--notes-file');
if (notesFileIndex !== -1) {
    const target = process.argv[notesFileIndex + 1];
    if (!target) {
        console.error('--notes-file needs a path');
        process.exit(1);
    }
    writeFileSync(target, `${entry.notes}\n`);
}

if (process.argv.includes('--version')) {
    process.stdout.write(manifest.version);
} else {
    console.log(`Release ${manifest.version} (${entry.date}) is consistent.`);
}
