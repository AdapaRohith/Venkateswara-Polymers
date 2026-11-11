"""Excel versions of the plant's own sheets: Inventory Register, Shift Production Report, Summary."""
from __future__ import annotations

from datetime import date
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

NAVY = "1F3864"
THIN = Side(style="thin", color="9CA3AF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FONT = Font(bold=True, color="FFFFFF", size=10)
HEAD_FILL = PatternFill("solid", fgColor=NAVY)
STATUS_STYLE = {
    "REORDER": (PatternFill("solid", fgColor="F8CBAD"), Font(bold=True, color="9C0006")),
    "BUFFER": (PatternFill("solid", fgColor="FFE699"), Font(bold=True, color="7F6000")),
    "OPTIMAL": (PatternFill("solid", fgColor="C6EFCE"), Font(bold=True, color="006100")),
}
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
NUM2 = "#,##0.00"
NUM1 = "#,##0.0"
NUM0 = "#,##0"


def _text(value) -> str:
    """User-typed text goes in as text, never as a formula."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def _ddmmyyyy(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%d-%m-%Y")


def _save(wb: Workbook) -> bytes:
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _header(ws, row: int, labels: list[str], start_col: int = 1):
    for i, label in enumerate(labels):
        cell = ws.cell(row=row, column=start_col + i, value=label)
        cell.font, cell.fill, cell.alignment, cell.border = HEAD_FONT, HEAD_FILL, CENTER, BOX
    ws.row_dimensions[row].height = 30


def _title(ws, text: str, width: int, row: int = 1):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=width)
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = Font(bold=True, color="FFFFFF", size=14)
    cell.fill = HEAD_FILL
    cell.alignment = CENTER
    ws.row_dimensions[row].height = 26


def _status_cell(cell, status: str | None, label: str | None):
    cell.value = label or ""
    cell.alignment = CENTER
    cell.border = BOX
    if status in STATUS_STYLE:
        cell.fill, cell.font = STATUS_STYLE[status]


def _widths(ws, widths: list[int]):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ── Inventory register ──

REG_HEAD = ["BATCH NO.", "MATERIAL DESCRIPTION", "MATERIAL BRAND", "UNIT SPEC", "OPENING (BAGS)",
            "RECEIVED (BAGS)", "ISSUED (BAGS)", "CLOSING (BAGS)", "CLOSING WEIGHT (KG)", "TONS",
            "STOCK ALERT STATUS"]


def _register_row(ws, r: int, values: list, status=None, status_label=None, bold=False):
    for col, value in enumerate(values, start=1):
        cell = ws.cell(row=r, column=col, value=value)
        cell.border = BOX
        if bold:
            cell.font = Font(bold=True)
        if col >= 5:
            cell.number_format = NUM2 if col == 10 else (NUM0 if col == 9 else "#,##0.##")
            cell.alignment = Alignment(horizontal="right")
    _status_cell(ws.cell(row=r, column=11), status, status_label)


def inventory_register_workbook(data: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Raw Material Register"
    t = data["thresholds"]
    low_t, high_t = t["reorder_below_kg"] / 1000, t["optimal_above_kg"] / 1000
    _title(ws, "POLYMER RAW MATERIAL INVENTORY REGISTER", 11)
    ws.merge_cells("A2:K2")
    ws["A2"] = (f"Stock Thresholds: Below {low_t:g} MT (Reorder Warning) | {low_t:g} - {high_t:g} MT "
                f"(Buffer Stock) | Above {high_t:g} MT (Optimal Stock)")
    ws["A2"].font = Font(italic=True, color="4B5563")
    ws["A2"].alignment = CENTER
    ws.merge_cells("F4:H4")
    ws["F4"] = f"DATE: {_ddmmyyyy(data['business_date'])}"
    ws["F4"].font = Font(bold=True)
    ws["F4"].fill = PatternFill("solid", fgColor="FFF2CC")
    ws["F4"].alignment = CENTER

    zones = [z for z in data["zones"] if z["location"] in ("GROUND_FLOOR", "FIRST_FLOOR")]
    r = 6
    ws.cell(row=r, column=1, value="EXECUTIVE CONSOLIDATED SUMMARY REPORT").font = Font(bold=True, color=NAVY)
    r += 1
    _header(ws, r, REG_HEAD)
    for i, z in enumerate(zones, start=1):
        r += 1
        s = z["subtotal"]
        _register_row(ws, r, [f"ZONE {i}", z["label"].upper(), "ALL BRANDS", "25 Kg/Bag", s["opening_bags"],
                              s["received_bags"], s["issued_bags"], s["closing_bags"], s["closing_kg"],
                              s["closing_kg"] / 1000], s["status"], s["status_label"])
    r += 1
    p = data["plant_raw_total"]
    _register_row(ws, r, ["PLANT CONSOLIDATED TOTAL", "", "", "", p["opening_bags"], p["received_bags"],
                          p["issued_bags"], p["closing_bags"], p["closing_kg"], p["closing_kg"] / 1000],
                  p["status"], p["status_label"], bold=True)

    for n, z in enumerate(zones, start=1):
        r += 2
        title = "GROUND FLOOR RAW MATERIAL BAY" if z["location"] == "GROUND_FLOOR" else "1ST FLOOR PRODUCTION"
        ws.cell(row=r, column=1, value=f"{n}. {title}").font = Font(bold=True, color=NAVY)
        r += 1
        _header(ws, r, REG_HEAD)
        for row in z["rows"]:
            r += 1
            batch = row["batch_no"] or ("RUNNING STOCK" if z["location"] == "FIRST_FLOOR" else "")
            _register_row(ws, r, [_text(batch), _text(row["item_name"]), _text(row["brand"]), "25 Kg/Bag",
                                  row["opening_bags"], row["received_bags"], row["issued_bags"],
                                  row["closing_bags"], row["closing_kg"], row["closing_kg"] / 1000],
                          row["status"], row["status_label"])
        if not z["rows"]:
            r += 1
            ws.cell(row=r, column=2, value="No stock").font = Font(italic=True, color="6B7280")
        r += 1
        s = z["subtotal"]
        _register_row(ws, r, [f"{title} SUB-TOTAL", "", "", "", s["opening_bags"], s["received_bags"],
                              s["issued_bags"], s["closing_bags"], s["closing_kg"], s["closing_kg"] / 1000],
                      s["status"], s["status_label"], bold=True)
        ws.cell(row=r, column=1).font = Font(bold=True, color="C00000")
    _widths(ws, [16, 30, 18, 12, 14, 14, 14, 14, 18, 10, 22])
    ws.freeze_panes = "A6"

    for loc, sheet, heading in (("ROLL_STORE", "Roll Store", "ROLL STORE — EXTRUDER OUTPUT"),
                                ("FINISHED_STORE", "Finished Goods", "FINISHED GOODS STORE — CUTTING OUTPUT")):
        z = next(z for z in data["zones"] if z["location"] == loc)
        sh = wb.create_sheet(sheet)
        _title(sh, heading, 6)
        sh.merge_cells("A2:F2")
        sh["A2"] = f"DATE: {_ddmmyyyy(data['business_date'])}"
        sh["A2"].alignment = CENTER
        sh["A2"].font = Font(bold=True)
        _header(sh, 4, ["SIZE", "OPENING (KG)", "PRODUCED (KG)", "ISSUED (KG)", "CLOSING (KG)", "TONS"])
        r = 4
        for row in z["rows"]:
            r += 1
            for col, value in enumerate([_text(row["item_name"]), row["opening_kg"], row["received_kg"],
                                         row["issued_kg"], row["closing_kg"], row["closing_kg"] / 1000], start=1):
                cell = sh.cell(row=r, column=col, value=value)
                cell.border = BOX
                if col > 1:
                    cell.number_format = NUM2
        r += 1
        s = z["subtotal"]
        for col, value in enumerate(["TOTAL", s["opening_kg"], s["received_kg"], s["issued_kg"],
                                     s["closing_kg"], s["closing_kg"] / 1000], start=1):
            cell = sh.cell(row=r, column=col, value=value)
            cell.border, cell.font = BOX, Font(bold=True)
            if col > 1:
                cell.number_format = NUM2
        _widths(sh, [26, 16, 16, 16, 16, 10])
    return _save(wb)


# ── Shift production report (Day / Night × Plant / Cutting) ──

def shift_report_workbook(data: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Shift Report"
    _title(ws, f"PRODUCTION REPORT — {_ddmmyyyy(data['business_date'])}", 16)
    blocks = [("AM", 1, "DAY"), ("PM", 9, "NIGHT")]
    max_rows = 0
    for shift, col0, _ in blocks:
        for section, offset, label in (("plant", 0, "PLANT REPORT"), ("cutting", 4, "CUTTING MACHINE")):
            c0 = col0 + offset
            ws.merge_cells(start_row=3, start_column=c0, end_row=3, end_column=c0 + 3)
            head = ws.cell(row=3, column=c0, value=label)
            head.font, head.fill, head.alignment = HEAD_FONT, HEAD_FILL, CENTER
            _header(ws, 4, ["MCN", "SIZE", "GROSS", "WASTE"], c0)
            entries = data[shift][section]["entries"]
            max_rows = max(max_rows, len(entries))
            for i, e in enumerate(entries):
                r = 5 + i
                size = e["output_code"] if section == "plant" else f"{e['input_code']} → {e['output_code']}"
                for j, value in enumerate([_text(e["machine_name"]), _text(size), e["gross_kg"], e["wastage_kg"]]):
                    cell = ws.cell(row=r, column=c0 + j, value=value)
                    cell.border = BOX
                    if j >= 2:
                        cell.number_format = NUM1
    tot = 5 + max(max_rows, 1) + 1
    for shift, col0, label in blocks:
        for section, offset in (("plant", 0), ("cutting", 4)):
            c0 = col0 + offset
            s = data[shift][section]
            for k, (name, key) in enumerate((("GROSS", "gross_kg"), ("WASTAGE", "wastage_kg"), ("NET", "net_kg"))):
                r = tot + k
                ws.cell(row=r, column=c0, value=name).font = Font(bold=True)
                cell = ws.cell(row=r, column=c0 + 2, value=s[key])
                cell.number_format, cell.border = NUM1, BOX
                cell.font = Font(bold=True, color="C00000" if key == "wastage_kg" else "000000")
                if key == "net_kg":
                    cell.fill = PatternFill("solid", fgColor="FFFF00")
        ws.merge_cells(start_row=tot + 4, start_column=col0, end_row=tot + 4, end_column=col0 + 7)
        band = ws.cell(row=tot + 4, column=col0, value=label)
        band.font, band.alignment = Font(bold=True, color="C00000"), CENTER
        band.fill = PatternFill("solid", fgColor="FCE4D6")
    dn = data["day_and_night"]
    r = tot + 5
    for col0, label, key in ((1, "DAY & NIGHT PLANT", "plant"), (9, "DAY & NIGHT CUTTING", "cutting")):
        ws.merge_cells(start_row=r, start_column=col0, end_row=r, end_column=col0 + 5)
        cell = ws.cell(row=r, column=col0, value=label)
        cell.font, cell.alignment = Font(bold=True, color="C00000"), CENTER
        cell.fill = PatternFill("solid", fgColor="DDEBF7")
        val = ws.cell(row=r, column=col0 + 6, value=dn[key]["net_kg"])
        val.font, val.number_format = Font(bold=True), NUM1
        val.fill = PatternFill("solid", fgColor="DDEBF7")
    _widths(ws, [12, 22, 10, 9, 12, 26, 10, 9] * 2)
    return _save(wb)


# ── Range summary ──

def _table(ws, start_row: int, headers: list[str], data_rows: list[list], num_from: int = 1):
    _header(ws, start_row, headers)
    for i, values in enumerate(data_rows, start=1):
        for col, value in enumerate(values, start=1):
            cell = ws.cell(row=start_row + i, column=col, value=_text(value) if isinstance(value, str) else value)
            cell.border = BOX
            if col > num_from and isinstance(value, (int, float)):
                cell.number_format = NUM1
    return start_row + len(data_rows)


def summary_workbook(data: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Daily"
    span = f"{_ddmmyyyy(data['date_from'])} to {_ddmmyyyy(data['date_to'])}"
    _title(ws, f"PRODUCTION SUMMARY — {span}", 11)
    _table(ws, 3, ["DATE", "PLANT DAY NET", "PLANT NIGHT NET", "PLANT GROSS", "PLANT WASTAGE", "PLANT NET",
                   "PLANT WASTE %", "CUTTING GROSS", "CUTTING WASTAGE", "CUTTING NET", "CUTTING WASTE %"],
           [[_ddmmyyyy(d["business_date"]), d["plant_am"]["net_kg"], d["plant_pm"]["net_kg"], d["plant"]["gross_kg"],
             d["plant"]["wastage_kg"], d["plant"]["net_kg"], d["plant"]["wastage_percent"], d["cutting"]["gross_kg"],
             d["cutting"]["wastage_kg"], d["cutting"]["net_kg"], d["cutting"]["wastage_percent"]] for d in data["days"]])
    _widths(ws, [13] + [15] * 10)

    ms = wb.create_sheet("Machines")
    _title(ms, f"MACHINE-WISE — {span}", 6)
    _table(ms, 3, ["MACHINE", "SECTION", "GROSS", "WASTAGE", "NET", "WASTE %"],
           [[m["machine_name"], "Plant" if m["kind"] == "EXTRUSION" else "Cutting", m["gross_kg"], m["wastage_kg"],
             m["net_kg"], m["wastage_percent"]] for m in data["machines"]], num_from=2)
    _widths(ms, [20, 12, 14, 14, 14, 10])

    us = wb.create_sheet("Material Usage")
    _title(us, f"RAW MATERIAL USED — {span}", 4)
    _table(us, 3, ["MATERIAL", "BRAND", "USED (KG)", "BAGS"],
           [[u["material_name"], u["brand"], u["used_kg"], u["used_kg"] / 25] for u in data["material_usage"]],
           num_from=2)
    _widths(us, [28, 16, 14, 10])

    ss = wb.create_sheet("Sizes")
    _title(ss, f"OUTPUT BY SIZE — {span}", 6)
    _table(ss, 3, ["SECTION", "SIZE", "ENTRIES", "GROSS", "WASTAGE", "NET"],
           [["Plant (rolls)" if s["kind"] == "EXTRUSION" else "Cutting", s["code"], s["entries"], s["gross_kg"],
             s["wastage_kg"], s["net_kg"]] for s in data["sizes"]], num_from=2)
    _widths(ss, [16, 26, 10, 14, 14, 14])
    return _save(wb)
