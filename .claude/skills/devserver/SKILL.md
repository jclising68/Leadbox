# Dev Server Management

1. Check if port 3000 is in use: `lsof -i :3000`
2. If running, kill the process: `kill -9 <PID>`
3. Verify port is free: `lsof -i :3000` (should return empty)
4. If `.next` folder exists and there were build issues, delete it: `rm -rf .next`
5. Start dev server: `bun run dev`
6. Verify server is running by checking output for "Ready in" message
7. If Turbopack cache errors appear, delete `.next` and restart
