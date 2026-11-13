// The item Type (and Subtype) field is a real dropdown, so it opens and
// changes on desktop and mobile Safari — not a datalist text box.
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-item-type.mjs
const { chromium } = await import(process.env.PW || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8768/index.html";
const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };

async function run(tag, opts) {
  const p = await (await b.newContext({ viewport: opts.viewport, hasTouch: !!opts.touch, isMobile: !!opts.touch })).newPage();
  p.on("pageerror", e => errs.push(tag + " " + e));
  await p.goto(URL);
  await p.setInputFiles("#open", DB);
  await p.waitForSelector("#tabs:not([hidden])", { state: "attached" });
  await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = "#items"; });
  await p.waitForSelector(".form .typesel");
  await p.waitForTimeout(200);
  const info = await p.evaluate(() => {
    const typeLbl = [...document.querySelectorAll(".form .grid > label")].find(l => l.textContent.trim() === "Type");
    const subLbl = [...document.querySelectorAll(".form .grid > label")].find(l => l.textContent.trim() === "Subtype");
    const type = typeLbl && typeLbl.nextElementSibling;
    const sub = subLbl && subLbl.nextElementSibling;
    const tsel = type && type.querySelector("select[data-role=type]");
    const ssel = sub && sub.querySelector("select[data-role=type]");
    return {
      typeTag: type && type.className,
      isSelect: !!(tsel && tsel.tagName === "SELECT"),
      hasDatalist: !!(type && (type.list || type.getAttribute("list") || type.querySelector("input[list]"))),
      options: tsel ? [...tsel.options].map(o => o.value).filter(v => v !== "__other__") : [],
      value: type && type.value,
      start: tsel && tsel.value,
      subIsSelect: !!(ssel && ssel.tagName === "SELECT"),
      subValue: sub && sub.value
    };
  });
  ok(info.isSelect && !info.hasDatalist, tag + ": Type is a <select>, not a datalist (class " + info.typeTag + ")");
  ok(info.options.length >= 3 && info.options.includes(info.start), tag + ": Type lists known types (" + info.options.length + ", current " + info.start + ")");
  ok(info.subIsSelect, tag + ": Subtype is a <select> too");
  const next = info.options.find(t => t !== info.start);
  ok(!!next, tag + ": there is another type to pick (" + next + ")");
  await p.evaluate(v => {
    const typeLbl = [...document.querySelectorAll(".form .grid > label")].find(l => l.textContent.trim() === "Type");
    const sel = typeLbl.nextElementSibling.querySelector("select[data-role=type]");
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, next);
  await p.waitForTimeout(150);
  // click another field to make sure a re-render doesn't revert it
  await p.click(".form input[type=text], .form textarea");
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => {
    const typeLbl = [...document.querySelectorAll(".form .grid > label")].find(l => l.textContent.trim() === "Type");
    return typeLbl.nextElementSibling.value;
  });
  ok(after === next, tag + ": Type stays " + next + " after clicking away (got " + after + ")");
  await p.evaluate(() => {
    const typeLbl = [...document.querySelectorAll(".form .grid > label")].find(l => l.textContent.trim() === "Type");
    const sel = typeLbl.nextElementSibling.querySelector("select[data-role=type]");
    sel.value = "__other__";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await p.waitForTimeout(80);
  const other = await p.evaluate(() => {
    const typeLbl = [...document.querySelectorAll(".form .grid > label")].find(l => l.textContent.trim() === "Type");
    const wrap = typeLbl.nextElementSibling;
    const inp = wrap.querySelector("[data-role=type-other]");
    inp.hidden = false;
    inp.value = "custom_type";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return { hidden: inp.hidden, value: wrap.value };
  });
  ok(!other.hidden && other.value === "custom_type", tag + ": Other… lets you type a new type (" + JSON.stringify(other) + ")");
  await p.context().close();
}

await run("desktop", { viewport: { width: 1280, height: 800 } });
await run("phone", { viewport: { width: 390, height: 844 }, touch: true });
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (process.exitCode) console.log("FAILED");
else console.log("all ok");
