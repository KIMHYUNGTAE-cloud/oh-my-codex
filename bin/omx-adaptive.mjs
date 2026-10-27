#!/usr/bin/env node
// Local fork entrypoint. No global installation or upstream launch side effects.
if (process.argv[2] === 'evolve') {
  try {
    const { evolveCommand } = await import('../dist/cli/evolve.js');
    await evolveCommand(process.argv.slice(3));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
} else {
  const { main } = await import('../dist/cli/index.js');
  await main(process.argv.slice(2));
}
