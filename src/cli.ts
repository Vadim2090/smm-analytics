/**
 * smm-analytics — entry point
 * Phase 0 placeholder. Real commands land in Phase 1+.
 */
import kleur from 'kleur';

const [, , cmd] = process.argv;

const banner = `
${kleur.bold().cyan('smm-analytics')} ${kleur.dim('v0.0.1')}
${kleur.dim('Free SMM analytics — segment your engagement by audience.')}
`;

const help = `
Usage:
  smm-analytics              Run setup wizard (first time) or scrape (subsequent)
  smm-analytics setup        Force re-run the setup wizard
  smm-analytics scrape       Scrape now (no wizard)
  smm-analytics dashboard    Open the local dashboard
  smm-analytics --help       Show this help

Docs: https://github.com/Vadim2090/smm-analytics
`;

console.log(banner);

switch (cmd) {
  case '--help':
  case '-h':
  case 'help':
    console.log(help);
    break;
  case undefined:
  case 'setup':
  case 'scrape':
  case 'dashboard':
    console.log(kleur.yellow(`⚠ "${cmd ?? 'default'}" not implemented yet — Phase 0 skeleton only.`));
    console.log(kleur.dim('Roadmap: see SPEC.md § Build phases.'));
    break;
  default:
    console.log(kleur.red(`Unknown command: ${cmd}`));
    console.log(help);
    process.exit(1);
}
