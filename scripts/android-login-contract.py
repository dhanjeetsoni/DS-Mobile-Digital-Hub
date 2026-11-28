#!/usr/bin/env python3
"""Inspect the unified mobile APK's actual native accessibility contract."""
import re
import sys
import xml.etree.ElementTree as ET

def check(path, package, phase):
    nodes = [n for n in ET.parse(path).iter("node") if n.get("package") == package]
    assert nodes, "Expected application is not in foreground"
    assert any(n.get("class") == "android.webkit.WebView" for n in nodes), "No native WebView"
    def label(n):
        return " ".join((n.get("text", "") + " " + n.get("content-desc", "")).split()).casefold()
    def visible(n):
        m = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
        return m and int(m[3]) > int(m[1]) and int(m[4]) > int(m[2]) and n.get("enabled") == "true"
    text = " ".join(label(n) for n in nodes)
    assert "login id" in text and "password" in text and "android access area" in text, "Unified login labels missing"
    edits = [n for n in nodes if n.get("class") == "android.widget.EditText" and visible(n) and n.get("focusable") == "true"]
    assert len(edits) == 2 and sum(n.get("password") == "true" for n in edits) == 1, "Login and protected password input missing"
    def button(match):
        matches = [n for n in nodes if n.get("class") == "android.widget.Button" and visible(n) and n.get("clickable") == "true" and match(label(n))]
        assert len(matches) == 1, "Expected unique enabled button"
        m = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", matches[0].get("bounds"))
        return (int(m[1])+int(m[3]))//2, (int(m[2])+int(m[4]))//2
    login = button(lambda value: value == "login")
    def center(n):
        m = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds"))
        return (int(m[1])+int(m[3]))//2, (int(m[2])+int(m[4]))//2
    username = next(n for n in edits if n.get("password") != "true")
    password = next(n for n in edits if n.get("password") == "true")
    if phase == "focus_login":
        point = center(username)
    elif phase == "focus_password":
        assert username.get("text") == "CI-NATIVE-ONLY", "Synthetic login ID was not typed"
        point = center(password)
    elif phase == "typed":
        assert username.get("text") == "CI-NATIVE-ONLY", "Synthetic login ID not retained"
        assert password.get("text") and "CI-NATIVE-PASSWORD" not in password.get("text"), "Password not masked"
        point = button(lambda value: "clear login" in value)
    elif phase == "cleared":
        assert not username.get("text") and not password.get("text"), "Clear login retained credentials"
        point = login
    elif phase == "validation":
        assert "login id aur password dono bharo" in text, "Empty credential submit was not rejected"
        point = button(lambda value: "back to selection" in value or "clear login" in value)
    else:
        assert "login id aur password dono bharo" not in text, "Unexpected stale login error"
        point = login
    print(*point)

if __name__ == "__main__":
    check(*sys.argv[1:])
