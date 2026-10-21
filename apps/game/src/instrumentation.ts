/**
 * Runs once as the server starts (#97). A server whose environment fails the boot check (`checkEnvironment`) refuses
 * to start: it prints one code per failure, never a value, and exits 78 (`EX_CONFIG`, a configuration error).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvironment } = await import("./server/environment.server");
    const codes = checkEnvironment(process.env);
    if (codes.length === 0) return;
    for (const code of codes) console.error(`GAME_ENVIRONMENT_REJECTED ${code}`);
    process.exit(78);
  }
}
