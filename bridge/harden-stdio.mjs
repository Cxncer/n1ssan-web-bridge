// The launcher starts the Bridge and Vite with piped stdout/stderr and then
// exits to hand the session over to the browser. Exiting closes the read ends of
// both pipes, so the next console write raises EPIPE and Node terminates the
// whole process - which is what killed the Bridge mid-session and produced
// "Could not connect to the n1ssan Bridge while saving Armory".
//
// With a listener attached the broken pipe is reported instead of thrown, so a
// detached process keeps serving even though nobody reads its output.
for (const stream of [process.stdout, process.stderr]) {
  if (!stream) continue
  stream.on('error', () => {})
}
