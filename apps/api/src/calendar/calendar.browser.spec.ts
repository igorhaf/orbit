import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import * as jwt from "jsonwebtoken";
import { Db } from "../db";

test("Calendar Workspace renders all views and scheduled Cards on desktop and mobile", async () => {
  const db = new Db(),
    user = await db.one<{ id: string; name: string; email: string }>(
      "SELECT id,name,email FROM users WHERE email=$1",
      ["igorhaf@gmail.com"],
    );
  assert.ok(user);
  const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: "10m" },
    ),
    board = (await db.one<{ id: string }>(
      "INSERT INTO boards(title,owner_id) VALUES('Calendar browser test',$1) RETURNING id",
      [user.id],
    ))!.id;
  await db.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",
    [board, user.id],
  );
  const list = (await db.one<{ id: string }>(
    "INSERT INTO lists(board_id,title) VALUES($1,'Agenda') RETURNING id",
    [board],
  ))!.id;
  await db.query(
    "INSERT INTO cards(list_id,title,schedule_start_at,schedule_end_at,schedule_time_zone) VALUES($1,'Scheduled browser card',now(),now()+interval '1 hour','America/Recife')",
    [list],
  );
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
    });
    await context.addInitScript(
      ({ token, user }) => {
        localStorage.setItem("orbit_token", token);
        localStorage.setItem("orbit_user", JSON.stringify(user));
      },
      { token, user },
    );
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `${process.env.WEB_ORIGIN || "http://localhost:3000"}/calendar`,
    );
    await page.getByRole("heading", { name: "Calendário", exact: true }).waitFor();
    await page.waitForTimeout(500);
    assert.match(await page.locator("body").innerText(),/Scheduled browser card/);
    for (const name of ["Semana", "Dia", "Agenda", "Timeline", "Mês"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page
        .getByRole("heading", { name: "Calendário", exact: true })
        .waitFor();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        "document.documentElement.scrollWidth > window.innerWidth",
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    await db.query("DELETE FROM boards WHERE id=$1", [board]);
    await db.onModuleDestroy();
  }
});
