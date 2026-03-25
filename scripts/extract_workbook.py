#!/usr/bin/env python3

import json
import posixpath
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WORKBOOK_PATH = ROOT / "recipes_for_pos_normalized_verified.xlsx"
OUTPUT_JS_PATH = ROOT / "data" / "workbook-data.js"
OUTPUT_JSON_PATH = ROOT / "src" / "data" / "workbook-data.json"

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def main() -> None:
    workbook_data = read_workbook(WORKBOOK_PATH)
    OUTPUT_JS_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)

    js_payload = "window.WORKBOOK_DATA = " + json.dumps(workbook_data, indent=2) + ";\n"
    json_payload = json.dumps(workbook_data, indent=2) + "\n"

    OUTPUT_JS_PATH.write_text(js_payload, encoding="utf-8")
    OUTPUT_JSON_PATH.write_text(json_payload, encoding="utf-8")

    print(f"Wrote {OUTPUT_JS_PATH}")
    print(f"Wrote {OUTPUT_JSON_PATH}")


def read_workbook(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        shared_strings = load_shared_strings(archive)
        workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels_root.findall("pkgrel:Relationship", NS)
        }

        sheets = {}
        sheet_order = []
        for sheet in workbook_root.find("main:sheets", NS):
            sheet_name = sheet.attrib["name"]
            rel_id = sheet.attrib[
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            ]
            xml_path = resolve_target(rel_map[rel_id])
            rows = read_sheet_rows(archive, xml_path, shared_strings)
            headers = rows[0] if rows else []
            row_objects = [row_to_object(headers, row) for row in rows[1:]]

            sheets[sheet_name] = {
                "headers": headers,
                "rowCount": len(row_objects),
                "rows": row_objects,
            }
            sheet_order.append(sheet_name)

    return {
        "sourceWorkbook": path.name,
        "sheetOrder": sheet_order,
        "sheets": sheets,
    }


def load_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []

    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    strings = []
    for string_item in root.findall("main:si", NS):
        text = "".join(node.text or "" for node in string_item.iterfind(".//main:t", NS))
        strings.append(text)
    return strings


def read_sheet_rows(
    archive: zipfile.ZipFile, xml_path: str, shared_strings: list[str]
) -> list[list[str]]:
    root = ET.fromstring(archive.read(xml_path))
    sheet_data = root.find("main:sheetData", NS)
    if sheet_data is None:
        return []

    rows = []
    for row in sheet_data.findall("main:row", NS):
        cells = row.findall("main:c", NS)
        width = max((column_index(cell.attrib["r"]) for cell in cells), default=-1) + 1
        values = [""] * width
        for cell in cells:
            values[column_index(cell.attrib["r"])] = read_cell_value(cell, shared_strings)
        rows.append(values)
    return rows


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    raw_value = cell.find("main:v", NS)
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iterfind(".//main:t", NS))
    if raw_value is None:
        return ""

    value = raw_value.text or ""
    if cell_type == "s":
        return shared_strings[int(value)]
    return value


def row_to_object(headers: list[str], row: list[str]) -> dict:
    return {
        header: row[index] if index < len(row) else ""
        for index, header in enumerate(headers)
        if header
    }


def resolve_target(target: str) -> str:
    normalized = target.lstrip("/")
    if normalized.startswith("xl/"):
        return normalized
    return posixpath.normpath(posixpath.join("xl", normalized))


def column_index(cell_ref: str) -> int:
    letters = "".join(character for character in cell_ref if character.isalpha())
    index = 0
    for character in letters:
        index = index * 26 + (ord(character.upper()) - 64)
    return index - 1


if __name__ == "__main__":
    main()
