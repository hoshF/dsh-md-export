#!/usr/bin/env node
/**
 * dsh-md-export — CLI: export a DSH session log as Markdown.
 *
 * Shares the exact same core as the in-app "导出 MD" button (../src), so both
 * produce byte-identical output: ## Metadata / ## Conversation / ### References.
 *
 * Usage:
 *   node bin/dsh-md-export.mjs                        # newest session
 *   node bin/dsh-md-export.mjs <file|sessionId prefix>
 *   node bin/dsh-md-export.mjs --list
 *
 * Options:
 *   -o, --out <path>   write to a path (default: ~/dsh-transcripts/)
 *       --stdout       write to stdout
 *       --list         list every session
 *       --h1           prepend a `# Title` line (off by default, per the spec)
 *       --tools        include tool calls and results
 *       --reasoning    include thinking (#### 🤔 Thought Process)
 *       --injected     include injected user-side messages
 *       --system       include system prompts
 *       --all          all of the above
 *   -h, --help         show this help
 *
 * Environment:
 *   DSH_MD_EXPORT_CORE   override the core directory (default: ../src)
 *   DSH_HOME             DSH home (default: ~/.dsh)
 *   DSH_WEB_URL          value used for the Metadata URL field
 */

import { writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Resolve through symlinks so a shim in ~/bin still finds the real ../src.
const HERE = path.dirname(realpathSync(fileURLToPath(import.meta.url)));
const CORE_DIR = process.env.DSH_MD_EXPORT_CORE ?? path.join(HERE, '..', 'src');

if (!existsSync(CORE_DIR)) {
  process.stderr.write(
    `dsh-md-export: core directory not found: ${CORE_DIR}\n`
    + '  Set DSH_MD_EXPORT_CORE=<path> to the actual src/ directory.\n');
  process.exit(1);
}

const core = (name) => import(pathToFileURL(path.join(CORE_DIR, name)).href);
const { listSessions, findSessionFile, readSessionLog } = await core('session.js');
const { renderMarkdown, markdownFilename } = await core('render.js');

const DEFAULT_OUT_DIR = path.join(os.homedir(), 'dsh-transcripts');

const USAGE = `dsh-md-export — export a DSH session log as Markdown

Usage:
  node bin/dsh-md-export.mjs [options] [file|sessionId]

Options:
  -o, --out <path>   write to a path (default: ~/dsh-transcripts/)
      --stdout       write to stdout
      --list         list every session
      --h1           prepend a \`# Title\` line
      --tools        include tool calls and results
      --reasoning    include thinking
      --injected     include injected user-side messages
      --system       include system prompts
      --all          all of the above
  -h, --help         show this help`;

function parseArgs(argv) {
  const opts = {
    tools: false, reasoning: false, injected: false, system: false, h1: false,
    stdout: false, list: false, out: null, inputs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--tools': opts.tools = true; break;
      case '--reasoning': opts.reasoning = true; break;
      case '--injected': opts.injected = true; break;
      case '--system': opts.system = true; break;
      case '--h1': opts.h1 = true; break;
      case '--all': opts.tools = opts.reasoning = opts.injected = opts.system = true; break;
      case '--stdout': opts.stdout = true; break;
      case '--list': opts.list = true; break;
      case '--latest': break;
      case '-o': case '--out': {
        const output = argv[i + 1];
        if (!output || output.startsWith('-')) {
          throw new Error(`${a} requires an output path; use ./ for filenames beginning with '-'`);
        }
        opts.out = output;
        i++;
        break;
      }
      case '-h': case '--help': opts.help = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
        opts.inputs.push(a);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(`${USAGE}\n`); return 0; }

  if (opts.list) {
    const sessions = listSessions();
    if (sessions.length === 0) { process.stdout.write('No sessions found.\n'); return 0; }
    process.stdout.write(`${sessions.length} session(s), newest first:\n\n`);
    for (const s of sessions) {
      process.stdout.write(`  ${new Date(s.mtime).toISOString().slice(0, 19).replace('T', ' ')}  ${s.id}  (v${s.gen})\n`);
    }
    return 0;
  }

  let file;
  if (opts.inputs.length > 0) {
    const input = opts.inputs[0];
    file = existsSync(input) ? path.resolve(input) : findSessionFile(input);
    if (!file) throw new Error(`no session or file matches: ${input}`);
  } else {
    const sessions = listSessions();
    if (sessions.length === 0) throw new Error('no sessions found');
    file = sessions[0].file;
  }

  const log = readSessionLog(file);
  if (!log.header) throw new Error(`session log has no header: ${file}`);
  const origin = process.env.DSH_WEB_URL ?? null;
  const { markdown, turnCount, referenceCount, title } = renderMarkdown(log, opts, { origin });

  if (opts.stdout) { process.stdout.write(markdown); return 0; }

  let outPath = opts.out;
  if (!outPath) {
    mkdirSync(DEFAULT_OUT_DIR, { recursive: true });
    outPath = path.join(DEFAULT_OUT_DIR, markdownFilename(log.header, title));
  }
  writeFileSync(outPath, markdown, 'utf8');
  process.stderr.write(
    `Exported ${turnCount} turn(s), ${referenceCount} reference(s) (${markdown.length} chars) -> ${outPath}\n`);
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  process.stderr.write(`dsh-md-export: ${error?.message ?? error}\n`);
  process.exit(1);
}
