// 手動行一次提醒掃描(唔開 server)。本機測試用:  npm run run-once
import { runReminders } from './reminders.js';

runReminders()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
