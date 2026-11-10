"""Read the active Chromium accessibility tree through the Linux AT-SPI bridge."""

import json
import sys
import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi


Atspi.init()
desktop = Atspi.get_desktop(0)
expected_heading = sys.argv[1] if len(sys.argv) > 1 else ""
expected_focus = sys.argv[2] if len(sys.argv) > 2 else "Ir para o conteúdo principal"
nodes = []
desktop_names = []
INTERACTIVE_ROLES = {
    "push button", "toggle button", "link", "text", "entry", "combo box", "check box",
    "radio button", "spin button", "slider", "page tab", "menu item", "menu button",
    "list box", "option pane", "tree item", "switch", "date editor", "date field",
    "password text", "search box",
}


def visit(node, depth=0, inside_document=False):
    if depth > 48:
        return
    try:
        name = node.get_name() or ""
        role = node.get_role_name() or ""
        if name:
            desktop_names.append(name)
        inside_document = inside_document or role == "document web"
        focused = node.get_state_set().contains(Atspi.StateType.FOCUSED)
        if inside_document and (name or focused or role in INTERACTIVE_ROLES):
            nodes.append({"role": role, "name": name, "focused": focused,
                          "interactive": role in INTERACTIVE_ROLES})
        for index in range(node.get_child_count()):
            visit(node.get_child_at_index(index), depth + 1, inside_document)
    except Exception:
        # Desktop and browser nodes can disappear while Chromium is closing.
        return


for _ in range(10):
    nodes.clear()
    for index in range(desktop.get_child_count()):
        visit(desktop.get_child_at_index(index))
    if any(node["role"] == "heading" and (not expected_heading or expected_heading.lower() in node["name"].lower())
           for node in nodes):
        break
    time.sleep(0.2)

focused = [node for node in nodes if node["focused"]]
result = {
    "browser_seen": any("Chrome" in name for name in desktop_names),
    "document_names": [node["name"] for node in nodes if node["role"] == "document web" and node["name"]],
    "headings": [node["name"] for node in nodes if node["role"] == "heading" and node["name"]],
    "interactive_control_count": sum(node["interactive"] for node in nodes),
    "unnamed_interactive_controls": [
        {"role": node["role"], "focused": node["focused"]}
        for node in nodes if node["interactive"] and not node["name"].strip()
    ],
    "expected_heading_seen": any(node["role"] == "heading" and expected_heading.lower() in node["name"].lower()
                                  for node in nodes) if expected_heading else None,
    "focused_accessible_object": next((node for node in focused if node["role"] == "link"), focused[0] if focused else None),
    "expected_focus_seen": any(node["role"] == "link" and node["name"] == expected_focus for node in nodes),
}
print(json.dumps(result, ensure_ascii=False))

if not result["browser_seen"] or not result["document_names"] or not result["headings"]:
    sys.exit(1)
if expected_heading and not result["expected_heading_seen"]:
    sys.exit(1)
if not result["focused_accessible_object"] or result["focused_accessible_object"]["name"] != expected_focus:
    sys.exit(1)
