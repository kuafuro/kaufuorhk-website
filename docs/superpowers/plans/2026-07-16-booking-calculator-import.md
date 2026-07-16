# Booking → Calculator Roll-call Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-tap import of this month's confirmed booking slots + rosters into the split calculator's session roll-call, so the coach never double-enters attendance data.

**Architecture:** Single-file change to the static calculator page (`split-calculator/index.html`): a new button + async import function that reads the existing Supabase RPCs `slot_list` / `slot_roster` (coach JWT already present — page is guarded coach/admin) and writes plain session/attendee/student records into the existing localStorage `DB`. No calculation-core changes; deduction still happens at roll-call. Idempotent via `sess.slotId` and `stu.sbId` link keys.

**Tech Stack:** Vanilla JS (classic script + dynamic `import()` of supabase-js from CDN), Supabase RPC, Playwright E2E (established scratchpad pattern, real JWT auth).

## Global Constraints

- Spec: `docs/superporters/specs` → correct path `docs/superpowers/specs/2026-07-16-booking-calculator-import-design.md`; follow it exactly.
- Import only slots with `status='confirmed'`; roster entries with `status='booked'` only.
- Attendee defaults: `classes: 1`, `status: 'present'`; kind = `free` for free students, else most-recent-package kind, else `p4`.
- Coach mapping: `ming`→`'A'`, `tom`→`'B'` (explicit, never `'auto'`).
- Re-import must never remove/alter existing attendees or coach-edited statuses.
- Supabase project `ikzoxrvnpsseyjviawti`; publishable key `sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O` (safe in frontend).
- Existing file:// test suites (calc-new.js, calc-v3.js, ui.js, june.js) must keep passing untouched.
- All pushes: feature branch `claude/expense-split-calculator-reo0oe`, then fast-forward/merge to `main` (standing permission).

---

### Task 1: Import button + engine in the calculator, with happy-path E2E

**Files:**
- Modify: `split-calculator/index.html` (button in 課堂記錄 card; JS block before the `/* ---------- 分頁 ---------- */` section)
- Test: `/tmp/claude-0/-home-user/19ff0ac9-634f-5b33-86c9-7e3ef6531327/scratchpad/sched-calc.js` (new)

**Interfaces:**
- Consumes: Supabase RPCs `slot_list(p_from,p_to)` → rows `{id, session_date, start_time, end_time, venue, coach, status, booked_count, …}`; `slot_roster(p_slot_id)` → rows `{student_id, name, email, status}`; calculator globals `DB`, `uid()`, `monthData()`, `currentMonth`, `save()`, `renderAll()`, `toast(msg)`.
- Produces: session records gain optional `slotId: uuid`; student records gain optional `sbId: uuid`. Button id `#import-bookings`. Helper names: `pickKind(stu)`, `matchStudent(entry)`, `slotDur(slot)`, `importBookings()`.

- [ ] **Step 1: Write the failing E2E test**

Create `/tmp/claude-0/-home-user/19ff0ac9-634f-5b33-86c9-7e3ef6531327/scratchpad/sched-calc.js`:

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { routeExternal } = require('./auth-helper.js');
const URL="https://ikzoxrvnpsseyjviawti.supabase.co";
const KEY="sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O";

async function apiSignin(email){
  const r=await fetch(`${URL}/auth/v1/token?grant_type=password`,{method:"POST",
    headers:{apikey:KEY,"Content-Type":"application/json"},
    body:JSON.stringify({email,password:"ClaudeTest123"})});
  const j=await r.json(); if(!j.access_token) throw new Error("signin "+email);
  return j.access_token;
}
const H=t=>({apikey:KEY,Authorization:"Bearer "+t,"Content-Type":"application/json"});
async function rpc(t,fn,a){const r=await fetch(`${URL}/rest/v1/rpc/${fn}`,{method:"POST",headers:H(t),body:JSON.stringify(a||{})});return r.json().catch(()=>null);}
async function rest(t,m,p,b){const r=await fetch(`${URL}/rest/v1/${p}`,{method:m,headers:{...H(t),Prefer:"return=representation"},body:b?JSON.stringify(b):undefined});return r.json().catch(()=>null);}

async function login(context, email){
  const p=await context.newPage();
  await p.goto('http://localhost:8899/login/');
  await p.waitForSelector('#authCard',{state:'visible',timeout:25000});
  await p.fill('#email',email); await p.fill('#password','ClaudeTest123');
  await p.click('#submitBtn');
  await p.waitForSelector('#profileCard',{state:'visible',timeout:25000});
  return p;
}

(async()=>{
  let pass=true; const check=(n,ok)=>{console.log((ok?'PASS':'FAIL')+' - '+n); if(!ok)pass=false;};
  // ── Setup：coach 開本月時段，兩個學生自己報名 → confirmed ──
  const coachT=await apiSignin('claude-coach@kuafuorhk.com');
  const s1T=await apiSignin('claude-s1@kuafuorhk.com');
  const s2T=await apiSignin('claude-s2@kuafuorhk.com');
  const hk=new Date(Date.now()+8*3600*1000);
  const month=hk.toISOString().slice(0,7);
  const lastDay=new Date(hk.getFullYear(),hk.getMonth()+1,0).getDate();
  const day=Math.min(hk.getDate(),lastDay);        // 本月今日（一定喺本月內、唔會過去）
  const date=`${month}-${String(day).padStart(2,'0')}`;
  await rest(coachT,"DELETE","class_slots?notes=eq.__calcimport__");
  const slot=(await rest(coachT,"POST","class_slots",{session_date:date,start_time:"18:00",end_time:"19:30",venue:"KT",coach:"ming",capacity:4,min_to_open:2,notes:"__calcimport__"}))[0];
  await rpc(s1T,"book_slot",{p_slot_id:slot.id});
  const b2=await rpc(s2T,"book_slot",{p_slot_id:slot.id});
  check('setup：兩個學生報名後 confirmed', b2.confirmed===true);

  // ── Coach 開計數機撳匯入 ──
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx=await browser.newContext(); await routeExternal(ctx);
  const cp=await login(ctx,'claude-coach@kuafuorhk.com');
  await cp.goto('http://localhost:8899/split-calculator/');
  await cp.waitForSelector('#import-bookings',{timeout:25000});
  await cp.fill('#month',month); await cp.dispatchEvent('#month','change');
  await cp.click('#import-bookings');
  await cp.waitForFunction(()=>document.querySelectorAll('#sessions .row').length>0,null,{timeout:20000});

  // 1 節堂：日期/地點/教練/時長啱
  check('匯入 1 節堂', await cp.locator('#sessions .row').count()===1);
  check('日期啱', (await cp.locator('#sessions .row input[data-key="date"]').inputValue())===date);
  check('地點 KT', (await cp.locator('#sessions .row input[data-key="venue"]').inputValue())==='KT');
  check('教練 ming→A（明確指定）', (await cp.locator('#sessions .row select[data-key="coach"]').inputValue())==='A');
  check('時長 1.5 小時（18:00–19:30）', (await cp.locator('#sessions .row input[data-key="dur"]').inputValue())==='1.5');
  // 2 個點名，預設出席、扣1堂
  check('2 個點名', await cp.locator('#sessions .att').count()===2);
  check('預設狀態=出席', (await cp.locator('#sessions .att select[data-key="status"]').first().inputValue())==='present');
  check('預設扣 1 堂', (await cp.locator('#sessions .att input[data-key="classes"]').first().inputValue())==='1');
  // 學員名冊自動多咗 2 人（學員套票分頁）
  await cp.click('.tabs .tab[data-tab="students"]');
  await cp.waitForTimeout(200);
  check('學員名冊 2 人（自動新增）', await cp.locator('#tracker .row').count()===2);
  // quickbar 收入 2×$200（冇套票 → 預設 p4 價）
  check('收入 $400（2×p4 預設價）', /400\.00/.test(await cp.locator('#quickbar').innerText()));

  await browser.close();
  console.log(pass?'ALL PASS':'SOME FAILED');
  process.exit(pass?0:1);
})().catch(e=>{console.error('THREW',e);process.exit(1);});
```

- [ ] **Step 2: Create test users, start server, run test to verify it fails**

Test users (coach + 2 students) via Supabase SQL (same pattern as before — bcrypt password `ClaudeTest123`, confirmed email, roles coach/student/student for `claude-coach@`/`claude-s1@`/`claude-s2@kuafuorhk.com`). Then:

Run: `cd /home/user/kaufuorhk-website && (python3 -m http.server 8899 &) ; cd <scratchpad> && NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node sched-calc.js`
Expected: FAIL — `waitForSelector('#import-bookings')` times out (button doesn't exist yet).

- [ ] **Step 3: Implement the button + import engine**

In `split-calculator/index.html`, after `<button class="add" id="add-session">＋ 加一節課堂</button>` add:

```html
    <button class="add" id="import-bookings">🗓️ 由排堂報名匯入本月（教練）</button>
```

Before the `/* ---------- 分頁 ---------- */` JS section add:

```js
/* ---------- 由排堂報名匯入（Supabase slot_list/slot_roster → 本月點名表） ---------- */
function pickKind(stu){
  if(stu.free) return 'free';
  const mine = DB.packages.filter(p=>p.studentId===stu.id)
    .sort((x,y)=> (x.buyDate||'') > (y.buyDate||'') ? -1 : 1);   // 最近買嗰張
  return mine.length ? mine[0].kind : 'p4';
}
function matchStudent(entry){
  // 配對次序：sbId → 名完全一樣（補寫 sbId）→ 新增
  let stu = DB.students.find(s=>s.sbId && s.sbId===entry.student_id);
  if(stu) return { stu, created:false };
  const nm = String(entry.name || (entry.email||'').split('@')[0] || '').trim();
  if(nm){
    stu = DB.students.find(s=>String(s.name||'').trim().toLowerCase()===nm.toLowerCase());
    if(stu){ stu.sbId = entry.student_id; return { stu, created:false }; }
  }
  stu = { id: uid(), name: nm || '（未命名）', free:false, sbId: entry.student_id };
  DB.students.push(stu);
  return { stu, created:true };
}
function slotDur(slot){
  if(!slot.end_time) return 1;
  const [h1,m1]=String(slot.start_time).split(':').map(Number);
  const [h2,m2]=String(slot.end_time).split(':').map(Number);
  const d=(h2*60+(m2||0)-h1*60-(m1||0))/60;
  return d>0 ? Math.round(d*2)/2 : 1;   // 0.5 精度；壞資料當 1 堂鐘
}
$('#import-bookings').onclick = async ()=>{
  const btn = $('#import-bookings'); btn.disabled = true;
  try{
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb = createClient('https://ikzoxrvnpsseyjviawti.supabase.co',
                            'sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O');
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ toast('要用教練帳戶登入先匯入到'); return; }
    const [y,m] = currentMonth.split('-').map(Number);
    const from = `${currentMonth}-01`;
    const to = `${currentMonth}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;
    const { data:slots, error } = await sb.rpc('slot_list', { p_from: from, p_to: to });
    if(error) throw error;
    const confirmed = (slots||[]).filter(s=>s.status==='confirmed' && s.booked_count>0);
    if(!confirmed.length){ toast('本月未有已開班嘅報名'); return; }
    const md = monthData();
    let nSess=0, nAtt=0, nNew=0;
    for(const slot of confirmed){
      const { data:roster, error:e2 } = await sb.rpc('slot_roster', { p_slot_id: slot.id });
      if(e2) throw e2;
      const booked = (roster||[]).filter(r=>r.status==='booked');
      if(!booked.length) continue;
      let sess = md.sessions.find(s=>s.slotId===slot.id);
      if(!sess){
        sess = { id: uid(), slotId: slot.id, date: slot.session_date, dur: slotDur(slot),
                 venue: slot.venue, coach: slot.coach==='ming' ? 'A' : 'B', attendees: [] };
        md.sessions.push(sess); nSess++;
      }
      if(!Array.isArray(sess.attendees)) sess.attendees = [];
      for(const r of booked){
        const { stu, created } = matchStudent(r);
        if(created) nNew++;
        if(sess.attendees.some(a=>a.studentId===stu.id)) continue;   // 唔重複、唔郁教練改過嘅嘢
        sess.attendees.push({ id: uid(), studentId: stu.id, kind: pickKind(stu), classes: 1, status: 'present' });
        nAtt++;
      }
    }
    save(); renderAll();
    toast(`匯入 ${nSess} 節堂、${nAtt} 個點名${nNew?`（新增 ${nNew} 個學員）`:''} ✅`);
  }catch(err){
    toast('匯入失敗：' + (err.message || err));
  }finally{ btn.disabled = false; }
};
```

- [ ] **Step 4: Syntax check + run test to verify it passes**

Run: extract `<script>` → `node --check`; then re-run sched-calc.js.
Expected: `syntax OK`, then all checks PASS.

- [ ] **Step 5: Commit**

```bash
git add split-calculator/index.html docs/superpowers/plans/2026-07-16-booking-calculator-import.md
git commit -m "Calculator: import this month's confirmed bookings into roll-call"
```

---

### Task 2: Idempotency + status-preservation coverage, regressions, ship

**Files:**
- Modify: `/tmp/claude-0/-home-user/19ff0ac9-634f-5b33-86c9-7e3ef6531327/scratchpad/sched-calc.js` (extend)

**Interfaces:**
- Consumes: Task 1's `#import-bookings` button, `sess.slotId` dedup key, attendee `status` select (`data-key="status"`).
- Produces: nothing new — verification + ship.

- [ ] **Step 1: Extend the E2E with idempotency + preservation checks**

Insert before `await browser.close();`:

```js
  // ── 再撳一次：唔會重複 ──
  await cp.click('.tabs .tab[data-tab="input"]');
  await cp.click('#import-bookings');
  await cp.waitForTimeout(2500);
  check('再匯入：仍然 1 節堂', await cp.locator('#sessions .row').count()===1);
  check('再匯入：仍然 2 個點名', await cp.locator('#sessions .att').count()===2);
  check('再匯入：學員名冊仍然 2 人', await cp.evaluate(()=>JSON.parse(localStorage.getItem('split-calc-v1')).students.length)===2);

  // ── 教練改咗狀態後再匯入：唔會被還原 ──
  await cp.locator('#sessions .att select[data-key="status"]').first().selectOption('excused');
  await cp.waitForTimeout(300);
  await cp.click('#import-bookings');
  await cp.waitForTimeout(2500);
  check('再匯入：教練改嘅「請假」狀態保留', (await cp.locator('#sessions .att select[data-key="status"]').first().inputValue())==='excused');

  // ── cleanup：刪測試時段 ──
  await cp.evaluate(async()=>{
    const m=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    const sb=m.createClient("https://ikzoxrvnpsseyjviawti.supabase.co","sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O");
    await sb.from('class_slots').delete().eq('notes','__calcimport__');
  });
```

- [ ] **Step 2: Run the full test — expect ALL PASS**

- [ ] **Step 3: Run existing regressions (must stay green)**

Run: `node calc-new.js && node calc-v3.js && node ui.js && node june.js` (file:// suites) — Expected: ALL PASS ×4.

- [ ] **Step 4: Cleanup test users + slots via SQL; verify zero leftovers**

- [ ] **Step 5: Commit, push branch, fast-forward/merge main**

```bash
git add -A && git commit -m "test: booking→calculator import idempotency coverage"
git push -u origin claude/expense-split-calculator-reo0oe
git fetch origin main && git merge-base --is-ancestor origin/main HEAD \
  && git push origin claude/expense-split-calculator-reo0oe:main || echo MAIN_MOVED
```

---

## Self-Review

- **Spec coverage:** confirmed-only filter ✓ (Task 1 Step 3 filter), booked-only ✓, mapping table ✓ (session fields + coach map), matching order sbId→name→create ✓, idempotency ✓ (Task 2), error handling (未登入/rpc error/冇 confirmed) ✓, UI button+toast ✓, test plan items 1–5 ✓ (item 5 = Task 2 Step 3).
- **Placeholder scan:** none — all steps carry exact code/commands.
- **Type consistency:** `slotId`/`sbId` names consistent across tasks; `#import-bookings` id consistent; RPC row fields match migration definitions.
