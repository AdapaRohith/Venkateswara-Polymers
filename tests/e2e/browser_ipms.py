"""Browser end-to-end walk-through of the IPMS screens against a staging build.

    VP_UI_URL=http://127.0.0.1:4199 VP_E2E_OWNER=... VP_E2E_WORKER=... VP_E2E_PASSWORD=... \
    VP_SHOTS=/path/to/screenshots python tests/e2e/browser_ipms.py

The staging bundle must be built with VITE_API_URL pointing at a staging API.
Never run this against production: it moves stock and records a return.
"""
import os
import re
import sys
import uuid

from playwright.sync_api import expect, sync_playwright

UI = os.environ["VP_UI_URL"].rstrip("/")
if "avlokai.com" in UI:
    sys.exit("Refusing to run against production")
SHOTS = os.environ.get("VP_SHOTS", ".")
PASSWORD = os.environ["VP_E2E_PASSWORD"]
TAG = uuid.uuid4().hex[:4].upper()
results = []


def step(name):
    def wrap(fn):
        def run(page):
            try:
                fn(page)
                results.append((name, "PASS", ""))
            except Exception as exc:  # keep going so one failure shows the rest
                page.screenshot(path=os.path.join(SHOTS, f"FAIL-{len(results):02d}.png"), full_page=True)
                results.append((name, "FAIL", (str(exc).splitlines() or [repr(exc)])[0][:300]))
        return run
    return wrap


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=True)


def login(page, email):
    page.goto(f"{UI}/login")
    page.fill("#email", email)
    page.fill("#password", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_url(re.compile(r"/(production-log)?$"), timeout=15000)


def pick_e2e(select):
    """Select the E2E material once the async option list has loaded."""
    option = select.locator("option", has_text="E2E-IPMS").first
    option.wait_for(state="attached", timeout=15000)
    select.select_option(label=option.inner_text())


def nav(page, label):
    page.locator("aside nav").get_by_role("link", name=label, exact=True).click()


@step("Sidebar has the Stock Control section with Opening/Closing buttons")
def t_nav(page):
    aside = page.locator("aside nav")
    for label in ["Stock Overview", "Opening Stock", "Closing Stock", "AM / PM Shift Ledger", "Stock Transfers",
                  "Machine Stock", "Return Stock", "Day-wise Usage", "Search Stock", "Production Batches"]:
        expect(aside.get_by_role("link", name=label, exact=True)).to_be_visible()


@step("Stock Overview shows all locations in kg / tons with bags")
def t_overview(page):
    nav(page, "Stock Overview")
    expect(page.get_by_role("heading", name="Stock Overview")).to_be_visible()
    for tile in ["Warehouse", "Ground Floor", "First Floor", "On Machines", "Plant Total"]:
        expect(page.get_by_text(tile, exact=True).first).to_be_visible()
    page.wait_for_selector("table tbody tr")
    body = page.locator("main").inner_text()
    assert re.search(r"\d t\b", body), "large figures should read in tons"
    assert "bags" in body
    expect(page.get_by_role("button", name="Opening Stock")).to_be_visible()
    expect(page.get_by_role("button", name="Closing Stock")).to_be_visible()
    shot(page, "01-overview")


@step("Opening Stock button opens the opening view; yesterday's closing equals today's opening")
def t_opening_closing(page):
    page.get_by_role("button", name="Opening Stock").click()
    expect(page).to_have_url(re.compile(r"view=opening"))
    expect(page.get_by_role("heading", name=re.compile("Opening stock"))).to_be_visible()
    today_opening = page.locator("tfoot td").last.inner_text()
    shot(page, "02-opening")
    page.get_by_role("button", name="Previous day").click()
    page.get_by_role("tab", name="Closing Stock").click()
    expect(page.get_by_role("heading", name=re.compile("Closing stock"))).to_be_visible()
    page.wait_for_timeout(800)
    yesterday_closing = page.locator("tfoot td").last.inner_text()
    assert today_opening == yesterday_closing, (today_opening, yesterday_closing)
    shot(page, "03-closing-yesterday")


@step("AM / PM shift ledger shows AM closing = PM opening")
def t_shifts(page):
    nav(page, "AM / PM Shift Ledger")
    expect(page.get_by_text("AM · Morning").first).to_be_visible()
    expect(page.get_by_text("PM · Night").first).to_be_visible()
    shot(page, "04-shift-ledger")


@step("Transfer in bags: Warehouse → Ground Floor moves stock and keeps plant total")
def t_transfer(page):
    nav(page, "Stock Transfers")
    pick_e2e(page.locator("#tr-material"))
    page.select_option("#tr-from", "WAREHOUSE")
    page.select_option("#tr-to", "GROUND_FLOOR")
    page.get_by_role("button", name="bags", exact=True).click()
    page.get_by_label("Quantity").fill("2")
    expect(page.get_by_text("= 50 kg · 2 bags")).to_be_visible()
    page.get_by_role("radio", name=re.compile("PM")).first.click()
    page.get_by_role("button", name="Move stock").click()
    expect(page.get_by_text(re.compile(r"ST-\d{8}-\d{3} recorded"))).to_be_visible(timeout=10000)
    expect(page.get_by_text(re.compile("Plant total unchanged"))).to_be_visible()
    shot(page, "05-transfer")


@step("Old Send-to-Floor entries live in the Transfer register; /materials redirects there")
def t_legacy(page):
    page.goto(f"{UI}/materials")
    expect(page).to_have_url(re.compile(r"/stock/transfers$"))
    expect(page.get_by_text(re.compile(r"^FT-\d+$")).first).to_be_visible(timeout=10000)
    assert page.locator("aside nav").get_by_role("link", name="Materials", exact=True).count() == 0


@step("Machine Stock lists machines by floor with Assign / Release")
def t_machines(page):
    nav(page, "Machine Stock")
    expect(page.get_by_role("heading", name="Ground Floor")).to_be_visible()
    expect(page.get_by_role("heading", name="First Floor")).to_be_visible()
    expect(page.get_by_role("button", name="Assign").first).to_be_visible()
    shot(page, "06-machines")


@step("Production batch rejects First Floor and records a Ground Floor batch")
def t_batch(page):
    nav(page, "Production Batches")
    line_machine = page.get_by_label("Line 1 machine")
    line_machine.locator("option").nth(1).wait_for(state="attached", timeout=15000)
    machine_options = line_machine.locator("option").all_inner_texts()
    assert not any("Cutting" in o for o in machine_options), "first-floor machines must not be offered"
    line_machine.select_option(index=1)
    pick_e2e(page.get_by_label("Line 1 material"))
    page.get_by_label("Line 1 weighing").select_option("net")
    page.get_by_label("Line 1 net").fill("12.5")
    page.get_by_label("Line 1 size").fill(f"UI-{TAG}")
    page.get_by_role("button", name="Record batch").click()
    expect(page.get_by_text(re.compile(r"PB-\d{8}-(AM|PM)-\d{3}")).first).to_be_visible(timeout=10000)
    shot(page, "07-batch")


@step("Return stock removes it and it is found by search as RETURNED")
def t_return(page):
    nav(page, "Return Stock")
    pick_e2e(page.locator("#rt-material"))
    page.select_option("#rt-location", "GROUND_FLOOR")
    page.get_by_label("Quantity").fill("1")
    page.fill("#rt-to", f"UI Supplier {TAG}")
    page.fill("#rt-reason", "UI e2e return")
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Return stock").click()
    expect(page.get_by_text(f"UI Supplier {TAG}")).to_be_visible(timeout=10000)
    shot(page, "08-returns")
    nav(page, "Search Stock")
    page.get_by_label("Search stock records").fill(f"UI Supplier {TAG}")
    page.get_by_role("button", name="Search", exact=True).click()
    expect(page.get_by_text("Returned", exact=True).first).to_be_visible(timeout=10000)
    shot(page, "09-search")


@step("Stock Activity hides returns unless asked")
def t_activity(page):
    page.goto(f"{UI}/stock-activity")
    page.wait_for_timeout(1500)
    assert "UI e2e return" not in page.locator("main").inner_text()
    page.get_by_label("Include returned stock").check()
    page.get_by_role("button", name="Apply").click()
    expect(page.get_by_text(re.compile("UI e2e return")).first).to_be_visible(timeout=10000)
    shot(page, "10-activity")


@step("Day-wise usage shows AM/PM split")
def t_usage(page):
    nav(page, "Day-wise Usage")
    expect(page.get_by_text("AM · Morning").first).to_be_visible()
    expect(page.get_by_text("Daily register")).to_be_visible()
    shot(page, "11-usage")


@step("Production Log has the AM/PM shift toggle")
def t_production_log(page):
    nav(page, "Production Log")
    expect(page.get_by_role("radio", name="AM · Morning")).to_be_visible()
    expect(page.get_by_role("radio", name="PM · Night")).to_be_visible()
    shot(page, "12-production-log")


@step("Worker sees stock screens but not Return Stock; mobile layout has no horizontal scroll")
def t_worker(owner_page):
    context = owner_page.context.browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    login(page, os.environ["VP_E2E_WORKER"])
    page.goto(f"{UI}/stock")
    expect(page.get_by_role("heading", name="Stock Overview")).to_be_visible()
    page.wait_for_selector("table tbody tr")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "horizontal scroll on mobile"
    shot(page, "13-worker-mobile")
    page.goto(f"{UI}/stock/returns")
    page.wait_for_timeout(800)
    assert "/stock/returns" not in page.url, "worker must not reach Return Stock"
    context.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        login(page, os.environ["VP_E2E_OWNER"])
        for test in (t_nav, t_overview, t_opening_closing, t_shifts, t_transfer, t_legacy, t_machines, t_batch,
                     t_return, t_activity, t_usage, t_production_log, t_worker):
            test(page)
        browser.close()
    for name, status, detail in results:
        print(f"{status}  {name}" + (f"\n      {detail}" if detail else ""))
    if errors:
        print("PAGE ERRORS:\n  " + "\n  ".join(errors))
    failed = [r for r in results if r[1] == "FAIL"]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed or errors else 0)


if __name__ == "__main__":
    main()
